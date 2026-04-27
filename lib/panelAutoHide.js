import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { ActivationBinding } from './activation.js';

const HIDE_DURATION_MS = 200;
const SHOW_DURATION_MS = 150;

// Thickness of the invisible trigger strip at the very top of the screen
// that reveals the panel on hover.
const TOP_EDGE_TRIGGER_HEIGHT_PX = 3;

// Brief grace period after either the edge trigger or the panel itself
// reports "no longer hovered". The panel slides under the cursor as it
// animates, which causes hover ownership to hand off between the edge
// strip and the panel actor. There's a one-frame gap during the handoff
// where both report false, and without this grace the panel re-evaluates
// to "should hide", starts sliding up, the edge re-acquires hover,
// re-shows... infinitely. 80ms covers a 60Hz frame handoff with margin.
const HOVER_FALSE_GRACE_MS = 80;

export const PanelAutoHide = GObject.registerClass(
class PanelAutoHide extends GObject.Object {
    _init(settings, tabletMode) {
        super._init();
        this._active = false;
        this._edgeActor = null;
        this._edgeHovered = false;
        this._panelHovered = false;
        this._overviewOpen = Main.overview.visible;
        this._panelHoverId = 0;
        this._focusWindow = null;
        this._focusWindowSignals = [];
        // Sticky "this window has been fullscreen during the current
        // focus session" — see _shouldHide() for why hover-peek needs
        // a session-bound flag rather than instantaneous is_fullscreen().
        this._focusEverFullscreen = false;
        // Monotonic-time (ms) of our last automatic make_fullscreen()
        // call on the focused window. Used to escape an exit→re-enter
        // loop: if a second exit arrives inside the cooldown, we
        // accept it instead of slamming back. 0 = no recent attempt.
        this._lastRefullscreenAt = 0;
        this._refullscreenSourceId = 0;
        this._globalSignals = [];
        this._menuSignals = [];
        this._openMenus = new Set();
        // null = not yet applied; set on first _updateStruts() so we don't
        // re-add chrome unless the strut state actually changes.
        this._currentReserveSpace = null;
        // Animation target tracking for idempotent _hidePanel/_showPanel.
        // null until the first show/hide; thereafter the translation_y we
        // last asked the panelBox to settle at.
        this._panelTargetY = null;
        this._evalSourceId = 0;
        // Pending grace-period timer for hover going false (see
        // HOVER_FALSE_GRACE_MS).
        this._hoverGraceSourceId = 0;

        this._activation = new ActivationBinding(
            settings, tabletMode, 'panel-auto-hide-activation',
            {
                onEnable: () => this._setup(),
                onDisable: () => this._teardown(),
            }
        );
    }

    destroy() {
        this._activation?.destroy();
        this._activation = null;
    }

    // Immediately place the panel at y=0 without animation. Called by other
    // features (e.g. the top-right swipe) before they open a panel menu, so
    // the menu's BoxPointer has a valid on-screen anchor.
    showInstant() {
        const panelBox = Main.layoutManager.panelBox;
        panelBox.remove_all_transitions();
        panelBox.translation_y = 0;
        this._panelTargetY = 0;
    }

    _setup() {
        this._active = true;

        this._updateStruts();

        this._globalSignals.push([
            global.display,
            global.display.connect('notify::focus-window',
                () => this._focusWindowChanged()),
        ]);
        this._globalSignals.push([
            global.window_manager,
            global.window_manager.connect('size-change',
                () => this._evaluate()),
        ]);
        this._globalSignals.push([
            Main.overview,
            Main.overview.connect('showing', () => this._onOverviewShowing()),
        ]);
        this._globalSignals.push([
            Main.overview,
            Main.overview.connect('hidden', () => this._onOverviewHidden()),
        ]);
        // Mutter recomputes work areas asynchronously after our struts
        // change (queued via Main.layoutManager._updateRegions). The
        // fix-focus-under-panel logic needs the up-to-date work area,
        // so re-run it whenever workareas actually change.
        this._globalSignals.push([
            global.display,
            global.display.connect('workareas-changed',
                () => this._fixFocusUnderPanel()),
        ]);

        Main.panel.reactive = true;
        Main.panel.track_hover = true;
        this._panelHoverId = Main.panel.connect('notify::hover', () => {
            this._panelHovered = Main.panel.hover;
            this._onHoverChanged();
        });

        this._connectMenuListeners();
        this._setupEdgeTrigger();
        this._focusWindowChanged();
    }

    _teardown() {
        if (this._evalSourceId) {
            GLib.source_remove(this._evalSourceId);
            this._evalSourceId = 0;
        }
        if (this._hoverGraceSourceId) {
            GLib.source_remove(this._hoverGraceSourceId);
            this._hoverGraceSourceId = 0;
        }
        this._cancelRefullscreenTimer();

        this._showPanel(true);

        // Restore panel struts to GNOME default. Once struts are back the
        // banner naturally falls below the panel via MonitorConstraint, so
        // clear our compensating translation.
        const panelBox = Main.layoutManager.panelBox;
        Main.layoutManager.removeChrome(panelBox);
        Main.layoutManager.addChrome(panelBox, {
            affectsStruts: true,
            trackFullscreen: true,
        });
        this._currentReserveSpace = null;
        this._setBannerOffsetInstant(0);

        for (const [obj, id] of this._globalSignals)
            obj.disconnect(id);
        this._globalSignals = [];

        this._disconnectMenuListeners();

        if (this._panelHoverId) {
            Main.panel.disconnect(this._panelHoverId);
            this._panelHoverId = 0;
        }

        this._disconnectFocusWindow();
        this._tearDownEdgeTrigger();

        this._active = false;
        this._edgeHovered = false;
        this._panelHovered = false;
    }

    // Decide whether the panel should reserve work-area space (struts).
    // We turn struts off only when the focused window is fully maximized
    // or fullscreen — those are the cases where we want the panel to
    // actually auto-hide and let the window use the former panel area.
    // For everything else (regular window focus, tiled/snapped windows,
    // overview open) we keep struts on so:
    //   - tile-to-edge respects the panel area
    //   - overview content doesn't sit under the panel
    //   - notification banners drop below the panel via MonitorConstraint
    _updateStruts() {
        const reserveSpace = this._overviewOpen || !this._focusIsMaxOrFullscreen();
        if (this._currentReserveSpace === reserveSpace)
            return;
        this._currentReserveSpace = reserveSpace;
        const panelBox = Main.layoutManager.panelBox;

        // layoutManager._updateRegions() computes strut bounds from the
        // actor's TRANSFORMED position (get_transformed_position). If
        // the panel is currently off-screen via translation_y=-h and
        // we make struts active, the resulting strut clamps to a
        // 0-height band and contributes nothing. So when struts are
        // coming back we snap the panel to y=0 first. The follow-up
        // _showPanel() is a no-op because we're already at the target.
        if (reserveSpace) {
            panelBox.remove_all_transitions();
            panelBox.translation_y = 0;
        }

        // Toggle the existing chrome registration's affectsStruts in
        // place rather than removeChrome + addChrome. The remove/add
        // cycle re-shuffles the chrome actor stack, which changes the
        // pick order between our edge trigger and the panel itself —
        // every time that order flipped (notably during the
        // auto-maximize bounce, which fires unmax+max in sequence),
        // edge.leave / panel.notify::hover would race and the auto-
        // hide state machine would oscillate. Mutating the tracked
        // entry directly preserves the original chrome ordering, so
        // hover stays stable.
        const tracked = Main.layoutManager._trackedActors;
        const entry = tracked?.find(a => a.actor === panelBox);
        if (entry) {
            entry.affectsStruts = reserveSpace;
            // Sync recompute so geometry that runs immediately after
            // this (e.g. the tile rect for a snap that just unmaximized
            // us) sees the new work area.
            Main.layoutManager._updateRegions?.();
        } else {
            // Fallback: chrome registration changed (shell update?) —
            // fall back to the original re-register path.
            Main.layoutManager.removeChrome(panelBox);
            Main.layoutManager.addChrome(panelBox, {
                affectsStruts: reserveSpace,
                trackFullscreen: true,
            });
            Main.layoutManager._updateRegions?.();
        }
    }

    _focusIsMaxOrFullscreen() {
        const win = global.display.focus_window;
        if (!win)
            return false;
        if (win.is_fullscreen())
            return true;
        // Sticky session flag: if the focused window was fullscreen at
        // any point during this focus session, keep struts off even
        // after a (likely spurious) drop back to windowed/max — the
        // app is "in fullscreen-apps mode" until focus moves away.
        // Mirrors the gate in _shouldHide(). Without this, an app that
        // self-fullscreens and then drops back (Chrome PWA on cursor-
        // approach, etc.) makes _updateStruts() flip reserveSpace true,
        // which snaps the panel to y=0 and leaves _panelTargetY stale,
        // so the subsequent _hidePanel() early-returns and the panel
        // stays visible.
        if (this._focusEverFullscreen)
            return true;
        return win.maximized_horizontally && win.maximized_vertically;
    }

    _onOverviewShowing() {
        this._overviewOpen = true;
        this._evaluate();
    }

    _onOverviewHidden() {
        this._overviewOpen = false;
        this._evaluate();
    }

    _connectMenuListeners() {
        // Track open state of every existing panel indicator's menu directly
        // rather than trusting Main.panel.menuManager.activeMenu, which does
        // not always clear synchronously with the open-state-changed signal.
        for (const name in Main.panel.statusArea) {
            const indicator = Main.panel.statusArea[name];
            const menu = indicator?.menu;
            if (!menu || typeof menu.connect !== 'function')
                continue;
            if (menu.isOpen)
                this._openMenus.add(menu);
            const id = menu.connect('open-state-changed', (_m, open) => {
                if (open)
                    this._openMenus.add(menu);
                else
                    this._openMenus.delete(menu);
                this._evaluate();
            });
            this._menuSignals.push([menu, id]);
        }
    }

    _disconnectMenuListeners() {
        for (const [menu, id] of this._menuSignals) {
            try { menu.disconnect(id); } catch (_) {}
        }
        this._menuSignals = [];
        this._openMenus.clear();
    }

    _setupEdgeTrigger() {
        const monitor = Main.layoutManager.primaryMonitor;
        this._edgeActor = new Clutter.Actor({
            reactive: true,
            x: monitor.x,
            y: monitor.y,
            width: monitor.width,
            height: TOP_EDGE_TRIGGER_HEIGHT_PX,
        });
        this._edgeActor.connect('enter-event', () => {
            this._edgeHovered = true;
            this._onHoverChanged();
            return Clutter.EVENT_PROPAGATE;
        });
        this._edgeActor.connect('leave-event', () => {
            this._edgeHovered = false;
            this._onHoverChanged();
            return Clutter.EVENT_PROPAGATE;
        });
        Main.layoutManager.addChrome(this._edgeActor, { trackFullscreen: true });
    }

    _tearDownEdgeTrigger() {
        if (this._edgeActor) {
            Main.layoutManager.removeChrome(this._edgeActor);
            this._edgeActor.destroy();
            this._edgeActor = null;
        }
    }

    _disconnectFocusWindow() {
        for (const id of this._focusWindowSignals) {
            try { this._focusWindow?.disconnect(id); } catch (_) {}
        }
        this._focusWindowSignals = [];
        this._focusWindow = null;
    }

    // Re-fullscreen handler. Called from the focus window's
    // notify::fullscreen signal when fullscreen has just gone
    // FALSE on a window that was previously fullscreen during
    // this focus session.
    //
    // Apps that self-fullscreen via a Chrome F11 extension do
    // CONTINUOUS cursor-watch — they exit fullscreen the instant
    // the pointer is near the top edge. An immediate slam-back
    // produces a flicker loop: we re-fullscreen, the watcher
    // immediately re-exits, repeat. So we delay the slam, and
    // gate it on the cursor having moved off the top guard band.
    // If the cursor is still near the top when the delay fires,
    // the watcher would just exit again — give up cleanly,
    // clear the session flag, and let the panel come back.
    //
    // Cooldown gate: if our most recent slam happened within
    // COOLDOWN_MS, accept this exit. That covers two cases —
    // an app that fights through the cursor gate anyway, and a
    // user double-pressing F11 to escape after a slam.
    _maybeRefullscreen(win) {
        const COOLDOWN_MS = 2000;
        const DELAY_MS = 3000;
        const TOP_GUARD_PX = 60;

        const now = GLib.get_monotonic_time() / 1000;
        if (this._lastRefullscreenAt &&
            now - this._lastRefullscreenAt < COOLDOWN_MS) {
            this._focusEverFullscreen = false;
            this._lastRefullscreenAt = 0;
            this._cancelRefullscreenTimer();
            return;
        }

        this._cancelRefullscreenTimer();
        this._refullscreenSourceId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT, DELAY_MS, () => {
                this._refullscreenSourceId = 0;
                if (!this._active) return GLib.SOURCE_REMOVE;
                if (this._focusWindow !== win) return GLib.SOURCE_REMOVE;
                if (win.is_fullscreen()) return GLib.SOURCE_REMOVE;

                const [, y] = global.get_pointer();
                if (y < TOP_GUARD_PX) {
                    this._focusEverFullscreen = false;
                    this._evaluate();
                    return GLib.SOURCE_REMOVE;
                }

                this._lastRefullscreenAt =
                    GLib.get_monotonic_time() / 1000;
                try {
                    win.make_fullscreen();
                } catch (_) { /* window destroyed mid-call */ }
                return GLib.SOURCE_REMOVE;
            });
    }

    _cancelRefullscreenTimer() {
        if (this._refullscreenSourceId) {
            GLib.source_remove(this._refullscreenSourceId);
            this._refullscreenSourceId = 0;
        }
    }

    _focusWindowChanged() {
        this._disconnectFocusWindow();
        const win = global.display.focus_window;
        if (win) {
            this._focusWindow = win;
            // Reset the session-fullscreen flag to the new focus
            // window's current state. Becomes sticky-true via the
            // notify::fullscreen handler below the moment the window
            // first reports is_fullscreen().
            this._focusEverFullscreen = win.is_fullscreen();
            // Reset the re-fullscreen cooldown: each focus session
            // gets its own escape budget.
            this._lastRefullscreenAt = 0;
            this._cancelRefullscreenTimer();
            this._focusWindowSignals = [
                win.connect('notify::maximized-horizontally',
                    () => this._evaluate()),
                win.connect('notify::maximized-vertically',
                    () => this._evaluate()),
                win.connect('notify::fullscreen', () => {
                    if (win.is_fullscreen()) {
                        this._focusEverFullscreen = true;
                    } else if (this._focusEverFullscreen) {
                        this._maybeRefullscreen(win);
                    }
                    this._evaluate();
                }),
            ];
        } else {
            this._focusEverFullscreen = false;
        }
        this._evaluate();
    }

    // Coalesce rapid-fire signals (focus → max-h → max-v → size-change
    // all firing synchronously when GTK4/Adwaita apps bounce their
    // maximize state on focus). Without this, every signal restarts a
    // panel animation, producing the visible flap. Idle priority is
    // sufficient: the bounce sequence completes within a single main-
    // loop iteration, so by the time the idle runs, the window has
    // settled at its final state.
    _evaluate() {
        if (!this._active)
            return;
        if (this._evalSourceId)
            return;
        this._evalSourceId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this._evalSourceId = 0;
            if (!this._active)
                return GLib.SOURCE_REMOVE;
            this._updateStruts();
            if (this._shouldHide())
                this._hidePanel();
            else
                this._showPanel();
            this._fixFocusUnderPanel();
            return GLib.SOURCE_REMOVE;
        });
    }

    // When a window goes max → snap, Mutter computes the tile geometry
    // using the still-OFF struts (work area = full monitor) and lands
    // the tile under the panel. By the time our notify::maximized-*
    // handler updates struts, the window is already mispositioned.
    // Reactive fix: if the focused non-fullscreen, not-fully-maxed
    // window extends above the work area top while struts are on,
    // shift it down to sit at the top of the work area.
    _fixFocusUnderPanel() {
        if (!this._currentReserveSpace)
            return;
        const win = global.display.focus_window;
        if (!win)
            return;
        if (typeof win.is_fullscreen === 'function' && win.is_fullscreen())
            return;
        if (win.maximized_horizontally && win.maximized_vertically)
            return;
        const monitor = win.get_monitor?.();
        if (monitor === undefined || monitor < 0)
            return;
        const ws = global.workspace_manager.get_active_workspace();
        if (!ws)
            return;
        const work = ws.get_work_area_for_monitor(monitor);
        const r = win.get_frame_rect();
        if (r.y >= work.y)
            return;
        const newY = work.y;
        const newH = r.height - (newY - r.y);
        if (newH <= 0)
            return;
        win.move_resize_frame(true, r.x, newY, r.width, newH);
    }

    // Hover-state handler. Going TRUE is immediate; going FALSE is
    // delayed by HOVER_FALSE_GRACE_MS, because as the panel slides under
    // the cursor, hover ownership swaps between the edge strip and the
    // panel actor and there's a one-frame gap where both report false.
    // Without the grace, that gap triggers hide → panel-up → edge-hover-
    // true → show → loop.
    _onHoverChanged() {
        const anyHover = this._edgeHovered || this._panelHovered;
        if (anyHover) {
            // Cancel any pending grace; we're definitely hovered now.
            if (this._hoverGraceSourceId) {
                GLib.source_remove(this._hoverGraceSourceId);
                this._hoverGraceSourceId = 0;
            }
            this._evaluate();
            return;
        }
        // Both went false. Defer the decision so a quick re-acquire
        // (edge → panel handoff) can cancel us.
        if (this._hoverGraceSourceId)
            return;
        this._hoverGraceSourceId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT, HOVER_FALSE_GRACE_MS, () => {
                this._hoverGraceSourceId = 0;
                if (!this._active) return GLib.SOURCE_REMOVE;
                if (!this._edgeHovered && !this._panelHovered)
                    this._evaluate();
                return GLib.SOURCE_REMOVE;
            });
    }

    _shouldHide() {
        if (this._overviewOpen) return false;
        if (this._openMenus.size > 0) return false;

        const win = global.display.focus_window;
        if (!win) return false;

        const isFullscreen = win.is_fullscreen();
        const maxBoth = win.maximized_horizontally && win.maximized_vertically;

        // Hover (and the post-hover grace window) reveals the panel for
        // plain-maximized windows, but NOT for windows that have been
        // is_fullscreen() at any point during the current focus session
        // (the "ever-fullscreen" sticky flag).
        //
        // Why session-bound rather than instantaneous is_fullscreen():
        // apps that self-fullscreen via a Chrome F11 extension (PWAs,
        // some video players) detect cursor-approach to the top edge
        // *autonomously* and drop their own fullscreen state before
        // our edge actor ever fires its enter event. By the time
        // _shouldHide() sees the hover, is_fullscreen() is already
        // false — the window now reports as plain-max, and a literal
        // gate would let the peek through. The sticky flag preserves
        // the user's "this app should be fullscreen" intent across
        // those spurious dips. It clears when focus moves to a
        // different window.
        //
        // Deliberate reveals (top-edge swipe → quick settings, panel
        // menu open) still work over a fullscreen window via the
        // overview/menu checks above.
        if (!isFullscreen && !this._focusEverFullscreen) {
            if (this._edgeHovered || this._panelHovered) return false;
            if (this._hoverGraceSourceId) return false;
        }

        return maxBoth || isFullscreen || this._focusEverFullscreen;
    }

    _hidePanel() {
        const panelBox = Main.layoutManager.panelBox;
        const targetY = -this._panelHeight();
        if (this._panelTargetY === targetY)
            return;
        this._panelTargetY = targetY;
        panelBox.remove_all_transitions();
        panelBox.ease({
            translation_y: targetY,
            duration: HIDE_DURATION_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
        this._easeBannerOffset(0, HIDE_DURATION_MS);
    }

    _showPanel(instant = false) {
        const panelBox = Main.layoutManager.panelBox;
        if (this._panelTargetY === 0 && !instant)
            return;
        this._panelTargetY = 0;
        panelBox.remove_all_transitions();
        const target = this._bannerOffsetWhenPanelShown();
        if (instant) {
            panelBox.translation_y = 0;
            this._setBannerOffsetInstant(target);
            return;
        }
        panelBox.ease({
            translation_y: 0,
            duration: SHOW_DURATION_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
        this._easeBannerOffset(target, SHOW_DURATION_MS);
    }

    _panelHeight() {
        const panelBox = Main.layoutManager.panelBox;
        return panelBox.height || Main.panel.height || 32;
    }

    // MessageTray._bannerBin lives in a container that uses
    // MonitorConstraint(work-area=true). Whenever struts are on the work
    // area already excludes the panel and no offset is needed. When struts
    // are off (focus is maximized/fullscreen) the work area is the full
    // monitor, so we shift the banner down by panel height to keep it
    // below a panel that's currently showing (e.g. on edge hover).
    _bannerOffsetWhenPanelShown() {
        return this._currentReserveSpace ? 0 : this._panelHeight();
    }

    _easeBannerOffset(target, duration) {
        const banner = Main.messageTray?._bannerBin;
        if (!banner)
            return;
        banner.remove_all_transitions();
        banner.ease({
            translation_y: target,
            duration,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    _setBannerOffsetInstant(target) {
        const banner = Main.messageTray?._bannerBin;
        if (!banner)
            return;
        banner.remove_all_transitions();
        banner.translation_y = target;
    }
});
