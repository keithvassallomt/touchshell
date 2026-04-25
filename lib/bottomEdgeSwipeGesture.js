import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { EdgeSwipeGestureBase } from './edgeSwipeGestureBase.js';
import { OverviewGestureDriver } from './overviewGestureDriver.js';

const BOTTOM_ZONE_HEIGHT_PX = 50;
// Ignore micro-jitter before committing the overview-begin call.
// A few pixels of upward motion is required so a stationary touch or
// a pan that ultimately goes downward doesn't briefly flash the overview.
const BEGIN_THRESHOLD_PX = 2;

export class BottomEdgeSwipeGesture extends EdgeSwipeGestureBase {
    constructor(settings, tabletMode) {
        super(settings, tabletMode, {
            actionName: 'touchshell-bottom-edge-swipe',
            activationKey: 'bottom-edge-swipe-activation',
            stream: true,
        });
        this._driver = new OverviewGestureDriver();
        this._beganDriver = false;
    }

    destroy() {
        this._driver?.cancel();
        super.destroy();
    }

    _canStart() {
        // Bottom-edge only opens the overview; if it's already visible,
        // the in-overview vertical gesture handles further state changes.
        if (Main.overview.visible)
            return false;
        return this._driver.canStart();
    }

    _isInZone(x, y, monitor) {
        const inMonitor = x >= monitor.x && x < monitor.x + monitor.width;
        const bottom = monitor.y + monitor.height;
        return inMonitor && y >= bottom - BOTTOM_ZONE_HEIGHT_PX && y <= bottom;
    }

    _streamBegin(_g) {
        // Defer driver.begin() until we see real upward motion. Avoids
        // briefly entering the overview animation pipeline on a touch
        // that recognizes but never goes anywhere.
        this._beganDriver = false;
    }

    _streamUpdate(g) {
        const accumulatedDy = g.get_accumulated_delta().get_y();
        if (!this._beganDriver) {
            if (accumulatedDy > -BEGIN_THRESHOLD_PX)
                return;
            if (!this._driver.begin())
                return;
            this._beganDriver = true;
        }
        this._driver.update(accumulatedDy);
    }

    _streamEnd(g) {
        if (!this._beganDriver)
            return;
        const velocity = g.get_velocity?.();
        const vy = velocity?.get_y?.() ?? 0;
        this._driver.end(vy);
        this._beganDriver = false;
    }

    _streamCancel(_g) {
        if (!this._beganDriver)
            return;
        this._driver.cancel();
        this._beganDriver = false;
    }
}
