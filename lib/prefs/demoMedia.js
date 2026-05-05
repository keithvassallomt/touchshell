import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {
    ACTIVATION_SUBTITLE_TEXT,
    buildActivationToggle,
} from './widgets.js';

// Inline preview dimensions — small enough to keep the row compact,
// big enough to read the gesture motion. 16:9 ratio.
const PREVIEW_WIDTH_PX = 200;
const PREVIEW_HEIGHT_PX = 113;

// Modal preview — substantially larger so the gesture is easy to
// study. Same 16:9 ratio so the dialog opens at a familiar shape.
const MODAL_WIDTH_PX = 800;
const MODAL_HEIGHT_PX = 480;

// Builds the combined "feature row" that anchors every group: a
// small inline video preview on the left (prefix), the activation
// title + subtitle in the middle, and the Off/Auto/Always toggle on
// the right. The video has a maximise button overlaid top-right —
// tapping it opens a larger modal player.
//
// Layout shape:
//
//   [▶ video]   Activation                   [Off|Auto|Always]
//               Auto = tablet mode only
//
// If the demo file isn't on disk yet, the prefix shows a labelled
// placeholder and the maximise button is hidden (nothing to expand).
export function buildFeatureRow(extensionPath, demoFilename, displayName,
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

    const demoPath = `${extensionPath}/assets/demos/${demoFilename}`;
    const demoFile = Gio.File.new_for_path(demoPath);
    const hasDemo = demoFile.query_exists(null);
    hbox.append(_buildPreview(demoFile, hasDemo, displayName));

    // Right column: title above, toggle in the middle, subtitle below.
    // Manual stack rather than AdwActionRow chrome because the canonical
    // ActionRow puts subtitle directly under title, with the toggle as a
    // suffix on the right — we want the toggle inline between the two.
    const vbox = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 2,
        valign: Gtk.Align.START,
        hexpand: true,
        // Match the 6 px top margin baked into .touchshell-demo (which
        // accounts for the demo card's soft shadow), so "Activation"
        // lines up with the *visible* top of the video, not the row.
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
    // Slightly more breathing room between heading and toggle than
    // between toggle and caption — heading carries more visual weight,
    // so a tighter gap below the toggle reads as a cohesive "field".
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

function _buildPreview(demoFile, hasDemo, displayName) {
    const overlay = new Gtk.Overlay({
        width_request: PREVIEW_WIDTH_PX,
        height_request: PREVIEW_HEIGHT_PX,
        valign: Gtk.Align.CENTER,
    });
    overlay.add_css_class('touchshell-demo');

    if (hasDemo) {
        const media = Gtk.MediaFile.new_for_file(demoFile);
        media.set_loop(true);
        media.set_muted(true);
        media.play();

        const picture = new Gtk.Picture({
            paintable: media,
            content_fit: Gtk.ContentFit.COVER,
            can_shrink: true,
        });
        overlay.set_child(picture);
        overlay.add_overlay(_buildMaximizeButton(demoFile, displayName));

        // Stop decoding when the row goes away.
        overlay.connect('destroy', () => {
            try { media.set_playing(false); } catch (_) {}
        });
    } else {
        overlay.set_child(_buildPlaceholder(displayName));
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

// Modal player. Independent Gtk.MediaFile instance so the inline
// preview keeps looping unaffected. Stops on dialog close.
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

function _buildPlaceholder(displayName) {
    const box = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        valign: Gtk.Align.CENTER,
        halign: Gtk.Align.CENTER,
        spacing: 4,
    });
    box.add_css_class('touchshell-demo-placeholder');

    const icon = new Gtk.Image({
        icon_name: 'media-playback-start-symbolic',
        pixel_size: 22,
    });
    box.append(icon);

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
