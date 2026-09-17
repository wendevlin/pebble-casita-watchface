import { expect, test, describe } from "bun:test";
import { Casita, Icon } from "../src/embeddedjs/logic";
import { MESSAGE_KEYS } from "../src/embeddedjs/constants";
import pkg from "../package.json";

/*
 * `pebble build` assigns resource IDs by position in package.json
 * `pebble.resources.media` (1-based). The Casita / Icon enums are generated from
 * that list by tools/render-resources.mjs and loaded on the watch with
 * `new Poco.PebbleDrawCommandImage(id)`, which throws a fatal "not found" when
 * the ID does not resolve to a PDC. This test checks the generated enums against
 * package.json independently, so a stale or broken generation (or a PNG landing
 * on a PDC id — the v1.0.0 store crash) fails here instead of on the watch.
 */

const media: { type: string; name: string }[] = pkg.pebble.resources.media;
const idOf = (name: string): number => {
  const index = media.findIndex((m) => m.name === name);
  expect(index, `resource ${name} declared in package.json`).toBeGreaterThanOrEqual(0);
  return index + 1;
};

describe("resource IDs match package.json media order", () => {
  test("Casita expressions", () => {
    expect(Casita.Normal).toBe(idOf("CASITA_NORMAL"));
    expect(Casita.Happy).toBe(idOf("CASITA_HAPPY"));
    expect(Casita.Grinning).toBe(idOf("CASITA_GRINNING"));
    expect(Casita.Sleeping).toBe(idOf("CASITA_SLEEPING"));
    expect(Casita.Disconnected).toBe(idOf("CASITA_DISCONNECTED"));
    expect(Casita.Sweating).toBe(idOf("CASITA_SWEATING"));
  });

  test("badge icons", () => {
    expect(Icon.Thermometer).toBe(idOf("ICON_THERMOMETER"));
    expect(Icon.ShoePrint).toBe(idOf("ICON_SHOEPRINT"));
    expect(Icon.CalendarBlank).toBe(idOf("ICON_CALENDARBLANK"));
    expect(Icon.BatteryLow).toBe(idOf("ICON_BATTERY_LOW"));
    expect(Icon.BatteryMedium).toBe(idOf("ICON_BATTERY_MEDIUM"));
    expect(Icon.BatteryHigh).toBe(idOf("ICON_BATTERY_HIGH"));
    expect(Icon.HomeThermometer).toBe(idOf("ICON_HOME_THERMOMETER"));
  });

  test("every enum ID points at a raw (PDC) resource", () => {
    const ids = [
      ...Object.values(Casita).filter((v): v is number => typeof v === "number"),
      ...Object.values(Icon).filter((v): v is number => typeof v === "number"),
    ];
    for (const id of ids) {
      expect(media[id - 1]?.type, `resource #${id} (${media[id - 1]?.name})`).toBe("raw");
    }
  });
});

/*
 * AppMessage keys are numbered by position too: the watch maps each name in
 * constants.MESSAGE_KEYS to `10000 + index`, while the phone side resolves the
 * same names through the codes `pebble build` assigns from package.json
 * `messageKeys` (also by position). The two lists are maintained by hand in
 * different files, so any divergence silently sends settings under the wrong
 * code — a badge toggle would land on the theme, and so on. This guards the
 * lists against each other.
 */
describe("AppMessage keys match package.json messageKeys", () => {
  test("same names in the same order", () => {
    expect(MESSAGE_KEYS).toEqual(pkg.pebble.messageKeys);
  });
});
