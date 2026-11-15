/*
 * Casita watchface — native C implementation.
 *
 * Shows a Casita expression (picked from the local hour, the weather, or the
 * phone link) above a large clock, with rows of Home Assistant–style badges
 * (date / weather / steps / battery / home temperature) along the top.
 *
 * Everything is drawn by one Layer update proc. The face only wakes up for:
 *   - the minute tick (MINUTE_UNIT — never seconds), which also refreshes the
 *     battery and steps badges,
 *   - phone connect/disconnect (switches to the disconnected expression),
 *   - inbound AppMessages (settings, weather, Home Assistant reading); these
 *     only touch flash and redraw when a value actually changed.
 * The unobstructed area (timeline Quick View) triggers redraws by itself.
 *
 * Pure logic (expression choice, formatting, badge layout) is in logic.c and
 * unit-tested on the host.
 */
#include <pebble.h>

#include "logic.h"

// --------------------------------------------------------------------------- //
// Geometry (pixels)
// --------------------------------------------------------------------------- //

// The badge icons are rasterized at exactly this size with anti-aliased alpha
// (tools/build-resources.ts), so they are blitted 1:1 and never rescaled.
#define ICON_SIZE 20
#define PILL_PAD_X 6
#define PILL_PAD_Y 5
#define ICON_GAP 3
#define BADGE_GAP 5
#define MARGIN 6
#define BORDER_W 2
#define PILL_H (ICON_SIZE + PILL_PAD_Y * 2)
// Distance from a pill's top edge to the top of the Gothic 18 text box that
// centres the digits in the pill (the font box has empty space above caps).
#define BADGE_TEXT_TOP 3
#define BADGE_TEXT_BOX_H 24

// Clock: Bitham 42 bold. The text box starts above the glyphs' ink, so the
// box top is offset to put the digits CLOCK_MARGIN_BOTTOM above the bottom.
#define CLOCK_BOX_H 50
#define CLOCK_INK_TOP 10
#define CLOCK_INK_H 30
// On round displays the clock must clear the circle: the corners of a ~110 px
// wide "08:55" only fit inside a 260 px circle up to y ~ 247.
#define CLOCK_MARGIN_BOTTOM PBL_IF_ROUND_ELSE(22, 10)
#define CASITA_MIN_GAP 4

// --------------------------------------------------------------------------- //
// Persistent storage + AppMessage
// --------------------------------------------------------------------------- //

enum {
  PERSIST_THEME = 1,
  PERSIST_SHOW_WEATHER,
  PERSIST_SHOW_STEPS,
  PERSIST_SHOW_DATE,
  PERSIST_SHOW_BATTERY,
  PERSIST_BADGE_ORDER,
  PERSIST_WEATHER_TEMP,
  PERSIST_SHOW_HOME_TEMP,
  PERSIST_HOME_TEMP,
  PERSIST_SUNRISE,
  PERSIST_SUNSET,
  PERSIST_WEATHER_AT,  // when WEATHER_TEMP last arrived (unix time)
  PERSIST_HOME_AT,     // when HA_TEMP last arrived (unix time)
};

// Ask the phone to re-fetch weather, sun times and the Home Assistant reading
// every REFRESH_EVERY_MIN minutes and whenever the phone link comes back. The
// phone has no timer of its own (PebbleKit JS stalls in the background), so
// the watch sets the pace.
#define REFRESH_EVERY_MIN 30
// A Bluetooth link that flaps (phone at the edge of range) reconnects over and
// over; each reconnect would otherwise trigger a full phone-side refresh and
// several AppMessages. Reconnect refreshes are skipped within this window.
#define RECONNECT_REFRESH_MIN_GAP_S (10 * 60)

