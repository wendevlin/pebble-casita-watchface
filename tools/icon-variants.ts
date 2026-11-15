/*
 * Badge icon sizes and per-platform resource variants, shared by the resource
 * build (tools/build-resources.ts) and its test (tests/resources.test.ts).
 *
 * `pebble build` picks, per platform, the most specific tagged sibling of the
 * file named in package.json (e.g. icons/thermometer~bw.png on diorite):
 *
 *    (no tag)      emery, gabbro     large colour icons
 *    ~color~144w   basalt            small colour icons
 *    ~180w         chalk             small colour icons
 *    ~bw           diorite, flint    small 1-bit icons
 */

// Must match ICON_SIZE_LARGE / ICON_SIZE_SMALL in src/c/main.c.
export const ICON_SIZE_LARGE = 20;
export const ICON_SIZE_SMALL = 14;

export interface IconVariant {
  /** Resource file tag ("" = untagged default). */
  tag: string;
  size: number;
  /** 1-bit output for the black-and-white watches. */
  bw: boolean;
}

export const ICON_VARIANTS: IconVariant[] = [
  { tag: "", size: ICON_SIZE_LARGE, bw: false },
  { tag: "~color~144w", size: ICON_SIZE_SMALL, bw: false },
  { tag: "~180w", size: ICON_SIZE_SMALL, bw: false },
  { tag: "~bw", size: ICON_SIZE_SMALL, bw: true },
];

/** Casita PDC variants: colour by default, black house on black-and-white. */
export const CASITA_TAGS = ["", "~bw"];
