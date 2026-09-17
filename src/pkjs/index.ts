/*
 * Phone-side PebbleKit JS for the Casita watchface.
 *
 * Provides the settings page (light/dark theme + which badges to show) shown
 * from the Pebble app, and fetches the current weather for the temperature
 * badge. Preferences are persisted on the phone and pushed to the watch over
 * AppMessage; the watch also persists them locally so they survive relaunches.
 *
 * Weather comes from Open-Meteo (no API key required); the temperature is sent
 * in tenths of a degree Celsius and the watch decides whether to show °C or °F
 * based on its own measurement-system (units) setting.
 *
 * NOTE: this file is authored in TypeScript and bundled to `src/pkjs/index.js`
 * (the file the Pebble bundler actually ships) by `bun run build:pkjs`. The
 * settings page markup lives in `src/pkjs/config.eta` and is rendered to
 * `config-html.ts` at build time. Do not edit the generated .js by hand.
 */

import { CONFIG_HTML } from "./config-html";
import {
  HA_CLIENT_ID,
  HA_REDIRECT_URI,
  HA_SENSOR_TEMPLATE,
  decodeState,
  normalizeHaUrl,
  parseSensorList,
  sensorsFromStates,
  stateToTenthsC,
  templateRequestBody,
  tokenExchangeBody,
  tokenRefreshBody,
  type HaSensor,
} from "./ha";

// How old a cached phone position may be before a fresh fix is requested;
// matches the watch-driven 30-minute refresh cadence.
const POSITION_MAX_AGE_MS = 30 * 60 * 1000;

interface HaConfig {
  connected: boolean;
  unsaved: boolean;
  url: string;
  sensors: number;
  selected: string;
  list: HaSensor[];
  clientId: string;
  redirectUri: string;
}

interface Config {
  theme: string;
  weather: boolean;
  steps: boolean;
  date: boolean;
  battery: boolean;
  order: string[];
  home: boolean;
  ha: HaConfig;
  view: string;
}

// Badge order (mirrors src/embeddedjs/logic.ts): the order is persisted/sent as
// the compact code string "dwsb" (date/weather/steps/battery). Kept as a tiny
// local copy so the phone bundle stays self-contained (it can't import the
// watch modules).
const BADGE_IDS = ["date", "weather", "steps", "battery", "home"];
const BADGE_CODE: { [id: string]: string } = {
  date: "d",
  weather: "w",
  steps: "s",
  battery: "b",
  home: "h",
};
const BADGE_BY_CODE: { [code: string]: string } = {
  d: "date",
  w: "weather",
  s: "steps",
  b: "battery",
  h: "home",
};

function normalizeBadgeOrder(value: string[] | string | null): string[] {
  let tokens: string[];
  if (value == null) {
    return BADGE_IDS.slice();
  } else if (typeof value === "string") {
    tokens = value.indexOf(",") >= 0 ? value.split(",") : value.split("");
  } else {
    tokens = value.map(function (v) {
      return String(v);
    });
  }
  const order: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const id = BADGE_BY_CODE[token] || token;
    if (BADGE_IDS.indexOf(id) >= 0 && order.indexOf(id) < 0) order.push(id);
  }
  for (let j = 0; j < BADGE_IDS.length; j++) {
    if (order.indexOf(BADGE_IDS[j]) < 0) order.push(BADGE_IDS[j]);
  }
  return order;
}

function badgeOrderToCode(order: string[]): string {
  return order
    .map(function (id) {
      return BADGE_CODE[id];
    })
    .join("");
}

function currentBadgeOrder(): string[] {
  return normalizeBadgeOrder(localStorage.getItem("badgeOrder"));
}

function currentTheme(): string {
  const stored = localStorage.getItem("theme");
  return stored === "light" || stored === "dark" || stored === "auto"
    ? stored
    : "auto";
}

// Mirror of logic.ts themeToCode: 0 = light, 1 = dark, 2 = auto.
function themeCode(theme: string): number {
  if (theme === "auto") return 2;
  return theme === "dark" ? 1 : 0;
}

