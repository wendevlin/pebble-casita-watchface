import { expect, test, describe } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import pkg from "../package.json";

/*
 * Guards the generated resources (`bun run resources`, run by `bun run test`
 * first) against the watch code:
 *  - every resource declared in package.json exists,
 *  - the Casita PDCs use only precise paths (1/8 px, anti-aliased on the watch),
 *  - the badge icons are RGBA PNGs of exactly ICON_SIZE from src/c/main.c, so
 *    the watch blits them 1:1 and never rescales them,
 *  - main.c maps every declared resource.
 */

const root = resolve(import.meta.dir, "..");
const media: { type: string; name: string; file: string }[] = pkg.pebble.resources.media;
const raw = media.filter((m) => m.type === "raw");
const icons = media.filter((m) => m.name.startsWith("ICON_"));

const PRECISE_PATH = 3;

interface Pdc {
  width: number;
  height: number;
  commandTypes: number[];
}

function readPdc(file: string): Pdc {
  const buf = readFileSync(resolve(root, "resources", file));
  expect(buf.subarray(0, 4).toString("latin1")).toBe("PDCI");
  const width = buf.readInt16LE(10);
  const height = buf.readInt16LE(12);
  const count = buf.readUInt16LE(14);
  const commandTypes: number[] = [];
  let offset = 16;
  for (let i = 0; i < count; i++) {
    commandTypes.push(buf.readUInt8(offset));
    const points = buf.readUInt16LE(offset + 7);
    offset += 9 + points * 4;
  }
  expect(offset).toBe(buf.length);
  return { width, height, commandTypes };
}

const mainC = readFileSync(resolve(root, "src/c/main.c"), "utf8");
const iconSize = Number(/#define ICON_SIZE (\d+)/.exec(mainC)?.[1]);

describe("Watch resources", () => {
  test("every declared resource exists", () => {
    for (const m of media) {
      expect(existsSync(resolve(root, "resources", m.file)), m.file).toBe(true);
    }
  });

  test("every draw command is a precise path", () => {
    for (const m of raw) {
      const pdc = readPdc(m.file);
      expect(pdc.commandTypes.length, m.file).toBeGreaterThan(0);
      for (const type of pdc.commandTypes) expect(type, m.file).toBe(PRECISE_PATH);
    }
  });

  test("badge icons are RGBA PNG bitmaps of ICON_SIZE", () => {
    expect(iconSize).toBeGreaterThan(0);
    expect(icons.length).toBeGreaterThan(0);
    for (const m of icons) {
      expect(m.type, m.name).toBe("bitmap");
      const png = readFileSync(resolve(root, "resources", m.file));
      expect(png.subarray(1, 4).toString("latin1"), m.file).toBe("PNG");
      expect(png.readUInt32BE(16), m.file).toBe(iconSize); // IHDR width
      expect(png.readUInt32BE(20), m.file).toBe(iconSize); // IHDR height
      expect(png.readUInt8(25), m.file).toBe(6); // colour type: RGBA
    }
  });

  test("main.c maps every declared resource", () => {
    for (const m of media.filter((r) => r.name !== "APP_ICON")) {
      expect(mainC, m.name).toContain(`RESOURCE_ID_${m.name}`);
    }
  });
});
