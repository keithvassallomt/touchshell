import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { ActivationBinding } from './activation.js';
import { monitorForPoint } from './utils.js';

const DEFAULT_MIN_DISTANCE_PX = 60;

// Base for the screen-edge swipe gestures (top-right, top-center,
// bottom-edge). Each one is a Clutter.PanGesture in CAPTURE phase on
// global.stage so that bezel-originating sequences reach us before
// Mutter's EdgeDragAction can grab them. See project_pan_gesture_pattern.md.
//
// Two modes:
//   - Default (fire-on-threshold): subclass overrides _isInZone()/_fire(),
//     passes direction + minDistance. Used by TopRight/TopCenter — these
//     just need a one-shot trigger when the swipe crosses a threshold.
//   - Streaming (opts.stream === true): subclass overrides _isInZone() and
//     the four hooks _streamBegin/_streamUpdate/_streamEnd/_streamCancel
//     to drive a per-frame animation (e.g. 1:1 overview reveal). direction
//     and minDistance are not used.
//
// Optionally override _canStart() in either mode to add a pre-condition.
export class EdgeSwipeGestureBase {
    constructor(settings, tabletMode, opts) {
        this._actionName = opts.actionName;
        this._direction = opts.direction;
        this._minDistance = opts.minDistance ?? DEFAULT_MIN_DISTANCE_PX;
        this._stream = !!opts.stream;
        this._panAxis = opts.panAxis ?? null;
        this._gesture = null;
        this._startX = 0;
        this._startY = 0;
        this._fired = false;

        // Tracks a touch sequence we've claimed away from a panel button
        // because it started on top of one. See _onCapturedEvent.
        this._panelTouch = null;
        this._capturedId = 0;

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

    // Subclass hooks (default mode).
    _isInZone(_x, _y, _monitor) { return false; }
    _fire() { /* no-op */ }
    _canStart() { return true; }

    // Subclass hooks (stream mode). Each receives the Clutter.PanGesture.
    _streamBegin(_g) { /* no-op */ }
    _streamUpdate(_g) { /* no-op */ }
    _streamEnd(_g) { /* no-op */ }
    _streamCancel(_g) { /* no-op */ }

    _setup() {
        // Restricting pan_axis when the subclass is single-axis (e.g.
        // bottom-edge upward swipe) lets other gestures on the same
        // surface coexist on the orthogonal axis without recognition
        // races. Without this, an unrestricted PanGesture in CAPTURE
        // would steal horizontal swipes inside the same zone — see
        // the action bar's PanAxis.X gesture in lib/actionBar.js.
        const props = this._panAxis !== null
            ? { pan_axis: this._panAxis }
            : {};
        this._gesture = new Clutter.PanGesture(props);
        this._gesture.connect('should-handle-sequence', (_g, event) =>
            this._shouldHandleSequence(event));
        if (this._stream) {
            this._gesture.connect('recognize', g => this._streamBegin(g));
            this._gesture.connect('pan-update', g => this._streamUpdate(g));
            this._gesture.connect('end', g => this._streamEnd(g));
            this._gesture.connect('cancel', g => this._streamCancel(g));
        } else {
            this._gesture.connect('pan-update', () => this._onPanUpdate());
            this._gesture.connect('end', () => this._onEnd());
            this._gesture.connect('cancel', () => this._onEnd());
        }
        global.stage.add_action_full(
            this._actionName,
            Clutter.EventPhase.CAPTURE,
            this._gesture
        );

        // Fire-on-threshold gestures (top-right, top-center) overlap the
        // panel; PanGesture only claims the sequence after the deadzone
        // is crossed, so panel buttons (date menu, quick-settings, etc.)
        // open on TOUCH_BEGIN before the gesture has a chance to win.
        // Snoop captured-event before any action runs: if the touch
        // starts on a panel actor inside the trigger zone, claim it
        // outright, decide swipe-vs-tap from movement, and forward a
        // synthesized tap to the picked button on lift if no swipe
        // fired. Stream-mode gestures don't overlap the panel so they
        // don't need this dance.
        if (!this._stream) {
            this._capturedId = global.stage.connect('captured-event',
                (_a, event) => this._onCapturedEvent(event));
        }
    }

    _teardown() {
        if (this._capturedId) {
            global.stage.disconnect(this._capturedId);
            this._capturedId = 0;
        }
        this._panelTouch = null;
        if (this._gesture) {
            global.stage.remove_action(this._gesture);
            this._gesture = null;
        }
        this._fired = false;
    }

    _shouldHandleSequence(event) {
        if (!this._canStart())
            return false;
        // If captured-event already claimed this sequence (touch landed
        // on a panel button), don't let PanGesture also track it.
        if (this._panelTouch &&
            event.get_event_sequence() === this._panelTouch.sequence)
            return false;
        const [x, y] = event.get_coords();
        // Don't claim touches that started on a touchshell overlay
        // actor (currently: the text-action FAB and its bar). Those
        // actors set _touchshellOverlay = true on themselves and have
        // their own touch handling (drag, tap) — eating the sequence
        // in CAPTURE here would deny them TOUCH_UPDATE. We use an
        // explicit marker rather than walking up to uiGroup because
        // window content also lives under uiGroup and we'd block
        // every in-window gesture if we didn't discriminate.
        const picked = global.stage.get_actor_at_pos(
            Clutter.PickMode.REACTIVE, x, y);
        if (picked && this._isMarkedOverlay(picked))
            return false;
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

    _isMarkedOverlay(actor) {
        let a = actor;
        while (a) {
            if (a._touchshellOverlay)
                return true;
            a = a.get_parent();
        }
        return false;
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

    _onCapturedEvent(event) {
        const type = event.type();

        if (type === Clutter.EventType.TOUCH_BEGIN) {
            // Single-touch interception only; if a sequence is already
            // mid-flight let secondary touches propagate normally.
            if (this._panelTouch)
                return Clutter.EVENT_PROPAGATE;
            if (!this._canStart())
                return Clutter.EVENT_PROPAGATE;
            const [x, y] = event.get_coords();
            const monitor = monitorForPoint(x, y);
            if (!monitor)
                return Clutter.EVENT_PROPAGATE;
            if (!this._isInZone(x, y, monitor))
                return Clutter.EVENT_PROPAGATE;
            const picked = global.stage.get_actor_at_pos(
                Clutter.PickMode.REACTIVE, x, y);
            if (!picked || !this._isPanelDescendant(picked))
                return Clutter.EVENT_PROPAGATE;
            this._panelTouch = {
                sequence: event.get_event_sequence(),
                startX: x,
                startY: y,
                pickedActor: picked,
            };
            this._fired = false;
            return Clutter.EVENT_STOP;
        }

        if (!this._panelTouch)
            return Clutter.EVENT_PROPAGATE;
        if (event.get_event_sequence() !== this._panelTouch.sequence)
            return Clutter.EVENT_PROPAGATE;

        if (type === Clutter.EventType.TOUCH_UPDATE) {
            if (!this._fired) {
                const [x, y] = event.get_coords();
                const dx = x - this._panelTouch.startX;
                const dy = y - this._panelTouch.startY;
                const projected = this._direction === 'up' ? -dy : dy;
                if (projected >= this._minDistance &&
                    projected > Math.abs(dx)) {
                    this._fired = true;
                    this._fire();
                }
            }
            return Clutter.EVENT_STOP;
        }

        if (type === Clutter.EventType.TOUCH_END) {
            const wasSwipe = this._fired;
            const target = this._panelTouch.pickedActor;
            this._panelTouch = null;
            this._fired = false;
            if (!wasSwipe)
                this._forwardTap(target);
            return Clutter.EVENT_STOP;
        }

        if (type === Clutter.EventType.TOUCH_CANCEL) {
            this._panelTouch = null;
            this._fired = false;
            return Clutter.EVENT_STOP;
        }

        return Clutter.EVENT_PROPAGATE;
    }

    _isPanelDescendant(actor) {
        let a = actor;
        while (a) {
            if (a === Main.panel)
                return true;
            a = a.get_parent();
        }
        return false;
    }

    // Replays a tap on the originally-targeted panel actor. Walk up
    // looking for a PanelMenu.Button (anything with a toggleable .menu);
    // those open via menu.toggle(). Falls back to emitting 'clicked' on
    // the picked actor for plain St.Buttons. Tap on empty panel space
    // (no menu, no clicked handler) is silently dropped — same as a
    // bare panel click.
    _forwardTap(actor) {
        let a = actor;
        while (a && a !== Main.panel) {
            if (typeof a.menu?.toggle === 'function') {
                try {
                    a.menu.toggle();
                } catch (_) { /* menu may have torn down */ }
                return;
            }
            a = a.get_parent();
        }
        try {
            actor.emit('clicked');
        } catch (_) { /* not clickable; tap dropped */ }
    }
}
