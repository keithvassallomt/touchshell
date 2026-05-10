import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';
import Soup from 'gi://Soup';

import {
    ACTIVATION_SUBTITLE_TEXT,
    buildActivationToggle,
} from './widgets.js';

// Demo videos are not bundled with the extension — they total ~5MB
// and only matter inside prefs. They live as assets on a GitHub
// release and are fetched on first prefs open into the XDG cache.
// Bump the tag here to force re-download after replacing a demo.
const DEMOS_BASE_URL =
    'https://github.com/keithvassallomt/touchshell/releases/download/demos-v1';

// Card dimensions sized so that, after .touchshell-demo's 8 px CSS
// padding, the inner content area lands at 220 × 124 — a 16:9 box
// that fits our 1280×720 demos edge-to-edge.
const PREVIEW_PADDING_PX = 8;
const PREVIEW_CARD_WIDTH_PX = 220 + 2 * PREVIEW_PADDING_PX;
const PREVIEW_CARD_HEIGHT_PX = 124 + 2 * PREVIEW_PADDING_PX;

const MODAL_WIDTH_PX = 800;
const MODAL_HEIGHT_PX = 480;

let _session = null;
const _inFlight = new Map();

export function buildFeatureRow(demoFilename, displayName,
                                settings, activationKey) {
    const row = new Adw.PreferencesRow({
        activatable: false,
        selectable: false,
        focusable: false,
    });

    const hbox = new Gtk.Box({
        orientation: Gtk.Orientation.HORIZONTAL,
        spacing: 16,
        margin_top: 6,
        margin_bottom: 6,
        margin_start: 12,
        margin_end: 12,
    });

    const cacheDir = _ensureCacheDir();
    const demoFile = Gio.File.new_for_path(
        GLib.build_filenamev([cacheDir, demoFilename]));
    hbox.append(_buildPreview(demoFile, demoFilename, displayName));

    const vbox = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 2,
        valign: Gtk.Align.START,
        hexpand: true,
        margin_top: 6,
    });

    const titleLabel = new Gtk.Label({
        label: 'Activation',
        halign: Gtk.Align.START,
        xalign: 0,
    });
    titleLabel.add_css_class('heading');

    const toggleGroup = buildActivationToggle(settings, activationKey, row);
    toggleGroup.set_halign(Gtk.Align.START);
    toggleGroup.set_margin_top(4);

    const subtitleLabel = new Gtk.Label({
        label: ACTIVATION_SUBTITLE_TEXT,
        halign: Gtk.Align.START,
        xalign: 0,
    });
    subtitleLabel.add_css_class('caption');
    subtitleLabel.add_css_class('dim-label');

    vbox.append(titleLabel);
    vbox.append(toggleGroup);
    vbox.append(subtitleLabel);

    hbox.append(vbox);
    row.set_child(hbox);
    return row;
}

function _buildPreview(demoFile, demoFilename, displayName) {
    const overlay = new Gtk.Overlay({
        width_request: PREVIEW_CARD_WIDTH_PX,
        height_request: PREVIEW_CARD_HEIGHT_PX,
        halign: Gtk.Align.START,
        valign: Gtk.Align.CENTER,
    });
    overlay.add_css_class('touchshell-demo');

    const mountVideo = () => {
        const media = Gtk.MediaFile.new_for_file(demoFile);
        media.set_muted(true);
        media.play();

        // Pause for 3s on each cycle end rather than the built-in
        // back-to-back loop, so the eye has time to digest the gesture
        // before it replays.
        let timeoutId = 0;
        media.connect('notify::ended', () => {
            if (!media.get_ended() || timeoutId) return;
            timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 3000, () => {
                timeoutId = 0;
                try {
                    media.seek(0);
                    media.play();
                } catch (_) {}
                return GLib.SOURCE_REMOVE;
            });
        });

        const picture = new Gtk.Picture({
            paintable: media,
            content_fit: Gtk.ContentFit.CONTAIN,
            can_shrink: true,
        });
        overlay.set_child(picture);
        overlay.add_overlay(_buildMaximizeButton(demoFile, displayName));

        overlay.connect('destroy', () => {
            if (timeoutId) {
                GLib.source_remove(timeoutId);
                timeoutId = 0;
            }
            try { media.set_playing(false); } catch (_) {}
        });
    };

    if (demoFile.query_exists(null)) {
        mountVideo();
    } else {
        overlay.set_child(_buildPlaceholder(displayName, /*downloading=*/true));
        _fetchDemo(demoFilename, demoFile, (ok) => {
            if (!overlay.get_parent()) return;
            if (ok) {
                mountVideo();
            } else {
                overlay.set_child(_buildPlaceholder(displayName,
                    /*downloading=*/false));
            }
        });
    }

    return overlay;
}

