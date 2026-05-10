import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { ActivationBinding } from './activation.js';
import { WorkspaceSwitchDriver } from './workspaceSwitchDriver.js';

// Bar geometry, in logical (pre-scale-factor) pixels.
const BAR_HEIGHT_PX = 22;
const PILL_HEIGHT_PX = 5;
const PILL_MIN_WIDTH_PX = 70;
const PILL_MAX_WIDTH_PX = 330;
const PILL_WIDTH_FRACTION = 0.25;

// Begin-driver threshold in stage px. Same calibration as the desktop
// horizontal swipe so a tap on the bar doesn't kick off a workspace
// commit.
const BEGIN_THRESHOLD_PX = 4;

// Pill fade animation when the bar enters/leaves a "no pill" state
// (fullscreen, overview, app exception).
const PILL_FADE_MS = 180;

// Background fill cross-fade. Slightly longer than the pill fade so a
// bar going visible-with-window matches the eye's reading time.
const FILL_FADE_MS = 220;

// Debounce window between window position/size signals and the
// brightness re-sample. The position-changed signal fires per-frame
// during a window drag; we don't need to sample on every tick.
const SAMPLE_DEBOUNCE_MS = 60;

const ACTION_NAME = 'touchshell-action-bar';

// Pick-transparent St.Widget. global.stage routes a touch's pick to
// the topmost reactive actor at the touch coords, but our gesture is
// attached to global.stage itself, so the *actor* never needs to be
// pickable. Returning nothing from vfunc_pick guarantees taps fall
// through to the window beneath even if some other code path picks
// against our actor.
const PassthroughBar = GObject.registerClass(
class PassthroughBar extends St.Widget {
    vfunc_pick(_pickContext) {
        // Intentionally empty.
    }
});

// Bottom action bar — a thin always-on-top surface anchored to the
// bottom of the primary monitor. Its single purpose is to capture
// horizontal swipes and drive 1:1 workspace switching, including over
// fullscreen apps where the desktop-background swipe and the overview
// can't reach.
//
// Architecture mirrors touchup's GestureNavigationBar in shape (chrome
// actor + CAPTURE-phase PanGesture on global.stage) but is tighter in
// scope: X-axis only, so it coexists with our existing bottom-edge
// upward swipe (overview) without zone juggling — Clutter's gesture
// arbitration falls out cleanly because the two PanGestures recognize
// on different motion axes.
export class ActionBar {
    constructor(settings, tabletMode) {
        this._settings = settings;

        this._actor = null;
        this._background = null;
        this._pill = null;
        this._gesture = null;
        this._driver = null;

        this._focusWindow = null;
        this._focusWindowSignals = [];
        this._exceptions = [];
        this._exceptionMatch = false;
        this._fullscreen = false;
        this._inOverview = Main.overview.visible;

        // Window-near tracking: any visible window on the active
        // workspace + primary monitor whose bottom edge meets or
        // exceeds the bar's top counts as "near". When near, the bar
        // fills with the theme colour. When not (i.e. the desktop is
        // showing through), it stays transparent.
        this._isWindowNear = false;
        this._trackedWindows = new Map();
        this._nearCheckSourceId = 0;
        this._chromeAdded = false;

        this._beganDriver = false;

        this._currentBrightness = null;
        this._sampleSourceId = 0;
        this._inFlightSampleEpoch = 0;

        this._globalSignals = [];
        this._settingsSignals = [];
        this._themeSignal = 0;
        this._desktopSettings = null;
        this._desktopSignal = 0;
        this._isDarkTheme = true;

        this._activation = new ActivationBinding(
            settings, tabletMode, 'action-bar-activation',
            {
                onEnable: () => this._setup(),
                onDisable: () => this._teardown(),
            }
        );
    }

    destroy() {
        this._activation?.destroy();
        this._activation = null;
        this._settings = null;
    }

    _setup() {
        this._exceptions = this._settings.get_strv('action-bar-exceptions');

        this._buildActor();
        this._addToChrome();
        // Position/size after chrome insertion so the strut region is
        // computed against the final geometry. Touchup follows the same
        // order in BaseNavigationBar.show().
        this._reallocate();
        this._buildGesture();
        this._setupWindowTracking();

        this._driver = new WorkspaceSwitchDriver({
            controller: () => Main.wm?._workspaceAnimation,
            canStart: () =>
                !Main.overview.visible && !Main.overview.animationInProgress,
            // User-tunable per-step distance, in percent of monitor width.
            // Default (62) matches a touchup-equivalent feel.
            distanceFactor:
                this._settings.get_int('action-bar-distance-percent') / 100,
        });

        this._hookKeyboardBox();

        // _connectSignals tail-calls _focusWindowChanged → _evaluate, so
        // initial state is set there.
        this._connectSignals();
    }

