import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export function monitorForPoint(x, y) {
    for (const m of Main.layoutManager.monitors) {
        if (x >= m.x && x < m.x + m.width &&
            y >= m.y && y <= m.y + m.height)
            return m;
    }
    return null;
}
