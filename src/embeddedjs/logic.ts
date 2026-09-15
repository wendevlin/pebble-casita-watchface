/*
 * Pure watchface logic with no runtime dependencies, kept separate from the
 * rendering code in main.ts so it can be unit-tested with `bun test`.
 */

// Resource IDs assigned by `pebble build` in package.json media declaration
// order (see pebble.resources.media).
export enum Casita {
  Normal = 1,
  Happy = 2,
  Grinning = 3,
  Sleeping = 4,
  Disconnected = 5,
}

// MDI badge icons, converted to PDC and declared after the Casita images in
// package.json (so their resource IDs continue the same 1-based sequence).
export enum Icon {
  Thermometer = 6,
  ShoePrint = 7,
  CalendarBlank = 8,
  BatteryLow = 9,
  BatteryMedium = 10,
  BatteryHigh = 11,
}

/**
 * Selects the Casita expression for a given local hour (0-23):
 *   06:00-11:59 -> Normal   (morning)
 *   12:00-14:59 -> Happy    (noon)
 *   15:00-20:59 -> Grinning (afternoon)
 *   21:00-05:59 -> Sleeping (night)
 */
export function expressionForHour(hour: number): Casita {
  if (hour >= 6 && hour < 12) return Casita.Normal;
  if (hour >= 12 && hour < 15) return Casita.Happy;
  if (hour >= 15 && hour < 21) return Casita.Grinning;
  return Casita.Sleeping;
}

function pad2(value: number): string {
  return value < 10 ? "0" + value : "" + value;
}

/**
 * Formats the time following the watch's 12/24-hour preference:
 *   24h: leading-zero hour (e.g. "07:05", "18:30")
 *   12h: no leading-zero hour, 12 for midnight/noon (e.g. "7:05", "12:30")
 */
export function formatTime(date: Date, hour12: boolean): string {
  const minutes = pad2(date.getMinutes());
  if (hour12) {
    let hour = date.getHours() % 12;
    if (hour === 0) hour = 12;
    return hour + ":" + minutes;
  }
  return pad2(date.getHours()) + ":" + minutes;
}

/** Formats the seconds as a two-digit string ("00".."59"), shown next to the
 * time while the backlight window is active. */
export function formatSeconds(date: Date): string {
  return pad2(date.getSeconds());
}

// --------------------------------------------------------------------------- //
// Theme (light/dark) setting
// --------------------------------------------------------------------------- //

export type Theme = "light" | "dark";

// The watchface historically rendered on a black background, so "dark" is the
// default to keep existing behaviour when no preference has been stored yet.
export const DEFAULT_THEME: Theme = "dark";

/**
 * Coerces a stored (string) or app-message (number) theme value into a valid
 * Theme, falling back to DEFAULT_THEME for anything unrecognised.
 *
 * Accepts: "light"/"dark", the numbers 0 (light) / 1 (dark), and their string
 * forms "0"/"1" (AppMessage integers can arrive as either).
 */
export function normalizeTheme(value: unknown): Theme {
  if (value === "light" || value === "dark") return value;
  if (value === 0 || value === "0") return "light";
  if (value === 1 || value === "1") return "dark";
  return DEFAULT_THEME;
}

/** Encodes a theme as the integer sent over AppMessage (0 = light, 1 = dark). */
export function themeToCode(theme: Theme): number {
  return theme === "dark" ? 1 : 0;
}

// --------------------------------------------------------------------------- //
// Badges (weather + steps)
// --------------------------------------------------------------------------- //

/**
 * Coerces a stored/app-message on-off value into a boolean. Accepts booleans,
 * the numbers 0/1, and the strings "0"/"1"/"true"/"false" (AppMessage toggles
 * arrive as integers, localStorage stores strings).
 */
export function normalizeToggle(value: unknown, fallback = false): boolean {
  if (value === true || value === 1 || value === "1" || value === "true") return true;
  if (value === false || value === 0 || value === "0" || value === "false") return false;
  return fallback;
}

/** Encodes a toggle as the integer sent over AppMessage (0 = off, 1 = on). */
export function toggleToCode(on: boolean): number {
  return on ? 1 : 0;
}

/**
 * Formats a step count compactly:
 *   below 100      -> the raw count            (e.g. 56)
 *   100 .. 999     -> tenths of a K with unit  (e.g. 410 -> "0,4K")
 *   1000 and above -> whole K, decimals dropped (e.g. 12876 -> "12K")
 * Uses a comma decimal separator to match the temperature badge.
 */
export function formatSteps(steps: number): string {
  if (!isFinite(steps) || steps <= 0) return "0";
  const whole = Math.round(steps);
  if (whole < 100) return String(whole);
  if (whole < 1000) return (whole / 1000).toFixed(1).replace(".", ",") + "K";
  return Math.floor(whole / 1000) + "K";
}

