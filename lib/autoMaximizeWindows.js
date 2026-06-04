import GLib from 'gi://GLib';
import Meta from 'gi://Meta';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';

import { ActivationBinding } from './activation.js';
import { appIds } from './utils.js';

// How many "Remember: you can set exceptions" reminder notifications
// to show in total before going silent forever. The counter persists
// across enable/disable cycles.
const REMINDER_TOTAL = 2;
const TOUCHSHELL_UUID = 'touchshell@touchshell.com';

// iPad-style: every new normal-type window opens maximized so the
// user gets a fullscreen experience by default. Existing windows are
// left alone — only newly-created windows are affected. Apps the user
// has marked as exceptions (via the opt-out notification or prefs)
// are skipped.
export class AutoMaximizeWindows {
    constructor(settings, tabletMode) {
        this._settings = settings;
        this._notifSource = null;

        this._activation = new ActivationBinding(
            settings, tabletMode, 'auto-maximize-windows-activation',
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
        this._handledWindows = new Set();
        // One-shot GLib sources awaiting their first (and only) fire.
        this._sources = new Set();
        // Teardown hooks for in-flight _centerInWorkArea operations.
        this._centerCleanups = new Set();
        global.display.connectObject(
            'window-created',
            (_d, win) => this._onWindowCreated(win),
            this
        );
        // Map signal fires when a window first appears on-screen.
        // GNOME Shell's WindowManager runs an opacity 0→255 + scale-up
        // ease here as the standard window-appear animation. For
        // windows we're going through the maximize→unmaximize→center
        // bounce on, that ease reveals the intermediate fullscreen
        // buffer mid-animation — the "flash" the user sees. We
        // override it: kill the ease, hold opacity at 0, tell Mutter
        // the map is complete so it doesn't stall waiting on the
        // animation we just killed. Reveal happens later via
        // _revealWindow once positioning has settled.
        global.window_manager.connectObject('map',
            (wm, actor) => this._onMap(wm, actor), this);
    }

    _teardown() {
        global.display.disconnectObject(this);
        global.window_manager.disconnectObject(this);
        // Cancel any in-flight centering operations (their timers +
        // per-window signals) and reveal whatever they left hidden.
        // Iterate a copy — each hook deletes itself from the set.
        for (const hook of [...(this._centerCleanups ?? [])])
            hook();
        this._centerCleanups?.clear();
        this._centerCleanups = null;
        for (const id of this._sources ?? [])
            GLib.source_remove(id);
        this._sources?.clear();
        this._sources = null;
        this._handledWindows?.clear();
        this._handledWindows = null;
        if (this._notifSource) {
            this._notifSource.destroy();
            this._notifSource = null;
        }
    }

    // Schedule a one-shot timeout whose id is tracked so disable() can
    // cancel it if it hasn't fired yet. The wrapper drops the id from
    // the set the moment the source fires, so teardown only ever
    // source_removes genuinely live timers.
    _addTimeout(interval, fn) {
        let id = 0;
        id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, interval, () => {
            this._sources?.delete(id);
            return fn();
        });
        this._sources?.add(id);
        return id;
    }

