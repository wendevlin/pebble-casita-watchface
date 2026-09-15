#!/usr/bin/env python3
"""svg2pdc - Convert SVG artwork to Pebble Draw Command Image (PDC) files.

This is a self-contained converter (no third-party dependencies) tailored for
the Casita watchface assets. Compared with Pebble's legacy ``svg2pdc.py`` it
adds two things the source art needs:

  * CSS class resolution - the Casita SVGs style shapes through a ``<style>``
    block and ``class="cls-N"`` attributes rather than inline ``fill``/``stroke``
    attributes.
  * Proper Bezier / arc flattening - cubic, quadratic and elliptical-arc path
    segments are subdivided into line vertices instead of Pebble's legacy
    "start point only" sampling, giving smoother rounded corners.

The emitted binary matches Pebble's PDC image layout exactly:

    Magic  : "PDCI"                       (4 bytes)
    Size   : uint32                       (length of the payload that follows)
    Header : version=1, reserved=0,
             view-box width, height       (<BBhh>)
    List   : uint16 command count, then each command:
             Path   : type=1, reserved, stroke_color, stroke_width, fill_color,
                      open flag, reserved, uint16 point count, int16 x/y points
             Circle : type=2, reserved, stroke_color, stroke_width, fill_color,
                      uint16 radius, uint16 point count (=1), int16 center x/y

Colors are encoded as Pebble ARGB8 (2 bits per channel). With ``--normalize``
every non-feature color is mapped to Home Assistant blue (#18bcf2) and the
facial-feature color (#f2f4f9) is preserved, yielding the requested two-color
Casita palette.
"""

import argparse
import math
import os
import re
import struct
import sys
import xml.etree.ElementTree as ET

XMLNS = "{http://www.w3.org/2000/svg}"

DRAW_COMMAND_VERSION = 1
DRAW_COMMAND_TYPE_PATH = 1
DRAW_COMMAND_TYPE_CIRCLE = 2

# Two-color Casita palette used by --normalize.
FEATURE_RGB = (0xF2, 0xF4, 0xF9)  # eyes / mouth / strokes (#f2f4f9)
BODY_RGB = (0x18, 0xBC, 0xF2)     # house body (#18bcf2, Home Assistant blue)

# Curve flattening: target line length (in SVG user units) per subdivision.
FLATTEN_STEP = 1.25


# --------------------------------------------------------------------------- #
# Color handling
# --------------------------------------------------------------------------- #
def truncate_channel(value):
    """Truncate an 8-bit channel to Pebble's 2-bit palette."""
    return (value >> 6) & 0x03


def rgba_to_argb8(r, g, b, a):
    return (truncate_channel(a) << 6) | (truncate_channel(r) << 4) \
        | (truncate_channel(g) << 2) | truncate_channel(b)


def parse_hex_color(color):
    """Return an (r, g, b) tuple for a #rrggbb / #rgb string, else None."""
    if not color:
        return None
    color = color.strip().lower()
    if color in ("none", "transparent"):
        return None
    if not color.startswith("#"):
        return None
    color = color[1:]
    if len(color) == 3:
        color = "".join(ch * 2 for ch in color)
    if len(color) < 6:
        return None
    return int(color[0:2], 16), int(color[2:4], 16), int(color[4:6], 16)


def resolve_color(color, normalize, body_rgb=BODY_RGB):
    """Convert a CSS color to an ARGB8 byte (0 == clear/none).

    With ``normalize`` every non-feature color collapses to ``body_rgb`` and the
    facial-feature color is preserved, yielding a two-color image.
    """
    rgb = parse_hex_color(color)
    if rgb is None:
        return 0
    if normalize:
        rgb = FEATURE_RGB if rgb == FEATURE_RGB else body_rgb
    return rgba_to_argb8(rgb[0], rgb[1], rgb[2], 255)