typedef struct {
  Theme theme;
  bool show_weather;
  bool show_steps;
  bool show_date;
  bool show_battery;
  bool show_home_temp;
  BadgeId badge_order[BADGE_COUNT];
  int weather_temp;    // tenths °C, WEATHER_UNKNOWN = none yet
  int home_temp;       // tenths °C, WEATHER_UNKNOWN = none yet
  int32_t weather_at;  // when weather_temp arrived; older than 1 h shows "--"
  int32_t home_at;     // when home_temp arrived; same rule
  int sunrise_min;   // minutes since local midnight, SUN_UNKNOWN = none yet
  int sunset_min;
} Settings;

static Settings s_settings;

// --------------------------------------------------------------------------- //
// UI state
// --------------------------------------------------------------------------- //

static Window *s_window;
static Layer *s_canvas;
static GFont s_time_font;
static GFont s_badge_font;

static const uint32_t CASITA_RESOURCES[EXPR_COUNT] = {
    [EXPR_NORMAL] = RESOURCE_ID_CASITA_NORMAL,
    [EXPR_HAPPY] = RESOURCE_ID_CASITA_HAPPY,
    [EXPR_GRINNING] = RESOURCE_ID_CASITA_GRINNING,
    [EXPR_SLEEPING] = RESOURCE_ID_CASITA_SLEEPING,
    [EXPR_DISCONNECTED] = RESOURCE_ID_CASITA_DISCONNECTED,
    [EXPR_SWEATING] = RESOURCE_ID_CASITA_SWEATING,
};

static const uint32_t ICON_RESOURCES[ICON_COUNT] = {
    [ICON_THERMOMETER] = RESOURCE_ID_ICON_THERMOMETER,
    [ICON_SHOEPRINT] = RESOURCE_ID_ICON_SHOEPRINT,
    [ICON_CALENDAR] = RESOURCE_ID_ICON_CALENDARBLANK,
    [ICON_BATTERY_LOW] = RESOURCE_ID_ICON_BATTERY_LOW,
    [ICON_BATTERY_MEDIUM] = RESOURCE_ID_ICON_BATTERY_MEDIUM,
    [ICON_BATTERY_HIGH] = RESOURCE_ID_ICON_BATTERY_HIGH,
    [ICON_HOME_THERMOMETER] = RESOURCE_ID_ICON_HOME_THERMOMETER,
};

// Badge icons are tiny bitmaps; each is loaded on first use and kept.
static GBitmap *s_icons[ICON_COUNT];

// Casita: one full-size image (the expression changes a few times a day) and
// one down-scaled clone for when the Quick View shrinks the free space.
static GDrawCommandImage *s_casita;
static int s_casita_expr = -1;
static GDrawCommandImage *s_casita_scaled;
static int s_casita_scaled_expr = -1;
static int s_casita_scaled_h = 0;

// --------------------------------------------------------------------------- //
// Settings
// --------------------------------------------------------------------------- //

static bool persist_read_bool_or(uint32_t key, bool fallback) {
  return persist_exists(key) ? persist_read_bool(key) : fallback;
}

static int persist_read_int_or(uint32_t key, int fallback) {
  return persist_exists(key) ? (int)persist_read_int(key) : fallback;
}

static void settings_load(void) {
  s_settings.theme = theme_from_code(persist_read_int_or(PERSIST_THEME, DEFAULT_THEME));
  s_settings.show_weather = persist_read_bool_or(PERSIST_SHOW_WEATHER, true);
  s_settings.show_steps = persist_read_bool_or(PERSIST_SHOW_STEPS, true);
  s_settings.show_date = persist_read_bool_or(PERSIST_SHOW_DATE, true);
  s_settings.show_battery = persist_read_bool_or(PERSIST_SHOW_BATTERY, true);
  s_settings.show_home_temp = persist_read_bool_or(PERSIST_SHOW_HOME_TEMP, true);
  s_settings.weather_temp = persist_read_int_or(PERSIST_WEATHER_TEMP, WEATHER_UNKNOWN);
  s_settings.home_temp = persist_read_int_or(PERSIST_HOME_TEMP, WEATHER_UNKNOWN);
  s_settings.weather_at = persist_read_int_or(PERSIST_WEATHER_AT, 0);
  s_settings.home_at = persist_read_int_or(PERSIST_HOME_AT, 0);
  s_settings.sunrise_min = persist_read_int_or(PERSIST_SUNRISE, SUN_UNKNOWN);
  s_settings.sunset_min = persist_read_int_or(PERSIST_SUNSET, SUN_UNKNOWN);

  char order[BADGE_COUNT + 1] = "";
  if (persist_exists(PERSIST_BADGE_ORDER)) {
    persist_read_string(PERSIST_BADGE_ORDER, order, sizeof(order));
  }
  parse_badge_order(order, s_settings.badge_order);
}

