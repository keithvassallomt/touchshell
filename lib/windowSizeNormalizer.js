import GLib from 'gi://GLib';
import Meta from 'gi://Meta';

// Time we wait after a workareas-changed event before measuring
// frame_rect on each window. Mutter sends new configures to
// maximized windows in response to the work-area change, and the
// client's ack roundtrips on the order of a few frames. Measuring
// too early sees stale frame_rect on every max window and triggers
// spurious bounces. 500ms covers a comfortable margin even on
// slower hardware.
const SETTLE_DELAY_MS = 500;

const DEBUG = false;
const LOG = (...a) => { if (DEBUG) console.log('[touchshell:size-normalizer]', ...a); };

// Keeps every visible window inside its monitor's current work area.
//
// The shell already resizes maximized windows when the work area
// shrinks, but two cases leak through:
//
//   1. GTK4 / Adwaita clients ack only the *initial* maximize
//      configure and ignore subsequent re-configures triggered by a
//      work-area change. Mutter thinks the window is at the new
//      (smaller) max rect; the visible buffer is still at the old
//      (larger) one. Fix: unmaximize() + maximize() bounce, which
//      forces a fresh maximize cycle the client will honor — the
//      same trick autoMaximizeWindows uses in the opposite direction.
//
//   2. Non-maximized windows whose frame_rect overhangs the new work
//      area never get auto-resized by Mutter — their size belongs to
//      the user/app. We clip width/height and reposition via
//      move_resize_frame so nothing sits under the top panel.
//
// Trigger: global.display::workareas-changed. Self-gating — when
// work area = full monitor (fullscreen-apps mode active, struts off)
// max windows that fill the monitor don't overhang and aren't
// touched. Debounced ~500ms so Mutter's own configure-ack window
// completes before we measure.
export class WindowSizeNormalizer {
    constructor() {
        this._timeoutId = 0;
        global.display.connectObject('workareas-changed',
            () => this._scheduleNormalize(), this);
    }

    destroy() {
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = 0;
        }
        global.display.disconnectObject(this);
    }

    _scheduleNormalize() {
        if (this._timeoutId)
            return;
        this._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT,
            SETTLE_DELAY_MS, () => {
                this._timeoutId = 0;
                try {
                    this._normalizeAll();
                } catch (e) {
                    LOG('normalizeAll threw:', e?.message ?? e);
                }
                return GLib.SOURCE_REMOVE;
            });
    }

    _normalizeAll() {
        const wsm = global.workspace_manager;
        for (let i = 0; i < wsm.n_workspaces; i++) {
            const ws = wsm.get_workspace_by_index(i);
            if (!ws)
                continue;
            const wins = ws.list_windows();
            for (const win of wins)
                this._normalizeWindow(win, ws);
        }
    }

    _normalizeWindow(win, ws) {
        try {
            if (!win)
                return;
            if (win.window_type !== Meta.WindowType.NORMAL)
                return;
            if (typeof win.is_fullscreen === 'function' && win.is_fullscreen())
                return;
            if (typeof win.is_override_redirect === 'function' &&
                win.is_override_redirect())
                return;

            const monitor = win.get_monitor?.();
            if (monitor === undefined || monitor < 0)
                return;
            const work = ws.get_work_area_for_monitor(monitor);
            if (!work)
                return;
            const r = win.get_frame_rect();
            if (!r || r.width <= 0 || r.height <= 0)
                return;

            if (win.maximized_horizontally && win.maximized_vertically) {
                if (r.x === work.x && r.y === work.y &&
                    r.width === work.width && r.height === work.height)
                    return;
                win.unmaximize();
                win.maximize();
                return;
            }

            const overhangsRight = r.x + r.width > work.x + work.width;
            const overhangsBottom = r.y + r.height > work.y + work.height;
            const overhangsLeft = r.x < work.x;
            const overhangsTop = r.y < work.y;
            if (!overhangsRight && !overhangsBottom &&
                !overhangsLeft && !overhangsTop)
                return;

            const w = Math.min(r.width, work.width);
            const h = Math.min(r.height, work.height);
            let x = r.x;
            let y = r.y;
            if (x < work.x)
                x = work.x;
            if (y < work.y)
                y = work.y;
            if (x + w > work.x + work.width)
                x = work.x + work.width - w;
            if (y + h > work.y + work.height)
                y = work.y + work.height - h;
            win.move_resize_frame(false, x, y, w, h);
        } catch (e) {
            LOG('normalizeWindow threw:', e?.message ?? e);
        }
    }
}
