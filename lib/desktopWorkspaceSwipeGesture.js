import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { ActivationBinding } from './activation.js';
import { WorkspaceSwitchDriver } from './workspaceSwitchDriver.js';

const ACTION_NAME = 'touchshell-desktop-workspace-swipe';
// Ignore micro-jitter so a tap doesn't kick off the workspace pipeline.
// Same calibration as the in-overview workspace gesture.
const BEGIN_THRESHOLD_PX = 8;

// Single-finger horizontal swipe on the desktop background drives
// Main.wm._workspaceAnimation 1:1 — same animation Mutter uses for
// the native 3-finger touch swipe / 4-finger touchpad swipe, but
// reachable with one finger.
//
// We make Main.layoutManager._backgroundGroup reactive and attach the
// gesture in BUBBLE phase. Clutter routes TOUCH_BEGIN to the topmost
// reactive actor at the touch coordinates: a window above wins; a
// visible patch of background routes here. CSD shadow regions are
// input-transparent in Mutter so swipes that look-like-background-on-
// shadow correctly fall through. No extra hit-test required.
export class DesktopWorkspaceSwipeGesture {
    constructor(settings, tabletMode) {
        this._gesture = null;
        this._bg = null;
        this._origReactive = null;
        this._beganDriver = false;

        this._driver = new WorkspaceSwitchDriver({
            controller: () => Main.wm?._workspaceAnimation,
            canStart: () =>
                !Main.overview.visible && !Main.overview.animationInProgress,
        });

        this._activation = new ActivationBinding(
            settings, tabletMode, 'desktop-workspace-switch-activation',
            {
                onEnable: () => this._setup(),
                onDisable: () => this._teardown(),
            }
        );
    }

    destroy() {
        this._driver?.cancel();
        this._activation?.destroy();
        this._activation = null;
    }

    _setup() {
        const bg = Main.layoutManager?._backgroundGroup;
        if (!bg)
            return;
        this._bg = bg;
        this._origReactive = bg.reactive;
        bg.reactive = true;

        this._gesture = new Clutter.PanGesture({
            min_n_points: 1,
            max_n_points: 1,
            pan_axis: Clutter.PanAxis.X,
        });
        this._gesture.connect('recognize', _g => {
            this._beganDriver = false;
        });
        this._gesture.connect('pan-update', g => this._onUpdate(g));
        this._gesture.connect('end', g => this._onEnd(g));
        this._gesture.connect('cancel', _g => this._onCancel());

        bg.add_action_full(
            ACTION_NAME,
            Clutter.EventPhase.BUBBLE,
            this._gesture
        );
    }

    _teardown() {
        if (this._driver?.isActive)
            this._driver.cancel();
        this._beganDriver = false;
        if (this._bg && this._gesture)
            this._bg.remove_action(this._gesture);
        if (this._bg && this._origReactive !== null)
            this._bg.reactive = this._origReactive;
        this._gesture = null;
        this._bg = null;
        this._origReactive = null;
    }

    _onUpdate(g) {
        const dx = g.get_accumulated_delta().get_x();
        if (!this._beganDriver) {
            if (Math.abs(dx) < BEGIN_THRESHOLD_PX)
                return;
            if (!this._driver.begin())
                return;
            this._beganDriver = true;
        }
        this._driver.update(dx);
    }

    _onEnd(g) {
        if (!this._beganDriver)
            return;
        const velocity = g.get_velocity?.();
        const vx = velocity?.get_x?.() ?? 0;
        this._driver.end(vx);
        this._beganDriver = false;
    }

    _onCancel() {
        if (!this._beganDriver)
            return;
        this._driver.cancel();
        this._beganDriver = false;
    }
}