# --------------------------------------------------------------------------- #
# CSS class resolution
# --------------------------------------------------------------------------- #
def parse_stylesheet(root):
    """Collect ``.class -> {prop: value}`` rules from all <style> elements."""
    classes = {}
    for style in root.iter(XMLNS + "style"):
        css = style.text or ""
        css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
        for selector, body in re.findall(r"([^{}]+)\{([^{}]*)\}", css):
            props = {}
            for decl in body.split(";"):
                if ":" not in decl:
                    continue
                name, _, value = decl.partition(":")
                props[name.strip()] = value.strip()
            for sel in selector.split(","):
                sel = sel.strip()
                if sel.startswith("."):
                    classes[sel[1:]] = props
    return classes


def element_style(element, classes):
    """Merge stylesheet class rules, presentation attributes and inline style."""
    props = {}
    class_attr = element.get("class")
    if class_attr:
        for name in class_attr.split():
            props.update(classes.get(name, {}))
    for key in ("fill", "stroke", "stroke-width", "opacity",
                "fill-opacity", "stroke-opacity"):
        val = element.get(key)
        if val is not None:
            props[key] = val
    inline = element.get("style")
    if inline:
        for decl in inline.split(";"):
            if ":" in decl:
                name, _, value = decl.partition(":")
                props[name.strip()] = value.strip()
    return props


def parse_stroke_width(value):
    if value is None:
        return 0
    match = re.match(r"[-+]?[0-9]*\.?[0-9]+", value.strip())
    return int(round(float(match.group(0)))) if match else 0


# --------------------------------------------------------------------------- #
# Geometry helpers
# --------------------------------------------------------------------------- #
def flatten_steps(*lengths):
    total = sum(lengths)
    return max(2, int(math.ceil(total / FLATTEN_STEP)))


def cubic_point(p0, p1, p2, p3, t):
    mt = 1 - t
    a = mt * mt * mt
    b = 3 * mt * mt * t
    c = 3 * mt * t * t
    d = t * t * t
    return (a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
            a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1])


def quadratic_point(p0, p1, p2, t):
    mt = 1 - t
    a = mt * mt
    b = 2 * mt * t
    c = t * t
    return (a * p0[0] + b * p1[0] + c * p2[0],
            a * p0[1] + b * p1[1] + c * p2[1])


def distance(a, b):
    return math.hypot(a[0] - b[0], a[1] - b[1])


# --------------------------------------------------------------------------- #
# SVG path parsing with flattening
# --------------------------------------------------------------------------- #
NUMBER_RE = re.compile(r"[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?")
TOKEN_RE = re.compile(r"([MmLlHhVvCcSsQqTtAaZz])|(" + NUMBER_RE.pattern + r")")


def tokenize_path(d):
    tokens = []
    for cmd, num in TOKEN_RE.findall(d):
        if cmd:
            tokens.append(cmd)
        else:
            tokens.append(float(num))
    return tokens


class Subpath:
    __slots__ = ("points", "closed")

    def __init__(self):
        self.points = []
        self.closed = False