function boolPref(key: string, fallback: boolean): boolean {
  const v = localStorage.getItem(key);
  if (v === "1") return true;
  if (v === "0") return false;
  return fallback;
}

// --- Home Assistant connection state (persisted in pkjs localStorage) ------
//
// Two layers: the *committed* connection (`haConnected` + tokens/sensors/
// selection) is the saved state that the watch acts on; `haDraftConnected`
// (set after a login) marks a connection the config page shows as connected but
// that hasn't been saved yet. The draft only becomes committed when the user
// taps Save. This makes connect and disconnect behave like the rest of the
// settings — staged in the page, applied on Save.
//
// A completed login persists as a connected *draft* across reopens (with a
// "not saved yet" hint) until the user either Saves it (commit) or Disconnects
// and Saves (clear) — the OAuth login has to close the page to run, so we can't
// throw the login away just because the page reopened.

function cachedSensorList(): HaSensor[] {
  const raw = localStorage.getItem("haSensorsJson");
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (err) {
    return [];
  }
}

function committedConnected(): boolean {
  return localStorage.getItem("haConnected") === "1";
}

function draftConnected(): boolean {
  // A draft connection only counts while we still hold a token to back it.
  if (localStorage.getItem("haDraftConnected") === "1") {
    return !!localStorage.getItem("haAccessToken");
  }
  return committedConnected();
}

function haStatus(): HaConfig {
  const connected = draftConnected();
  const list = cachedSensorList();
  const storedCount = parseInt(localStorage.getItem("haSensorCount") || "", 10);
  return {
    connected: connected,
    // The connection is shown but not yet saved (e.g. a just-completed login).
    unsaved: connected && !committedConnected(),
    url: localStorage.getItem("haUrl") || "",
    sensors: isNaN(storedCount) ? list.length : storedCount,
    selected: localStorage.getItem("haSensorEntity") || "",
    list: list,
    clientId: HA_CLIENT_ID,
    redirectUri: HA_REDIRECT_URI,
  };
}

function clearHaConnection(): void {
  localStorage.removeItem("haConnected");
  localStorage.removeItem("haDraftConnected");
  localStorage.removeItem("haUrl");
  localStorage.removeItem("haAccessToken");
  localStorage.removeItem("haRefreshToken");
  localStorage.removeItem("haExpiresAt");
  localStorage.removeItem("haSensorCount");
  localStorage.removeItem("haSensorsJson");
  localStorage.removeItem("haSensorEntity");
}

/**
 * Builds the settings page URL. The static markup comes from the build-time
 * rendered template; the current preferences are injected by replacing the
 * `__CONFIG__` token with a JSON blob the page's inline script applies.
 *
 * `initialView` selects which of the config page's two views opens first
 * ("main" or "ha"); after an OAuth connect we reopen straight into "ha".
 */
function configPage(
  theme: string,
  showWeather: boolean,
  showSteps: boolean,
  showDate: boolean,
  showBattery: boolean,
  order: string[],
  initialView: string,
): string {
  const config: Config = {
    theme: theme === "light" || theme === "auto" ? theme : "dark",
    weather: showWeather,
    steps: showSteps,
    date: showDate,
    battery: showBattery,
    order: order,
    home: boolPref("showHomeTemp", true),
    ha: haStatus(),
    view: initialView === "ha" ? "ha" : "main",
  };
  const html = CONFIG_HTML.replace("__CONFIG__", JSON.stringify(config));
  return "data:text/html," + encodeURIComponent(html);
}

function openConfig(initialView: string): void {
  Pebble.openURL(
    configPage(
      currentTheme(),
      boolPref("showWeather", true),
      boolPref("showSteps", true),
      boolPref("showDate", true),
      boolPref("showBattery", true),
      currentBadgeOrder(),
      initialView,
    ),
  );
}

function homeBadgeActive(): boolean {
  return (
    committedConnected() &&
    !!localStorage.getItem("haSensorEntity") &&
    boolPref("showHomeTemp", true)
  );
}

