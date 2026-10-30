/* Plain gjs tests. Run from the repository root: gjs tests/run.js */
imports.searchPath.unshift('.');
const L = imports.logic;

let failed = 0;
let passed = 0;

function test(name, fn) {
    try {
        fn();
        passed++;
    } catch (e) {
        failed++;
        print(`FAIL ${name}\n  ${e.message}`);
    }
}

function eq(actual, expected, what = '') {
    const a = JSON.stringify(actual);
    const b = JSON.stringify(expected);
    if (a !== b)
        throw new Error(`${what} expected ${b}, got ${a}`);
}

function near(actual, expected, what = '') {
    if (Math.abs(actual - expected) > 1e-9)
        throw new Error(`${what} expected ${expected}, got ${actual}`);
}

const NOW = 1000000;
const alive = () => true;
const dead = () => false;

function doc(over = {}) {
    return Object.assign({
        schema_version: 1,
        updated_at: NOW,
        daemon: {state: 'running', pid: 42, version: '1.1.0'},
        playback: 'playing',
        track: {artist: 'Placebo', title: 'This Picture', kind: 'track'},
        genres: ['alternative rock', 'indie rock', 'rock'],
        genre_source: 'musicbrainz',
        genre_cached: false,
        profile: {name: 'Rock', applied_at: NOW - 120, gains_db: [4, 3, 2, 0, -1, -1, 1, 3, 4, 3], in_effect: true},
        backend: {name: 'pulseeffects', ok: true, last_error: null},
    }, over);
}

test('statusPath', () => eq(L.statusPath('/run/user/1000'), '/run/user/1000/spotify-autoeq/status.json'));

test('parseStatus accepts a document and ignores unknown fields', () => {
    const r = L.parseStatus(JSON.stringify(Object.assign(doc(), {future: 1})));
    eq(r.status.schema_version, 1);
});

test('parseStatus rejects garbage', () => {
    eq(L.parseStatus('{oops').error, 'invalid JSON');
    eq(L.parseStatus('[]').error, 'not a status document');
    eq(L.parseStatus('{"a":1}').error, 'not a status document');
    eq(L.parseStatus('null').error, 'not a status document');
});

test('formatAgo', () => {
    eq(L.formatAgo(5), 'less than a minute ago');
    eq(L.formatAgo(60), '1 minute ago');
    eq(L.formatAgo(120), '2 minutes ago');
    eq(L.formatAgo(3600), '1 hour ago');
    eq(L.formatAgo(7300), '2 hours ago');
    eq(L.formatAgo(86400 * 3), '3 days ago');
    eq(L.formatAgo(-5), 'less than a minute ago');
});

test('sourceLabel', () => {
    eq(L.sourceLabel('musicbrainz'), 'MusicBrainz');
    eq(L.sourceLabel('lastfm'), 'Last.fm');
    eq(L.sourceLabel('cache'), 'cache');
    eq(L.sourceLabel('none'), '–');
    eq(L.sourceLabel(null), '');
    eq(L.sourceLabel('somethingnew'), 'somethingnew');
});

test('curvePoints maps +12 dB to the top, 0 to the middle, -12 to the bottom', () => {
    const p = L.curvePoints([12, 0, -12, 0, 0, 0, 0, 0, 0, 0]);
    near(p[0].x, 15.4);
    near(p[9].x, 15.4 + 9 * 30.8);
    near(p[0].y, 8);
    near(p[1].y, 40);
    near(p[2].y, 72);
});

test('curvePoints clamps and tolerates bad input', () => {
    near(L.curvePoints([99, 0, 0, 0, 0, 0, 0, 0, 0, 0])[0].y, 8);
    eq(L.curvePoints([]).length, 10);
    near(L.curvePoints(null)[3].y, 40);
    near(L.curvePoints(['x', 0, 0, 0, 0, 0, 0, 0, 0, 0])[0].y, 40);
});

test('no file means stopped', () => {
    const v = L.deriveView(null, NOW, alive);
    eq(v.state, 'stopped');
    eq(v.panel, {icon: 'off', label: 'Off', normalWeight: true, muted: true});
    eq(v.body, 'stopped');
    eq(v.profile, null);
});

test('clean shutdown and dead pid are both stopped', () => {
    eq(L.deriveView(doc({daemon: {state: 'stopped', pid: 42}}), NOW, alive).state, 'stopped');
    eq(L.deriveView(doc(), NOW, dead).state, 'stopped');
    eq(L.deriveView(doc({daemon: {state: 'running'}}), NOW, alive).state, 'stopped');
});

test('active track', () => {
    const v = L.deriveView(doc(), NOW, alive);
    eq(v.state, 'active');
    eq(v.panel, {icon: 'eq', label: 'Rock', normalWeight: false, muted: false});
    eq(v.header, {serviceText: 'Running', serviceOk: true, backendText: 'PulseEffects running', backendOk: true});
    eq(v.body, 'track');
    eq(v.track, {text: 'Placebo – This Picture', playing: true});
    eq(v.genres.chips.length, 3);
    eq(v.genres.source, 'MusicBrainz');
    eq(v.profile.caption, 'Applied profile');
    eq(v.profile.applied, 'applied 2 minutes ago');
    eq(v.profile.curveNote, 'Hz bands below');
    eq(v.profile.dashed, false);
    eq(v.banner, null);
});

