import * as Main from 'resource:///org/gnome/shell/ui/main.js';

// Position-based commit threshold for slow deliberate drags.
const COMMIT_PROGRESS_FRACTION = 0.5;
// Flick-velocity shortcut: above this magnitude, commit by velocity
// direction regardless of how far the finger travelled. Calibrated from
// real journal data: deliberate slow drags top out around |2| px/ms,
// quick wrist flicks land in the 3-9 px/ms range. 3.0 cleanly separates
// intentional flicks from drag-then-release motions.
const FLICK_VELOCITY_PX_PER_MS = 3.0;
const MIN_DURATION = 100;
const MAX_DURATION = 400;

const LOG = (...a) => console.log('[touchshell:overview-driver]', ...a);

// Streams a 1:1 progress value into Main.overview._gestureBegin /
// _gestureUpdate / _gestureEnd so the overview reveal animation tracks
// finger position exactly the way the native 3-finger touchpad swipe
// does. Bypasses SwipeTracker entirely (the shell's overview tracker
// has allowDrag:false → 3-finger touchpad only).
//
// We pass a fake "tracker" object into _gestureBegin; ControlsManager.
// gestureBegin only calls confirmSwipe(distance, snapPoints, progress,
// cancelProgress) on it. confirmSwipe stashes the snap geometry; from
// then on we feed progress into _gestureUpdate ourselves.
export class OverviewGestureDriver {
    constructor() {
        this._active = false;
        this._distance = 1;
        this._snapPoints = [];
        this._initialProgress = 0;
        this._cancelProgress = 0;
        this._currentProgress = 0;
    }

    get isActive() {
        return this._active;
    }

    canStart() {
        const ov = Main.overview;
        if (!ov)
            return false;
        if (ov.animationInProgress)
            return false;
        if (ov.visible)
            return false;
        if (typeof ov._gestureBegin !== 'function')
            return false;
        if (typeof ov._gestureUpdate !== 'function')
            return false;
        if (typeof ov._gestureEnd !== 'function')
            return false;
        return true;
    }

    begin() {
        if (this._active)
            return true;
        if (!this.canStart())
            return false;

        let confirmed = false;
        const fakeTracker = {
            confirmSwipe: (distance, points, progress, cancelProgress) => {
                this._distance = distance;
                this._snapPoints = points;
                // Touchup notes the shell can hand back progress=1 even
                // when overview isn't yet visible; clamp defensively.
                this._initialProgress = Main.overview.visible ? progress : 0;
                this._currentProgress = this._initialProgress;
                this._cancelProgress = cancelProgress;
                confirmed = true;
            },
        };

        try {
            Main.overview._gestureBegin(fakeTracker);
        } catch (e) {
            LOG('gestureBegin threw:', e?.message ?? e);
            return false;
        }

        if (!confirmed) {
            LOG('controls.gestureBegin did not confirmSwipe; refusing');
            return false;
        }

        this._active = true;
        return true;
    }

    // accumulatedDy: cumulative y delta since gesture start, signed
    // (negative = up, the direction we want for opening the overview).
    update(accumulatedDy) {
        if (!this._active)
            return;

        // Sign convention: shell uses _getGestureDirFactor() = -1 for
        // vertical, equivalent to "swipe up (dy<0) → progress increases".
        const deltaProgress = -accumulatedDy / this._distance;

        const lower = this._snapPoints[0];
        const upper = Math.min(
            this._snapPoints[this._snapPoints.length - 1],
            Math.ceil(this._initialProgress) + 1
        );
        this._currentProgress = Math.max(lower, Math.min(upper,
            this._initialProgress + deltaProgress));

        try {
            Main.overview._gestureUpdate(null, this._currentProgress);
        } catch (e) {
            LOG('gestureUpdate threw:', e?.message ?? e);
            this._reset();
        }
    }

    // velocityYPxPerMs: signed Y component of the lift velocity in
    // pixels per millisecond (negative = up). Verified via journal logs.
    end(velocityYPxPerMs) {
        if (!this._active)
            return;

        const traveledFromStart = this._currentProgress - this._initialProgress;
        const nextSnap = Math.ceil(this._initialProgress + 0.0001);
        const prevSnap = Math.floor(this._initialProgress);

        const isFlick = Math.abs(velocityYPxPerMs) > FLICK_VELOCITY_PX_PER_MS;
        let endProgress;
        if (velocityYPxPerMs < -FLICK_VELOCITY_PX_PER_MS) {
            // Strong upward flick → commit forward regardless of position.
            endProgress = nextSnap;
        } else if (velocityYPxPerMs > FLICK_VELOCITY_PX_PER_MS) {
            // Strong downward flick → cancel back regardless of position.
            endProgress = prevSnap;
        } else {
            endProgress = traveledFromStart >= COMMIT_PROGRESS_FRACTION
                ? nextSnap
                : prevSnap;
        }

        const remaining = Math.abs(endProgress - this._currentProgress);
        // Velocity commits scale duration to lift speed so a hard flick
        // doesn't crawl. Position commits use a steady pace.
        let duration;
        if (isFlick) {
            const progressPerMs = Math.abs(velocityYPxPerMs) / this._distance;
            duration = remaining / progressPerMs;
        } else {
            duration = remaining * MAX_DURATION;
        }
        duration = Math.max(MIN_DURATION, Math.min(MAX_DURATION, duration));

        try {
            Main.overview._gestureEnd(null, duration, endProgress);
        } catch (e) {
            LOG('gestureEnd threw:', e?.message ?? e);
        }

        this._reset();
    }

    cancel() {
        if (!this._active)
            return;
        try {
            Main.overview._gestureEnd(null, MIN_DURATION, this._cancelProgress);
        } catch (e) {
            LOG('cancel threw:', e?.message ?? e);
        }
        this._reset();
    }

    _reset() {
        this._active = false;
        this._distance = 1;
        this._snapPoints = [];
        this._initialProgress = 0;
        this._cancelProgress = 0;
        this._currentProgress = 0;
    }
}