// Reads an integer tuple. PebbleKit JS sends numbers as ints of any width, but
// a value that went through a string field arrives as a C string.
static int tuple_int(const Tuple *t) {
  switch (t->type) {
    case TUPLE_INT:
      if (t->length == 1) return t->value->int8;
      if (t->length == 2) return t->value->int16;
      return (int)t->value->int32;
    case TUPLE_UINT:
      if (t->length == 1) return t->value->uint8;
      if (t->length == 2) return t->value->uint16;
      return (int)t->value->uint32;
    case TUPLE_CSTRING: {
      const char *s = t->value->cstring;
      bool negative = *s == '-';
      if (negative) s++;
      int value = 0;
      while (*s >= '0' && *s <= '9') value = value * 10 + (*s++ - '0');
      return negative ? -value : value;
    }
    default:
      return 0;
  }
}

// The phone re-sends the full settings dictionary on every launch, and most
// values are unchanged. Each helper writes flash only when the value differs
// and reports whether anything changed, so an unchanged message costs no flash
// write and no redraw.
static bool apply_toggle(DictionaryIterator *it, uint32_t key, uint32_t persist_key, bool *field) {
  Tuple *t = dict_find(it, key);
  if (!t) return false;
  const bool value = tuple_int(t) != 0;
  if (value == *field) return false;
  *field = value;
  persist_write_bool(persist_key, value);
  return true;
}

static bool apply_int(DictionaryIterator *it, uint32_t key, uint32_t persist_key, int *field) {
  Tuple *t = dict_find(it, key);
  if (!t) return false;
  const int value = tuple_int(t);
  if (value == *field) return false;
  *field = value;
  persist_write_int(persist_key, value);
  return true;
}

// A temperature reading also records when it arrived, so a stale value can be
// hidden (fresh_reading). The timestamp is written on every reading; the value
// only when it changed. Redraw when the value changed or was stale before.
static bool apply_reading(DictionaryIterator *it, uint32_t key, uint32_t persist_key,
                          uint32_t persist_at_key, int *field, int32_t *at) {
  Tuple *t = dict_find(it, key);
  if (!t) return false;
  const int32_t now = (int32_t)time(NULL);
  const int value = tuple_int(t);
  const bool was_fresh = fresh_reading(*field, *at, now) != WEATHER_UNKNOWN;
  const bool changed = value != *field || !was_fresh;
  if (value != *field) {
    *field = value;
    persist_write_int(persist_key, value);
  }
  *at = now;
  persist_write_int(persist_at_key, now);
  return changed;
}

