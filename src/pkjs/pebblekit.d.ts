/*
 * Ambient typings for the PebbleKit JS (phone-side) runtime. The Pebble mobile
 * app injects a global `Pebble` object; only the surface this watchface uses is
 * declared here. Browser globals (navigator.geolocation, XMLHttpRequest,
 * localStorage, setInterval, console, JSON, encodeURIComponent) come from the
 * DOM lib configured in tsconfig.pkjs.json.
 */

declare namespace Pebble {
  interface WebviewClosedEvent {
    response?: string;
  }

  /** Inbound AppMessage from the watch; keys are the names from `messageKeys`. */
  interface AppMessageEvent {
    payload: { [key: string]: unknown };
  }

  function addEventListener(type: "ready", callback: () => void): void;
  function addEventListener(type: "showConfiguration", callback: () => void): void;
  function addEventListener(
    type: "appmessage",
    callback: (event: AppMessageEvent) => void,
  ): void;
  function addEventListener(
    type: "webviewclosed",
    callback: (event: WebviewClosedEvent) => void,
  ): void;

  function sendAppMessage(
    message: { [key: string]: number | string },
    onSuccess?: () => void,
    onError?: (error: unknown) => void,
  ): void;

  function openURL(url: string): void;
}
