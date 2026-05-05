import Adw from 'gi://Adw';
import Gio from 'gi://Gio';

import { buildFeatureRow } from './demoMedia.js';
import { buildPageHeader } from './widgets.js';

export function build(settings, extensionPath) {
    const page = new Adw.PreferencesPage({
        title: 'Touch helpers',
        icon_name: 'input-touchscreen-symbolic',
        name: 'touch-helpers',
    });

    page.add(buildPageHeader(
        'Touch-specific affordances that make GNOME usable without a ' +
        'pointer or keyboard.'
    ));

    page.add(_notifsGroup(settings, extensionPath));
    page.add(_textActionGroup(settings, extensionPath));

    return page;
}

function _notifsGroup(settings, extensionPath) {
    const group = new Adw.PreferencesGroup({
        title: 'Swipe to dismiss notifications',
        description:
            'Swipe up on a notification banner, or swipe a notification in ' +
            'the date-menu list to the left, to dismiss it. (List uses left ' +
            'rather than up because up/down scrolls the list.)',
    });

    group.add(buildFeatureRow(
        extensionPath, 'notif-dismiss.webm', 'Notification dismiss',
        settings, 'swipe-to-dismiss-notifications-activation'));

    return group;
}

function _textActionGroup(settings, extensionPath) {
    const group = new Adw.PreferencesGroup({
        title: 'Touch text-action FAB',
        description:
            'A floating button gives you Cut / Copy / Paste / Select All on ' +
            'touch. The buttons fire the matching keyboard shortcut to the ' +
            'focused app — there is no selection management on our side. By ' +
            'default a translucent FAB sits in the bottom-right corner; tap ' +
            'it to open the bar. If you turn the FAB off, tap with three ' +
            'fingers anywhere to summon the bar instead.',
    });

    group.add(buildFeatureRow(
        extensionPath, 'text-action-fab.webm', 'Text-action FAB',
        settings, 'text-action-fab-activation'));

    const showRow = new Adw.SwitchRow({
        title: 'Always show the FAB',
        subtitle:
            'When off, hide the FAB and use a three-finger tap anywhere to ' +
            'summon the action bar.',
    });
    settings.bind(
        'text-action-fab-show-button',
        showRow,
        'active',
        Gio.SettingsBindFlags.DEFAULT
    );
    group.add(showRow);

    return group;
}
