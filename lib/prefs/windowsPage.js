import Adw from 'gi://Adw';

import { buildFeatureRow } from './demoMedia.js';
import {
    buildExceptionsExpander,
    buildPageHeader,
} from './widgets.js';

export function build(settings, extensionPath) {
    const page = new Adw.PreferencesPage({
        title: 'Windows',
        icon_name: 'window-maximize-symbolic',
        name: 'windows',
    });

    page.add(buildPageHeader(
        'How windows open and how the top panel behaves around them.'
    ));

    page.add(_fullscreenAppsGroup(settings, extensionPath));
    page.add(_panelAutoHideGroup(settings, extensionPath));

    return page;
}

function _fullscreenAppsGroup(settings, extensionPath) {
    const group = new Adw.PreferencesGroup({
        title: 'Fullscreen Apps mode',
        description:
            'Open new normal windows maximized by default (dialogs, popups ' +
            'and child windows are excluded). A two-finger downward swipe ' +
            'inside a maximized window restores it to its previous size — ' +
            'that’s the escape hatch, so it shares this toggle. Fullscreen ' +
            'videos/games are not affected. A Quick Settings tile lets you ' +
            'flip between Off and Always without coming here.',
    });

    group.add(buildFeatureRow(
        extensionPath, 'fullscreen-apps.webm', 'Fullscreen Apps',
        settings, 'auto-maximize-windows-activation'));
    group.add(buildExceptionsExpander(
        settings,
        'auto-maximize-exceptions',
        'Excluded apps',
        'These apps open at their default size, not maximized.'
    ));

    return group;
}

function _panelAutoHideGroup(settings, extensionPath) {
    const group = new Adw.PreferencesGroup({
        title: 'Top panel auto-hide',
        description:
            'Hide the top panel when a window is maximized. Move the ' +
            'pointer to the top edge of the screen (or swipe from the ' +
            'top-right) to reveal it.',
    });

    group.add(buildFeatureRow(
        extensionPath, 'panel-auto-hide.webm', 'Panel auto-hide',
        settings, 'panel-auto-hide-activation'));

    return group;
}
