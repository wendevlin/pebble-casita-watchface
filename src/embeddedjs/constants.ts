/*
 * Shared, dependency-free constants: persistent-storage keys, AppMessage key
 * names, and the badge/layout geometry. Kept pure (no runtime imports) so it can
 * be reused by any module and reasoned about in isolation.
 */

// --------------------------------------------------------------------------- //
// Persistent storage keys (localStorage on the watch)
// --------------------------------------------------------------------------- //

export const THEME_KEY = "theme";
export const SHOW_WEATHER_KEY = "showWeather";
export const SHOW_STEPS_KEY = "showSteps";
export const SHOW_DATE_KEY = "showDate";
export const SHOW_BATTERY_KEY = "showBattery";
export const WEATHER_TEMP_KEY = "weatherTemp";
export const BADGE_ORDER_KEY = "badgeOrder";
export const SHOW_SECONDS_KEY = "showSeconds";

// --------------------------------------------------------------------------- //
// AppMessage keys — MUST stay in the same order as package.json `messageKeys`
// (the watch maps each name to 10000 + its index).
// --------------------------------------------------------------------------- //

export const MESSAGE_KEYS = [
  "THEME",
  "WEATHER_TEMP",
  "SHOW_WEATHER",
  "SHOW_STEPS",
  "SHOW_DATE",
  "BADGE_ORDER",
  "SHOW_SECONDS",
  "SHOW_BATTERY",
];

// --------------------------------------------------------------------------- //
// Badge geometry (all pixels)
// --------------------------------------------------------------------------- //

export const ICON_SIZE = 20;
export const PILL_PAD_X = 6;
export const PILL_PAD_Y = 5;
export const ICON_GAP = 3;
export const BADGE_GAP = 5;
export const MARGIN = 6;
export const BORDER_W = 2;
export const PILL_H = ICON_SIZE + PILL_PAD_Y * 2;
export const PILL_RADIUS = PILL_H >> 1;

// The font line box includes descender/leading space below the glyphs, so
// centering by full height leaves the badge text visually low; nudge it up.
export const BADGE_TEXT_NUDGE = 2;

// --------------------------------------------------------------------------- //
// Clock + Casita layout
// --------------------------------------------------------------------------- //

export const CLOCK_MARGIN_BOTTOM = 6;
export const CASITA_MIN_TOP_GAP = 4;

// Horizontal gap between the main clock and the small seconds shown beside it
// while the backlight window is active.
export const SECONDS_GAP = 4;
