import Gdk from 'gi://Gdk';
import Gtk from 'gi://Gtk';

import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import { build as buildEdgesPage } from './lib/prefs/edgesPage.js';
import { build as buildOverviewPage } from './lib/prefs/overviewPage.js';
import { build as buildTouchHelpersPage } from './lib/prefs/touchHelpersPage.js';
import { build as buildWindowsPage } from './lib/prefs/windowsPage.js';
import { build as buildWorkspacesPage } from './lib/prefs/workspacesPage.js';

const STYLE = `
.touchshell-demo {
    border-radius: 10px;
    background-color: alpha(@accent_color, 0.08);
    box-shadow: 0 1px 2px alpha(black, 0.12);
    margin: 6px 0;
    padding: 8px;
}
.touchshell-demo picture {
    border-radius: 4px;
}
.touchshell-demo-placeholder {
    color: alpha(@window_fg_color, 0.5);
    padding: 8px;
}
.touchshell-demo-maximize {
    min-width: 0;
    min-height: 0;
    padding: 4px;
}
.touchshell-demo-modal {
    background-color: black;
}
`;

let _styleProviderInstalled = false;

export default class TouchshellPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        _ensureStyleProvider();
        _ensureIconTheme(this.path);

        const settings = this.getSettings();

        window.add(buildEdgesPage(settings));
        window.add(buildWorkspacesPage(settings));
        window.add(buildOverviewPage(settings));
        window.add(buildWindowsPage(settings));
        window.add(buildTouchHelpersPage(settings));
    }
}

// Install the prefs CSS once per process. Adding the same provider
// twice would stack styles; we guard with a module-level flag. The
// provider is added to the default display, so every prefs window
// opened from the same shell session sees it.
// Register our bundled hicolor icon dir so AdwPreferencesPage's
// icon-name property can resolve `touchshell-symbolic`. add_search_path
// is idempotent — Gtk dedupes the entry — but we still gate on a
// module flag to avoid the lookup on every prefs open.
let _iconThemeRegistered = false;
function _ensureIconTheme(extensionPath) {
    if (_iconThemeRegistered)
        return;
    const display = Gdk.Display.get_default();
    if (!display)
        return;
    const theme = Gtk.IconTheme.get_for_display(display);
    theme.add_search_path(`${extensionPath}/assets/icons`);
    _iconThemeRegistered = true;
}

function _ensureStyleProvider() {
    if (_styleProviderInstalled)
        return;
    const provider = new Gtk.CssProvider();
    provider.load_from_string(STYLE);
    Gtk.StyleContext.add_provider_for_display(
        Gdk.Display.get_default(),
        provider,
        Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION
    );
    _styleProviderInstalled = true;
}
