/* Pure logic of the extension: no Shell or GTK imports, so it can be tested
 * with plain gjs (see tests/run.js). */

var SUPPORTED_SCHEMA = 1;
var BAND_LABELS = ['31', '63', '125', '250', '500', '1k', '2k', '4k', '8k', '16k'];
var CURVE = {width: 308, height: 80, topPad: 8, usable: 64, range: 12, firstX: 15.4, stepX: 30.8};

var SOURCE_LABELS = {
    musicbrainz: 'MusicBrainz',
    itunes: 'iTunes',
    deezer: 'Deezer',
    lastfm: 'Last.fm',
    cache: 'cache',
};

function statusPath(runtimeDir) {
    return `${runtimeDir}/spotify-autoeq/status.json`;
}

/* Returns {status} or {error}. Unknown fields are ignored on purpose. */
function parseStatus(text) {
    let doc;
    try {
        doc = JSON.parse(text);
    } catch (e) {
        return {error: 'invalid JSON'};
    }
    if (doc === null || typeof doc !== 'object' || typeof doc.schema_version !== 'number')
        return {error: 'not a status document'};
    return {status: doc};
}

function formatAgo(seconds) {
    const s = Math.max(0, Math.floor(seconds));
    if (s < 60)
        return 'less than a minute ago';
    const plural = (n, unit) => `${n} ${unit}${n === 1 ? '' : 's'} ago`;
    if (s < 3600)
        return plural(Math.floor(s / 60), 'minute');
    if (s < 86400)
        return plural(Math.floor(s / 3600), 'hour');
    return plural(Math.floor(s / 86400), 'day');
}

function sourceLabel(source) {
    if (!source)
        return '';
    if (source === 'none')
        return '–';
    return SOURCE_LABELS[source] || source;
}

function clampGain(g) {
    const n = Number(g);
    if (!isFinite(n))
        return 0;
    return Math.max(-CURVE.range, Math.min(CURVE.range, n));
}

/* Canvas coordinates of the ten band points, 308 x 80, +12 dB at the top. */
function curvePoints(gains) {
    const values = Array.isArray(gains) && gains.length === 10 ? gains : new Array(10).fill(0);
    return values.map((g, i) => ({
        x: CURVE.firstX + i * CURVE.stepX,
        y: CURVE.topPad + ((CURVE.range - clampGain(g)) / (2 * CURVE.range)) * CURVE.usable,
    }));
}

function processAlive(pid, existsFn) {
    return typeof pid === 'number' && pid > 0 && existsFn(`/proc/${pid}`);
}

/* Everything the UI needs, derived from the status document.
 *   status: parsed document or null (no file)
 *   now: unix seconds; pidExists: path -> bool */
function deriveView(status, now, pidExists) {
    const view = {
        state: 'stopped',
        panel: {icon: 'off', label: 'Off', normalWeight: true, muted: true},
        header: {serviceText: 'Stopped', serviceOk: false, backendText: '–', backendOk: null},
        banner: null,
        body: 'stopped',
        track: null,
        genres: {chips: [], note: '', source: ''},
        profile: null,
    };
    if (!status)
        return view;

    if (status.schema_version > SUPPORTED_SCHEMA) {
        view.state = 'unsupported';
        view.panel = {icon: 'warn', label: '?', normalWeight: true, muted: false};
        view.header = {serviceText: 'Running', serviceOk: true, backendText: '–', backendOk: null};
        view.banner = `Status format ${status.schema_version} is newer than this extension understands. Update the extension.`;
        view.body = 'unsupported';
        return view;
    }

    const daemon = status.daemon || {};
    if (daemon.state !== 'running' || !processAlive(daemon.pid, pidExists))
        return view;

    const backend = status.backend || {};
    const prof = status.profile || {};
    const failing = backend.ok === false;
    const playback = status.playback || 'idle';
    const profileName = prof.name || null;

    view.state = failing ? 'error'
        : playback === 'paused' ? 'paused'
            : playback === 'idle' ? 'idle'
                : playback === 'advertisement' ? 'ad' : 'active';

    view.header = {
        serviceText: 'Running',
        serviceOk: true,
        backendText: failing ? 'PulseEffects not running' : 'PulseEffects running',
        backendOk: !failing,
    };
    view.panel = {
        icon: failing ? 'warn' : 'eq',
        label: profileName || (failing ? '–' : 'Flat'),
        normalWeight: failing,
        muted: false,
    };
    if (failing)
        view.banner = backend.last_error || 'The equalizer backend is not responding';

    if (playback === 'idle' && !failing) {
        view.body = 'idle';
    } else if (playback === 'advertisement') {
        view.body = 'ad';
    } else if (status.track) {
        view.body = 'track';
        view.track = {
            text: status.track.artist && status.track.title
                ? `${status.track.artist} – ${status.track.title}`
                : status.track.title || status.track.artist || '',
            playing: playback !== 'paused',
        };
        const genres = Array.isArray(status.genres) ? status.genres.slice(0, 5) : [];
        view.genres.chips = genres;
        view.genres.source = sourceLabel(status.genre_source);
        if (genres.length === 0)
            view.genres.note = status.genre_source ? 'No genre found' : 'Looking up…';
    } else {
        view.body = 'idle';
    }

    const appliedAgo = typeof prof.applied_at === 'number'
        ? `applied ${formatAgo(now - prof.applied_at)}` : 'not applied yet';
    view.profile = {
        caption: failing ? 'Last known profile' : 'Applied profile',
        name: profileName || '–',
        applied: failing ? `${appliedAgo} · not in effect` : appliedAgo,
        muted: failing,
        gains: Array.isArray(prof.gains_db) ? prof.gains_db : [],
        dashed: failing,
        curveNote: failing ? 'not in effect' : 'Hz bands below',
        label: `${profileName || 'No'} equalizer curve, 10 bands from 31 Hz to 16 kHz`,
    };
    return view;
}

function viewsEqual(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
}
