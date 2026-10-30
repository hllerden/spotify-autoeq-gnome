# Contributing

The extension is split in two files on purpose:

- `logic.js` decides what to show from the status document. It imports nothing
  from the Shell, so it is covered by `make test` (plain `gjs`).
- `extension.js` only builds widgets and wires events.

Keep new behaviour in `logic.js` with a test where possible.

Supporting another GNOME Shell version means checking the `St`, `PopupMenu` and
`PanelMenu` APIs for that version (GNOME 45 and later also moved extensions to
ES modules) and listing the version in `metadata.json` only after trying it on
that version. Pull requests for 43, 44 and 45+ are welcome.

Use conventional commit messages (`feat:`, `fix:`, `docs:`, `test:`, ...).
