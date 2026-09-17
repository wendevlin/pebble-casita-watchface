// Type declaration for the "ffi" module, which is preloaded by the pebble
// firmware (its host manifest includes modules/base/ffi). This is types-only:
// there is no local implementation to compile — `new FFI()` runs the firmware's
// FFI_constructor, which calls the fxBuildFFI we install in src/c (mdbl.c /
// casita_ffi.c) to register casita_battery_percent() on the instance. hw.ts
// wraps it for the battery badge.
export default class FFI {
  constructor();
  /** Returns the current battery charge level as a whole percentage (0-100). */
  casita_battery_percent(): number;
}
