import Clutter from 'gi://Clutter';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageList from 'resource:///org/gnome/shell/ui/messageList.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';

import { ActivationBinding } from './activation.js';

const BANNER_ACTION_NAME = 'touchshell-swipe-dismiss-banner';
// Distance the finger must travel before release commits the
// dismissal. Calibrated above incidental finger-jitter but small
// enough that the dismiss feels quick on a touchscreen.
const DISMISS_THRESHOLD_PX = 40;
const SNAP_BACK_DURATION_MS = 180;
const DISMISS_DURATION_MS = 150;
// Drag translates the actor; opacity fades proportionally up to
// this much loss for visual feedback.
const MAX_FADE = 0.6;
// Drag distance (px) at which we hit MAX_FADE.
const FADE_DISTANCE_PX = 200;

// Two related gestures sharing one activation toggle:
//
// 1. Banner swipe-up: swipe up on the transient notification banner
//    (Main.messageTray._banner) → dismiss. Mirrors iPad/iOS muscle
//    memory; the banner is at the top so up = "go away".
//
// 2. List swipe-left: swipe a message in the date-menu's notification
//    list to the left → dismiss. The list is vertically scrollable,
//    so up/down can't be used here; left matches Android / iOS
//    notification-center pattern.
//
// Both attach in CAPTURE phase to their respective hosts. Real drags
// (movement past the PanGesture deadzone) are ours; clean taps still
// pass through to the underlying click handlers. PanGesture's axis
// constraint means our X-axis list gesture doesn't fight the scroll
// view's vertical kinetic scrolling.
//
// We translate the inner _banner widget (not _bannerBin) because
// PanelAutoHide already owns _bannerBin.translation_y to shift the
// banner below an auto-hidden panel that's currently shown. The
// banner widget is per-notification, so its translation doesn't
// survive the dismiss — no reset bookkeeping needed. Same for the
// per-message NotificationMessage widgets in the list: the actor
// goes away when the notification is destroyed.
export class SwipeToDismissNotifications {
    constructor(settings, tabletMode) {
        this._bannerGesture = null;
        // Each NotificationMessage gets its own gesture, kept in this
        // map so we can remove them on teardown. Map<message, gesture>.
        this._messageGestures = new Map();
        // Per-message accumulated dx during current drag.
        this._activeMessage = null;
        this._origAddNotification = null;

        this._activation = new ActivationBinding(
            settings, tabletMode, 'swipe-to-dismiss-notifications-activation',
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
        this._setupBannerGesture();
        this._setupListGesture();
    }

    _teardown() {
        this._teardownBannerGesture();
        this._teardownListGesture();
    }

    _setupBannerGesture() {
        this._bannerGesture = new Clutter.PanGesture({
            min_n_points: 1,
            max_n_points: 1,
            pan_axis: Clutter.PanAxis.Y,
        });
        this._bannerGesture.connect('pan-update', g => this._onBannerUpdate(g));
        this._bannerGesture.connect('end', _g => this._onBannerEnd());
        this._bannerGesture.connect('cancel', _g => this._snapBannerBack());

        const bin = Main.messageTray?._bannerBin;
        if (!bin)
            return;
        bin.add_action_full(
            BANNER_ACTION_NAME,
            Clutter.EventPhase.CAPTURE,
            this._bannerGesture
        );
    }

    _teardownBannerGesture() {
        const bin = Main.messageTray?._bannerBin;
        if (this._bannerGesture && bin)
            bin.remove_action(this._bannerGesture);
        this._bannerGesture = null;
        this._snapBannerBack();
    }

    _activeBanner() {
        return Main.messageTray?._banner ?? null;
    }

    _onBannerUpdate(g) {
        const banner = this._activeBanner();
        if (!banner)
            return;
        const dy = g.get_accumulated_delta().get_y();
        // Only follow upward motion (negative dy in stage coords);
        // downward drags do nothing — we don't want to push the
        // banner into screen content.
        const ty = Math.min(0, dy);
        banner.translation_y = ty;
        const fade = Math.min(MAX_FADE, Math.abs(ty) / FADE_DISTANCE_PX);
        banner.opacity = Math.round(255 * (1 - fade));
    }

    _onBannerEnd() {
        const banner = this._activeBanner();
        if (!banner) {
            this._snapBannerBack();
            return;
        }
        if (banner.translation_y <= -DISMISS_THRESHOLD_PX)
            this._dismissBanner();
        else
            this._snapBannerBack();
    }

    _dismissBanner() {
        const notification = Main.messageTray?._notification;
        if (!notification)
            return;
        try {
            // MessageTray's own hide animation slides _bannerBin up
            // to -height, which is the dismiss motion the user sees.
            // Our translation on the inner banner naturally rides
            // along until the banner is destroyed.
            notification.destroy(MessageTray.NotificationDestroyedReason.DISMISSED);
        } catch (_) {
            // Already gone — fine.
        }
    }

    _snapBannerBack() {
        const banner = this._activeBanner();
        if (!banner)
            return;
        banner.remove_all_transitions();
        banner.ease({
            translation_y: 0,
            opacity: 255,
            duration: SNAP_BACK_DURATION_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    // Date-menu list: swipe left. NotificationMessage actors handle their
    // own touch events (they extend St.Button), so a CAPTURE gesture on
    // the parent list never sees them. Instead we attach a dedicated
    // PanGesture per message. Existing messages are patched on enable;
    // new ones get patched by wrapping
    // NotificationMessageGroup.prototype._addNotification.

    _setupListGesture() {
        const proto = MessageList.NotificationMessageGroup?.prototype;
        if (proto?._addNotification && !this._origAddNotification) {
            this._origAddNotification = proto._addNotification;
            const self = this;
            proto._addNotification = function (notification) {
                const result = self._origAddNotification.call(this, notification);
                const msg = this._notificationToMessage?.get(notification);
                if (msg)
                    self._attachMessageGesture(msg);
                return result;
            };
        }

        const ml = Main.panel?.statusArea?.dateMenu?._messageList;
        const groups = ml?._messageView?.messages ?? [];
        for (const group of groups) {
            // Each group wraps each message in an St.Bin; the message
            // itself is the bin's first child.
            for (const child of group.get_children()) {
                const msg = child.get_first_child?.();
                if (msg)
                    this._attachMessageGesture(msg);
            }
        }
    }

    _teardownListGesture() {
        const proto = MessageList.NotificationMessageGroup?.prototype;
        if (this._origAddNotification && proto) {
            proto._addNotification = this._origAddNotification;
            this._origAddNotification = null;
        }
        for (const [msg, gesture] of this._messageGestures) {
            msg.remove_action(gesture);
            msg.translation_x = 0;
            msg.opacity = 255;
        }
        this._messageGestures.clear();
        this._activeMessage = null;
    }

    _attachMessageGesture(message) {
        if (!message || this._messageGestures.has(message))
            return;
        const gesture = new Clutter.PanGesture({
            min_n_points: 1,
            max_n_points: 1,
            pan_axis: Clutter.PanAxis.X,
        });
        gesture.connect('recognize', _g => {
            this._activeMessage = message;
        });
        gesture.connect('pan-update', g => this._onMessageUpdate(g, message));
        gesture.connect('end', _g => this._onMessageEnd(message));
        gesture.connect('cancel', _g => this._snapMessageBack(message));
        message.add_action(gesture);
        this._messageGestures.set(message, gesture);
        message.connect('destroy', () => {
            this._messageGestures.delete(message);
            if (this._activeMessage === message)
                this._activeMessage = null;
        });
    }

    _onMessageUpdate(g, message) {
        const dx = g.get_accumulated_delta().get_x();
        // Only follow leftward motion — rightward drag does nothing.
        const tx = Math.min(0, dx);
        message.translation_x = tx;
        // Fade scales over the same distance as the dismiss
        // threshold so the visual feedback peaks just as the gesture
        // is about to commit.
        const fadeDistance = Math.max(FADE_DISTANCE_PX, message.width / 2);
        const fade = Math.min(MAX_FADE, Math.abs(tx) / fadeDistance);
        message.opacity = Math.round(255 * (1 - fade));
    }

    _onMessageEnd(message) {
        if (this._activeMessage === message)
            this._activeMessage = null;
        // Commit only once the message has been dragged at least
        // halfway across its own width — feels more deliberate than a
        // fixed pixel threshold, especially on wider screens.
        const threshold = Math.max(DISMISS_THRESHOLD_PX, message.width / 2);
        if (message.translation_x <= -threshold)
            this._dismissListMessage(message);
        else
            this._snapMessageBack(message);
    }

    _dismissListMessage(message) {
        message.ease({
            translation_x: -message.width,
            opacity: 0,
            duration: DISMISS_DURATION_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                message.notification?.destroy(
                    MessageTray.NotificationDestroyedReason.DISMISSED);
            },
        });
    }

    _snapMessageBack(message) {
        message.remove_all_transitions();
        message.ease({
            translation_x: 0,
            opacity: 255,
            duration: SNAP_BACK_DURATION_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }
}
