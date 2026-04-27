# touchshell

A GNOME Shell extension that makes GNOME feel more like iPadOS on touchscreen devices.

## Core Features

- **Edge gestures** — swipe up from the bottom for the Activities overview, down from the top-right for Quick Settings, down from the top-center for Notifications.
- **Single-finger workspace switching** — horizontal swipe on the desktop background, or on a thin bottom action bar that stays reachable even over fullscreen apps.
- **Single-finger overview navigation** — swipe up from anywhere on the desktop to open the overview; swipe vertically inside it to flip between Windows view and the App Grid.
- **Touch text actions** — a draggable Cut / Copy / Paste / Select All bar for touch users, summoned by a corner FAB or a three-finger tap.
- **Fullscreen Apps mode** — new windows open maximized by default; per-app exceptions; two-finger swipe down to escape.
- **Auto-hiding top panel** — hides when a window is maximized; reveals on top-edge proximity or a top-right swipe.
- **Flick to close, swipe to dismiss** — flick a window thumbnail upward in the overview to close it; swipe a notification banner up or a list entry left to dismiss it.
- **Tablet-mode aware** — every gesture can be set Off / Auto / Always (Auto = active only in tablet mode).

## Acknowledgements

Like any open-source project, TouchShell stands on the shoulders of giants. Mainly:

- [TouchUp](https://github.com/mityax/gnome-extension-touchup). Main source of inspiration for this extension and the O.G. touch extension for GNOME.
- [Disable Unredirect](https://github.com/kazysmaster/gnome-shell-extension-disable-unredirect). Disables some questionable defaults for how GNOME handles full-screen apps. Simple, but a gem.
- [Hide Top Bar](https://gitlab.gnome.org/tuxor1337/hidetopbar). Hides the GNOME top bar - done right.

## Status

Active development.

## Supported GNOME versions

- GNOME 49
- GNOME 50

## Development

The repo is set up to run as a live, in-place extension via a symlink:

```
~/.local/share/gnome-shell/extensions/touchshell@touchshell.com
    -> /path/to/this/repo
```

### Static analysis (shexli)

Every change must pass the GNOME extensions static analyser. One-time setup:

```
python3 -m venv venv
. venv/bin/activate
pip install -U shexli
```

To lint the exact ZIP that would be submitted to EGO:

```
./scripts/lint.sh
```

That script builds `dist/touchshell@touchshell.com.shell-extension.zip` via
`gnome-extensions pack` and runs `shexli` against it.

## License

GPL-2.0-or-later. See `LICENSE`.
