import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

import { TabletModeMonitor } from './lib/tabletMode.js';
import { TopRightSwipeGesture } from './lib/topRightSwipeGesture.js';

export default class TouchshellExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._tabletMode = new TabletModeMonitor();
        this._topRightSwipe = new TopRightSwipeGesture(this._settings, this._tabletMode);
    }

    disable() {
        this._topRightSwipe?.destroy();
        this._topRightSwipe = null;
        this._tabletMode?.destroy();
        this._tabletMode = null;
        this._settings = null;
    }
}
