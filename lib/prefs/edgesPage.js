import Adw from 'gi://Adw';

import { buildFeatureRow } from './demoMedia.js';
import {
    buildPageHeader,
    buildSpinRow,
} from './widgets.js';

export function build(settings, extensionPath) {
    const page = new Adw.PreferencesPage({
        title: 'Edges',
        icon_name: 'go-up-symbolic',
        name: 'edges',
    });

    page.add(buildPageHeader(
        'Gestures that start at the very edge of the screen and reveal a ' +
        'system surface — Activities, Quick Settings, or Notifications.'
    ));

    page.add(_bottomEdgeGroup(settings, extensionPath));
    page.add(_topRightGroup(settings, extensionPath));
    page.add(_topCenterGroup(settings, extensionPath));

    return page;
}

function _bottomEdgeGroup(settings, extensionPath) {
    const group = new Adw.PreferencesGroup({
        title: 'Bottom edge → Overview',
        description:
            'Swipe up from the bottom edge of the screen to open the ' +
            'Activities overview.',
    });

    group.add(buildFeatureRow(
        extensionPath, 'bottom-edge.webm', 'Bottom edge',
        settings, 'bottom-edge-swipe-activation'));
    group.add(buildSpinRow(
        settings,
        'overview-distance-percent',
        'Swipe distance',
        'Percentage of screen height needed to commit one overview state ' +
        'change. Lower = snappier. Also applies to vertical swipes inside ' +
        'the overview and to the desktop swipe-up.',
        30, 100
    ));

    return group;
}

function _topRightGroup(settings, extensionPath) {
    const group = new Adw.PreferencesGroup({
        title: 'Top-right → Quick Settings',
        description:
            'Swipe down from the top-right edge to open the Quick Settings ' +
            'menu.',
    });

    group.add(buildFeatureRow(
        extensionPath, 'top-right.webm', 'Top-right',
        settings, 'top-right-swipe-activation'));
    group.add(buildSpinRow(
        settings,
        'top-right-zone-width-percent',
        'Trigger zone width',
        'Percentage of screen width that counts as the top-right edge.',
        5, 50
    ));

    return group;
}

function _topCenterGroup(settings, extensionPath) {
    const group = new Adw.PreferencesGroup({
        title: 'Top-center → Notifications',
        description:
            'Swipe down from the top-center of the screen to open the date ' +
            'menu (notifications and calendar).',
    });

    group.add(buildFeatureRow(
        extensionPath, 'top-center.webm', 'Top-center',
        settings, 'top-center-swipe-activation'));
    group.add(buildSpinRow(
        settings,
        'top-center-zone-width-percent',
        'Trigger zone width',
        'Percentage of screen width, centered horizontally.',
        10, 60
    ));

    return group;
}
