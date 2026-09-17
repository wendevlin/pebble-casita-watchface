/*
 * Native-hardware accessor.
 *
 * The battery badge (draw/badges.ts) needs the charge level, which is native
 * state reachable only through the firmware FFI bridge (`new FFI()` ->
 * fxBuildFFI in src/c/casita_ffi.c). This module owns the single lazily-created
 * FFI instance and exposes each reading as a small, failure-tolerant getter.
 */

import FFI from "ffi";

let ffi: FFI | undefined;
let attempted = false;

// Build the FFI object on first use. If it is unavailable (e.g. the firmware
// did not wire fxBuildFFI), remember the failure so we don't retry every tick.
function instance(): FFI | undefined {
  if (!ffi && !attempted) {
    attempted = true;
    try {
      ffi = new FFI();
    } catch (e) {
      // FFI unavailable — dependent features stay inert.
    }
  }
  return ffi;
}

/**
 * Eagerly constructs the FFI bridge from a shallow call site (during startup,
 * before the first frame). This keeps the potentially deep `new FFI()`
 * construction out of the render call stack: the watchface runs in a very small
 * XS stack partition (see src/c/mdbl.c), and a slot-stack overflow in XS is a
 * fatal, uncatchable abort — so building the bridge here, rather than lazily
 * inside drawBadges → readBattery, avoids overflowing the stack mid-render.
 * Safe to call more than once and never throws.
 */
export function initHw(): void {
  instance();
}

/**
 * Current battery charge as a whole percentage (0-100), or null when the
 * reading is unavailable so the battery badge can hide itself.
 */
export function batteryPercent(): number | null {
  const f = instance();
  if (!f) return null;
  try {
    const value = f.casita_battery_percent();
    if (typeof value === "number" && isFinite(value) && value >= 0) return value;
  } catch (e) {
    // Reading failed — hide the badge.
  }
  return null;
}
