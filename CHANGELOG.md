# Changelog

## 1.0 - 2026-10-30

First release.

- Panel button with the equalizer icon and the applied profile name in a fixed
  width slot; muted "Off" when the service is stopped, warning icon when the
  equalizer backend fails.
- Popup with service and backend state, error banner, now playing (with
  playing or paused), genres and their source, applied profile, a ten-band
  curve, links to the log and the configuration file, and a link to the
  project page.
- Follows the light or dark look of the shell theme.
- Reads the status file of spotify-autoeq 1.1 or newer; event driven through a
  file monitor, no polling of the file contents.
- Supports GNOME Shell 42.
