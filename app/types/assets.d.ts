// ABOUTME: Declares non-code asset modules imported by the app at typecheck time.
// ABOUTME: Keeps TypeScript aligned with Vite-style `?url` asset imports.

declare module '*.css?url' {
  const value: string;
  export default value;
}
