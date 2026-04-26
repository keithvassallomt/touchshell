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
// Convention: finger swipe LEFT (dx < 0) → progress INCREASES → moves
// forward to the next workspace (the strip "scrolls" left, revealing
// the next workspace on the right). RTL layouts swap this — we don't
// support RTL yet.
export class WorkspaceSwitchDriver {
    constructor({
        controller = () => Main.overview?._overview?.controls?._workspacesDisplay,
        canStart = () => Main.overview.visible && !Main.overview.animationInProgress,
    } = {}) {
        this._controllerFn = controller;
        this._canStartFn = canStart;
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
                this._distance = distance;
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
    // (negative = leftward = move forward to next workspace).
    update(accumulatedDx) {
        if (!this._active)
            return;

        const deltaProgress = -accumulatedDx / this._distance;
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
    // pixels per millisecond. Negative = leftward = forward.
    end(velocityXPxPerMs) {
        if (!this._active)
            return;

        const lower = this._snapPoints[0];
        const upper = this._snapPoints[this._snapPoints.length - 1];
        const nextSnap = Math.min(upper, this._initialProgress + 1);
        const prevSnap = Math.max(lower, this._initialProgress - 1);

        const traveled = this._currentProgress - this._initialProgress;
        const isFlick = Math.abs(velocityXPxPerMs) > FLICK_VELOCITY_PX_PER_MS;
        let endProgress;
        if (velocityXPxPerMs < -FLICK_VELOCITY_PX_PER_MS) {
            // Strong leftward flick → next workspace.
            endProgress = nextSnap;
        } else if (velocityXPxPerMs > FLICK_VELOCITY_PX_PER_MS) {
            // Strong rightward flick → previous workspace.
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
            const progressPerMs = Math.abs(velocityXPxPerMs) / this._distance;
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
