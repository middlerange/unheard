// ABOUTME: Seed script to create a demo user, team, and membership for local/dev testing.
// ABOUTME: Run with: npx tsx scripts/seed-demo-user.ts

import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { scrypt, randomBytes } from 'crypto';
import { createD1Http } from '../lib/db/d1-http';
import * as schema from '../lib/schema';

for (const file of ['.env.local', '.env.l', '.env']) {
  const p = path.join(process.cwd(), file);
  if (fs.existsSync(p)) dotenv.config({ path: p });
}

function generateId(): string {
  return randomBytes(16).toString('hex');
}

function hashPassword(plain: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = randomBytes(16).toString('hex');
    scrypt(plain, salt, 64, (err, key) => {
      if (err) return reject(err);
      resolve(`${salt}:${key.toString('hex')}`);
    });
  });
}

const EMAIL = 'demo@testuser.com';
const PASSWORD = 'andcoms';
const NAME = 'Demo User';
const TEAM_NAME = 'Demo Team';

async function run() {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const databaseId = process.env.CLOUDFLARE_D1_DATABASE_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !databaseId || !apiToken) {
    throw new Error('Missing CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_D1_DATABASE_ID / CLOUDFLARE_API_TOKEN');
  }
  const binding = createD1Http({ accountId, databaseId, apiToken });
  const db = drizzle(binding as Parameters<typeof drizzle>[0], { schema });
  const now = Date.now();

  const existing = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, EMAIL))
    .limit(1);

  if (existing.length > 0) {
    console.log(`User ${EMAIL} already exists (id: ${existing[0].id}). Skipping.`);
    process.exit(0);
  }

  const userId = generateId();
  const teamId = generateId();
  const membershipId = generateId();
  const slug = 'demo-team-' + generateId().slice(0, 8);
  const passwordHash = await hashPassword(PASSWORD);

  await db.insert(schema.users).values({
    id: userId,
    email: EMAIL,
    password_hash: passwordHash,
    name: NAME,
    is_admin: false,
    created_at: now,
    updated_at: now,
  });

  await db.insert(schema.teams).values({
    id: teamId,
    name: TEAM_NAME,
    slug,
    created_at: now,
    updated_at: now,
  });

  await db.insert(schema.team_memberships).values({
    id: membershipId,
    user_id: userId,
    team_id: teamId,
    role: 'owner',
    created_at: now,
  });

  console.log(`Created user ${EMAIL} (id: ${userId})`);
  console.log(`Created team ${TEAM_NAME} (id: ${teamId}, slug: ${slug})`);
  console.log(`Login with: ${EMAIL} / ${PASSWORD}`);
  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
