// ABOUTME: Reads .env.local and pushes only secrets that are missing from the Cloudflare Worker.
// ABOUTME: Skips secrets already set — safe to run after every deploy without overwriting existing values.

import { execSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';

const envFile = '.env.local';
if (!existsSync(envFile)) {
  console.log(`${envFile} not found — skipping secret push`);
  process.exit(0);
}

const local = Object.fromEntries(
  readFileSync(envFile, 'utf8')
    .split('\n')
    .filter(l => l && !l.startsWith('#') && l.includes('='))
    .map(l => {
      const idx = l.indexOf('=');
      return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
    })
    .filter(([k, v]) => k && v && !k.startsWith('VITE_')),
);

const existing = JSON.parse(
  execSync('npx wrangler secret list', { stdio: ['pipe', 'pipe', 'pipe'] }).toString(),
).map(s => s.name);

const missing = Object.entries(local).filter(([k]) => !existing.includes(k));

if (missing.length === 0) {
  console.log('All secrets already set — nothing to push.');
  process.exit(0);
}

console.log(`Pushing ${missing.length} missing secret(s): ${missing.map(([k]) => k).join(', ')}`);

for (const [key, value] of missing) {
  execSync(`npx wrangler secret put ${key}`, {
    input: value,
    stdio: ['pipe', 'inherit', 'inherit'],
  });
}