static void inbox_received(DictionaryIterator *it, void *context) {
  bool changed = false;
  Tuple *t = dict_find(it, MESSAGE_KEY_THEME);
  if (t) {
    const Theme theme = theme_from_code(tuple_int(t));
    if (theme != s_settings.theme) {
      s_settings.theme = theme;
      persist_write_int(PERSIST_THEME, theme);
      changed = true;
    }
  }
  t = dict_find(it, MESSAGE_KEY_BADGE_ORDER);
  if (t && t->type == TUPLE_CSTRING) {
    BadgeId order[BADGE_COUNT];
    parse_badge_order(t->value->cstring, order);
    if (memcmp(order, s_settings.badge_order, sizeof(order)) != 0) {
      memcpy(s_settings.badge_order, order, sizeof(order));
      char code[BADGE_COUNT + 1];
      badge_order_to_code(order, code);
      persist_write_string(PERSIST_BADGE_ORDER, code);
      changed = true;
    }
  }
  changed |= apply_toggle(it, MESSAGE_KEY_SHOW_WEATHER, PERSIST_SHOW_WEATHER,
                          &s_settings.show_weather);
  changed |= apply_toggle(it, MESSAGE_KEY_SHOW_STEPS, PERSIST_SHOW_STEPS, &s_settings.show_steps);
  changed |= apply_toggle(it, MESSAGE_KEY_SHOW_DATE, PERSIST_SHOW_DATE, &s_settings.show_date);
  changed |= apply_toggle(it, MESSAGE_KEY_SHOW_BATTERY, PERSIST_SHOW_BATTERY,
                          &s_settings.show_battery);
  changed |= apply_toggle(it, MESSAGE_KEY_SHOW_HOME_TEMP, PERSIST_SHOW_HOME_TEMP,
                          &s_settings.show_home_temp);
  changed |= apply_reading(it, MESSAGE_KEY_WEATHER_TEMP, PERSIST_WEATHER_TEMP,
                           PERSIST_WEATHER_AT, &s_settings.weather_temp, &s_settings.weather_at);
  changed |= apply_reading(it, MESSAGE_KEY_HA_TEMP, PERSIST_HOME_TEMP, PERSIST_HOME_AT,
                           &s_settings.home_temp, &s_settings.home_at);
  changed |= apply_int(it, MESSAGE_KEY_SUNRISE, PERSIST_SUNRISE, &s_settings.sunrise_min);
  changed |= apply_int(it, MESSAGE_KEY_SUNSET, PERSIST_SUNSET, &s_settings.sunset_min);

  if (changed && s_canvas) layer_mark_dirty(s_canvas);
}

static time_t s_last_refresh;

static void request_refresh(bool periodic) {
  if (!connection_service_peek_pebble_app_connection()) return;
  const time_t now = time(NULL);
  if (!periodic && s_last_refresh != 0 && now - s_last_refresh < RECONNECT_REFRESH_MIN_GAP_S) {
    return;
  }
  DictionaryIterator *out;
  if (app_message_outbox_begin(&out) != APP_MSG_OK) return;  // busy: next interval retries
  dict_write_uint8(out, MESSAGE_KEY_REFRESH, 1);
  if (app_message_outbox_send() == APP_MSG_OK) s_last_refresh = now;
}

// --------------------------------------------------------------------------- //
// Live readings
// --------------------------------------------------------------------------- //

// Today's step total, or -1 when Health is unavailable (badge hidden).
static int32_t read_steps(void) {
#if defined(PBL_HEALTH)
  const time_t start = time_start_of_today();
  const time_t end = time(NULL);
  HealthServiceAccessibilityMask mask =
      health_service_metric_accessible(HealthMetricStepCount, start, end);
  if (mask & HealthServiceAccessibilityMaskAvailable) {
    return (int32_t)health_service_sum_today(HealthMetricStepCount);
  }
  if (mask & (HealthServiceAccessibilityMaskNoPermission | HealthServiceAccessibilityMaskNotSupported)) {
    return -1;
  }
  return 0;  // permitted, just no data yet today
#else
  return -1;
#endif
}

// Pebble has no temperature-unit setting. The phone app's Metric/Imperial
// choice is only exposed through Health's per-metric display system, and
// walked distance (km vs miles) is the metric that follows it.
static bool use_fahrenheit(void) {
#if defined(PBL_HEALTH)
  return health_service_get_measurement_system_for_display(HealthMetricWalkedDistanceMeters) ==
         MeasurementSystemImperial;
#else
  return false;
#endif
}

