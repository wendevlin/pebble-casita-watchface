# Casita Watchface

A Pebble watchface that shows the [Home Assistant](https://www.home-assistant.io/)
"Casita" mascot with a mood that changes across the day, above a large clock.
When the watch loses its Bluetooth link to the phone, Casita switches to a
"disconnected" expression.

It is written in **TypeScript**, rendered with the new Pebble **Alloy / Moddable
JS SDK** (`commodetto/Poco`), and orchestrated with **Bun** via **Mise**. Artwork
ships as **Pebble Draw Command** (`.pdc`) vector images generated from SVG by a
self-contained Python converter.

## Expressions

| Local time    | Expression   | Resource                | Body color            |
| ------------- | ------------ | ----------------------- | --------------------- |
| 06:00 – 11:59 | Normal       | `CASITA_NORMAL`         | blue `#18bcf2`        |
| 12:00 – 14:59 | Happy        | `CASITA_HAPPY`          | blue `#18bcf2`        |
| 15:00 – 20:59 | Grinning     | `CASITA_GRINNING`       | blue `#18bcf2`        |
| 21:00 – 05:59 | Sleeping     | `CASITA_SLEEPING`       | gray `#999999`        |
| any (BT down) | Disconnected | `CASITA_DISCONNECTED`   | orange `#f7931e`      |

"Disconnected" means the watch has no Bluetooth connection to the phone app
(`watch.connected.app`); it overrides the time-of-day expression. The facial
features stay off-white (`#f2f4f9`) in every expression; only the body color
changes.

The clock follows the watch's 12/24-hour preference: 24h uses a leading-zero
hour (`07:05`), 12h drops it (`7:05`, with `12` for midnight/noon).

## Settings

The watchface has a settings page, opened from the **Casita** entry in the
Pebble/Rebble phone app ("Settings"). Options:

- **Appearance — Light / Dark:** sets the background to white (with black clock)
  or black (with white clock). Default is **Dark**.
- **Badges — Date / Temperature / Steps / Battery / Home temperature:**
  individually show or hide the top badges (all default to **on**), and reorder
  them with the ▲ ▼ buttons to set their left-to-right order. The **Home
  temperature** badge only appears once Home Assistant is connected and a sensor
  is chosen (see below). When more badges are enabled than fit on one
  line they wrap onto a second right-aligned line that sits in the empty space
  beside Casita's roof, so Casita keeps its full size.
- **Clock — Show seconds when the light is on:** when enabled (default **off**),
  a small seconds counter appears next to the clock while the backlight is on —
  raise your wrist, double tap, or press the back button to light the screen and
  the seconds appear for as long as the light stays up, then disappear when it
  times out. See [Seconds when lit](#seconds-when-lit) for how this works.

How it works:

- The config UI is a self-contained `data:` HTML page; no external hosting
  needed. Its markup lives in `src/pkjs/config.eta` ([Eta](https://eta.js.org/)
  template) and is rendered to a plain string at build time — Eta runs only at
  build, nothing ships to the phone. The current preferences are injected at
  runtime as a JSON blob (replacing a `__CONFIG__` token) and applied to the
  form by a small inline script. Tapping **Save** hands the choices to the app by
  navigating to `pebblejs://close#<json>`. That navigation is the platform's
  *only* channel back to the watch (there is no live/continuous link), so closing
  the page is what actually applies the settings — hence Save closes the page.
- On save, the phone persists the choices (`localStorage`) and sends them to the
  watch over AppMessage: `THEME` (0 = light, 1 = dark), `SHOW_WEATHER`,
  `SHOW_STEPS`, `SHOW_DATE` and `SHOW_BATTERY` (0 = off, 1 = on), `BADGE_ORDER`
  (the left-to-right badge order as a compact code string, e.g. `dwsb` = date,
  weather, steps, battery), and `SHOW_SECONDS` (0 = off, 1 = on).
- The watch persists every preference in its own `localStorage`, so it renders
  with the right colors and badges immediately on launch, before the phone
  reconnects.

## Home Assistant connection

The settings page can connect to your Home Assistant instance to add a second,
home temperature badge. Home Assistant has its own **dedicated page** inside
settings, reached from a distinct **Connect / Manage Home Assistant** button
(with a status dot) — separate from the main **Save** button.

Setup, in the phone **Settings** page:

- Tap **Connect Home Assistant** to open the Home Assistant page, enter your
  Home Assistant URL, and tap **Log in to Home Assistant**. Home Assistant's own
  login screen opens — you never create or paste a token by hand.
- **Use a remote URL** (e.g. your [Nabu Casa](https://www.nabucasa.com/) address
  or a reverse-proxied `https://` URL) so the watch works everywhere, not just on
  your home Wi‑Fi.
- **Recommended:** create a dedicated Home Assistant user for the watch with
  limited permissions instead of using your admin account.

After you log in, Home Assistant's OAuth screen forces **Settings to close**.
**Reopen Settings** from the Pebble app — it drops you straight back into the
Home Assistant page, now **Connected**, showing the number of available
temperature sensors and a searchable **entity picker** to choose the home
temperature sensor (each sensor's friendly name and area, like the Home
Assistant frontend picker), plus a **Disconnect** button. Pick a sensor, go
back, and Save. When a sensor is selected the page collapses to show just that
sensor (name, area and its **current value**) with a **Remove sensor** button,
and a **Home temperature** badge becomes available in the main badge list —
reorderable and toggleable like the others.

**The Home Assistant page has no Save button of its own** — connect/disconnect
and the chosen sensor are only applied when you tap the main **Settings → Save**,
exactly like every other setting. Tapping **Disconnect** immediately flips the
page to the disconnected (connect) view — with a "will disconnect when you save"
note and a **Keep connected** undo — but nothing is actually cleared until you
save Settings. A fresh login is likewise a *draft*: the connected page shows a
"Not saved yet" hint. Because the OAuth login has to close the settings to run,
that draft **persists across reopens** (the login isn't thrown away just because
the page reopened) until you either **Save** it or
**Disconnect** and Save.

How it works (all phone-side):

- Home Assistant uses IndieAuth-style OAuth2: the `client_id` must be a public
  `https` page whose host matches the `redirect_uri`. A tiny static page hosted
  on GitHub Pages (`docs/index.html` + `docs/callback.html`, served at
  `https://wendevlin.github.io/pebble-casita-watchface/`) fills that role — it
  just receives `?code=&state=` from Home Assistant and bounces it back to the
  app via `pebblejs://close#…`.
- The config webview navigates to `<ha-url>/auth/authorize?…`; after login,
  `callback.html` returns the code to pkjs. pkjs (`src/pkjs/index.ts`) exchanges
  it at `<ha-url>/auth/token` for access/refresh tokens (persisted in
  `localStorage`), then fetches the temperature sensors via
  `POST <ha-url>/api/template` (a Jinja template that resolves each sensor's
  friendly name and area via `area_name()`), falling back to
  `GET <ha-url>/api/states` (name only) if templating is unavailable. The sensor
  list is cached in `localStorage` so the settings page can render the picker
  immediately, and refreshed in the background on open.
- The config page is a small two-view SPA (main settings + the Home Assistant
  page); switching views is client-side, so opening the Home Assistant page does
  **not** close settings. Only **Save** and the **login** redirect navigate to
  `pebblejs://close#…`. Connect/disconnect are staged as an in-page draft and
  sent to pkjs as a `haConnected` boolean in the Save payload; pkjs commits or
  clears the connection accordingly. A completed login is kept as a connected
  draft (tokens persisted) until it is saved or explicitly disconnected.
- The OAuth URL building, state encoding, token bodies, the sensor template,
  sensor-list parsing/search, and the WebSocket message/parse helpers are pure
  functions in `src/pkjs/ha.ts` (unit-tested in `tests/ha.test.ts`). The config
  webview re-implements the tiny base64url/state and search bits inline because
  it runs in its own sandbox and cannot import that module.
- **Live home temperature:** once connected with a sensor selected, pkjs keeps a
  live feed of that sensor. It opens a WebSocket to `<ha-url>/api/websocket`,
  authenticates with the access token, and `subscribe_entities` to the chosen
  entity so each new reading is pushed to the watch as `HA_TEMP` (tenths of a
  degree Celsius, converted from °F when the sensor reports Fahrenheit). If the
  runtime has no `WebSocket`, it falls back to polling `<ha-url>/api/states/<id>`
  every 60 s. The feed is (re)started on launch and whenever the committed
  connection/sensor changes, and stopped on disconnect. Expired tokens are
  refreshed and the socket reconnects automatically.

## Badges

Badges render right-aligned across the top of the face, wrapping onto a second
line when they don't all fit. Only one line's worth of vertical space is
reserved, so Casita keeps its full size: because it's a little house, its
triangular roof leaves the top corners empty and the wrapped line sits in that
space beside the roof peak rather than pushing Casita down. Their left-to-right
order is configurable from the settings page (default: date, temperature, steps,
battery). Each is a rounded pill with an
[MDI](https://pictogrammers.com/library/mdi/) icon and a value:

| Badge       | Icon (MDI)       | Source                              | Format                                        |
| ----------- | ---------------- | ----------------------------------- | --------------------------------------------- |
| Date        | `calendar-blank` | The watch clock                     | Day of month, e.g. `14`                       |
| Temperature | `thermometer`    | Fetched by the phone (Open-Meteo)   | One decimal, no unit letter, e.g. `24,8°`     |
| Steps       | `shoe-print`     | Pebble Health on the watch          | `56` (<100), `0,4K` (100–999), `12K` (≥1000)  |
| Battery     | `battery`        | The watch battery (native FFI)      | Whole percent, e.g. `85%`; icon coloured by level |
| Home temp   | `home-thermometer` | A Home Assistant sensor (phone)   | One decimal, no unit letter, e.g. `21,3°` (deep-orange) |

- **Weather** is fetched by `src/pkjs/index.ts` using the phone's location and
  the keyless [Open-Meteo](https://open-meteo.com/) API (on launch, every 30
  minutes, and whenever settings are saved). The temperature is sent to the
  watch in tenths of a degree Celsius via the `WEATHER_TEMP` key.
- **Units (°C/°F)** are decided on the watch from `Health.displayMeasurementSystem`,
  which mirrors the Pebble app's *units* setting (imperial → °F, otherwise °C).
  The value is converted accordingly; the unit letter itself is not shown (the
  badge displays just the number and a degree sign, e.g. `24,8°`).
- **Steps** are read directly on the watch via `Health.metric.query({ metric: "step count" })`
  (which sums today's total) and refresh every minute. If Health is unavailable
  the badge is hidden.
- **Battery** is the watch's own charge level, read on the watch through the same
  native FFI bridge as the seconds feature (`casita_battery_percent()`, a wrapper
  around `battery_state_service_peek()`); shown as a whole percent, hidden if FFI
  is unavailable. Its icon is colour-coded by level: green at ≥ 70%, orange at
  ≥ 30%, red below 30% (three pre-tinted PDC variants generated from the one
  `battery.svg`).
- **Date** shows the current day of month, read from the watch clock and
  refreshed every minute.
- **Home temperature** shows a Home Assistant sensor's reading, streamed live to
  the watch by the phone over the Home Assistant WebSocket API (see the Home
  Assistant section above) and sent in tenths of a degree Celsius via the
  `HA_TEMP` key. Like the weather badge it is displayed in °C/°F per the watch's
  own units setting, but its icon and value are tinted a distinct **deep-orange**
  so it reads apart from the blue Open-Meteo temperature. The badge only appears
  when Home Assistant is connected, a sensor is chosen, and a reading has been
  received.

The MDI icons are converted to PDC by the `resources` script (see below); the
sources live in `mdi-svgs/` with an accent fill baked in.

**Colors** — background is `#fafafa` (light) / `#181818` (dark); badge pills are
`#ffffff` / `#222222`. Note the color Pebble renders only 2 bits per channel (64
colors, values snap to 0/85/170/255 via a top-2-bits truncation), so the pill
fills collapse into the background (fill == background on this hardware) and the
requested subtle borders (`#e0e0e0` / `#393939`) would truncate to pure
white/black and disappear. The badge is therefore defined by its border, and the
border colors are bumped to the nearest values that actually render as a
distinct gray: `#b0b0b0` (→ 170) on the light background and `#666666` (→ 85) on
the dark background.

## Seconds when lit

With **Show seconds when the light is on** enabled, a small seconds counter is
drawn to the right of the clock (in the badge font, bottom-aligned) while the
backlight is lit, and disappears again when the light times out. Because it
tracks the *real* backlight, every way the screen lights up works uniformly:
the back button, a double tap, and a wrist raise all reveal the seconds.

How it works — reading the real backlight state:

- **The real source is the firmware backlight.** The correct trigger is the
  firmware's `light_is_on()`, which is true for exactly as long as the backlight
  is up regardless of what caused it. An earlier approach that watched the
  accelerometer tap interrupt was abandoned: that interrupt only fires on a
  deliberate sharp knock, so a button press or a gentle wrist raise — the very
  gestures that light the screen — never registered.
- **A tiny native FFI binding exposes firmware syscalls to JS.** The face runs as
  a Moddable *mod*, whose JavaScript cannot call firmware syscalls directly, but
  the C host (`src/c`) can. `src/c/casita_ffi.c` defines `casita_light_on()`
  (a one-line wrapper around `light_is_on()`) and `casita_battery_percent()`
  (wrapping `battery_state_service_peek()`), plus an `fxBuildFFI` that registers
  them as methods. `src/c/mdbl.c` wires that `fxBuildFFI` into the Moddable
  creation record. On the JS side the shared `hw.ts` module does `new FFI()` —
  resolving the firmware-preloaded `ffi` module, whose constructor invokes our
  `fxBuildFFI` — and exposes `lightOn()` (used by `wake.ts`) and
  `batteryPercent()` (used by the battery badge).
- **We poll, because the backlight can't push an event.** The FFI table is a set
  of *synchronous getters*; the firmware cannot deliver an async C→JS event when
  the light turns on or off. So while the setting is enabled, `wake.ts`
  subscribes to `secondchange` and reads `casita_light_on()` once per second.
  The full-face redraw runs only while the light is actually on (to advance the
  digits), plus once on the on→off edge to clear the seconds; the off-state ticks
  are cheap no-op wakes. The subscription is created only while the setting is on
  and torn down when it's off, so it costs nothing when disabled.

> **Note:** `new FFI()` and the native binding are created lazily and wrapped in
> try/catch — if FFI is ever unavailable the feature simply stays inert (no
> seconds) rather than crashing.

## Layout

```
.
├── casita-svgs/            # Source SVG artwork (design assets)
├── mdi-svgs/               # MDI badge icons (accent fill baked in)
├── resources/casita/       # Generated Casita .pdc images (`bun run resources`)
├── resources/icons/        # Generated badge .pdc icons (`bun run resources`)
├── src/
│   ├── c/
│   │   ├── mdbl.c          # Native shim that boots the Moddable machine
│   │   └── casita_ffi.c    # Native FFI glue exposing light_is_on()/battery to JS
│   ├── embeddedjs/
│   │   ├── main.ts         # Entry point: just the runtime event handlers
│   │   ├── constants.ts    # Storage keys, message keys, badge geometry
│   │   ├── gfx.ts          # Shared Poco context, fonts, image caches, palette
│   │   ├── logic.ts        # Pure expression/time/badge logic (unit-tested)
│   │   ├── data/
│   │   │   └── settings.ts # Persisted preferences + health/weather reads
│   │   ├── draw/
│   │   │   ├── casita.ts   # Casita expression selection
│   │   │   ├── badges.ts   # Right-aligned badge rows (date/weather/steps/battery)
│   │   │   └── face.ts     # Full-frame composition
│   │   ├── wake.ts         # Backlight-polling "show seconds when lit"
│   │   ├── hw.ts           # Shared FFI accessor (backlight + battery)
│   │   ├── ffi.d.ts        # Types for the firmware-preloaded `ffi` module
│   │   └── manifest.json   # Moddable module manifest
│   └── pkjs/               # PebbleKit JS (phone side: settings + weather + HA)
│       ├── index.ts        #   entry; bundled to index.js by `bun run build:pkjs`
│       ├── ha.ts           #   pure Home Assistant OAuth helpers (unit-tested)
│       ├── config.eta       #   settings page markup (Eta template)
│       └── pebblekit.d.ts  #   typings for the injected `Pebble` global
├── docs/                   # GitHub Pages OAuth client_id + callback (HA login)
│   ├── index.html          #   OAuth client_id page
│   └── callback.html       #   returns the auth code to the app via pebblejs://close
├── tests/logic.test.ts     # `bun test` unit tests for logic.ts
├── tests/ha.test.ts        # `bun test` unit tests for pkjs/ha.ts
├── tools/svg2pdc.py        # Self-contained SVG -> PDC converter
├── tools/render-config.mjs # Renders config.eta -> config-html.ts at build time
├── types/moddable-pebble.d.ts  # Local typings for standalone typecheck
├── package.json            # Project + Pebble manifest + scripts
├── mise.toml               # Toolchain pinning
└── tsconfig.json           # Standalone typecheck config
```

`src/embeddedjs/main.ts` is intentionally tiny — it only wires runtime events
(AppMessage, minute change, connection change) to a redraw and hands the
show-seconds wake controller (`wake.ts`) its redraw callback. Rendering is split
across `draw/` (Casita, badges, frame composition), shared graphics primitives
live in `gfx.ts`, persisted preferences and health/weather reads in
`data/settings.ts`, and all the branch-y "which face / what string" logic lives
in `logic.ts` so it can be unit-tested off-device.

> **Memory note:** a Pebble mod runs in a small fixed XS heap. `src/c/mdbl.c`
> hand-sizes that heap (via `moddable_createMachine`'s creation record) so the
> modular code fits; the firmware validates the record and simply won't launch
> the app if the request is too large, so it fails safe.

## Prerequisites

- [Mise](https://mise.jdx.dev/) — provisions Bun and TypeScript (see `mise.toml`).
- The **Pebble SDK** (`pebble` tool, SDK 4.33.1) available on your `PATH`, with
  its emulators installed. This is the toolchain that performs the final
  TypeScript → watch compilation and PBW packaging.
- **Python 3** — used by the resource converter (standard library only).

Activate the toolchain once per shell:

```sh
eval "$(mise activate bash)"   # or: mise install && mise use
```

> **TypeScript must stay on `latest` (TS 7 / native preview).** The Moddable
> build requires the `es2025` lib/target, which older TypeScript 5.x releases do
> not support. `mise.toml` pins `"npm:typescript" = "latest"` for this reason —
> do not downgrade it.

## Scripts

All scripts run through Bun (`bun run <name>`):

| Script              | What it does                                                        |
| ------------------- | ------------------------------------------------------------------- |
| `resources`         | Regenerate `resources/casita/*.pdc` from `casita-svgs/*.svg`.        |
| `typecheck`         | `tsc --noEmit` for the watch code (`tsconfig.json`) **and** the phone code (`tsconfig.pkjs.json`). |
| `test`              | `bun test` — unit tests for the pure logic in `logic.ts`.           |
| `render-config`     | Render `src/pkjs/config.eta` (Eta) → `src/pkjs/config-html.ts`.      |
| `build:pkjs`        | `render-config` + bundle `src/pkjs/index.ts` → `src/pkjs/index.js` (Bun). |
| `build`             | `resources` + `build:pkjs` + `pebble build` (compiles TS and packages the PBW). |
| `clean`             | `pebble clean`.                                                     |
| `emulator:emery`    | Install + run on the rectangular **emery** emulator with logs.      |
| `emulator:gabbro`   | Install + run on the round **gabbro** emulator with logs.           |

Typical loop:

```sh
bun run resources     # only needed when the SVGs change
bun run typecheck
bun run test
bun run build
```

## Resource pipeline

`tools/svg2pdc.py` converts each SVG into a Pebble Draw Command image:

- resolves CSS classes and inline styles,
- flattens Bézier curves and arcs into polylines,
- serialises paths and circles into the exact PDC binary format, and
- with `--normalize`, snaps every fill to a two-color palette — the off-white
  face features (`#f2f4f9`) stay white and everything else (body plus accents
  such as the sleeping "Z" and the no-internet Wi-Fi glyph) becomes the
  `--body-color` (default Home Assistant blue `#18bcf2`).

Because the body color is baked into each PDC, the `resources` script runs the
converter multiple times so each expression gets the right color, then converts
the badge icons:

- Normal / Happy / Grinning → blue `#18bcf2` (default)
- Disconnected → `--body-color '#f7931e'` (orange)
- Sleeping → `--body-color '#999999'` (gray)
- Badge icons (`mdi-svgs/*.svg`) → `resources/icons/*.pdc` (accent fill baked in)

The faces and badge icons are declared as `raw` media in `package.json`;
`pebble build` assigns them numeric resource IDs in declaration order (1 = Normal
… 5 = Disconnected, 6 = thermometer, 7 = shoe-print). `logic.ts`'s `Casita` and
`Icon` enums mirror those IDs, and `main.ts` draws them with
`new Poco.PebbleDrawCommandImage(id)` + `render.drawDCI(...)` (icons are
`clone()`d and `scale()`d down to badge size).

To add or swap a face, edit the `resources` script's SVG list and the
`package.json` media array together (keeping order/IDs in sync), then
`bun run resources && bun run build`.

## Running in the emulator

```sh
eval "$(mise activate bash)"
bun run build
pebble install --emulator emery      # or: bun run emulator:emery
pebble screenshot
```

Exercise the light/dark theme by sending the `THEME` AppMessage directly (the
`THEME` key compiles to code `10000`):

```sh
pebble send-app-message --int 10000=0    # -> Light (white background)
pebble send-app-message --int 10000=1    # -> Dark  (black background)
```

The disconnected (orange) expression triggers when the phone app connection
drops:

```sh
pebble emu-bt-connection --connected no    # -> Disconnected face
pebble emu-bt-connection --connected yes    # -> time-of-day face
```

> **Emulator caveat for the disconnected state.** While the phone-side JS
> (`pypkjs`) is attached, `watch.connected.app` stays `true` over the QEMU link,
> so `emu-bt-connection` may not flip to the disconnected face in the emulator
> even though it works on a real watch (where dropping Bluetooth drops both). To
> smoke-test the orange rendering itself, temporarily force
> `Casita.Disconnected` in `main.ts` and rebuild.

> **Boot a fresh emulator when reinstalling.** Reinstalling onto an
> already-running (or stale) emulator can show *"Status: Watchface is not
> responding"* — this reproduces on the stock SDK template too, so it is an
> emulator quirk, not a watchface bug. Kill the running emulator
> (`pebble kill`) and install again to get a clean boot.

## License / assets

The source code of this project — the watchface implementation (`src/`), the
SVG→PDC tooling (`tools/`), tests, and documentation — is released under the
[MIT License](./LICENSE).

The bundled third-party artwork is **not** covered by MIT:

- **Casita artwork** (`casita-svgs/` → `resources/casita/`) is a trademark of the
  Open Home Foundation, from the [Home Assistant assets](https://github.com/home-assistant/assets).
  It is included here for personal, non-commercial community use under the
  [Home Assistant brand guidelines](https://design.home-assistant.io/#brand/logo);
  it is not relicensed and may not be used commercially or modified outside those
  guidelines.
- **Badge icons** (`mdi-svgs/` → `resources/icons/`) are from
  [Material Design Icons](https://pictogrammers.com/library/mdi/), licensed under
  the Apache License 2.0.

See the [LICENSE](./LICENSE) file for the full text.