// --- Outbound AppMessages: one at a time -----------------------------------
// The watch runtime keeps only the NEWEST unread inbound message: a second push
// that lands before the watch JS has read the first silently replaces it. So
// pushes are queued here and each waits for the previous one's ack/nack (the
// ack is sent by the watch after it has read the message). A safety timer
// unsticks the queue if the phone app never calls either callback.

interface Outbound {
  label: string;
  message: { [key: string]: number | string };
}
const outbox: Outbound[] = [];
let outboxBusy = false;
let outboxWatchdog: ReturnType<typeof setTimeout> | undefined;
const OUTBOX_TIMEOUT_MS = 10000;

function pumpOutbox(): void {
  if (outboxBusy) return;
  const next = outbox.shift();
  if (!next) return;
  outboxBusy = true;
  const done = function () {
    if (outboxWatchdog !== undefined) {
      clearTimeout(outboxWatchdog);
      outboxWatchdog = undefined;
    }
    outboxBusy = false;
    pumpOutbox();
  };
  outboxWatchdog = setTimeout(function () {
    console.log("Casita: no ack for " + next.label + ", continuing");
    outboxWatchdog = undefined;
    done();
  }, OUTBOX_TIMEOUT_MS);
  Pebble.sendAppMessage(
    next.message,
    done,
    function (e) {
      console.log("Casita: failed to send " + next.label + ": " + JSON.stringify(e));
      done();
    }
  );
}

function queueAppMessage(label: string, message: { [key: string]: number | string }): void {
  outbox.push({ label: label, message: message });
  pumpOutbox();
}

function sendSettings(): void {
  queueAppMessage("settings", {
    THEME: themeCode(currentTheme()),
    SHOW_WEATHER: boolPref("showWeather", true) ? 1 : 0,
    SHOW_STEPS: boolPref("showSteps", true) ? 1 : 0,
    SHOW_DATE: boolPref("showDate", true) ? 1 : 0,
    SHOW_BATTERY: boolPref("showBattery", true) ? 1 : 0,
    BADGE_ORDER: badgeOrderToCode(currentBadgeOrder()),
    SHOW_HOME_TEMP: homeBadgeActive() ? 1 : 0,
  });
}

function sendHomeTemp(tenthsC: number): void {
  queueAppMessage("home temp", { HA_TEMP: tenthsC });
}

/**
 * Weather and sun times travel in ONE message: they come from the same
 * Open-Meteo response, and one AppMessage wakes the watch once instead of
 * twice. Either part may be absent (weather badge off / no sun times parsed).
 */
function sendWeather(tenthsC: number | null, sunriseMin: number, sunsetMin: number): void {
  const message: { [key: string]: number } = {};
  if (tenthsC !== null) message.WEATHER_TEMP = tenthsC;
  if (sunriseMin >= 0 && sunsetMin >= 0) {
    message.SUNRISE = sunriseMin;
    message.SUNSET = sunsetMin;
  }
  if (Object.keys(message).length > 0) queueAppMessage("weather", message);
}

// Parses an Open-Meteo local ISO timestamp ("YYYY-MM-DDTHH:MM") into minutes
// since local midnight, or -1 when it can't be parsed.
function isoLocalToMinutes(iso: unknown): number {
  if (typeof iso !== "string") return -1;
  const t = iso.indexOf("T");
  if (t < 0) return -1;
  const parts = iso.substr(t + 1, 5).split(":");
  if (parts.length < 2) return -1;
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  if (isNaN(h) || isNaN(m)) return -1;
  return h * 60 + m;
}

