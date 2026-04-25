import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

// How many pixels above the screen bottom count as "in the trigger zone"
// for the gesture's start point. We add the gesture in CAPTURE phase so
// even bezel-originating sequences (which start at y == monitor.height)
// reach us before EdgeDragAction can grab them.
const BOTTOM_ZONE_HEIGHT_PX = 50;
const MIN_VERTICAL_DISTANCE_PX = 60;

export class BottomEdgeSwipeGesture {
    constructor(settings, tabletMode) {
        this._settings = settings;
        this._tabletMode = tabletMode;
        this._gesture = null;
        this._startX = 0;
        this._startY = 0;
        this._fired = false;
        this._enabled = false;

        this._activationChangedId = this._settings.connect(
            'changed::bottom-edge-swipe-activation',
            () => this._syncEnabled()
        );
        this._tabletModeChangedId = this._tabletMode.connect(
            'changed',
            () => this._syncEnabled()
        );
        this._syncEnabled();
    }

    destroy() {
        this._teardown();
        if (this._activationChangedId) {
            this._settings.disconnect(this._activationChangedId);
            this._activationChangedId = 0;
        }
        if (this._tabletModeChangedId) {
            this._tabletMode.disconnect(this._tabletModeChangedId);
            this._tabletModeChangedId = 0;
        }
        this._settings = null;
        this._tabletMode = null;
    }

    _syncEnabled() {
        const activation = this._settings.get_string('bottom-edge-swipe-activation');
        const want =
            activation === 'always' ||
            (activation === 'auto' && this._tabletMode.isTabletMode);
        if (want && !this._enabled)
            this._setup();
        else if (!want && this._enabled)
            this._teardown();
    }

    _setup() {
        this._gesture = new Clutter.PanGesture();
        this._gesture.connect('should-handle-sequence', (_g, event) =>
            this._shouldHandleSequence(event));
        this._gesture.connect('pan-update', () => this._onPanUpdate());
        this._gesture.connect('end', () => this._onEnd());
        this._gesture.connect('cancel', () => this._onEnd());
        // CAPTURE phase is what lets us beat Mutter's EdgeDragAction to the
        // sequence — without this, bezel-originating swipes get grabbed at
        // TOUCH_BEGIN and we never see UPDATE/END.
        global.stage.add_action_full(
            'touchshell-bottom-edge-swipe',
            Clutter.EventPhase.CAPTURE,
            this._gesture
        );
        this._enabled = true;
    }

    _teardown() {
        if (this._gesture) {
            global.stage.remove_action(this._gesture);
            this._gesture = null;
        }
        this._fired = false;
        this._enabled = false;
    }

    _shouldHandleSequence(event) {
        // Don't fight Overview's own touch handling when it's already up.
        if (Main.overview.visible)
            return false;

        const [x, y] = event.get_coords();
        const monitor = this._monitorForPoint(x, y);
        if (!monitor)
            return false;
        if (!this._isInBottomZone(x, y, monitor))
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
        // Negative dy = upward motion.
        if (-dy >= MIN_VERTICAL_DISTANCE_PX && -dy > Math.abs(dx)) {
            this._fired = true;
            if (!Main.overview.visible)
                Main.overview.show();
        }
    }

    _onEnd() {
        this._fired = false;
    }

    _isInBottomZone(x, y, monitor) {
        const inMonitor = x >= monitor.x && x < monitor.x + monitor.width;
        const bottom = monitor.y + monitor.height;
        // Inclusive of bottom — bezel-originating sequences start at y==height.
        const inBottomStrip = y >= bottom - BOTTOM_ZONE_HEIGHT_PX && y <= bottom;
        return inMonitor && inBottomStrip;
    }

    _monitorForPoint(x, y) {
        for (const m of Main.layoutManager.monitors) {
            if (x >= m.x && x < m.x + m.width &&
                y >= m.y && y <= m.y + m.height)
                return m;
        }
        return null;
    }
}
