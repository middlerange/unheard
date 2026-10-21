// ABOUTME: Add the local-only demo login without overwriting an existing account.
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { getPlatformProxy } from 'wrangler';
import { randomBytes, scrypt } from 'node:crypto';
import { promisify } from 'node:util';
import * as schema from '../lib/schema';

const scryptAsync = promisify(scrypt);

function generateId() {
  return randomBytes(16).toString('hex');
}

async function hashPassword(plain: string) {
  const salt = randomBytes(16).toString('hex');
  const key = (await scryptAsync(plain, salt, 64)) as Buffer;
  return `${salt}:${key.toString('hex')}`;
}

const email = 'demo@testuser.com';
const password = 'andcoms';
const now = Date.now();

async function main() {
  const platform = await getPlatformProxy({
    configPath: `${process.cwd()}/wrangler.toml`,
    envFiles: [],
    persist: true,
    remoteBindings: false,
  });

  try {
    const db = drizzle(platform.env.DB as Parameters<typeof drizzle>[0], { schema });
    const existing = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);

    if (existing.length) {
      console.log(`Local demo account already exists: ${email}`);
    } else {
      const userId = generateId();
      const teamId = generateId();
      await db.insert(schema.users).values({
        id: userId,
        email,
        password_hash: await hashPassword(password),
        name: 'Demo User',
        is_admin: true,
        created_at: now,
        updated_at: now,
      });
      await db.insert(schema.teams).values({
        id: teamId,
        name: 'Demo Team',
        slug: 'local-demo-team',
        created_at: now,
        updated_at: now,
      });
      await db.insert(schema.team_memberships).values({
        id: generateId(),
        user_id: userId,
        team_id: teamId,
        role: 'owner',
        created_at: now,
      });
      console.log(`Created local demo account: ${email}`);
    }
  } finally {
    await platform.dispose();
  }
}

void main();
