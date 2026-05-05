import Adw from 'gi://Adw';

import { buildFeatureRow } from './demoMedia.js';
import { buildPageHeader } from './widgets.js';

export function build(settings, extensionPath) {
    const page = new Adw.PreferencesPage({
        title: 'Overview',
        icon_name: 'view-app-grid-symbolic',
        name: 'overview',
    });

    page.add(buildPageHeader(
        'Gestures for opening the Activities overview and moving between its ' +
        'states (Windows view ↔ App Grid).'
    ));

    page.add(_desktopVerticalGroup(settings, extensionPath));
    page.add(_overviewVerticalGroup(settings, extensionPath));
    page.add(_flickToCloseGroup(settings, extensionPath));

    return page;
}

function _desktopVerticalGroup(settings, extensionPath) {
    const group = new Adw.PreferencesGroup({
        title: 'Desktop swipe up → Overview',
        description:
            'Single-finger upward swipe on a visible patch of desktop ' +
            'background opens the Activities overview, with the same 1:1 ' +
            'feel as the bottom-edge swipe — reachable from anywhere on the ' +
            'desktop. Sensitivity follows the swipe-distance setting on the ' +
            'Edges page.',
    });

    group.add(buildFeatureRow(
        extensionPath, 'desktop-vertical.webm', 'Desktop swipe up',
        settings, 'desktop-vertical-swipe-activation'));

    return group;
}

function _overviewVerticalGroup(settings, extensionPath) {
    const group = new Adw.PreferencesGroup({
        title: 'In-overview vertical swipe',
        description:
            'Single-finger vertical swipe over the overview background. ' +
            'Swipe up to reveal the app grid; swipe down to return to the ' +
            'windows view or to the desktop. Sensitivity follows the ' +
            'swipe-distance setting on the Edges page.',
    });

    group.add(buildFeatureRow(
        extensionPath, 'overview-vertical.webm', 'Overview vertical',
        settings, 'overview-vertical-swipe-activation'));

    return group;
}

function _flickToCloseGroup(settings, extensionPath) {
    const group = new Adw.PreferencesGroup({
        title: 'Flick to close',
        description:
            'Flick a window thumbnail upward in the Activities overview to ' +
            'close that window.',
    });

    group.add(buildFeatureRow(
        extensionPath, 'flick-to-close.webm', 'Flick to close',
        settings, 'flick-to-close-activation'));

    return group;
}