// --------------------------------------------------------------------------- //
// Theme palette (64-colour displays snap to 2 bits per channel)
// --------------------------------------------------------------------------- //

typedef struct {
  GColor background;
  GColor foreground;
  GColor pill;
  GColor border;
  GColor pill_text;
} Palette;

static Palette palette_for(bool dark) {
  if (dark) {
    return (Palette){
        .background = GColorBlack,
        .foreground = GColorWhite,
        .pill = GColorBlack,
        .border = GColorDarkGray,
        .pill_text = GColorWhite,
    };
  }
  return (Palette){
      .background = GColorWhite,
      .foreground = GColorBlack,
      .pill = GColorWhite,
      .border = GColorLightGray,
      .pill_text = GColorBlack,
  };
}

// --------------------------------------------------------------------------- //
// Images
// --------------------------------------------------------------------------- //

static GBitmap *icon_image(IconKind kind) {
  if (!s_icons[kind]) s_icons[kind] = gbitmap_create_with_resource(ICON_RESOURCES[kind]);
  return s_icons[kind];
}

static GDrawCommandImage *casita_image(Expression expr) {
  if (s_casita_expr != (int)expr) {
    if (s_casita) gdraw_command_image_destroy(s_casita);
    s_casita = gdraw_command_image_create_with_resource(CASITA_RESOURCES[expr]);
    s_casita_expr = expr;
  }
  return s_casita;
}

typedef struct {
  int num;
  int den;
} Ratio;

// Scales every point (and stroke width / circle radius) of one draw command.
// Precise-path points are 13.3 fixed point; scaling the raw value works the
// same way.
static bool scale_command(GDrawCommand *command, uint32_t index, void *context) {
  const Ratio *r = context;
  const uint16_t count = gdraw_command_get_num_points(command);
  for (uint16_t i = 0; i < count; i++) {
    GPoint p = gdraw_command_get_point(command, i);
    p.x = p.x * r->num / r->den;
    p.y = p.y * r->num / r->den;
    gdraw_command_set_point(command, i, p);
  }
  const uint8_t stroke = gdraw_command_get_stroke_width(command);
  if (stroke > 0) {
    int scaled = stroke * r->num / r->den;
    gdraw_command_set_stroke_width(command, scaled < 1 ? 1 : scaled);
  }
  if (gdraw_command_get_type(command) == GDrawCommandTypeCircle) {
    gdraw_command_set_radius(command, gdraw_command_get_radius(command) * r->num / r->den);
  }
  return true;
}

// Returns the Casita image for `expr`, scaled down (aspect preserved) when it
// is taller than `max_h`. `size` receives the drawn size.
static GDrawCommandImage *casita_fitting(Expression expr, int max_h, GSize *size) {
  GDrawCommandImage *full = casita_image(expr);
  if (!full) return NULL;
  const GSize native = gdraw_command_image_get_bounds_size(full);
  if (max_h <= 0 || native.h <= max_h) {
    *size = native;
    return full;
  }
  if (s_casita_scaled_expr != (int)expr || s_casita_scaled_h != max_h) {
    if (s_casita_scaled) gdraw_command_image_destroy(s_casita_scaled);
    s_casita_scaled = gdraw_command_image_clone(full);
    s_casita_scaled_expr = -1;
    if (!s_casita_scaled) {
      *size = native;
      return full;
    }
    Ratio ratio = {.num = max_h, .den = native.h};
    gdraw_command_list_iterate(gdraw_command_image_get_command_list(s_casita_scaled),
                               scale_command, &ratio);
    gdraw_command_image_set_bounds_size(s_casita_scaled,
                                        GSize(native.w * max_h / native.h, max_h));
    s_casita_scaled_expr = expr;
    s_casita_scaled_h = max_h;
  }
  *size = gdraw_command_image_get_bounds_size(s_casita_scaled);
  return s_casita_scaled;
}

