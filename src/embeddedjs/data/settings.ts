/*
 * Watchface settings: the mutable, persisted user preferences (theme + which
 * badges are shown + the last weather reading) plus the live Pebble Health
 * reads used by the badges. Loading from localStorage happens eagerly at module
 * load; applyMessage() persists live updates from the phone.
 */

import {
  BADGE_ORDER_KEY,
  SHOW_BATTERY_KEY,
  SHOW_DATE_KEY,
  SHOW_SECONDS_KEY,
  SHOW_STEPS_KEY,
  SHOW_WEATHER_KEY,
  THEME_KEY,
  WEATHER_TEMP_KEY,
} from "constants";
import {
  BadgeId,
  badgeOrderToCode,
  normalizeBadgeOrder,
  normalizeTheme,
  normalizeToggle,
  Theme,
  WEATHER_UNKNOWN,
} from "logic";
import Health from "pebble/health";
import { batteryPercent } from "hw";

export interface Settings {
  theme: Theme;
  showWeather: boolean;
  showSteps: boolean;
  showDate: boolean;
  /** Show the watch battery level as a badge. */
  showBattery: boolean;
  /** Left→right order the (enabled) badges are drawn in. */
  badgeOrder: BadgeId[];
  /** Show seconds next to the clock while the backlight window is active. */
  showSeconds: boolean;
  /** Last weather reading in tenths of a degree Celsius (WEATHER_UNKNOWN = none). */
  weatherTemp: number;
}

function readStoredTemp(): number {
  const raw = localStorage.getItem(WEATHER_TEMP_KEY);
  if (raw == null) return WEATHER_UNKNOWN;
  const value = parseInt(raw, 10);
  return isNaN(value) ? WEATHER_UNKNOWN : value;
}

// Loaded once from persistent storage; mutated in place by applyMessage.
export const settings: Settings = {
  theme: normalizeTheme(localStorage.getItem(THEME_KEY)),
  showWeather: normalizeToggle(localStorage.getItem(SHOW_WEATHER_KEY), true),
  showSteps: normalizeToggle(localStorage.getItem(SHOW_STEPS_KEY), true),
  showDate: normalizeToggle(localStorage.getItem(SHOW_DATE_KEY), true),
  showBattery: normalizeToggle(localStorage.getItem(SHOW_BATTERY_KEY), true),
  badgeOrder: normalizeBadgeOrder(localStorage.getItem(BADGE_ORDER_KEY)),
  showSeconds: normalizeToggle(localStorage.getItem(SHOW_SECONDS_KEY), false),
  weatherTemp: readStoredTemp(),
};

/**
 * Applies an incoming AppMessage (from the phone settings page / weather fetch)
 * to `settings`, persisting each changed key. Keys are optional; only those
 * present in the message are updated.
 */
export function applyMessage(message: Map<string | number, unknown>): void {
  if (message.has("THEME")) {
    settings.theme = normalizeTheme(message.get("THEME"));
    localStorage.setItem(THEME_KEY, settings.theme);
  }
  if (message.has("WEATHER_TEMP")) {
    const raw = message.get("WEATHER_TEMP");
    let temp = typeof raw === "number" ? raw : parseInt(String(raw), 10);
    if (isNaN(temp)) temp = WEATHER_UNKNOWN;
    settings.weatherTemp = temp;
    localStorage.setItem(WEATHER_TEMP_KEY, String(temp));
  }
  if (message.has("SHOW_WEATHER")) {
    settings.showWeather = normalizeToggle(message.get("SHOW_WEATHER"), true);
    localStorage.setItem(SHOW_WEATHER_KEY, settings.showWeather ? "1" : "0");
  }
  if (message.has("SHOW_STEPS")) {
    settings.showSteps = normalizeToggle(message.get("SHOW_STEPS"), true);
    localStorage.setItem(SHOW_STEPS_KEY, settings.showSteps ? "1" : "0");
  }
  if (message.has("SHOW_DATE")) {
    settings.showDate = normalizeToggle(message.get("SHOW_DATE"), true);
    localStorage.setItem(SHOW_DATE_KEY, settings.showDate ? "1" : "0");
  }
  if (message.has("SHOW_BATTERY")) {
    settings.showBattery = normalizeToggle(message.get("SHOW_BATTERY"), true);
    localStorage.setItem(SHOW_BATTERY_KEY, settings.showBattery ? "1" : "0");
  }
  if (message.has("BADGE_ORDER")) {
    settings.badgeOrder = normalizeBadgeOrder(message.get("BADGE_ORDER"));
    localStorage.setItem(BADGE_ORDER_KEY, badgeOrderToCode(settings.badgeOrder));
  }
  if (message.has("SHOW_SECONDS")) {
    settings.showSeconds = normalizeToggle(message.get("SHOW_SECONDS"), false);
    localStorage.setItem(SHOW_SECONDS_KEY, settings.showSeconds ? "1" : "0");
  }
}

/*
 * Pebble Health access for the badges: today's step total and the phone app's
 * measurement-system preference. Both degrade gracefully (hide the badge /
 * default to metric) if a permission is missing or the platform is unsupported.
 */

/**
 * Returns today's summed step count, or null if Health is unavailable.
 *
 * Step count must be summed over the day, not "peeked" — the peek API
 * (Health.metric.get) returns 0 for accumulated metrics like step count.
 * query() with no start/end maps to health_service_sum_today.
 */
export function readSteps(): number | null {
  try {
    const value = Health.metric.query({ metric: "step count" });
    if (typeof value === "number" && isFinite(value) && value >= 0)
      return value;
  } catch (e) {
    // Health unavailable (no permission / not supported) — hide the badge.
  }
  return null;
}

/**
 * Returns the phone app's global unit preference as "metric" / "imperial"
 * (or undefined if Health is unavailable), used to pick °C vs °F.
 *
 * Pebble has no temperature-units API. The only place the watch can read the
 * user's Metric/Imperial choice is Health's per-metric display system, and
 * "walked distance" is the metric whose system actually reflects that global
 * toggle (km vs miles). Steps/sleep have no meaningful measurement system, so
 * we query distance purely as a proxy for the overall preference and then map
 * imperial -> °F, metric -> °C (see tempUnitForSystem). The distance value
 * itself is never used.
 */
export function measurementSystem(): string | undefined {
  try {
    return Health.displayMeasurementSystem("walked distance");
  } catch (e) {
    return undefined;
  }
}

/**
 * Returns the watch battery charge as a whole percentage (0-100), or null when
 * the reading is unavailable (no FFI bridge) so the badge can hide itself.
 */
export function readBattery(): number | null {
  return batteryPercent();
}
