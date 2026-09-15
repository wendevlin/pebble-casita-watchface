// Type declaration for the "ffi" module, which is preloaded by the pebble
// firmware (its host manifest includes modules/base/ffi). This is types-only:
// there is no local implementation to compile — `new FFI()` runs the firmware's
// FFI_constructor, which calls the fxBuildFFI we install in src/c (mdbl.c /
// casita_ffi.c) to register casita_light_on() on the instance. wake.ts polls it
// to read the real backlight state for the show-seconds-while-lit feature.
export default class FFI {
  constructor();
  /** Returns 1 when the backlight is on, 0 otherwise. */
  casita_light_on(): number;
  /** Returns the current battery charge level as a whole percentage (0-100). */
  casita_battery_percent(): number;
}