// Fetches the current temperature (for the weather badge) and today's sunrise/
// sunset (for the "auto" theme) from Open-Meteo in one request. Runs whenever
// either the weather badge is on or the auto theme is selected, since both need
// the phone's location. Sun times use timezone=auto so they arrive in local
// clock time, matching the watch's own local time.
function fetchWeather(): void {
  const wantWeather = boolPref("showWeather", true);
  const wantSun = currentTheme() === "auto";
  if (!wantWeather && !wantSun) {
    return;
  }
  navigator.geolocation.getCurrentPosition(
    function (pos) {
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;
      // Remember the fix: in the background the phone often refuses a fresh
      // position, and the last one is plenty accurate for weather.
      localStorage.setItem("lastLat", String(lat));
      localStorage.setItem("lastLon", String(lon));
      fetchWeatherAt(lat, lon, wantWeather);
    },
    function (err) {
      const lat = parseFloat(localStorage.getItem("lastLat") || "");
      const lon = parseFloat(localStorage.getItem("lastLon") || "");
      if (isFinite(lat) && isFinite(lon)) {
        console.log("Casita: geolocation failed, using last position: " + JSON.stringify(err));
        fetchWeatherAt(lat, lon, wantWeather);
      } else {
        console.log("Casita: geolocation error: " + JSON.stringify(err));
      }
    },
    { timeout: 15000, maximumAge: POSITION_MAX_AGE_MS }
  );
}

function fetchWeatherAt(lat: number, lon: number, wantWeather: boolean): void {
  const url =
    "https://api.open-meteo.com/v1/forecast?latitude=" + lat +
    "&longitude=" + lon +
    "&current=temperature_2m&daily=sunrise,sunset&timezone=auto&forecast_days=1";
  const xhr = new XMLHttpRequest();
  xhr.onload = function () {
    try {
      const data = JSON.parse(xhr.responseText);
      let tenths: number | null = null;
      if (wantWeather) {
        const t = data && data.current && data.current.temperature_2m;
        if (typeof t === "number") {
          console.log("Casita: weather " + t + " °C");
          tenths = Math.round(t * 10);
        } else {
          console.log(
            "Casita: no temperature in weather response: " +
              String(xhr.responseText).slice(0, 160),
          );
        }
      }
      const daily = data && data.daily;
      const sunrise = isoLocalToMinutes(daily && daily.sunrise && daily.sunrise[0]);
      const sunset = isoLocalToMinutes(daily && daily.sunset && daily.sunset[0]);
      sendWeather(tenths, sunrise, sunset);
    } catch (err) {
      console.log("Casita: weather parse error: " + err);
    }
  };
  xhr.onerror = function () {
    console.log("Casita: weather request failed");
  };
  xhr.open("GET", url, true);
  xhr.send();
}

// --- Home Assistant home temperature (periodic REST) ------------------------
// The home badge is refreshed on the same 30-minute cadence as the weather:
// one GET of the selected sensor's state, converted to tenths of a degree
// Celsius and sent as HA_TEMP. A live WebSocket feed was dropped on purpose —
// every pushed reading is an AppMessage that wakes the watch, and a room
// temperature does not need that.

function haCurrentEntity(): string {
  return localStorage.getItem("haSensorEntity") || "";
}

/** Fetch the selected HA sensor once and forward it to the watch. */
function refreshHomeTemp(): void {
  if (!homeBadgeActive()) return;
  const url = localStorage.getItem("haUrl") || "";
  const entity = haCurrentEntity();
  if (!url || !entity) return;

  const request = function (token: string | null, retryOn401: boolean) {
    if (!token) return;
    const xhr = new XMLHttpRequest();
    xhr.open("GET", url + "/api/states/" + encodeURIComponent(entity), true);
    xhr.setRequestHeader("Authorization", "Bearer " + token);
    xhr.onload = function () {
      if (xhr.status === 401 && retryOn401) {
        // Token expired between checks: refresh once and retry.
        refreshHaToken(function (fresh) {
          request(fresh, false);
        });
        return;
      }
      try {
        const e = JSON.parse(xhr.responseText);
        const tenths = stateToTenthsC(
          e && e.state != null ? String(e.state) : null,
          e && e.attributes ? e.attributes.unit_of_measurement || null : null,
        );
        if (tenths !== null) {
          console.log("Casita: home temperature " + tenths / 10 + " °C");
          sendHomeTemp(tenths);
        }
      } catch (err) {
        console.log("Casita: HA state parse error: " + err);
      }
    };
    xhr.onerror = function () {
      console.log("Casita: HA state request failed");
    };
    xhr.send();
  };

  // Refresh the token first when it is about to expire (same rule as the
  // sensor-list fetch); otherwise use the stored one and rely on the 401 retry.
  const expiresAt = parseInt(localStorage.getItem("haExpiresAt") || "0", 10);
  if (
    !isNaN(expiresAt) &&
    expiresAt - Date.now() < 60000 &&
    localStorage.getItem("haRefreshToken")
  ) {
    refreshHaToken(function (token) {
      request(token || localStorage.getItem("haAccessToken"), false);
    });
  } else {
    request(localStorage.getItem("haAccessToken"), true);
  }
}