    _teardown() {
        this._driver?.cancel();
        this._driver = null;

        if (this._sampleSourceId) {
            GLib.source_remove(this._sampleSourceId);
            this._sampleSourceId = 0;
        }
        this._inFlightSampleEpoch++;

        if (this._nearCheckSourceId) {
            GLib.source_remove(this._nearCheckSourceId);
            this._nearCheckSourceId = 0;
        }
        this._teardownWindowTracking();

        for (const [obj, id] of this._globalSignals) {
            try { obj.disconnect(id); } catch (_) {}
        }
        this._globalSignals = [];

        for (const id of this._settingsSignals) {
            try { this._settings.disconnect(id); } catch (_) {}
        }
        this._settingsSignals = [];

        if (this._themeSignal) {
            try {
                St.ThemeContext.get_for_stage(global.stage)
                    .disconnect(this._themeSignal);
            } catch (_) {}
            this._themeSignal = 0;
        }

        if (this._desktopSignal) {
            try { this._desktopSettings.disconnect(this._desktopSignal); }
            catch (_) {}
            this._desktopSignal = 0;
        }
        this._desktopSettings = null;

        this._disconnectFocusWindow();

        this._unhookKeyboardBox();

        if (this._gesture) {
            try { global.stage.remove_action(this._gesture); } catch (_) {}
            this._gesture = null;
        }

        if (this._actor) {
            this._removeFromChrome();
            try { this._actor.destroy(); } catch (_) {}
            this._actor = null;
            this._background = null;
            this._pill = null;
        }

        this._beganDriver = false;
        this._isWindowNear = false;
        this._currentBrightness = null;
    }

    _buildActor() {
        const actor = new PassthroughBar({
            name: 'touchshell-actionbar',
            style_class: 'touchshell-actionbar',
            reactive: false,
            layout_manager: new Clutter.BinLayout(),
        });
        // Belt-and-braces: edge-gesture base looks for this marker so
        // it never claims sequences over our overlays. Our gesture is
        // on global.stage and the actor isn't pickable, so this is
        // mostly defensive — but it's the project convention (see
        // project_overlay_marker.md).
        actor._touchshellOverlay = true;

        // Background lives as a separate actor so we can fade it
        // independently of the pill. Its CSS sets the theme-aware fill
        // colour; opacity is the fill toggle. This lets fullscreen ↔
        // windowed transitions cross-fade smoothly instead of flipping
        // a class instantly (and racing stale frame_rect geometry).
        const background = new St.Widget({
            style_class: 'touchshell-actionbar__bg',
            x_align: Clutter.ActorAlign.FILL,
            y_align: Clutter.ActorAlign.FILL,
            x_expand: true,
            y_expand: true,
            opacity: 0,
        });
        actor.add_child(background);

        const pill = new St.Widget({
            style_class: 'touchshell-actionbar__pill',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            opacity: 255,
        });
        actor.add_child(pill);

        this._actor = actor;
        this._background = background;
        this._pill = pill;
    }

    _scaleFactor() {
        return St.ThemeContext.get_for_stage(global.stage).scale_factor;
    }

    _monitor() {
        return Main.layoutManager.monitors[Main.layoutManager.primaryIndex]
            ?? null;
    }

    _barHeightPx() {
        return Math.round(BAR_HEIGHT_PX * this._scaleFactor());
    }

    _reallocate() {
        if (!this._actor) return;
        const monitor = this._monitor();
        if (!monitor) return;
        const sf = this._scaleFactor();
        const h = this._barHeightPx();
        this._actor.set_size(monitor.width, h);
        this._actor.set_position(
            monitor.x, monitor.y + monitor.height - h);

        if (this._pill) {
            const targetW = Math.max(
                PILL_MIN_WIDTH_PX * sf,
                Math.min(PILL_MAX_WIDTH_PX * sf,
                    monitor.width * PILL_WIDTH_FRACTION)
            );
            this._pill.set_size(
                Math.round(targetW), Math.round(PILL_HEIGHT_PX * sf));
        }
    }

