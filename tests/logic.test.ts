import { expect, test, describe } from "bun:test";
import {
  Casita,
  expressionForHour,
  expressionFillsTopCorners,
  isSweatingTemp,
  SWEATING_TEMP_TENTHS,
  normalizeTheme,
  themeToCode,
  resolveTheme,
  minutesOfDay,
  SUN_UNKNOWN,
  formatTime,
  DEFAULT_THEME,
  normalizeToggle,
  toggleToCode,
  formatSteps,
  formatDate,
  formatBattery,
  batteryIcon,
  Icon,
  tempUnitForSystem,
  formatTemperature,
  WEATHER_UNKNOWN,
  normalizeBadgeOrder,
  badgeOrderToCode,
  DEFAULT_BADGE_ORDER,
  layoutBadges,
  ROUND_SECOND_ROW_MAX,
  RECT_FIRST_ROW_MAX,
} from "../src/embeddedjs/logic";
import { MARGIN, BADGE_GAP, PILL_H } from "../src/embeddedjs/constants";

describe("expressionForHour", () => {
  test("night before morning", () => {
    expect(expressionForHour(0)).toBe(Casita.Sleeping);
    expect(expressionForHour(5)).toBe(Casita.Sleeping);
  });

  test("morning 06:00-11:59 -> Normal", () => {
    expect(expressionForHour(6)).toBe(Casita.Normal);
    expect(expressionForHour(11)).toBe(Casita.Normal);
  });

  test("noon 12:00-14:59 -> Happy", () => {
    expect(expressionForHour(12)).toBe(Casita.Happy);
    expect(expressionForHour(14)).toBe(Casita.Happy);
  });

  test("afternoon 15:00-20:59 -> Grinning", () => {
    expect(expressionForHour(15)).toBe(Casita.Grinning);
    expect(expressionForHour(20)).toBe(Casita.Grinning);
  });

  test("night 21:00-05:59 -> Sleeping", () => {
    expect(expressionForHour(21)).toBe(Casita.Sleeping);
    expect(expressionForHour(23)).toBe(Casita.Sleeping);
  });
});

describe("expressionFillsTopCorners", () => {
  test("sleeping and disconnected fill the top corners", () => {
    expect(expressionFillsTopCorners(Casita.Sleeping)).toBe(true);
    expect(expressionFillsTopCorners(Casita.Disconnected)).toBe(true);
  });

  test("house expressions leave the roof corners empty", () => {
    expect(expressionFillsTopCorners(Casita.Normal)).toBe(false);
    expect(expressionFillsTopCorners(Casita.Happy)).toBe(false);
    expect(expressionFillsTopCorners(Casita.Grinning)).toBe(false);
    expect(expressionFillsTopCorners(Casita.Sweating)).toBe(false);
  });
});

describe("isSweatingTemp", () => {
  test("true at or above 30 °C", () => {
    expect(isSweatingTemp(SWEATING_TEMP_TENTHS)).toBe(true); // exactly 30.0 °C
    expect(isSweatingTemp(305)).toBe(true);
    expect(isSweatingTemp(400)).toBe(true);
  });
  test("false below 30 °C", () => {
    expect(isSweatingTemp(299)).toBe(false);
    expect(isSweatingTemp(0)).toBe(false);
    expect(isSweatingTemp(-50)).toBe(false);
  });
  test("unknown reading never sweats", () => {
    expect(isSweatingTemp(WEATHER_UNKNOWN)).toBe(false);
  });
});

function at(hour: number, minute: number): Date {
  return new Date(2020, 0, 1, hour, minute, 0);
}

describe("formatTime 24h", () => {
  test("leading-zero hour", () => {
    expect(formatTime(at(7, 5), false)).toBe("07:05");
  });
  test("midnight", () => {
    expect(formatTime(at(0, 0), false)).toBe("00:00");
  });
  test("afternoon", () => {
    expect(formatTime(at(18, 30), false)).toBe("18:30");
  });
});

describe("formatTime 12h", () => {
  test("no leading-zero hour", () => {
    expect(formatTime(at(7, 5), true)).toBe("7:05");
  });
  test("midnight shows 12", () => {
    expect(formatTime(at(0, 15), true)).toBe("12:15");
  });
  test("noon shows 12", () => {
    expect(formatTime(at(12, 0), true)).toBe("12:00");
  });
  test("afternoon wraps to 12h", () => {
    expect(formatTime(at(13, 30), true)).toBe("1:30");
  });
});