/** Everything the watch cannot fetch itself: weather + sun times + HA reading. */
function refreshAll(): void {
  fetchWeather();
  refreshHomeTemp();
}

// One fetch on launch; from then on the WATCH sets the pace by sending REFRESH
// every 30 minutes (and on reconnect). There is deliberately no phone-side
// timer: it would stall whenever the mobile app is frozen in the background,
// and while the app is awake it would only double the traffic — every extra
// refresh is an AppMessage that wakes the watch.
Pebble.addEventListener("ready", function () {
  sendSettings();
  refreshAll();
});

Pebble.addEventListener("appmessage", function (e) {
  const payload = e && e.payload;
  if (payload && payload.REFRESH !== undefined) {
    console.log("Casita: refresh requested by the watch");
    refreshAll();
  }
});

// --- Home Assistant OAuth (phone-side) -------------------------------------
// The config webview navigates to HA's own login screen; HA redirects through
// our hosted callback page, which hands the auth code back here via the
// webviewclosed handler. We exchange it for tokens, then fetch the available
// temperature sensors (with their friendly name and area, like the HA frontend
// entity picker) so the settings page can prove the connection works and let
// the user pick one for the home temperature badge.

/**
 * Fetch temperature sensors with name + area. Tries POST /api/template (which
 * can resolve areas via `area_name()`); if that fails, falls back to
 * GET /api/states (name only, no area). Calls back with the sensor list.
 */
function fetchSensors(
  haUrl: string,
  accessToken: string,
  cb: (list: HaSensor[]) => void,
): void {
  const fallback = function () {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", haUrl + "/api/states", true);
    xhr.setRequestHeader("Authorization", "Bearer " + accessToken);
    xhr.onload = function () {
      try {
        cb(sensorsFromStates(JSON.parse(xhr.responseText)));
      } catch (err) {
        console.log("Casita: HA states parse error: " + err);
        cb([]);
      }
    };
    xhr.onerror = function () {
      console.log("Casita: HA states request failed");
      cb([]);
    };
    xhr.send();
  };

  const xhr = new XMLHttpRequest();
  xhr.open("POST", haUrl + "/api/template", true);
  xhr.setRequestHeader("Authorization", "Bearer " + accessToken);
  xhr.setRequestHeader("Content-Type", "application/json");
  xhr.onload = function () {
    if (xhr.status < 200 || xhr.status >= 300) {
      console.log(
        "Casita: HA template failed (" +
          xhr.status +
          "), falling back to /api/states",
      );
      fallback();
      return;
    }
    const list = parseSensorList(xhr.responseText);
    cb(list);
  };
  xhr.onerror = function () {
    console.log(
      "Casita: HA template request failed, falling back to /api/states",
    );
    fallback();
  };
  xhr.send(templateRequestBody(HA_SENSOR_TEMPLATE));
}

