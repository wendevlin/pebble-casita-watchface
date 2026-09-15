import { expect, test, describe } from "bun:test";
import {
  Casita,
  expressionForHour,
  formatTime,
  formatSeconds,
  normalizeTheme,
  themeToCode,
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
} from "../src/embeddedjs/logic";

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

describe("formatSeconds", () => {
  test("pads single-digit seconds", () => {
    expect(formatSeconds(new Date(2020, 0, 1, 7, 5, 3))).toBe("03");
  });
  test("zero seconds", () => {
    expect(formatSeconds(new Date(2020, 0, 1, 7, 5, 0))).toBe("00");
  });
  test("two-digit seconds", () => {
    expect(formatSeconds(new Date(2020, 0, 1, 7, 5, 45))).toBe("45");
  });
  test("max seconds", () => {
    expect(formatSeconds(new Date(2020, 0, 1, 7, 5, 59))).toBe("59");
  });
});

describe("normalizeTheme", () => {
  test("passes through valid strings", () => {
    expect(normalizeTheme("light")).toBe("light");
    expect(normalizeTheme("dark")).toBe("dark");
  });
  test("maps app-message codes (number)", () => {
    expect(normalizeTheme(0)).toBe("light");
    expect(normalizeTheme(1)).toBe("dark");
  });
  test("maps app-message codes (string)", () => {
    expect(normalizeTheme("0")).toBe("light");
    expect(normalizeTheme("1")).toBe("dark");
  });
  test("falls back to default for junk/undefined", () => {
    expect(normalizeTheme(undefined)).toBe(DEFAULT_THEME);
    expect(normalizeTheme(null)).toBe(DEFAULT_THEME);
    expect(normalizeTheme("purple")).toBe(DEFAULT_THEME);
    expect(normalizeTheme(2)).toBe(DEFAULT_THEME);
  });
});

describe("themeToCode", () => {
  test("light -> 0, dark -> 1", () => {
    expect(themeToCode("light")).toBe(0);
    expect(themeToCode("dark")).toBe(1);
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
    expect(normalizeBadgeOrder("dwsb")).toEqual(["date", "weather", "steps", "battery"]);
    expect(normalizeBadgeOrder("bswd")).toEqual(["battery", "steps", "weather", "date"]);
  });
  test("parses comma-separated ids and arrays", () => {
    expect(normalizeBadgeOrder("steps,date,weather,battery")).toEqual([
      "steps",
      "date",
      "weather",
      "battery",
    ]);
    expect(normalizeBadgeOrder(["weather", "steps", "date", "battery"])).toEqual([
      "weather",
      "steps",
      "date",
      "battery",
    ]);
  });
  test("appends missing badges in default order", () => {
    expect(normalizeBadgeOrder("s")).toEqual(["steps", "date", "weather", "battery"]);
    expect(normalizeBadgeOrder(["weather"])).toEqual(["weather", "date", "steps", "battery"]);
  });
  test("ignores unknown and duplicate tokens", () => {
    expect(normalizeBadgeOrder("wwx")).toEqual(["weather", "date", "steps", "battery"]);
    expect(normalizeBadgeOrder("steps,steps,bogus")).toEqual([
      "steps",
      "date",
      "weather",
      "battery",
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
