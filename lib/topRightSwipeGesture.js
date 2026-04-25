import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { EdgeSwipeGestureBase } from './edgeSwipeGestureBase.js';

const TOP_ZONE_HEIGHT_PX = 50;

export class TopRightSwipeGesture extends EdgeSwipeGestureBase {
    constructor(settings, tabletMode, panelAutoHide) {
        super(settings, tabletMode, {
            actionName: 'touchshell-top-right-swipe',
            activationKey: 'top-right-swipe-activation',
            direction: 'down',
        });
        this._settings = settings;
        this._panelAutoHide = panelAutoHide;
    }

    destroy() {
        super.destroy();
        this._settings = null;
        this._panelAutoHide = null;
    }

    _canStart() {
        return !Main.panel.statusArea.quickSettings?.menu?.isOpen;
    }

    _isInZone(x, y, monitor) {
        const inTop = y >= monitor.y && y < monitor.y + TOP_ZONE_HEIGHT_PX;
        if (!inTop)
            return false;
        const widthPct = this._settings.get_int('top-right-zone-width-percent');
        const zoneWidth = Math.round(monitor.width * widthPct / 100);
        return x >= monitor.x + monitor.width - zoneWidth;
    }

    _fire() {
        const qs = Main.panel.statusArea.quickSettings;
        if (!qs?.menu || qs.menu.isOpen)
            return;
        // Auto-hide may have the panel off-screen; snap it back so the
        // menu's BoxPointer has a valid on-screen anchor.
        this._panelAutoHide?.showInstant();
        qs.menu.open(true);
    }
}