describe("normalizeTheme", () => {
  test("passes through valid strings", () => {
    expect(normalizeTheme("light")).toBe("light");
    expect(normalizeTheme("dark")).toBe("dark");
    expect(normalizeTheme("auto")).toBe("auto");
  });
  test("maps app-message codes (number)", () => {
    expect(normalizeTheme(0)).toBe("light");
    expect(normalizeTheme(1)).toBe("dark");
    expect(normalizeTheme(2)).toBe("auto");
  });
  test("maps app-message codes (string)", () => {
    expect(normalizeTheme("0")).toBe("light");
    expect(normalizeTheme("1")).toBe("dark");
    expect(normalizeTheme("2")).toBe("auto");
  });
  test("falls back to default for junk/undefined", () => {
    expect(normalizeTheme(undefined)).toBe(DEFAULT_THEME);
    expect(normalizeTheme(null)).toBe(DEFAULT_THEME);
    expect(normalizeTheme("purple")).toBe(DEFAULT_THEME);
    expect(normalizeTheme(3)).toBe(DEFAULT_THEME);
  });
});

describe("themeToCode", () => {
  test("light -> 0, dark -> 1, auto -> 2", () => {
    expect(themeToCode("light")).toBe(0);
    expect(themeToCode("dark")).toBe(1);
    expect(themeToCode("auto")).toBe(2);
  });
});

describe("resolveTheme", () => {
  const sunrise = 7 * 60; // 07:00
  const sunset = 19 * 60; // 19:00

  test("concrete themes pass through unchanged", () => {
    expect(resolveTheme("light", 12 * 60, sunrise, sunset)).toBe("light");
    expect(resolveTheme("dark", 12 * 60, sunrise, sunset)).toBe("dark");
  });
  test("auto is light between sunrise and sunset", () => {
    expect(resolveTheme("auto", sunrise, sunrise, sunset)).toBe("light"); // exactly sunrise
    expect(resolveTheme("auto", 12 * 60, sunrise, sunset)).toBe("light");
  });
  test("auto is dark before sunrise and at/after sunset", () => {
    expect(resolveTheme("auto", sunrise - 1, sunrise, sunset)).toBe("dark");
    expect(resolveTheme("auto", sunset, sunrise, sunset)).toBe("dark"); // exactly sunset
    expect(resolveTheme("auto", 23 * 60, sunrise, sunset)).toBe("dark");
  });
  test("auto falls back to dark when sun times are unknown or invalid", () => {
    expect(resolveTheme("auto", 12 * 60, SUN_UNKNOWN, SUN_UNKNOWN)).toBe("dark");
    expect(resolveTheme("auto", 12 * 60, sunset, sunrise)).toBe("dark"); // reversed
  });
});

describe("minutesOfDay", () => {
  test("counts minutes since local midnight", () => {
    expect(minutesOfDay(new Date(2020, 0, 1, 0, 0))).toBe(0);
    expect(minutesOfDay(new Date(2020, 0, 1, 7, 30))).toBe(450);
    expect(minutesOfDay(new Date(2020, 0, 1, 23, 59))).toBe(1439);
  });
});

describe("normalizeToggle", () => {
  test("truthy values", () => {
    expect(normalizeToggle(true)).toBe(true);
    expect(normalizeToggle(1)).toBe(true);
    expect(normalizeToggle("1")).toBe(true);
    expect(normalizeToggle("true")).toBe(true);
  });
  test("falsy values", () => {
    expect(normalizeToggle(false)).toBe(false);
    expect(normalizeToggle(0)).toBe(false);
    expect(normalizeToggle("0")).toBe(false);
    expect(normalizeToggle("false")).toBe(false);
  });
  test("falls back for junk", () => {
    expect(normalizeToggle(undefined)).toBe(false);
    expect(normalizeToggle(null, true)).toBe(true);
    expect(normalizeToggle("nope", true)).toBe(true);
  });
});

