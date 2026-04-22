import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class TouchshellPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage({
            title: 'General',
            icon_name: 'preferences-system-symbolic',
        });
        window.add(page);

        const group = new Adw.PreferencesGroup({
            title: 'Top-right swipe → Quick Settings',
            description: 'Swipe down from the top-right edge to open the Quick Settings menu.',
        });
        page.add(group);

        const enableRow = new Adw.SwitchRow({
            title: 'Enable top-right swipe',
        });
        group.add(enableRow);
        settings.bind(
            'enable-top-right-swipe',
            enableRow,
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );

        const zoneRow = new Adw.SpinRow({
            title: 'Trigger zone width',
            subtitle: 'Percentage of screen width that counts as the top-right edge.',
            adjustment: new Gtk.Adjustment({
                lower: 5,
                upper: 50,
                step_increment: 1,
                page_increment: 5,
            }),
        });
        group.add(zoneRow);
        settings.bind(
            'top-right-zone-width-percent',
            zoneRow,
            'value',
            Gio.SettingsBindFlags.DEFAULT
        );
    }
}
