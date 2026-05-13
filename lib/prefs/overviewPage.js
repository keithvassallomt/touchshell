import Adw from 'gi://Adw';

import { buildFeatureRow } from './demoMedia.js';
import { buildPageHeader } from './widgets.js';

export function build(settings) {
    const page = new Adw.PreferencesPage({
        title: 'Overview',
        icon_name: 'view-app-grid-symbolic',
        name: 'overview',
    });

    page.add(buildPageHeader(
        'Gestures for opening the Activities overview and moving between its ' +
        'states (Windows view ↔ App Grid).'
    ));

    page.add(_desktopVerticalGroup(settings));
    page.add(_overviewVerticalGroup(settings));
    page.add(_flickToCloseGroup(settings));

    return page;
}

function _desktopVerticalGroup(settings) {
    const group = new Adw.PreferencesGroup({
        title: 'Desktop swipe up → Overview',
    });

    group.add(buildFeatureRow(
        'desktop-vertical.webm', 'Desktop swipe up',
        settings, 'desktop-vertical-swipe-activation',
        'Single-finger upward swipe on the desktop background opens the ' +
        'overview. Sensitivity follows the Edges page swipe-distance.'));

    return group;
}

function _overviewVerticalGroup(settings) {
    const group = new Adw.PreferencesGroup({
        title: 'In-overview vertical swipe',
    });

    group.add(buildFeatureRow(
        'overview-vertical.webm', 'Overview vertical',
        settings, 'overview-vertical-swipe-activation',
        'Swipe up over the overview to reveal the app grid; swipe down ' +
        'to return.'));

    return group;
}

function _flickToCloseGroup(settings) {
    const group = new Adw.PreferencesGroup({
        title: 'Flick to close',
    });

    group.add(buildFeatureRow(
        'flick-to-close.webm', 'Flick to close',
        settings, 'flick-to-close-activation',
        'Flick a window thumbnail upward in the overview to close it.'));

    return group;
}
