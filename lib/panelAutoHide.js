import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { ActivationBinding } from './activation.js';

const HIDE_DURATION_MS = 200;
const SHOW_DURATION_MS = 150;

// Thickness of the invisible trigger strip at the very top of the screen
// that reveals the panel on hover.
const TOP_EDGE_TRIGGER_HEIGHT_PX = 3;

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
        this._globalSignals = [];
        this._menuSignals = [];
        this._openMenus = new Set();
        // null = not yet applied; set on first _updateStruts() so we don't
        // re-add chrome unless the strut state actually changes.
        this._currentReserveSpace = null;

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
    }

    _setup() {
        this._active = true;

        this._updateStruts();

        this._globalSignals.push([
            global.display,
            global.display.connect('notify::focus-window', () => this._focusWindowChanged()),
        ]);
        this._globalSignals.push([
            global.window_manager,
            global.window_manager.connect('size-change', () => this._evaluate()),
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
            this._evaluate();
        });

        this._connectMenuListeners();
        this._setupEdgeTrigger();
        this._focusWindowChanged();
    }

    _teardown() {
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
            this._evaluate();
            return Clutter.EVENT_PROPAGATE;
        });
        this._edgeActor.connect('leave-event', () => {
            this._edgeHovered = false;
            this._evaluate();
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

    _focusWindowChanged() {
        this._disconnectFocusWindow();
        const win = global.display.focus_window;
        if (win) {
            this._focusWindow = win;
            this._focusWindowSignals = [
                win.connect('notify::maximized-horizontally', () => this._evaluate()),
                win.connect('notify::maximized-vertically', () => this._evaluate()),
                win.connect('notify::fullscreen', () => this._evaluate()),
            ];
        }
        this._evaluate();
    }

    _evaluate() {
        if (!this._active)
            return;
        // Strut state depends on focus/overview state; recompute on every
        // evaluation so a snap, focus change or max toggle updates the
        // work area before the show/hide animation runs.
        this._updateStruts();
        if (this._shouldHide())
            this._hidePanel();
        else
            this._showPanel();
        this._fixFocusUnderPanel();
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

    _shouldHide() {
        if (this._overviewOpen) return false;
        if (this._edgeHovered || this._panelHovered) return false;
        if (this._openMenus.size > 0) return false;

        const win = global.display.focus_window;
        if (!win) return false;

        const maxBoth = win.maximized_horizontally && win.maximized_vertically;
        return maxBoth || win.is_fullscreen();
    }

    _hidePanel() {
        const panelBox = Main.layoutManager.panelBox;
        const height = this._panelHeight();
        panelBox.remove_all_transitions();
        panelBox.ease({
            translation_y: -height,
            duration: HIDE_DURATION_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
        this._easeBannerOffset(0, HIDE_DURATION_MS);
    }

    _showPanel(instant = false) {
        const panelBox = Main.layoutManager.panelBox;
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
