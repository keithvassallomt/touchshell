import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const TOP_ZONE_HEIGHT_PX = 50;
const MIN_VERTICAL_DISTANCE_PX = 60;

export class TopRightSwipeGesture {
    constructor(settings, tabletMode) {
        this._settings = settings;
        this._tabletMode = tabletMode;
        this._stageHandlerId = 0;
        this._activeSlot = null;
        this._activeStart = null;
        this._enabled = false;

        this._activationChangedId = this._settings.connect(
            'changed::top-right-swipe-activation',
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
        const activation = this._settings.get_string('top-right-swipe-activation');
        const want =
            activation === 'always' ||
            (activation === 'auto' && this._tabletMode.isTabletMode);
        if (want && !this._enabled)
            this._setup();
        else if (!want && this._enabled)
            this._teardown();
    }

    _setup() {
        this._stageHandlerId = global.stage.connect(
            'captured-event',
            (_actor, event) => this._onCaptured(event)
        );
        this._enabled = true;
    }

    _teardown() {
        if (this._stageHandlerId) {
            global.stage.disconnect(this._stageHandlerId);
            this._stageHandlerId = 0;
        }
        this._activeSlot = null;
        this._activeStart = null;
        this._enabled = false;
    }

    _onCaptured(event) {
        const type = event.type();
        switch (type) {
            case Clutter.EventType.TOUCH_BEGIN:
                this._tryBegin(event);
                break;
            case Clutter.EventType.TOUCH_END:
                this._tryComplete(event);
                break;
            case Clutter.EventType.TOUCH_CANCEL:
                if (this._activeSlot !== null &&
                    event.get_event_sequence()?.get_slot?.() === this._activeSlot)
                    this._reset();
                break;
        }
        // Always propagate — this gesture observes; it must not eat touches
        // belonging to other widgets (e.g. tapping a status icon must still work).
        return Clutter.EVENT_PROPAGATE;
    }

    _tryBegin(event) {
        if (this._activeSlot !== null)
            return;

        const [x, y] = event.get_coords();
        const monitor = this._monitorForPoint(x, y);
        if (!monitor || !this._isInTopRightZone(x, y, monitor))
            return;

        this._activeSlot = event.get_event_sequence()?.get_slot?.() ?? null;
        this._activeStart = { x, y, time: event.get_time(), monitor };
    }

    _tryComplete(event) {
        if (this._activeSlot === null)
            return;
        const slot = event.get_event_sequence()?.get_slot?.() ?? null;
        if (slot !== this._activeSlot)
            return;

        const [x, y] = event.get_coords();
        const dx = x - this._activeStart.x;
        const dy = y - this._activeStart.y;

        this._reset();

        if (dy >= MIN_VERTICAL_DISTANCE_PX && dy > Math.abs(dx))
            this._openQuickSettings();
    }

    _reset() {
        this._activeSlot = null;
        this._activeStart = null;
    }

    _isInTopRightZone(x, y, monitor) {
        const widthPct = this._settings.get_int('top-right-zone-width-percent');
        const zoneWidth = Math.round(monitor.width * widthPct / 100);
        const inRightStrip = x >= monitor.x + monitor.width - zoneWidth;
        const inTopStrip = y >= monitor.y && y < monitor.y + TOP_ZONE_HEIGHT_PX;
        return inRightStrip && inTopStrip;
    }

    _monitorForPoint(x, y) {
        for (const m of Main.layoutManager.monitors) {
            if (x >= m.x && x < m.x + m.width &&
                y >= m.y && y < m.y + m.height)
                return m;
        }
        return null;
    }

    _openQuickSettings() {
        const qs = Main.panel.statusArea.quickSettings;
        if (qs?.menu && !qs.menu.isOpen)
            qs.menu.open(true);
    }
}
