# Casita Watchface

A Pebble watchface that shows the [Home Assistant](https://www.home-assistant.io/)
"Casita" mascot with a mood that changes across the day, above a large clock.
When the watch loses its Bluetooth link to the phone, Casita switches to a
"disconnected" expression.

It is written in **TypeScript**, rendered with the new Pebble **Alloy / Moddable
JS SDK** (`commodetto/Poco`), and orchestrated with **Bun** via **Mise**. Artwork
ships as **Pebble Draw Command** (`.pdc`) vector images generated from SVG by a
self-contained Python converter.

## Screenshots

| Light theme | Dark theme |
| :---: | :---: |
| ![Casita watchface, light theme](docs/screenshots/casita-light.jpg) | ![Casita watchface, dark theme](docs/screenshots/casita-dark.jpg) |

## Documentation

Full documentation — expressions, settings, the Home Assistant connection,
badges, layout, the build/resource pipeline, and running in the emulator — lives
on the project site:

**→ [wendevlin.github.io/pebble-casita-watchface/documentation.html](https://wendevlin.github.io/pebble-casita-watchface/documentation.html)**

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

