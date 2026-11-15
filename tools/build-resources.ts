/*
 * Build step: turn the SVG artwork into watch resources.
 *
 *  - Casita expressions -> Pebble Draw Command images (.pdc) via
 *    tools/svg2pdc.py, with precise (1/8 px) paths. They stay vectors because
 *    the watch scales Casita down when the Quick View squeezes the face.
 *  - Badge icons -> anti-aliased RGBA PNGs via tools/svg2png.py, rasterized at
 *    exactly the size the watch draws them (ICON_SIZE in src/c/main.c), so
 *    holes (the calendar page, the thermometer channel) and small details
 *    survive and nothing is rescaled on the watch.
 *
 * The generated files land in resources/ (gitignored) and are declared in
 * package.json `pebble.resources.media` — keep the two in sync
 * (tests/resources.test.ts fails if an entry is missing).
 *
 * Colours: the watch keeps 2 bits per channel, so pick tints that land on a
 * saturated palette entry. A muted tint (e.g. Material green #4caf50 ->
 * 85,170,85) looks fine in the emulator but reads as grey on the real Pebble
 * Time 2 display.
 */

import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Every tint in one place, so the intent is visible at a glance.
const HA_BLUE = "#18bcf2"; // Casita body (also the converter's default)
const HA_ORANGE = "#f7931e"; // disconnected Casita
const GREY = "#999999"; // sleeping Casita
const GREEN = "#00ff00"; // GColorGreen  — battery >= 70 %
const ORANGE = "#ff9800"; // GColorChromeYellow (255,170,0) — battery >= 30 %
const RED = "#ff0000"; // GColorRed — battery < 30 %

// Must match ICON_SIZE in src/c/main.c (checked by tests/resources.test.ts).
const ICON_SIZE = 20;

const casita = (name: string): string => `casita-svgs/${name}.svg`;
const mdi = (name: string): string => `mdi-svgs/${name}.svg`;

interface Job {
  /** Which converter: vector PDC or rasterized PNG icon. */
  kind: "pdc" | "png";
  /** Output directory, relative to the repo root. */
  out: string;
  /** SVG inputs, relative to the repo root. */
  files: string[];
  /**
   * Paint every fill in bodyColor, keeping the off-white face colour. Off for
   * the MDI icons, whose accent fill is baked into the SVG.
   */
  normalize?: boolean;
  bodyColor?: string;
  /** Output file name, for rendering the same SVG in several tints. */
  name?: string;
}

const JOBS: Job[] = [
  // Casita expressions: HA blue body by default.
  {
    kind: "pdc",
    out: "resources/casita",
    normalize: true,
    bodyColor: HA_BLUE,
    files: ["Normal", "Happy", "Grinning", "Sweating"].map(casita),
  },
  { kind: "pdc", out: "resources/casita", normalize: true, bodyColor: HA_ORANGE, files: [casita("No internet")] },
  { kind: "pdc", out: "resources/casita", normalize: true, bodyColor: GREY, files: [casita("Sleeping")] },

  // Badge icons with their accent fill baked into the SVG.
  {
    kind: "png",
    out: "resources/icons",
    files: ["thermometer", "shoe-print", "calendar-blank", "home-thermometer"].map(mdi),
  },

  // One battery glyph, three tints by charge level.
  { kind: "png", out: "resources/icons", normalize: true, bodyColor: RED, name: "batterylow.png", files: [mdi("battery")] },
  { kind: "png", out: "resources/icons", normalize: true, bodyColor: ORANGE, name: "batterymedium.png", files: [mdi("battery")] },
  { kind: "png", out: "resources/icons", normalize: true, bodyColor: GREEN, name: "batteryhigh.png", files: [mdi("battery")] },
];

for (const job of JOBS) {
  const args =
    job.kind === "pdc"
      ? [resolve(root, "tools/svg2pdc.py"), "--precise"]
      : [resolve(root, "tools/svg2png.py"), "--size", String(ICON_SIZE)];
  if (job.normalize) args.push("--normalize");
  if (job.bodyColor) args.push("--body-color", job.bodyColor);
  if (job.name) args.push("--name", job.name);
  args.push("--out", job.out, ...job.files);

  const result = spawnSync("python3", args, { cwd: root, stdio: "inherit" });
  if (result.status !== 0) {
    console.error(`${job.kind} conversion failed (${result.status ?? result.signal}) for: ${job.files.join(", ")}`);
    process.exit(result.status ?? 1);
  }
}
