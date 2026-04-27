// Disable Mutter's "unredirect for fullscreen window" optimisation.
//
// When enabled (the default), Mutter bypasses the compositor entirely
// for fullscreen windows: only the fullscreen surface is scanned out
// directly. This means anything else in the scene — chrome, overlays,
// notifications, our text-action FAB — stops being drawn while a
// window is fullscreen.
//
// Worse, when an app rapidly toggles its own fullscreen state (Chrome
// PWAs do this on shell intrusion), the redirect/unredirect cycle
// causes everything-but-the-window to flicker on/off without any
// actor.visible or actor.opacity change to detect — the visibility
// is gated below the actor layer, in the compositor itself.
//
// Mechanism mirrors the canonical "Disable Unredirect Fullscreen
// Windows" extension by kazysmaster: we have to monkey-patch
// `enable_unredirect` to a no-op because Mutter calls it itself
// whenever the fullscreen condition is re-evaluated, which would
// otherwise undo our disable within seconds.
export class DisableUnredirect {
    constructor() {
        this._origEnable = global.compositor.enable_unredirect;
        global.compositor.enable_unredirect = () => {};
        global.compositor.disable_unredirect();
    }

    destroy() {
        if (this._origEnable) {
            global.compositor.enable_unredirect = this._origEnable;
            this._origEnable = null;
            global.compositor.enable_unredirect();
        }
    }
}
