// Local ambient declarations for standalone `tsc --noEmit` type-checking.
//
// These mirror the subset of the Moddable / Pebble Alloy runtime API that this
// watchface uses. The authoritative typings ship with the Pebble SDK and are
// used by `pebble build`; this file only needs to keep the editor and the
// `bun run typecheck` script honest without depending on an absolute SDK path.

declare module "commodetto/Poco" {
  export interface Font {
    readonly height: number;
    readonly ascent: number;
  }

  export interface FontConstructor {
    new (family: string, size: number): Font;
  }

  export interface DrawCommand {
    readonly type: number;
    strokeWidth: number;
    stroke: number;
    fill: number;
    hidden: boolean;
  }

  export class PebbleDrawCommandImage {
    constructor(id: number | string);
    readonly width: number;
    readonly height: number;
    clone(): PebbleDrawCommandImage;
    scale(x: number, y: number): this;
    scale(scale: number): this;
    process(callback: (command: DrawCommand) => void): this;
  }

  export interface Poco {
    readonly width: number;
    readonly height: number;
    readonly unobstructed: {
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
    };
    Font: FontConstructor;
    begin(x?: number, y?: number, width?: number, height?: number): void;
    end(): void;
    makeColor(r: number, g: number, b: number): number;
    fillRectangle(color: number, x: number, y: number, width: number, height: number): void;
    blendRectangle(color: number, blend: number, x: number, y: number, width: number, height: number): void;
    drawText(text: string, font: Font, color: number, x: number, y: number, width?: number): void;
    getTextWidth(text: string, font: Font): number;
    drawDCI(dci: PebbleDrawCommandImage, x: number, y: number): void;
    drawLine(x0: number, y0: number, x1: number, y1: number, color: number, width: number): void;
    drawRoundRect(x0: number, y0: number, x1: number, y1: number, color: number, radius: number, corners: number): void;
    frameRoundRect(x0: number, y0: number, x1: number, y1: number, color: number, radius: number): void;
  }

  export interface PocoConstructor {
    new (pixelsOut: unknown, options?: { rotation?: 0 | 90 | 180 | 270 }): Poco;
    PebbleDrawCommandImage: typeof PebbleDrawCommandImage;
  }

  const Poco: PocoConstructor;
  export default Poco;
}

interface Console {
  log(...args: unknown[]): void;
}
declare const console: Console;

// The host display object (pebble/display PebbleDisplay). Only the shape flag
// is read directly; everything else goes through Poco.
declare const screen: { readonly round: boolean };

interface TimeChangeEvent {
  date: Date;
}
interface ConnectionState {
  readonly app: boolean;
  readonly pebblekit: boolean;
}
type TimeEventType = "secondchange" | "minutechange" | "hourchange" | "daychange";

interface Watch {
  addEventListener(event: TimeEventType, callback: (event: TimeChangeEvent) => void): void;
  addEventListener(event: "connected", callback: () => void): void;
  addEventListener(event: "resize", callback: () => void): void;
  /** Fired before (will) / after (did) the system's focus transition. */
  addEventListener(event: "willFocus" | "didFocus", callback: (inFocus: boolean) => void): void;
  removeEventListener(event: TimeEventType, callback: (event: TimeChangeEvent) => void): void;
  removeEventListener(event: "connected", callback: () => void): void;
  removeEventListener(event: "resize", callback: () => void): void;
  removeEventListener(event: "willFocus" | "didFocus", callback: (inFocus: boolean) => void): void;
  readonly connected: ConnectionState;
  readonly hour12: boolean;
  readonly model: number;
}
declare const watch: Watch;

// Timers provided by the host runtime (Moddable `timer` module behind the
// familiar globals).
declare function setTimeout(callback: () => void, delay: number): number;
declare function clearTimeout(id: number): void;
declare function setInterval(callback: () => void, delay: number): number;
declare function clearInterval(id: number): void;

// Persistent key/value storage exposed as a WebStorage-compatible global by the
// Pebble host runtime (backed by the watch's key-value store, keyed per UUID).
interface WatchLocalStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
declare const localStorage: WatchLocalStorage;

// AppMessage bridge between the watch and the phone-side PebbleKit JS. Named
// keys are mapped to numeric codes (matching package.json `messageKeys`).
declare module "pebble/message" {
  export interface MessageOptions {
    format?: "map";
    input?: number;
    output?: number;
    keys?: string[] | Map<string, number>;
    onReadable?: () => void;
    onWritable?: (count: number) => void;
    onSuspend?: () => void;
  }

  export default class Message {
    constructor(options?: MessageOptions);
    read(): Map<string | number, unknown>;
    write(map: Map<string | number, unknown>): void;
    close(): void;
  }
}

// Pebble Health: on-watch access to activity metrics (steps) and the phone
// app's measurement-system preference. Mirrors the SDK typings subset we use.
declare module "pebble/health" {
  type HealthMetricName =
    | "step count"
    | "active seconds"
    | "walked distance"
    | "sleep seconds";

  type HealthMeasurementSystem = "metric" | "imperial" | undefined;

  export default class Health {
    static metric: {
      get(name: HealthMetricName): number;
      query(options: { metric: HealthMetricName; start?: Date | number; end?: Date | number }): number;
    };
    static access: {
      readonly available: 1;
      readonly permission: 2;
      readonly supported: 4;
      readonly data: 8;
    };
    static displayMeasurementSystem(metric: HealthMetricName): HealthMeasurementSystem;
  }
}