/** Fetch sensors with a valid token (refreshing first if needed) and cache them. */
function refreshSensorCache(cb?: (list: HaSensor[]) => void): void {
  // Works for both committed connections and unsaved (draft) logins — we just
  // need a token. Nothing to do if we're not connected in either sense.
  if (!draftConnected()) {
    if (cb) cb([]);
    return;
  }
  const haUrl = localStorage.getItem("haUrl") || "";
  const withToken = function (token: string | null) {
    if (!haUrl || !token) {
      if (cb) cb([]);
      return;
    }
    fetchSensors(haUrl, token, function (list) {
      localStorage.setItem("haSensorsJson", JSON.stringify(list));
      localStorage.setItem("haSensorCount", String(list.length));
      if (cb) cb(list);
    });
  };
  const expiresAt = parseInt(localStorage.getItem("haExpiresAt") || "0", 10);
  if (
    !isNaN(expiresAt) &&
    expiresAt - Date.now() < 60000 &&
    localStorage.getItem("haRefreshToken")
  ) {
    refreshHaToken(function (token) {
      withToken(token || localStorage.getItem("haAccessToken"));
    });
  } else {
    withToken(localStorage.getItem("haAccessToken"));
  }
}

function refreshHaToken(cb: (accessToken: string | null) => void): void {
  const haUrl = localStorage.getItem("haUrl") || "";
  const refreshToken = localStorage.getItem("haRefreshToken") || "";
  if (!haUrl || !refreshToken) {
    cb(null);
    return;
  }
  const xhr = new XMLHttpRequest();
  xhr.open("POST", haUrl + "/auth/token", true);
  xhr.setRequestHeader("Content-Type", "application/x-www-form-urlencoded");
  xhr.onload = function () {
    let token;
    try {
      token = JSON.parse(xhr.responseText);
    } catch (err) {
      console.log("Casita: HA refresh parse error: " + err);
      cb(null);
      return;
    }
    if (!token || !token.access_token) {
      cb(null);
      return;
    }
    const expiresAt = Date.now() + (Number(token.expires_in) || 1800) * 1000;
    localStorage.setItem("haAccessToken", token.access_token);
    localStorage.setItem("haExpiresAt", String(expiresAt));
    cb(token.access_token);
  };
  xhr.onerror = function () {
    cb(null);
  };
  xhr.send(tokenRefreshBody(refreshToken, HA_CLIENT_ID));
}

function handleHaCode(code: string, state: string): void {
  let haUrl: string;
  try {
    haUrl = normalizeHaUrl(decodeState(state).haUrl);
  } catch (err) {
    console.log("Casita: bad HA state: " + err);
    return;
  }
  if (!haUrl || !code) {
    console.log("Casita: HA login missing url/code");
    return;
  }
  const xhr = new XMLHttpRequest();
  xhr.open("POST", haUrl + "/auth/token", true);
  xhr.setRequestHeader("Content-Type", "application/x-www-form-urlencoded");
  xhr.onload = function () {
    if (xhr.status < 200 || xhr.status >= 300) {
      console.log(
        "Casita: HA token exchange failed: " +
          xhr.status +
          " " +
          xhr.responseText,
      );
      return;
    }
    let token;
    try {
      token = JSON.parse(xhr.responseText);
    } catch (err) {
      console.log("Casita: HA token parse error: " + err);
      return;
    }
    if (!token || !token.access_token) {
      console.log("Casita: HA token response missing access_token");
      return;
    }
    const expiresAt = Date.now() + (Number(token.expires_in) || 1800) * 1000;
    localStorage.setItem("haUrl", haUrl);
    localStorage.setItem("haAccessToken", token.access_token);
    if (token.refresh_token)
      localStorage.setItem("haRefreshToken", token.refresh_token);
    localStorage.setItem("haExpiresAt", String(expiresAt));
    // A fresh login is only a DRAFT connection: tokens are stored so the sensor
    // picker works, but the connection isn't committed to the watch until the
    // user taps Save. If they close without saving, showConfiguration discards
    // this orphaned login on the next open.
    localStorage.setItem("haDraftConnected", "1");
    // Fetch the sensor list, cache it, then reopen the config straight into the
    // Home Assistant view so the user lands back in settings (now connected and
    // ready to pick a sensor) instead of being left with a closed page.
    fetchSensors(haUrl, token.access_token, function (list) {
      localStorage.setItem("haSensorsJson", JSON.stringify(list));
      localStorage.setItem("haSensorCount", String(list.length));
      console.log("Casita: HA connected, " + list.length + " temp sensors");
      openConfig("ha");
    });
  };
  xhr.onerror = function () {
    console.log("Casita: HA token request failed");
  };
  xhr.send(tokenExchangeBody(code, HA_CLIENT_ID, HA_REDIRECT_URI));
}

