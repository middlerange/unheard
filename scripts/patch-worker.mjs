// ABOUTME: Post-build script that wraps dist/server/server.mjs to add Cloudflare scheduled handling.
// ABOUTME: Also bridges Worker env bindings into globals and process.env for server code.

import { writeFileSync } from 'fs';

writeFileSync('dist/server/worker.mjs', `
import handler from './server.mjs';

const origError = console.error.bind(console);
console.error = (...args) => {
  const out = args.map((a) => {
    if (a && typeof a === 'object' && a instanceof Error) {
      return (a.stack || a.message) + (a.cause ? '\\nCAUSE: ' + (a.cause.stack || a.cause.message || a.cause) : '');
    }
    return a;
  });
  origError(...out);
};

export default {
  async fetch(request, env, ctx) {
    globalThis.__contentHubOrigin__ = env.CONTENT_HUB_PUBLIC_URL || new URL(request.url).origin;
    globalThis.__contentHubDb__ = env.DB;
    globalThis.__contentHubMediaBucket__ = env.MEDIA_BUCKET;
    for (const [k, v] of Object.entries(env)) {
      if (typeof v === 'string') process.env[k] = v;
    }
    try {
      const res = await handler.fetch(request, env, ctx);
      if (res.status >= 500) {
        const cloned = res.clone();
        let body = '';
        try { body = await cloned.text(); } catch {}
        console.error('[worker] 500 on', request.url, 'body:', body.slice(0, 2000));
      }
      return res;
    } catch (err) {
      console.error('[worker] uncaught:', err?.stack || err?.message || err);
      throw err;
    }
  },

  async scheduled(event, env, ctx) {
    globalThis.__contentHubDb__ = env.DB;
    globalThis.__contentHubMediaBucket__ = env.MEDIA_BUCKET;
    for (const [k, v] of Object.entries(env)) {
      if (typeof v === 'string') process.env[k] = v;
    }
    const req = new Request('http://localhost/api/cron');
    ctx.waitUntil(handler.fetch(req, env, ctx));
  },
};
`.trimStart());

console.log('Patched dist/server/worker.mjs with env bridge + scheduled export');
