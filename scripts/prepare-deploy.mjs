import { readFileSync, writeFileSync } from 'node:fs';

const configPath = 'wrangler.toml';
const databaseId = process.env.CONTENT_HUB_D1_DATABASE_ID;
const bucketName = process.env.CONTENT_HUB_R2_BUCKET_NAME;
const placeholder = '00000000-0000-0000-0000-000000000000';
let config = readFileSync(configPath, 'utf8');

if (databaseId) {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(databaseId) || databaseId === placeholder) {
    throw new Error('CONTENT_HUB_D1_DATABASE_ID must identify an existing D1 database.');
  }
  config = config.replace(/^database_id\s*=\s*"[^"]*"/m, `database_id = "${databaseId}"`);
}

if (config.includes(`database_id = "${placeholder}"`)) {
  throw new Error('Set CONTENT_HUB_D1_DATABASE_ID in Cloudflare build settings, or provision DB before deploying.');
}

if (bucketName) {
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucketName)) {
    throw new Error('CONTENT_HUB_R2_BUCKET_NAME must be a valid existing R2 bucket name.');
  }
  config = config.replace(/^bucket_name\s*=\s*"[^"]*"/m, `bucket_name = "${bucketName}"`);
}

writeFileSync('.wrangler.deploy.toml', config);
console.log('Prepared deployment configuration for the existing database.');
