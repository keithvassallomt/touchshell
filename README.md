# touchshell

A GNOME Shell extension that makes GNOME feel more like iPadOS on touchscreen devices.

## Status

Early development. First feature in progress: swipe from top-right edge to open Quick Settings.

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
