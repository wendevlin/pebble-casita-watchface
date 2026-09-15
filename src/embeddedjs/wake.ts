/*
 * Seconds-while-lit controller.
 *
 * The user wants seconds shown next to the clock "while the light is up",
 * triggered by any of the ways the backlight comes on: the back button, a
 * double tap, or a wrist raise. The only source that captures all of those
 * uniformly is the firmware backlight state (light_is_on()).
 *
 * Watchface JS cannot see button presses, and the accelerometer tap service
 * only fires on a deliberate sharp knock — it does NOT fire for a button press
 * or a gentle wrist raise, so a tap-based approximation misses the very
 * gestures the user named. Instead we read the real backlight state through a
 * tiny native FFI binding exposed by the shared hw.ts module: `new FFI()`
 * reaches the firmware-preloaded "ffi" module, whose constructor calls the
 * fxBuildFFI we install in src/c (see mdbl.c / casita_ffi.c), registering
 * casita_light_on() on the instance.
 *
 * The FFI table is synchronous only — the firmware cannot push a backlight
 * on/off event into JS — so we poll. While the feature is enabled we subscribe
 * to "secondchange" and, each second, read light_is_on(). The expensive full
 * redraw only runs while the light is actually on (a brief window), plus once
 * on the on->off edge to remove the seconds; the off-state ticks are cheap
 * wakes that do nothing. This keeps the extra battery cost to a 1 Hz wake while
 * the opt-in setting is on.
 */

import { lightOn } from "hw";
import { settings } from "data/settings";

let subscribed = false;
let lightState = false;
let redraw: (() => void) | undefined;

/** True while seconds should be drawn beside the clock. */
export function secondsVisible(): boolean {
  return settings.showSeconds && lightState;
}

function readLight(): boolean {
  return lightOn();
}

// Poll the backlight once per second. Redraw while lit so the seconds advance,
// and once more on the on->off transition to clear them; skip redundant work
// while the light stays off.
function onSecond(): void {
  const on = readLight();
  if (on) {
    lightState = true;
    if (redraw) redraw();
  } else if (lightState) {
    lightState = false;
    if (redraw) redraw();
  }
}

/** Registers the redraw callback and starts polling if the setting is on. */
export function initWake(onFrame: () => void): void {
  redraw = onFrame;
  refreshSubscription();
}

/**
 * Reconciles the per-second backlight polling with the current showSeconds
 * setting. Call after a settings message may have toggled it: subscribes when
 * enabled, and fully tears down (and hides any visible seconds) when disabled
 * so we never keep the 1 Hz wake alive needlessly.
 */
export function refreshSubscription(): void {
  if (settings.showSeconds) {
    if (!subscribed) {
      subscribed = true;
      watch.addEventListener("secondchange", onSecond);
    }
  } else {
    if (subscribed) {
      subscribed = false;
      watch.removeEventListener("secondchange", onSecond);
    }
    if (lightState) {
      lightState = false;
      if (redraw) redraw();
    }
  }
}