// --------------------------------------------------------------------------- //
// Badges
// --------------------------------------------------------------------------- //

typedef struct {
  IconKind icon;
  char text[12];
} Badge;

// Builds the visible badges, in priority order. Returns how many. `weather`
// and `home` are the readings after the freshness check (fresh_reading).
static int build_badges(const struct tm *now, int weather, int home, Badge *badges) {
  int n = 0;
  for (int i = 0; i < BADGE_COUNT; i++) {
    Badge *b = &badges[n];
    switch (s_settings.badge_order[i]) {
      case BADGE_DATE:
        if (!s_settings.show_date) break;
        b->icon = ICON_CALENDAR;
        format_date(b->text, sizeof(b->text), now->tm_mday);
        n++;
        break;
      case BADGE_WEATHER:
        if (!s_settings.show_weather) break;
        b->icon = ICON_THERMOMETER;
        format_temperature(b->text, sizeof(b->text), weather, use_fahrenheit());
        n++;
        break;
      case BADGE_STEPS: {
        if (!s_settings.show_steps) break;
        const int32_t steps = read_steps();
        if (steps < 0) break;
        b->icon = ICON_SHOEPRINT;
        format_steps(b->text, sizeof(b->text), steps);
        n++;
        break;
      }
      case BADGE_BATTERY: {
        if (!s_settings.show_battery) break;
        const int percent = battery_state_service_peek().charge_percent;
        b->icon = battery_icon(percent);
        format_battery(b->text, sizeof(b->text), percent);
        n++;
        break;
      }
      case BADGE_HOME:
        // Only once the phone has pushed a Home Assistant reading; a stale one
        // keeps the badge (so the layout doesn't jump) but shows "--".
        if (!s_settings.show_home_temp || s_settings.home_temp == WEATHER_UNKNOWN) break;
        b->icon = ICON_HOME_THERMOMETER;
        format_temperature(b->text, sizeof(b->text), home, use_fahrenheit());
        n++;
        break;
      default:
        break;
    }
  }
  return n;
}

static int text_width(const char *text, GFont font) {
  return graphics_text_layout_get_content_size(text, font, GRect(0, 0, 200, 40),
                                               GTextOverflowModeFill, GTextAlignmentLeft)
      .w;
}

// Fills a stadium (fully rounded ends). graphics_fill_rect caps its corner
// radius well below half a pill, so the ends are drawn as discs.
static void fill_pill(GContext *ctx, GRect r) {
  const int d = r.size.h;
  if (r.size.w <= d) {
    graphics_fill_radial(ctx, r, GOvalScaleModeFitCircle, d, 0, TRIG_MAX_ANGLE);
    return;
  }
  graphics_fill_radial(ctx, GRect(r.origin.x, r.origin.y, d, d), GOvalScaleModeFitCircle, d, 0,
                       TRIG_MAX_ANGLE);
  graphics_fill_radial(ctx, GRect(r.origin.x + r.size.w - d, r.origin.y, d, d),
                       GOvalScaleModeFitCircle, d, 0, TRIG_MAX_ANGLE);
  graphics_fill_rect(ctx, GRect(r.origin.x + d / 2, r.origin.y, r.size.w - d, d), 0,
                     GCornerNone);
}

