import Adw from 'gi://Adw';

import { buildFeatureRow } from './demoMedia.js';
import {
    buildExceptionsExpander,
    buildPageHeader,
} from './widgets.js';

export function build(settings) {
    const page = new Adw.PreferencesPage({
        title: 'Windows',
        icon_name: 'window-maximize-symbolic',
        name: 'windows',
    });

    page.add(buildPageHeader(
        'How windows open and how the top panel behaves around them.'
    ));

    page.add(_fullscreenAppsGroup(settings));
    page.add(_panelAutoHideGroup(settings));

    return page;
}

function _fullscreenAppsGroup(settings) {
    const group = new Adw.PreferencesGroup({
        title: 'Fullscreen Apps mode',
    });

    group.add(buildFeatureRow(
        'fullscreen-apps.webm', 'Fullscreen Apps',
        settings, 'auto-maximize-windows-activation',
        'Open new windows maximized by default. A two-finger downward ' +
        'swipe inside a maximized window restores it.'));
    group.add(buildExceptionsExpander(
        settings,
        'auto-maximize-exceptions',
        'Excluded apps',
        'These apps open at their default size, not maximized.'
    ));

    return group;
}

function _panelAutoHideGroup(settings) {
    const group = new Adw.PreferencesGroup({
        title: 'Top panel auto-hide',
    });

    group.add(buildFeatureRow(
        'panel-auto-hide.webm', 'Panel auto-hide',
        settings, 'panel-auto-hide-activation',
        'Hide the top panel when a window is maximized. Reveal it from ' +
        'the top edge.'));

    return group;
}
