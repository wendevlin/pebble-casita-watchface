/*
 * Pure watchface logic — see logic.h. Integer-only (the watch has no FPU and
 * the SDK links no libm), and free of <pebble.h> so it builds on the host for
 * the unit tests.
 */
#include "logic.h"

#include <stdio.h>
#include <string.h>

// --------------------------------------------------------------------------- //
// Expressions
// --------------------------------------------------------------------------- //

Expression expression_for_hour(int hour) {
  if (hour >= 6 && hour < 12) return EXPR_NORMAL;
  if (hour >= 12 && hour < 15) return EXPR_HAPPY;
  if (hour >= 15 && hour < 21) return EXPR_GRINNING;
  return EXPR_SLEEPING;
}

int fresh_reading(int tenths_c, int32_t received_at, int32_t now) {
  if (received_at <= 0) return WEATHER_UNKNOWN;
  if (now - received_at > READING_MAX_AGE_S) return WEATHER_UNKNOWN;
  return tenths_c;
}

bool is_sweating_temp(int tenths_c) {
  return tenths_c > WEATHER_UNKNOWN && tenths_c >= SWEATING_TEMP_TENTHS;
}

Expression pick_expression(bool phone_connected, int weather_tenths_c, int hour) {
  if (!phone_connected) return EXPR_DISCONNECTED;
  if (is_sweating_temp(weather_tenths_c)) return EXPR_SWEATING;
  return expression_for_hour(hour);
}

bool expression_fills_top_corners(Expression expr) {
  return expr == EXPR_SLEEPING || expr == EXPR_DISCONNECTED;
}

// --------------------------------------------------------------------------- //
// Theme
// --------------------------------------------------------------------------- //

Theme theme_from_code(int32_t code) {
  if (code == THEME_LIGHT || code == THEME_DARK || code == THEME_AUTO) return (Theme)code;
  return DEFAULT_THEME;
}

bool theme_is_dark(Theme theme, int now_minutes, int sunrise_min, int sunset_min) {
  if (theme == THEME_LIGHT) return false;
  if (theme == THEME_DARK) return true;
  if (sunrise_min < 0 || sunset_min < 0 || sunrise_min >= sunset_min) return true;
  return !(now_minutes >= sunrise_min && now_minutes < sunset_min);
}

// --------------------------------------------------------------------------- //
// Badge text
// --------------------------------------------------------------------------- //

void format_time(char *buf, size_t size, int hour, int minute, bool hour12) {
  if (hour12) {
    int h = hour % 12;
    if (h == 0) h = 12;
    snprintf(buf, size, "%d:%02d", h, minute);
  } else {
    snprintf(buf, size, "%02d:%02d", hour, minute);
  }
}

void format_steps(char *buf, size_t size, int32_t steps) {
  if (steps <= 0) {
    snprintf(buf, size, "0");
  } else if (steps < 100) {
    snprintf(buf, size, "%d", (int)steps);
  } else if (steps < 1000) {
    // Truncate to tenths of a K (410 -> 0,4K; 950 -> 0,9K) so the badge never
    // claims a thousand before the step counter actually reaches it.
    snprintf(buf, size, "0,%dK", (int)(steps / 100));
  } else {
    snprintf(buf, size, "%dK", (int)(steps / 1000));
  }
}

void format_date(char *buf, size_t size, int mday) {
  snprintf(buf, size, "%d", mday);
}

void format_battery(char *buf, size_t size, int percent) {
  if (percent < 0) percent = 0;
  if (percent > 100) percent = 100;
  snprintf(buf, size, "%d%%", percent);
}

IconKind battery_icon(int percent) {
  if (percent >= 70) return ICON_BATTERY_HIGH;
  if (percent >= 30) return ICON_BATTERY_MEDIUM;
  return ICON_BATTERY_LOW;
}

// Floor division that rounds toward negative infinity (C truncates to zero).
static int floor_div(int a, int b) {
  int q = a / b;
  if ((a % b != 0) && ((a < 0) != (b < 0))) q--;
  return q;
}

void format_temperature(char *buf, size_t size, int tenths_c, bool fahrenheit) {
  if (tenths_c <= WEATHER_UNKNOWN) {
    snprintf(buf, size, "--");
    return;
  }
  int tenths = tenths_c;
  if (fahrenheit) {
    // F tenths = C tenths * 9/5 + 320, rounded half up.
    tenths = floor_div(tenths_c * 18 + 3200 + 5, 10);
  }
  const char *sign = tenths < 0 ? "-" : "";
  int magnitude = tenths < 0 ? -tenths : tenths;
  // "\xc2\xb0" is the UTF-8 degree sign.
  snprintf(buf, size, "%s%d,%d\xc2\xb0", sign, magnitude / 10, magnitude % 10);
}

// --------------------------------------------------------------------------- //
// Badge order
// --------------------------------------------------------------------------- //

