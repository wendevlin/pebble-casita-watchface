/*
 * Pure helpers for the Home Assistant OAuth flow (phone-side).
 *
 * Home Assistant uses IndieAuth-style OAuth2: the `client_id` must be a public
 * https page we control and the `redirect_uri` must share that host. We host a
 * tiny static page on GitHub Pages that acts as both and bounces the auth code
 * back into the watch app via `pebblejs://close#...`.
 *
 * These functions are intentionally pure (no XHR / no globals beyond
 * encode/decodeURIComponent) so they can be unit-tested (tests/ha.test.ts) and
 * shared by src/pkjs/index.ts. The config webview (config.eta) lives in a
 * separate sandbox and re-implements the tiny authorize-URL/state bits inline;
 * keep the base64url + state format here in sync with that copy.
 */

// GitHub Pages: https://wendevlin.github.io/pebble-casita-watchface/
export const HA_CLIENT_ID = "https://wendevlin.github.io/pebble-casita-watchface/";
export const HA_REDIRECT_URI =
  "https://wendevlin.github.io/pebble-casita-watchface/callback.html";

/**
 * Normalize a user-entered Home Assistant URL: trim, default to https://, and
 * strip any trailing slashes so we can append `/auth/authorize` etc. cleanly.
 * Returns "" for empty input.
 */
export function normalizeHaUrl(input: string): string {
  let url = (input || "").trim();
  if (url === "") return "";
  if (!/^https?:\/\//i.test(url)) {
    url = "https://" + url;
  }
  url = url.replace(/\/+$/, "");
  return url;
}

// --- base64url over UTF-8 bytes ------------------------------------------
// encodeURIComponent gives us a portable UTF-8 byte source that exists in both
// the pkjs runtime and the config webview, so both sides produce identical
// output without depending on btoa/TextEncoder.

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function utf8Bytes(str: string): number[] {
  const enc = encodeURIComponent(str);
  const bytes: number[] = [];
  for (let i = 0; i < enc.length; i++) {
    if (enc.charAt(i) === "%") {
      bytes.push(parseInt(enc.substr(i + 1, 2), 16));
      i += 2;
    } else {
      bytes.push(enc.charCodeAt(i));
    }
  }
  return bytes;
}

function bytesToUtf8(bytes: number[]): string {
  let enc = "";
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    enc += b < 16 ? "%0" + b.toString(16) : "%" + b.toString(16);
  }
  return decodeURIComponent(enc);
}

export function base64UrlEncode(str: string): string {
  const bytes = utf8Bytes(str);
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64.charAt(b0 >> 2);
    out += B64.charAt(((b0 & 3) << 4) | (b1 >> 4));
    out += i + 1 < bytes.length ? B64.charAt(((b1 & 15) << 2) | (b2 >> 6)) : "";
    out += i + 2 < bytes.length ? B64.charAt(b2 & 63) : "";
  }
  return out;
}

export function base64UrlDecode(str: string): string {
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < str.length; i++) {
    const idx = B64.indexOf(str.charAt(i));
    if (idx < 0) continue;
    buffer = (buffer << 6) | idx;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return bytesToUtf8(bytes);
}

// --- OAuth state ----------------------------------------------------------

export interface HaState {
  haUrl: string;
  nonce: string;
}

/** Encode the HA URL (+ a random nonce) into an opaque, URL-safe state param. */
export function encodeState(haUrl: string, nonce: string): string {
  return base64UrlEncode(JSON.stringify({ u: haUrl, n: nonce }));
}

/** Decode a state param produced by encodeState. Throws on malformed input. */
export function decodeState(state: string): HaState {
  const obj = JSON.parse(base64UrlDecode(state));
  return { haUrl: String(obj.u || ""), nonce: String(obj.n || "") };
}

/** Build the HA OAuth authorize URL the webview navigates to. */
export function buildAuthorizeUrl(
  haUrl: string,
  clientId: string,
  redirectUri: string,
  state: string,
): string {
  return (
    haUrl +
    "/auth/authorize?client_id=" + encodeURIComponent(clientId) +
    "&redirect_uri=" + encodeURIComponent(redirectUri) +
    "&response_type=code" +
    "&state=" + encodeURIComponent(state)
  );
}