Pebble.addEventListener("showConfiguration", function () {
  // Keep the page's draft connection in sync with the committed state. An
  // unsaved login (haDraftConnected set, but not yet committed) is preserved so
  // the user can reopen settings and still reach Save — the OAuth login closed
  // the page to run, so reopening must not throw the login away.
  const unsavedLogin = draftConnected() && !committedConnected();
  if (committedConnected()) {
    localStorage.setItem("haDraftConnected", "1");
  }
  // After a login the OAuth flow forced Settings to close; when the user reopens
  // we drop them straight into the Home Assistant view to finish picking a
  // sensor, since the automatic reopen isn't reliable on-watch.
  openConfig(unsavedLogin ? "ha" : "main");
  // Refresh the cached sensor list in the background so the next time the HA
  // view opens (or the user picks a sensor) the names/areas are up to date.
  refreshSensorCache();
});

// The settings live in TWO isolated JS sandboxes that cannot see each other:
//   1. the config webview (config.eta) - its own browser localStorage; pkjs and
//      the watch cannot read it. Its only way out is navigating to the close URL.
//   2. this pkjs runtime - the close URL fragment arrives here as e.response.
// So this handler is the single point where settings cross over: we persist them
// to *pkjs* localStorage (so we remember them across restarts) and then push them
// to the watch via sendAppMessage - the watch never reads localStorage directly.
Pebble.addEventListener("webviewclosed", function (e) {
  if (!e || !e.response) {
    return;
  }
  let parsed: {
    action?: string;
    code?: string;
    state?: string;
    error?: string;
    haSensor?: string;
    haConnected?: boolean;
  } & Partial<Config>;
  try {
    parsed = JSON.parse(decodeURIComponent(e.response));
  } catch (err) {
    console.log("Casita: bad config response: " + e.response);
    return;
  }

  // The Home Assistant OAuth callback carries an explicit action; the settings
  // Save (including a deferred disconnect) carries none.
  if (parsed.action === "ha_code") {
    if (parsed.error) {
      console.log("Casita: HA login error: " + parsed.error);
      return;
    }
    handleHaCode(parsed.code || "", parsed.state || "");
    return;
  }

  const config = parsed as Config;
  const theme =
    config.theme === "light" || config.theme === "auto" ? config.theme : "dark";
  localStorage.setItem("theme", theme);
  localStorage.setItem("showWeather", config.weather ? "1" : "0");
  localStorage.setItem("showSteps", config.steps ? "1" : "0");
  localStorage.setItem("showDate", config.date ? "1" : "0");
  localStorage.setItem("showBattery", config.battery ? "1" : "0");
  localStorage.setItem(
    "badgeOrder",
    badgeOrderToCode(normalizeBadgeOrder(config.order)),
  );
  localStorage.setItem("showHomeTemp", config.home ? "1" : "0");
  // The HA connection is committed here, on Save, from the page's draft state:
  //   haConnected === false -> the user disconnected (or never connected): clear
  //                            everything.
  //   haConnected === true  -> keep/commit the connection (promoting a fresh,
  //                            still-draft login to the saved state) and persist
  //                            the selected home-temperature sensor.
  if (parsed.haConnected === false) {
    clearHaConnection();
    console.log("Casita: HA disconnected (on save)");
  } else if (
    parsed.haConnected === true &&
    localStorage.getItem("haAccessToken")
  ) {
    localStorage.setItem("haConnected", "1");
    localStorage.setItem("haDraftConnected", "1");
    if (typeof parsed.haSensor === "string") {
      localStorage.setItem("haSensorEntity", parsed.haSensor);
    }
    console.log("Casita: HA connection saved");
  }
  sendSettings();
  // Pull fresh values for whatever was just (re)configured.
  refreshAll();
});