static const char BADGE_CODES[BADGE_COUNT] = {'d', 'w', 's', 'b', 'h'};
static const char *const BADGE_NAMES[BADGE_COUNT] = {"date", "weather", "steps", "battery",
                                                      "home"};

// Resolves one token (a single-letter code or a full id) to a badge, or -1.
static int badge_for_token(const char *token, size_t len) {
  for (int i = 0; i < BADGE_COUNT; i++) {
    if (len == 1 && token[0] == BADGE_CODES[i]) return i;
    if (strlen(BADGE_NAMES[i]) == len && strncmp(token, BADGE_NAMES[i], len) == 0) return i;
  }
  return -1;
}

void parse_badge_order(const char *code, BadgeId out[BADGE_COUNT]) {
  bool seen[BADGE_COUNT] = {false};
  int count = 0;
  if (code) {
    const bool csv = strchr(code, ',') != NULL;
    const char *p = code;
    while (*p && count < BADGE_COUNT) {
      size_t len = 1;
      if (csv) {
        while (*p == ' ') p++;
        len = 0;
        while (p[len] && p[len] != ',') len++;
        while (len > 0 && p[len - 1] == ' ') len--;
      }
      const int id = badge_for_token(p, len);
      if (id >= 0 && !seen[id]) {
        seen[id] = true;
        out[count++] = (BadgeId)id;
      }
      if (csv) {
        p = strchr(p, ',');
        if (!p) break;
        p++;
      } else {
        p++;
      }
    }
  }
  for (int i = 0; i < BADGE_COUNT; i++) {
    if (!seen[i]) out[count++] = (BadgeId)i;
  }
}

void badge_order_to_code(const BadgeId order[BADGE_COUNT], char out[BADGE_COUNT + 1]) {
  for (int i = 0; i < BADGE_COUNT; i++) out[i] = BADGE_CODES[order[i]];
  out[BADGE_COUNT] = '\0';
}

// --------------------------------------------------------------------------- //
// Badge row layout
// --------------------------------------------------------------------------- //

static int isqrt(int value) {
  if (value <= 0) return 0;
  int root = 0;
  int bit = 1 << 30;
  while (bit > value) bit >>= 2;
  while (bit) {
    if (value >= root + bit) {
      value -= root + bit;
      root = (root >> 1) + bit;
    } else {
      root >>= 1;
    }
    bit >>= 2;
  }
  return root;
}

static int row_top(int row, const BadgeLayoutOptions *opts) {
  return opts->margin + row * (opts->pill_height + opts->gap);
}

// Places badges [first, last) on `row`, filling leftwards from `right`.
static int fill_right_to_left(const int *widths, int first, int last, int row, int right,
                              int gap, BadgePlacement *out, int n) {
  int x = right;
  for (int i = first; i < last; i++) {
    x -= widths[i];
    out[n++] = (BadgePlacement){.index = i, .row = row, .x = x};
    x -= gap;
  }
  return n;
}

int layout_badges(const int *widths, int count, const BadgeLayoutOptions *opts,
                  BadgePlacement *out) {
  if (count <= 0) return 0;
  if (count > MAX_BADGES) count = MAX_BADGES;
  const int gap = opts->gap;
  int n = 0;

  if (opts->round) {
    const int centre = opts->area_width / 2;
    n = fill_right_to_left(widths, 0, 1, 0, centre + widths[0] / 2, gap, out, n);
    if (count == 1) return 1;

    const int second_end = count < 1 + ROUND_SECOND_ROW_MAX ? count : 1 + ROUND_SECOND_ROW_MAX;
    int group = 0;
    for (int i = 1; i < second_end; i++) group += widths[i] + (i > 1 ? gap : 0);
    n = fill_right_to_left(widths, 1, second_end, 1, centre + group / 2, gap, out, n);
    if (count == second_end) return 2;

    // Third row: hug the circle's edge at the row's top, middle left clear.
    const int dy = centre - row_top(2, opts);
    const int half = isqrt(centre * centre - dy * dy);
    const bool pin_last = count - second_end > 1;
    const int rest_end = pin_last ? count - 1 : count;
    n = fill_right_to_left(widths, second_end, rest_end, 2, centre + half, gap, out, n);
    if (pin_last) out[n++] = (BadgePlacement){.index = count - 1, .row = 2, .x = centre - half};
    return 3;
  }

  const int right = opts->area_width - opts->margin;
  const int first = count < RECT_FIRST_ROW_MAX ? count : RECT_FIRST_ROW_MAX;
  n = fill_right_to_left(widths, 0, first, 0, right, gap, out, n);
  if (count == first) return 1;

  // Second row: right corner inwards, last badge pinned to the left corner so
  // the middle stays free for the roof peak.
  const bool pin_last = count - first > 1;
  const int rest_end = pin_last ? count - 1 : count;
  n = fill_right_to_left(widths, first, rest_end, 1, right, gap, out, n);
  if (pin_last) out[n++] = (BadgePlacement){.index = count - 1, .row = 1, .x = opts->margin};
  return 2;
}
