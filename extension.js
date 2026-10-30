/* Spotify AutoEQ Status - GNOME Shell 42 panel indicator.
 *
 * Read-only front end of spotify-autoeq: it watches the status file written by
 * the daemon and shows the applied equalizer profile. All decisions about what
 * to show live in logic.js (tested without the Shell); this file only builds
 * widgets and wires events. */

const {Clutter, Gio, GLib, GObject, Pango, St} = imports.gi;
const Cairo = imports.cairo;
const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const ExtensionUtils = imports.misc.extensionUtils;

const Me = ExtensionUtils.getCurrentExtension();
const Logic = Me.imports.logic;
const _ = imports.gettext.domain(Me.metadata['gettext-domain']).gettext;

const RECHECK_SECONDS = 5;      // crash detection and monitor recovery
const REFRESH_OPEN_SECONDS = 20; // "applied 2 minutes ago" while the menu is open
const READ_DELAY_MS = 80;       // coalesce the burst of writes of one event
const PROJECT_URL = 'https://github.com/hllerden/spotify-autoeq';

function createIcon(name, size = 16, extraClass = '') {
    return new St.Icon({icon_name: name, icon_size: size, style_class: extraClass});
}

function createLabel(text, styleClass, ellipsize = false) {
    const label = new St.Label({text, style_class: styleClass, y_align: Clutter.ActorAlign.CENTER});
    if (ellipsize)
        label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
    return label;
}

function fileIcon(name) {
    return new Gio.FileIcon({file: Gio.File.new_for_path(`${Me.path}/icons/${name}.svg`)});
}