test('paused keeps the profile and shows the track', () => {
    const v = L.deriveView(doc({playback: 'paused'}), NOW, alive);
    eq(v.state, 'paused');
    eq(v.track.playing, false);
    eq(v.panel.label, 'Rock');
});

test('idle shows Flat and the idle line', () => {
    const v = L.deriveView(doc({
        playback: 'idle', track: null, genres: [],
        profile: {name: 'Flat', applied_at: NOW - 840, gains_db: new Array(10).fill(0), in_effect: true},
    }), NOW, alive);
    eq(v.state, 'idle');
    eq(v.body, 'idle');
    eq(v.panel.label, 'Flat');
    eq(v.profile.applied, 'applied 14 minutes ago');
});

test('idle before any profile still says Flat', () => {
    const v = L.deriveView(doc({
        playback: 'idle', track: null, genres: [],
        profile: {name: null, applied_at: null, gains_db: [], in_effect: true},
    }), NOW, alive);
    eq(v.panel.label, 'Flat');
    eq(v.profile.name, '–');
    eq(v.profile.applied, 'not applied yet');
});

test('advertisement leaves the profile visible', () => {
    const v = L.deriveView(doc({playback: 'advertisement', track: {artist: '', title: 'Ad', kind: 'ad'}}), NOW, alive);
    eq(v.state, 'ad');
    eq(v.body, 'ad');
    eq(v.profile.name, 'Rock');
    eq(v.track, null);
});

test('backend error: warning icon, banner, last known profile, dashed curve', () => {
    const v = L.deriveView(doc({
        backend: {name: 'pulseeffects', ok: false, last_error: 'PulseEffects: D-Bus call timed out'},
        profile: {name: 'Rock', applied_at: NOW - 360, gains_db: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], in_effect: false},
    }), NOW, alive);
    eq(v.state, 'error');
    eq(v.panel, {icon: 'warn', label: 'Rock', normalWeight: true, muted: false});
    eq(v.header.backendText, 'PulseEffects not running');
    eq(v.header.backendOk, false);
    eq(v.banner, 'PulseEffects: D-Bus call timed out');
    eq(v.body, 'track');
    eq(v.profile.caption, 'Last known profile');
    eq(v.profile.applied, 'applied 6 minutes ago · not in effect');
    eq(v.profile.dashed, true);
    eq(v.profile.curveNote, 'not in effect');
    eq(v.profile.muted, true);
});

test('backend error before any profile or track', () => {
    const v = L.deriveView(doc({
        playback: 'idle', track: null, genres: [],
        profile: {name: null, applied_at: null, gains_db: [], in_effect: false},
        backend: {name: 'pulseeffects', ok: false, last_error: null},
    }), NOW, alive);
    eq(v.state, 'error');
    eq(v.panel.label, '–');
    eq(v.banner, 'The equalizer backend is not responding');
    eq(v.body, 'idle');
});

test('genre notes: lookup running and nothing found', () => {
    let v = L.deriveView(doc({genres: [], genre_source: null}), NOW, alive);
    eq(v.genres.note, 'Looking up…');
    v = L.deriveView(doc({genres: [], genre_source: 'none'}), NOW, alive);
    eq(v.genres.note, 'No genre found');
    eq(v.genres.source, '–');
});

test('at most five genre chips', () => {
    const v = L.deriveView(doc({genres: ['a', 'b', 'c', 'd', 'e', 'f', 'g']}), NOW, alive);
    eq(v.genres.chips.length, 5);
});

test('track text falls back when parts are missing', () => {
    eq(L.deriveView(doc({track: {artist: '', title: 'Only title', kind: 'local'}}), NOW, alive).track.text, 'Only title');
    eq(L.deriveView(doc({track: {artist: 'Only artist', title: '', kind: 'track'}}), NOW, alive).track.text, 'Only artist');
});

test('newer schema is reported, not misread', () => {
    const v = L.deriveView(doc({schema_version: 2}), NOW, alive);
    eq(v.state, 'unsupported');
    eq(v.panel.icon, 'warn');
    if (!v.banner.includes('newer'))
        throw new Error('banner should explain the problem');
});

test('viewsEqual', () => {
    eq(L.viewsEqual(L.deriveView(doc(), NOW, alive), L.deriveView(doc(), NOW, alive)), true);
    eq(L.viewsEqual(L.deriveView(doc(), NOW, alive), L.deriveView(doc({playback: 'paused'}), NOW, alive)), false);
});

print(`${passed} passed, ${failed} failed`);
imports.system.exit(failed ? 1 : 0);
