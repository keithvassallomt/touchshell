import Adw from 'gi://Adw';
import Gio from 'gi://Gio';

import { buildFeatureRow } from './demoMedia.js';
import { buildPageHeader } from './widgets.js';

export function build(settings) {
    const page = new Adw.PreferencesPage({
        title: 'Touch helpers',
        icon_name: 'touchshell-symbolic',
        name: 'touch-helpers',
    });

    page.add(buildPageHeader(
        'Touch-specific affordances that make GNOME usable without a ' +
        'pointer or keyboard.'
    ));

    page.add(_notifsGroup(settings));
    page.add(_textActionGroup(settings));

    return page;
}

function _notifsGroup(settings) {
    const group = new Adw.PreferencesGroup({
        title: 'Swipe to dismiss notifications',
    });

    group.add(buildFeatureRow(
        'notif-dismiss.webm', 'Notification dismiss',
        settings, 'swipe-to-dismiss-notifications-activation',
        'Swipe up on a banner, or left on a list notification, to dismiss it.'));

    return group;
}

function _textActionGroup(settings) {
    const group = new Adw.PreferencesGroup({
        title: 'Touch text-action FAB',
    });

    group.add(buildFeatureRow(
        'text-action-fab.webm', 'Text-action FAB',
        settings, 'text-action-fab-activation',
        'Floating button for Cut / Copy / Paste / Select All on touch. ' +
        'Sits bottom-right by default; turn it off and tap with three ' +
        'fingers to summon the bar instead.'));

    const showRow = new Adw.SwitchRow({
        title: 'Always show the FAB',
        subtitle:
            'Turn this off to hide the FAB — tap with three fingers ' +
            'anywhere to summon the action bar instead.',
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
