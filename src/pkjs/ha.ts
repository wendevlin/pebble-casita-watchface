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
  attributes?: { device_class?: string; unit_of_measurement?: string };
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
