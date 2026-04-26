import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

import { AutoMaximizeWindows } from './lib/autoMaximizeWindows.js';
import { BottomEdgeSwipeGesture } from './lib/bottomEdgeSwipeGesture.js';
import { DesktopWorkspaceSwipeGesture } from './lib/desktopWorkspaceSwipeGesture.js';
import { FlickToCloseGesture } from './lib/flickToCloseGesture.js';
import { OverviewVerticalSwipeGesture } from './lib/overviewVerticalSwipeGesture.js';
import { OverviewWorkspaceSwitchGesture } from './lib/overviewWorkspaceSwitchGesture.js';
import { PanelAutoHide } from './lib/panelAutoHide.js';
import { SwipeToDismissNotifications } from './lib/swipeToDismissNotifications.js';
import { TabletModeMonitor } from './lib/tabletMode.js';
import { TabletModeQuickToggle } from './lib/tabletModeQuickToggle.js';
import { TopCenterSwipeGesture } from './lib/topCenterSwipeGesture.js';
import { TopRightSwipeGesture } from './lib/topRightSwipeGesture.js';
import { TwoFingerUnmaximize } from './lib/twoFingerUnmaximize.js';

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
        this._topCenterSwipe = new TopCenterSwipeGesture(
            this._settings,
            this._tabletMode,
            this._panelAutoHide
        );
        this._bottomEdgeSwipe = new BottomEdgeSwipeGesture(
            this._settings,
            this._tabletMode
        );
        this._flickToClose = new FlickToCloseGesture(
            this._settings,
            this._tabletMode
        );
        this._overviewWsSwitch = new OverviewWorkspaceSwitchGesture(
            this._settings,
            this._tabletMode
        );
        this._desktopWsSwipe = new DesktopWorkspaceSwipeGesture(
            this._settings,
            this._tabletMode
        );
        this._overviewVerticalSwipe = new OverviewVerticalSwipeGesture(
            this._settings,
            this._tabletMode
        );
        this._autoMaximize = new AutoMaximizeWindows(
            this._settings,
            this._tabletMode
        );
        this._unmaxSwipe = new TwoFingerUnmaximize(
            this._settings,
            this._tabletMode
        );
        this._tabletQuickToggle = new TabletModeQuickToggle(this._settings);
        this._swipeDismissNotifs = new SwipeToDismissNotifications(
            this._settings,
            this._tabletMode
        );
    }

    disable() {
        this._swipeDismissNotifs?.destroy();
        this._swipeDismissNotifs = null;
        this._tabletQuickToggle?.destroy();
        this._tabletQuickToggle = null;
        this._unmaxSwipe?.destroy();
        this._unmaxSwipe = null;
        this._autoMaximize?.destroy();
        this._autoMaximize = null;
        this._overviewVerticalSwipe?.destroy();
        this._overviewVerticalSwipe = null;
        this._desktopWsSwipe?.destroy();
        this._desktopWsSwipe = null;
        this._overviewWsSwitch?.destroy();
        this._overviewWsSwitch = null;
        this._flickToClose?.destroy();
        this._flickToClose = null;
        this._bottomEdgeSwipe?.destroy();
        this._bottomEdgeSwipe = null;
        this._topCenterSwipe?.destroy();
        this._topCenterSwipe = null;
        this._topRightSwipe?.destroy();
        this._topRightSwipe = null;
        this._panelAutoHide?.destroy();
        this._panelAutoHide = null;
        this._tabletMode?.destroy();
        this._tabletMode = null;
        this._settings = null;
    }
}
