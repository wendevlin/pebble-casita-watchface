/*
 * Graphics primitives shared across the drawing code: the single Poco render
 * context bound to the watch screen, the fonts, the cached draw-command images
 * (Casita faces + badge icons), and the theme palette. Centralising these keeps
 * one Poco instance and pays the image-decode cost only once per resource.
 *
 * Everything is created eagerly at module load. The watchface runs as a Moddable
 * "mod" in a very small (~32 KB) XS heap, so the code deliberately avoids extra
 * lazy-init wrappers/closures that would only waste scarce slots.
 */

import Poco from "commodetto/Poco";
import { ICON_SIZE } from "constants";
import { Casita, Icon, ResolvedTheme } from "logic";

export type DCImage = InstanceType<typeof Poco.PebbleDrawCommandImage>;

// The one render context for the whole watchface, bound to the host `screen`.
export const render = new Poco(screen);

export const timeFont = new render.Font("Bitham-Bold", 42);
export const badgeFont = new render.Font("Gothic-Bold", 18);

// Decode each PDC once and reuse it on every redraw.
const casitaCache: Record<number, DCImage> = {};
const iconCache: Record<number, DCImage> = {};

/** Returns the (cached) full-size Casita expression image for a resource id. */
export function casitaImage(id: Casita): DCImage {
  let image = casitaCache[id];
  if (!image) {
    image = new Poco.PebbleDrawCommandImage(id);
    casitaCache[id] = image;
  }
  return image;
}

export interface SizedImage {
  image: DCImage;
  width: number;
  height: number;
}

// Single-slot cache for a down-scaled Casita. The timeline quick view shrinks
// the unobstructed area, so the fixed-size Casita must scale to fit; only one
// reduced size is ever needed at a time, so we keep just one clone to spare the
// tiny XS heap.
let scaledCasita: { id: number; height: number; image: DCImage } | undefined;

/**
 * Returns a Casita image constrained to fit within `maxHeight` (aspect
 * preserved). When the native image already fits it is returned unscaled;
 * otherwise a down-scaled clone is produced and cached. The returned width /
 * height are the drawn dimensions, so callers can position it precisely.
 */
export function casitaImageFitting(id: Casita, maxHeight: number): SizedImage {
  const full = casitaImage(id);
  if (maxHeight <= 0 || full.height <= maxHeight) {
    return { image: full, width: full.width, height: full.height };
  }
  const h = maxHeight | 0;
  const scale = maxHeight / full.height;
  if (!scaledCasita || scaledCasita.id !== id || scaledCasita.height !== h) {
    // clone() yields a scalable draw-command list; the runtime image isn't.
    const clone = full.clone();
    clone.scale(scale);
    // scale() only transforms point coordinates, so stroke widths keep their
    // authored size and look disproportionately thick once shrunk. Scale each
    // command's stroke to match (keeping any visible stroke at least 1px).
    clone.process((command) => {
      const w = command.strokeWidth;
      if (w > 0) {
        const scaled = (w * scale) | 0;
        command.strokeWidth = scaled < 1 ? 1 : scaled;
      }
    });
    scaledCasita = { id, height: h, image: clone };
  }
  return { image: scaledCasita.image, width: (full.width * scale) | 0, height: h };
}

/** Returns the (cached) badge icon image, scaled down once to badge size. */
export function iconImage(id: Icon): DCImage {
  let image = iconCache[id];
  if (!image) {
    // The runtime PebbleDrawCommandImage isn't scalable directly; clone() yields
    // a draw-command list that is. The MDI icons are authored at 24px, so scale
    // them down once to badge size.
    const source = new Poco.PebbleDrawCommandImage(id);
    image = source.clone();
    image.scale(ICON_SIZE / source.width, ICON_SIZE / source.height);
    iconCache[id] = image;
  }
  return image;
}

/*
 * Theme palette. Resolves the light/dark setting into the concrete colours used
 * across the face.
 *
 * Note: the watch keeps only the top 2 bits per channel (values snap to
 * 0/85/170/255). Very light/dark near-neutrals therefore collapse to pure
 * white/black — see the border values below, chosen to stay a distinct gray.
 */
export interface Palette {
  /** Screen background. */
  background: number;
  /** Clock text colour. */
  foreground: number;
  /** Badge pill fill. */
  pill: number;
  /** Badge pill border. */
  border: number;
  /** Badge text colour. */
  pillText: number;
}

const BLACK = render.makeColor(0, 0, 0);
const WHITE = render.makeColor(0xff, 0xff, 0xff);

const LIGHT: Palette = {
  background: render.makeColor(0xfa, 0xfa, 0xfa),
  foreground: BLACK,
  pill: render.makeColor(0xff, 0xff, 0xff),
  // Nearest value that renders as a distinct gray on the light background (~170).
  border: render.makeColor(0xb0, 0xb0, 0xb0),
  pillText: BLACK,
};

const DARK: Palette = {
  background: render.makeColor(0x18, 0x18, 0x18),
  foreground: WHITE,
  pill: render.makeColor(0x22, 0x22, 0x22),
  // Nearest value that renders as a distinct gray on the dark background (~85).
  border: render.makeColor(0x66, 0x66, 0x66),
  pillText: WHITE,
};

export function paletteFor(theme: ResolvedTheme): Palette {
  return theme === "dark" ? DARK : LIGHT;
}
