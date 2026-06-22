import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';

import { ActivationBinding } from './activation.js';
import { KeySynth } from './keySynth.js';

// Minimum release speed (px/s on the dominant axis) for a window-move
// drag to count as a deliberate "flick" rather than an ordinary
// drag-and-drop.
const FLICK_THRESHOLD = 1000;
// How far back from release (µs) the flick velocity is measured.
const FLICK_WINDOW_US = 120000;
const SAMPLE_MS = 16; // ~60fps

const DEBUG = false;
const LOG = (...a) => { if (DEBUG) console.log('[touchshell:tiling-flick]', ...a); };

// Touch-only flick-to-tile. While a window is dragged, sample its frame
// position; a fast flick at release snaps it: left/right tile to a half,
// up maximizes, down minimizes. A slow drag-and-drop stays put.
//
// Touch is detected by a standing tally of fingers down: a persistent
// stage capture-phase monitor counts TOUCH_BEGIN/END, which the shell
// sees before the event reaches the window. At grab-op-begin we check
// whether a finger is currently down — the touch that *starts* the drag
// is visible just before the grab, so this tells a touch drag from a
// mouse drag. Caveat: the move grab consumes the TOUCH_END that ends a
// drag, so _onEnd compensates that one unseen decrement by hand.
// Ceiling: a missed touch event from exotic multi-touch could drift the
// tally; teardown resets it, and the worst case is one mis-classified
// drag, not a crash.
export class WindowTilingFlickGesture {
    constructor(settings, tabletMode) {
        this._keySynth = null;
        this._timerId = 0;
        this._win = null;
        this._samples = [];
        this._touchActive = 0;

        this._activation = new ActivationBinding(
            settings, tabletMode, 'window-tiling-flick-activation',
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
        this._keySynth = new KeySynth();
        // Persistent touch tally — must be live before the grab starts.
        global.stage.connectObject('captured-event',
            (_a, event) => this._onEvent(event), this);
        global.display.connectObject(
            'grab-op-begin', (_d, win, op) => this._onBegin(win, op),
            'grab-op-end', (_d, win, op) => this._onEnd(win, op),
            this);
    }

    _teardown() {
        this._stopSampling();
        global.stage.disconnectObject(this);
        global.display.disconnectObject(this);
        this._win = null;
        this._samples = [];
        this._touchActive = 0;
        this._keySynth?.destroy();
        this._keySynth = null;
    }

    // Standing count of fingers on the screen.
    _onEvent(event) {
        const t = event.type();
        if (t === Clutter.EventType.TOUCH_BEGIN)
            this._touchActive++;
        else if (t === Clutter.EventType.TOUCH_END ||
                 t === Clutter.EventType.TOUCH_CANCEL)
            this._touchActive = Math.max(0, this._touchActive - 1);
        return Clutter.EVENT_PROPAGATE;
    }

    _onBegin(win, op) {
        if (op !== Meta.GrabOp.MOVING || !win)
            return;
        const isTouch = this._touchActive > 0;
        LOG('grab-op-begin touchActive=', this._touchActive, 'isTouch=', isTouch);
        // Touch-only: a mouse/keyboard move has no finger down.
        if (!isTouch)
            return;
        this._win = win;
        this._samples = [];
        this._startSampling();
    }

    _onEnd(_win, _op) {
        if (!this._win)
            return;
        this._stopSampling();
        // The TOUCH_END that lifts off to end this drag is consumed by the
        // move grab and never reaches our monitor, so the begin-side
        // increment for this drag would leak. Compensate it here, or the
        // tally stays >0 and a later mouse drag reads as touch.
        this._touchActive = Math.max(0, this._touchActive - 1);
        const target = this._win;
        this._win = null;

        const { vx, vy } = this._releaseVelocity();
        this._samples = [];
        LOG('release vx=', vx, 'vy=', vy);

        // Below threshold on both axes → ordinary drag-and-drop (R1).
        if (Math.abs(vx) < FLICK_THRESHOLD && Math.abs(vy) < FLICK_THRESHOLD)
            return;

        if (Math.abs(vx) >= Math.abs(vy))
            vx < 0 ? this._tileLeft(target) : this._tileRight(target);
        else
            vy < 0 ? this._maximize(target) : this._minimize(target);
    }

    _startSampling() {
        this._stopSampling();
        this._timerId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT, SAMPLE_MS, () => {
                const win = this._win;
                if (!win)
                    return GLib.SOURCE_REMOVE;
                const r = win.get_frame_rect();
                this._samples.push({ t: GLib.get_monotonic_time(), x: r.x, y: r.y });
                if (this._samples.length > 64)
                    this._samples.shift();
                return GLib.SOURCE_CONTINUE;
            });
    }

    _stopSampling() {
        if (this._timerId) {
            GLib.source_remove(this._timerId);
            this._timerId = 0;
        }
    }

    // px/s of the window frame over the last FLICK_WINDOW_US of samples.
    _releaseVelocity() {
        const s = this._samples;
        if (s.length < 2)
            return { vx: 0, vy: 0 };
        const last = s[s.length - 1];
        let first = s[0];
        for (let i = s.length - 1; i >= 0; i--) {
            if (last.t - s[i].t <= FLICK_WINDOW_US)
                first = s[i];
            else
                break;
        }
        const dt = (last.t - first.t) / 1e6;
        if (dt <= 0)
            return { vx: 0, vy: 0 };
        return { vx: (last.x - first.x) / dt, vy: (last.y - first.y) / dt };
    }

    // Tile via the native Super+←/→ keybinding so it matches drag-to-edge
    // tiling exactly and inherits Mutter's tile state for free.
    // Ceiling: breaks if the user rebinds toggle-tiled-left/right;
    // upgrade path is computing the half-rect with move_resize_frame().
    _tileLeft(win) {
        win.activate(global.get_current_time());
        this._keySynth.tileLeft();
    }

    _tileRight(win) {
        win.activate(global.get_current_time());
        this._keySynth.tileRight();
    }

    _maximize(win) {
        // GNOME 49: maximize() takes no args; means both axes.
        win.maximize();
    }

    _minimize(win) {
        if (win.can_minimize())
            win.minimize();
    }
}
