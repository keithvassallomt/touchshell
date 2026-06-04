// Wraps the Off/Auto/Always activation pattern shared by every feature:
// listens to a string-enum GSettings key plus tablet-mode changes, and
// fires onEnable/onDisable as the effective state flips.
export class ActivationBinding {
    constructor(settings, tabletMode, key, { onEnable, onDisable }) {
        this._settings = settings;
        this._tabletMode = tabletMode;
        this._key = key;
        this._onEnable = onEnable;
        this._onDisable = onDisable;
        this._enabled = false;

        settings.connectObject(
            `changed::${key}`, () => this._sync(), this);
        tabletMode.connectObject('changed', () => this._sync(), this);
        this._sync();
    }

    destroy() {
        if (this._enabled) {
            this._enabled = false;
            this._onDisable?.();
        }
        this._settings?.disconnectObject(this);
        this._tabletMode?.disconnectObject(this);
        this._settings = null;
        this._tabletMode = null;
        this._onEnable = null;
        this._onDisable = null;
    }

    get enabled() {
        return this._enabled;
    }

    _sync() {
        const v = this._settings.get_string(this._key);
        const want = v === 'always' ||
            (v === 'auto' && this._tabletMode.isTabletMode);
        if (want && !this._enabled) {
            this._enabled = true;
            this._onEnable?.();
        } else if (!want && this._enabled) {
            this._enabled = false;
            this._onDisable?.();
        }
    }
}
