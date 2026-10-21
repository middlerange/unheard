// ABOUTME: Browser shim for node:stream — SSR-only code references Readable but never runs in browsers.
// ABOUTME: Provides just enough surface area to satisfy Rollup's named-export checks.

export class Readable {
  static from() { return new Readable(); }
  pipe(dest: unknown) { return dest; }
  on(_event: string, _fn: unknown) { return this; }
  destroy() {}
  resume() { return this; }
  [Symbol.asyncIterator]() {
    return { next: async () => ({ done: true as const, value: undefined }) };
  }
}

export class Writable {}
export class Transform extends Readable {}
export class PassThrough extends Readable {}

export default { Readable, Writable, Transform, PassThrough };
