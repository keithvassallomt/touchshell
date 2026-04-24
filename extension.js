import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

import { TopRightSwipeGesture } from './lib/topRightSwipeGesture.js';

export default class TouchshellExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._topRightSwipe = new TopRightSwipeGesture(this._settings);
    }

    disable() {
        this._topRightSwipe?.destroy();
        this._topRightSwipe = null;
        this._settings = null;
    }
}