describe("toggleToCode", () => {
  test("on -> 1, off -> 0", () => {
    expect(toggleToCode(true)).toBe(1);
    expect(toggleToCode(false)).toBe(0);
  });
});

describe("formatSteps", () => {
  test("below 100 shows raw count", () => {
    expect(formatSteps(0)).toBe("0");
    expect(formatSteps(56)).toBe("56");
    expect(formatSteps(99)).toBe("99");
  });
  test("100..999 shows tenths of a K", () => {
    expect(formatSteps(100)).toBe("0,1K");
    expect(formatSteps(410)).toBe("0,4K");
    expect(formatSteps(950)).toBe("0,9K");
  });
  test("1000+ drops decimals", () => {
    expect(formatSteps(1000)).toBe("1K");
    expect(formatSteps(1999)).toBe("1K");
    expect(formatSteps(12876)).toBe("12K");
  });
  test("guards junk", () => {
    expect(formatSteps(NaN)).toBe("0");
    expect(formatSteps(-5)).toBe("0");
  });
});

describe("formatDate", () => {
  test("shows the day of month without padding", () => {
    expect(formatDate(new Date(2026, 8, 14))).toBe("14");
    expect(formatDate(new Date(2026, 0, 1))).toBe("1");
    expect(formatDate(new Date(2026, 11, 31))).toBe("31");
  });
});

describe("formatBattery", () => {
  test("formats a whole-percent value", () => {
    expect(formatBattery(85)).toBe("85%");
    expect(formatBattery(0)).toBe("0%");
    expect(formatBattery(100)).toBe("100%");
  });
  test("rounds fractional values", () => {
    expect(formatBattery(72.4)).toBe("72%");
    expect(formatBattery(72.6)).toBe("73%");
  });
  test("clamps out-of-range values", () => {
    expect(formatBattery(-10)).toBe("0%");
    expect(formatBattery(150)).toBe("100%");
  });
  test("guards junk", () => {
    expect(formatBattery(NaN)).toBe("--");
    expect(formatBattery(Infinity)).toBe("--");
  });
});

describe("batteryIcon", () => {
  test("high at 70% and above -> green icon", () => {
    expect(batteryIcon(70)).toBe(Icon.BatteryHigh);
    expect(batteryIcon(100)).toBe(Icon.BatteryHigh);
  });
  test("medium from 30% up to 69% -> orange icon", () => {
    expect(batteryIcon(30)).toBe(Icon.BatteryMedium);
    expect(batteryIcon(69)).toBe(Icon.BatteryMedium);
  });
  test("low below 30% -> red icon", () => {
    expect(batteryIcon(29)).toBe(Icon.BatteryLow);
    expect(batteryIcon(0)).toBe(Icon.BatteryLow);
  });
});

describe("normalizeBadgeOrder", () => {
  test("parses the compact code string", () => {
    expect(normalizeBadgeOrder("dwsb")).toEqual(["date", "weather", "steps", "battery", "home"]);
    expect(normalizeBadgeOrder("bswd")).toEqual(["battery", "steps", "weather", "date", "home"]);
  });
  test("parses comma-separated ids and arrays", () => {
    expect(normalizeBadgeOrder("steps,date,weather,battery")).toEqual([
      "steps",
      "date",
      "weather",
      "battery",
      "home",
    ]);
    expect(normalizeBadgeOrder(["weather", "steps", "date", "battery"])).toEqual([
      "weather",
      "steps",
      "date",
      "battery",
      "home",
    ]);
  });
  test("appends missing badges in default order", () => {
    expect(normalizeBadgeOrder("s")).toEqual(["steps", "date", "weather", "battery", "home"]);
    expect(normalizeBadgeOrder(["weather"])).toEqual(["weather", "date", "steps", "battery", "home"]);
  });
  test("ignores unknown and duplicate tokens", () => {
    expect(normalizeBadgeOrder("wwx")).toEqual(["weather", "date", "steps", "battery", "home"]);
    expect(normalizeBadgeOrder("steps,steps,bogus")).toEqual([
      "steps",
      "date",
      "weather",
      "battery",
      "home",
    ]);
  });
  test("falls back to the default for junk/empty", () => {
    expect(normalizeBadgeOrder(undefined)).toEqual(DEFAULT_BADGE_ORDER);
    expect(normalizeBadgeOrder(null)).toEqual(DEFAULT_BADGE_ORDER);
    expect(normalizeBadgeOrder("")).toEqual(DEFAULT_BADGE_ORDER);
  });
});