def flatten_path(d):
    """Return a list of Subpath objects with flattened line vertices."""
    tokens = tokenize_path(d)
    i = 0
    n = len(tokens)
    subpaths = []
    current = None
    cur = (0.0, 0.0)
    start = (0.0, 0.0)
    prev_cubic_ctrl = None
    prev_quad_ctrl = None
    command = None

    def add(point):
        if not current.points or distance(current.points[-1], point) > 1e-9:
            current.points.append(point)

    while i < n:
        token = tokens[i]
        if isinstance(token, str):
            command = token
            i += 1
        # Implicit command repetition keeps the previous command letter.

        if command in ("M", "m"):
            x, y = tokens[i], tokens[i + 1]
            i += 2
            if command == "m":
                x, y = cur[0] + x, cur[1] + y
            cur = (x, y)
            start = cur
            current = Subpath()
            subpaths.append(current)
            add(cur)
            prev_cubic_ctrl = prev_quad_ctrl = None
            command = "L" if command == "M" else "l"
            continue

        if command in ("L", "l"):
            x, y = tokens[i], tokens[i + 1]
            i += 2
            cur = (cur[0] + x, cur[1] + y) if command == "l" else (x, y)
            add(cur)
            prev_cubic_ctrl = prev_quad_ctrl = None
            continue

        if command in ("H", "h"):
            x = tokens[i]
            i += 1
            cur = (cur[0] + x, cur[1]) if command == "h" else (x, cur[1])
            add(cur)
            prev_cubic_ctrl = prev_quad_ctrl = None
            continue

        if command in ("V", "v"):
            y = tokens[i]
            i += 1
            cur = (cur[0], cur[1] + y) if command == "v" else (cur[0], y)
            add(cur)
            prev_cubic_ctrl = prev_quad_ctrl = None
            continue

        if command in ("C", "c"):
            vals = tokens[i:i + 6]
            i += 6
            if command == "c":
                c1 = (cur[0] + vals[0], cur[1] + vals[1])
                c2 = (cur[0] + vals[2], cur[1] + vals[3])
                end = (cur[0] + vals[4], cur[1] + vals[5])
            else:
                c1 = (vals[0], vals[1])
                c2 = (vals[2], vals[3])
                end = (vals[4], vals[5])
            steps = flatten_steps(distance(cur, c1), distance(c1, c2),
                                  distance(c2, end))
            for s in range(1, steps + 1):
                add(cubic_point(cur, c1, c2, end, s / steps))
            cur = end
            prev_cubic_ctrl = c2
            prev_quad_ctrl = None
            continue

        if command in ("S", "s"):
            vals = tokens[i:i + 4]
            i += 4
            if command == "s":
                c2 = (cur[0] + vals[0], cur[1] + vals[1])
                end = (cur[0] + vals[2], cur[1] + vals[3])
            else:
                c2 = (vals[0], vals[1])
                end = (vals[2], vals[3])
            c1 = (2 * cur[0] - prev_cubic_ctrl[0], 2 * cur[1] - prev_cubic_ctrl[1]) \
                if prev_cubic_ctrl else cur
            steps = flatten_steps(distance(cur, c1), distance(c1, c2),
                                  distance(c2, end))
            for s in range(1, steps + 1):
                add(cubic_point(cur, c1, c2, end, s / steps))
            cur = end
            prev_cubic_ctrl = c2
            prev_quad_ctrl = None
            continue

        if command in ("Q", "q"):
            vals = tokens[i:i + 4]
            i += 4
            if command == "q":
                c1 = (cur[0] + vals[0], cur[1] + vals[1])
                end = (cur[0] + vals[2], cur[1] + vals[3])
            else:
                c1 = (vals[0], vals[1])
                end = (vals[2], vals[3])
            steps = flatten_steps(distance(cur, c1), distance(c1, end))
            for s in range(1, steps + 1):
                add(quadratic_point(cur, c1, end, s / steps))
            cur = end
            prev_quad_ctrl = c1
            prev_cubic_ctrl = None
            continue

        if command in ("T", "t"):
            vals = tokens[i:i + 2]
            i += 2
            end = (cur[0] + vals[0], cur[1] + vals[1]) if command == "t" \
                else (vals[0], vals[1])
            c1 = (2 * cur[0] - prev_quad_ctrl[0], 2 * cur[1] - prev_quad_ctrl[1]) \
                if prev_quad_ctrl else cur
            steps = flatten_steps(distance(cur, c1), distance(c1, end))
            for s in range(1, steps + 1):
                add(quadratic_point(cur, c1, end, s / steps))
            cur = end
            prev_quad_ctrl = c1
            prev_cubic_ctrl = None
            continue

        if command in ("A", "a"):
            vals = tokens[i:i + 7]
            i += 7
            rx, ry, rot, large, sweep, x, y = vals
            end = (cur[0] + x, cur[1] + y) if command == "a" else (x, y)
            for pt in flatten_arc(cur, rx, ry, rot, large, sweep, end):
                add(pt)
            cur = end
            prev_cubic_ctrl = prev_quad_ctrl = None
            continue

        if command in ("Z", "z"):
            if current is not None:
                current.closed = True
            cur = start
            i += 1
            prev_cubic_ctrl = prev_quad_ctrl = None
            continue

        # Unknown token - skip to avoid an infinite loop.
        i += 1

    return subpaths


