import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { ActivationBinding } from './activation.js';
import { monitorForPoint } from './utils.js';

const ACTION_NAME = 'touchshell-left-edge-swipe';

const LEFT_EDGE_ZONE_PX = 28;
const VERTICAL_CORNER_GUARD_PX = 48;
const MIN_SWIPE_DISTANCE_PX = 60;
const MAX_VERTICAL_DRIFT_PX = 100;
const HOLD_JITTER_PX = 6;
const HOLD_TO_OVERVIEW_MS = 450;
const CYCLE_RESET_MS = 2000;
const FOCUS_GRACE_MS = 300;

// Left-edge inward swipe that cycles through open windows on the active
// workspace (like Windows Tablet Mode):
//   - Quick swipe and release → activate the next window in MRU order.
//     Repeated swipes within CYCLE_RESET_MS step through the frozen window
//     list instead of toggling between the top two windows.
//   - Swipe in and hold for HOLD_TO_OVERVIEW_MS → open the Activities
//     overview without switching windows on release.
export class LeftEdgeSwipeGesture {
    constructor(settings, tabletMode) {
        this._stageGesture = null;
        this._cycle = null;
        this._holdTimeoutId = 0;
        this._holdTriggered = false;
        this._lastDx = 0;
        this._lastDy = 0;
        this._anchorX = 0;
        this._anchorY = 0;

        this._activation = new ActivationBinding(
            settings, tabletMode, 'left-edge-swipe-activation',
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

    _setup() {
        this._stageGesture = new Clutter.PanGesture({
            pan_axis: Clutter.PanAxis.X,
            min_n_points: 1,
            max_n_points: 1,
            begin_threshold: 12,
        });

        this._stageGesture.connect('should-handle-sequence', (_g, event) =>
            this._shouldHandleSequence(event));
        this._stageGesture.connect('pan-update', g =>
            this._onPanUpdate(g));
        this._stageGesture.connect('end', () => this._onEnd());
        this._stageGesture.connect('cancel', () => this._onCancel());

        global.stage.add_action_full(
            ACTION_NAME,
            Clutter.EventPhase.CAPTURE,
            this._stageGesture
        );
    }

    _teardown() {
        this._clearHoldTimer();
        this._cycle = null;
        if (this._stageGesture) {
            global.stage.remove_action(this._stageGesture);
            this._stageGesture = null;
        }
    }

    _shouldHandleSequence(event) {
        if (event.type() !== Clutter.EventType.TOUCH_BEGIN)
            return false;
        if (Main.sessionMode.isLocked)
            return false;
        if (!(Main.actionMode & Shell.ActionMode.NORMAL))
            return false;
        if (Main.overview.visible)
            return false;

        const [x, y] = event.get_coords();
        const picked = global.stage.get_actor_at_pos(
            Clutter.PickMode.REACTIVE, x, y);
        if (picked && this._isMarkedOverlay(picked))
            return false;

        const monitor = monitorForPoint(x, y);
        if (!monitor)
            return false;

        const inLeftZone =
            x >= monitor.x && x <= monitor.x + LEFT_EDGE_ZONE_PX;
        const inVerticalRange =
            y >= monitor.y + VERTICAL_CORNER_GUARD_PX &&
            y <= monitor.y + monitor.height - VERTICAL_CORNER_GUARD_PX;

        if (!inLeftZone || !inVerticalRange)
            return false;

        this._clearHoldTimer();
        this._holdTriggered = false;
        this._lastDx = 0;
        this._lastDy = 0;
        this._anchorX = 0;
        this._anchorY = 0;
        return true;
    }

    _isMarkedOverlay(actor) {
        let a = actor;
        while (a) {
            if (a._touchshellOverlay)
                return true;
            a = a.get_parent();
        }
        return false;
    }

    _onPanUpdate(gesture) {
        if (this._holdTriggered)
            return;

        const delta = gesture.get_accumulated_delta();
        const dx = delta.get_x();
        const dy = delta.get_y();

        this._lastDx = dx;
        this._lastDy = dy;

        if (Math.abs(dy) > MAX_VERTICAL_DRIFT_PX && Math.abs(dy) > dx) {
            this._clearHoldTimer();
            return;
        }

        if (dx < MIN_SWIPE_DISTANCE_PX) {
            this._anchorX = dx;
            this._anchorY = dy;
            this._clearHoldTimer();
            return;
        }

        const moveDist = Math.hypot(dx - this._anchorX, dy - this._anchorY);
        if (!this._holdTimeoutId || moveDist >= HOLD_JITTER_PX) {
            this._anchorX = dx;
            this._anchorY = dy;
            this._armHoldTimer();
        }
    }

    _onEnd() {
        const wasHeld = this._holdTriggered;
        const dx = this._lastDx;
        const dy = this._lastDy;

        this._clearHoldTimer();
        this._holdTriggered = false;
        this._lastDx = 0;
        this._lastDy = 0;

        if (wasHeld || Main.overview.visible)
            return;
        if (dx < MIN_SWIPE_DISTANCE_PX)
            return;
        if (Math.abs(dy) > MAX_VERTICAL_DRIFT_PX || Math.abs(dy) > dx)
            return;

        this._switchToNextWindow();
    }

    _onCancel() {
        this._clearHoldTimer();
        this._holdTriggered = false;
        this._lastDx = 0;
        this._lastDy = 0;
    }

    _armHoldTimer() {
        this._clearHoldTimer();
        this._holdTimeoutId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            HOLD_TO_OVERVIEW_MS,
            () => {
                this._holdTimeoutId = 0;
                this._onHold();
                return GLib.SOURCE_REMOVE;
            }
        );
    }

    _onHold() {
        if (this._holdTriggered)
            return;

        this._holdTriggered = true;
        this._cycle = null;

        if (!Main.overview.visible)
            Main.overview.show();
    }

    _clearHoldTimer() {
        if (this._holdTimeoutId) {
            GLib.source_remove(this._holdTimeoutId);
            this._holdTimeoutId = 0;
        }
    }

    _switchToNextWindow() {
        const workspace = global.workspace_manager.get_active_workspace();
        const windows = this._getWindows(workspace);

        if (windows.length < 2) {
            this._cycle = null;
            return;
        }

        const rawFocus = global.display.focus_window;
        const focus = rawFocus?.is_attached_dialog()
            ? (rawFocus.get_transient_for() ?? rawFocus)
            : rawFocus;

        const now = Date.now();
        let cycle = this._cycle;

        const expired = !cycle || now - cycle.updatedAt > CYCLE_RESET_MS;
        const listChanged = cycle &&
            !cycle.windows.every(w => windows.includes(w));
        const focusChanged = cycle && cycle.lastActivated &&
            cycle.lastActivated !== focus &&
            now - cycle.updatedAt > FOCUS_GRACE_MS;

        if (expired || listChanged || focusChanged) {
            const focusIndex = windows.indexOf(focus);
            cycle = {
                windows,
                index: focusIndex >= 0 ? focusIndex : -1,
                lastActivated: null,
                updatedAt: now,
            };
            this._cycle = cycle;
        }

        cycle.index = (cycle.index + 1) % cycle.windows.length;

        const target = cycle.windows[cycle.index];
        cycle.lastActivated = target;
        cycle.updatedAt = now;

        if (target.minimized)
            target.unminimize();

        Main.activateWindow(target);
    }

    _getWindows(workspace) {
        const windows = global.display.get_tab_list(
            Meta.TabList.NORMAL_ALL, workspace);

        return windows
            .map(w => w.is_attached_dialog() ? w.get_transient_for() : w)
            .filter((w, i, a) => w && !w.skip_taskbar && a.indexOf(w) === i);
    }
}
