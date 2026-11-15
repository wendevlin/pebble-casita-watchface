/*
 * Pure watchface logic: expression selection, theme resolution, badge text
 * formatting, badge order parsing and the badge row layout.
 *
 * Deliberately free of <pebble.h> so it compiles on the host as well and is
 * unit-tested there (tests/c/test_logic.c, `bun run test:c`). The watch-only
 * glue — drawing, services, AppMessage, storage — lives in main.c.
 */
#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

// --------------------------------------------------------------------------- //
// Casita expressions + badge icons (mapped to RESOURCE_IDs in main.c)
// --------------------------------------------------------------------------- //

typedef enum {
  EXPR_NORMAL = 0,
  EXPR_HAPPY,
  EXPR_GRINNING,
  EXPR_SLEEPING,
  EXPR_DISCONNECTED,
  EXPR_SWEATING,
  EXPR_COUNT,
} Expression;

typedef enum {
  ICON_THERMOMETER = 0,
  ICON_SHOEPRINT,
  ICON_CALENDAR,
  ICON_BATTERY_LOW,
  ICON_BATTERY_MEDIUM,
  ICON_BATTERY_HIGH,
  ICON_HOME_THERMOMETER,
  ICON_COUNT,
} IconKind;

/** Sentinel for "no temperature reading yet" (tenths of a degree). */
#define WEATHER_UNKNOWN (-1000)
/** Weather temperature (tenths °C) at/above which Casita starts sweating. */
#define SWEATING_TEMP_TENTHS 300
/** Sentinel for an unknown sunrise/sunset minute. */
#define SUN_UNKNOWN (-1)

/**
 * Selects the Casita expression for a local hour (0-23):
 *   06:00-11:59 Normal, 12:00-14:59 Happy, 15:00-20:59 Grinning,
 *   21:00-05:59 Sleeping.
 */
Expression expression_for_hour(int hour);

/** Readings older than this (seconds) are treated as unknown. */
#define READING_MAX_AGE_S (60 * 60)

/**
 * Returns `tenths_c` while the reading is fresh, else WEATHER_UNKNOWN: when it
 * was never received (`received_at` <= 0) or is older than READING_MAX_AGE_S.
 * A reading from the "future" (the clock was set back) counts as fresh; the
 * next refresh replaces it anyway.
 */
int fresh_reading(int tenths_c, int32_t received_at, int32_t now);

/** True when a known reading is hot enough (>= 30 °C) for the sweating face. */
bool is_sweating_temp(int tenths_c);

/**
 * The expression to show: disconnected while the phone link is down, sweating
 * when it's hot, otherwise the time-of-day face.
 */
Expression pick_expression(bool phone_connected, int weather_tenths_c, int hour);

/**
 * True for expressions whose art reaches into the top corners (the sleeping
 * "Zzz" and the disconnected glyph), so corner-pinned badges would overlap.
 */
bool expression_fills_top_corners(Expression expr);

// --------------------------------------------------------------------------- //
// Theme
// --------------------------------------------------------------------------- //

typedef enum {
  THEME_LIGHT = 0,
  THEME_DARK = 1,
  THEME_AUTO = 2,
} Theme;

#define DEFAULT_THEME THEME_AUTO

/** Maps an AppMessage/storage code (0 light, 1 dark, 2 auto) to a Theme. */
Theme theme_from_code(int32_t code);

/**
 * True when the face renders dark. "auto" is light from sunrise (inclusive) to
 * sunset (exclusive) and dark otherwise, and dark while sun times are unknown
 * or nonsensical.
 */
bool theme_is_dark(Theme theme, int now_minutes, int sunrise_min, int sunset_min);

// --------------------------------------------------------------------------- //
// Badge text
// --------------------------------------------------------------------------- //

/** "07:05" (24h) or "7:05" (12h, 12 for midnight/noon). */
void format_time(char *buf, size_t size, int hour, int minute, bool hour12);

/** 56 -> "56", 410 -> "0,4K", 12876 -> "12K"; non-positive -> "0". */
void format_steps(char *buf, size_t size, int32_t steps);

/** Day of month without padding, e.g. "14". */
void format_date(char *buf, size_t size, int mday);

/** Clamped percentage, e.g. "85%". */
void format_battery(char *buf, size_t size, int percent);

/** Battery icon tinted by charge: >= 70 high, >= 30 medium, else low. */
IconKind battery_icon(int percent);

/**
 * Temperature given in tenths °C, shown with one decimal and a comma, no unit
 * letter: 248 -> "24,8°" (or "76,6°" in Fahrenheit). Unknown -> "--".
 */
void format_temperature(char *buf, size_t size, int tenths_c, bool fahrenheit);

// --------------------------------------------------------------------------- //
// Badge order
// --------------------------------------------------------------------------- //

typedef enum {
  BADGE_DATE = 0,
  BADGE_WEATHER,
  BADGE_STEPS,
  BADGE_BATTERY,
  BADGE_HOME,
  BADGE_COUNT,
} BadgeId;

/**
 * Parses the compact order code sent by the phone ("dwsbh", one letter per
 * badge) or a comma-separated id list ("steps,date") into a full permutation
 * of every badge. Unknown/duplicate tokens are skipped and missing badges are
 * appended in the default order, so `out` always holds each badge once.
 */
void parse_badge_order(const char *code, BadgeId out[BADGE_COUNT]);

/** Writes the compact code for an order, e.g. "dwsbh" (NUL-terminated). */
void badge_order_to_code(const BadgeId order[BADGE_COUNT], char out[BADGE_COUNT + 1]);

// --------------------------------------------------------------------------- //
// Badge row layout
// --------------------------------------------------------------------------- //

/** Rect displays: badges on the first (full-width) row before wrapping. */
#define RECT_FIRST_ROW_MAX 3
/** Round displays: badges on the second row (the top row holds one). */
#define ROUND_SECOND_ROW_MAX 2
/** Upper bound on visible badges (one per BadgeId). */
#define MAX_BADGES BADGE_COUNT

typedef struct {
  /** Index into the widths array (priority order). */
  int index;
  /** Row, 0-based from the top. */
  int row;
  /** Left edge relative to the drawing area's left edge. */
  int x;
} BadgePlacement;

typedef struct {
  int area_width;
  bool round;
  int margin;
  int gap;
  int pill_height;
} BadgeLayoutOptions;

/**
 * Lays out `count` pills (widths in priority order) and returns the number of
 * rows used. Every row fills right to left so the top-priority badge keeps its
 * spot. Rect: up to three on a right-anchored first row, the rest on a second
 * row with the last one pinned to the left corner (the middle stays clear for
 * Casita's roof). Round: 1 + 2 + rest, the third row hugging the circle edge.
 * `out` receives one placement per badge, in placement order.
 */
int layout_badges(const int *widths, int count, const BadgeLayoutOptions *opts,
                  BadgePlacement *out);
