import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const ACTIVATION_OPTIONS = [
    { name: 'off', label: 'Off' },
    { name: 'auto', label: 'Auto' },
    { name: 'always', label: 'Always' },
];

export default class TouchshellPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage({
            title: 'Gestures',
            icon_name: 'input-touchpad-symbolic',
        });
        window.add(page);

        page.add(this._buildLegendGroup());
        page.add(this._buildTopRightSwipeGroup(settings));
        page.add(this._buildTopCenterSwipeGroup(settings));
        page.add(this._buildBottomEdgeSwipeGroup(settings));
        page.add(this._buildFlickToCloseGroup(settings));
        page.add(this._buildOverviewWorkspaceSwitchGroup(settings));
        page.add(this._buildOverviewVerticalSwipeGroup(settings));
        page.add(this._buildPanelAutoHideGroup(settings));
    }

    _buildOverviewWorkspaceSwitchGroup(settings) {
        const group = new Adw.PreferencesGroup({
            title: 'Workspace switch (in Activities overview)',
            description:
                'Single-finger horizontal swipe over the overview background switches workspaces, ' +
                'tracking the finger 1:1.',
        });

        group.add(this._buildActivationRow(
            settings,
            'overview-workspace-switch-activation',
            'Activation'
        ));

        return group;
    }

    _buildOverviewVerticalSwipeGroup(settings) {
        const group = new Adw.PreferencesGroup({
            title: 'Vertical swipe (in Activities overview)',
            description:
                'Single-finger vertical swipe over the overview background. Swipe up to reveal the ' +
                'app grid; swipe down to return to the windows view or to the desktop.',
        });

        group.add(this._buildActivationRow(
            settings,
            'overview-vertical-swipe-activation',
            'Activation'
        ));

        return group;
    }

    _buildFlickToCloseGroup(settings) {
        const group = new Adw.PreferencesGroup({
            title: 'Flick to close (in Activities overview)',
            description: 'Flick a window thumbnail upward in the Activities overview to close that window.',
        });

        group.add(this._buildActivationRow(
            settings,
            'flick-to-close-activation',
            'Activation'
        ));

        return group;
    }

    _buildTopCenterSwipeGroup(settings) {
        const group = new Adw.PreferencesGroup({
            title: 'Top-center swipe → Notifications',
            description: 'Swipe down from the top-center of the screen to open the date menu (notifications and calendar).',
        });

        group.add(this._buildActivationRow(
            settings,
            'top-center-swipe-activation',
            'Activation'
        ));

        const zoneRow = new Adw.SpinRow({
            title: 'Trigger zone width',
            subtitle: 'Percentage of screen width, centered horizontally.',
            adjustment: new Gtk.Adjustment({
                lower: 10,
                upper: 60,
                step_increment: 1,
                page_increment: 5,
            }),
        });
        group.add(zoneRow);
        settings.bind(
            'top-center-zone-width-percent',
            zoneRow,
            'value',
            Gio.SettingsBindFlags.DEFAULT
        );

        return group;
    }

    _buildBottomEdgeSwipeGroup(settings) {
        const group = new Adw.PreferencesGroup({
            title: 'Bottom-edge swipe → Overview',
            description: 'Swipe up from the bottom edge of the screen to open the Activities overview.',
        });

        group.add(this._buildActivationRow(
            settings,
            'bottom-edge-swipe-activation',
            'Activation'
        ));

        return group;
    }

    _buildPanelAutoHideGroup(settings) {
        const group = new Adw.PreferencesGroup({
            title: 'Panel auto-hide',
            description:
                'Hide the top panel when a window is maximized. Move the pointer to the ' +
                'top edge of the screen (or swipe from the top-right) to reveal it.',
        });

        group.add(this._buildActivationRow(
            settings,
            'panel-auto-hide-activation',
            'Activation'
        ));

        return group;
    }

    // Static description of what "Off / Auto / Always" mean. Lives at the
    // top of the page so users only have to read it once.
    _buildLegendGroup() {
        return new Adw.PreferencesGroup({
            description:
                'Each gesture can be set to Off, Auto, or Always. ' +
                'Auto means the gesture is only active when the system is in tablet mode ' +
                '(e.g. a convertible laptop folded into tablet posture).',
        });
    }

    _buildTopRightSwipeGroup(settings) {
        const group = new Adw.PreferencesGroup({
            title: 'Top-right swipe → Quick Settings',
            description: 'Swipe down from the top-right edge to open the Quick Settings menu.',
        });

        group.add(this._buildActivationRow(
            settings,
            'top-right-swipe-activation',
            'Activation'
        ));

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

        return group;
    }

    // AdwActionRow with an AdwToggleGroup suffix bound to a string-enum GSettings key.
    _buildActivationRow(settings, key, title) {
        const row = new Adw.ActionRow({ title });
        const toggleGroup = new Adw.ToggleGroup({ valign: Gtk.Align.CENTER });

        for (const opt of ACTIVATION_OPTIONS) {
            const t = new Adw.Toggle({ name: opt.name, label: opt.label });
            toggleGroup.add(t);
        }

        toggleGroup.set_active_name(settings.get_string(key));

        const settingsId = settings.connect(`changed::${key}`, () => {
            const v = settings.get_string(key);
            if (toggleGroup.get_active_name() !== v)
                toggleGroup.set_active_name(v);
        });
        const groupId = toggleGroup.connect('notify::active-name', () => {
            const v = toggleGroup.get_active_name();
            if (v && settings.get_string(key) !== v)
                settings.set_string(key, v);
        });
        row.connect('destroy', () => {
            settings.disconnect(settingsId);
            toggleGroup.disconnect(groupId);
        });

        row.add_suffix(toggleGroup);
        return row;
    }
}
