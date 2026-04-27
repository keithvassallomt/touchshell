import Clutter from 'gi://Clutter';

import { ActivationBinding } from './activation.js';
import { KeySynth } from './keySynth.js';
import { TextActionFab } from './textActionFab.js';

// Window within which all three TOUCH_BEGINs of a summon must arrive.
// Wayland routes TOUCH_END straight to the client surface, so we
// never see lifts — pure-BEGIN detection is the only option for taps
// inside app windows.
const SUMMON_WINDOW_MS = 250;
// Two BEGINs further apart than this aren't part of the same gesture.
const SUMMON_MAX_DISTANCE_PX = 250;
// After firing a summon, ignore further BEGINs briefly so trailing
// finger lands don't generate a chain reaction.
const SUMMON_COOLDOWN_MS = 400;

// Touch text-action FAB. The user gets cut/copy/paste/select-all by
// way of synthesised Ctrl+X/C/V/A keyboard shortcuts (which the
// focused toolkit handles natively), without our extension needing to
// know what's selected. Two ways to surface the action bar:
//   - Persistent corner FAB (default): translucent button always
//     visible in the bottom-right; tap it to expand.
//   - Three-finger summon (when corner FAB hidden in prefs): three
//     simultaneous TOUCH_BEGINs anywhere on the stage pop the bar at
//     their centroid. Three fingers and not two because a two-finger
//     tap collides with right-click in many GTK / Qt / browser apps.
//
// AT-SPI is intentionally NOT used here. Selection introspection on
// Wayland turned out to be a dead end (toolkit gaps, sync-D-Bus
// deadlocks, multi-process opacity in browsers). We let the toolkit
// own the selection and just feed it shortcuts.
export class TextActionController {
    constructor(settings, tabletMode) {
        this._settings = settings;
        this._migrateSchemaKey(settings);
        this._activation = new ActivationBinding(
            settings, tabletMode, 'text-action-fab-activation',
            { onEnable: () => this._setup(), onDisable: () => this._teardown() }
        );
    }

    destroy() {
        this._activation?.destroy();
        this._activation = null;
        this._settings = null;
    }

    // One-shot copy of the prior text-selection-activation value into
    // the new key, so users keep their saved Off/Auto/Always.
    _migrateSchemaKey(settings) {
        try {
            const oldVal = settings.get_string('text-selection-activation');
            const newVal = settings.get_string('text-action-fab-activation');
            if (newVal === 'auto' && oldVal !== 'auto')
                settings.set_string('text-action-fab-activation', oldVal);
        } catch (_) { /* old key already removed from schema */ }
    }

    _setup() {
        this._keySynth = new KeySynth();
        this._fab = new TextActionFab({
            onAction: (action) => this._onAction(action),
            onPositionChanged: (x, y) => this._onFabMoved(x, y),
        });

        // Restore last-saved FAB position (if any).
        const savedX = this._settings.get_int('text-action-fab-x');
        const savedY = this._settings.get_int('text-action-fab-y');
        this._fab.setCornerPosition(savedX, savedY);

        this._recentBegins = []; // [{x, y, t}], pruned to SUMMON_WINDOW_MS
        this._lastSummonAt = 0;
        // Suppress writing back the position we just read on enable.
        this._suppressPosWrite = false;

        this._showButtonId = this._settings.connect(
            'changed::text-action-fab-show-button',
            () => this._applyShowButton());
        this._posXId = this._settings.connect(
            'changed::text-action-fab-x',
            () => this._applySavedPos());
        this._posYId = this._settings.connect(
            'changed::text-action-fab-y',
            () => this._applySavedPos());
        this._applyShowButton();

        this._capturedId = global.stage.connect('captured-event',
            (_a, e) => this._onCapturedEvent(e));
        this._focusChangeId = global.display.connect(
            'notify::focus-window', () => this._onFocusChanged());
        this._fsWindow = null;
        this._fsWindowId = 0;
        this._onFocusChanged();
    }

    _onFocusChanged() {
        if (this._fsWindowId) {
            try { this._fsWindow?.disconnect(this._fsWindowId); }
            catch (_) {}
            this._fsWindowId = 0;
            this._fsWindow = null;
        }
        const w = global.display.focus_window;
        this._fab?.collapse();
        if (w) {
            this._fsWindow = w;
            this._fsWindowId = w.connect('notify::fullscreen',
                () => this._applyFsSuppression());
        }
        this._applyFsSuppression();
    }

