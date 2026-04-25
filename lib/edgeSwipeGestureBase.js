import Clutter from 'gi://Clutter';

import { ActivationBinding } from './activation.js';
import { monitorForPoint } from './utils.js';

const DEFAULT_MIN_DISTANCE_PX = 60;

// Base for the screen-edge swipe gestures (top-right, top-center,
// bottom-edge). Each one is a Clutter.PanGesture in CAPTURE phase on
// global.stage so that bezel-originating sequences reach us before
// Mutter's EdgeDragAction can grab them. See project_pan_gesture_pattern.md.
//
// Subclasses MUST override _isInZone() and _fire(), and pass actionName /
// activationKey / direction via opts. Optionally override _canStart() to
// add a pre-condition (e.g. "skip if Overview is already up").
export class EdgeSwipeGestureBase {
    constructor(settings, tabletMode, opts) {
        this._actionName = opts.actionName;
        this._direction = opts.direction;
        this._minDistance = opts.minDistance ?? DEFAULT_MIN_DISTANCE_PX;
        this._gesture = null;
        this._startX = 0;
        this._startY = 0;
        this._fired = false;

        this._activation = new ActivationBinding(
            settings, tabletMode, opts.activationKey,
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

    // Subclass hooks.
    _isInZone(_x, _y, _monitor) { return false; }
    _fire() { /* no-op */ }
    _canStart() { return true; }

    _setup() {
        this._gesture = new Clutter.PanGesture();
        this._gesture.connect('should-handle-sequence', (_g, event) =>
            this._shouldHandleSequence(event));
        this._gesture.connect('pan-update', () => this._onPanUpdate());
        this._gesture.connect('end', () => this._onEnd());
        this._gesture.connect('cancel', () => this._onEnd());
        global.stage.add_action_full(
            this._actionName,
            Clutter.EventPhase.CAPTURE,
            this._gesture
        );
    }

    _teardown() {
        if (this._gesture) {
            global.stage.remove_action(this._gesture);
            this._gesture = null;
        }
        this._fired = false;
    }

    _shouldHandleSequence(event) {
        if (!this._canStart())
            return false;
        const [x, y] = event.get_coords();
        const monitor = monitorForPoint(x, y);
        if (!monitor)
            return false;
        if (!this._isInZone(x, y, monitor))
            return false;
        this._startX = x;
        this._startY = y;
        this._fired = false;
        return true;
    }

    _onPanUpdate() {
        if (this._fired)
            return;
        const event = Clutter.get_current_event();
        if (!event)
            return;
        const [x, y] = event.get_coords();
        const dx = x - this._startX;
        const dy = y - this._startY;
        const projected = this._direction === 'up' ? -dy : dy;
        if (projected >= this._minDistance && projected > Math.abs(dx)) {
            this._fired = true;
            this._fire();
        }
    }

    _onEnd() {
        this._fired = false;
    }
}