    _addToChrome() {
        if (!this._actor) return;
        if (this._chromeAdded) return;
        // affectsStruts: true — the bar always reserves 22 logical px at
        // the bottom of the work area. Non-fullscreen windows can't sit
        // under it; fullscreen apps (which ignore struts) still cover the
        // whole monitor, but the bar's touch zone stays live above them
        // because trackFullscreen is false.
        Main.layoutManager.addTopChrome(this._actor, {
            affectsStruts: true,
            trackFullscreen: false,
        });
        this._chromeAdded = true;
        this._applyKeyboardOffset();
    }

    _removeFromChrome() {
        if (!this._actor) return;
        if (!this._chromeAdded) return;
        try {
            Main.layoutManager.removeChrome(this._actor);
        } catch (_) {
            // Already removed, or never added — both fine.
        }
        this._chromeAdded = false;
        this._applyKeyboardOffset();
    }

    // GNOME's OSK (Main.layoutManager.keyboardBox) anchors to the
    // monitor bottom and ignores struts, so our affectsStruts:true bar
    // would occlude its lower 22 px. Lift the OSK by translation_y —
    // a render-only shift that doesn't fight GNOME's slide-in/out
    // tween on y. Touch input picks against transformed bounds so the
    // keyboard remains usable above the bar.
    _hookKeyboardBox() {
        const kb = Main.layoutManager.keyboardBox;
        if (!kb || this._kbVisibleId) return;
        this._kbVisibleId = kb.connect('notify::visible',
            () => this._applyKeyboardOffset());
        this._applyKeyboardOffset();
    }

    _unhookKeyboardBox() {
        const kb = Main.layoutManager.keyboardBox;
        if (kb && this._kbVisibleId) {
            try { kb.disconnect(this._kbVisibleId); } catch (_) {}
            if (kb.translation_y !== 0)
                kb.translation_y = 0;
        }
        this._kbVisibleId = 0;
    }

    _applyKeyboardOffset() {
        const kb = Main.layoutManager.keyboardBox;
        if (!kb) return;
        let offset = 0;
        if (kb.visible && this._chromeAdded) {
            const kbMon = Main.layoutManager.keyboardMonitor;
            const barMon = this._monitor();
            if (kbMon && barMon && kbMon.index === barMon.index)
                offset = -this._barHeightPx();
        }
        if (kb.translation_y !== offset)
            kb.translation_y = offset;
    }

    _buildGesture() {
        // PanAxis.X means the gesture only recognizes when motion is
        // dominantly horizontal. A vertical (upward) swipe inside the
        // bar zone never recognizes here, so the existing bottom-edge
        // overview gesture in BottomEdgeSwipeGesture keeps working —
        // no zone arbitration code required.
        this._gesture = new Clutter.PanGesture({
            min_n_points: 1,
            max_n_points: 1,
            pan_axis: Clutter.PanAxis.X,
        });
        this._gesture.connect('should-handle-sequence',
            (_g, event) => this._shouldHandleSequence(event));
        this._gesture.connect('recognize', _g => {
            this._beganDriver = false;
        });
        this._gesture.connect('pan-update', g => this._onUpdate(g));
        this._gesture.connect('end', g => this._onEnd(g));
        this._gesture.connect('cancel', _g => this._onCancel());

        global.stage.add_action_full(
            ACTION_NAME, Clutter.EventPhase.CAPTURE, this._gesture);
    }

    _shouldHandleSequence(event) {
        if (!this._actor) return false;
        if (this._inOverview) return false;
        if (this._exceptionMatch) return false;
        const monitor = this._monitor();
        if (!monitor) return false;
        const [x, y] = event.get_coords();
        if (x < monitor.x || x >= monitor.x + monitor.width)
            return false;
        return y > monitor.y + monitor.height - this._barHeightPx();
    }

    _onUpdate(g) {
        const dx = g.get_accumulated_delta().get_x();
        if (!this._beganDriver) {
            if (Math.abs(dx) < BEGIN_THRESHOLD_PX) return;
            if (!this._driver?.begin()) return;
            this._beganDriver = true;
        }
        this._driver.update(dx);
    }

    _onEnd(g) {
        if (!this._beganDriver) return;
        const v = g.get_velocity?.();
        const vx = v?.get_x?.() ?? 0;
        this._driver.end(vx);
        this._beganDriver = false;
    }

