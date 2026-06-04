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
// Attached to global.stage in CAPTURE phase (not to _backgroundGroup
// in BUBBLE like the horizontal workspace sibling). Calling
// Main.overview._gestureBegin inside the driver makes _backgroundGroup
// inert mid-gesture, and a bg-attached action cancels the moment the
// bg loses reactivity. The stage stays put.
//
// should-handle-sequence gates us to touches whose pick lands on the
// background or a descendant — windows, chrome, and our own overlays
// pass through.
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
        settings.connectObject(
            'changed::overview-distance-percent', () => {
                this._driver?.setDistanceFactor(
                    settings.get_int('overview-distance-percent') / 100);
            }, this);

        this._activation = new ActivationBinding(
            settings, tabletMode, 'desktop-vertical-swipe-activation',
            {
                onEnable: () => this._setup(),
                onDisable: () => this._teardown(),
            }
        );
    }

    destroy() {
        this._settings?.disconnectObject(this);
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
        this._gesture.connect('should-handle-sequence',
            (_g, event) => this._shouldHandleSequence(event));
        this._gesture.connect('recognize', _g => {
            this._beganDriver = false;
        });
        this._gesture.connect('pan-update', g => this._onUpdate(g));
        this._gesture.connect('end', g => this._onEnd(g));
        this._gesture.connect('cancel', _g => this._onCancel());

        global.stage.add_action_full(
            ACTION_NAME,
            Clutter.EventPhase.CAPTURE,
            this._gesture
        );
    }

    _teardown() {
        if (this._driver?.isActive)
            this._driver.cancel();
        this._beganDriver = false;
        if (this._gesture) {
            try {
                global.stage.remove_action(this._gesture);
            } catch (_) {
                // Stage may have been destroyed in shell teardown.
            }
        }
        if (this._bg && this._origReactive !== null)
            this._bg.reactive = this._origReactive;
        this._gesture = null;
        this._bg = null;
        this._origReactive = null;
    }

    _shouldHandleSequence(event) {
        if (Main.overview.visible || Main.overview.animationInProgress)
            return false;
        const [x, y] = event.get_coords();
        const picked = global.stage.get_actor_at_pos(
            Clutter.PickMode.REACTIVE, x, y);
        if (!picked)
            return false;
        // Must be the background or a descendant of it. Anything else
        // (window, chrome, our own overlays) we let through.
        let a = picked;
        while (a) {
            if (a._touchshellOverlay)
                return false;
            if (a === this._bg)
                return true;
            a = a.get_parent();
        }
        return false;
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
