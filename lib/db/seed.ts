// ABOUTME: Seed script for E2E testing - creates test user account on first run.
// ABOUTME: Run this before E2E tests to ensure test account exists.

import { eq } from 'drizzle-orm';
import { getDb } from './client';
import * as schema from '../schema';
import { scrypt, randomBytes } from 'crypto';
import { promisify } from 'util';

const scryptAsync = promisify(scrypt);

const TEST_EMAIL = 'demo@testuser.com';
const TEST_PASSWORD = 'andcoms';
const TEST_TEAM_NAME = 'Demo Team';

function generateId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const key = await scryptAsync(plain, salt, 64) as Buffer;
  return `${salt}:${key.toString('hex')}`;
}

export async function seedTestAccount() {
  console.log('[Seed] Connecting to database...');
  const db = await getDb();
  console.log('[Seed] Connected successfully');
  
  // Check if test user already exists - if so, delete and recreate
  const existingUser = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, TEST_EMAIL))
    .limit(1);
  
  if (existingUser.length > 0) {
    console.log('Test account exists, recreating:', TEST_EMAIL);
    const userId = existingUser[0].id;
    
    // Delete existing memberships and team
    const memberships = await db
      .select()
      .from(schema.team_memberships)
      .where(eq(schema.team_memberships.user_id, userId));
    
    for (const m of memberships) {
      await db.delete(schema.team_memberships).where(eq(schema.team_memberships.id, m.id));
      await db.delete(schema.teams).where(eq(schema.teams.id, m.team_id));
    }
    
    // Delete user
    await db.delete(schema.users).where(eq(schema.users.id, userId));
  }
  
  // Create test user
  const userId = generateId();
  const teamId = generateId();
  const now = Date.now();
  
  // Create password hash using the same function as auth.ts
  const passwordHash = await hashPassword(TEST_PASSWORD);
  
  await db.insert(schema.users).values({
    id: userId,
    email: TEST_EMAIL,
    password_hash: passwordHash,
    name: 'E2E Test User',
    is_admin: false,
    created_at: now,
    updated_at: now,
  });
  
  // Create test team
  await db.insert(schema.teams).values({
    id: teamId,
    name: TEST_TEAM_NAME,
    slug: 'e2e-test-team',
    created_at: now,
    updated_at: now,
  });
  
  // Create team membership
  await db.insert(schema.team_memberships).values({
    id: generateId(),
    user_id: userId,
    team_id: teamId,
    role: 'owner',
    created_at: now,
  });
  
  console.log('Test account created successfully!');
  console.log('Email:', TEST_EMAIL);
  console.log('Password:', TEST_PASSWORD);
  console.log('Team:', TEST_TEAM_NAME);
  
  return { userId, teamId, email: TEST_EMAIL };
}

// Run if called directly
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  console.log('Starting seed script...');
  seedTestAccount()
    .then(() => {
      console.log('Seed completed successfully');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Failed to seed test account:', err);
      process.exit(1);
    });
}
