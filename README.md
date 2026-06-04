# Touchshell

<p align="center">
  <img src=".github/media/touchshell.svg" alt="Touchshell Logo" width="128" />
</p>

A GNOME Shell extension that makes GNOME feel more natural on touchscreen devices.

Touchshell adds the gestures, affordances, and chrome that GNOME assumes you have a trackpad and keyboard for — single-finger workspace switching, edge swipes for the system surfaces, a touch text-action bar, a Fullscreen Apps mode that opens windows maximized, an auto-hiding top panel, and a thin bottom action bar that stays reachable even over fullscreen apps.

- **Supported GNOME versions:** 49, 50
- **Session:** Wayland (Xorg is not supported)
- **UUID:** `touchshell@touchshell.com`
- **License:** GPL-2.0-or-later

> [!NOTE]
> <img width="200" height="auto" alt="friendly-manifesto-badge" src="https://github.com/user-attachments/assets/cb91210b-0f66-46fe-93a8-a3a67857593c" /> <br>
> This project voluntarily adheres to The Friendly Manifesto. Read more [here](https://friendlymanifesto.org)

---

## Table of contents

- [Installation](#installation)
- [Activation modes](#activation-modes-off--auto--always)
- [Features](#features)
  - [Edges](#edges)
  - [Workspaces](#workspaces)
  - [Overview](#overview)
  - [Windows](#windows)
  - [Touch helpers](#touch-helpers)
- [Development](#development)
- [Contributing](#contributing)
- [Acknowledgements](#acknowledgements)
- [License](#license)

---

## Installation

### From extensions.gnome.org (recommended)

[<img alt="Get it on GNOME Extensions" height="100" src=".github/media/get-it-on-ego.svg?sanitize=true">](https://extensions.gnome.org/extension/9164/status-tray/)

> Touchshell uses gestures that only work on a Wayland session. If you're on Xorg, switch sessions from the login screen first.

### Manual install (from this repo)

```bash
git clone https://github.com/keithvassallomt/touchshell.git
cd touchshell

# Build the extension zip
./scripts/pack.sh

# Install it for the current user
gnome-extensions install --force dist/touchshell@touchshell.com.shell-extension.zip

# Log out and back in (X11 users: log out; Wayland: log out — see "Reloading" below)
gnome-extensions enable touchshell@touchshell.com
```

### Live development install (symlink)

If you're hacking on Touchshell, point GNOME at the repo directly:

```bash
ln -s "$(pwd)" ~/.local/share/gnome-shell/extensions/touchshell@touchshell.com
```

Then compile the gsettings schema in place:

```bash
glib-compile-schemas schemas/
```

### Reloading after a code change

Touchshell is an ESM extension, and GNOME's `disable → enable` cycle **does not** re-evaluate ESM module bodies. To pick up a code change on Wayland you must **log out and log back in** (or restart the shell with `Alt+F2 → r` on Xorg, which Touchshell doesn't support but the principle is the same).

---

## Activation modes (Off / Auto / Always)

Almost every feature in Touchshell has a three-way activation toggle:

| Mode | Behavior |
| --- | --- |
| **Off** | The feature is disabled entirely. |
| **Auto** | The feature is active only when the system reports tablet mode (e.g. a convertible folded into tablet posture). |
| **Always** | The feature is active regardless of mode. |

Some features default to **Auto** (panel auto-hide, fullscreen apps, text-action FAB) and some to **Always** (most gestures). You can change every default from the preferences window.

---

## Features

### Edges

> Gestures that start at the very edge of the screen and reveal a system surface — Activities, Quick Settings, or Notifications.

#### Bottom edge → Overview

[bottom-edge.webm](https://github.com/user-attachments/assets/bb429f82-78d0-4574-bb98-21351d096f83)

Swipe up from the very bottom edge of the screen to open the Activities overview. The animation is 1:1 finger-tracked — pull part-way and let go to cancel.

**Options**
- **Activation** — Off / Auto / Always (default: **Always**).
- **Swipe distance** — percentage of screen height needed to commit one overview state change. Lower = snappier. This setting is shared with the vertical swipes inside the overview and with the desktop swipe-up. Range 30–100, default 60.

#### Top-right → Quick Settings

[top-right.webm](https://github.com/user-attachments/assets/d87cb8b3-42a0-429d-a940-c124145850da)

Swipe down from the top-right corner of the screen to open Quick Settings. Works over fullscreen apps too — the panel is unhidden for the duration of the menu so the popover anchors under the indicator instead of the top-left.

**Options**
- **Activation** — Off / Auto / Always (default: **Always**).
- **Trigger zone width** — percentage of screen width, measured from the right edge, that counts as the trigger zone. Range 5–50, default 33.

#### Top-center → Notifications

[top-center.webm](https://github.com/user-attachments/assets/a2291473-00f9-436b-988f-c6604dddeb9c)

Swipe down from the top-center to open the date menu (notifications and calendar).

**Options**
- **Activation** — Off / Auto / Always (default: **Always**).
- **Trigger zone width** — percentage of screen width, centered horizontally. Range 10–60, default 30.

---

### Workspaces

> Single-finger ways to move between workspaces — on the desktop, in the overview, and over fullscreen apps.

#### Desktop horizontal swipe

[desktop-workspace.webm](https://github.com/user-attachments/assets/1bad77c6-4a88-436a-83db-4504ec433ae1)

Single-finger horizontal swipe on any visible patch of the desktop background switches workspaces with 1:1 tracking. RTL locales flip direction automatically.

**Options**
- **Activation** — Off / Auto / Always (default: **Always**).

#### In-overview horizontal swipe

[overview-workspace.webm](https://github.com/user-attachments/assets/9f022be2-4f37-4342-bc05-b02368c00a02)

Single-finger horizontal swipe over the overview background switches workspaces, tracking the finger 1:1 like the native four-finger touchpad swipe.

**Options**
- **Activation** — Off / Auto / Always (default: **Always**).

#### Bottom action bar

[action-bar.webm](https://github.com/user-attachments/assets/cee2e7c8-3d61-4aed-a0b2-676f5f71155c)

A thin horizontal strip pinned to the bottom of the primary monitor. A horizontal swipe inside the strip switches workspaces, even over fullscreen apps where no other workspace-switch path is reachable. Taps pass through to the app underneath.

**Options**
- **Activation** — Off / Auto / Always (default: **Auto**).
- **Swipe distance** — percentage of screen width needed to commit one workspace switch. Lower = snappier. Range 30–100, default 62.
- **Hide the bar for** — a per-app exception list. Add desktop file IDs (e.g. `org.gnome.Calculator.desktop`) or raw WM_CLASS strings. Useful for games, presentations, or anything where an accidental edge swipe would be costly.

---

### Overview

> Gestures for opening the Activities overview and moving between its states (Windows view ↔ App Grid).

#### Desktop swipe up → Overview

[desktop-vertical.webm](https://github.com/user-attachments/assets/fc70e4ed-fe45-4e62-8d5c-b0f003b49518)

Single-finger upward swipe on the desktop background opens the overview, with the same 1:1 finger-tracked animation as the bottom-edge swipe. Sensitivity follows the Edges-page **Swipe distance**.

**Options**
- **Activation** — Off / Auto / Always (default: **Always**).

#### In-overview vertical swipe

[overview-vertical.webm](https://github.com/user-attachments/assets/cdcb8b95-ba9f-4350-aa13-88b8a5310c22)

Swipe up over the overview to reveal the app grid; swipe down to return to the windows view (or to the desktop).

**Options**
- **Activation** — Off / Auto / Always (default: **Always**).

#### Flick to close

[flick-to-close.webm](https://github.com/user-attachments/assets/29c585d4-ae1d-49b9-a2e7-b143fd890633)

Flick a window thumbnail upward in the overview to close that window.

**Options**
- **Activation** — Off / Auto / Always (default: **Always**).

---

### Windows

> How windows open and how the top panel behaves around them.

#### Fullscreen Apps mode

[fullscreen-apps.webm](https://github.com/user-attachments/assets/61e10dd2-e268-4159-80c3-4d741fb06e22)

Open new windows maximized by default (dialogs, popups, and child windows are excluded). A two-finger downward swipe inside a maximized window restores it — that's the escape hatch. The Quick Settings tile flips between **Off** and **Always**; **Auto** can only be set here.

**Options**
- **Activation** — Off / Auto / Always (default: **Auto**).
- **Excluded apps** — apps that should open at their default size instead of maximized. Add desktop file IDs or WM_CLASS strings.

#### Top panel auto-hide

[panel-auto-hide.webm](https://github.com/user-attachments/assets/8b836e54-68af-44a2-af8f-b2d09530578c)

Hides the top panel when a window is maximized. Reveals on top-edge proximity, during panel menu interactions, and stays visible while you use the menu.

**Options**
- **Activation** — Off / Auto / Always (default: **Auto**).

---

### Touch helpers

> Touch-specific affordances that make GNOME usable without a pointer or keyboard.

#### Swipe to dismiss notifications

[notif-dismiss.webm](https://github.com/user-attachments/assets/4ed8f661-dde3-4ff1-905f-a254bbc34dfe)

Two gestures, one toggle:
- Swipe **up** on a visible notification banner to dismiss it.
- Swipe **left** on a notification in the date-menu list to dismiss it.

**Options**
- **Activation** — Off / Auto / Always (default: **Always**).

#### Touch text-action FAB

[text-action-fab.webm](https://github.com/user-attachments/assets/4e335f8c-6e24-4fa6-9bcf-b14a7d488f13)

A floating action button that expands into a **Cut / Copy / Paste / Select All / Keyboard** bar. The action buttons synthesise `Ctrl+X`, `Ctrl+C`, `Ctrl+V`, `Ctrl+A` to the focused app, so it works wherever those shortcuts work — including GTK4 apps where touch text selection is otherwise unusable. The Keyboard item force-summons the on-screen keyboard.

You can drag the FAB anywhere on the primary monitor; its position is persisted. If you turn off **Always show the FAB**, you can summon the action bar with a three-finger tap anywhere on the screen instead.

**Options**
- **Activation** — Off / Auto / Always (default: **Auto**).
- **Always show the FAB** — when on (default), a translucent FAB lives in the corner; when off, only the three-finger tap summons the bar.

---

## Development

### Repo layout

```
extension.js         # entry point — wires the modules under lib/
prefs.js             # AdwPreferencesWindow shell; per-page builders under lib/prefs/
lib/                 # feature modules (one file per gesture / chrome / helper)
lib/prefs/           # per-page UI builders + shared widgets / demo media
schemas/             # gsettings schema XML
assets/icons/        # hicolor symbolic icons
demos/               # webm clips embedded in the README and prefs window
scripts/pack.sh      # build the EGO-ready zip
scripts/lint.sh      # run shexli against the zip
```

### Static analysis (shexli)

Every change must pass the GNOME extensions static analyser. One-time setup:

```bash
python3 -m venv venv
. venv/bin/activate
pip install -U shexli
```

To lint the exact ZIP that would be submitted to EGO:

```bash
./scripts/lint.sh
```

That script builds `dist/touchshell@touchshell.com.shell-extension.zip` via `gnome-extensions pack` and runs `shexli` against it. Output should end with `shexli: clean` before you push or open a PR.

### Editing the schema

After changing `schemas/org.gnome.shell.extensions.touchshell.gschema.xml`:

```bash
glib-compile-schemas schemas/
```

### Reloading

ESM module bodies are not re-evaluated by `gnome-extensions disable && enable`. After a code change, **log out and log back in** to pick it up. (Xorg sessions can do `Alt+F2 → r`, but Touchshell targets Wayland.)

---

## Contributing

Contributions are welcome. A few ground rules:

1. **Lint clean.** `./scripts/lint.sh` must report `shexli: clean` before opening a PR.
2. **One feature per PR.** Easier to review, easier to revert if something regresses.
3. **No new top-level deps.** Touchshell stays as a vanilla ESM GNOME extension — no npm, no bundlers, no transpilation.
4. **Touch-test it.** If you're adding or changing a gesture, test on an actual touchscreen (or a touchscreen-emulator). Trackpad-only testing has historically missed bugs that only surface under real touch event routing.
5. **Activation modes for new features.** If you add a feature, give it an activation gsetting (`off` / `auto` / `always`) and a Tablet-mode-aware default. Consistency matters.
6. **Open an issue first** for anything bigger than a small fix — happy to talk through the approach before you spend time on it.

Bug reports should include:
- GNOME Shell version (`gnome-shell --version`)
- Session type (Wayland — Touchshell does not support Xorg)
- Hardware (touchscreen model / convertible chassis if relevant)
- Steps to reproduce, and what you expected vs. what happened

---

## Acknowledgements

Like any open-source project, Touchshell stands on the shoulders of giants. Mainly:

- [TouchUp](https://github.com/mityax/gnome-extension-touchup) — main source of inspiration and the O.G. touch extension for GNOME.
- [Disable Unredirect](https://github.com/kazysmaster/gnome-shell-extension-disable-unredirect) — disables some questionable defaults for how GNOME handles full-screen apps. Simple, but a gem.
- [Hide Top Bar](https://gitlab.gnome.org/tuxor1337/hidetopbar) — hides the GNOME top bar, done right.

---

## License

GPL-2.0-or-later. See [`LICENSE`](LICENSE).
