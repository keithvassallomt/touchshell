import GLib from 'gi://GLib';
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
            return;
        }
        // GTK4 / Adwaita clients ack only the initial maximize
        // configure (which we send while struts are still on, so the
        // work area = monitor minus panel), then ignore the larger
        // configure that arrives once auto-hide flips struts off.
        // The buffer stays panel-height short, leaving a gap at the
        // bottom. Bouncing the max state on next idle — by which time
        // focus has changed, struts have flipped off, and the work
        // area is the full monitor — forces a fresh configure that
        // GTK4 honors.
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            try {
                if (win.maximized_horizontally && win.maximized_vertically) {
                    win.unmaximize();
                    win.maximize();
                }
            } catch (_) {
                // Window destroyed mid-bounce — fine.
            }
            return GLib.SOURCE_REMOVE;
        });
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