function _buildMaximizeButton(demoFile, displayName) {
    const button = new Gtk.Button({
        icon_name: 'view-fullscreen-symbolic',
        valign: Gtk.Align.START,
        halign: Gtk.Align.END,
        margin_top: 6,
        margin_end: 6,
        tooltip_text: 'Play larger',
        focus_on_click: false,
    });
    button.add_css_class('osd');
    button.add_css_class('circular');
    button.add_css_class('touchshell-demo-maximize');
    button.connect('clicked', () => _openModal(button, demoFile, displayName));
    return button;
}

function _openModal(parent, demoFile, displayName) {
    const root = parent.get_root();
    const dialog = new Adw.Dialog({
        title: displayName,
        content_width: MODAL_WIDTH_PX,
        content_height: MODAL_HEIGHT_PX,
    });

    const media = Gtk.MediaFile.new_for_file(demoFile);
    media.set_loop(true);
    media.set_muted(true);
    media.play();

    const picture = new Gtk.Picture({
        paintable: media,
        content_fit: Gtk.ContentFit.CONTAIN,
        can_shrink: true,
        hexpand: true,
        vexpand: true,
    });

    const wrapper = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        hexpand: true,
        vexpand: true,
    });
    wrapper.add_css_class('touchshell-demo-modal');
    wrapper.append(picture);

    const toolbar = new Adw.ToolbarView();
    toolbar.add_top_bar(new Adw.HeaderBar());
    toolbar.set_content(wrapper);
    dialog.set_child(toolbar);

    dialog.connect('closed', () => {
        try { media.set_playing(false); } catch (_) {}
    });

    dialog.present(root);
}

function _buildPlaceholder(displayName, downloading) {
    const box = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        valign: Gtk.Align.CENTER,
        halign: Gtk.Align.CENTER,
        spacing: 4,
    });
    box.add_css_class('touchshell-demo-placeholder');

    if (downloading) {
        const spinner = new Gtk.Spinner({ spinning: true });
        spinner.set_size_request(22, 22);
        box.append(spinner);
    } else {
        const icon = new Gtk.Image({
            icon_name: 'media-playback-start-symbolic',
            pixel_size: 22,
        });
        box.append(icon);
    }

    const label = new Gtk.Label({
        label: displayName,
        wrap: true,
        justify: Gtk.Justification.CENTER,
        max_width_chars: 18,
    });
    label.add_css_class('caption');
    box.append(label);

    return box;
}

function _ensureCacheDir() {
    const dir = GLib.build_filenamev([
        GLib.get_user_cache_dir(), 'touchshell', 'demos']);
    GLib.mkdir_with_parents(dir, 0o755);
    return dir;
}

// Soup-based fetch into the cache. We pin to one in-flight request per
// filename so two prefs pages opened back-to-back don't double-fetch
// the same asset — additional callers are queued and notified when
// the first download completes.
function _fetchDemo(filename, targetFile, callback) {
    const existing = _inFlight.get(filename);
    if (existing) {
        existing.push(callback);
        return;
    }
    const waiters = [callback];
    _inFlight.set(filename, waiters);

    const notify = (ok) => {
        _inFlight.delete(filename);
        for (const cb of waiters) {
            try { cb(ok); } catch (e) { logError(e); }
        }
    };

    if (!_session) {
        _session = new Soup.Session({
            user_agent: 'touchshell-prefs/1.0',
        });
    }
    const url = `${DEMOS_BASE_URL}/${filename}`;
    const msg = Soup.Message.new('GET', url);

    _session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, null,
        (session, res) => {
            let bytes;
            try {
                bytes = session.send_and_read_finish(res);
            } catch (e) {
                logError(e, `touchshell: demo fetch ${filename}`);
                notify(false);
                return;
            }
            if (msg.get_status() !== Soup.Status.OK) {
                log(`touchshell: demo fetch ${filename} HTTP ${msg.get_status()}`);
                notify(false);
                return;
            }
            try {
                const stream = targetFile.replace(null, false,
                    Gio.FileCreateFlags.NONE, null);
                stream.write_bytes(bytes, null);
                stream.close(null);
            } catch (e) {
                logError(e, `touchshell: demo write ${filename}`);
                notify(false);
                return;
            }
            notify(true);
        });
}
