import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

import { BottomEdgeSwipeGesture } from './lib/bottomEdgeSwipeGesture.js';
import { PanelAutoHide } from './lib/panelAutoHide.js';
import { TabletModeMonitor } from './lib/tabletMode.js';
import { TopRightSwipeGesture } from './lib/topRightSwipeGesture.js';

export default class TouchshellExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._tabletMode = new TabletModeMonitor();
        this._panelAutoHide = new PanelAutoHide(this._settings, this._tabletMode);
        this._topRightSwipe = new TopRightSwipeGesture(
            this._settings,
            this._tabletMode,
            this._panelAutoHide
        );
        this._bottomEdgeSwipe = new BottomEdgeSwipeGesture(
            this._settings,
            this._tabletMode
        );
    }

    disable() {
        this._bottomEdgeSwipe?.destroy();
        this._bottomEdgeSwipe = null;
        this._topRightSwipe?.destroy();
        this._topRightSwipe = null;
        this._panelAutoHide?.destroy();
        this._panelAutoHide = null;
        this._tabletMode?.destroy();
        this._tabletMode = null;
        this._settings = null;
    }
}
