import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

// Above this px/ms magnitude on the X axis a swipe commits forward/back
// regardless of how far the finger travelled — same calibration window
// the overview driver uses on the Y axis.
const FLICK_VELOCITY_PX_PER_MS = 3.0;
// Position-based commit threshold for slow deliberate drags.
const COMMIT_PROGRESS_FRACTION = 0.5;
const MIN_DURATION = 100;
const MAX_DURATION = 400;

const LOG = (...a) => console.log('[touchshell:wsswitch-driver]', ...a);

// Streams a 1:1 progress value into a workspace-switch controller's
// _switchWorkspace* methods so the workspace strip tracks the finger
// exactly the way the native 4-finger touchpad swipe does.
//
// Two controllers share this exact API surface:
//   - WorkspacesDisplay (overview):
//       Main.overview._overview.controls._workspacesDisplay
//   - WorkspaceAnimationController (desktop):
//       Main.wm._workspaceAnimation
//
// The driver is parameterized over `controller` (a function returning
// the live controller object — late-bound so we don't capture stale
// references) and `canStart` (a predicate gating .begin()). Defaults
// preserve the original overview behavior for the existing call site.
//
// confirmSwipe(distance, snapPoints, progress, cancelProgress):
//   distance      = px per one workspace step
//   snapPoints    = [0, 1, ..., n_workspaces - 1]
//   progress      = current workspace index (float)
//   cancelProgress= nearest integer to fall back to on cancel
//
// Convention: a finger swipe LEFT moves the strip LEFT regardless of
// locale (direct manipulation). The mapping from dx to progress depends
// on text direction because Mutter mirrors the workspace strip in RTL —
// gnome-shell's MonitorGroup positions the next workspace at +baseDistance
// in LTR but -baseDistance in RTL, and inverts its progress getter
// accordingly (js/ui/workspaceAnimation.js). To keep the same physical
// swipe → same physical strip motion in both layouts, we negate dx in
// RTL: where LTR sends +progress for a leftward swipe (next workspace
// in LTR, on the right), RTL sends -progress for the same leftward
// swipe (which reaches the workspace on the right, i.e. the previous
// index, since the strip is mirrored).
export class WorkspaceSwitchDriver {
    constructor({
        controller = () => Main.overview?._overview?.controls?._workspacesDisplay,
        canStart = () => Main.overview.visible && !Main.overview.animationInProgress,
        distanceFactor = 1.0,
    } = {}) {
        this._controllerFn = controller;
        this._canStartFn = canStart;
        // Scales the per-step distance reported by confirmSwipe. < 1.0
        // means less finger travel per workspace step (snappier gesture);
        // 1.0 means 1:1 with the controller's reported distance (typically
        // monitor width). Touchup uses ~0.62 for its bar; we expose this
        // per call site so each surface can tune its own feel.
        this._distanceFactor = distanceFactor;
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

    // Update the per-step distance factor. Read at the next .begin();
    // an in-flight gesture keeps the factor it started with.
    setDistanceFactor(factor) {
        this._distanceFactor = factor;
    }

    _isRtl() {
        return Clutter.get_default_text_direction() ===
            Clutter.TextDirection.RTL;
    }

    canStart() {
        const c = this._controllerFn();
        if (!c)
            return false;
        if (!this._canStartFn())
            return false;
        if (typeof c._switchWorkspaceBegin !== 'function')
            return false;
        if (typeof c._switchWorkspaceUpdate !== 'function')
            return false;
        if (typeof c._switchWorkspaceEnd !== 'function')
            return false;
        if (global.workspace_manager.layout_rows === -1)
            return false;
        if (global.workspace_manager.n_workspaces < 2)
            return false;
        return true;
    }

    begin() {
        if (this._active)
            return true;
        if (!this.canStart())
            return false;

        const wd = this._controllerFn();
        let confirmed = false;
        const fakeTracker = {
            confirmSwipe: (distance, points, progress, cancelProgress) => {
                this._distance = distance * this._distanceFactor;
                this._snapPoints = points;
                this._initialProgress = progress;
                this._currentProgress = progress;
                this._cancelProgress = cancelProgress;
                confirmed = true;
            },
        };

        try {
            wd._switchWorkspaceBegin(fakeTracker, Main.layoutManager.primaryIndex);
        } catch (e) {
            LOG('switchWorkspaceBegin threw:', e?.message ?? e);
            return false;
        }

        if (!confirmed) {
            LOG('did not confirmSwipe; refusing');
            return false;
        }

        this._active = true;
        return true;
    }

    // accumulatedDx: cumulative x delta since gesture start, signed
    // (negative = leftward physical motion). In LTR a leftward swipe
    // increases progress (advancing to the next workspace, which is
    // on the right); in RTL the strip is mirrored so the same leftward
    // swipe must decrease progress (reaching the workspace on the
    // right, which is the previous index). See the header comment.
    update(accumulatedDx) {
        if (!this._active)
            return;

        const dx = this._isRtl() ? -accumulatedDx : accumulatedDx;
        const deltaProgress = -dx / this._distance;
        const lower = this._snapPoints[0];
        const upper = this._snapPoints[this._snapPoints.length - 1];
        this._currentProgress = Math.max(lower, Math.min(upper,
            this._initialProgress + deltaProgress));

        const wd = this._controllerFn();
        try {
            wd._switchWorkspaceUpdate(null, this._currentProgress);
        } catch (e) {
            LOG('switchWorkspaceUpdate threw:', e?.message ?? e);
            this._reset();
        }
    }

    // velocityXPxPerMs: signed X component of the lift velocity in
    // pixels per millisecond. The dx flip we apply in update() also
    // applies here so the flick interpretation matches: a physical
    // leftward flick still goes to whichever workspace is on the right
    // (next in LTR, prev in RTL), preserving direct manipulation.
    end(velocityXPxPerMs) {
        if (!this._active)
            return;

        const vx = this._isRtl() ? -velocityXPxPerMs : velocityXPxPerMs;
        const lower = this._snapPoints[0];
        const upper = this._snapPoints[this._snapPoints.length - 1];
        const nextSnap = Math.min(upper, this._initialProgress + 1);
        const prevSnap = Math.max(lower, this._initialProgress - 1);

        const traveled = this._currentProgress - this._initialProgress;
        const isFlick = Math.abs(vx) > FLICK_VELOCITY_PX_PER_MS;
        let endProgress;
        if (vx < -FLICK_VELOCITY_PX_PER_MS) {
            // Strong leftward (LTR) / rightward (RTL) flick → forward
            // progress (advance to next workspace index).
            endProgress = nextSnap;
        } else if (vx > FLICK_VELOCITY_PX_PER_MS) {
            // Strong rightward (LTR) / leftward (RTL) flick → backward
            // progress (return to previous workspace index).
            endProgress = prevSnap;
        } else if (traveled >= COMMIT_PROGRESS_FRACTION) {
            endProgress = nextSnap;
        } else if (traveled <= -COMMIT_PROGRESS_FRACTION) {
            endProgress = prevSnap;
        } else {
            endProgress = Math.round(this._initialProgress);
        }

        const remaining = Math.abs(endProgress - this._currentProgress);
        let duration;
        if (isFlick) {
            const progressPerMs = Math.abs(vx) / this._distance;
            duration = remaining / progressPerMs;
        } else {
            duration = remaining * MAX_DURATION;
        }
        duration = Math.max(MIN_DURATION, Math.min(MAX_DURATION, duration));

        const wd = this._controllerFn();
        try {
            wd._switchWorkspaceEnd(null, duration, endProgress);
        } catch (e) {
            LOG('switchWorkspaceEnd threw:', e?.message ?? e);
        }

        this._reset();
    }

    cancel() {
        if (!this._active)
            return;
        const wd = this._controllerFn();
        if (wd) {
            try {
                wd._switchWorkspaceEnd(null, MIN_DURATION, this._cancelProgress);
            } catch (e) {
                LOG('cancel threw:', e?.message ?? e);
            }
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
