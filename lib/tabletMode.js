import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';

// Wraps the Clutter seat's "touch-mode" property, which GNOME flips to true
// when a convertible device is folded into tablet posture (or any time the
// system reports SW_TABLET_MODE via libinput). Emits a 'changed' signal so
// per-feature gesture handlers can re-evaluate whether they should be active.
export const TabletModeMonitor = GObject.registerClass({
    Signals: { 'changed': {} },
}, class TabletModeMonitor extends GObject.Object {
    _init() {
        super._init();
        this._seat = Clutter.get_default_backend().get_default_seat();
        this._notifyId = this._seat.connect(
            'notify::touch-mode',
            () => this.emit('changed')
        );
    }

    get isTabletMode() {
        return this._seat?.touchMode ?? false;
    }

    destroy() {
        if (this._notifyId) {
            this._seat.disconnect(this._notifyId);
            this._notifyId = 0;
        }
        this._seat = null;
    }
});
