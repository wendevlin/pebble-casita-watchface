/*
 * Host unit tests for src/c/logic.c (the watch-independent watchface logic).
 * Build + run: `bun run test:c` (plain cc, no Pebble SDK needed).
 */
#include <stdio.h>
#include <string.h>

#include "logic.h"

static int s_failures = 0;
static int s_checks = 0;

#define CHECK(cond)                                                      \
  do {                                                                   \
    s_checks++;                                                          \
    if (!(cond)) {                                                       \
      s_failures++;                                                      \
      fprintf(stderr, "%s:%d: CHECK failed: %s\n", __FILE__, __LINE__, #cond); \
    }                                                                    \
  } while (0)

#define CHECK_STR(actual, expected)                                                    \
  do {                                                                                 \
    s_checks++;                                                                        \
    if (strcmp((actual), (expected)) != 0) {                                           \
      s_failures++;                                                                    \
      fprintf(stderr, "%s:%d: expected \"%s\", got \"%s\"\n", __FILE__, __LINE__,      \
              (expected), (actual));                                                   \
    }                                                                                  \
  } while (0)

#define DEG "\xc2\xb0"

static void test_expressions(void) {
  CHECK(expression_for_hour(0) == EXPR_SLEEPING);
  CHECK(expression_for_hour(5) == EXPR_SLEEPING);
  CHECK(expression_for_hour(6) == EXPR_NORMAL);
  CHECK(expression_for_hour(11) == EXPR_NORMAL);
  CHECK(expression_for_hour(12) == EXPR_HAPPY);
  CHECK(expression_for_hour(14) == EXPR_HAPPY);
  CHECK(expression_for_hour(15) == EXPR_GRINNING);
  CHECK(expression_for_hour(20) == EXPR_GRINNING);
  CHECK(expression_for_hour(21) == EXPR_SLEEPING);
  CHECK(expression_for_hour(23) == EXPR_SLEEPING);

  CHECK(expression_fills_top_corners(EXPR_SLEEPING));
  CHECK(expression_fills_top_corners(EXPR_DISCONNECTED));
  CHECK(!expression_fills_top_corners(EXPR_NORMAL));
  CHECK(!expression_fills_top_corners(EXPR_HAPPY));
  CHECK(!expression_fills_top_corners(EXPR_GRINNING));
  CHECK(!expression_fills_top_corners(EXPR_SWEATING));

  CHECK(is_sweating_temp(SWEATING_TEMP_TENTHS));
  CHECK(is_sweating_temp(305));
  CHECK(!is_sweating_temp(299));
  CHECK(!is_sweating_temp(-50));
  CHECK(!is_sweating_temp(WEATHER_UNKNOWN));

  CHECK(pick_expression(false, 350, 12) == EXPR_DISCONNECTED);
  CHECK(pick_expression(true, 350, 12) == EXPR_SWEATING);
  CHECK(pick_expression(true, 200, 12) == EXPR_HAPPY);
  CHECK(pick_expression(true, WEATHER_UNKNOWN, 3) == EXPR_SLEEPING);
}

static void test_time(void) {
  char buf[8];
  format_time(buf, sizeof(buf), 7, 5, false);
  CHECK_STR(buf, "07:05");
  format_time(buf, sizeof(buf), 0, 0, false);
  CHECK_STR(buf, "00:00");
  format_time(buf, sizeof(buf), 18, 30, false);
  CHECK_STR(buf, "18:30");
  format_time(buf, sizeof(buf), 7, 5, true);
  CHECK_STR(buf, "7:05");
  format_time(buf, sizeof(buf), 0, 15, true);
  CHECK_STR(buf, "12:15");
  format_time(buf, sizeof(buf), 12, 0, true);
  CHECK_STR(buf, "12:00");
  format_time(buf, sizeof(buf), 13, 30, true);
  CHECK_STR(buf, "1:30");
}

static void test_theme(void) {
  CHECK(theme_from_code(0) == THEME_LIGHT);
  CHECK(theme_from_code(1) == THEME_DARK);
  CHECK(theme_from_code(2) == THEME_AUTO);
  CHECK(theme_from_code(3) == DEFAULT_THEME);
  CHECK(theme_from_code(-1) == DEFAULT_THEME);

  const int sunrise = 7 * 60, sunset = 19 * 60;
  CHECK(!theme_is_dark(THEME_LIGHT, 23 * 60, sunrise, sunset));
  CHECK(theme_is_dark(THEME_DARK, 12 * 60, sunrise, sunset));
  CHECK(!theme_is_dark(THEME_AUTO, sunrise, sunrise, sunset));  // exactly sunrise
  CHECK(!theme_is_dark(THEME_AUTO, 12 * 60, sunrise, sunset));
  CHECK(theme_is_dark(THEME_AUTO, sunrise - 1, sunrise, sunset));
  CHECK(theme_is_dark(THEME_AUTO, sunset, sunrise, sunset));  // exactly sunset
  CHECK(theme_is_dark(THEME_AUTO, 23 * 60, sunrise, sunset));
  CHECK(theme_is_dark(THEME_AUTO, 12 * 60, SUN_UNKNOWN, SUN_UNKNOWN));
  CHECK(theme_is_dark(THEME_AUTO, 12 * 60, sunset, sunrise));  // reversed
}

static void test_badge_text(void) {
  char buf[16];
  format_steps(buf, sizeof(buf), 0);
  CHECK_STR(buf, "0");
  format_steps(buf, sizeof(buf), -5);
  CHECK_STR(buf, "0");
  format_steps(buf, sizeof(buf), 56);
  CHECK_STR(buf, "56");
  format_steps(buf, sizeof(buf), 99);
  CHECK_STR(buf, "99");
  format_steps(buf, sizeof(buf), 100);
  CHECK_STR(buf, "0,1K");
  format_steps(buf, sizeof(buf), 410);
  CHECK_STR(buf, "0,4K");
  format_steps(buf, sizeof(buf), 950);
  CHECK_STR(buf, "0,9K");
  format_steps(buf, sizeof(buf), 999);
  CHECK_STR(buf, "0,9K");
  format_steps(buf, sizeof(buf), 1000);
  CHECK_STR(buf, "1K");
  format_steps(buf, sizeof(buf), 1999);
  CHECK_STR(buf, "1K");
  format_steps(buf, sizeof(buf), 12876);
  CHECK_STR(buf, "12K");

  format_date(buf, sizeof(buf), 14);
  CHECK_STR(buf, "14");
  format_date(buf, sizeof(buf), 1);
  CHECK_STR(buf, "1");

  format_battery(buf, sizeof(buf), 85);
  CHECK_STR(buf, "85%");
  format_battery(buf, sizeof(buf), 0);
  CHECK_STR(buf, "0%");
  format_battery(buf, sizeof(buf), 100);
  CHECK_STR(buf, "100%");
  format_battery(buf, sizeof(buf), -10);
  CHECK_STR(buf, "0%");
  format_battery(buf, sizeof(buf), 150);
  CHECK_STR(buf, "100%");

  CHECK(battery_icon(70) == ICON_BATTERY_HIGH);
  CHECK(battery_icon(100) == ICON_BATTERY_HIGH);
  CHECK(battery_icon(30) == ICON_BATTERY_MEDIUM);
  CHECK(battery_icon(69) == ICON_BATTERY_MEDIUM);
  CHECK(battery_icon(29) == ICON_BATTERY_LOW);
  CHECK(battery_icon(0) == ICON_BATTERY_LOW);

  format_temperature(buf, sizeof(buf), 248, false);
  CHECK_STR(buf, "24,8" DEG);
  format_temperature(buf, sizeof(buf), 0, false);
  CHECK_STR(buf, "0,0" DEG);
  format_temperature(buf, sizeof(buf), -53, false);
  CHECK_STR(buf, "-5,3" DEG);
  format_temperature(buf, sizeof(buf), -5, false);
  CHECK_STR(buf, "-0,5" DEG);
  format_temperature(buf, sizeof(buf), 0, true);
  CHECK_STR(buf, "32,0" DEG);
  format_temperature(buf, sizeof(buf), 100, true);
  CHECK_STR(buf, "50,0" DEG);
  format_temperature(buf, sizeof(buf), 248, true);
  CHECK_STR(buf, "76,6" DEG);
  format_temperature(buf, sizeof(buf), -400, true);
  CHECK_STR(buf, "-40,0" DEG);
  format_temperature(buf, sizeof(buf), WEATHER_UNKNOWN, false);
  CHECK_STR(buf, "--");
}

static void order_code(const char *input, char out[BADGE_COUNT + 1]) {
  BadgeId order[BADGE_COUNT];
  parse_badge_order(input, order);
  badge_order_to_code(order, out);
}

static void test_badge_order(void) {
  char code[BADGE_COUNT + 1];
  order_code("dwsb", code);
  CHECK_STR(code, "dwsbh");
  order_code("bswd", code);
  CHECK_STR(code, "bswdh");
  order_code("hdwsb", code);
  CHECK_STR(code, "hdwsb");
  order_code("steps,date,weather,battery", code);
  CHECK_STR(code, "sdwbh");
  order_code("s", code);
  CHECK_STR(code, "sdwbh");
  order_code("wwx", code);
  CHECK_STR(code, "wdsbh");
  order_code("steps,steps,bogus", code);
  CHECK_STR(code, "sdwbh");
  order_code("", code);
  CHECK_STR(code, "dwsbh");
  order_code(NULL, code);
  CHECK_STR(code, "dwsbh");
}

static int row_count(const BadgePlacement *p, int n, int row) {
  int c = 0;
  for (int i = 0; i < n; i++) c += p[i].row == row;
  return c;
}

static const BadgePlacement *find(const BadgePlacement *p, int n, int index) {
  for (int i = 0; i < n; i++)
    if (p[i].index == index) return &p[i];
  return NULL;
}

static void test_layout(void) {
  enum { MARGIN = 6, GAP = 5, PILL = 30 };
  const BadgeLayoutOptions rect = {200, false, MARGIN, GAP, PILL};
  const BadgeLayoutOptions round = {260, true, MARGIN, GAP, PILL};
  const int right = 200 - MARGIN;
  BadgePlacement p[MAX_BADGES];

  CHECK(layout_badges(NULL, 0, &rect, p) == 0);

  {  // one row, filled from the right edge
    const int w[] = {50, 60, 40};
    CHECK(layout_badges(w, 3, &rect, p) == 1);
    CHECK(p[0].index == 0 && p[0].row == 0 && p[0].x == right - 50);
    CHECK(p[1].x == right - 50 - GAP - 60);
    CHECK(p[2].x == right - 50 - GAP - 60 - GAP - 40);
  }
  {  // wide trio may run past the left edge
    const int w[] = {90, 90, 90};
    CHECK(layout_badges(w, 3, &rect, p) == 1);
    CHECK(p[2].x < 0);
  }
  {  // four -> fourth in the bottom-right corner
    const int w[] = {50, 50, 50, 70};
    CHECK(layout_badges(w, 4, &rect, p) == 2);
    CHECK(row_count(p, 4, 0) == 3);
    CHECK(find(p, 4, 3)->row == 1 && find(p, 4, 3)->x == right - 70);
  }
  {  // five -> corners below, middle clear
    const int w[] = {50, 50, 50, 70, 60};
    CHECK(layout_badges(w, 5, &rect, p) == 2);
    CHECK(find(p, 5, 3)->row == 1 && find(p, 5, 3)->x == right - 70);
    CHECK(find(p, 5, 4)->row == 1 && find(p, 5, 4)->x == MARGIN);
  }
  {  // round: single badge centred
    const int w[] = {60};
    CHECK(layout_badges(w, 1, &round, p) == 1);
    CHECK(p[0].x == 100);
  }
  {  // round: 1 + 2 + 1
    const int w[] = {60, 80, 40, 50};
    CHECK(layout_badges(w, 4, &round, p) == 3);
    const int total = 80 + GAP + 40;
    const int r = 130 + total / 2;
    CHECK(find(p, 4, 1)->row == 1 && find(p, 4, 1)->x == r - 80);
    CHECK(find(p, 4, 2)->row == 1 && find(p, 4, 2)->x == r - 80 - GAP - 40);
    CHECK(find(p, 4, 3)->row == 2);
  }
  {  // round: two -> one on top, one below
    const int w[] = {50, 70};
    CHECK(layout_badges(w, 2, &round, p) == 2);
    CHECK(find(p, 2, 1)->x == 130 - 35);
  }
  {  // round: five -> third row hugs the circle edge, symmetric
    const int w[] = {50, 50, 50, 70, 60};
    CHECK(layout_badges(w, 5, &round, p) == 3);
    // Row 3 top = 6 + 2 * 35 = 76; half chord on r = 130 is floor(sqrt(130^2 - 54^2)) = 118.
    CHECK(find(p, 5, 3)->x == 130 + 118 - 70);
    CHECK(find(p, 5, 4)->x == 130 - 118);
    CHECK(find(p, 5, 3)->x + 70 <= 260);
  }
}

int main(void) {
  test_expressions();
  test_time();
  test_theme();
  test_badge_text();
  test_badge_order();
  test_layout();
  if (s_failures) {
    fprintf(stderr, "%d of %d checks failed\n", s_failures, s_checks);
    return 1;
  }
  printf("logic: all %d checks passed\n", s_checks);
  return 0;
}
