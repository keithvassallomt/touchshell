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
    border-radius: 8px;
    background-color: alpha(@accent_color, 0.08);
    box-shadow: 0 1px 2px alpha(black, 0.12);
    margin: 6px 0;
    padding: 0;
}
.touchshell-demo picture {
    border-radius: 8px;
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

        const settings = this.getSettings();
        const path = this.path;

        window.add(buildEdgesPage(settings, path));
        window.add(buildWorkspacesPage(settings, path));
        window.add(buildOverviewPage(settings, path));
        window.add(buildWindowsPage(settings, path));
        window.add(buildTouchHelpersPage(settings, path));
    }
}

// Install the prefs CSS once per process. Adding the same provider
// twice would stack styles; we guard with a module-level flag. The
// provider is added to the default display, so every prefs window
// opened from the same shell session sees it.
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
