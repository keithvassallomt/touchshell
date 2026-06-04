import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export function monitorForPoint(x, y) {
    for (const m of Main.layoutManager.monitors) {
        if (x >= m.x && x < m.x + m.width &&
            y >= m.y && y <= m.y + m.height)
            return m;
    }
    return null;
}

// Returns up to two candidate identifiers for matching a window
// against an exceptions list: its desktop id (preferred) and its
// WM_CLASS, in priority order. Either matching means the app
// qualifies. WindowTracker only resolves the desktop id once
// focus/title/wm-class signals settle, so the id may be absent on a
// freshly-created window — the WM_CLASS fallback covers that gap.
export function appIds(win) {
    if (!win) return [];
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