    _addIdle(fn) {
        let id = 0;
        id = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._sources?.delete(id);
            return fn();
        });
        this._sources?.add(id);
        return id;
    }

    _onMap(wm, actor) {
        try {
            const win = actor.get_meta_window?.();
            if (!win || !this._handledWindows?.has(win)) return;
            // WindowManager._mapWindow has already set:
            //   actor.opacity = 0; scale_x = 0.01; scale_y = 0.05;
            //   actor.show(); actor.ease({opacity: 255, scale_x: 1, ...});
            // Killing transitions stops the ease in place; we then
            // force the actor to its "done" geometry but leave opacity
            // at 0 — invisible until we choose to reveal.
            actor.remove_all_transitions();
            actor.opacity = 0;
            actor.set_scale(1, 1);
            actor.set_pivot_point(0, 0);
            // Clamp opacity on notify::opacity. After
            // remove_all_transitions, Clutter may still have a pending
            // animation tick that fires on the next frame, or another
            // shell handler may animate opacity. notify::opacity fires
            // synchronously inside the property setter — same call
            // frame, before the next paint — so we can veto any
            // non-zero value before the user sees it.
            this._installOpacityClamp(actor);
            // Without completed_map, Mutter would wait forever on the
            // ease we just killed (its onComplete normally calls this).
            wm.completed_map(actor);
        } catch (_) { /* actor or window torn down */ }
    }

    _installOpacityClamp(actor) {
        if (actor._touchshellOpacityClamp) return;
        actor._touchshellOpacityClamp = actor.connect('notify::opacity',
            () => {
                if (actor._touchshellRevealed) return;
                if (actor._touchshellClamping) return;
                if (actor.opacity === 0) return;
                actor._touchshellClamping = true;
                try {
                    actor.remove_all_transitions();
                    actor.opacity = 0;
                } finally {
                    actor._touchshellClamping = false;
                }
            });
    }

    _uninstallOpacityClamp(actor) {
        if (!actor._touchshellOpacityClamp) return;
        actor.disconnect(actor._touchshellOpacityClamp);
        actor._touchshellOpacityClamp = 0;
    }

    _onWindowCreated(win) {
        if (!this._shouldMaximize(win)) return;
        // Mark for _onMap so the WindowManager map ease gets
        // overridden when this window's actor is mapped.
        this._handledWindows.add(win);
        // Probe whether the window has a usable geometry RIGHT NOW.
        // Mutter saves its restore rect (`saved_rect`) the moment we
        // call maximize() below, capturing whatever the window's
        // current frame_rect happens to be. For most apps that's
        // already sensible. But popup launchers (vicinae and similar)
        // resolve their preferred size only after their first buffer
        // commit, which happens *after* window-created — so at the
        // instant we maximize, frame_rect has size 0, Mutter saves
        // garbage, and on a later unmaximize the window restores to
        // the screen midpoint (case 1) or (0,0) (case 2). We use
        // this flag below to decide whether to trust saved_rect or
        // override with a centered position.
        const savedRectIsTrustworthy = this._hasUsableGeometry(win);
        // Hide the actor for the entire bounce. _ensureHidden is
        // idempotent — at window-created the actor may not yet
        // exist, so the first call can return null. Subsequent
        // calls (idleRecheck, tryCenter, _onMap) catch it as soon
        // as it appears and install the opacity clamp. Reveal
        // happens once, after positioning settles.
        this._ensureHidden(win);
        try {
            // GNOME 49 dropped the MaximizeFlags arg — maximize() now
            // always means "both axes".
            win.maximize();
            this._ensureHidden(win);
        } catch (_) {
            this._revealWindow(win);
            return;
        }
        // GTK4 / Adwaita clients ack only the initial maximize
        // configure (which we send while struts are still on, so the
        // work area = monitor minus panel), then ignore the larger
        // configure that arrives once auto-hide flips struts off.
        // The buffer stays panel-height short, leaving a gap at the
        // bottom. Bouncing the max state on next idle — by which time
        // focus has changed, struts have flipped off, and the work
        // area is the full monitor — forces a fresh configure that
        // GTK4 honors.
        this._addIdle(() => {
            this._idleRecheck(win, savedRectIsTrustworthy, 0);
            return GLib.SOURCE_REMOVE;
        });
        // Defer the reminder notification until after panel-auto-hide
        // has finished animating the panel away in response to the new
        // maximized window. Firing it inline causes the messageTray
        // banner to be added while _bannerBin's translation_y is mid-
        // tween, which renders the banner half-clipped under the panel
        // and partially transparent. A short timeout lets the panel
        // hide animation settle before we dispatch.
        this._addTimeout(600, () => {
            try {
                this._maybeShowReminder();
            } catch (_) { /* window or shell torn down */ }
            return GLib.SOURCE_REMOVE;
        });
    }

    // Re-check exemption after window-created. Reveal is deferred
    // through the whole bounce so the user never sees the maximized
    // intermediate state — happens after the final move (centered
    // popups via _centerInWorkArea, otherwise immediately).
    //
    // Shell.WindowTracker only associates a window with its .desktop
    // after focus/title/wm-class signals settle. For windows summoned
    // over a fullscreen app that resolution can be slower than a single
    // idle tick, so _appIds() comes back empty and _isExempt() reports
    // false even when the app *is* on the exception list. Retry up to
    // 5 times, 100ms apart, before giving up.
    _idleRecheck(win, savedRectIsTrustworthy, attempt) {
        this._ensureHidden(win);
        try {
            if (this._isExempt(win)) {
                if (win.maximized_horizontally && win.maximized_vertically) {
                    win.unmaximize();
                    this._ensureHidden(win);
                    if (!savedRectIsTrustworthy) {
                        // _centerInWorkArea owns reveal — it waits for
                        // the post-unmaximize size-changed, moves the
                        // window to centre, then reveals after a
                        // fight-back grace period.
                        this._centerInWorkArea(win);
                        return;
                    }
                }
                this._revealWindow(win);
                return;
            }
            const ids = appIds(win);
            if (ids.length === 0 && attempt < 5) {
                this._addTimeout(100, () => {
                    this._idleRecheck(win, savedRectIsTrustworthy,
                        attempt + 1);
                    return GLib.SOURCE_REMOVE;
                });
                return;
            }
            if (win.maximized_horizontally && win.maximized_vertically) {
                win.unmaximize();
                win.maximize();
            }
        } catch (_) { /* window destroyed */ }
        this._revealWindow(win);
    }

    _hasUsableGeometry(win) {
        try {
            const r = win.get_frame_rect();
            return !!r && r.width > 0 && r.height > 0;
        } catch (_) {
            return false;
        }
    }

    // Move the window so it's centered within its monitor's current
    // work area, preserving the post-unmaximize size.
    //
    // Mutter's unmaximize() is async — frame_rect still reads the
    // maximized geometry until Mutter has processed the client's
    // configure-ack. A naïve idle_add reads the maximized rect,
    // clamps width/height to the work area, and ends up "centering"
    // a fullscreen-sized window (top-left at 0,0). So we wait for
    // size-changed (= unmaximize actually applied) before measuring.
    // Timeout fallback covers the case where the signal somehow
    // never fires (window destroyed, or app refused to resize).
    //
    // Some clients (notably vicinae) re-assert their preferred
    // position ~70ms after our move_resize_frame, snapping the
    // window back to (0,0). After our successful center we install
    // a position-changed listener that re-applies our coords any
    // time the window is moved away from them, and keep the actor
    // hidden until the fight-back grace period ends — so the user
    // never sees the brief flicker to (0,0).
    _centerInWorkArea(win) {
        let sizeSignalId = 0;
        let timeoutId = 0;
        let fightSignalId = 0;
        let graceTimeoutId = 0;
        let revealed = false;
        // Register a teardown hook so disable() can cancel this
        // operation's pending timers and per-window signal connections
        // (and reveal the window it left hidden) if the extension is
        // disabled while the bounce is still in flight. The hook
        // removes itself once the operation reveals normally.
        const teardownHook = () => {
            cleanupWaitForUnmax();
            cleanupFightBack();
            reveal();
        };
        this._centerCleanups?.add(teardownHook);
        const reveal = () => {
            if (revealed) return;
            revealed = true;
            this._centerCleanups?.delete(teardownHook);
            this._revealWindow(win);
        };
        const cleanupWaitForUnmax = () => {
            if (sizeSignalId) {
                win.disconnect(sizeSignalId);
                sizeSignalId = 0;
            }
            if (timeoutId) {
                GLib.source_remove(timeoutId);
                timeoutId = 0;
            }
        };
        const cleanupFightBack = () => {
            if (fightSignalId) {
                win.disconnect(fightSignalId);
                fightSignalId = 0;
            }
            if (graceTimeoutId) {
                GLib.source_remove(graceTimeoutId);
                graceTimeoutId = 0;
            }
        };
        const startFightBack = (cx, cy, w, h) => {
            try {
                fightSignalId = win.connect('position-changed', () => {
                    try {
                        const cur = win.get_frame_rect();
                        if (!cur) return;
                        if (cur.x === cx && cur.y === cy) return;
                        win.move_resize_frame(false, cx, cy, w, h);
                        this._ensureHidden(win);
                    } catch (_) {}
                });
            } catch (_) {}
            // Reveal once the grace period ends. 500ms covers the
            // observed ~70ms revert plus margin for slower machines.
            graceTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT,
                500, () => {
                    graceTimeoutId = 0;
                    cleanupFightBack();
                    reveal();
                    return GLib.SOURCE_REMOVE;
                });
        };
        const tryCenter = () => {
            try {
                this._ensureHidden(win);
                if (win.maximized_horizontally || win.maximized_vertically)
                    return false;
                const monitor = win.get_monitor?.();
                const ws = global.workspace_manager.get_active_workspace();
                if (!ws || monitor === undefined || monitor < 0)
                    return true;
                const work = ws.get_work_area_for_monitor(monitor);
                const r = win.get_frame_rect();
                if (!r || r.width <= 0 || r.height <= 0)
                    return false;
                // First size-changed after unmaximize() can fire while
                // the window is still at its maximized geometry —
                // Mutter has cleared the maximized flag but the
                // client's real buffer (with the popup's natural
                // smaller size) hasn't been committed yet. If the rect
                // still spans the work area, this isn't the size we
                // want to center against — wait for the next event.
                if (r.width >= work.width && r.height >= work.height)
                    return false;
                const w = Math.min(r.width, work.width);
                const h = Math.min(r.height, work.height);
                const cx = work.x + Math.floor((work.width - w) / 2);
                const cy = work.y + Math.floor((work.height - h) / 2);
                win.move_resize_frame(false, cx, cy, w, h);
                this._ensureHidden(win);
                startFightBack(cx, cy, w, h);
                return true;
            } catch (_) {
                return true;
            }
        };
        try {
            sizeSignalId = win.connect('size-changed', () => {
                if (tryCenter()) cleanupWaitForUnmax();
            });
        } catch (_) { /* signal not available */ }
        timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1500, () => {
            timeoutId = 0;
            const handled = tryCenter();
            cleanupWaitForUnmax();
            // tryCenter returns true when we kicked off the fight-
            // back path (which owns reveal). Otherwise reveal now.
            if (!handled || !fightSignalId) reveal();
            return GLib.SOURCE_REMOVE;
        });
    }

    // Idempotent hide. The WindowActor may not exist yet at
    // window-created — we get null on the first call. Subsequent
    // callers (idleRecheck, tryCenter, _onMap) hit this until the
    // actor materialises and gets clamped to opacity=0. The
    // `_touchshellRevealed` marker prevents a late signal from
    // re-hiding after we've intentionally revealed.
    //
    // remove_all_transitions() is critical: GNOME Shell's
    // WindowManager and Mutter both run easing transitions on
    // opacity at various points (window-appear, focus changes).
    // A live transition will overwrite our `opacity = 0` on its
    // next tick, so we kill any in-flight transition first.
    _ensureHidden(win) {
        try {
            const actor = win.get_compositor_private();
            if (!actor) return null;
            if (actor._touchshellRevealed) return actor;
            // Install the clamp as soon as we have an actor — earlier
            // than _onMap, in case anything tries to ease opacity in
            // the gap between window-created and map.
            this._installOpacityClamp(actor);
            actor.remove_all_transitions();
            if (actor.opacity !== 0) actor.opacity = 0;
            return actor;
        } catch (_) {
            return null;
        }
    }

    _revealWindow(win) {
        this._handledWindows?.delete(win);
        try {
            const actor = win.get_compositor_private();
            if (!actor) return;
            actor._touchshellRevealed = true;
            this._uninstallOpacityClamp(actor);
            actor.remove_all_transitions();
            actor.opacity = 255;
        } catch (_) { /* actor torn down — fine */ }
    }

    _shouldMaximize(win) {
        if (!win)
            return false;
        if (win.window_type !== Meta.WindowType.NORMAL)
            return false;
        if (typeof win.is_override_redirect === 'function' && win.is_override_redirect())
            return false;
        if (win.get_transient_for?.())
            return false;
        if (typeof win.allows_maximize === 'function' && !win.allows_maximize())
            return false;
        if (win.maximized_horizontally && win.maximized_vertically)
            return false;
        if (typeof win.is_fullscreen === 'function' && win.is_fullscreen())
            return false;
        if (this._isExempt(win))
            return false;
        return true;
    }

    _isExempt(win) {
        const exceptions = this._settings.get_strv('auto-maximize-exceptions');
        if (exceptions.length === 0)
            return false;
        return appIds(win).some(id => exceptions.includes(id));
    }

    // Show the lightweight "Remember: you can set exceptions in
    // settings" reminder for the first REMINDER_TOTAL qualifying
    // window creations. Once the counter has reached the cap we
    // never fire again — the user has been told twice, that's
    // sufficient. The counter is global (not per-app) and persists
    // across enable/disable cycles.
    _maybeShowReminder() {
        const shown = this._settings.get_int('auto-maximize-reminder-count');
        if (shown >= REMINDER_TOTAL)
            return;
        const next = shown + 1;
        this._settings.set_int('auto-maximize-reminder-count', next);
        this._showReminder(next);
    }

    _ensureNotifSource() {
        if (this._notifSource)
            return this._notifSource;
        const source = new MessageTray.Source({
            title: 'Fullscreen Apps',
            iconName: 'view-fullscreen-symbolic',
        });
        source.connect('destroy', () => {
            this._notifSource = null;
        });
        Main.messageTray.add(source);
        this._notifSource = source;
        return source;
    }

    _showReminder(num) {
        const source = this._ensureNotifSource();
        const notif = new MessageTray.Notification({
            source,
            title: 'Fullscreen Apps',
            body: `Remember (${num}/${REMINDER_TOTAL}): You can set ` +
                'exceptions for fullscreen apps in settings.',
            isTransient: true,
        });
        const openSettings = () => {
            try {
                Main.extensionManager.openExtensionPrefs(
                    TOUCHSHELL_UUID, '', {});
            } catch (_) { /* prefs unavailable */ }
        };
        notif.addAction('Open settings', openSettings);
        notif.connect('activated', openSettings);
        source.addNotification(notif);
    }
}
