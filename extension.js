import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

import { ActionBar } from './lib/actionBar.js';
import { AutoMaximizeWindows } from './lib/autoMaximizeWindows.js';
import { BottomEdgeSwipeGesture } from './lib/bottomEdgeSwipeGesture.js';
import { DesktopVerticalSwipeGesture } from './lib/desktopVerticalSwipeGesture.js';
import { DesktopWorkspaceSwipeGesture } from './lib/desktopWorkspaceSwipeGesture.js';
import { DisableUnredirect } from './lib/disableUnredirect.js';
import { FlickToCloseGesture } from './lib/flickToCloseGesture.js';
import { OverviewVerticalSwipeGesture } from './lib/overviewVerticalSwipeGesture.js';
import { OverviewWorkspaceSwitchGesture } from './lib/overviewWorkspaceSwitchGesture.js';
import { PanelAutoHide } from './lib/panelAutoHide.js';
import { SwipeToDismissNotifications } from './lib/swipeToDismissNotifications.js';
import { TabletModeMonitor } from './lib/tabletMode.js';
import { TabletModeQuickToggle } from './lib/tabletModeQuickToggle.js';
import { TextActionController } from './lib/textActionController.js';
import { TopCenterSwipeGesture } from './lib/topCenterSwipeGesture.js';
import { TopRightSwipeGesture } from './lib/topRightSwipeGesture.js';
import { TwoFingerUnmaximize } from './lib/twoFingerUnmaximize.js';
import { WindowSizeNormalizer } from './lib/windowSizeNormalizer.js';

export default class TouchshellExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._tabletMode = new TabletModeMonitor();
        this._disableUnredirect = new DisableUnredirect();
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
        this._desktopVerticalSwipe = new DesktopVerticalSwipeGesture(
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
        this._textAction = new TextActionController(
            this._settings,
            this._tabletMode
        );
        this._actionBar = new ActionBar(this._settings, this._tabletMode);
        this._sizeNormalizer = new WindowSizeNormalizer();
    }

    disable() {
        this._sizeNormalizer?.destroy();
        this._sizeNormalizer = null;
        this._actionBar?.destroy();
        this._actionBar = null;
        this._textAction?.destroy();
        this._textAction = null;
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
        this._desktopVerticalSwipe?.destroy();
        this._desktopVerticalSwipe = null;
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
        this._disableUnredirect?.destroy();
        this._disableUnredirect = null;
        this._tabletMode?.destroy();
        this._tabletMode = null;
        this._settings = null;
    }
}
