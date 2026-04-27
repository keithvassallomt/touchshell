import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { ActivationBinding } from './activation.js';
import { OverviewGestureDriver } from './overviewGestureDriver.js';

const ACTION_NAME = 'touchshell-overview-vertical-swipe';
// Ignore micro-jitter so a tap-to-activate doesn't drive the overview
// pipeline. Matches the workspace-switch threshold for symmetry.
const BEGIN_THRESHOLD_PX = 8;

// Single-finger vertical swipe over the overview's controls actor
// drives Main.overview's progress (HIDDEN/WINDOWS/APPS). Up reveals
// the next state (WINDOWS → APPS); down commits to the previous
// (APPS → WINDOWS, WINDOWS → desktop).
//
// BUBBLE phase on _controls so window-preview gestures (CAPTURE on
// each preview) still win when the touch starts on a thumbnail.
export class OverviewVerticalSwipeGesture {
    constructor(settings, tabletMode) {
        this._settings = settings;
        this._gesture = null;
        // Same setting as the bottom-edge swipe so opening and closing
        // the overview share their "feel".
        this._driver = new OverviewGestureDriver({
            distanceFactor:
                settings.get_int('overview-distance-percent') / 100,
        });
        this._distanceSettingsId = settings.connect(
            'changed::overview-distance-percent', () => {
                this._driver?.setDistanceFactor(
                    settings.get_int('overview-distance-percent') / 100);
            });
        this._beganDriver = false;
        this._controls = null;
        this._origReactive = null;

        this._activation = new ActivationBinding(
            settings, tabletMode, 'overview-vertical-swipe-activation',
            {
                onEnable: () => this._setup(),
                onDisable: () => this._teardown(),
            }
        );
    }

    destroy() {
        if (this._distanceSettingsId) {
            try { this._settings.disconnect(this._distanceSettingsId); }
            catch (_) {}
            this._distanceSettingsId = 0;
        }
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
            panAxis: Clutter.PanAxis.Y,
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
        if (this._controls && this._gesture)
            this._controls.remove_action(this._gesture);
        if (this._controls && this._origReactive !== null)
            this._controls.reactive = this._origReactive;
        this._gesture = null;
        this._controls = null;
        this._origReactive = null;
    }

    _onUpdate(g) {
        const dy = g.get_accumulated_delta().get_y();
        if (!this._beganDriver) {
            if (Math.abs(dy) < BEGIN_THRESHOLD_PX)
                return;
            // Only meaningful while the overview is open. The driver
            // itself only checks API availability now.
            if (!Main.overview.visible)
                return;
            if (!this._driver.begin())
                return;
            this._beganDriver = true;
        }
        this._driver.update(dy);
    }

    _onEnd(g) {
        if (!this._beganDriver)
            return;
        const velocity = g.get_velocity?.();
        const vy = velocity?.get_y?.() ?? 0;
        this._driver.end(vy);
        this._beganDriver = false;
    }

    _onCancel() {
        if (!this._beganDriver)
            return;
        this._driver.cancel();
        this._beganDriver = false;
    }
}
