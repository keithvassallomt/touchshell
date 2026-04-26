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
        page.add(this._buildSwipeToDismissNotificationsGroup(settings));
        page.add(this._buildTextActionFabGroup(settings));
        page.add(this._buildOverviewWorkspaceSwitchGroup(settings));
        page.add(this._buildDesktopWorkspaceSwipeGroup(settings));
        page.add(this._buildOverviewVerticalSwipeGroup(settings));
        page.add(this._buildFullscreenAppsGroup(settings));
        page.add(this._buildPanelAutoHideGroup(settings));
    }

    _buildFullscreenAppsGroup(settings) {
        const group = new Adw.PreferencesGroup({
            title: 'Fullscreen Apps (iPad-style)',
            description:
                'Open new normal windows maximized by default (dialogs, popups and child windows are excluded). ' +
                'A two-finger downward swipe inside a maximized window restores it to its previous size — that’s ' +
                'the escape hatch, so it shares this toggle. Fullscreen videos/games are not affected. ' +
                'A Quick Settings tile lets you flip between Off and Always without coming here.',
        });

        group.add(this._buildActivationRow(
            settings,
            'auto-maximize-windows-activation',
            'Activation'
        ));

        group.add(this._buildExceptionsExpander(settings));

        const notifSwitch = new Adw.SwitchRow({
            title: 'Show opt-out notification',
            subtitle:
                'When a new app is maximized for the first time, offer a one-tap exception.',
        });
        settings.bind(
            'auto-maximize-show-optout-notification',
            notifSwitch,
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );
        group.add(notifSwitch);

        const resetRow = new Adw.ActionRow({
            title: 'Reset notification history',
            subtitle: 'Previously-dismissed apps will prompt again.',
        });
        const resetButton = new Gtk.Button({
            label: 'Reset',
            valign: Gtk.Align.CENTER,
        });
        resetButton.connect('clicked', () => {
            settings.set_strv('auto-maximize-prompted-apps', []);
        });
        resetRow.add_suffix(resetButton);
        group.add(resetRow);

        return group;
    }

    _buildExceptionsExpander(settings) {
        const expander = new Adw.ExpanderRow({
            title: 'Excluded apps',
            subtitle: 'These apps open at their default size, not maximized.',
        });

        // Footer row with the two add buttons. Stays at the bottom by
        // being re-added last each time the dynamic list is rebuilt.
        const footer = new Adw.ActionRow({ title: '' });
        const addAppButton = new Gtk.Button({
            label: 'Add app',
            valign: Gtk.Align.CENTER,
        });
        addAppButton.connect('clicked', () => {
            this._openAppPickerDialog(settings, addAppButton);
        });
        const addClassButton = new Gtk.Button({
            label: 'Add by WM_CLASS',
            valign: Gtk.Align.CENTER,
        });
        addClassButton.connect('clicked', () => {
            this._openWmClassDialog(settings, addClassButton);
        });
        footer.add_suffix(addAppButton);
        footer.add_suffix(addClassButton);

        // Track dynamically-added rows so we can remove them on refresh.
        const dynamicRows = [];

        const refresh = () => {
            for (const row of dynamicRows) {
                expander.remove(row);
            }
            dynamicRows.length = 0;
            try {
                expander.remove(footer);
            } catch (_) { /* not yet added on first run */ }

            const exceptions = settings.get_strv('auto-maximize-exceptions');
            for (const id of exceptions) {
                const row = this._buildExceptionRow(settings, id);
                expander.add_row(row);
                dynamicRows.push(row);
            }
            expander.add_row(footer);
        };

        const changedId = settings.connect(
            'changed::auto-maximize-exceptions', refresh);
        expander.connect('destroy', () => settings.disconnect(changedId));
        refresh();

        return expander;
    }

    _buildExceptionRow(settings, id) {
        const info = this._appInfoFor(id);
        const row = new Adw.ActionRow({
            title: info.name,
            subtitle: info.subtitle,
        });
        if (info.icon) {
            const image = new Gtk.Image({ pixel_size: 24 });
            image.set_from_gicon(info.icon);
            row.add_prefix(image);
        }
        const removeButton = new Gtk.Button({
            icon_name: 'list-remove-symbolic',
            valign: Gtk.Align.CENTER,
            tooltip_text: `Remove ${info.name}`,
        });
        removeButton.add_css_class('flat');
        removeButton.connect('clicked', () => {
            const cur = settings.get_strv('auto-maximize-exceptions');
            settings.set_strv(
                'auto-maximize-exceptions', cur.filter(x => x !== id));
        });
        row.add_suffix(removeButton);
        return row;
    }

    // Resolves a stored exception id to display info. Desktop ids
    // (".desktop"-suffixed) get their full app metadata; raw WM_CLASS
    // strings are shown verbatim with an "advanced" subtitle.
    _appInfoFor(id) {
        if (id.endsWith('.desktop')) {
            const appInfo = Gio.DesktopAppInfo.new(id);
            if (appInfo) {
                return {
                    name: appInfo.get_name() ?? id,
                    subtitle: id,
                    icon: appInfo.get_icon(),
                };
            }
        }
        return {
            name: id,
            subtitle: 'WM_CLASS match',
            icon: null,
        };
    }

    _openAppPickerDialog(settings, parent) {
        const root = parent.get_root();
        const dialog = new Adw.Dialog({
            title: 'Add app exception',
            content_width: 480,
            content_height: 560,
        });

        const listBox = new Gtk.ListBox({
            selection_mode: Gtk.SelectionMode.NONE,
        });
        listBox.add_css_class('boxed-list');
        listBox.set_margin_top(12);
        listBox.set_margin_bottom(12);
        listBox.set_margin_start(12);
        listBox.set_margin_end(12);

        const existing = new Set(settings.get_strv('auto-maximize-exceptions'));
        const apps = Gio.AppInfo.get_all()
            .filter(a => a.should_show())
            .filter(a => !existing.has(a.get_id()));
        const collator = new Intl.Collator(undefined, { sensitivity: 'base' });
        apps.sort((a, b) => collator.compare(a.get_name(), b.get_name()));

        for (const app of apps) {
            const row = new Adw.ActionRow({
                title: app.get_name(),
                subtitle: app.get_id(),
                activatable: true,
            });
            const icon = app.get_icon();
            if (icon) {
                const image = new Gtk.Image({ pixel_size: 24 });
                image.set_from_gicon(icon);
                row.add_prefix(image);
            }
            row.connect('activated', () => {
                this._addException(settings, app.get_id());
                dialog.close();
            });
            listBox.append(row);
        }

        const scrolled = new Gtk.ScrolledWindow({
            hscrollbar_policy: Gtk.PolicyType.NEVER,
            vexpand: true,
        });
        scrolled.set_child(listBox);

        const toolbar = new Adw.ToolbarView();
        toolbar.add_top_bar(new Adw.HeaderBar());
        toolbar.set_content(scrolled);
        dialog.set_child(toolbar);

        dialog.present(root);
    }

    _openWmClassDialog(settings, parent) {
        const root = parent.get_root();
        const entry = new Gtk.Entry({
            placeholder_text: 'e.g. Calculator or org.example.App',
            margin_top: 12,
            margin_bottom: 12,
            margin_start: 12,
            margin_end: 12,
            activates_default: true,
        });

        const dialog = new Adw.AlertDialog({
            heading: 'Add WM_CLASS exception',
            body:
                'Enter the WM_CLASS string of the app to exempt. Use the ' +
                '“Add app” picker for normal cases — this entry is for ' +
                'apps the picker can\'t resolve (some games, Wine apps, ' +
                'custom launchers).',
        });
        dialog.add_response('cancel', 'Cancel');
        dialog.add_response('add', 'Add');
        dialog.set_default_response('add');
        dialog.set_response_appearance('add', Adw.ResponseAppearance.SUGGESTED);
        dialog.set_extra_child(entry);

        dialog.connect('response', (_d, response) => {
            if (response !== 'add')
                return;
            const value = entry.get_text().trim();
            if (!value)
                return;
            this._addException(settings, value);
        });

        dialog.present(root);
    }

    _addException(settings, id) {
        const cur = settings.get_strv('auto-maximize-exceptions');
        if (!cur.includes(id))
            settings.set_strv('auto-maximize-exceptions', [...cur, id]);
        // Manually-added apps are implicitly "known" — no point
        // prompting later.
        const prompted = settings.get_strv('auto-maximize-prompted-apps');
        if (!prompted.includes(id)) {
            settings.set_strv(
                'auto-maximize-prompted-apps', [...prompted, id]);
        }
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

    _buildDesktopWorkspaceSwipeGroup(settings) {
        const group = new Adw.PreferencesGroup({
            title: 'Desktop swipe → switch workspace',
            description:
                'Single-finger horizontal swipe on a visible patch of desktop ' +
                'background switches workspaces with a 1:1 animation. Works ' +
                'on an empty desktop or in the empty area between/around windows.',
        });

        group.add(this._buildActivationRow(
            settings,
            'desktop-workspace-switch-activation',
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

    _buildTextActionFabGroup(settings) {
        const group = new Adw.PreferencesGroup({
            title: 'Touch text-action FAB',
            description:
                'A floating button gives you Cut / Copy / Paste / Select All ' +
                'on touch. The buttons fire the matching keyboard shortcut to ' +
                'the focused app — there is no selection management on our ' +
                'side. By default a translucent FAB sits in the bottom-right ' +
                'corner; tap it to open the bar. If you turn the FAB off, ' +
                'tap with two fingers anywhere to summon the bar instead.',
        });

        group.add(this._buildActivationRow(
            settings,
            'text-action-fab-activation',
            'Activation'
        ));

        const showRow = new Adw.SwitchRow({
            title: 'Always show the FAB',
            subtitle:
                'When off, hide the FAB and use a two-finger tap anywhere ' +
                'to summon the action bar.',
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

    _buildSwipeToDismissNotificationsGroup(settings) {
        const group = new Adw.PreferencesGroup({
            title: 'Swipe to dismiss notifications',
            description:
                'Swipe up on a notification banner, or swipe a notification in the ' +
                'date-menu list to the left, to dismiss it. (List uses left rather ' +
                'than up because up/down scrolls the list.)',
        });

        group.add(this._buildActivationRow(
            settings,
            'swipe-to-dismiss-notifications-activation',
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
