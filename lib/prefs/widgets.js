import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

const ACTIVATION_OPTIONS = [
    { name: 'off', label: 'Off' },
    { name: 'auto', label: 'Auto' },
    { name: 'always', label: 'Always' },
];

const ACTIVATION_SUBTITLE = 'Auto = tablet mode only';

export const ACTIVATION_SUBTITLE_TEXT = ACTIVATION_SUBTITLE;

// Returns just the AdwToggleGroup widget (not a row) bound bi-
// directionally to the given Off/Auto/Always GSettings enum key.
// Cleanup is wired to `hostWidget.destroy` so the caller doesn't
// have to remember it.
export function buildActivationToggle(settings, key, hostWidget) {
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
    hostWidget.connect('destroy', () => {
        settings.disconnect(settingsId);
        toggleGroup.disconnect(groupId);
    });

    return toggleGroup;
}

// AdwSpinRow bound to an integer GSettings key, with a stable
// adjustment configured for the given range.
export function buildSpinRow(settings, key, title, subtitle, min, max) {
    const row = new Adw.SpinRow({
        title,
        subtitle,
        adjustment: new Gtk.Adjustment({
            lower: min,
            upper: max,
            step_increment: 1,
            page_increment: 5,
        }),
    });
    settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

// Top-of-page intro text plus the Auto=tablet legend. Custom widget
// rather than the default group `description` slot, which renders dim
// and small — too easy to skip past.
export function buildPageHeader(description) {
    const group = new Adw.PreferencesGroup();

    const box = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 4,
        hexpand: true,
    });
    box.add_css_class('touchshell-page-header');

    const main = new Gtk.Label({
        label: description,
        wrap: true,
        xalign: 0,
        hexpand: true,
    });
    main.add_css_class('body');

    const sub = new Gtk.Label({
        label: ACTIVATION_SUBTITLE,
        wrap: true,
        xalign: 0,
        hexpand: true,
    });
    sub.add_css_class('caption');
    sub.add_css_class('dim-label');

    box.append(main);
    box.append(sub);
    group.add(box);

    return group;
}

// AdwExpanderRow bound to an `as` GSettings key (list of strings).
// Each list entry renders as a removable AdwActionRow with the app's
// icon and name resolved from the desktop file id, or as a raw
// WM_CLASS string when no .desktop is registered.
//
// Footer holds two add buttons: "Add app" (picker) and
// "Add by WM_CLASS" (free-text). The list refreshes on every
// `changed::<key>` signal so external edits also reflect.
export function buildExceptionsExpander(settings, key, title, subtitle) {
    const expander = new Adw.ExpanderRow({ title, subtitle });

    const footer = new Adw.ActionRow({ title: '' });
    const addAppButton = new Gtk.Button({
        label: 'Add app',
        valign: Gtk.Align.CENTER,
    });
    addAppButton.connect('clicked', () => {
        _openAppPickerDialog(settings, key, addAppButton);
    });
    const addClassButton = new Gtk.Button({
        label: 'Add by WM_CLASS',
        valign: Gtk.Align.CENTER,
    });
    addClassButton.connect('clicked', () => {
        _openWmClassDialog(settings, key, addClassButton);
    });
    footer.add_suffix(addAppButton);
    footer.add_suffix(addClassButton);

    const dynamicRows = [];
    let footerAdded = false;

    const refresh = () => {
        for (const row of dynamicRows)
            expander.remove(row);
        dynamicRows.length = 0;
        if (footerAdded) {
            expander.remove(footer);
            footerAdded = false;
        }

        const exceptions = settings.get_strv(key);
        for (const id of exceptions) {
            const row = _buildExceptionRow(settings, key, id);
            expander.add_row(row);
            dynamicRows.push(row);
        }
        expander.add_row(footer);
        footerAdded = true;
    };

    const changedId = settings.connect(`changed::${key}`, refresh);
    expander.connect('destroy', () => settings.disconnect(changedId));
    refresh();

    return expander;
}

function _buildExceptionRow(settings, key, id) {
    const info = _appInfoFor(id);
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
        const cur = settings.get_strv(key);
        settings.set_strv(key, cur.filter(x => x !== id));
    });
    row.add_suffix(removeButton);
    return row;
}

function _appInfoFor(id) {
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

function _openAppPickerDialog(settings, key, parent) {
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

    const existing = new Set(settings.get_strv(key));
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
            _addException(settings, key, app.get_id());
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

function _openWmClassDialog(settings, key, parent) {
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
        _addException(settings, key, value);
    });

    dialog.present(root);
}

function _addException(settings, key, id) {
    const cur = settings.get_strv(key);
    if (!cur.includes(id))
        settings.set_strv(key, [...cur, id]);
}
