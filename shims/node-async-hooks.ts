// ABOUTME: Browser shim for node:async_hooks — SSR-only code references AsyncLocalStorage but never runs in browsers.
// ABOUTME: Used only in the client build; provides a no-op stub to satisfy Rollup's named-export checks.

export class AsyncLocalStorage<T> {
  run<R>(store: T, fn: (...args: unknown[]) => R, ...args: unknown[]): R {
    return fn(...args) as R;
  }
  getStore(): T | undefined { return undefined; }
  enterWith(_store: T) {}
  disable() {}
}

export class AsyncResource {
  static bind<T extends (...args: unknown[]) => unknown>(fn: T): T { return fn; }
  runInAsyncScope<R>(fn: (...args: unknown[]) => R, _thisArg?: unknown, ...args: unknown[]): R {
    return fn(...args) as R;
  }
}
