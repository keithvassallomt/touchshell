import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { EdgeSwipeGestureBase } from './edgeSwipeGestureBase.js';

const LEFT_EDGE_ZONE_PX = 28;
const VERTICAL_CORNER_GUARD_PX = 48;
const BEGIN_THRESHOLD_PX = 12;
const MIN_SWIPE_DISTANCE_PX = 60;
const MAX_VERTICAL_DRIFT_PX = 100;
const HOLD_JITTER_PX = 6;
const HOLD_TO_OVERVIEW_MS = 450;
const CYCLE_RESET_MS = 2000;
const FOCUS_GRACE_MS = 300;

// Left-edge inward swipe that cycles through the open windows on the
// active workspace (like Windows Tablet Mode):
//   - Quick swipe and release → activate the next window in MRU order.
//     Repeated swipes within CYCLE_RESET_MS step through a frozen
//     snapshot of the list instead of toggling between the top two.
//   - Swipe in and hold for HOLD_TO_OVERVIEW_MS → open the Activities
//     overview; releasing afterwards doesn't switch windows.
//
// The vertical corner guard keeps the zone clear of the top panel and
// the bottom-edge / action-bar strips.
export class LeftEdgeSwipeGesture extends EdgeSwipeGestureBase {
    constructor(settings, tabletMode) {
        super(settings, tabletMode, {
            actionName: 'touchshell-left-edge-swipe',
            activationKey: 'left-edge-swipe-activation',
            stream: true,
            panAxis: Clutter.PanAxis.X,
            gestureProps: {
                min_n_points: 1,
                max_n_points: 1,
                begin_threshold: BEGIN_THRESHOLD_PX,
            },
        });
        this._cycle = null;
        this._holdTimeoutId = 0;
        this._resetSequence();
    }

    _teardown() {
        this._resetSequence();
        this._cycle = null;
        super._teardown();
    }

    _canStart(event) {
        // Touch only: a mouse drag off the left edge isn't this gesture.
        if (event.type() !== Clutter.EventType.TOUCH_BEGIN)
            return false;
        // Covers the lock screen, popup menus and modal dialogs.
        if (!(Main.actionMode & Shell.ActionMode.NORMAL))
            return false;
        return !Main.overview.visible;
    }

    _isInZone(x, y, monitor) {
        const inLeftZone =
            x >= monitor.x && x <= monitor.x + LEFT_EDGE_ZONE_PX;
        const inVerticalRange =
            y >= monitor.y + VERTICAL_CORNER_GUARD_PX &&
            y <= monitor.y + monitor.height - VERTICAL_CORNER_GUARD_PX;
        return inLeftZone && inVerticalRange;
    }

    _streamBegin(_g) {
        this._resetSequence();
    }

    _streamUpdate(g) {
        if (this._holdTriggered)
            return;

        const delta = g.get_accumulated_delta();
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

        // Re-arm the hold timer only on real movement. A resting finger
        // still reports 1–3 px of capacitive jitter, which must not keep
        // postponing the hold.
        const moveDist = Math.hypot(dx - this._anchorX, dy - this._anchorY);
        if (!this._holdTimeoutId || moveDist >= HOLD_JITTER_PX) {
            this._anchorX = dx;
            this._anchorY = dy;
            this._armHoldTimer();
        }
    }

    _streamEnd(_g) {
        const wasHeld = this._holdTriggered;
        const dx = this._lastDx;
        const dy = this._lastDy;

        this._resetSequence();

        if (wasHeld || Main.overview.visible)
            return;
        if (dx < MIN_SWIPE_DISTANCE_PX)
            return;
        if (Math.abs(dy) > MAX_VERTICAL_DRIFT_PX || Math.abs(dy) > dx)
            return;

        this._switchToNextWindow();
    }

    _streamCancel(_g) {
        this._resetSequence();
    }

    _resetSequence() {
        this._clearHoldTimer();
        this._holdTriggered = false;
        this._lastDx = 0;
        this._lastDy = 0;
        this._anchorX = 0;
        this._anchorY = 0;
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
        this._holdTriggered = true;
        this._cycle = null;
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
            ? rawFocus.get_transient_for()
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

        // Unminimizes the target too (meta_window_activate does it).
        Main.activateWindow(target);
    }

    // Same filtering as GNOME's window switcher (altTab.js getWindows):
    // attached dialogs map to their parent, skip-taskbar windows drop out.
    _getWindows(workspace) {
        const windows = global.display.get_tab_list(
            Meta.TabList.NORMAL_ALL, workspace);

        return windows
            .map(w => w.is_attached_dialog() ? w.get_transient_for() : w)
            .filter((w, i, a) => !w.skip_taskbar && a.indexOf(w) === i);
    }
}
