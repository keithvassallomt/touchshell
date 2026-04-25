import GObject from 'gi://GObject';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { QuickToggle, SystemIndicator } from 'resource:///org/gnome/shell/ui/quickSettings.js';

const KEY = 'auto-maximize-windows-activation';

// Binary on/off switch in Quick Settings that toggles the auto-
// maximize feature between 'off' and 'always'. The 'auto' enum value
// is reachable only via prefs (it ties auto-maximize to the tablet-
// mode sensor); the toggle treats both 'auto' and 'always' as ON.
const TabletModeToggle = GObject.registerClass(
class TabletModeToggle extends QuickToggle {
    _init() {
        super._init({
            title: 'Fullscreen Apps',
            iconName: 'view-fullscreen-symbolic',
            toggleMode: true,
        });
    }
});

const TabletModeIndicator = GObject.registerClass(
class TabletModeIndicator extends SystemIndicator {
    _init(toggle) {
        super._init();
        this.quickSettingsItems.push(toggle);
    }
});

export class TabletModeQuickToggle {
    constructor(settings) {
        this._settings = settings;
        this._toggle = new TabletModeToggle();
        this._indicator = new TabletModeIndicator(this._toggle);

        this._sync();
        this._settingsId = settings.connect(
            `changed::${KEY}`,
            () => this._sync()
        );
        // QuickToggle with toggleMode: true flips its `checked` property
        // BEFORE the 'clicked' signal fires, so we read the post-flip
        // state and write the matching enum value. (If we read the
        // pre-flip state we'd write back the same value we already had,
        // which silently no-ops.)
        this._clickedId = this._toggle.connect('clicked', () => {
            const next = this._toggle.checked ? 'always' : 'off';
            this._settings.set_string(KEY, next);
        });

        Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator);
    }

    destroy() {
        if (this._settingsId) {
            this._settings.disconnect(this._settingsId);
            this._settingsId = 0;
        }
        if (this._clickedId && this._toggle) {
            this._toggle.disconnect(this._clickedId);
            this._clickedId = 0;
        }
        if (this._indicator) {
            this._indicator.quickSettingsItems.forEach(i => i.destroy());
            this._indicator.destroy();
            this._indicator = null;
            this._toggle = null;
        }
        this._settings = null;
    }

    _sync() {
        const v = this._settings.get_string(KEY);
        this._toggle.checked = v !== 'off';
    }
}
