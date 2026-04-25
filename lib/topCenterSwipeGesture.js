import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { EdgeSwipeGestureBase } from './edgeSwipeGestureBase.js';

const TOP_ZONE_HEIGHT_PX = 50;

export class TopCenterSwipeGesture extends EdgeSwipeGestureBase {
    constructor(settings, tabletMode, panelAutoHide) {
        super(settings, tabletMode, {
            actionName: 'touchshell-top-center-swipe',
            activationKey: 'top-center-swipe-activation',
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
        return !Main.panel.statusArea.dateMenu?.menu?.isOpen;
    }

    _isInZone(x, y, monitor) {
        const inTop = y >= monitor.y && y < monitor.y + TOP_ZONE_HEIGHT_PX;
        if (!inTop)
            return false;
        const widthPct = this._settings.get_int('top-center-zone-width-percent');
        const zoneWidth = Math.round(monitor.width * widthPct / 100);
        const centerX = monitor.x + monitor.width / 2;
        const halfZone = zoneWidth / 2;
        return x >= centerX - halfZone && x <= centerX + halfZone;
    }

    _fire() {
        const menu = Main.panel.statusArea.dateMenu?.menu;
        if (!menu || menu.isOpen)
            return;
        this._panelAutoHide?.showInstant();
        menu.open(true);
    }
}
