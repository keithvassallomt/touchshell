import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';

import { ActivationBinding } from './activation.js';

// iPad-style: every new normal-type window opens maximized so the
// user gets a fullscreen experience by default. Existing windows are
// left alone — only newly-created windows are affected. Apps the user
// has marked as exceptions (via the opt-out notification or prefs)
// are skipped.
export class AutoMaximizeWindows {
    constructor(settings, tabletMode) {
        this._settings = settings;
        this._signalId = 0;
        this._notifSource = null;

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
        this._settings = null;
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
        if (this._notifSource) {
            try { this._notifSource.destroy(); } catch (_) {}
            this._notifSource = null;
        }
    }

    _onWindowCreated(win) {
        if (!this._shouldMaximize(win))
            return;
        // Snapshot the window's natural rect *before* we maximize, so
        // an opt-out via the notification can restore something sane
        // even on borderless / non-resizable apps where Mutter's
        // saved_rect ends up matching the maximized rect.
        const origRect = this._snapshotRect(win);
        // Hide the actor while we decide. Some apps' desktop ids only
        // resolve via Shell.WindowTracker *after* window-created, so
        // we may end up unmaximizing on the idle re-check below — that
        // would otherwise show as a maximize→restore flash. Suppress
        // it by keeping the actor invisible until we've committed to a
        // final state. Reveal happens at the end of the idle callback.
        const actor = this._tryHide(win);
        try {
            // GNOME 49 dropped the MaximizeFlags arg — maximize() now
            // always means "both axes".
            win.maximize();
        } catch (_) {
            this._reveal(actor);
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
                // Re-check exemption now that Shell.WindowTracker has
                // had time to associate the window with its app.
                // Apps whose desktop id resolves only after window-
                // created (e.g. vicinae) would otherwise slip past the
                // initial exemption check and stay maximized.
                if (this._isExempt(win)) {
                    if (win.maximized_horizontally && win.maximized_vertically) {
                        win.unmaximize();
                        if (origRect) {
                            win.move_resize_frame(true,
                                origRect.x, origRect.y,
                                origRect.width, origRect.height);
                        }
                    }
                } else if (win.maximized_horizontally && win.maximized_vertically) {
                    win.unmaximize();
                    win.maximize();
                }
            } catch (_) {
                // Window destroyed mid-bounce — fine.
            }
            this._reveal(actor);
            return GLib.SOURCE_REMOVE;
        });
        // Defer the opt-out notification until after panel-auto-hide
        // has finished animating the panel away in response to the new
        // maximized window. Firing it inline causes the messageTray
        // banner to be added while _bannerBin's translation_y is mid-
        // tween, which renders the banner half-clipped under the panel
        // and partially transparent. A short timeout lets the panel
        // hide animation settle before we dispatch.
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 600, () => {
            try {
                this._maybePromptOptOut(win, origRect);
            } catch (_) { /* window or shell torn down */ }
            return GLib.SOURCE_REMOVE;
        });
    }

    _snapshotRect(win) {
        try {
            const r = win.get_frame_rect();
            if (r && r.width > 0 && r.height > 0) {
                return { x: r.x, y: r.y, width: r.width, height: r.height };
            }
        } catch (_) { /* rect unavailable yet */ }
        return null;
    }

    _tryHide(win) {
        try {
            const actor = win.get_compositor_private();
            if (actor) {
                actor.opacity = 0;
                return actor;
            }
        } catch (_) { /* actor not yet available — fall back to flash */ }
        return null;
    }

    _reveal(actor) {
        if (!actor) return;
        try {
            actor.remove_all_transitions();
            actor.opacity = 255;
        } catch (_) { /* actor torn down — fine */ }
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
        if (this._isExempt(win))
            return false;
        return true;
    }

    _isExempt(win) {
        const exceptions = this._settings.get_strv('auto-maximize-exceptions');
        if (exceptions.length === 0)
            return false;
        return this._appIds(win).some(id => exceptions.includes(id));
    }

    // Returns up to two candidate identifiers for matching against
    // the exceptions list (desktop id and WM_CLASS, in priority order).
    // Either matching means the app is exempt. Same identifiers are
    // used when recording an app in the prompted-apps list.
    _appIds(win) {
        const ids = [];
        try {
            const app = Shell.WindowTracker.get_default().get_window_app(win);
            const id = app?.get_id?.();
            if (id) ids.push(id);
        } catch (_) { /* WindowTracker unavailable — fall back to WM_CLASS */ }
        const cls = win.get_wm_class?.();
        if (cls) ids.push(cls);
        return ids;
    }

    _appDisplayName(win) {
        try {
            const app = Shell.WindowTracker.get_default().get_window_app(win);
            const name = app?.get_name?.();
            if (name) return name;
        } catch (_) { /* fall through */ }
        return win.get_wm_class?.() ?? null;
    }

    _maybePromptOptOut(win, origRect) {
        if (!this._settings.get_boolean('auto-maximize-show-optout-notification'))
            return;
        const ids = this._appIds(win);
        if (ids.length === 0)
            return;
        const primaryId = ids[0];
        const prompted = this._settings.get_strv('auto-maximize-prompted-apps');
        if (prompted.includes(primaryId))
            return;
        // Mark prompted *immediately* — even if dispatch fails or the
        // user dismisses without action, we never re-prompt for this
        // app. Resetting the prompt history is an explicit prefs action.
        this._settings.set_strv(
            'auto-maximize-prompted-apps', [...prompted, primaryId]);

        const appName = this._appDisplayName(win) ?? primaryId;
        this._showOptOutNotification(appName, primaryId, win, origRect);
    }

    _ensureNotifSource() {
        if (this._notifSource)
            return this._notifSource;
        const source = new MessageTray.Source({
            title: 'Fullscreen Apps',
            iconName: 'view-fullscreen-symbolic',
        });
        source.connect('destroy', () => {
            this._notifSource = null;
        });
        Main.messageTray.add(source);
        this._notifSource = source;
        return source;
    }

    _showOptOutNotification(appName, appId, win, origRect) {
        const source = this._ensureNotifSource();
        const notif = new MessageTray.Notification({
            source,
            title: `${appName} opened fullscreen`,
            body: 'Tap to opt this app out of Fullscreen Apps mode.',
            isTransient: true,
        });
        const optOut = () => {
            const cur = this._settings.get_strv('auto-maximize-exceptions');
            if (!cur.includes(appId)) {
                this._settings.set_strv(
                    'auto-maximize-exceptions', [...cur, appId]);
            }
            try {
                if (win.maximized_horizontally && win.maximized_vertically) {
                    win.unmaximize();
                    // Mutter restores to its own saved_rect, which for
                    // borderless / non-resizable apps can be the same
                    // as the maximized rect (so the window stays
                    // fullscreen-shaped). Force the geometry we
                    // captured before maximizing instead.
                    if (origRect) {
                        win.move_resize_frame(true,
                            origRect.x, origRect.y,
                            origRect.width, origRect.height);
                    }
                }
            } catch (_) { /* window gone — fine */ }
        };
        // Two routes to the same outcome: the named action button
        // (visible when the notification is expanded in the date menu)
        // and the 'activated' signal, which fires when the user taps
        // the banner itself — that's the touchscreen-natural gesture
        // and what the body copy is asking for.
        notif.addAction(`Don't auto-maximize ${appName}`, optOut);
        notif.connect('activated', optOut);
        source.addNotification(notif);
    }
}
