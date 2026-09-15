/*
 * Full-frame composition: draws one complete watchface frame — background, the
 * badge row, the centered Casita expression, and the bottom clock.
 */

import { render, timeFont, badgeFont, paletteFor, casitaImageFitting } from "gfx";
import { CLOCK_MARGIN_BOTTOM, CASITA_MIN_TOP_GAP, SECONDS_GAP } from "constants";
import { formatTime, formatSeconds } from "logic";
import { settings } from "data/settings";
import { currentCasitaId } from "draw/casita";
import { drawBadges } from "draw/badges";
import { secondsVisible } from "wake";

/** Renders one full frame of the watchface. */
export function draw(): void {
  const now = new Date();
  const font = timeFont;
  const palette = paletteFor(settings.theme);
  const casitaId = currentCasitaId(now);

  // Respect the round display's safe area; on rectangular displays this is the
  // full screen.
  const area = render.unobstructed;

  render.begin();
  render.fillRectangle(palette.background, 0, 0, render.width, render.height);

  const band = drawBadges(area, palette, now);

  const timeText = formatTime(now, watch.hour12);
  const textWidth = render.getTextWidth(timeText, font);
  const textHeight = font.height;

  // Seconds are drawn in the smaller badge font, sitting to the right of the
  // clock and bottom-aligned with it, while the wake window is active.
  const showSecs = secondsVisible();
  const secText = showSecs ? formatSeconds(now) : "";
  const secGap = showSecs ? SECONDS_GAP : 0;

  // Keep the clock centered on its own width so it never shifts when seconds
  // appear; the seconds sit to the right of the (still-centered) clock.
  const textX = area.x + (((area.width - textWidth) / 2) | 0);
  const textY = (area.y + area.height - textHeight - CLOCK_MARGIN_BOTTOM) | 0;

  // Fit Casita into the space between the badge band and the clock, leaving a
  // small gap above and below. When the timeline quick view shrinks the screen
  // this space collapses, so Casita is scaled down rather than overflowing into
  // (or being clamped over) the clock.
  const spaceTop = area.y + band;
  const availableH = textY - spaceTop;
  const maxCasitaH = availableH - CASITA_MIN_TOP_GAP * 2;
  const casita = casitaImageFitting(casitaId, maxCasitaH);
  const casitaX = area.x + (((area.width - casita.width) / 2) | 0);
  let casitaY = (spaceTop + ((availableH - casita.height) >> 1)) | 0;
  if (casitaY < spaceTop + CASITA_MIN_TOP_GAP) casitaY = spaceTop + CASITA_MIN_TOP_GAP;

  render.drawDCI(casita.image, casitaX, casitaY);
  render.drawText(timeText, font, palette.foreground, textX, textY);
  if (showSecs) {
    const secY = (textY + textHeight - badgeFont.height) | 0;
    render.drawText(secText, badgeFont, palette.foreground, textX + textWidth + secGap, secY);
  }
  render.end();
}
