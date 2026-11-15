import { expect, test, describe } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { resolve } from "node:path";
import pkg from "../package.json";
import { CASITA_TAGS, ICON_SIZE_LARGE, ICON_SIZE_SMALL, ICON_VARIANTS } from "../tools/icon-variants";

/*
 * Guards the generated resources (`bun run resources`, run by `bun run test`
 * first) against the watch code:
 *  - every resource declared in package.json exists, with every per-platform
 *    tagged variant (tools/icon-variants.ts),
 *  - the Casita PDCs use only precise paths (1/8 px, anti-aliased on the watch),
 *  - the badge icons have exactly the size main.c draws on that screen class
 *    (RGBA; the 1-bit watches' variants hold only opaque black and fully
 *    transparent pixels), so the watch blits them 1:1 and never rescales them,
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
const define = (name: string): number => Number(new RegExp(`#define ${name} (\\d+)`).exec(mainC)?.[1]);

/** Concatenated IDAT payload of a PNG. */
function idat(png: Buffer): Buffer {
  const parts: Buffer[] = [];
  for (let off = 8; off < png.length; ) {
    const len = png.readUInt32BE(off);
    if (png.toString("latin1", off + 4, off + 8) === "IDAT") parts.push(png.subarray(off + 8, off + 8 + len));
    off += 12 + len;
  }
  return Buffer.concat(parts);
}

const tagged = (file: string, tag: string): string => file.replace(/(\.\w+)$/, `${tag}$1`);

describe("Watch resources", () => {
  test("icon sizes match main.c", () => {
    expect(define("ICON_SIZE_LARGE")).toBe(ICON_SIZE_LARGE);
    expect(define("ICON_SIZE_SMALL")).toBe(ICON_SIZE_SMALL);
  });

  test("every declared resource exists", () => {
    for (const m of media) {
      expect(existsSync(resolve(root, "resources", m.file)), m.file).toBe(true);
    }
  });

  test("every Casita variant uses only precise paths", () => {
    expect(raw.length).toBeGreaterThan(0);
    for (const m of raw) {
      for (const tag of CASITA_TAGS) {
        const file = tagged(m.file, tag);
        const pdc = readPdc(file);
        expect(pdc.commandTypes.length, file).toBeGreaterThan(0);
        for (const type of pdc.commandTypes) expect(type, file).toBe(PRECISE_PATH);
      }
    }
  });

  test("every badge icon variant is a PNG of its screen class's size", () => {
    expect(icons.length).toBeGreaterThan(0);
    for (const m of icons) {
      expect(m.type, m.name).toBe("bitmap");
      for (const v of ICON_VARIANTS) {
        const file = tagged(m.file, v.tag);
        const png = readFileSync(resolve(root, "resources", file));
        expect(png.subarray(1, 4).toString("latin1"), file).toBe("PNG");
        expect(png.readUInt32BE(16), file).toBe(v.size); // IHDR width
        expect(png.readUInt32BE(20), file).toBe(v.size); // IHDR height
        expect(png.readUInt8(25), file).toBe(6); // colour type: RGBA
        if (v.bw) {
          const pixels = inflateSync(idat(png));
          for (let i = 0; i < pixels.length; i += v.size * 4 + 1) {
            for (let px = i + 1; px < i + 1 + v.size * 4; px += 4) {
              const rgba = pixels.readUInt32BE(px);
              expect(rgba === 0x000000ff || rgba === 0, `${file}: only black or clear`).toBe(true);
            }
          }
        }
      }
    }
  });

  test("main.c maps every declared resource", () => {
    for (const m of media.filter((r) => r.name !== "APP_ICON")) {
      expect(mainC, m.name).toContain(`RESOURCE_ID_${m.name}`);
    }
  });
});