    _onCancel() {
        if (!this._beganDriver) return;
        this._driver?.cancel();
        this._beganDriver = false;
    }

    _connectSignals() {
        this._globalSignals.push([
            global.display,
            global.display.connect('notify::focus-window',
                () => this._focusWindowChanged()),
        ]);
        this._globalSignals.push([
            Main.overview,
            Main.overview.connect('showing', () => {
                this._inOverview = true;
                this._evaluate();
            }),
        ]);
        this._globalSignals.push([
            Main.overview,
            Main.overview.connect('hidden', () => {
                this._inOverview = false;
                this._evaluate();
            }),
        ]);
        const mm = global.backend.get_monitor_manager();
        this._globalSignals.push([
            mm,
            mm.connect('monitors-changed', () => {
                this._reallocate();
                this._evaluate();
            }),
        ]);

        const themeContext = St.ThemeContext.get_for_stage(global.stage);
        this._themeSignal = themeContext.connect('changed', () => {
            this._refreshThemeClasses();
            this._scheduleSample();
        });

        this._desktopSettings = new Gio.Settings({
            schema_id: 'org.gnome.desktop.interface',
        });
        this._desktopSignal = this._desktopSettings.connect(
            'changed::color-scheme', () => {
                this._refreshThemeClasses();
                this._scheduleSample();
            });
        this._refreshThemeClasses();

        this._settingsSignals.push(
            this._settings.connect('changed::action-bar-exceptions', () => {
                this._exceptions =
                    this._settings.get_strv('action-bar-exceptions');
                this._evaluate();
            }));
        this._settingsSignals.push(
            this._settings.connect(
                'changed::action-bar-distance-percent', () => {
                    this._driver?.setDistanceFactor(
                        this._settings.get_int(
                            'action-bar-distance-percent') / 100);
                }));

        this._focusWindowChanged();
    }

    _disconnectFocusWindow() {
        for (const id of this._focusWindowSignals) {
            try { this._focusWindow?.disconnect(id); } catch (_) {}
        }
        this._focusWindowSignals = [];
        this._focusWindow = null;
    }

    _focusWindowChanged() {
        this._disconnectFocusWindow();
        const win = global.display.focus_window;
        if (win) {
            this._focusWindow = win;
            this._focusWindowSignals = [
                win.connect('notify::fullscreen', () => this._evaluate()),
                win.connect('size-changed',
                    () => this._scheduleSample()),
                win.connect('position-changed',
                    () => this._scheduleSample()),
            ];
        }
        this._evaluate();
    }

    _evaluate() {
        if (!this._actor || !this._pill) return;

        const win = this._focusWindow;
        this._exceptionMatch =
            this._exceptions.length > 0 && this._appIds(win)
                .some(id => this._exceptions.includes(id));

        const prevFullscreen = this._fullscreen;
        this._fullscreen = !!win?.is_fullscreen?.();
        const leftFullscreen = prevFullscreen && !this._fullscreen;

        // For excepted apps, pull the chrome entirely — no reserved
        // struts, no draw, no touch zone. Re-add as soon as focus moves
        // away to a non-excepted app. Non-exception path is idempotent
        // via _chromeAdded.
        if (this._exceptionMatch) {
            this._removeFromChrome();
        } else {
            this._addToChrome();
            this._reallocate();
        }

        const showPill =
            !this._exceptionMatch && !this._fullscreen && !this._inOverview;
        this._setPillVisible(showPill);

        // When the window just left fullscreen, its frame_rect is still
        // the fullscreen geometry until size-changed fires (typically a
        // few frames later). Recomputing fill now would briefly flash
        // the bar opaque before the fresh near-state arrives. Defer to
        // the near-check; that path will call _refreshFill once geometry
        // has settled. For all other transitions we update immediately.
        if (leftFullscreen) {
            this._scheduleNearCheck();
        } else {
            this._refreshFill();
        }

        this._scheduleSample();
    }

    _setupWindowTracking() {
        this._globalSignals.push([
            global.window_manager,
            global.window_manager.connect('size-change',
                () => this._scheduleNearCheck()),
        ]);
        this._globalSignals.push([
            global.display,
            global.display.connect('window-created', (_d, win) => {
                this._trackWindow(win);
                this._scheduleNearCheck();
            }),
        ]);
        // Workspace changes alter the visible window set.
        this._globalSignals.push([
            global.workspace_manager,
            global.workspace_manager.connect('active-workspace-changed',
                () => {
                    this._retrackWindows();
                    this._scheduleNearCheck();
                }),
        ]);
        this._retrackWindows();
        this._scheduleNearCheck();
    }

