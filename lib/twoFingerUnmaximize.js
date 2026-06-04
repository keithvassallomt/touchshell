import Clutter from 'gi://Clutter';

import { ActivationBinding } from './activation.js';

const ACTION_NAME = 'touchshell-two-finger-unmaximize';
// Distance the two fingers must travel downward (in px) before the
// gesture commits. Calibrated to be larger than scroll noise but
// small enough that the user doesn't have to swipe halfway down.
const UNMAXIMIZE_THRESHOLD_PX = 80;

const DEBUG = false;
const LOG = (...a) => { if (DEBUG) console.log('[touchshell:unmax-swipe]', ...a); };

// Two-finger swipe down inside the focused maximized window's frame
// → unmaximize. CAPTURE phase on global.stage so we beat Mutter and
// any window-level handlers. Fires once per gesture.
export class TwoFingerUnmaximize {
    constructor(settings, tabletMode) {
        this._gesture = null;
        this._fired = false;
        this._startX = 0;
        this._startY = 0;
        this._haveStart = false;

        // Shares the activation key with auto-maximize: the swipe is
        // the escape hatch for the auto-maximize behavior, so they
        // toggle together (one Quick Settings tile, one prefs row).
        this._activation = new ActivationBinding(
            settings, tabletMode, 'auto-maximize-windows-activation',
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
        // Shell's own SwipeTracker uses snake_case for these props; use
        // the same form to avoid GJS auto-conversion surprises.
        this._gesture = new Clutter.PanGesture({
            min_n_points: 2,
            max_n_points: 2,
            pan_axis: Clutter.PanAxis.Y,
        });
        this._gesture.connect('should-handle-sequence', (_g, event) =>
            this._onShouldHandleSequence(event));
        this._gesture.connect('recognize', _g => {
            this._fired = false;
        });
        this._gesture.connect('pan-update', g => this._onUpdate(g));
        this._gesture.connect('end', _g => this._reset());
        this._gesture.connect('cancel', _g => this._reset());

        global.stage.add_action_full(
            ACTION_NAME,
            Clutter.EventPhase.CAPTURE,
            this._gesture
        );
    }

    _teardown() {
        if (this._gesture) {
            global.stage.remove_action(this._gesture);
            this._gesture = null;
        }
        this._reset();
    }

    _reset() {
        this._fired = false;
        this._haveStart = false;
        this._startX = 0;
        this._startY = 0;
    }

    // Called once per touch sequence. Capture the very first finger's
    // coordinates so we can later check it landed inside the window.
    _onShouldHandleSequence(event) {
        if (!this._haveStart) {
            const [x, y] = event.get_coords();
            this._startX = x;
            this._startY = y;
            this._haveStart = true;
        }
        return true;
    }

    _onUpdate(g) {
        if (this._fired)
            return;
        const dy = g.get_accumulated_delta().get_y();
        if (dy < UNMAXIMIZE_THRESHOLD_PX)
            return;

        const win = global.display.focus_window;
        if (!win)
            return;
        if (typeof win.is_fullscreen === 'function' && win.is_fullscreen())
            return;
        if (!(win.maximized_horizontally && win.maximized_vertically))
            return;

        // Geometry check: gesture must have started inside the
        // window's frame.
        if (this._haveStart) {
            const r = win.get_frame_rect();
            if (this._startX < r.x || this._startX >= r.x + r.width)
                return;
            if (this._startY < r.y || this._startY >= r.y + r.height)
                return;
        }

        this._fired = true;
        try {
            // GNOME 49: unmaximize() takes no args; means "both axes".
            win.unmaximize();
        } catch (e) {
            LOG('unmaximize threw:', e?.message ?? e);
        }
    }
}
