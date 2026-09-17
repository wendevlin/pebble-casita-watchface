#include <pebble.h>

// Provided by src/c/casita_ffi.c; installs the JS-callable native bindings
// (currently casita_battery_percent) when the JS side constructs its FFI
// object.
extern void fxBuildFFI(txMachine* the, txAPI* api);

// Native Pebble entry point. This is the small C host that the firmware
// launches: it creates the app window and boots the Moddable XS JavaScript
// VM that runs our watchface code (src/embeddedjs). Without this file there
// is no bridge from the native app to the JS engine.
//
// moddable_createMachine() accepts a heap-sizing record. The default XS arena
// (~32 KB) is too small for this watchface once it is split into modules, so
// we hand-size the partitions (slot/chunk/stack).
//
// Slot budget: instantiating the mod's modules at launch happens with the
// garbage collector off, and it needs roughly 30 KB of slots for this code
// base. With 40 KB the launch died with "Slot allocation: failed in fixed size
// heap" as soon as one more module was added (nothing of main.ts had run yet),
// so the slot partition is 52 KB. The native app heap pays for that; the
// AppMessage inbox in main.ts is sized down to keep the balance. Measured via
// kModdableCreationFlagLogInstrumentation. The firmware validates the record
// and refuses to launch if the total is too large, so this fails safe.
//
// cr.fxBuildFFI wires our native FFI bindings into the VM: the firmware
// FFI_constructor reads this pointer when JS does `new FFI()` and calls it to
// register casita_battery_percent() (read by the battery badge). `new FFI()` is
// built once at startup from a shallow stack (see hw.ts / main.ts) rather than
// deep inside the first frame; the XS stack partition below is small, and a
// slot-stack overflow in XS is a fatal abort, so keeping FFI construction out
// of the render call chain (plus the small headroom bump from 3->5 KB) avoids
// it.
int main(void) {
  Window *w = window_create();
  // The JS side paints straight into the framebuffer (Poco), not through
  // layers. With the default white background the root layer would repaint
  // the window white every time the face comes back from a notification or
  // the menu — a visible flash until the next JS frame. GColorClear makes the
  // root layer paint nothing, so the last JS frame stays on screen.
  window_set_background_color(w, GColorClear);
  window_stack_push(w, true);

  ModdableCreationRecord cr = {
    .recordSize = sizeof(cr),
    .stack = 5 * 1024,
    .slot = 52 * 1024,
    .chunk = 20 * 1024,
    .flags = 0,
    .fxBuildFFI = (void *)fxBuildFFI,
  };

#ifdef PBL_DEBUG
  // Enable the xsbug JS debugger on debug builds only.
  cr.flags |= kModdableCreationFlagDebug;
#endif

  moddable_createMachine(&cr);

  window_destroy(w);
}
