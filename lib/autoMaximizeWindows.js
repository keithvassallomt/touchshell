import Meta from 'gi://Meta';

import { ActivationBinding } from './activation.js';

// iPad-style: every new normal-type window opens maximized so the
// user gets a fullscreen experience by default. Existing windows are
// left alone — only newly-created windows are affected.
export class AutoMaximizeWindows {
    constructor(settings, tabletMode) {
        this._signalId = 0;

        this._activation = new ActivationBinding(
            settings, tabletMode, 'auto-maximize-windows-activation',
            {
                onEnable: () => this._setup(),
                onDisable: () => this._teardown(),
            }
        );
    }

    destroy() {
        this._activation?.destroy();
        this._activation = null;
    }

    _setup() {
        this._signalId = global.display.connect(
            'window-created',
            (_d, win) => this._onWindowCreated(win)
        );
    }

    _teardown() {
        if (this._signalId) {
            global.display.disconnect(this._signalId);
            this._signalId = 0;
        }
    }

    _onWindowCreated(win) {
        if (!this._shouldMaximize(win))
            return;
        try {
            // GNOME 49 dropped the MaximizeFlags arg — maximize() now
            // always means "both axes".
            win.maximize();
        } catch (_) {
            // Window may have been destroyed before we got here, or
            // declines maximize at the last moment — both harmless.
        }
    }

    _shouldMaximize(win) {
        if (!win)
            return false;
        if (win.window_type !== Meta.WindowType.NORMAL)
            return false;
        if (typeof win.is_override_redirect === 'function' && win.is_override_redirect())
            return false;
        if (win.get_transient_for?.())
            return false;
        if (typeof win.allows_maximize === 'function' && !win.allows_maximize())
            return false;
        if (win.maximized_horizontally && win.maximized_vertically)
            return false;
        if (typeof win.is_fullscreen === 'function' && win.is_fullscreen())
            return false;
        return true;
    }
}
