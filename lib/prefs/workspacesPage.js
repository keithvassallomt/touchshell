import Adw from 'gi://Adw';

import { buildFeatureRow } from './demoMedia.js';
import {
    buildExceptionsExpander,
    buildPageHeader,
    buildSpinRow,
} from './widgets.js';

export function build(settings) {
    const page = new Adw.PreferencesPage({
        title: 'Workspaces',
        icon_name: 'view-grid-symbolic',
        name: 'workspaces',
    });

    page.add(buildPageHeader(
        'Single-finger ways to move between workspaces — on the desktop, in ' +
        'the overview, and over fullscreen apps.'
    ));

    page.add(_desktopGroup(settings));
    page.add(_overviewGroup(settings));
    page.add(_actionBarGroup(settings));

    return page;
}

function _desktopGroup(settings) {
    const group = new Adw.PreferencesGroup({
        title: 'Desktop horizontal swipe',
    });

    group.add(buildFeatureRow(
        'desktop-workspace.webm', 'Desktop swipe',
        settings, 'desktop-workspace-switch-activation',
        'Single-finger horizontal swipe on the desktop background switches ' +
        'workspaces with 1:1 tracking.'));

    return group;
}

function _overviewGroup(settings) {
    const group = new Adw.PreferencesGroup({
        title: 'In-overview horizontal swipe',
    });

    group.add(buildFeatureRow(
        'overview-workspace.webm', 'Overview swipe',
        settings, 'overview-workspace-switch-activation',
        'Single-finger horizontal swipe over the overview switches workspaces.'));

    return group;
}

function _actionBarGroup(settings) {
    const group = new Adw.PreferencesGroup({
        title: 'Bottom action bar',
    });

    group.add(buildFeatureRow(
        'action-bar.webm', 'Action bar',
        settings, 'action-bar-activation',
        'Thin strip pinned to the bottom of the primary monitor. Swipe ' +
        'sideways to switch workspaces, even over fullscreen apps. Taps ' +
        'pass through.'));
    group.add(buildSpinRow(
        settings,
        'action-bar-distance-percent',
        'Swipe distance',
        'Percentage of screen width needed to commit one workspace switch. ' +
        'Lower = snappier.',
        30, 100
    ));
    group.add(buildExceptionsExpander(
        settings,
        'action-bar-exceptions',
        'Hide the bar for',
        'These apps suppress the bar entirely when focused — useful for ' +
        'games, presentations, anywhere an accidental swipe is bad.'
    ));

    return group;
}