def flatten_arc(start, rx, ry, rotation, large_arc, sweep, end):
    """Flatten an SVG elliptical arc into line vertices (excluding start)."""
    if rx == 0 or ry == 0 or start == end:
        return [end]
    rx, ry = abs(rx), abs(ry)
    phi = math.radians(rotation)
    cos_phi, sin_phi = math.cos(phi), math.sin(phi)

    dx = (start[0] - end[0]) / 2.0
    dy = (start[1] - end[1]) / 2.0
    x1p = cos_phi * dx + sin_phi * dy
    y1p = -sin_phi * dx + cos_phi * dy

    # Correct out-of-range radii.
    lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry)
    if lam > 1:
        scale = math.sqrt(lam)
        rx *= scale
        ry *= scale

    denom = (rx * rx * y1p * y1p) + (ry * ry * x1p * x1p)
    num = (rx * rx * ry * ry) - (rx * rx * y1p * y1p) - (ry * ry * x1p * x1p)
    coef = math.sqrt(max(0.0, num / denom)) if denom else 0.0
    if large_arc == sweep:
        coef = -coef
    cxp = coef * (rx * y1p) / ry
    cyp = coef * -(ry * x1p) / rx
    cx = cos_phi * cxp - sin_phi * cyp + (start[0] + end[0]) / 2.0
    cy = sin_phi * cxp + cos_phi * cyp + (start[1] + end[1]) / 2.0

    def angle(ux, uy, vx, vy):
        dot = ux * vx + uy * vy
        length = math.hypot(ux, uy) * math.hypot(vx, vy)
        a = math.acos(max(-1.0, min(1.0, dot / length))) if length else 0.0
        if ux * vy - uy * vx < 0:
            a = -a
        return a

    theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry)
    dtheta = angle((x1p - cxp) / rx, (y1p - cyp) / ry,
                   (-x1p - cxp) / rx, (-y1p - cyp) / ry)
    if not sweep and dtheta > 0:
        dtheta -= 2 * math.pi
    elif sweep and dtheta < 0:
        dtheta += 2 * math.pi

    steps = max(2, int(math.ceil(abs(dtheta) / (math.pi / 16))))
    points = []
    for s in range(1, steps + 1):
        t = theta1 + dtheta * (s / steps)
        px = cos_phi * rx * math.cos(t) - sin_phi * ry * math.sin(t) + cx
        py = sin_phi * rx * math.cos(t) + cos_phi * ry * math.sin(t) + cy
        points.append((px, py))
    return points


def rounded_rect_subpath(x, y, w, h, rx, ry):
    """Build a closed, flattened rounded-rectangle subpath."""
    rx = min(rx, w / 2.0)
    ry = min(ry, h / 2.0)
    sp = Subpath()
    sp.closed = True
    if rx <= 0 or ry <= 0:
        sp.points = [(x, y), (x + w, y), (x + w, y + h), (x, y + h)]
        return sp

    def arc(cx, cy, start_ang, end_ang):
        steps = max(2, int(math.ceil(abs(end_ang - start_ang) / (math.pi / 16))))
        for s in range(steps + 1):
            t = start_ang + (end_ang - start_ang) * (s / steps)
            pt = (cx + rx * math.cos(t), cy + ry * math.sin(t))
            if not sp.points or distance(sp.points[-1], pt) > 1e-9:
                sp.points.append(pt)

    # Corners, clockwise starting at the top-left straight edge.
    arc(x + rx, y + ry, math.pi, 1.5 * math.pi)          # top-left
    arc(x + w - rx, y + ry, 1.5 * math.pi, 2 * math.pi)  # top-right
    arc(x + w - rx, y + h - ry, 0, 0.5 * math.pi)        # bottom-right
    arc(x + rx, y + h - ry, 0.5 * math.pi, math.pi)      # bottom-left
    return sp