/** Formats a date as its day-of-month number, e.g. the 14th -> "14". */
export function formatDate(date: Date): string {
  return String(date.getDate());
}

/**
 * Formats a battery charge level (0-100 percent) as a compact "85%" string.
 * Clamps out-of-range values and returns "--" for non-finite input.
 */
export function formatBattery(percent: number): string {
  if (!isFinite(percent)) return "--";
  let p = Math.round(percent);
  if (p < 0) p = 0;
  if (p > 100) p = 100;
  return p + "%";
}

/**
 * Picks the battery icon variant for a charge level, colour-coded by how full
 * the battery is: high (≥ 70%) green, medium (≥ 30%) orange, low (< 30%) red.
 */
export function batteryIcon(percent: number): Icon {
  if (percent >= 70) return Icon.BatteryHigh;
  if (percent >= 30) return Icon.BatteryMedium;
  return Icon.BatteryLow;
}

// --------------------------------------------------------------------------- //
// Badge order setting
// --------------------------------------------------------------------------- //

/** Stable identifiers for the badges, in their default left→right order. */
export type BadgeId = "date" | "weather" | "steps" | "battery";

export const DEFAULT_BADGE_ORDER: BadgeId[] = ["date", "weather", "steps", "battery"];

// Single-character codes used to transmit/persist the order compactly (the
// AppMessage + localStorage value is just their concatenation, e.g. "dwsb").
const BADGE_CODE: Record<BadgeId, string> = { date: "d", weather: "w", steps: "s", battery: "b" };
const BADGE_BY_CODE: Record<string, BadgeId> = { d: "date", w: "weather", s: "steps", b: "battery" };

/** Encodes an order as its compact code string, e.g. ["steps","date"] -> "sd". */
export function badgeOrderToCode(order: BadgeId[]): string {
  return order.map((id) => BADGE_CODE[id]).join("");
}

/**
 * Coerces a stored/app-message badge order into a full, valid permutation of
 * every BadgeId. Accepts an array of ids ("date"/…) or a string of either the
 * single-char codes ("dws") or comma-separated ids ("date,weather,steps").
 * Unknown/duplicate tokens are ignored, and any badges the input omits are
 * appended in DEFAULT_BADGE_ORDER, so the result always contains all badges
 * exactly once (callers can rely on a complete, de-duplicated order).
 */
export function normalizeBadgeOrder(value: unknown): BadgeId[] {
  let tokens: string[];
  if (Array.isArray(value)) {
    tokens = value.map((v) => String(v));
  } else if (typeof value === "string") {
    tokens = value.indexOf(",") >= 0 ? value.split(",") : value.split("");
  } else {
    return DEFAULT_BADGE_ORDER.slice();
  }

  const seen: Record<string, boolean> = {};
  const order: BadgeId[] = [];
  for (const raw of tokens) {
    const token = raw.trim();
    const id = BADGE_BY_CODE[token] ?? (token as BadgeId);
    if ((id === "date" || id === "weather" || id === "steps" || id === "battery") && !seen[id]) {
      seen[id] = true;
      order.push(id);
    }
  }
  for (const id of DEFAULT_BADGE_ORDER) {
    if (!seen[id]) order.push(id);
  }
  return order;
}

export type TempUnit = "C" | "F";

/**
 * Maps the watch's health measurement system (synced from the Pebble phone app
 * units setting) to a temperature unit: imperial -> Fahrenheit, else Celsius.
 */
export function tempUnitForSystem(system: string | undefined): TempUnit {
  return system === "imperial" ? "F" : "C";
}

// Sentinel stored/sent when no weather reading is available yet.
export const WEATHER_UNKNOWN = -1000;

/**
 * Formats a temperature (given in tenths of a degree Celsius, as sent from the
 * phone) for the chosen unit, e.g. 248 -> "24,8°" (Celsius) or "76,6°"
 * (Fahrenheit). The C/F letter is dropped to keep the badge compact; the value
 * is still converted per `unit`. Uses a comma decimal separator to match the
 * Home Assistant style. Returns "--" for the WEATHER_UNKNOWN sentinel or
 * non-finite input.
 */
export function formatTemperature(tenthsC: number, unit: TempUnit): string {
  if (!isFinite(tenthsC) || tenthsC <= WEATHER_UNKNOWN) return "--";
  let value = tenthsC / 10;
  if (unit === "F") value = value * 9 / 5 + 32;
  const rounded = Math.round(value * 10) / 10;
  return rounded.toFixed(1).replace(".", ",") + "°";
}