/** x-www-form-urlencoded body to exchange an auth code for tokens. */
export function tokenExchangeBody(
  code: string,
  clientId: string,
  redirectUri: string,
): string {
  return (
    "grant_type=authorization_code" +
    "&code=" + encodeURIComponent(code) +
    "&client_id=" + encodeURIComponent(clientId) +
    "&redirect_uri=" + encodeURIComponent(redirectUri)
  );
}

/** x-www-form-urlencoded body to refresh an access token. */
export function tokenRefreshBody(refreshToken: string, clientId: string): string {
  return (
    "grant_type=refresh_token" +
    "&refresh_token=" + encodeURIComponent(refreshToken) +
    "&client_id=" + encodeURIComponent(clientId)
  );
}

export interface HaEntity {
  entity_id?: string;
  state?: string;
  attributes?: { device_class?: string; unit_of_measurement?: string; friendly_name?: string };
}

/**
 * Count entities exposed as temperature sensors, i.e. attributes.device_class
 * === "temperature". Accepts the raw array from GET /api/states.
 */
export function countTemperatureSensors(states: HaEntity[]): number {
  if (!states || !states.length) return 0;
  let count = 0;
  for (let i = 0; i < states.length; i++) {
    const e = states[i];
    if (e && e.attributes && e.attributes.device_class === "temperature") {
      count++;
    }
  }
  return count;
}

// --- Temperature sensor listing (name + area, like the HA entity picker) ---

export interface HaSensor {
  entity_id: string;
  name: string;
  area: string;
  /** Current state as reported by HA (e.g. "21.5"); "" when unknown. */
  state: string;
  /** Unit of measurement (e.g. "°C"); "" when unknown. */
  unit: string;
}

/**
 * Jinja template rendered by POST /api/template to list every temperature
 * sensor with the same friendly name and area the Home Assistant frontend
 * entity picker shows, plus its current state and unit so the settings page can
 * show a live value. `area_name()` resolves the entity's area (directly or via
 * its device); `tojson` guarantees valid JSON output. The `{%-`/`-%}` trim
 * markers keep the rendered result down to just the JSON array.
 */
export const HA_SENSOR_TEMPLATE =
  "{%- set ns = namespace(items=[]) -%}" +
  "{%- for s in states if s.attributes.device_class == 'temperature' -%}" +
  "{%- set ns.items = ns.items + [{'entity_id': s.entity_id, 'name': s.name, 'area': area_name(s.entity_id), 'state': s.state, 'unit': s.attributes.unit_of_measurement}] -%}" +
  "{%- endfor -%}" +
  "{{ ns.items | tojson }}";

/** JSON request body for POST /api/template. */
export function templateRequestBody(template: string): string {
  return JSON.stringify({ template: template });
}

function toSensor(raw: unknown): HaSensor | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as {
    entity_id?: unknown;
    name?: unknown;
    area?: unknown;
    state?: unknown;
    unit?: unknown;
  };
  const entityId = o.entity_id == null ? "" : String(o.entity_id);
  if (!entityId) return null;
  const name = o.name == null || o.name === "" ? entityId : String(o.name);
  const area = o.area == null ? "" : String(o.area);
  const state = o.state == null ? "" : String(o.state);
  const unit = o.unit == null ? "" : String(o.unit);
  return { entity_id: entityId, name: name, area: area, state: state, unit: unit };
}

/** Parse the JSON array returned by the sensor template into typed sensors. */
export function parseSensorList(text: string): HaSensor[] {
  let arr: unknown;
  try {
    arr = JSON.parse(text);
  } catch (err) {
    return [];
  }
  if (!arr || Object.prototype.toString.call(arr) !== "[object Array]") return [];
  const out: HaSensor[] = [];
  for (let i = 0; i < (arr as unknown[]).length; i++) {
    const s = toSensor((arr as unknown[])[i]);
    if (s) out.push(s);
  }
  return out;
}

/**
 * Fallback when /api/template is unavailable: build the sensor list from
 * GET /api/states. Area is unknown here (the states API doesn't expose it), so
 * it is left blank; state + unit come from the entity's top-level state and
 * unit_of_measurement attribute.
 */
