/*
 * Casita watchface — entry point.
 *
 * This module is intentionally tiny: it only wires the runtime events to a
 * redraw. All rendering lives in draw, the persisted preferences + health reads
 * in data/settings, the shared graphics primitives in gfx, and the pure
 * selection/formatting logic (unit-tested) in logic.
 *
 * The face shows a centered Casita expression (picked from the local hour, or a
 * "disconnected" expression when the phone link drops) above a bottom clock,
 * with a right-aligned row of date / weather / steps badges. A light/dark theme
 * and the badge toggles are configured from the phone settings page and pushed
 * here over AppMessage; every preference is persisted so the face renders
 * correctly on launch before the phone reconnects.
 */

import Message from "pebble/message";
import { MESSAGE_KEYS } from "constants";
import { applyMessage } from "data/settings";
import { draw } from "draw/face";
import { initHw } from "hw";

// Live settings + weather updates from the phone. Keys match package.json
// `messageKeys` (see constants.MESSAGE_KEYS). The outbox only ever carries the
// one-integer REFRESH request, so it is kept tiny.
let inbox: Message;
inbox = new Message({
  keys: MESSAGE_KEYS,
  output: 64,
  onReadable() {
    applyMessage(inbox.read());
    draw();
  },
});

// Ask the phone to re-fetch weather, sun times and the Home Assistant reading.
// PebbleKit JS timers on the phone stall when the mobile app is frozen in the
// background, but an inbound AppMessage wakes it — so the watch drives the
// refresh: every REFRESH_EVERY_MIN minutes of the hour, and whenever the phone
// link comes back (a night in airplane mode otherwise leaves stale values).
const REFRESH_EVERY_MIN = 30;

function requestRefresh(): void {
  if (!watch.connected.app) return;
  try {
    inbox.write(new Map<string, number>([["REFRESH", 1]]));
  } catch (e) {
    // Outbox busy or phone just dropped — the next interval retries.
    console.log("Casita: refresh request not sent: " + e);
  }
}

watch.addEventListener("minutechange", (event) => {
  draw();
  if (event.date.getMinutes() % REFRESH_EVERY_MIN === 0) requestRefresh();
});
// Redraw immediately when the phone connection state changes so the
// disconnected expression appears without waiting for the next minute, and
// pull fresh data as soon as the phone is back.
watch.addEventListener("connected", () => {
  draw();
  requestRefresh();
});
// Redraw as the unobstructed area animates (e.g. the timeline quick view sliding
// in/out) so Casita resizes to fit right away instead of only on the next
// minute tick.
watch.addEventListener("resize", draw);

// Build the native FFI bridge (battery) once, from this shallow startup stack,
// so its construction never happens deep inside the first frame.
initHw();

draw();