# --------------------------------------------------------------------------- #
# PDC serialization
# --------------------------------------------------------------------------- #
def to_pebble_point(p):
    """Match Pebble's coordinate convention.

    Pebble shifts each point by -0.5 and then rounds half-up, which nets out to
    ``floor(value + eps)``; the epsilon guards against float dust on exact .5
    inputs.
    """
    return int(math.floor(p[0] + 1e-9)), int(math.floor(p[1] + 1e-9))


def dedupe(points, closed):
    result = []
    for p in points:
        if not result or result[-1] != p:
            result.append(p)
    if closed and len(result) > 1 and result[0] == result[-1]:
        result.pop()
    return result


def serialize_common(stroke_color, stroke_width, fill_color):
    return struct.pack("<BBBB", 0, stroke_color, stroke_width, fill_color)


def serialize_points(points):
    s = struct.pack("<H", len(points))
    for p in points:
        s += struct.pack("<hh", p[0], p[1])
    return s


class PathCommand:
    def __init__(self, points, is_open, stroke_color, stroke_width, fill_color):
        self.points = points
        self.is_open = is_open
        self.stroke_color = stroke_color
        self.stroke_width = stroke_width
        self.fill_color = fill_color

    def serialize(self):
        return (struct.pack("<B", DRAW_COMMAND_TYPE_PATH)
                + serialize_common(self.stroke_color, self.stroke_width, self.fill_color)
                + struct.pack("<BB", 1 if self.is_open else 0, 0)
                + serialize_points(self.points))


class CircleCommand:
    def __init__(self, center, radius, stroke_color, stroke_width, fill_color):
        self.center = center
        self.radius = radius
        self.stroke_color = stroke_color
        self.stroke_width = stroke_width
        self.fill_color = fill_color

    def serialize(self):
        return (struct.pack("<B", DRAW_COMMAND_TYPE_CIRCLE)
                + serialize_common(self.stroke_color, self.stroke_width, self.fill_color)
                + struct.pack("<H", int(round(self.radius)))
                + serialize_points([self.center]))


def build_commands(root, classes, normalize, body_rgb=BODY_RGB):
    commands = []

    def visit(element):
        tag = element.tag
        if tag.startswith(XMLNS):
            tag = tag[len(XMLNS):]

        if tag in ("g", "svg", "layer", "defs"):
            if tag == "defs":
                return
            for child in element:
                visit(child)
            return

        style = element_style(element, classes)
        fill_color = resolve_color(style.get("fill"), normalize, body_rgb)
        stroke_color = resolve_color(style.get("stroke"), normalize, body_rgb)
        stroke_width = parse_stroke_width(style.get("stroke-width"))

        if stroke_color == 0:
            stroke_width = 0
        elif stroke_width == 0:
            stroke_color = 0
        if fill_color == 0 and stroke_color == 0:
            return

        if tag == "path":
            d = element.get("d")
            if not d:
                return
            for sp in flatten_path(d):
                emit_subpath(sp, stroke_color, stroke_width, fill_color)
        elif tag == "circle":
            cx = float(element.get("cx", 0))
            cy = float(element.get("cy", 0))
            r = float(element.get("r", 0))
            center = to_pebble_point((cx, cy))
            commands.append(CircleCommand(center, r, stroke_color, stroke_width, fill_color))
        elif tag == "rect":
            x = float(element.get("x", 0))
            y = float(element.get("y", 0))
            w = float(element.get("width", 0))
            h = float(element.get("height", 0))
            rx = element.get("rx")
            ry = element.get("ry")
            rx = float(rx) if rx is not None else (float(ry) if ry is not None else 0.0)
            ry = float(ry) if ry is not None else rx
            sp = rounded_rect_subpath(x, y, w, h, rx, ry)
            emit_subpath(sp, stroke_color, stroke_width, fill_color)
        elif tag in ("polygon", "polyline"):
            raw = element.get("points", "")
            pts = [float(v) for v in re.split(r"[ ,\s]+", raw.strip()) if v]
            coords = [(pts[k], pts[k + 1]) for k in range(0, len(pts) - 1, 2)]
            sp = Subpath()
            sp.points = coords
            sp.closed = tag == "polygon"
            emit_subpath(sp, stroke_color, stroke_width, fill_color)

    def emit_subpath(sp, stroke_color, stroke_width, fill_color):
        points = dedupe([to_pebble_point(p) for p in sp.points], sp.closed)
        if len(points) < 2:
            return
        is_open = not sp.closed
        commands.append(PathCommand(points, is_open, stroke_color, stroke_width, fill_color))

    visit(root)
    return commands


