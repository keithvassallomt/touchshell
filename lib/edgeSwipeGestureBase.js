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
//
// Wayland panel-touch quirk: when a touch sequence's TOUCH_BEGIN is picked
// on chrome (Main.panel and friends), Mutter delivers TOUCH_UPDATE/END only
// to the picked actor — they do NOT reach stage-level CAPTURE-phase actions
// or the stage's `captured-event` signal. A stage-attached PanGesture
// therefore never sees motion for swipes that start on the panel — even on
// bare panel area, not just on a button — and can't recognize them.
//
// To recover the swipe-from-panel case, non-stream gestures may opt into a
// reactive overlay actor placed in the gesture's panel-area strip. The
// overlay becomes the picked actor (it's reactive and registered as chrome
// above the panel), so a PanGesture attached to it sees the entire touch
// sequence. Subclasses opt in by overriding _getOverlayBounds(monitor) to
// return {x, y, width, height}; returning null disables the overlay (the
// default for stream gestures and for any subclass that doesn't overlap
// chrome).
//
// Tap forwarding: if the overlay's PanGesture doesn't recognize a swipe by
// TOUCH_END, we synthesize a click on the actor that would have been picked
// without the overlay (typically a panel indicator). That keeps short
// finger-taps on the strip working as taps on the underlying button.
export class EdgeSwipeGestureBase {
    constructor(settings, tabletMode, opts) {
        // Store settings on `this` BEFORE constructing the
        // ActivationBinding. The binding's internal _sync runs
        // synchronously during construction; if activation is on, it
        // immediately calls onEnable → _setup → _setupOverlay →
        // _getOverlayBounds (subclass), and that subclass override
        // typically reads this._settings. The subclass's own
        // `this._settings = settings` line runs after super() returns,
        // which is too late.
        this._settings = settings;

        this._actionName = opts.actionName;
        this._direction = opts.direction;
        this._minDistance = opts.minDistance ?? DEFAULT_MIN_DISTANCE_PX;
        this._stream = !!opts.stream;
        this._panAxis = opts.panAxis ?? null;
        this._stageGesture = null;
        this._overlay = null;
        this._overlayGesture = null;
        this._overlayEventId = 0;
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

    // Subclass hooks (default mode).
    _isInZone(_x, _y, _monitor) { return false; }
    _fire() { /* no-op */ }
    _canStart() { return true; }

    // Subclass hooks (stream mode). Each receives the Clutter.PanGesture.
    _streamBegin(_g) { /* no-op */ }
    _streamUpdate(_g) { /* no-op */ }
    _streamEnd(_g) { /* no-op */ }
    _streamCancel(_g) { /* no-op */ }

    // Override to enable the panel-overlap overlay for this gesture.
    // Return {x, y, width, height} or null. Default: no overlay.
    _getOverlayBounds(_monitor) { return null; }

    _setup() {
        this._stageGesture = this._buildStageGesture();
        global.stage.add_action_full(
            this._actionName,
            Clutter.EventPhase.CAPTURE,
            this._stageGesture
        );

        if (!this._stream)
            this._setupOverlay();
    }

    _buildStageGesture() {
        // Restricting pan_axis when the subclass is single-axis (e.g.
        // bottom-edge upward swipe) lets other gestures on the same
        // surface coexist on the orthogonal axis without recognition
        // races. Without this, an unrestricted PanGesture in CAPTURE
        // would steal horizontal swipes inside the same zone — see
        // the action bar's PanAxis.X gesture in lib/actionBar.js.
        const props = this._panAxis !== null
            ? { pan_axis: this._panAxis }
            : {};
        const gesture = new Clutter.PanGesture(props);
        gesture.connect('should-handle-sequence', (_g, event) =>
            this._stageShouldHandleSequence(event));
        if (this._stream) {
            gesture.connect('recognize', g => this._streamBegin(g));
            gesture.connect('pan-update', g => this._streamUpdate(g));
            gesture.connect('end', g => this._streamEnd(g));
            gesture.connect('cancel', g => this._streamCancel(g));
        } else {
            gesture.connect('pan-update', () => this._onPanUpdate());
            gesture.connect('end', () => this._onEnd());
            gesture.connect('cancel', () => this._onEnd());
        }
        return gesture;
    }

    _setupOverlay() {
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor)
            return;
        const bounds = this._getOverlayBounds(monitor);
        if (!bounds)
            return;

        this._overlay = new Clutter.Actor({
            reactive: true,
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height,
        });
        // Marker so the stage-level gesture's _isMarkedOverlay check
        // refuses to also volunteer for sequences picked on us; only
        // the overlay's own gesture should track these.
        this._overlay._touchshellOverlay = true;

        Main.layoutManager.addChrome(this._overlay, { trackFullscreen: true });

        this._overlayGesture = new Clutter.PanGesture();
        this._overlayGesture.connect('should-handle-sequence',
            (_g, event) => this._overlayShouldHandleSequence(event));
        this._overlayGesture.connect('pan-update',
            () => this._onPanUpdate());
        this._overlayGesture.connect('end', () => this._onEnd());
        this._overlayGesture.connect('cancel', () => this._onEnd());
        this._overlay.add_action_full(
            `${this._actionName}-overlay`,
            Clutter.EventPhase.CAPTURE,
            this._overlayGesture
        );

        // Tap forwarding. The overlay shadows the panel strip from
        // normal click handling — without replaying short taps, the
        // panel buttons stop responding inside the overlay area.
        this._overlayEventId = this._overlay.connect('event', (_a, event) => {
            const t = event.type();
            if (t !== Clutter.EventType.TOUCH_END &&
                t !== Clutter.EventType.BUTTON_RELEASE)
                return Clutter.EVENT_PROPAGATE;
            if (this._fired)
                return Clutter.EVENT_PROPAGATE;
            const [x, y] = event.get_coords();
            this._forwardTap(x, y);
            return Clutter.EVENT_PROPAGATE;
        });
    }

