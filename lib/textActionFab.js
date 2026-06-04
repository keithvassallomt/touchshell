import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const FAB_SIZE = 48;
const FAB_ICON_SIZE = 22;
const ANIM_MS = 150;
const ENTER_SCALE_FROM = 0.6;
const EXIT_SCALE_TO = 0.8;
const EDGE_MARGIN = 8;
const FAB_MENU_GAP = 8;
const CORNER_MARGIN = 24;
const REST_OPACITY = 140;

const FabButton = GObject.registerClass(
class FabButton extends St.Button {
    _init() {
        super._init({
            width: FAB_SIZE,
            height: FAB_SIZE,
            reactive: true,
            can_focus: false,
            track_hover: true,
            style: [
                'background-color: rgba(40,40,40,0.95);',
                'border-radius: 9999px;',
                'box-shadow: 0 4px 12px rgba(0,0,0,0.5);',
                'border: 1px solid rgba(255,255,255,0.1);',
            ].join(' '),
        });
        this.set_pivot_point(0.5, 0.5);
        const icon = new St.Icon({
            icon_name: 'input-keyboard-symbolic',
            icon_size: FAB_ICON_SIZE,
            style: 'color: white;',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.set_child(icon);
    }
});

const ActionBar = GObject.registerClass(
class ActionBar extends St.BoxLayout {
    _init() {
        super._init({
            vertical: false,
            style: [
                'background-color: rgba(40,40,40,0.95);',
                'border-radius: 12px;',
                'padding: 4px;',
                'spacing: 4px;',
                'box-shadow: 0 4px 12px rgba(0,0,0,0.5);',
                'border: 1px solid rgba(255,255,255,0.1);',
            ].join(' '),
        });
        this.set_pivot_point(0.5, 0.5);
    }
});

// Two visible states + hidden:
//   - hidden: nothing visible
//   - corner: translucent FAB at user-set or default position
//   - expanded: action bar centred on a given anchor point
// `persistent` controls dismissal: when true, expanded → corner;
// when false, expanded → hidden.
//
// The corner FAB is draggable. While dragging, click is suppressed
// (PanGesture eats the sequence past its deadzone, so St.Button's
// clicked never fires for a drag). On drag end we fire
// onPositionChanged so the controller can persist the new spot.
export class TextActionFab {
    constructor({ onAction, onPositionChanged }) {
        this._onAction = onAction;
        this._onPositionChanged = onPositionChanged;
        this._persistent = true;
        // Controller-driven gate: hide the corner FAB regardless of
        // _persistent (e.g. when a fullscreen window has focus, so the
        // FAB doesn't sit on top of fullscreen video).
        this._suppressed = false;
        this._cornerVisible = false;
        this._barVisible = false;
        // User-set corner position; null means "use default corner".
        this._cornerX = null;
        this._cornerY = null;

        this._fab = new FabButton();
        // Marker read by EdgeSwipeGestureBase._isMarkedOverlay so its
        // CAPTURE-phase PanGestures decline touches that landed on us.
        this._fab._touchshellOverlay = true;
        this._fab.connect('clicked', () => this._onFabClicked());
        this._fab.visible = false;
        Main.layoutManager.uiGroup.add_child(this._fab);
        this._attachDragGesture(this._fab);

        this._bar = new ActionBar();
        this._bar._touchshellOverlay = true;
        this._bar.visible = false;
        Main.layoutManager.uiGroup.add_child(this._bar);

        this._cutBtn = this._mkBarButton('Cut', 'cut', 'edit-cut-symbolic');
        this._copyBtn = this._mkBarButton('Copy', 'copy', 'edit-copy-symbolic');
        this._pasteBtn = this._mkBarButton('Paste', 'paste', 'edit-paste-symbolic');
        this._selectAllBtn = this._mkBarButton('Select All', 'selectAll',
            'edit-select-all-symbolic');
        this._keyboardBtn = this._mkBarButton('Keyboard', 'showKeyboard',
            'input-keyboard-symbolic');
    }

    // Set the persistent corner position (e.g. from saved settings on
    // enable). null clears, falling back to the default corner.
    setCornerPosition(x, y) {
        if (typeof x === 'number' && typeof y === 'number' &&
            x >= 0 && y >= 0) {
            this._cornerX = x;
            this._cornerY = y;
        } else {
            this._cornerX = null;
            this._cornerY = null;
        }
        if (this._cornerVisible) {
            // Re-place without re-animating.
            const [px, py] = this._cornerCoords();
            this._fab.set_position(px, py);
        }
    }

    destroy() {
        this._fab?.destroy();
        this._bar?.destroy();
        this._fab = null;
        this._bar = null;
        this._cutBtn = null;
        this._copyBtn = null;
        this._pasteBtn = null;
        this._selectAllBtn = null;
        this._keyboardBtn = null;
    }

    setPersistent(persistent) {
        this._persistent = !!persistent;
        // If bar is up, leave it — collapse will pick up the new mode.
        if (this._barVisible) return;
        this._applyCornerVisibility();
    }

    // Controller-driven hide. When suppressed=true the corner FAB is
    // forced off regardless of the user's persistent preference; when
    // suppressed=false we restore whatever the persistent setting
    // dictates. Used to hide the FAB while a fullscreen window has
    // focus (video playback, presentations) so it doesn't overlay
    // the fullscreen content.
    setSuppressed(suppressed) {
        suppressed = !!suppressed;
        if (this._suppressed === suppressed) return;
        this._suppressed = suppressed;
        if (this._barVisible) return;
        this._applyCornerVisibility();
    }

    _applyCornerVisibility() {
        if (this._persistent && !this._suppressed) this._showCorner();
        else this._hideCorner();
    }

    isExpanded() { return this._barVisible; }

    containsPoint(x, y) {
        const within = (actor) => {
            if (!actor?.visible) return false;
            const [ax, ay] = actor.get_transformed_position();
            const [aw, ah] = actor.get_transformed_size();
            return x >= ax && x < ax + aw && y >= ay && y < ay + ah;
        };
        return (this._barVisible && within(this._bar)) ||
               (this._cornerVisible && within(this._fab));
    }

    // Pop the action bar centred on (x, y). FAB stays visible.
    // Used by the three-finger-tap summon path.
    expandAt(x, y) {
        if (!this._bar) return;
        this._positionActor(this._bar, x, y);
        this._showBar();
    }

    // Pop the action bar adjacent to the corner FAB (default: above)
    // with edge-aware fallback so it never clips. FAB stays visible
    // — tapping it again toggles the bar closed.
    _expandAtFab() {
        if (!this._bar || !this._fab) return;
        this._positionAtFab();
        this._showBar();
    }

    _showBar() {
        this._bar.remove_all_transitions();
        this._bar.visible = true;
        this._bar.opacity = 0;
        this._bar.set_scale(ENTER_SCALE_FROM, ENTER_SCALE_FROM);
        this._bar.ease({
            opacity: 255,
            scale_x: 1.0,
            scale_y: 1.0,
            duration: ANIM_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
        this._barVisible = true;
    }

    // Place the bar adjacent to the FAB. Default: above the FAB,
    // horizontally centred on its centre. If "above" doesn't fit
    // (FAB is near the top), fall back to below; if vertically
    // there's no room either way, fall back to left or right of
    // the FAB. After picking a side, clamp to the monitor so
    // a wide menu near a screen edge slides in to fit instead of
    // overhanging.
    _positionAtFab() {
        const [, , prefW, prefH] = this._bar.get_preferred_size();
        const w = prefW || 0;
        const h = prefH || 0;
        const [fx, fy] = this._fab.get_position();
        const fabCx = fx + FAB_SIZE / 2;
        const fabCy = fy + FAB_SIZE / 2;
        const monitor = this._monitorForPoint(fabCx, fabCy);
        if (!monitor) {
            this._bar.set_position(fx, fy);
            return;
        }

        // Default: above, horizontally centred on FAB.
        let bx = Math.round(fabCx - w / 2);
        let by = fy - h - FAB_MENU_GAP;

        const fitsAbove = by >= monitor.y + EDGE_MARGIN;
        if (!fitsAbove) {
            const belowY = fy + FAB_SIZE + FAB_MENU_GAP;
            const fitsBelow =
                belowY + h <= monitor.y + monitor.height - EDGE_MARGIN;
            if (fitsBelow) {
                by = belowY;
            } else {
                // Vertically constrained — flank the FAB instead.
                by = Math.round(fabCy - h / 2);
                const leftX = fx - w - FAB_MENU_GAP;
                bx = leftX >= monitor.x + EDGE_MARGIN
                    ? leftX
                    : fx + FAB_SIZE + FAB_MENU_GAP;
            }
        }

        // Clamp to monitor; an above/below menu near a side edge
        // slides over (e.g. FAB hard against the right edge with a
        // wide menu lands left-aligned to monitor.right - margin).
        const minX = monitor.x + EDGE_MARGIN;
        const maxX = monitor.x + monitor.width - w - EDGE_MARGIN;
        const minY = monitor.y + EDGE_MARGIN;
        const maxY = monitor.y + monitor.height - h - EDGE_MARGIN;
        bx = Math.max(minX, Math.min(maxX, bx));
        by = Math.max(minY, Math.min(maxY, by));

        this._bar.set_position(bx, by);
    }

    // Dismiss the bar; respects persistent mode (returns to corner
    // FAB or hides everything).
    collapse() {
        if (!this._barVisible) return;
        this._hideBar();
        if (this._persistent) this._showCorner();
    }

    _onFabClicked() {
        if (this._barVisible) {
            this.collapse();
            return;
        }
        this._expandAtFab();
    }

    _showCorner() {
        if (!this._fab || this._cornerVisible) return;
        this._fab.remove_all_transitions();
        const [x, y] = this._cornerCoords();
        this._fab.set_position(x, y);
        this._fab.visible = true;
        this._fab.opacity = 0;
        this._fab.set_scale(ENTER_SCALE_FROM, ENTER_SCALE_FROM);
        this._fab.ease({
            opacity: REST_OPACITY,
            scale_x: 1.0,
            scale_y: 1.0,
            duration: ANIM_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
        this._cornerVisible = true;
    }

    _cornerCoords() {
        if (this._cornerX !== null && this._cornerY !== null)
            return this._clampToMonitor(this._cornerX, this._cornerY);
        const monitor = Main.layoutManager.primaryMonitor;
        const x = (monitor?.x ?? 0) + (monitor?.width ?? 0) -
            FAB_SIZE - CORNER_MARGIN;
        const y = (monitor?.y ?? 0) + (monitor?.height ?? 0) -
            FAB_SIZE - CORNER_MARGIN;
        return [x, y];
    }

    _clampToMonitor(x, y) {
        const monitor = this._monitorForPoint(
            x + FAB_SIZE / 2, y + FAB_SIZE / 2);
        if (!monitor) return [x, y];
        const px = Math.max(monitor.x + EDGE_MARGIN,
            Math.min(monitor.x + monitor.width - FAB_SIZE - EDGE_MARGIN, x));
        const py = Math.max(monitor.y + EDGE_MARGIN,
            Math.min(monitor.y + monitor.height - FAB_SIZE - EDGE_MARGIN, y));
        return [px, py];
    }

    _attachDragGesture(actor) {
        const drag = new Clutter.PanGesture({
            min_n_points: 1,
            max_n_points: 1,
        });
        let dragOffsetX = 0;
        let dragOffsetY = 0;
        let dragging = false;
        const finishDrag = () => {
            if (!dragging) return;
            dragging = false;
            const [px, py] = actor.get_position();
            const [cx, cy] = this._clampToMonitor(px, py);
            actor.set_position(cx, cy);
            this._cornerX = cx;
            this._cornerY = cy;
            this._onPositionChanged?.(cx, cy);
        };
        drag.connect('pan-update', () => {
            const event = Clutter.get_current_event();
            if (!event) return;
            const [fx, fy] = event.get_coords();
            if (!dragging) {
                const [ax, ay] = actor.get_position();
                dragOffsetX = ax - fx;
                dragOffsetY = ay - fy;
                dragging = true;
            }
            actor.set_position(fx + dragOffsetX, fy + dragOffsetY);
        });
        drag.connect('end', () => finishDrag());
        drag.connect('cancel', () => finishDrag());
        actor.add_action(drag);
    }

    _hideCorner() {
        if (!this._fab || !this._cornerVisible) return;
        this._fab.remove_all_transitions();
        this._fab.ease({
            opacity: 0,
            scale_x: EXIT_SCALE_TO,
            scale_y: EXIT_SCALE_TO,
            duration: ANIM_MS,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onComplete: () => { if (this._fab) this._fab.visible = false; },
        });
        this._cornerVisible = false;
    }

    _hideBar() {
        if (!this._bar || !this._barVisible) return;
        this._bar.remove_all_transitions();
        this._bar.ease({
            opacity: 0,
            scale_x: EXIT_SCALE_TO,
            scale_y: EXIT_SCALE_TO,
            duration: ANIM_MS,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onComplete: () => { if (this._bar) this._bar.visible = false; },
        });
        this._barVisible = false;
    }

    // Centre the actor on (x, y), clamped to the monitor that
    // contains the anchor.
    _positionActor(actor, x, y) {
        const [, , prefW, prefH] = actor.get_preferred_size();
        const w = prefW || FAB_SIZE;
        const h = prefH || FAB_SIZE;
        const monitor = this._monitorForPoint(x, y);
        let px = x - w / 2;
        let py = y - h / 2;
        if (monitor) {
            px = Math.max(monitor.x + EDGE_MARGIN,
                Math.min(monitor.x + monitor.width - w - EDGE_MARGIN, px));
            py = Math.max(monitor.y + EDGE_MARGIN,
                Math.min(monitor.y + monitor.height - h - EDGE_MARGIN, py));
        }
        actor.set_position(px, py);
    }

    _monitorForPoint(x, y) {
        for (const m of Main.layoutManager.monitors) {
            if (x >= m.x && x < m.x + m.width &&
                y >= m.y && y < m.y + m.height)
                return m;
        }
        return Main.layoutManager.primaryMonitor;
    }

    _mkBarButton(label, action, iconName) {
        const btn = new St.Button({
            reactive: true,
            can_focus: false,
            track_hover: true,
            style: [
                'background-color: transparent;',
                'padding: 8px 12px;',
                'border-radius: 8px;',
            ].join(' '),
        });
        const box = new St.BoxLayout({
            vertical: false,
            style: 'spacing: 6px;',
        });
        const icon = new St.Icon({
            icon_name: iconName,
            icon_size: 16,
            style: 'color: white;',
            y_align: Clutter.ActorAlign.CENTER,
        });
        const labelW = new St.Label({
            text: label,
            y_align: Clutter.ActorAlign.CENTER,
            style: 'color: white; font-size: 13px;',
        });
        box.add_child(icon);
        box.add_child(labelW);
        btn.set_child(box);
        btn.connect('clicked', () => this._onAction?.(action));
        this._bar.add_child(btn);
        return btn;
    }
}
