#!/usr/bin/env python3
"""svg2png - Rasterize small SVG icons into anti-aliased RGBA PNGs for Pebble.

The badge icons are drawn at a fixed, small size (20 px). As vector draw
commands (PDC) they lose detail: PDC has no holes (a calendar's blank page or a
thermometer's channel is filled over by a same-coloured command) and tiny
filled paths come out ragged. Rasterizing them offline at exactly the drawn
size gives correct holes and smooth, alpha-blended edges, and the watch just
blits the bitmap.

Standard library only. It reuses svg2pdc's SVG handling (styles, CSS classes,
Bezier/arc flattening and the --normalize palette) and adds:

  * an exact-coverage scanline rasterizer with the SVG non-zero fill rule
    (vertical supersampling, analytic horizontal coverage), and
  * a minimal PNG (RGBA8) writer.

Strokes are not rendered; the icons are fill-only.
"""

import argparse
import math
import os
import struct
import sys
import xml.etree.ElementTree as ET
import zlib

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import svg2pdc  # noqa: E402  (shared SVG parsing)

# Sub-scanlines per output pixel row.
SUPERSAMPLE = 16


# --------------------------------------------------------------------------- #
# Geometry collection
# --------------------------------------------------------------------------- #
def collect_fills(root, classes, normalize, body_rgb):
    """Return [(rgb, [polygon, ...])] in paint order, one entry per element."""
    fills = []

    def color_of(style):
        raw = style.get("fill")
        if raw is None:
            raw = "#000000"  # SVG default fill
        if normalize:
            rgb = svg2pdc.parse_hex_color(raw)
            if rgb is None:
                return None
            return svg2pdc.FEATURE_RGB if rgb == svg2pdc.FEATURE_RGB else body_rgb
        return svg2pdc.parse_hex_color(raw)

    def visit(element):
        tag = element.tag
        if tag.startswith(svg2pdc.XMLNS):
            tag = tag[len(svg2pdc.XMLNS):]
        if tag == "defs":
            return
        if tag in ("g", "svg", "layer"):
            for child in element:
                visit(child)
            return

        style = svg2pdc.element_style(element, classes)
        rgb = color_of(style)
        if rgb is None:
            return

        polys = []
        if tag == "path" and element.get("d"):
            polys = [sp.points for sp in svg2pdc.flatten_path(element.get("d"))]
        elif tag == "circle":
            cx, cy = float(element.get("cx", 0)), float(element.get("cy", 0))
            polys = [svg2pdc.circle_subpath(cx, cy, float(element.get("r", 0))).points]
        elif tag == "rect":
            x, y = float(element.get("x", 0)), float(element.get("y", 0))
            w, h = float(element.get("width", 0)), float(element.get("height", 0))
            rx, ry = element.get("rx"), element.get("ry")
            rx = float(rx) if rx is not None else (float(ry) if ry is not None else 0.0)
            ry = float(ry) if ry is not None else rx
            polys = [svg2pdc.rounded_rect_subpath(x, y, w, h, rx, ry).points]
        elif tag in ("polygon", "polyline"):
            vals = [float(v) for v in element.get("points", "").replace(",", " ").split()]
            polys = [[(vals[k], vals[k + 1]) for k in range(0, len(vals) - 1, 2)]]

        polys = [p for p in polys if len(p) >= 3]
        if polys:
            fills.append((rgb, polys))

    visit(root)
    return fills


# --------------------------------------------------------------------------- #
# Rasterizer
# --------------------------------------------------------------------------- #
def coverage(polys, width, height, scale):
    """Per-pixel coverage (0..1) of `polys` (SVG units) under the non-zero rule."""
    edges = []
    for poly in polys:
        pts = [(x * scale, y * scale) for x, y in poly]
        for k in range(len(pts)):
            (x0, y0), (x1, y1) = pts[k], pts[(k + 1) % len(pts)]
            if y0 == y1:
                continue
            direction = 1 if y1 > y0 else -1
            if y0 > y1:
                x0, y0, x1, y1 = x1, y1, x0, y0
            edges.append((y0, y1, x0, (x1 - x0) / (y1 - y0), direction))

    cov = [0.0] * (width * height)
    weight = 1.0 / SUPERSAMPLE
    for row in range(height):
        for sub in range(SUPERSAMPLE):
            y = row + (sub + 0.5) / SUPERSAMPLE
            hits = sorted((x0 + (y - y0) * slope, d)
                          for y0, y1, x0, slope, d in edges if y0 <= y < y1)
            winding = 0
            for k in range(len(hits) - 1):
                winding += hits[k][1]
                if winding == 0:
                    continue
                left = max(0.0, hits[k][0])
                right = min(float(width), hits[k + 1][0])
                if right <= left:
                    continue
                # Exact horizontal coverage of [left, right) per pixel.
                px = int(left)
                while px < width and px < right:
                    span = min(right, px + 1) - max(left, px)
                    if span > 0:
                        cov[row * width + px] += span * weight
                    px += 1
    return [min(1.0, c) for c in cov]