export function sensorsFromStates(states: HaEntity[]): HaSensor[] {
  if (!states || !states.length) return [];
  const out: HaSensor[] = [];
  for (let i = 0; i < states.length; i++) {
    const e = states[i];
    if (e && e.attributes && e.attributes.device_class === "temperature" && e.entity_id) {
      out.push({
        entity_id: e.entity_id,
        name: e.attributes.friendly_name || e.entity_id,
        area: "",
        state: e.state == null ? "" : String(e.state),
        unit: e.attributes.unit_of_measurement || "",
      });
    }
  }
  return out;
}

/** Case-insensitive match of a sensor against a search query (name/area/id). */
export function matchesSensorQuery(sensor: HaSensor, query: string): boolean {
  const q = (query || "").trim().toLowerCase();
  if (q === "") return true;
  return (
    sensor.name.toLowerCase().indexOf(q) >= 0 ||
    sensor.area.toLowerCase().indexOf(q) >= 0 ||
    sensor.entity_id.toLowerCase().indexOf(q) >= 0
  );
}

// --- Home Assistant WebSocket API (live sensor value) ---------------------
// The home-temperature badge subscribes to a single entity over HA's WebSocket
// API (wss://host/api/websocket). These helpers are the pure pieces (URL/frame
// building + message parsing + unit conversion); the socket lifecycle itself
// lives in index.ts. See https://developers.home-assistant.io/docs/api/websocket

/** Derive the WebSocket endpoint from a normalized http(s) HA URL. */
export function wsUrlFromHttp(haUrl: string): string {
  return haUrl.replace(/^http/i, "ws") + "/api/websocket";
}

/** Frame sent to authenticate the socket once HA asks for auth. */
export function wsAuthMessage(accessToken: string): string {
  return JSON.stringify({ type: "auth", access_token: accessToken });
}

/** Frame that subscribes to compact state updates for a single entity. */
export function wsSubscribeEntitiesMessage(id: number, entityId: string): string {
  return JSON.stringify({ id: id, type: "subscribe_entities", entity_ids: [entityId] });
}

export interface WsStateUpdate {
  /** New state string, or null when this frame carries no state for the entity. */
  state: string | null;
  /** Unit of measurement if present in this frame, else null. */
  unit: string | null;
}

/**
 * Extract a state/unit update for `entityId` from a parsed `subscribe_entities`
 * event frame. Handles both the initial full snapshot (`event.a`) and the
 * incremental change (`event.c[...]["+"]`) shapes of the compact protocol.
 * Returns null when the frame has nothing for the entity.
 */
export function parseWsStateUpdate(msg: unknown, entityId: string): WsStateUpdate | null {
  if (!msg || typeof msg !== "object") return null;
  const m = msg as { type?: unknown; event?: { a?: Record<string, unknown>; c?: Record<string, unknown> } };
  if (m.type !== "event" || !m.event) return null;
  const ev = m.event;
  const readEntity = function (raw: unknown): WsStateUpdate | null {
    if (!raw || typeof raw !== "object") return null;
    const e = raw as { s?: unknown; a?: { unit_of_measurement?: unknown } };
    const state = e.s == null ? null : String(e.s);
    const unit = e.a && e.a.unit_of_measurement != null ? String(e.a.unit_of_measurement) : null;
    if (state === null && unit === null) return null;
    return { state: state, unit: unit };
  };
  if (ev.a && Object.prototype.hasOwnProperty.call(ev.a, entityId)) {
    return readEntity(ev.a[entityId]);
  }
  if (ev.c && Object.prototype.hasOwnProperty.call(ev.c, entityId)) {
    const chg = ev.c[entityId] as { "+"?: unknown };
    return chg && chg["+"] ? readEntity(chg["+"]) : null;
  }
  return null;
}

/**
 * Convert a sensor's state string (in `unit`) to tenths of a degree Celsius —
 * the format the watch stores/formats. Fahrenheit units (containing an "F") are
 * converted to Celsius. Returns null for non-numeric states.
 */
export function stateToTenthsC(state: string | null, unit: string | null): number | null {
  if (state == null) return null;
  const value = parseFloat(state);
  if (!isFinite(value)) return null;
  let celsius = value;
  if (unit && /f/i.test(unit)) celsius = ((value - 32) * 5) / 9;
  return Math.round(celsius * 10);
}
