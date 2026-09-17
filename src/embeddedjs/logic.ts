/*
 * Pure watchface logic with no runtime dependencies, kept separate from the
 * rendering code in main.ts so it can be unit-tested with `bun test`.
 */

// Resource IDs are generated from the package.json `pebble.resources.media`
// order by tools/render-resources.ts (`bun run render-resources`) into
// resource-ids.ts, so they can never drift from what `pebble build` assigns —
// a wrong id throws a fatal "not found" on the watch. Re-exported here so the
// drawing code and tests keep importing them from "logic".
import { Casita, Icon } from "resource-ids";
export { Casita, Icon };

/**
 * True for expressions whose art reaches into the top corners (the sleeping
 * "Zzz" and the disconnected no-internet glyph). Their corners aren't empty
 * like the normal house roof, so a wrapped badge row would overlap them and
 * Casita must be shrunk below the full badge stack instead.
 */
export function expressionFillsTopCorners(id: Casita): boolean {
  return id === Casita.Sleeping || id === Casita.Disconnected;
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

/** Weather temperature (tenths °C) at/above which Casita starts sweating. */
export const SWEATING_TEMP_TENTHS = 300; // 30.0 °C

/**
 * True when a known weather reading is hot enough for the sweating expression.
 * The WEATHER_UNKNOWN sentinel (no reading yet) never counts as hot.
 */
export function isSweatingTemp(weatherTenthsC: number): boolean {
  return (
    weatherTenthsC > WEATHER_UNKNOWN && weatherTenthsC >= SWEATING_TEMP_TENTHS
  );
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

// --------------------------------------------------------------------------- //
// Theme (light/dark) setting
// --------------------------------------------------------------------------- //

export type Theme = "light" | "dark" | "auto";

/** A theme actually rendered on screen — "auto" is resolved to one of these. */
export type ResolvedTheme = "light" | "dark";

// The watchface historically rendered on a black background, so "dark" is the
// default to keep existing behaviour when no preference has been stored yet.
export const DEFAULT_THEME: Theme = "auto";

/** Sentinel for an unknown sunrise/sunset minute (phone hasn't supplied one). */
export const SUN_UNKNOWN = -1;

/**
 * Coerces a stored (string) or app-message (number) theme value into a valid
 * Theme, falling back to DEFAULT_THEME for anything unrecognised.
 *
 * Accepts: "light"/"dark"/"auto", the numbers 0 (light) / 1 (dark) / 2 (auto),
 * and their string forms "0"/"1"/"2" (AppMessage integers can arrive as either).
 */
export function normalizeTheme(value: unknown): Theme {
  if (value === "light" || value === "dark" || value === "auto") return value;
  if (value === 0 || value === "0") return "light";
  if (value === 1 || value === "1") return "dark";
  if (value === 2 || value === "2") return "auto";
  return DEFAULT_THEME;
}

/**
 * Encodes a theme as the integer sent over AppMessage (0 = light, 1 = dark,
 * 2 = auto).
 */
export function themeToCode(theme: Theme): number {
  if (theme === "auto") return 2;
  return theme === "dark" ? 1 : 0;
}

/** Local-clock minutes since midnight (0-1439) for a Date. */
export function minutesOfDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

/**
 * Resolves the theme actually rendered. Concrete themes pass through; "auto"
 * picks light between sunrise and sunset and dark otherwise, using minutes since
 * local midnight. When the phone hasn't supplied valid sun times yet (unknown,
 * or a nonsensical range) it falls back to dark so the face still renders.
 */
export function resolveTheme(
  theme: Theme,
  nowMinutes: number,
  sunriseMin: number,
  sunsetMin: number,
): ResolvedTheme {
  if (theme !== "auto") return theme;
  if (sunriseMin < 0 || sunsetMin < 0 || sunriseMin >= sunsetMin) return "dark";
  return nowMinutes >= sunriseMin && nowMinutes < sunsetMin ? "light" : "dark";
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
  if (value === true || value === 1 || value === "1" || value === "true")
    return true;
  if (value === false || value === 0 || value === "0" || value === "false")
    return false;
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
// Badge row layout
// --------------------------------------------------------------------------- //

/** Where one badge lands: its index in the priority list, its row (0-based
 * from the top) and its left x relative to the drawing area's left edge. */
export interface BadgePlacement {
  index: number;
  row: number;
  x: number;
}

export interface BadgeLayout {
  /** Placements for every badge that is shown, in priority order. */
  placements: BadgePlacement[];
  /** Number of rows used (0 when nothing is shown). */
  rows: number;
}

export interface BadgeLayoutOptions {
  /** Width of the drawing area; placements are relative to its left edge. */
  areaWidth: number;
  /** True on a round display (the area is then the circle's bounding square). */
  round: boolean;
  /** Inset of the rows from the area's edges (top, and the sides on rect). */
  margin: number;
  /** Horizontal gap between neighbouring pills. */
  gap: number;
  /** Pill height; with `gap` and `margin` it gives each row's top edge. */
  pillHeight: number;
}

// Round displays: the top row is too narrow for more than one badge, the
// second row takes two more.
export const ROUND_SECOND_ROW_MAX = 2;

/** Top edge of `row` (0-based), relative to the area's top. */
function rowTop(row: number, opts: BadgeLayoutOptions): number {
  return opts.margin + row * (opts.pillHeight + opts.gap);
}

/**
 * Half the chord of the round display at `y` from the top, i.e. how far the
 * circle extends left/right of centre at that height. Used as a conservative
 * horizontal bound for a pill whose top edge is at `y`: a pill's rounded ends
 * bulge out only at mid-height, where the circle (in its upper half) is wider
 * than at the pill's top edge, so a pill whose box fits the chord at its top
 * edge lies inside the circle.
 */
function chordHalf(y: number, radius: number): number {
  const dy = radius - y;
  const sq = radius * radius - dy * dy;
  return sq > 0 ? Math.sqrt(sq) : 0;
}

// Rectangular displays: how many badges the first (full-width) row takes before
// the rest wrap to the second row.
export const RECT_FIRST_ROW_MAX = 3;

// Places `order` (badge indices) on one row, filling from `right` leftwards:
// the first index lands flush against `right`, the next to its left, and so on.
function fillRightToLeft(
  widths: number[],
  order: number[],
  row: number,
  right: number,
  gap: number,
  out: BadgePlacement[],
): void {
  let x = right;
  for (const index of order) {
    x -= widths[index];
    out.push({ index, row, x });
    x -= gap;
  }
}

/** Total drawn width of a set of badges: pill widths plus inter-pill gaps. */
function groupWidth(widths: number[], order: number[], gap: number): number {
  let total = 0;
  for (let i = 0; i < order.length; i++) {
    total += widths[order[i]] + (i > 0 ? gap : 0);
  }
  return total;
}

/**
 * Lays the badges out in rows. `widths` are the pill widths in the user's
 * priority order (first = most important); see BadgeLayoutOptions for the
 * geometry. Positions are relative to the drawing area's left edge.
 *
 * Every row is filled from right to left: the first badge of a row is its
 * rightmost, the next sits to its left, and so on. That keeps the top-priority
 * badge pinned to the same spot no matter how many others are enabled.
 *
 * Rectangular displays anchor the first row to the right edge (inset by
 * `margin`) and give it the first RECT_FIRST_ROW_MAX badges (a wide trio may
 * run past the left edge; that is accepted). Any further badges go on a second
 * row that keeps its CENTRE CLEAR for Casita's roof peak: they fill right to
 * left from the right corner, except that the last one is pinned to the left
 * corner whenever the row holds two or more (5 badges -> 3 on top, one in each
 * bottom corner; 4 badges -> 3 on top, one in the bottom-right corner).
 *
 * Round displays have no usable top corners but plenty of width lower down,
 * so the stack is 1 + 2 + 2: the first badge sits alone, centred, in the
 * narrow top row; the next up to ROUND_SECOND_ROW_MAX form a centred group on
 * the second row (filled right to left, so badge #2 is its rightmost); any
 * remaining badges go on a third row pinned to the circle's edge at that
 * height — right side first, the last one on the left — leaving the middle
 * clear for Casita's roof peak, exactly like the rectangular second row.
 */
export function layoutBadges(
  widths: number[],
  opts: BadgeLayoutOptions,
): BadgeLayout {
  const placements: BadgePlacement[] = [];
  const n = widths.length;
  if (n === 0) return { placements, rows: 0 };
  const { areaWidth, gap } = opts;

  if (opts.round) {
    const centre = areaWidth / 2;
    fillRightToLeft(widths, [0], 0, (centre + widths[0] / 2) | 0, gap, placements);
    if (n === 1) return { placements, rows: 1 };

    const secondEnd = n < 1 + ROUND_SECOND_ROW_MAX ? n : 1 + ROUND_SECOND_ROW_MAX;
    const second: number[] = [];
    for (let i = 1; i < secondEnd; i++) second.push(i);
    const secondRight = (centre + groupWidth(widths, second, gap) / 2) | 0;
    fillRightToLeft(widths, second, 1, secondRight, gap, placements);
    if (n === secondEnd) return { placements, rows: 2 };

    // Third row: hug the circle's edge at the row's top, middle left clear.
    const half = chordHalf(rowTop(2, opts), centre);
    const rest: number[] = [];
    for (let i = secondEnd; i < n; i++) rest.push(i);
    const last = rest.length > 1 ? rest.pop() : undefined;
    fillRightToLeft(widths, rest, 2, (centre + half) | 0, gap, placements);
    if (last !== undefined) placements.push({ index: last, row: 2, x: Math.ceil(centre - half) });
    return { placements, rows: 3 };
  }

  const right = areaWidth - opts.margin;
  const first = n < RECT_FIRST_ROW_MAX ? n : RECT_FIRST_ROW_MAX;
  const top: number[] = [];
  for (let i = 0; i < first; i++) top.push(i);
  fillRightToLeft(widths, top, 0, right, gap, placements);
  if (n === first) return { placements, rows: 1 };

  // Second row: right corner inwards, last badge pinned to the left corner so
  // the middle stays free for the roof peak.
  const rest: number[] = [];
  for (let i = first; i < n; i++) rest.push(i);
  const last = rest.length > 1 ? rest.pop() : undefined;
  fillRightToLeft(widths, rest, 1, right, gap, placements);
  if (last !== undefined) placements.push({ index: last, row: 1, x: opts.margin });
  return { placements, rows: 2 };
}

// --------------------------------------------------------------------------- //
// Badge order setting
// --------------------------------------------------------------------------- //

/** Stable identifiers for the badges, in their default priority order. */
export type BadgeId = "date" | "weather" | "steps" | "battery" | "home";

export const DEFAULT_BADGE_ORDER: BadgeId[] = [
  "date",
  "weather",
  "steps",
  "battery",
  "home",
];

// Single-character codes used to transmit/persist the order compactly (the
// AppMessage + localStorage value is just their concatenation, e.g. "dwsb").
const BADGE_CODE: Record<BadgeId, string> = {
  date: "d",
  weather: "w",
  steps: "s",
  battery: "b",
  home: "h",
};
const BADGE_BY_CODE: Record<string, BadgeId> = {
  d: "date",
  w: "weather",
  s: "steps",
  b: "battery",
  h: "home",
};

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
    if (
      (id === "date" ||
        id === "weather" ||
        id === "steps" ||
        id === "battery" ||
        id === "home") &&
      !seen[id]
    ) {
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
  if (unit === "F") value = (value * 9) / 5 + 32;
  const rounded = Math.round(value * 10) / 10;
  return rounded.toFixed(1).replace(".", ",") + "°";
}
