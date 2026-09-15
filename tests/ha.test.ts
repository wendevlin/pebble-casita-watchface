import { expect, test, describe } from "bun:test";
import {
  normalizeHaUrl,
  base64UrlEncode,
  base64UrlDecode,
  encodeState,
  decodeState,
  buildAuthorizeUrl,
  tokenExchangeBody,
  tokenRefreshBody,
  countTemperatureSensors,
  templateRequestBody,
  parseSensorList,
  sensorsFromStates,
  matchesSensorQuery,
  wsUrlFromHttp,
  wsAuthMessage,
  wsSubscribeEntitiesMessage,
  parseWsStateUpdate,
  stateToTenthsC,
  HA_SENSOR_TEMPLATE,
  HA_CLIENT_ID,
  HA_REDIRECT_URI,
} from "../src/pkjs/ha";

describe("normalizeHaUrl", () => {
  test("adds https scheme when missing", () => {
    expect(normalizeHaUrl("home.example.com")).toBe("https://home.example.com");
  });
  test("keeps existing http/https scheme", () => {
    expect(normalizeHaUrl("http://192.168.1.5:8123")).toBe("http://192.168.1.5:8123");
    expect(normalizeHaUrl("https://ha.example.com")).toBe("https://ha.example.com");
  });
  test("trims whitespace and trailing slashes", () => {
    expect(normalizeHaUrl("  https://ha.example.com/  ")).toBe("https://ha.example.com");
    expect(normalizeHaUrl("https://ha.example.com///")).toBe("https://ha.example.com");
  });
  test("empty input yields empty string", () => {
    expect(normalizeHaUrl("")).toBe("");
    expect(normalizeHaUrl("   ")).toBe("");
  });
});

describe("base64url", () => {
  test("round-trips ascii and unicode", () => {
    const samples = ["", "hello", "https://ha.example.com", "café ☕ 42", "a/b+c=d"];
    for (const s of samples) {
      expect(base64UrlDecode(base64UrlEncode(s))).toBe(s);
    }
  });
  test("output is url-safe (no +, /, =)", () => {
    const out = base64UrlEncode("many??bytes>>>to<<<force+padding//");
    expect(out).not.toMatch(/[+/=]/);
  });
});

describe("state encode/decode", () => {
  test("round-trips the HA url and nonce", () => {
    const state = encodeState("https://ha.example.com", "abc123");
    const decoded = decodeState(state);
    expect(decoded.haUrl).toBe("https://ha.example.com");
    expect(decoded.nonce).toBe("abc123");
  });
  test("state is url-safe", () => {
    const state = encodeState("https://ha.example.com:8123", "n-o_nce");
    expect(state).not.toMatch(/[+/=]/);
  });
});

describe("buildAuthorizeUrl", () => {
  test("includes all required oauth params", () => {
    const state = encodeState("https://ha.example.com", "xyz");
    const url = buildAuthorizeUrl("https://ha.example.com", HA_CLIENT_ID, HA_REDIRECT_URI, state);
    expect(url).toContain("https://ha.example.com/auth/authorize?");
    expect(url).toContain("client_id=" + encodeURIComponent(HA_CLIENT_ID));
    expect(url).toContain("redirect_uri=" + encodeURIComponent(HA_REDIRECT_URI));
    expect(url).toContain("response_type=code");
    expect(url).toContain("state=" + encodeURIComponent(state));
  });
});

describe("token bodies", () => {
  test("exchange body has authorization_code grant", () => {
    const body = tokenExchangeBody("thecode", HA_CLIENT_ID, HA_REDIRECT_URI);
    expect(body).toContain("grant_type=authorization_code");
    expect(body).toContain("code=thecode");
    expect(body).toContain("client_id=" + encodeURIComponent(HA_CLIENT_ID));
    expect(body).toContain("redirect_uri=" + encodeURIComponent(HA_REDIRECT_URI));
  });
  test("refresh body has refresh_token grant", () => {
    const body = tokenRefreshBody("thetoken", HA_CLIENT_ID);
    expect(body).toContain("grant_type=refresh_token");
    expect(body).toContain("refresh_token=thetoken");
    expect(body).toContain("client_id=" + encodeURIComponent(HA_CLIENT_ID));
  });
});

describe("countTemperatureSensors", () => {
  test("counts only device_class temperature", () => {
    const states = [
      { entity_id: "sensor.living_temp", attributes: { device_class: "temperature" } },
      { entity_id: "sensor.bedroom_temp", attributes: { device_class: "temperature" } },
      { entity_id: "sensor.humidity", attributes: { device_class: "humidity" } },
      { entity_id: "light.kitchen", attributes: {} },
      { entity_id: "sensor.no_attrs" },
    ];
    expect(countTemperatureSensors(states)).toBe(2);
  });
  test("handles empty / missing input", () => {
    expect(countTemperatureSensors([])).toBe(0);
    expect(countTemperatureSensors(undefined as unknown as [])).toBe(0);
  });
});

describe("templateRequestBody", () => {
  test("wraps the template in a JSON body", () => {
    const body = templateRequestBody(HA_SENSOR_TEMPLATE);
    const parsed = JSON.parse(body);
    expect(parsed.template).toBe(HA_SENSOR_TEMPLATE);
  });
  test("template targets temperature sensors with name and area", () => {
    expect(HA_SENSOR_TEMPLATE).toContain("device_class == 'temperature'");
    expect(HA_SENSOR_TEMPLATE).toContain("area_name(s.entity_id)");
    expect(HA_SENSOR_TEMPLATE).toContain("tojson");
  });
});