static void draw_pill(GContext *ctx, int x, int y, int width, const Badge *badge,
                      const Palette *pal) {
  // Border = a filled pill in the border colour with a smaller filled pill in
  // the fill colour on top, which gives an exact BORDER_W outline.
  graphics_context_set_fill_color(ctx, pal->border);
  fill_pill(ctx, GRect(x, y, width, PILL_H));
  graphics_context_set_fill_color(ctx, pal->pill);
  fill_pill(ctx, GRect(x + BORDER_W, y + BORDER_W, width - BORDER_W * 2, PILL_H - BORDER_W * 2));

  GBitmap *icon = icon_image(badge->icon);
  if (icon) {
    // GCompOpSet blends the icon's alpha edges into the pill.
    graphics_context_set_compositing_mode(ctx, GCompOpSet);
    graphics_draw_bitmap_in_rect(
        ctx, icon, GRect(x + PILL_PAD_X, y + (PILL_H - ICON_SIZE) / 2, ICON_SIZE, ICON_SIZE));
    graphics_context_set_compositing_mode(ctx, GCompOpAssign);
  }
  graphics_context_set_text_color(ctx, pal->pill_text);
  const int text_x = x + PILL_PAD_X + ICON_SIZE + ICON_GAP;
  graphics_draw_text(ctx, badge->text, s_badge_font,
                     GRect(text_x, y + BADGE_TEXT_TOP, width - (text_x - x), BADGE_TEXT_BOX_H),
                     GTextOverflowModeFill, GTextAlignmentLeft, NULL);
}

/**
 * Draws the badge rows along the top of `area` and returns the band height
 * Casita must stay below (0 without badges).
 *
 * Only the stacked rows are reserved (one on rect, two on round): Casita's
 * roof leaves the top corners empty, so the corner-pinned last row sits beside
 * the roof peak instead of pushing Casita down. Expressions whose art fills the
 * corners (sleeping, disconnected) reserve every row instead.
 */
static int draw_badges(GContext *ctx, GRect area, const Palette *pal, const struct tm *now,
                       int weather, int home, Expression expr) {
  Badge badges[MAX_BADGES];
  const int count = build_badges(now, weather, home, badges);
  if (count == 0) return 0;

  int widths[MAX_BADGES];
  for (int i = 0; i < count; i++) {
    widths[i] = PILL_PAD_X + ICON_SIZE + ICON_GAP + text_width(badges[i].text, s_badge_font) +
                PILL_PAD_X;
  }

  const BadgeLayoutOptions opts = {
      .area_width = area.size.w,
      .round = PBL_IF_ROUND_ELSE(true, false),
      .margin = MARGIN,
      .gap = BADGE_GAP,
      .pill_height = PILL_H,
  };
  BadgePlacement placements[MAX_BADGES];
  const int rows = layout_badges(widths, count, &opts, placements);

  for (int i = 0; i < count; i++) {
    const BadgePlacement *p = &placements[i];
    const int y = area.origin.y + MARGIN + p->row * (PILL_H + BADGE_GAP);
    draw_pill(ctx, area.origin.x + p->x, y, widths[p->index], &badges[p->index], pal);
  }

  const int stacked = PBL_IF_ROUND_ELSE(2, 1);
  const int reserved = (expression_fills_top_corners(expr) || rows < stacked) ? rows : stacked;
  return MARGIN * 2 + reserved * PILL_H + (reserved - 1) * BADGE_GAP;
}

// --------------------------------------------------------------------------- //
// Frame
// --------------------------------------------------------------------------- //

