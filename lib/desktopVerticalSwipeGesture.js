import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { ActivationBinding } from './activation.js';
import { OverviewGestureDriver } from './overviewGestureDriver.js';

const ACTION_NAME = 'touchshell-desktop-vertical-swipe';
// Ignore micro-jitter so a tap doesn't briefly kick off the overview
// reveal pipeline. A few pixels of upward motion is required so a
// stationary touch or a downward pan doesn't flash the overview.
const BEGIN_THRESHOLD_PX = 2;

// Single-finger vertical swipe on the desktop background opens the
// Activities overview, with 1:1 finger tracking via OverviewGestureDriver
// — the same feel as the bottom-edge swipe, but reachable from any
// visible patch of desktop instead of only the bottom 50 px.
//
// Mirrors DesktopWorkspaceSwipeGesture's wiring: PanGesture on
// Main.layoutManager._backgroundGroup in BUBBLE phase, with the bg made
// reactive. The two gestures (horizontal workspace, vertical overview)
// coexist on the same actor on orthogonal axes.
//
// We do not handle the further step from overview → app-grid here; that
// belongs to OverviewVerticalSwipeGesture, which takes over once the
// overview is open.
export class DesktopVerticalSwipeGesture {
    constructor(settings, tabletMode) {
        this._settings = settings;
        this._gesture = null;
        this._bg = null;
        this._origReactive = null;
        this._beganDriver = false;

        // Same shared sensitivity as the bottom-edge → overview swipe and
        // the in-overview vertical swipe so all three feel identical.
        this._driver = new OverviewGestureDriver({
            distanceFactor:
                settings.get_int('overview-distance-percent') / 100,
        });
        this._distanceSettingsId = settings.connect(
            'changed::overview-distance-percent', () => {
                this._driver?.setDistanceFactor(
                    settings.get_int('overview-distance-percent') / 100);
            });

        this._activation = new ActivationBinding(
            settings, tabletMode, 'desktop-vertical-swipe-activation',
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
        const bg = Main.layoutManager?._backgroundGroup;
        if (!bg)
            return;
        this._bg = bg;
        this._origReactive = bg.reactive;
        bg.reactive = true;

        this._gesture = new Clutter.PanGesture({
            min_n_points: 1,
            max_n_points: 1,
            pan_axis: Clutter.PanAxis.Y,
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
        if (this._bg && this._gesture) {
            try {
                this._bg.remove_action(this._gesture);
            } catch (_) {
                // Background may have been destroyed in shell teardown.
            }
        }
        if (this._bg && this._origReactive !== null)
            this._bg.reactive = this._origReactive;
        this._gesture = null;
        this._bg = null;
        this._origReactive = null;
    }

    _canStart() {
        // Only open the overview from the desktop. If the overview is
        // already visible, OverviewVerticalSwipeGesture handles further
        // up/down motion (windows ↔ apps).
        if (Main.overview.visible)
            return false;
        return this._driver.canStart();
    }

    _onUpdate(g) {
        const dy = g.get_accumulated_delta().get_y();
        if (!this._beganDriver) {
            // Only commit to driving the overview reveal once we see
            // meaningful upward motion. A stationary touch or a
            // downward pan never triggers the pipeline.
            if (dy > -BEGIN_THRESHOLD_PX)
                return;
            if (!this._canStart())
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
