/*
 * Build step: turn the SVG artwork into watch resources.
 *
 *  - Casita expressions -> Pebble Draw Command images (.pdc) via
 *    tools/svg2pdc.py, with precise (1/8 px) paths. They stay vectors because
 *    the watch scales Casita to the free space (small screens, Quick View).
 *  - Badge icons -> PNGs via tools/svg2png.py, rasterized at exactly the size
 *    the watch draws them (ICON_SIZE_* in src/c/main.c), so holes and small
 *    details survive and nothing is rescaled on the watch.
 *
 * Per-platform variants (large/small, colour/1-bit) use the SDK's resource
 * file tags; the table is in tools/icon-variants.ts. Casita gets a black
 * "~bw" variant for the black-and-white watches.
 *
 * The generated files land in resources/ (gitignored); tests/resources.test.ts
 * checks every variant exists with the right size and format.
 *
 * Colours: the watch keeps 2 bits per channel, so pick tints that land on a
 * saturated palette entry. A muted tint (e.g. Material green #4caf50 ->
 * 85,170,85) looks fine in the emulator but reads as grey on the real Pebble
 * Time 2 display.
 */

import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ICON_VARIANTS } from "./icon-variants";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Every tint in one place, so the intent is visible at a glance.
const HA_BLUE = "#18bcf2"; // Casita body (also the converter's default)
const HA_ORANGE = "#f7931e"; // disconnected Casita
const GREY = "#999999"; // sleeping Casita
const BLACK = "#000000"; // Casita on black-and-white displays (inverted for dark)
const GREEN = "#00ff00"; // GColorGreen  — battery >= 70 %
const ORANGE = "#ff9800"; // GColorChromeYellow (255,170,0) — battery >= 30 %
const RED = "#ff0000"; // GColorRed — battery < 30 %

const casitaSvg = (name: string): string => `casita-svgs/${name}.svg`;
const mdi = (name: string): string => `mdi-svgs/${name}.svg`;

function run(tool: string, args: string[]): void {
  const result = spawnSync("python3", [resolve(root, "tools", tool), ...args], { cwd: root, stdio: "inherit" });
  if (result.status !== 0) {
    console.error(`${tool} failed (${result.status ?? result.signal}): ${args.join(" ")}`);
    process.exit(result.status ?? 1);
  }
}

// --- Casita expressions ----------------------------------------------------- //

// output name -> [source SVG, colour body tint]
const CASITA: Record<string, [string, string]> = {
  "normal.pdc": [casitaSvg("Normal"), HA_BLUE],
  "happy.pdc": [casitaSvg("Happy"), HA_BLUE],
  "grinning.pdc": [casitaSvg("Grinning"), HA_BLUE],
  "sweating.pdc": [casitaSvg("Sweating"), HA_BLUE],
  "disconnected.pdc": [casitaSvg("No internet"), HA_ORANGE],
  "sleeping.pdc": [casitaSvg("Sleeping"), GREY],
};

for (const [name, [svg, tint]] of Object.entries(CASITA)) {
  const common = ["--precise", "--normalize", "--out", "resources/casita"];
  run("svg2pdc.py", [...common, "--body-color", tint, "--name", name, svg]);
  run("svg2pdc.py", [...common, "--body-color", BLACK, "--name", name.replace(".pdc", "~bw.pdc"), svg]);
}

// --- Badge icons ------------------------------------------------------------ //

interface Icon {
  /** Output base name (package.json `file` without .png). */
  name: string;
  /** Source for the colour variants. */
  svg: string;
  /** Tint for colour variants of single-colour glyphs; omitted = SVG colours. */
  tint?: string;
  /** Source for the black-and-white variant, when it differs. */
  bwSvg?: string;
}

const ICONS: Icon[] = [
  { name: "thermometer", svg: mdi("thermometer") },
  { name: "shoeprint", svg: mdi("shoe-print") },
  { name: "calendarblank", svg: mdi("calendar-blank") },
  { name: "homethermometer", svg: mdi("home-thermometer") },
  // Colour displays tint one battery glyph by charge level; black-and-white
  // displays show the level as bars instead.
  { name: "batterylow", svg: mdi("battery"), tint: RED, bwSvg: mdi("battery-low") },
  { name: "batterymedium", svg: mdi("battery"), tint: ORANGE, bwSvg: mdi("battery-medium") },
  { name: "batteryhigh", svg: mdi("battery"), tint: GREEN, bwSvg: mdi("battery-high") },
];

for (const icon of ICONS) {
  for (const v of ICON_VARIANTS) {
    const args = ["--size", String(v.size), "--out", "resources/icons", "--name", `${icon.name}${v.tag}.png`];
    if (v.bw) {
      args.push("--bw", icon.bwSvg ?? icon.svg);
    } else {
      if (icon.tint) args.push("--normalize", "--body-color", icon.tint);
      args.push(icon.svg);
    }
    run("svg2png.py", args);
  }
}
