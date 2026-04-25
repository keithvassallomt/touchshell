import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Graphene from 'gi://Graphene';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Workspace } from 'resource:///org/gnome/shell/ui/workspace.js';

import { ActivationBinding } from './activation.js';

const MIN_FLICK_DISTANCE_PX = 50;
// Press-visual delay and DnD timeout are intentionally the same value:
// the visual must fire at exactly the moment drag becomes possible,
// otherwise the user sees "ready" feedback while motion is still being
// silently rejected by DnD. 250ms is comfortably longer than any real
// flick (which completes in <100ms, well before drag is eligible) and
// short enough not to feel sluggish.
const READY_MS = 250;
const PRESS_SCALE = 0.92;
const PRESS_OPACITY = 200;
const PRESS_UP_MS = 120;

const LOG = (...a) => console.log('[touchshell:flick]', ...a);

export class FlickToCloseGesture {
    constructor(settings, tabletMode) {
        this._patched = new Map();
        this._origAddWindowClone = null;

        this._activation = new ActivationBinding(
            settings, tabletMode, 'flick-to-close-activation',
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
        this._origAddWindowClone = Workspace.prototype._addWindowClone;
        const orig = this._origAddWindowClone;
        const self = this;
        Workspace.prototype._addWindowClone = function (...args) {
            const result = orig.apply(this, args);
            const preview = this._windows?.at?.(-1);
            if (preview)
                self._patchPreview(preview);
            return result;
        };
        this._forEachExistingPreview(p => this._patchPreview(p));
    }

    _teardown() {
        if (this._origAddWindowClone) {
            Workspace.prototype._addWindowClone = this._origAddWindowClone;
            this._origAddWindowClone = null;
        }
        for (const [preview, info] of this._patched)
            this._unpatchPreview(preview, info);
        this._patched.clear();
    }

    _forEachExistingPreview(fn) {
        const wsViews = Main.overview?._overview?.controls?._workspacesDisplay
            ?._workspacesViews;
        if (!wsViews)
            return;
        for (const view of wsViews) {
            const workspaces = view._workspaces;
            if (!workspaces)
                continue;
            for (const ws of workspaces) {
                if (Array.isArray(ws._windows))
                    ws._windows.forEach(fn);
            }
        }
    }

    _slotOf(event) {
        return event.get_event_sequence()?.get_slot?.() ?? null;
    }

    _patchPreview(preview) {
        if (!preview || this._patched.has(preview))
            return;

        const dnd = preview._draggable?._dndGesture;
        let origDndTimeout;
        if (dnd && 'timeout_threshold' in dnd) {
            origDndTimeout = dnd.timeout_threshold;
            dnd.timeout_threshold = READY_MS;
        }

        const gesture = new Clutter.PanGesture({
            maxNPoints: 1,
            panAxis: Clutter.PanAxis.Y,
        });

        const info = {
            gesture,
            origDndTimeout,
            destroyId: 0,
            capturedId: 0,
            dragBeginId: 0,
            dragEndId: 0,
            dragInProgress: false,
            firedFlick: false,
            pressSlot: null,
            pressTimeoutId: 0,
            pressShown: false,
        };

        gesture.connect('may-recognize', () => {
            return gesture.get_accumulated_delta().get_y() <= 0;
        });

        gesture.connect('end', () => {
            const dy = gesture.get_accumulated_delta().get_y();
            if (-dy < MIN_FLICK_DISTANCE_PX)
                return;
            info.firedFlick = true;
            const title = preview._metaWindow?.get_title?.() ?? '?';
            LOG('upward flick on', title, 'dy=', dy.toFixed(0), '— closing');
            try {
                preview._deleteAll?.();
            } catch (e) {
                LOG('  _deleteAll threw:', e?.message ?? e);
            }
        });

        preview.add_action_full(
            'touchshell-flick-to-close',
            Clutter.EventPhase.CAPTURE,
            gesture
        );

        // Press-feedback: observe touches on the preview without claiming
        // sequences. Triggers a tiny scale/opacity cue on touch-begin and
        // reverts it on touch-end (unless drag or flick took over).
        info.capturedId = preview.connect(
            'captured-event',
            (_actor, event) => this._onPreviewCaptured(preview, info, event)
        );

        // Track drag commit. We MUST snap our scale/opacity back to the
        // neutral state before drag clones the preview, otherwise:
        //   - drag's clone inherits our 0.92 scale, so the drag thumbnail
        //     is positioned as if full-size but rendered smaller → it
        //     appears offset down/right of the finger
        //   - drag never knows it has to reset our changes on drop, so
        //     after the drag the original stays stuck at 0.92/200
        // Snap-set here (no ease) is fast enough that the press visual
        // still gets at least one frame of render time before being
        // reset, even on instant drag-without-hold.
        if (preview._draggable) {
            info.dragBeginId = preview._draggable.connect('drag-begin', () => {
                info.dragInProgress = true;
                this._cancelPressTimeout(info);
                this._snapToNeutral(preview);
                info.pressShown = false;
                // Drag grabs the touch sequence from us, so the preview
                // will never see the matching TOUCH_END. Clear pressSlot
                // here, otherwise the next TOUCH_BEGIN sees a non-null
                // slot and the press-feedback never fires again on this
                // window.
                info.pressSlot = null;
            });
            info.dragEndId = preview._draggable.connect('drag-end', () => {
                info.dragInProgress = false;
                // Defensive: reset again in case drag's own transform
                // left the original in a weird state.
                this._snapToNeutral(preview);
                info.pressSlot = null;
            });
        }

        info.destroyId = preview.connect('destroy', () => {
            this._patched.delete(preview);
        });

        this._patched.set(preview, info);
    }

    _onPreviewCaptured(preview, info, event) {
        const type = event.type();
        if (type === Clutter.EventType.TOUCH_BEGIN) {
            // First touch only — second-finger touches don't get a
            // separate press visual.
            if (info.pressSlot !== null)
                return Clutter.EVENT_PROPAGATE;
            info.pressSlot = this._slotOf(event);
            info.firedFlick = false;
            info.pressShown = false;
            this._cancelPressTimeout(info);
            info.pressTimeoutId = GLib.timeout_add(
                GLib.PRIORITY_DEFAULT,
                READY_MS,
                () => {
                    info.pressTimeoutId = 0;
                    // Don't show if drag already started or the preview
                    // is gone in the meantime.
                    if (!info.dragInProgress) {
                        info.pressShown = true;
                        this._pressOn(preview);
                    }
                    return GLib.SOURCE_REMOVE;
                }
            );
        } else if (type === Clutter.EventType.TOUCH_END ||
                   type === Clutter.EventType.TOUCH_CANCEL) {
            if (info.pressSlot === null)
                return Clutter.EVENT_PROPAGATE;
            const slot = this._slotOf(event);
            if (slot !== info.pressSlot)
                return Clutter.EVENT_PROPAGATE;
            info.pressSlot = null;
            this._cancelPressTimeout(info);
            this._pressOff(preview, info);
        }
        return Clutter.EVENT_PROPAGATE;
    }

    _cancelPressTimeout(info) {
        if (info.pressTimeoutId) {
            GLib.source_remove(info.pressTimeoutId);
            info.pressTimeoutId = 0;
        }
    }

    _pressOn(preview) {
        if (!preview || preview.is_finalized?.())
            return;
        try {
            // Property assignment (not the set_pivot_point method, which
            // takes two scalar floats — see touchup's _onCloseWindow for
            // the same pattern).
            preview.pivot_point = new Graphene.Point({ x: 0.5, y: 0.5 });
            // Snap, don't ease. We tried 80ms ease originally but on the
            // second+ press the user starts dragging within a few frames,
            // and drag-begin would interrupt the in-flight ease before
            // any pixels rendered. Direct property set guarantees the
            // press visual is on-screen for at least one frame even if
            // drag commits immediately afterward.
            preview.scaleX = PRESS_SCALE;
            preview.scaleY = PRESS_SCALE;
            preview.opacity = PRESS_OPACITY;
        } catch (e) {
            LOG('_pressOn threw:', e?.message ?? e);
        }
    }

    _pressOff(preview, info) {
        if (!preview || preview.is_finalized?.())
            return;
        // Don't fight the drag transform or the close animation.
        if (info.dragInProgress || info.firedFlick)
            return;
        // Quick tap that released before READY_MS — nothing to revert.
        // Avoids stuck-effect when the user taps faster than the timeout.
        if (!info.pressShown)
            return;
        info.pressShown = false;
        try {
            preview.ease({
                scaleX: 1,
                scaleY: 1,
                opacity: 255,
                duration: PRESS_UP_MS,
                mode: Clutter.AnimationMode.EASE_OUT,
            });
        } catch (e) {
            LOG('_pressOff threw:', e?.message ?? e);
        }
    }

    _snapToNeutral(preview) {
        // Used at drag-begin: stop any in-flight press ease and reset
        // scale/opacity instantly so drag's own transform starts from a
        // clean baseline.
        if (!preview || preview.is_finalized?.())
            return;
        try {
            preview.remove_all_transitions?.();
            preview.scaleX = 1;
            preview.scaleY = 1;
            preview.opacity = 255;
        } catch (e) {
            LOG('_snapToNeutral threw:', e?.message ?? e);
        }
    }

    _unpatchPreview(preview, info) {
        this._cancelPressTimeout(info);
        try {
            if (info.gesture)
                preview.remove_action(info.gesture);
        } catch { /* preview already gone */ }
        if (info.capturedId) {
            try { preview.disconnect(info.capturedId); } catch { /* gone */ }
        }
        if (info.dragBeginId && preview._draggable) {
            try { preview._draggable.disconnect(info.dragBeginId); } catch { /* gone */ }
        }
        if (info.dragEndId && preview._draggable) {
            try { preview._draggable.disconnect(info.dragEndId); } catch { /* gone */ }
        }
        if (info.origDndTimeout !== undefined) {
            const dnd = preview._draggable?._dndGesture;
            if (dnd && 'timeout_threshold' in dnd)
                dnd.timeout_threshold = info.origDndTimeout;
        }
        if (info.destroyId) {
            try { preview.disconnect(info.destroyId); } catch { /* gone */ }
        }
    }
}