def render(fills, width, height, scale):
    """Composite the fills (source-over) into a straight-alpha RGBA buffer."""
    rgba = [(0.0, 0.0, 0.0, 0.0)] * (width * height)
    for rgb, polys in fills:
        cov = coverage(polys, width, height, scale)
        sr, sg, sb = (c / 255.0 for c in rgb)
        for i, a in enumerate(cov):
            if a <= 0:
                continue
            dr, dg, db, da = rgba[i]
            out_a = a + da * (1 - a)
            if out_a <= 0:
                continue
            rgba[i] = (
                (sr * a + dr * da * (1 - a)) / out_a,
                (sg * a + dg * da * (1 - a)) / out_a,
                (sb * a + db * da * (1 - a)) / out_a,
                out_a,
            )
    return rgba


# --------------------------------------------------------------------------- #
# PNG writer
# --------------------------------------------------------------------------- #
def png_bytes(rgba, width, height):
    def chunk(kind, data):
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    raw = bytearray()
    for row in range(height):
        raw.append(0)  # filter: none
        for r, g, b, a in rgba[row * width:(row + 1) * width]:
            raw.extend(int(round(v * 255)) for v in (r, g, b, a))
    header = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)  # 8-bit RGBA
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header)
            + chunk(b"IDAT", zlib.compress(bytes(raw), 9)) + chunk(b"IEND", b""))


def convert(path, size, normalize, body_rgb):
    root = ET.parse(path).getroot()
    vw, vh = svg2pdc.get_viewbox_size(root)
    scale = size / max(vw, vh)
    width, height = int(round(vw * scale)), int(round(vh * scale))
    # Flatten curves finely: the rasterizer resolves sub-pixel detail.
    svg2pdc.configure(scale, precise=True)
    fills = collect_fills(root, svg2pdc.parse_stylesheet(root), normalize, body_rgb)
    return png_bytes(render(fills, width, height, scale), width, height), width, height


def main():
    parser = argparse.ArgumentParser(description="Rasterize SVG icons to anti-aliased PNGs.")
    parser.add_argument("inputs", nargs="+", help="SVG source files")
    parser.add_argument("--out", required=True, help="output directory for .png files")
    parser.add_argument("--size", type=int, required=True,
                        help="output size of the larger view-box side, in pixels")
    parser.add_argument("--normalize", action="store_true",
                        help="paint every fill in --body-color (feature white kept)")
    parser.add_argument("--body-color", default="#18bcf2", help="fill used with --normalize")
    parser.add_argument("--name", default=None, help="output file name (single input only)")
    args = parser.parse_args()

    if args.name is not None and len(args.inputs) != 1:
        parser.error("--name requires exactly one input file")
    body_rgb = svg2pdc.parse_hex_color(args.body_color)
    if body_rgb is None:
        parser.error("invalid --body-color: {!r}".format(args.body_color))

    os.makedirs(args.out, exist_ok=True)
    for src in args.inputs:
        data, width, height = convert(src, args.size, args.normalize, body_rgb)
        if args.name is not None:
            name = args.name if args.name.endswith(".png") else args.name + ".png"
        else:
            name = svg2pdc.output_name(src)[:-len(".pdc")] + ".png"
        dest = os.path.join(args.out, name)
        with open(dest, "wb") as handle:
            handle.write(data)
        print("{} -> {} ({}x{}, {} bytes)".format(src, dest, width, height, len(data)))


if __name__ == "__main__":
    main()
