# Spotify AutoEQ Status

[Türkçe README](https://github.com/hllerden/spotify-autoeq-gnome/blob/main/README.tr.md)

[![CI](https://github.com/hllerden/spotify-autoeq-gnome/actions/workflows/ci.yml/badge.svg)](https://github.com/hllerden/spotify-autoeq-gnome/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/hllerden/spotify-autoeq-gnome/blob/main/LICENSE)

A GNOME Shell panel indicator for [spotify-autoeq](https://github.com/hllerden/spotify-autoeq),
the service that switches your equalizer by the genre of the song playing in
Spotify. The indicator is read-only: it shows which profile is applied, why,
and whether everything is healthy.

![Panel button](https://raw.githubusercontent.com/hllerden/spotify-autoeq-gnome/main/docs/screenshots/panel-active.png)

| Playing | Backend failing | Service stopped |
|---|---|---|
| ![Popup while playing](https://raw.githubusercontent.com/hllerden/spotify-autoeq-gnome/main/docs/screenshots/popup-active.png) | ![Popup with an error](https://raw.githubusercontent.com/hllerden/spotify-autoeq-gnome/main/docs/screenshots/popup-error.png) | ![Popup when stopped](https://raw.githubusercontent.com/hllerden/spotify-autoeq-gnome/main/docs/screenshots/popup-stopped.png) |

## What it shows

- **Panel button:** an equalizer icon and the profile name (`Rock`, `Pop`, ...)
  in a fixed-width slot, so neighbouring items never move. When the service is
  stopped the button is muted and says `Off`; when the equalizer backend fails
  it shows a warning icon.
- **Popup:** service and backend state, the current track with playing or
  paused, the genres found for the artist and where they came from, the applied
  profile with the time it was applied, and a ten-band curve of the equalizer.
  An error banner appears when the backend is failing, and the curve turns
  dashed to say the profile is not in effect.
- **Links:** open the service log, open the configuration file, and the project
  page.

State is conveyed by shape and text as well as colour, and the popup follows
the light or dark look of your shell theme.

## Requirements

- GNOME Shell **42** (Ubuntu 22.04). Other versions are not supported yet, see
  below.
- [spotify-autoeq](https://github.com/hllerden/spotify-autoeq) **1.1 or newer**,
  which writes the status file the indicator reads.

## Install

From a release zip:

```
gnome-extensions install --force spotify-autoeq-status@hllerden.github.io.zip
gnome-extensions enable spotify-autoeq-status@hllerden.github.io
```

From a source checkout:

```
make install
gnome-extensions enable spotify-autoeq-status@hllerden.github.io
```

On X11 press `Alt+F2`, type `r` and Enter to reload the shell after the first
install; on Wayland log out and back in. Remove it with `make uninstall` or
`gnome-extensions uninstall spotify-autoeq-status@hllerden.github.io`.

If the button says `Off`, the spotify-autoeq service is not running: start it
with `spotify-autoeq service install` (see the project page).

## How it works

spotify-autoeq rewrites `$XDG_RUNTIME_DIR/spotify-autoeq/status.json` whenever
something changes. The extension watches that directory with a file monitor and
redraws on every change. A five second check notices a service that died without
saying goodbye. The format is a documented, versioned contract:
[status-file.md](https://github.com/hllerden/spotify-autoeq/blob/main/docs/status-file.md).

## Supported GNOME versions

Developed and tested on GNOME Shell 42.9 (Ubuntu 22.04): all states were
exercised in an isolated shell session, and the logic has unit tests. GNOME 43
and 44 changed parts of the shell API, and GNOME 45 and later require ES module
extensions, so each needs its own port; they are deliberately not listed in
`metadata.json` until someone has tried them. Contributions are welcome, see
[CONTRIBUTING.md](https://github.com/hllerden/spotify-autoeq-gnome/blob/main/CONTRIBUTING.md).

## Development

```
make test     # logic tests with plain gjs
make pack     # tests, then dist/<uuid>.zip
```

## License

MIT, see [LICENSE](https://github.com/hllerden/spotify-autoeq-gnome/blob/main/LICENSE).
