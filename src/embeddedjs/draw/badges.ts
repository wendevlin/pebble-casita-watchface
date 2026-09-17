/*
 * The Home Assistant–style badge rows: pills along the top of the face, each
 * showing a small icon + short text (date, weather, steps, battery, home).
 */

import { render, badgeFont, iconImage, isRound, DCImage, Palette } from "gfx";
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
  layoutBadges,
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

/** Builds the visible badges, in priority order, from settings + live data. */
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

/**
 * Draws the badge rows along the top of `area` and returns the vertical band
 * height the caller should reserve for Casita (0 when no badges are visible).
 *
 * Row planning is the pure `layoutBadges` in logic.ts (unit-tested): every row
 * fills from right to left in the user's priority order. On rectangular
 * displays the first row hugs the right edge and takes up to three badges; the
 * rest go to a second row pinned to the two corners. On round displays the
 * stack is 1 + 2 + 2: one badge centred in the narrow top row, two centred
 * below it, and the rest on a third row pinned to the circle's edge.
 *
 * Only the stacked rows' height is reserved (one on rect, two on round):
 * Casita is a little house, so its triangular roof leaves empty space in the
 * top corners and the corner-pinned last row sits in that space, with the roof
 * peak rising between the two badges, rather than pushing Casita down or
 * shrinking it. The exceptions reserve the full stack height
 * instead, shrinking Casita below the rows so nothing overlaps: expressions
 * whose art fills the top corners (the sleeping "Zzz" and the disconnected
 * no-internet glyph).
 */
export function drawBadges(area: Rect, palette: Palette, now: Date, casitaId: Casita): number {
  const badges = buildBadges(now);
  if (badges.length === 0) return 0;

  const widths = badges.map(pillWidth);
  const layout = layoutBadges(widths, {
    areaWidth: area.width,
    round: isRound,
    margin: MARGIN,
    gap: BADGE_GAP,
    pillHeight: PILL_H,
  });

  const font = badgeFont;
  for (const p of layout.placements) {
    const y = area.y + MARGIN + p.row * (PILL_H + BADGE_GAP);
    const iconY = y + ((PILL_H - ICON_SIZE) >> 1);
    const textY = y + ((PILL_H - font.height) >> 1) - BADGE_TEXT_NUDGE;
    drawPill(area.x + p.x, y, widths[p.index], badges[p.index], palette, iconY, textY);
  }

  // Rows that push Casita down: the first on rect, the first two on round. Any
  // further row is corner-pinned and overlays the empty space beside the roof
  // peak — unless the expression fills those corners, then reserve everything.
  const stacked = isRound ? 2 : 1;
  const reserved = expressionFillsTopCorners(casitaId) || layout.rows < stacked ? layout.rows : stacked;
  return MARGIN * 2 + reserved * PILL_H + (reserved - 1) * BADGE_GAP;
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