    _applyFsSuppression() {
        const w = global.display.focus_window;
        const fs = (() => {
            try { return w?.is_fullscreen?.() ?? false; }
            catch (_) { return false; }
        })();
        this._fab?.setSuppressed(fs);
    }

    _applySavedPos() {
        if (this._suppressPosWrite || !this._fab) return;
        const x = this._settings.get_int('text-action-fab-x');
        const y = this._settings.get_int('text-action-fab-y');
        this._fab.setCornerPosition(x, y);
    }

    _onFabMoved(x, y) {
        // Re-entrancy guard: writing the int triggers our 'changed::'
        // listeners which would loop us back into setCornerPosition
        // for no reason.
        this._suppressPosWrite = true;
        try {
            this._settings.set_int('text-action-fab-x', x);
            this._settings.set_int('text-action-fab-y', y);
        } finally {
            this._suppressPosWrite = false;
        }
    }

    _teardown() {
        if (this._capturedId) {
            global.stage.disconnect(this._capturedId);
            this._capturedId = 0;
        }
        if (this._focusChangeId) {
            global.display.disconnect(this._focusChangeId);
            this._focusChangeId = 0;
        }
        if (this._fsWindowId) {
            try { this._fsWindow?.disconnect(this._fsWindowId); }
            catch (_) {}
            this._fsWindowId = 0;
            this._fsWindow = null;
        }
        for (const id of ['_showButtonId', '_posXId', '_posYId']) {
            if (this[id]) {
                this._settings.disconnect(this[id]);
                this[id] = 0;
            }
        }
        this._recentBegins = [];
        this._fab?.destroy();
        this._keySynth?.destroy();
        this._fab = null;
        this._keySynth = null;
    }

    _applyShowButton() {
        const showAlways = this._settings.get_boolean(
            'text-action-fab-show-button');
        this._fab?.setPersistent(showAlways);
    }

    _onCapturedEvent(event) {
        const type = event.type();
        const isTouchBegin = type === Clutter.EventType.TOUCH_BEGIN;
        const isMousePress = type === Clutter.EventType.BUTTON_PRESS;
        if (!isTouchBegin && !isMousePress)
            return Clutter.EVENT_PROPAGATE;

        const [x, y] = event.get_coords();
        const time = event.get_time();

        // Tap-outside dismisses the expanded bar. We can't classify
        // taps without TOUCH_END but for dismissal we don't need to —
        // any touch/click that lands outside the bar drops it.
        if (this._fab?.isExpanded() && !this._fab.containsPoint(x, y)) {
            this._fab.collapse();
            return Clutter.EVENT_PROPAGATE;
        }

        // Mouse clicks only dismiss; they don't participate in the
        // two-finger summon flow.
        if (isMousePress) return Clutter.EVENT_PROPAGATE;

        // Don't try to summon from taps on our own actors.
        if (this._fab?.containsPoint(x, y))
            return Clutter.EVENT_PROPAGATE;

        // Cooldown to avoid re-summoning on a trailing finger from a
        // tap we already fired on (TOUCH_BEGINs can echo).
        if (time - this._lastSummonAt < SUMMON_COOLDOWN_MS)
            return Clutter.EVENT_PROPAGATE;

        // Prune stale entries.
        this._recentBegins = this._recentBegins.filter(
            b => time - b.t < SUMMON_WINDOW_MS);

        // Look for at least two earlier BEGINs within range of the
        // current one — together they make a three-finger tap.
        const partners = this._recentBegins.filter(b =>
            Math.hypot(b.x - x, b.y - y) < SUMMON_MAX_DISTANCE_PX);
        if (partners.length >= 2) {
            const trio = [partners[0], partners[1], { x, y, t: time }];
            this._recentBegins = [];
            this._lastSummonAt = time;
            const mx = (trio[0].x + trio[1].x + trio[2].x) / 3;
            const my = (trio[0].y + trio[1].y + trio[2].y) / 3;
            this._fab?.expandAt(mx, my);
        } else {
            this._recentBegins.push({ x, y, t: time });
        }
        return Clutter.EVENT_PROPAGATE;
    }

    _onAction(action) {
        switch (action) {
        case 'cut': this._keySynth.cut(); break;
        case 'copy': this._keySynth.copy(); break;
        case 'paste': this._keySynth.paste(); break;
        case 'selectAll': this._keySynth.selectAll(); break;
        }
        this._fab?.collapse();
    }
}
