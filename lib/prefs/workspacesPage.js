import Adw from 'gi://Adw';

import { buildFeatureRow } from './demoMedia.js';
import {
    buildExceptionsExpander,
    buildPageHeader,
    buildSpinRow,
} from './widgets.js';

export function build(settings, extensionPath) {
    const page = new Adw.PreferencesPage({
        title: 'Workspaces',
        icon_name: 'view-grid-symbolic',
        name: 'workspaces',
    });

    page.add(buildPageHeader(
        'Single-finger ways to move between workspaces — on the desktop, in ' +
        'the overview, and over fullscreen apps.'
    ));

    page.add(_desktopGroup(settings, extensionPath));
    page.add(_overviewGroup(settings, extensionPath));
    page.add(_actionBarGroup(settings, extensionPath));

    return page;
}

function _desktopGroup(settings, extensionPath) {
    const group = new Adw.PreferencesGroup({
        title: 'Desktop horizontal swipe',
        description:
            'Single-finger horizontal swipe on a visible patch of desktop ' +
            'background switches workspaces with a 1:1 animation. Works on ' +
            'an empty desktop or in the empty area between/around windows.',
    });

    group.add(buildFeatureRow(
        extensionPath, 'desktop-workspace.webm', 'Desktop swipe',
        settings, 'desktop-workspace-switch-activation'));

    return group;
}

function _overviewGroup(settings, extensionPath) {
    const group = new Adw.PreferencesGroup({
        title: 'In-overview horizontal swipe',
        description:
            'Single-finger horizontal swipe over the overview background ' +
            'switches workspaces, tracking the finger 1:1.',
    });

    group.add(buildFeatureRow(
        extensionPath, 'overview-workspace.webm', 'Overview swipe',
        settings, 'overview-workspace-switch-activation'));

    return group;
}

function _actionBarGroup(settings, extensionPath) {
    const group = new Adw.PreferencesGroup({
        title: 'Bottom action bar',
        description:
            'A thin strip pinned to the bottom of the primary monitor. ' +
            'Swipe left/right inside it to switch workspaces — including ' +
            'over fullscreen apps where no other workspace-switch path is ' +
            'reachable. Reserves 22 px at the bottom of the work area; the ' +
            'background fills with the theme colour when a window touches ' +
            'it. Taps pass through to whatever is underneath.',
    });

    group.add(buildFeatureRow(
        extensionPath, 'action-bar.webm', 'Action bar',
        settings, 'action-bar-activation'));
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
