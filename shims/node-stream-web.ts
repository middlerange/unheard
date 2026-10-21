// ABOUTME: Browser shim for node:stream/web — re-exports the browser's native Web Streams globals.
// ABOUTME: Used only in the client build; SSR-only code imports these but never runs in browsers.

export const ReadableStream = globalThis.ReadableStream;
export const WritableStream = globalThis.WritableStream;
export const TransformStream = globalThis.TransformStream;
