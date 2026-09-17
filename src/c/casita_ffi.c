// Native FFI bridge: exposes firmware hardware state to the JavaScript
// watchface.
//
// The battery badge needs to know, from JS, the watch's charge level. That
// state lives in the firmware (battery_state_service_peek()) and is NOT
// otherwise reachable from a Moddable "mod": mods carry no native code.
//
// Moddable's FFI is the sanctioned bridge. The JS side (src/embeddedjs/hw.ts)
// does `new FFI()`, which calls the firmware's FFI_constructor; that reads the
// fxBuildFFI pointer we install in mdbl.c (ModdableCreationRecord.fxBuildFFI)
// and calls fxBuildFFI() below. fxBuildFFI registers
// casita_battery_percent() as a method on the FFI instance, so JS can call
// `ffi.casita_battery_percent()` to read the charge level. It is a synchronous
// getter (the FFI table cannot push events into JS), read once per frame.
//
// This glue is hand-written (rather than generated from a manifest "ffi"
// section) so it is always part of the src/c/**/*.c build glob and does not
// depend on build-step ordering between the Moddable mod build and the app C
// compile.

#include <pebble.h>

// Set by fxBuildFFI() to the API table the firmware hands us; used by the host
// function wrappers below to marshal values in/out of the XS stack.
txAPI* XS = NULL;

// Returns the current battery charge level as a whole percentage (0-100).
// battery_state_service_peek() reads the latest state without needing a
// subscription, so this is a cheap synchronous getter. Runs as ordinary
// (unprivileged) app code, so calling the syscall is fine.
int32_t casita_battery_percent(void) {
  return (int32_t)battery_state_service_peek().charge_percent;
}

// XS host-function wrapper: no arguments, returns the battery percent to JS.
static void xs_casita_battery_percent(txMachine* the) {
  int32_t result = casita_battery_percent();
  XS->fromInteger(the, mxResult, (txInteger)result);
}

// Installed via ModdableCreationRecord.fxBuildFFI and invoked by the firmware
// FFI_constructor with `this` == the new FFI instance. Defines each exposed
// function as a method on that instance.
void fxBuildFFI(txMachine* the, txAPI* api) {
  XS = api;
  XS->newHostFunction(the, xs_casita_battery_percent, 0, 0, 0);
  XS->push(the, mxThis);
  XS->defineID(the, XS->id(the, "casita_battery_percent"), 0, 0x0E);
  XS->pop(the);
}