    _teardownWindowTracking() {
        for (const [win, ids] of this._trackedWindows) {
            for (const id of ids) {
                try { win.disconnect(id); } catch (_) {}
            }
        }
        this._trackedWindows.clear();
    }

    _retrackWindows() {
        for (const [win, ids] of this._trackedWindows) {
            for (const id of ids) {
                try { win.disconnect(id); } catch (_) {}
            }
        }
        this._trackedWindows.clear();
        const ws = global.workspace_manager?.get_active_workspace?.();
        if (!ws) return;
        for (const win of ws.list_windows()) {
            this._trackWindow(win);
        }
    }

    _trackWindow(win) {
        if (this._trackedWindows.has(win)) return;
        const ids = [
            win.connect('position-changed',
                () => this._scheduleNearCheck()),
            win.connect('size-changed',
                () => this._scheduleNearCheck()),
            win.connect('notify::minimized',
                () => this._scheduleNearCheck()),
            win.connect('unmanaged',
                () => this._untrackWindow(win)),
        ];
        this._trackedWindows.set(win, ids);
    }

    _untrackWindow(win) {
        const ids = this._trackedWindows.get(win);
        if (!ids) return;
        for (const id of ids) {
            try { win.disconnect(id); } catch (_) {}
        }
        this._trackedWindows.delete(win);
        this._scheduleNearCheck();
    }