const AutoEqIndicator = GObject.registerClass(
class AutoEqIndicator extends PanelMenu.Button {
    _init() {
        super._init(0.5, _('Spotify AutoEQ Status'), false);

        this._lastView = null;
        this._status = null;
        this._monitor = null;
        this._monitorId = 0;
        this._readSource = 0;
        this._recheckSource = 0;
        this._refreshSource = 0;
        this._cancellable = new Gio.Cancellable();
        this._runtimeDir = GLib.get_user_runtime_dir();
        this._file = Gio.File.new_for_path(Logic.statusPath(this._runtimeDir));
        this._icons = {
            eq: fileIcon('autoeq-equalizer-symbolic'),
            off: fileIcon('autoeq-equalizer-off-symbolic'),
            warn: new Gio.ThemedIcon({name: 'dialog-warning-symbolic'}),
        };

        this._buildPanel();
        this._buildMenu();
        this._settings = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        this._settingsId = this._settings.connect('changed::color-scheme', () => this._applyTheme());

        this.menu.connect('open-state-changed', (menu, open) => this._onMenuOpen(open));

        this._render();
        this._ensureMonitor();
        this._queueRead();
        this._recheckSource = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, RECHECK_SECONDS, () => {
            this._recheck();
            return GLib.SOURCE_CONTINUE;
        });
    }

    // -- widgets ---------------------------------------------------------

    _buildPanel() {
        const box = new St.BoxLayout({style_class: 'panel-status-menu-box autoeq-panel-box'});
        this._panelIcon = new St.Icon({
            style_class: 'system-status-icon autoeq-panel-icon',
            gicon: this._icons.off,
        });
        this._panelLabel = createLabel('', 'autoeq-panel-label', true);
        box.add_child(this._panelIcon);
        box.add_child(this._panelLabel);
        this.add_child(box);
    }

    _column(captionText) {
        const column = new St.BoxLayout({vertical: true, style: 'spacing: 3px;'});
        column.add_child(createLabel(captionText, 'autoeq-caption'));
        const row = new St.BoxLayout({style: 'spacing: 6px;'});
        const icon = createIcon('emblem-ok-symbolic');
        const value = createLabel('', 'autoeq-value', true);
        row.add_child(icon);
        row.add_child(value);
        column.add_child(row);
        return {column, icon, value, row};
    }

    _buildMenu() {
        const box = this.menu.box;
        box.add_style_class_name('autoeq-menu');

        // 0 title and project link
        const titleRow = new St.BoxLayout({style_class: 'autoeq-row autoeq-title-row', style: 'spacing: 12px;'});
        titleRow.add_child(createLabel('Spotify AutoEQ', 'autoeq-title'));
        titleRow.add_child(new St.Widget({x_expand: true}));
        const link = new St.Button({
            label: 'GitHub',
            style_class: 'autoeq-link',
            can_focus: true,
            reactive: true,
            track_hover: true,
            y_align: Clutter.ActorAlign.CENTER,
            accessible_name: _('Open the Spotify AutoEQ project page on GitHub'),
        });
        link.connect('clicked', () => {
            this.menu.close();
            this._openUri(PROJECT_URL);
        });
        titleRow.add_child(link);
        box.add_child(titleRow);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // 1 header: service and backend state
        this._header = new St.BoxLayout({style_class: 'autoeq-row', style: 'spacing: 12px;'});
        this._service = this._column(_('Service'));
        this._backend = this._column(_('Equalizer backend'));
        this._service.column.set_width(92);
        this._backend.column.set_width(204);
        this._header.add_child(this._service.column);
        this._header.add_child(this._backend.column);
        box.add_child(this._header);

        // 7 error banner
        this._bannerWrap = new St.BoxLayout({style_class: 'autoeq-banner-wrap'});
        const banner = new St.BoxLayout({style_class: 'autoeq-error-banner', x_expand: true});
        banner.add_child(createIcon('dialog-error-symbolic'));
        this._bannerText = createLabel('', '', true);
        this._bannerText.x_expand = true;
        banner.add_child(this._bannerText);
        this._bannerWrap.add_child(banner);
        box.add_child(this._bannerWrap);

        this._sepTop = new PopupMenu.PopupSeparatorMenuItem();
        this.menu.addMenuItem(this._sepTop);

        // body lines: stopped / idle / advertisement
        this._stoppedLine = this._messageRow('autoeq-muted', 'media-playback-stop-symbolic',
            _('Service is not running'));
        this._idleLine = this._messageRow('autoeq-muted', 'media-playback-stop-symbolic',
            _('Nothing playing'));
        this._adRow = new St.BoxLayout({vertical: true, style_class: 'autoeq-row'});
        this._adRow.add_child(createLabel(_('Now playing'), 'autoeq-caption'));
        const adLine = new St.BoxLayout({style: 'spacing: 8px;'});
        adLine.add_child(createIcon('dialog-information-symbolic'));
        adLine.add_child(createLabel(_('Advertisement – equalizer unchanged'), '', true));
        this._adRow.add_child(adLine);
        this._unsupportedLine = this._messageRow('autoeq-muted', 'dialog-warning-symbolic', '');
        [this._stoppedLine, this._idleLine, this._adRow, this._unsupportedLine].forEach(w => box.add_child(w));

        // 2 now playing
        this._trackRow = new St.BoxLayout({vertical: true, style_class: 'autoeq-row'});
        const top = new St.BoxLayout({style: 'spacing: 12px;'});
        top.add_child(createLabel(_('Now playing'), 'autoeq-caption'));
        const spacer = new St.Widget({x_expand: true});
        top.add_child(spacer);
        this._playIcon = createIcon('media-playback-start-symbolic', 12, 'autoeq-caption');
        this._playText = createLabel('', 'autoeq-caption');
        top.add_child(this._playIcon);
        top.add_child(this._playText);
        this._trackLabel = createLabel('', 'autoeq-track', true);
        this._trackRow.add_child(top);
        this._trackRow.add_child(this._trackLabel);
        box.add_child(this._trackRow);

        // 3 genres
        this._genreRow = new St.BoxLayout({vertical: true, style_class: 'autoeq-row-tight'});
        this._genreRow.add_child(createLabel(_('Genres'), 'autoeq-caption'));
        const genreLine = new St.BoxLayout({style: 'spacing: 12px;'});
        this._chips = new St.BoxLayout({vertical: true, width: 220, style: 'spacing: 6px;'});
        const sourceColumn = new St.BoxLayout({vertical: true, width: 76, y_align: Clutter.ActorAlign.START});
        this._sourceCaption = createLabel(_('source'), 'autoeq-caption');
        this._sourceValue = createLabel('', 'autoeq-source', true);
        this._sourceCaption.x_align = Clutter.ActorAlign.END;
        this._sourceValue.x_align = Clutter.ActorAlign.END;
        sourceColumn.add_child(this._sourceCaption);
        sourceColumn.add_child(this._sourceValue);
        genreLine.add_child(this._chips);
        genreLine.add_child(sourceColumn);
        this._genreRow.add_child(genreLine);
        box.add_child(this._genreRow);

        this._sepProfile = new PopupMenu.PopupSeparatorMenuItem();
        this.menu.addMenuItem(this._sepProfile);

        // 4 profile
        this._profileRow = new St.BoxLayout({vertical: true, style_class: 'autoeq-row', style: 'spacing: 2px;'});
        this._profileCaption = createLabel('', 'autoeq-caption');
        this._profileName = createLabel('', 'autoeq-profile', true);
        this._profileApplied = createLabel('', 'autoeq-caption', true);
        this._profileRow.add_child(this._profileCaption);
        this._profileRow.add_child(this._profileName);
        this._profileRow.add_child(this._profileApplied);
        box.add_child(this._profileRow);

        // 5 curve
        this._curveRow = new St.BoxLayout({vertical: true, style: 'padding: 6px 16px 9px 16px; spacing: 4px;'});
        const curveTop = new St.BoxLayout();
        curveTop.add_child(createLabel('+12 dB', 'autoeq-caption'));
        curveTop.add_child(new St.Widget({x_expand: true}));
        this._curveNote = createLabel('', 'autoeq-caption');
        curveTop.add_child(this._curveNote);
        this._curve = new St.DrawingArea({style_class: 'autoeq-curve'});
        this._curve.connect('repaint', area => this._paintCurve(area));
        const curveBottom = new St.BoxLayout();
        curveBottom.add_child(createLabel('−12 dB', 'autoeq-caption'));
        curveBottom.add_child(new St.Widget({x_expand: true}));
        curveBottom.add_child(createLabel(_('0 dB line'), 'autoeq-caption'));
        const bands = new St.Widget({width: 308, height: 16, layout_manager: new Clutter.FixedLayout()});
        Logic.BAND_LABELS.forEach((text, i) => {
            const label = new St.Label({text, style_class: 'autoeq-band-label', width: 30});
            label.set_position(Logic.CURVE.firstX + i * Logic.CURVE.stepX - 15, 0);
            bands.add_child(label);
        });
        this._curveRow.add_child(curveTop);
        this._curveRow.add_child(this._curve);
        this._curveRow.add_child(curveBottom);
        this._curveRow.add_child(bands);
        box.add_child(this._curveRow);

        // 6 footer
        this._sepFooter = new PopupMenu.PopupSeparatorMenuItem();
        this.menu.addMenuItem(this._sepFooter);
        this.menu.addAction(_('Open log'), () => this._openLog());
        this.menu.addAction(_('Open config file'), () => this._openConfig());
    }

    _messageRow(styleClass, iconName, text) {
        const row = new St.BoxLayout({style_class: `autoeq-row ${styleClass}`, style: 'spacing: 8px;'});
        row.add_child(createIcon(iconName));
        row.message = createLabel(text, '', true);
        row.add_child(row.message);
        return row;
    }

    // -- state -------------------------------------------------------------

    _render() {
        const now = Math.floor(Date.now() / 1000);
        const view = Logic.deriveView(this._status, now, path => GLib.file_test(path, GLib.FileTest.EXISTS));
        if (this._lastView && Logic.viewsEqual(this._lastView, view))
            return;
        this._lastView = view;

        // panel
        this._panelIcon.gicon = this._icons[view.panel.icon];
        this._panelLabel.text = view.panel.label === 'Off' ? _('Off') : view.panel.label;
        this.remove_style_class_name('autoeq-off');
        this.remove_style_class_name('autoeq-error');
        if (view.state === 'stopped')
            this.add_style_class_name('autoeq-off');
        else if (view.state === 'error' || view.state === 'unsupported')
            this.add_style_class_name('autoeq-error');

        // header
        this._setStatusColumn(this._service, view.header.serviceOk ? 'ok' : 'stopped', _(view.header.serviceText), !view.header.serviceOk);
        const backendKind = view.header.backendOk === null ? 'none' : view.header.backendOk ? 'ok' : 'bad';
        this._setStatusColumn(this._backend, backendKind, _(view.header.backendText), backendKind === 'none');

        // banner
        this._bannerWrap.visible = !!view.banner;
        this._bannerText.text = view.banner || '';

        // body
        const body = view.body;
        this._stoppedLine.visible = body === 'stopped';
        this._idleLine.visible = body === 'idle';
        this._adRow.visible = body === 'ad';
        this._unsupportedLine.visible = body === 'unsupported';
        this._unsupportedLine.message.text = view.banner || '';
        this._trackRow.visible = body === 'track';
        this._genreRow.visible = body === 'track';
        if (view.track) {
            this._trackLabel.text = view.track.text;
            this._playIcon.icon_name = view.track.playing ? 'media-playback-start-symbolic' : 'media-playback-pause-symbolic';
            this._playText.text = view.track.playing ? _('Playing') : _('Paused');
        }
        this._renderGenres(view.genres);

        // profile and curve
        const showProfile = body !== 'stopped' && body !== 'unsupported' && view.profile;
        this._sepProfile.visible = !!showProfile;
        this._profileRow.visible = !!showProfile;
        this._curveRow.visible = !!showProfile;
        if (showProfile) {
            const p = view.profile;
            this._profileCaption.text = _(p.caption);
            this._profileName.text = p.name;
            this._profileApplied.text = p.applied;
            this._curveNote.text = p.curveNote;
            this._profileRow.style_class = `autoeq-row ${p.muted ? 'autoeq-muted' : ''}`;
            this._curve.accessible_name = p.label;
            this._curve.queue_repaint();
        }
    }

    _setStatusColumn(col, kind, text, muted) {
        const icons = {ok: 'emblem-ok-symbolic', stopped: 'media-playback-stop-symbolic', bad: 'dialog-warning-symbolic', none: 'dialog-question-symbolic'};
        col.icon.icon_name = icons[kind];
        col.value.text = text;
        col.row.style_class = muted ? 'autoeq-muted' : '';
    }

    _renderGenres(genres) {
        // Chips wrap by measured width: St has no flow layout that sizes reliably.
        this._chips.destroy_all_children();
        const items = genres.chips.map(g => createLabel(g, 'autoeq-chip', true));
        if (genres.note)
            items.push(createLabel(genres.note, 'autoeq-muted'));
        const maxWidth = 220;
        const gap = 6;
        let row = null;
        let used = 0;
        items.forEach(label => {
            this._chips.add_child(label);
            const width = label.get_preferred_width(-1)[1];
            this._chips.remove_child(label);
            if (!row || (used > 0 && used + gap + width > maxWidth)) {
                row = new St.BoxLayout({style: `spacing: ${gap}px;`});
                this._chips.add_child(row);
                used = 0;
            }
            row.add_child(label);
            used += (used ? gap : 0) + width;
        });
        this._sourceCaption.visible = !!genres.source;
        this._sourceValue.text = genres.source;
    }

    _paintCurve(area) {
        const view = this._lastView;
        const profile = view && view.profile;
        const [width] = area.get_surface_size();
        const cr = area.get_context();
        const node = area.get_theme_node();
        const color = name => {
            const [found, c] = node.lookup_color(name, false);
            return found ? c : node.get_foreground_color();
        };
        const dashed = !!(profile && profile.dashed);
        const line = dashed ? color('-autoeq-muted') : node.get_foreground_color();

        cr.setLineWidth(1);
        Clutter.cairo_set_source_color(cr, color('-autoeq-bound'));
        cr.moveTo(0, 8.5); cr.lineTo(width, 8.5);
        cr.moveTo(0, 71.5); cr.lineTo(width, 71.5);
        cr.stroke();
        Clutter.cairo_set_source_color(cr, color('-autoeq-zero'));
        cr.moveTo(0, 40); cr.lineTo(width, 40);
        cr.stroke();

        if (profile) {
            const points = Logic.curvePoints(profile.gains);
            Clutter.cairo_set_source_color(cr, line);
            cr.setLineWidth(2);
            cr.setLineJoin(Cairo.LineJoin.ROUND);
            cr.setLineCap(Cairo.LineCap.ROUND);
            cr.setDash(dashed ? [5, 4] : [], 0);
            points.forEach((p, i) => (i ? cr.lineTo(p.x, p.y) : cr.moveTo(p.x, p.y)));
            cr.stroke();
            cr.setDash([], 0);
            points.forEach(p => {
                cr.newSubPath();
                cr.arc(p.x, p.y, 2.5, 0, 2 * Math.PI);
            });
            cr.fill();
        }
        cr.$dispose();
    }

    _applyTheme() {
        // Follow what the shell theme actually draws: classify the menu surface.
        let dark = true;
        const [found, bg] = this.menu.actor.get_theme_node().lookup_color('-arrow-background-color', false);
        if (found) {
            dark = (0.2126 * bg.red + 0.7152 * bg.green + 0.0722 * bg.blue) < 128;
        } else {
            dark = this._settings.get_string('color-scheme') !== 'default';
        }
        const box = this.menu.box;
        box.remove_style_class_name(dark ? 'autoeq-light' : 'autoeq-dark');
        box.add_style_class_name(dark ? 'autoeq-dark' : 'autoeq-light');
        this._curve.queue_repaint();
    }

    // -- status file ------------------------------------------------------

    _ensureMonitor() {
        if (this._monitor)
            return;
        const dir = this._file.get_parent();
        if (!dir.query_exists(null))
            return;
        try {
            this._monitor = dir.monitor_directory(Gio.FileMonitorFlags.WATCH_MOVES, null);
            this._monitorId = this._monitor.connect('changed', (monitor, file, other) => {
                const names = [file, other].filter(f => f).map(f => f.get_basename());
                if (names.includes('status.json'))
                    this._queueRead();
            });
        } catch (e) {
            this._monitor = null;
        }
    }

    _queueRead() {
        if (this._readSource)
            return;
        this._readSource = GLib.timeout_add(GLib.PRIORITY_DEFAULT, READ_DELAY_MS, () => {
            this._readSource = 0;
            this._read();
            return GLib.SOURCE_REMOVE;
        });
    }

    _read() {
        this._file.load_contents_async(this._cancellable, (file, result) => {
            let status = null;
            try {
                const [ok, bytes] = file.load_contents_finish(result);
                if (ok) {
                    const parsed = Logic.parseStatus(new TextDecoder().decode(bytes));
                    status = parsed.status || null;
                }
            } catch (e) {
                if (e.matches && e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                    return;
                status = null;     // no file: the service is not running
            }
            this._status = status;
            this._render();
        });
    }

    _recheck() {
        this._ensureMonitor();
        // The monitor is event driven; this also catches a daemon that died
        // without writing "stopped", and a directory that appeared late.
        if (!this._monitor)
            this._read();
        else
            this._render();
    }

    // -- menu ---------------------------------------------------------------

    _onMenuOpen(open) {
        if (open) {
            this._applyTheme();
            this._lastView = null;
            this._render();
            this._refreshSource = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, REFRESH_OPEN_SECONDS, () => {
                this._render();
                return GLib.SOURCE_CONTINUE;
            });
        } else if (this._refreshSource) {
            GLib.source_remove(this._refreshSource);
            this._refreshSource = 0;
        }
    }

    _openLog() {
        const command = ['journalctl', '--user', '-u', 'spotify-autoeq', '-f'];
        const terminals = [
            ['gnome-terminal', '--', ...command],
            ['x-terminal-emulator', '-e', command.join(' ')],
            ['xterm', '-e', command.join(' ')],
        ];
        for (const argv of terminals) {
            try {
                Gio.Subprocess.new(argv, Gio.SubprocessFlags.NONE);
                return;
            } catch (e) {
                // try the next terminal emulator
            }
        }
        Main.notify(_('Spotify AutoEQ'), _('No terminal emulator found. Run: journalctl --user -u spotify-autoeq -f'));
    }

    _openUri(uri) {
        try {
            Gio.AppInfo.launch_default_for_uri(uri, global.create_app_launch_context(0, -1));
        } catch (e) {
            Main.notify(_('Spotify AutoEQ'), e.message);
        }
    }

    _openConfig() {
        const path = `${GLib.get_user_config_dir()}/spotify-autoeq/config.yaml`;
        if (!GLib.file_test(path, GLib.FileTest.EXISTS)) {
            Main.notify(_('Spotify AutoEQ'), _('No configuration file yet. Run: spotify-autoeq config init'));
            return;
        }
        this._openUri(`file://${path}`);
    }

    destroy() {
        this._cancellable.cancel();
        if (this._readSource)
            GLib.source_remove(this._readSource);
        if (this._recheckSource)
            GLib.source_remove(this._recheckSource);
        if (this._refreshSource)
            GLib.source_remove(this._refreshSource);
        this._readSource = this._recheckSource = this._refreshSource = 0;
        if (this._monitor) {
            this._monitor.disconnect(this._monitorId);
            this._monitor.cancel();
            this._monitor = null;
        }
        if (this._settingsId) {
            this._settings.disconnect(this._settingsId);
            this._settingsId = 0;
        }
        super.destroy();
    }
});

class Extension {
    enable() {
        this._indicator = new AutoEqIndicator();
        Main.panel.addToStatusArea(Me.metadata.uuid, this._indicator, 0, 'right');
    }

    disable() {
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
    }
}

function init() {
    ExtensionUtils.initTranslations(Me.metadata['gettext-domain']);
    return new Extension();
}
