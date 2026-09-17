/*
 * Build step: convert the SVG artwork into Pebble Draw Command (.pdc) images.
 *
 * One entry per output group below; each job is a call to tools/svg2pdc.py.
 * The generated files land in resources/ (gitignored) and are declared in
 * package.json `pebble.resources.media` — keep the two in sync (the resource-ID
 * guard in tests/resources.test.ts fails the build if an entry is missing).
 *
 * Colours: the converter truncates to 2 bits per channel, so pick tints that
 * land on a saturated palette entry. A muted tint (e.g. Material green #4caf50
 * -> 85,170,85) looks fine in the emulator but reads as grey on the real
 * Pebble Time 2 display.
 */

import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const converter = resolve(root, "tools/svg2pdc.py");

// Every tint in one place, so the intent is visible at a glance.
const HA_BLUE = "#18bcf2"; // Casita body (also the converter's default)
const HA_ORANGE = "#f7931e"; // disconnected Casita
const GREY = "#999999"; // sleeping Casita
const GREEN = "#00ff00"; // GColorGreen  — battery >= 70 %
const ORANGE = "#ff9800"; // GColorChromeYellow (255,170,0) — battery >= 30 %
const RED = "#ff0000"; // GColorRed — battery < 30 %

const casita = (name: string): string => `casita-svgs/${name}.svg`;
const mdi = (name: string): string => `mdi-svgs/${name}.svg`;

interface Job {
  /** Output directory, relative to the repo root. */
  out: string;
  /** SVG inputs, relative to the repo root. */
  files: string[];
  /**
   * Snap every fill to the two-colour Casita palette (face colour kept,
   * everything else -> bodyColor). Off for the MDI icons, whose accent fill is
   * baked into the SVG.
   */
  normalize?: boolean;
  bodyColor?: string;
  /** Output file name, for rendering the same SVG in several tints. */
  name?: string;
}

const JOBS: Job[] = [
  // Casita expressions: HA blue body by default.
  {
    out: "resources/casita",
    normalize: true,
    bodyColor: HA_BLUE,
    files: ["Normal", "Happy", "Grinning", "Sweating"].map(casita),
  },
  { out: "resources/casita", normalize: true, bodyColor: HA_ORANGE, files: [casita("No internet")] },
  { out: "resources/casita", normalize: true, bodyColor: GREY, files: [casita("Sleeping")] },

  // Badge icons with their accent fill baked into the SVG.
  { out: "resources/icons", files: ["thermometer", "shoe-print", "calendar-blank", "home-thermometer"].map(mdi) },

  // One battery glyph, three tints by charge level.
  { out: "resources/icons", normalize: true, bodyColor: RED, name: "batterylow.pdc", files: [mdi("battery")] },
  { out: "resources/icons", normalize: true, bodyColor: ORANGE, name: "batterymedium.pdc", files: [mdi("battery")] },
  { out: "resources/icons", normalize: true, bodyColor: GREEN, name: "batteryhigh.pdc", files: [mdi("battery")] },
];

for (const job of JOBS) {
  const args = [converter];
  if (job.normalize) args.push("--normalize");
  if (job.bodyColor) args.push("--body-color", job.bodyColor);
  if (job.name) args.push("--name", job.name);
  args.push("--out", job.out, ...job.files);

  const result = spawnSync("python3", args, { cwd: root, stdio: "inherit" });
  if (result.status !== 0) {
    console.error(`svg2pdc failed (${result.status ?? result.signal}) for: ${job.files.join(", ")}`);
    process.exit(result.status ?? 1);
  }
}