    _scheduleNearCheck() {
        if (this._nearCheckSourceId) return;
        this._nearCheckSourceId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT_IDLE, 50, () => {
                this._nearCheckSourceId = 0;
                this._evaluateWindowNear();
                return GLib.SOURCE_REMOVE;
            });
    }

    _evaluateWindowNear() {
        if (!this._actor) return;
        const monitor = this._monitor();
        if (!monitor) {
            this._isWindowNear = false;
            this._refreshFill();
            return;
        }
        const barTopY = monitor.y + monitor.height - this._barHeightPx();
        const primaryIdx = Main.layoutManager.primaryIndex;

        let near = false;
        const ws = global.workspace_manager?.get_active_workspace?.();
        if (ws) {
            for (const win of ws.list_windows()) {
                if (win.minimized) continue;
                if (win.get_monitor?.() !== primaryIdx) continue;
                const f = win.get_frame_rect?.();
                if (!f) continue;
                if (f.y + f.height >= barTopY) {
                    near = true;
                    break;
                }
            }
        }
        this._isWindowNear = near;
        // Always call _refreshFill — _evaluate defers fill recompute on
        // fullscreen exit and relies on this path to commit the state
        // even if `near` didn't actually flip.
        this._refreshFill();
    }

    _setPillVisible(show) {
        if (!this._pill) return;
        const target = show ? 255 : 0;
        if (this._pill.opacity === target) return;
        this._pill.ease({
            opacity: target,
            duration: PILL_FADE_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    _scheduleSample() {
        if (this._sampleSourceId) {
            GLib.source_remove(this._sampleSourceId);
            this._sampleSourceId = 0;
        }
        this._sampleSourceId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT_IDLE, SAMPLE_DEBOUNCE_MS, () => {
                this._sampleSourceId = 0;
                this._updatePillBrightness();
                return GLib.SOURCE_REMOVE;
            });
    }

    _updatePillBrightness() {
        if (!this._actor || !this._pill) return;
        if (this._exceptionMatch || this._fullscreen || this._inOverview) {
            // Pill not drawn — no need to sample. When it next becomes
            // visible, a fresh focus/move/show event will re-trigger
            // sampling.
            return;
        }

        const monitor = this._monitor();
        if (!monitor) return;

        const win = this._focusWindow;
        const frame = win?.get_frame_rect?.();
        const pillTopY =
            monitor.y + monitor.height - this._barHeightPx();
        const overlap = !!frame && (frame.y + frame.height) > pillTopY;

        if (overlap) {
            // Sample the pixel just above the pill once per transition
            // (focus change / move / resize). Touchup polls every 500ms;
            // we only sample when something has actually changed, which
            // covers the same cases at much lower CPU.
            this._sampleAtPillCentre();
        } else {
            this._applyBrightness(this._themeBrightness());
        }
    }

    _themeBrightness() {
        // Pill colour contrasts with the shell theme. We can't read the
        // shell stylesheet directly (the bar's own CSS bg is transparent,
        // so its theme node bg gives us nothing), so we fall back to the
        // user's color-scheme preference, which is the same signal Adw
        // and modern apps use to decide light vs dark.
        return this._isDarkTheme ? 'light' : 'dark';
    }

    _detectDarkTheme() {
        try {
            const cs = this._desktopSettings?.get_string?.('color-scheme');
            return cs === 'prefer-dark';
        } catch (_) { return true; }
    }

    // Apply theme-darkness CSS classes. Fill state is independent and
    // animated separately by _refreshFill.
    // - touchshell-actionbar--theme-dark on the background actor flips
    //   its CSS background colour to the dark variant.
    _refreshThemeClasses() {
        if (!this._actor || !this._background) return;
        this._isDarkTheme = this._detectDarkTheme();

        if (this._isDarkTheme) {
            this._background.add_style_class_name(
                'touchshell-actionbar--theme-dark');
        } else {
            this._background.remove_style_class_name(
                'touchshell-actionbar--theme-dark');
        }

        // Apply theme-derived pill colour as the initial value. Once a
        // screenshot sample has run, _updatePillBrightness owns updates;
        // a theme change still schedules a re-sample upstream.
        if (!this._currentBrightness)
            this._applyBrightness(this._themeBrightness());
    }

    // Cross-fade the bar's opaque background between visible (a window
    // is touching the top of the bar) and hidden (desktop visible, or
    // we're in fullscreen / overview / an excepted app). Animating
    // opacity instead of toggling a CSS class hides residual flickers
    // from any geometry-update timing skew.
    _refreshFill() {
        if (!this._background) return;
        const fill = this._isWindowNear && !this._fullscreen
            && !this._exceptionMatch && !this._inOverview;
        const target = fill ? 255 : 0;
        if (this._background.opacity === target) return;
        this._background.ease({
            opacity: target,
            duration: FILL_FADE_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    _applyBrightness(brightness) {
        if (this._currentBrightness === brightness) return;
        this._currentBrightness = brightness;
        if (!this._pill) return;
        if (brightness === 'dark') {
            this._pill.add_style_class_name(
                'touchshell-actionbar__pill--dark');
        } else {
            this._pill.remove_style_class_name(
                'touchshell-actionbar__pill--dark');
        }
    }

    _sampleAtPillCentre() {
        if (!this._pill) return;
        // Bump the epoch so that any in-flight pick_color callback whose
        // result arrives after a fresh sample-trigger is discarded —
        // otherwise stale samples can race ahead of fresh ones.
        const myEpoch = ++this._inFlightSampleEpoch;
        // idle_add to dodge mid-paint sampling and display-reconfig
        // crashes (touchup notes the same risk).
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            if (myEpoch !== this._inFlightSampleEpoch)
                return GLib.SOURCE_REMOVE;
            if (!this._pill) return GLib.SOURCE_REMOVE;
            try {
                const [px, py] = this._pill.get_transformed_position();
                const [pw, _ph] = this._pill.get_transformed_size();
                const sx = px + pw * 0.5;
                const sy = py - 2;
                new Shell.Screenshot()
                    .pick_color(sx, sy)
                    .then(([color]) => {
                        if (myEpoch !== this._inFlightSampleEpoch) return;
                        const lum =
                            (0.299 * color.red + 0.587 * color.green +
                             0.114 * color.blue) / 255;
                        this._applyBrightness(lum > 0.5 ? 'dark' : 'light');
                    })
                    .catch(() => { /* silent — fall back to last value */ });
            } catch (_) { /* sampling skipped, keep prior value */ }
            return GLib.SOURCE_REMOVE;
        });
    }

    // Mirrors AutoMaximizeWindows._appIds: returns up to two candidate
    // identifiers (desktop id, then WM_CLASS) for matching against the
    // exceptions list.
    _appIds(win) {
        if (!win) return [];
        const ids = [];
        try {
            const app = Shell.WindowTracker.get_default()
                .get_window_app(win);
            const id = app?.get_id?.();
            if (id) ids.push(id);
        } catch (_) { /* fall back to WM_CLASS */ }
        const cls = win.get_wm_class?.();
        if (cls) ids.push(cls);
        return ids;
    }
}
