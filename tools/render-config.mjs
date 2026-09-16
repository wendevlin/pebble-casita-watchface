/*
 * Build step: render the Eta settings template (src/pkjs/config.eta) into a
 * plain HTML string module (src/pkjs/config-html.ts) that the phone-side code
 * imports. Runs at build time only — Eta never ships to the watch/phone.
 *
 * The template carries no per-user data; preferences are injected at runtime by
 * replacing the literal `__CONFIG__` token (see src/pkjs/index.ts).
 */

import { Eta } from "eta";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const templatePath = resolve(root, "src/pkjs/config.eta");
const outPath = resolve(root, "src/pkjs/config-html.ts");

const eta = new Eta({ autoEscape: false });
const template = readFileSync(templatePath, "utf8");
const html = eta.renderString(template, {
  themes: [
    { value: "light", label: "Light — white background" },
    { value: "dark", label: "Dark — black background" },
    { value: "auto", label: "Auto — light by day, dark at night" },
  ],
  badges: [
    { name: "date", label: "Date" },
    { name: "weather", label: "Temperature" },
    { name: "steps", label: "Steps" },
    { name: "battery", label: "Battery" },
    { name: "home", label: "Home temperature" },
  ],
});

const banner =
  "// AUTO-GENERATED from src/pkjs/config.eta by tools/render-config.mjs. Do not edit.\n";
writeFileSync(outPath, `${banner}export const CONFIG_HTML = ${JSON.stringify(html)};\n`);
console.log(`rendered config.eta -> src/pkjs/config-html.ts (${html.length} chars)`);