def get_viewbox_size(root):
    view_box = root.get("viewBox")
    if view_box:
        parts = re.split(r"[ ,]+", view_box.strip())
        return float(parts[2]), float(parts[3])
    return float(root.get("width", 0)), float(root.get("height", 0))


def convert_svg(path, normalize, body_rgb=BODY_RGB):
    tree = ET.parse(path)
    root = tree.getroot()
    classes = parse_stylesheet(root)
    width, height = get_viewbox_size(root)
    commands = build_commands(root, classes, normalize, body_rgb)

    payload = struct.pack("<BBhh", DRAW_COMMAND_VERSION, 0,
                          int(round(width)), int(round(height)))
    payload += struct.pack("<H", len(commands))
    for command in commands:
        payload += command.serialize()

    return b"PDCI" + struct.pack("<I", len(payload)) + payload, len(commands)


def output_name(src):
    base = os.path.splitext(os.path.basename(src))[0]
    return re.sub(r"[^a-z0-9]+", "", base.lower()) + ".pdc"


# Friendly filename overrides so resources match package.json declarations.
NAME_OVERRIDES = {
    "no internet": "disconnected.pdc",
    "nointernet": "disconnected.pdc",
}


def main():
    parser = argparse.ArgumentParser(description="Convert SVG files to Pebble PDC images.")
    parser.add_argument("inputs", nargs="+", help="SVG source files")
    parser.add_argument("--out", required=True, help="output directory for .pdc files")
    parser.add_argument("--normalize", action="store_true",
                        help="normalize colors to the Casita two-color palette")
    parser.add_argument("--body-color", default="#18bcf2",
                        help="body color used with --normalize (default Home "
                             "Assistant blue #18bcf2); facial features stay white")
    parser.add_argument("--name", default=None,
                        help="output filename for the single input (e.g. "
                             "batterylow.pdc); only valid with one input file")
    args = parser.parse_args()

    if args.name is not None and len(args.inputs) != 1:
        parser.error("--name requires exactly one input file")

    body_rgb = parse_hex_color(args.body_color)
    if body_rgb is None:
        parser.error("invalid --body-color: {!r}".format(args.body_color))

    os.makedirs(args.out, exist_ok=True)
    failures = 0
    for src in args.inputs:
        try:
            data, count = convert_svg(src, args.normalize, body_rgb)
        except Exception as exc:  # surface conversion errors as build failures
            print("ERROR converting {}: {}".format(src, exc), file=sys.stderr)
            failures += 1
            continue
        if args.name is not None:
            name = args.name if args.name.endswith(".pdc") else args.name + ".pdc"
        else:
            base = os.path.splitext(os.path.basename(src))[0].lower()
            name = NAME_OVERRIDES.get(base, output_name(src))
        dest = os.path.join(args.out, name)
        with open(dest, "wb") as handle:
            handle.write(data)
        print("{} -> {} ({} commands, {} bytes)".format(src, dest, count, len(data)))

    if failures:
        print("{} file(s) failed to convert".format(failures), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