static void canvas_update(Layer *layer, GContext *ctx) {
  const time_t t = time(NULL);
  const struct tm *now = localtime(&t);
  const int hour = now->tm_hour;
  const int minute = now->tm_min;

  const bool dark = theme_is_dark(s_settings.theme, hour * 60 + minute, s_settings.sunrise_min,
                                  s_settings.sunset_min);
  const Palette pal = palette_for(dark);
  // Readings older than an hour (phone away, refreshes failing) show as "--"
  // and no longer drive the sweating face.
  const int weather = fresh_reading(s_settings.weather_temp, s_settings.weather_at, (int32_t)t);
  const int home = fresh_reading(s_settings.home_temp, s_settings.home_at, (int32_t)t);
  const Expression expr =
      pick_expression(connection_service_peek_pebble_app_connection(), weather, hour);

  // Lay out inside the unobstructed area so the face shrinks for Quick View.
  const GRect bounds = layer_get_bounds(layer);
  const GRect area = layer_get_unobstructed_bounds(layer);

  graphics_context_set_antialiased(ctx, true);
  graphics_context_set_fill_color(ctx, pal.background);
  graphics_fill_rect(ctx, bounds, 0, GCornerNone);

  const int band = draw_badges(ctx, area, &pal, now, weather, home, expr);

  // Clock, centred at the bottom of the free area.
  char time_text[8];
  format_time(time_text, sizeof(time_text), hour, minute, !clock_is_24h_style());
  const int ink_bottom = area.origin.y + area.size.h - CLOCK_MARGIN_BOTTOM;
  const int clock_box_y = ink_bottom - CLOCK_INK_TOP - CLOCK_INK_H;
  graphics_context_set_text_color(ctx, pal.foreground);
  graphics_draw_text(ctx, time_text, s_time_font,
                     GRect(area.origin.x, clock_box_y, area.size.w, CLOCK_BOX_H),
                     GTextOverflowModeFill, GTextAlignmentCenter, NULL);

  // Casita fills the space between the badge band and the clock's ink,
  // scaled down when the Quick View squeezes it.
  const int space_top = area.origin.y + band;
  const int space_bottom = clock_box_y + CLOCK_INK_TOP;
  const int available = space_bottom - space_top;
  GSize size;
  GDrawCommandImage *casita = casita_fitting(expr, available - CASITA_MIN_GAP * 2, &size);
  if (casita) {
    int y = space_top + (available - size.h) / 2;
    if (y < space_top + CASITA_MIN_GAP) y = space_top + CASITA_MIN_GAP;
    const int x = area.origin.x + (area.size.w - size.w) / 2;
    gdraw_command_image_draw(ctx, casita, GPoint(x, y));
  }
}

// --------------------------------------------------------------------------- //
// Events
// --------------------------------------------------------------------------- //

static void tick_handler(struct tm *tick_time, TimeUnits units_changed) {
  layer_mark_dirty(s_canvas);
  if (tick_time->tm_min % REFRESH_EVERY_MIN == 0) request_refresh(true);
}

static void app_connection_handler(bool connected) {
  layer_mark_dirty(s_canvas);
  if (connected) request_refresh(false);
}

// --------------------------------------------------------------------------- //
// Lifecycle
// --------------------------------------------------------------------------- //

static void window_load(Window *window) {
  Layer *root = window_get_root_layer(window);
  s_canvas = layer_create(layer_get_bounds(root));
  layer_set_update_proc(s_canvas, canvas_update);
  layer_add_child(root, s_canvas);
}

static void window_unload(Window *window) {
  layer_destroy(s_canvas);
  s_canvas = NULL;
}

static void init(void) {
  settings_load();

  s_time_font = fonts_get_system_font(FONT_KEY_BITHAM_42_BOLD);
  s_badge_font = fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD);

  s_window = window_create();
  window_set_window_handlers(s_window, (WindowHandlers){
                                           .load = window_load,
                                           .unload = window_unload,
                                       });
  window_stack_push(s_window, true);

  tick_timer_service_subscribe(MINUTE_UNIT, tick_handler);
  connection_service_subscribe((ConnectionHandlers){
      .pebble_app_connection_handler = app_connection_handler,
  });

  // Register before opening. The largest inbound message is the settings
  // dictionary (~100 bytes); the outbox only carries the REFRESH request.
  app_message_register_inbox_received(inbox_received);
  app_message_open(256, 32);
}

static void deinit(void) {
  tick_timer_service_unsubscribe();
  connection_service_unsubscribe();
  app_message_deregister_callbacks();
  window_destroy(s_window);

  for (int i = 0; i < ICON_COUNT; i++) {
    if (s_icons[i]) gbitmap_destroy(s_icons[i]);
  }
  if (s_casita) gdraw_command_image_destroy(s_casita);
  if (s_casita_scaled) gdraw_command_image_destroy(s_casita_scaled);
}

int main(void) {
  init();
  app_event_loop();
  deinit();
}