describe("badgeOrderToCode", () => {
  test("round-trips through normalizeBadgeOrder", () => {
    expect(badgeOrderToCode(["date", "weather", "steps", "battery"])).toBe("dwsb");
    expect(badgeOrderToCode(["steps", "date", "weather", "battery"])).toBe("sdwb");
    expect(normalizeBadgeOrder(badgeOrderToCode(["weather", "steps", "date", "battery"]))).toEqual([
      "weather",
      "steps",
      "date",
      "battery",
      "home",
    ]);
  });
});

describe("tempUnitForSystem", () => {
  test("imperial -> F, else C", () => {
    expect(tempUnitForSystem("imperial")).toBe("F");
    expect(tempUnitForSystem("metric")).toBe("C");
    expect(tempUnitForSystem(undefined)).toBe("C");
  });
});

describe("formatTemperature", () => {
  test("Celsius with comma separator, no unit letter", () => {
    expect(formatTemperature(248, "C")).toBe("24,8°");
    expect(formatTemperature(0, "C")).toBe("0,0°");
    expect(formatTemperature(-53, "C")).toBe("-5,3°");
  });
  test("Fahrenheit conversion, no unit letter", () => {
    expect(formatTemperature(0, "F")).toBe("32,0°");
    expect(formatTemperature(100, "F")).toBe("50,0°");
  });
  test("unknown sentinel -> --", () => {
    expect(formatTemperature(WEATHER_UNKNOWN, "C")).toBe("--");
    expect(formatTemperature(NaN, "C")).toBe("--");
  });
});