describe("parseSensorList", () => {
  test("parses a well-formed template response", () => {
    const text = JSON.stringify([
      { entity_id: "sensor.living", name: "Living Room", area: "Living Room" },
      { entity_id: "sensor.out", name: "Outside", area: null },
    ]);
    const list = parseSensorList(text);
    expect(list.length).toBe(2);
    expect(list[0]).toEqual({ entity_id: "sensor.living", name: "Living Room", area: "Living Room", state: "", unit: "" });
    // null area becomes "" and missing name would fall back to entity_id
    expect(list[1]).toEqual({ entity_id: "sensor.out", name: "Outside", area: "", state: "", unit: "" });
  });
  test("drops entries without an entity_id and falls back name->id", () => {
    const text = JSON.stringify([
      { name: "no id" },
      { entity_id: "sensor.x" },
    ]);
    const list = parseSensorList(text);
    expect(list.length).toBe(1);
    expect(list[0]).toEqual({ entity_id: "sensor.x", name: "sensor.x", area: "", state: "", unit: "" });
  });
  test("returns [] for junk / non-array", () => {
    expect(parseSensorList("not json")).toEqual([]);
    expect(parseSensorList("{}")).toEqual([]);
    expect(parseSensorList("")).toEqual([]);
  });
});

describe("sensorsFromStates (fallback)", () => {
  test("builds sensors from /api/states with blank area", () => {
    const states = [
      { entity_id: "sensor.a", state: "21.5", attributes: { device_class: "temperature", friendly_name: "A", unit_of_measurement: "°C" } },
      { entity_id: "sensor.b", attributes: { device_class: "temperature" } },
      { entity_id: "sensor.h", attributes: { device_class: "humidity" } },
    ];
    const list = sensorsFromStates(states);
    expect(list).toEqual([
      { entity_id: "sensor.a", name: "A", area: "", state: "21.5", unit: "°C" },
      { entity_id: "sensor.b", name: "sensor.b", area: "", state: "", unit: "" },
    ]);
  });
});

describe("matchesSensorQuery", () => {
  const s = { entity_id: "sensor.living_temp", name: "Living Room", area: "Ground Floor", state: "21.0", unit: "°C" };
  test("empty query matches", () => {
    expect(matchesSensorQuery(s, "")).toBe(true);
    expect(matchesSensorQuery(s, "   ")).toBe(true);
  });
  test("matches on name, area, or entity id, case-insensitive", () => {
    expect(matchesSensorQuery(s, "living")).toBe(true);
    expect(matchesSensorQuery(s, "GROUND")).toBe(true);
    expect(matchesSensorQuery(s, "sensor.living")).toBe(true);
  });
  test("no match returns false", () => {
    expect(matchesSensorQuery(s, "kitchen")).toBe(false);
  });
});

describe("websocket helpers", () => {
  test("wsUrlFromHttp maps http->ws and https->wss with /api/websocket", () => {
    expect(wsUrlFromHttp("https://ha.example.com")).toBe("wss://ha.example.com/api/websocket");
    expect(wsUrlFromHttp("http://192.168.1.5:8123")).toBe("ws://192.168.1.5:8123/api/websocket");
  });
  test("auth + subscribe frames are well-formed JSON", () => {
    expect(JSON.parse(wsAuthMessage("tok"))).toEqual({ type: "auth", access_token: "tok" });
    expect(JSON.parse(wsSubscribeEntitiesMessage(3, "sensor.x"))).toEqual({
      id: 3,
      type: "subscribe_entities",
      entity_ids: ["sensor.x"],
    });
  });
});

describe("parseWsStateUpdate", () => {
  test("reads the initial snapshot (event.a)", () => {
    const msg = { type: "event", event: { a: { "sensor.x": { s: "21.5", a: { unit_of_measurement: "°C" } } } } };
    expect(parseWsStateUpdate(msg, "sensor.x")).toEqual({ state: "21.5", unit: "°C" });
  });
  test("reads an incremental change (event.c[...]['+'])", () => {
    const msg = { type: "event", event: { c: { "sensor.x": { "+": { s: "22.1" } } } } };
    expect(parseWsStateUpdate(msg, "sensor.x")).toEqual({ state: "22.1", unit: null });
  });
  test("returns null when nothing for the entity / wrong type", () => {
    expect(parseWsStateUpdate({ type: "event", event: { a: { "sensor.y": { s: "1" } } } }, "sensor.x")).toBeNull();
    expect(parseWsStateUpdate({ type: "result" }, "sensor.x")).toBeNull();
    expect(parseWsStateUpdate(null, "sensor.x")).toBeNull();
  });
});

describe("stateToTenthsC", () => {
  test("Celsius passes through as tenths", () => {
    expect(stateToTenthsC("21.5", "°C")).toBe(215);
    expect(stateToTenthsC("21.5", null)).toBe(215);
  });
  test("Fahrenheit converts to Celsius tenths", () => {
    expect(stateToTenthsC("71.6", "°F")).toBe(220);
    expect(stateToTenthsC("32", "°F")).toBe(0);
  });
  test("non-numeric / null returns null", () => {
    expect(stateToTenthsC("unavailable", "°C")).toBeNull();
    expect(stateToTenthsC(null, "°C")).toBeNull();
  });
});
