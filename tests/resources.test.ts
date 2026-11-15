import { expect, test, describe } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import pkg from "../package.json";

/*
 * Guards the generated PDC resources (`bun run resources`, run by `bun run
 * test` first) against the watch code:
 *  - every raw resource declared in package.json exists and is a PDC image,
 *  - every draw command is a precise path (1/8 px, anti-aliased on the watch),
 *  - the badge icons are generated at exactly ICON_SIZE from src/c/main.c, so
 *    the watch draws them 1:1 and never rescales them.
 */

const root = resolve(import.meta.dir, "..");
const media: { type: string; name: string; file: string }[] = pkg.pebble.resources.media;
const raw = media.filter((m) => m.type === "raw");

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

describe("PDC resources", () => {
  test("every raw resource exists", () => {
    for (const m of raw) {
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

  test("badge icons are generated at ICON_SIZE", () => {
    expect(iconSize).toBeGreaterThan(0);
    for (const m of raw.filter((r) => r.name.startsWith("ICON_"))) {
      const pdc = readPdc(m.file);
      expect(Math.max(pdc.width, pdc.height), m.file).toBe(iconSize);
    }
  });

  test("main.c maps every declared resource", () => {
    for (const m of raw) expect(mainC, m.name).toContain(`RESOURCE_ID_${m.name}`);
  });
});
