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

        // Restore panel struts to GNOME default.
        const panelBox = Main.layoutManager.panelBox;
        Main.layoutManager.removeChrome(panelBox);
        Main.layoutManager.addChrome(panelBox, {
            affectsStruts: true,
            trackFullscreen: true,
        });

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

    // Re-register panelBox with affectsStruts depending on overview state:
    // during overview we want the panel to reserve space (otherwise overview
    // content overlaps the panel); during normal use we want struts off so
    // maximized windows can use the former panel area.
    _updateStruts() {
        const panelBox = Main.layoutManager.panelBox;
        Main.layoutManager.removeChrome(panelBox);
        Main.layoutManager.addChrome(panelBox, {
            affectsStruts: this._overviewOpen,
            trackFullscreen: true,
        });
    }

    _onOverviewShowing() {
        this._overviewOpen = true;
        this._updateStruts();
        this._evaluate();
    }

    _onOverviewHidden() {
        this._overviewOpen = false;
        this._updateStruts();
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
        if (this._shouldHide())
            this._hidePanel();
        else
            this._showPanel();
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
        const height = panelBox.height || Main.panel.height || 32;
        panelBox.remove_all_transitions();
        panelBox.ease({
            translation_y: -height,
            duration: HIDE_DURATION_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    _showPanel(instant = false) {
        const panelBox = Main.layoutManager.panelBox;
        panelBox.remove_all_transitions();
        if (instant) {
            panelBox.translation_y = 0;
            return;
        }
        panelBox.ease({
            translation_y: 0,
            duration: SHOW_DURATION_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }
});