    _teardown() {
        if (this._stageGesture) {
            global.stage.remove_action(this._stageGesture);
            this._stageGesture = null;
        }
        this._teardownOverlay();
        this._fired = false;
    }

    _teardownOverlay() {
        if (this._overlayEventId && this._overlay) {
            this._overlay.disconnect(this._overlayEventId);
            this._overlayEventId = 0;
        }
        if (this._overlay) {
            Main.layoutManager.removeChrome(this._overlay);
            this._overlay.destroy();
            this._overlay = null;
        }
        this._overlayGesture = null;
    }

    _stageShouldHandleSequence(event) {
        if (!this._canStart())
            return false;
        const [x, y] = event.get_coords();
        // Don't claim touches that started on a touchshell overlay
        // actor (text-action FAB, our panel-overlay strip). Those
        // actors set _touchshellOverlay = true; the overlay's own
        // gesture handles those sequences.
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

    _overlayShouldHandleSequence(event) {
        if (!this._canStart())
            return false;
        const [x, y] = event.get_coords();
        // The overlay actor's bounds may extend slightly beyond the
        // gesture's logical zone (it's pinned to panel height, not
        // the swipe zone height); double-check.
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

    // Don't reset _fired here. The overlay's 'event' signal handler
    // reads _fired on TOUCH_END to decide whether to forward a tap.
    // PanGesture's 'end' may fire before that signal handler, and
    // resetting here would cause a successful swipe to also forward a
    // tap — which would re-toggle the menu we just opened. _fired is
    // reset at the start of every new sequence in should-handle-sequence,
    // which is sufficient.
    _onEnd() { /* no-op */ }

    // Synthesize a tap on the actor that would have received this
    // touch if the overlay weren't intercepting. We hide the overlay
    // from the picker (set reactive=false), repick at the touch
    // coordinates, then restore. PanelMenu.Buttons toggle their menu;
    // plain St.Buttons get a 'clicked' emit. Anything else (bare panel
    // strip, non-clickable area) is silently dropped — matches the
    // baseline behaviour of clicking empty panel space.
    _forwardTap(x, y) {
        if (!this._overlay)
            return;
        this._overlay.reactive = false;
        let target;
        try {
            target = global.stage.get_actor_at_pos(
                Clutter.PickMode.REACTIVE, x, y);
        } finally {
            this._overlay.reactive = true;
        }
        if (!target)
            return;
        let a = target;
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
            target.emit('clicked');
        } catch (_) { /* not clickable; tap dropped */ }
    }
}
