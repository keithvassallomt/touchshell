import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const TOP_ZONE_HEIGHT_PX = 50;
const MIN_VERTICAL_DISTANCE_PX = 60;

export class TopCenterSwipeGesture {
    constructor(settings, tabletMode, panelAutoHide) {
        this._settings = settings;
        this._tabletMode = tabletMode;
        this._panelAutoHide = panelAutoHide;
        this._gesture = null;
        this._startX = 0;
        this._startY = 0;
        this._fired = false;
        this._enabled = false;

        this._activationChangedId = this._settings.connect(
            'changed::top-center-swipe-activation',
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
        this._panelAutoHide = null;
    }

    _syncEnabled() {
        const activation = this._settings.get_string('top-center-swipe-activation');
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
        // CAPTURE phase claims bezel-originating sequences before
        // EdgeDragAction can grab them. See project_pan_gesture_pattern.md.
        global.stage.add_action_full(
            'touchshell-top-center-swipe',
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
        const menu = Main.panel.statusArea.dateMenu?.menu;
        if (menu?.isOpen)
            return false;

        const [x, y] = event.get_coords();
        const monitor = this._monitorForPoint(x, y);
        if (!monitor)
            return false;
        if (!this._isInTopCenterZone(x, y, monitor))
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
        // Positive dy = downward motion.
        if (dy >= MIN_VERTICAL_DISTANCE_PX && dy > Math.abs(dx)) {
            this._fired = true;
            this._openDateMenu();
        }
    }

    _onEnd() {
        this._fired = false;
    }

    _isInTopCenterZone(x, y, monitor) {
        const inTopStrip = y >= monitor.y && y < monitor.y + TOP_ZONE_HEIGHT_PX;
        if (!inTopStrip)
            return false;
        const widthPct = this._settings.get_int('top-center-zone-width-percent');
        const zoneWidth = Math.round(monitor.width * widthPct / 100);
        const centerX = monitor.x + monitor.width / 2;
        const halfZone = zoneWidth / 2;
        return x >= centerX - halfZone && x <= centerX + halfZone;
    }

    _monitorForPoint(x, y) {
        for (const m of Main.layoutManager.monitors) {
            if (x >= m.x && x < m.x + m.width &&
                y >= m.y && y <= m.y + m.height)
                return m;
        }
        return null;
    }

    _openDateMenu() {
        const menu = Main.panel.statusArea.dateMenu?.menu;
        if (!menu || menu.isOpen)
            return;
        // Same trick as the top-right gesture: ensure the panel is on-screen
        // first so the menu's BoxPointer has a real anchor.
        this._panelAutoHide?.showInstant();
        menu.open(true);
    }
}
