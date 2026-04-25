import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { ActivationBinding } from './activation.js';
import { WorkspaceSwitchDriver } from './workspaceSwitchDriver.js';

const ACTION_NAME = 'touchshell-overview-workspace-switch';
// Ignore micro-jitter before kicking off the workspace-switch gesture.
// Tap-to-activate fires on a brief touch; a few px of horizontal motion
// is needed before we commit the gesture pipeline.
const BEGIN_THRESHOLD_PX = 8;

// Single-finger horizontal swipe over the overview's controls actor
// drives WorkspacesDisplay's swipe pipeline 1:1. Attached in BUBBLE
// phase so window-preview gestures (flick-up-to-close, drag) attached
// in CAPTURE on the previews still win when the touch starts on a
// thumbnail. The gesture only ever fires when the overview is open
// because controls is invisible/non-interactive otherwise.
export class OverviewWorkspaceSwitchGesture {
    constructor(settings, tabletMode) {
        this._gesture = null;
        this._driver = new WorkspaceSwitchDriver();
        this._beganDriver = false;
        this._origReactive = null;
        this._controls = null;

        this._activation = new ActivationBinding(
            settings, tabletMode, 'overview-workspace-switch-activation',
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
        const controls = Main.overview?._overview?.controls;
        if (!controls)
            return;
        this._controls = controls;
        this._origReactive = controls.reactive;
        controls.reactive = true;

        this._gesture = new Clutter.PanGesture({
            maxNPoints: 1,
            panAxis: Clutter.PanAxis.X,
        });
        this._gesture.connect('recognize', _g => {
            this._beganDriver = false;
        });
        this._gesture.connect('pan-update', g => this._onUpdate(g));
        this._gesture.connect('end', g => this._onEnd(g));
        this._gesture.connect('cancel', _g => this._onCancel());

        controls.add_action_full(
            ACTION_NAME,
            Clutter.EventPhase.BUBBLE,
            this._gesture
        );
    }

    _teardown() {
        if (this._driver?.isActive)
            this._driver.cancel();
        this._beganDriver = false;
        if (this._controls && this._gesture) {
            this._controls.remove_action(this._gesture);
        }
        if (this._controls && this._origReactive !== null)
            this._controls.reactive = this._origReactive;
        this._gesture = null;
        this._controls = null;
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
