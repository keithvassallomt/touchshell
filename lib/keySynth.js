import Clutter from 'gi://Clutter';

// Wraps a Clutter virtual keyboard device. Same pattern as
// gnome-shell/js/ui/keyboard.js KeyboardController. Events go through
// Mutter's input dispatcher and reach whichever Wayland surface
// currently has keyboard focus, so toolkits handle the synthesised
// shortcuts the same way as a real key press.
export class KeySynth {
    constructor() {
        const seat = global.stage.context.get_backend().get_default_seat();
        this._device = seat.create_virtual_device(
            Clutter.InputDeviceType.KEYBOARD_DEVICE);
    }

    destroy() {
        this._device = null;
    }

    _press(keyval) {
        this._device.notify_keyval(
            Clutter.get_current_event_time() * 1000,
            keyval, Clutter.KeyState.PRESSED);
    }

    _release(keyval) {
        this._device.notify_keyval(
            Clutter.get_current_event_time() * 1000,
            keyval, Clutter.KeyState.RELEASED);
    }

    _pressCtrl(keyval) {
        this._press(Clutter.KEY_Control_L);
        this._press(keyval);
        this._release(keyval);
        this._release(Clutter.KEY_Control_L);
    }

    copy() { this._pressCtrl(Clutter.KEY_c); }
    cut() { this._pressCtrl(Clutter.KEY_x); }
    paste() { this._pressCtrl(Clutter.KEY_v); }
    selectAll() { this._pressCtrl(Clutter.KEY_a); }
}
