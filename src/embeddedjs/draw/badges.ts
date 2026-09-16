/*
 * The Home Assistant–style badge row: a right-aligned strip of pills along the
 * top of the face, each showing a small icon + short text (date, weather, steps).
 */

import { render, badgeFont, iconImage, DCImage, Palette } from "gfx";
import {
  ICON_SIZE,
  PILL_PAD_X,
  ICON_GAP,
  BADGE_GAP,
  MARGIN,
  BORDER_W,
  PILL_H,
  PILL_RADIUS,
  BADGE_TEXT_NUDGE,
} from "constants";
import {
  Icon,
  Casita,
  batteryIcon,
  formatBattery,
  formatDate,
  formatSteps,
  formatTemperature,
  tempUnitForSystem,
  expressionFillsTopCorners,
  WEATHER_UNKNOWN,
} from "logic";
import { settings, readBattery, readSteps, measurementSystem } from "data/settings";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Badge {
  icon: DCImage;
  text: string;
}

/** Builds the visible badges (left→right) from settings + live data. */
function buildBadges(now: Date): Badge[] {
  const badges: Badge[] = [];
  for (const id of settings.badgeOrder) {
    if (id === "date") {
      if (settings.showDate) {
        badges.push({ icon: iconImage(Icon.CalendarBlank), text: formatDate(now) });
      }
    } else if (id === "weather") {
      if (settings.showWeather) {
        const unit = tempUnitForSystem(measurementSystem());
        badges.push({
          icon: iconImage(Icon.Thermometer),
          text: formatTemperature(settings.weatherTemp, unit),
        });
      }
    } else if (id === "steps") {
      if (settings.showSteps) {
        const steps = readSteps();
        if (steps !== null) {
          badges.push({ icon: iconImage(Icon.ShoePrint), text: formatSteps(steps) });
        }
      }
    } else if (id === "battery") {
      if (settings.showBattery) {
        const percent = readBattery();
        if (percent !== null) {
          badges.push({ icon: iconImage(batteryIcon(percent)), text: formatBattery(percent) });
        }
      }
    } else if (id === "home") {
      // Home Assistant sensor temperature. Only shown once the phone has pushed
      // a reading (homeTemp leaves the WEATHER_UNKNOWN sentinel) and the badge
      // is enabled; coloured distinctly from the default weather thermometer.
      if (settings.showHomeTemp && settings.homeTemp !== WEATHER_UNKNOWN) {
        const unit = tempUnitForSystem(measurementSystem());
        badges.push({
          icon: iconImage(Icon.HomeThermometer),
          text: formatTemperature(settings.homeTemp, unit),
        });
      }
    }
  }
  return badges;
}

function pillWidth(badge: Badge): number {
  return PILL_PAD_X + ICON_SIZE + ICON_GAP + render.getTextWidth(badge.text, badgeFont) + PILL_PAD_X;
}

/** Total drawn width of badges [start, end): pill widths plus inter-pill gaps. */
function lineWidth(widths: number[], start: number, end: number): number {
  let total = 0;
  for (let i = start; i < end; i++) {
    total += widths[i] + (i > start ? BADGE_GAP : 0);
  }
  return total;
}

/**
 * Draws the badge row(s) right-aligned along the top of `area` and returns the
 * vertical band height the caller should reserve for Casita (0 when no badges
 * are visible).
 *
 * Badges are laid out left→right on a single right-aligned line when they fit.
 * When they don't, they split into exactly two balanced rows (the first row
 * keeps the extra badge when the count is odd, so 5 badges become 3 + 2) rather
 * than greedily wrapping into three-plus rows. A too-wide first row is allowed
 * to overflow the left edge instead of spilling onto another line. When the
 * second row holds exactly two badges they are split to the left and right
 * corners (rather than kept together) so Casita's central roof peak fits in the
 * gap between them instead of being overlapped.
 *
 * Only a SINGLE line's height is reserved even when the badges wrap: Casita is a
 * little house, so its triangular roof leaves empty space in the top corners.
 * The wrapped line(s) are right-aligned into that negative space beside the roof
 * peak, so they don't need to push Casita down or shrink it — returning just one
 * line keeps Casita full-size regardless of how many badge rows are shown.
 *
 * The exception is expressions whose art fills the top corners (the sleeping
 * "Zzz" and the disconnected no-internet glyph): there the corners aren't empty,
 * so when the badges wrap the full badge-stack height is reserved instead,
 * shrinking Casita below the rows so nothing overlaps.
 */
