/*
 * Casita expression selection: picks which Casita image to show for a given
 * moment. Falls back to the "disconnected" face when the phone link is down,
 * shows the "sweating" face when the last weather reading is 30 °C or hotter,
 * and otherwise uses the time-of-day expression.
 */

import { Casita, expressionForHour, isSweatingTemp } from "logic";
import { settings } from "data/settings";

/** Returns the Casita resource id to show for `now` (respecting the phone link). */
export function currentCasitaId(now: Date): Casita {
  if (!watch.connected.app) return Casita.Disconnected;
  if (isSweatingTemp(settings.weatherTemp)) return Casita.Sweating;
  return expressionForHour(now.getHours());
}