describe("layoutBadges", () => {
  const W = 200; // emery-sized area
  const rightEdge = W - MARGIN;
  const geom = { margin: MARGIN, gap: BADGE_GAP, pillHeight: PILL_H };
  const rect = (widths: number[], areaWidth = W) =>
    layoutBadges(widths, { areaWidth, round: false, ...geom });
  const round = (widths: number[], areaWidth = 260) =>
    layoutBadges(widths, { areaWidth, round: true, ...geom });
  const rowOf = (l: ReturnType<typeof layoutBadges>, row: number) =>
    l.placements.filter((p) => p.row === row);

  test("nothing to show", () => {
    expect(rect([])).toEqual({ placements: [], rows: 0 });
    expect(round([], W)).toEqual({ placements: [], rows: 0 });
  });

  test("rect: one row fills from the right edge, first badge rightmost", () => {
    const l = rect([50, 60, 40]);
    expect(l.rows).toBe(1);
    expect(l.placements).toEqual([
      { index: 0, row: 0, x: rightEdge - 50 },
      { index: 1, row: 0, x: rightEdge - 50 - BADGE_GAP - 60 },
      { index: 2, row: 0, x: rightEdge - 50 - BADGE_GAP - 60 - BADGE_GAP - 40 },
    ]);
  });

  test("rect: up to three badges stay on one row even when wide", () => {
    const l = rect([90, 90, 90]);
    expect(l.rows).toBe(1);
    expect(RECT_FIRST_ROW_MAX).toBe(3);
    // The over-wide trio may run past the left edge (accepted).
    expect(l.placements[2].x).toBeLessThan(0);
  });

  test("rect: four badges -> three on top, fourth in the bottom-right corner", () => {
    const l = rect([50, 50, 50, 70]);
    expect(l.rows).toBe(2);
    expect(rowOf(l, 0).map((p) => p.index)).toEqual([0, 1, 2]);
    expect(rowOf(l, 1)).toEqual([{ index: 3, row: 1, x: rightEdge - 70 }]);
  });

  test("rect: five badges -> three on top, corners below with the middle clear", () => {
    const l = rect([50, 50, 50, 70, 60]);
    expect(l.rows).toBe(2);
    expect(rowOf(l, 0).map((p) => p.index)).toEqual([0, 1, 2]);
    expect(rowOf(l, 0)[0].x).toBe(rightEdge - 50);
    const second = rowOf(l, 1);
    expect(second).toEqual([
      { index: 3, row: 1, x: rightEdge - 70 }, // right corner
      { index: 4, row: 1, x: MARGIN }, // left corner
    ]);
    // Gap between them is the free middle for the roof peak.
    expect(second[0].x - (second[1].x + 60)).toBeGreaterThan(0);
  });

  test("rect: more than five keeps filling the second row inward, last still in the left corner", () => {
    const l = rect([40, 40, 40, 40, 40, 40]);
    expect(l.rows).toBe(2);
    expect(rowOf(l, 1).map((p) => p.index)).toEqual([3, 4, 5]);
    expect(rowOf(l, 1)[0].x).toBe(rightEdge - 40);
    expect(rowOf(l, 1)[1].x).toBe(rightEdge - 40 - BADGE_GAP - 40);
    expect(rowOf(l, 1)[2].x).toBe(MARGIN);
  });

  test("round: single badge centred in the top row", () => {
    const l = round([60]);
    expect(l.rows).toBe(1);
    expect(l.placements).toEqual([{ index: 0, row: 0, x: 100 }]);
  });

  test("round: first badge alone on top, next two centred below, #2 on the right", () => {
    const l = round([60, 80, 40, 50]);
    expect(l.rows).toBe(3);
    expect(rowOf(l, 0)).toEqual([{ index: 0, row: 0, x: 100 }]);
    const second = rowOf(l, 1);
    expect(second.map((p) => p.index)).toEqual([1, 2]);
    expect(ROUND_SECOND_ROW_MAX).toBe(2);
    const total = 80 + BADGE_GAP + 40;
    const right = Math.floor(130 + total / 2);
    expect(second[0].x).toBe(right - 80);
    expect(second[1].x).toBe(right - 80 - BADGE_GAP - 40);
    // The pair is centred: slack on both sides matches within 1px rounding.
    expect(Math.abs(second[1].x - (260 - (second[0].x + 80)))).toBeLessThanOrEqual(1);
    // The fourth badge already opens the third row, at the right edge.
    expect(rowOf(l, 2).map((p) => p.index)).toEqual([3]);
  });

  test("round: three badges -> 1 + 2, no third row", () => {
    const l = round([60, 80, 40]);
    expect(l.rows).toBe(2);
    expect(rowOf(l, 1).map((p) => p.index)).toEqual([1, 2]);
  });

  test("round: two badges -> one on top, one below", () => {
    const l = round([50, 70]);
    expect(l.rows).toBe(2);
    expect(rowOf(l, 1)).toEqual([{ index: 1, row: 1, x: 130 - 35 }]);
  });

  test("round: fourth badge goes to a third row at the circle's right edge", () => {
    const l = round([50, 50, 50, 70]);
    expect(l.rows).toBe(3);
    const third = rowOf(l, 2);
    expect(third.map((p) => p.index)).toEqual([3]);
    // Row 3 top = margin + 2*(pill+gap); chord half at that height on r=130.
    const y = MARGIN + 2 * (PILL_H + BADGE_GAP);
    const half = Math.sqrt(130 * 130 - (130 - y) * (130 - y));
    expect(third[0].x).toBe(Math.floor(130 + half) - 70);
    // Inside the bounding square, and clear of the centre.
    expect(third[0].x + 70).toBeLessThanOrEqual(260);
    expect(third[0].x).toBeGreaterThan(130);
  });

  test("round: fifth badge is pinned to the circle's left edge, middle clear", () => {
    const l = round([50, 50, 50, 70, 60]);
    expect(l.rows).toBe(3);
    const third = rowOf(l, 2);
    expect(third.map((p) => p.index)).toEqual([3, 4]);
    const y = MARGIN + 2 * (PILL_H + BADGE_GAP);
    const half = Math.sqrt(130 * 130 - (130 - y) * (130 - y));
    expect(third[1].x).toBe(Math.ceil(130 - half));
    expect(third[0].x).toBe(Math.floor(130 + half) - 70);
    // Symmetric about the centre (within rounding) with a free middle.
    expect(Math.abs(130 - third[1].x - (third[0].x + 70 - 130))).toBeLessThanOrEqual(1);
    expect(third[0].x - (third[1].x + 60)).toBeGreaterThan(40);
  });

});