export function drawBadges(area: Rect, palette: Palette, now: Date, casitaId: Casita): number {
  const badges = buildBadges(now);
  if (badges.length === 0) return 0;

  const widths = badges.map(pillWidth);
  const avail = area.width - MARGIN * 2;

  // Lay the badges out on a single right-aligned row when they fit. When they
  // don't, split them into exactly two balanced rows (the first row keeps the
  // extra badge when the count is odd, e.g. 5 -> 3 + 2) instead of greedily
  // wrapping. Greedy width-packing let one wide badge (a 4-char step count like
  // "0,5K") bump a trailing badge onto a third line, giving an unwanted 2/2/1
  // split; a fixed split keeps it at 3/2. The first row may then be wider than
  // the available width and overflow the left edge — that is accepted.
  const lines: { start: number; end: number; total: number }[] = [];
  const singleTotal = lineWidth(widths, 0, badges.length);
  if (singleTotal <= avail || badges.length < 2) {
    lines.push({ start: 0, end: badges.length, total: singleTotal });
  } else {
    const split = (badges.length + 1) >> 1; // ceil(n / 2): first row gets the extra
    lines.push({ start: 0, end: split, total: lineWidth(widths, 0, split) });
    lines.push({ start: split, end: badges.length, total: lineWidth(widths, split, badges.length) });
  }

  const font = badgeFont;
  let y = area.y + MARGIN;
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const iconY = y + ((PILL_H - ICON_SIZE) >> 1);
    const textY = y + ((PILL_H - font.height) >> 1) - BADGE_TEXT_NUDGE;
    if (li > 0 && line.end - line.start === 2) {
      // A wrapped (second) row with exactly two badges straddles Casita's
      // central roof peak: pin one badge to the left corner and the other to
      // the right corner so neither sits over the peak in the middle.
      drawPill(area.x + MARGIN, y, widths[line.start], badges[line.start], palette, iconY, textY);
      const rightW = widths[line.end - 1];
      const rightX = area.x + area.width - MARGIN - rightW;
      drawPill(rightX, y, rightW, badges[line.end - 1], palette, iconY, textY);
    } else {
      let x = area.x + area.width - MARGIN - line.total;
      for (let i = line.start; i < line.end; i++) {
        drawPill(x, y, widths[i], badges[i], palette, iconY, textY);
        x += widths[i] + BADGE_GAP;
      }
    }
    y += PILL_H + BADGE_GAP;
  }

  // Reserve only one line so wrapped rows overlay the empty roof corners rather
  // than compressing Casita (see the note above). Expressions that fill the top
  // corners have no empty space there, so once the badges wrap reserve the full
  // stack height, shrinking Casita below the rows instead of letting them overlap.
  if (lines.length > 1 && expressionFillsTopCorners(casitaId)) {
    return MARGIN * 2 + lines.length * PILL_H + (lines.length - 1) * BADGE_GAP;
  }
  return MARGIN * 2 + PILL_H;
}

function drawPill(
  x: number,
  y: number,
  width: number,
  badge: Badge,
  palette: Palette,
  iconY: number,
  textY: number,
): void {
  // Draw the border as a filled pill in the border colour, then a slightly
  // smaller filled pill in the fill colour on top. This gives an exact
  // BORDER_W-thick outline that stays inside the rect (frameRoundRect strokes
  // ~7px and bleeds outward, merging adjacent badges).
  render.drawRoundRect(x, y, width, PILL_H, palette.border, PILL_RADIUS, 15);
  render.drawRoundRect(
    x + BORDER_W,
    y + BORDER_W,
    width - BORDER_W * 2,
    PILL_H - BORDER_W * 2,
    palette.pill,
    PILL_RADIUS - BORDER_W,
    15,
  );
  render.drawDCI(badge.icon, x + PILL_PAD_X, iconY);
  render.drawText(badge.text, badgeFont, palette.pillText, x + PILL_PAD_X + ICON_SIZE + ICON_GAP, textY);
}
