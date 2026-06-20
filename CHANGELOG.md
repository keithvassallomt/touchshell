# Changelog

All notable changes to Touchshell are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **Preferences freeze on machines without hardware video decode** — opening preferences built every page up front and started all bundled demo videos playing at once, so all ~13 streams decoded simultaneously and could pin the CPU and freeze the prefs window (reproducible on hardware with no VAAPI/v4l2 decoder, such as the Surface Pro 11). Demo playback is now gated on each card's `map`/`unmap`, so only the visible tab's demos decode. Thanks to [@ayifahmi](https://github.com/ayifahmi) ([#1](https://github.com/keithvassallomt/touchshell/pull/1)).

## [1.0] — 2026-05-14

Initial public release. Supports GNOME Shell 49 and 50 on Wayland.

### Edges

- **Bottom edge → Overview** — swipe up from the bottom edge to open the Activities overview, with 1:1 finger-tracked animation.
- **Top-right → Quick Settings** — swipe down from the top-right corner to open Quick Settings, including over fullscreen apps.
- **Top-center → Notifications** — swipe down from the top-center to open the date menu (notifications and calendar).

### Workspaces

- **Desktop horizontal swipe** — single-finger horizontal swipe on the desktop switches workspaces with 1:1 tracking; RTL-aware.
- **In-overview horizontal swipe** — single-finger horizontal swipe over the overview switches workspaces.
- **Bottom action bar** — a thin strip pinned to the bottom of the primary monitor for workspace-switching over fullscreen apps, with a per-app hide list.

### Overview

- **Desktop swipe up → Overview** — single-finger upward swipe on the desktop opens the overview.
- **In-overview vertical swipe** — swipe up to reveal the app grid; swipe down to return to the windows view (or to the desktop).
- **Flick to close** — flick a window thumbnail upward in the overview to close that window.

### Windows

- **Fullscreen Apps mode** — open new windows maximized by default, with a two-finger downward swipe escape hatch and a per-app exclusion list.
- **Top panel auto-hide** — hides the top panel when a window is maximized; reveals on top-edge proximity and during panel menu interactions.

### Touch helpers

- **Swipe to dismiss notifications** — swipe up on a banner or left on a list item in the date menu to dismiss.
- **Touch text-action FAB** — floating action button that expands into a Cut / Copy / Paste / Select All / Keyboard bar, working in any app that responds to the standard shortcuts. Draggable and position-persisted, with an optional three-finger-tap summon mode.

### Activation modes

- Every feature has a three-way activation toggle: **Off**, **Auto** (active only in tablet mode), or **Always** (active regardless of mode), with sensible per-feature defaults.

[Unreleased]: https://github.com/keithvassallomt/touchshell/compare/v1.0...main
[1.0]: https://github.com/keithvassallomt/touchshell/releases/tag/v1.0
