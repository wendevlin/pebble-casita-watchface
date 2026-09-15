/*
 * Casita expression selection: picks which Casita image to show for a given
 * moment, falling back to the "disconnected" face when the phone link is down.
 */

import { Casita, expressionForHour } from "logic";

/** Returns the Casita resource id to show for `now` (respecting the phone link). */
export function currentCasitaId(now: Date): Casita {
  return watch.connected.app ? expressionForHour(now.getHours()) : Casita.Disconnected;
}
