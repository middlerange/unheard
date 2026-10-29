// ABOUTME: Post-build script that wraps dist/server/server.mjs to add Cloudflare scheduled handling.
// ABOUTME: Also bridges Worker env bindings into globals and process.env for server code.

import { copyFileSync, writeFileSync } from 'fs';

copyFileSync('scripts/research-runtime.mjs', 'dist/server/research-runtime.mjs');

writeFileSync('dist/server/worker.mjs', `
import handler from './server.mjs';
import { WorkflowEntrypoint } from 'cloudflare:workers';
import { bindResearchEnvironment, invokeResearchProcess, runResearchWorkflow, runSlackWorkflow, researchDailyJob } from './research-runtime.mjs';

export class ResearchWorkflow extends WorkflowEntrypoint {
  async run(event, step) {
    return runResearchWorkflow(event.payload.runId, step, payload => invokeResearchProcess(handler, this.env, payload), event.payload.selectedWriting === true, event.payload.selectionOnly === true);
  }
}

export class SlackWorkflow extends WorkflowEntrypoint {
  async run(event, step) {
    return runSlackWorkflow(event.payload.jobId, step, payload => invokeResearchProcess(handler, this.env, payload, '/api/slack/process'));
  }
}

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
    bindResearchEnvironment(env);
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
    bindResearchEnvironment(env);
    const req = new Request('http://localhost/api/cron');
    ctx.waitUntil(handler.fetch(req, env, ctx));
    ctx.waitUntil(invokeResearchProcess(handler, env, { operation: 'dispatch' }, '/api/slack/process'));
    ctx.waitUntil(invokeResearchProcess(handler, env, researchDailyJob(event.scheduledTime)));
  },
};
`.trimStart());

console.log('Patched dist/server/worker.mjs with env bridge + scheduled export');
