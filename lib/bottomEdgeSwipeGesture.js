import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { EdgeSwipeGestureBase } from './edgeSwipeGestureBase.js';

const BOTTOM_ZONE_HEIGHT_PX = 50;

export class BottomEdgeSwipeGesture extends EdgeSwipeGestureBase {
    constructor(settings, tabletMode) {
        super(settings, tabletMode, {
            actionName: 'touchshell-bottom-edge-swipe',
            activationKey: 'bottom-edge-swipe-activation',
            direction: 'up',
        });
    }

    _canStart() {
        // Don't fight Overview's own touch handling when it's already up.
        return !Main.overview.visible;
    }

    _isInZone(x, y, monitor) {
        const inMonitor = x >= monitor.x && x < monitor.x + monitor.width;
        const bottom = monitor.y + monitor.height;
        // Inclusive of bottom — bezel-originating sequences start at y==height.
        const inBottomStrip = y >= bottom - BOTTOM_ZONE_HEIGHT_PX && y <= bottom;
        return inMonitor && inBottomStrip;
    }

    _fire() {
        if (!Main.overview.visible)
            Main.overview.show();
    }
}
