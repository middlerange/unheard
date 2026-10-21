// ABOUTME: Server functions for authentication — signup, login, logout, and session state.
// ABOUTME: Database-backed multi-tenant auth with users, teams, and memberships.

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { getSession, verifyPassword, hashPassword, generateId } from '@/lib/auth';
import { getDb } from '@/lib/db/client';
import * as schema from '@/lib/schema';
import type { User, Team, TeamMembership } from '@/lib/db/types';

// Validation schemas
const signupSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().min(1, 'Name is required'),
  teamName: z.string().min(1, 'Team name is required'),
});

const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

// Get current auth state
export const getAuthState = createServerFn({ method: 'GET' })
  .handler(async () => {
    const session = await getSession();
    return {
      isAuthenticated: !!session.data.userId,
      userId: session.data.userId ?? null,
      email: session.data.email ?? null,
      teamId: session.data.teamId ?? null,
      isAdmin: session.data.isAdmin ?? false,
    };
  });

// Get current user with team info
export const getCurrentUser = createServerFn({ method: 'GET' })
  .handler(async () => {
    const session = await getSession();
    if (!session.data.userId) {
      return null;
    }

    const db = await getDb();
    const userRows = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, session.data.userId))
      .limit(1);

    if (userRows.length === 0) {
      return null;
    }

    const user = userRows[0];

    // Get user's team membership
    const membershipRows = await db
      .select({
        membership: schema.team_memberships,
        team: schema.teams,
      })
      .from(schema.team_memberships)
      .innerJoin(schema.teams, eq(schema.team_memberships.team_id, schema.teams.id))
      .where(eq(schema.team_memberships.user_id, user.id))
      .limit(1);

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      isAdmin: user.is_admin,
      team: membershipRows.length > 0 ? {
        id: membershipRows[0].team.id,
        name: membershipRows[0].team.name,
        slug: membershipRows[0].team.slug,
        role: membershipRows[0].membership.role,
      } : null,
    };
  });

// Signup - creates user, team, and membership
export const signup = createServerFn({ method: 'POST' })
  .inputValidator(signupSchema)
  .handler(async ({ data }) => {
    const db = await getDb();
    const now = Date.now();

    // Check if email already exists
    const existingUser = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, data.email.toLowerCase()))
      .limit(1);

    if (existingUser.length > 0) {
      throw new Error('Email already registered');
    }

    // Generate IDs
    const userId = generateId();
    const teamId = generateId();
    const membershipId = generateId();

    // Create slug from team name
    const slug = data.teamName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      + '-' + generateId().slice(0, 8);

    // Hash password
    const passwordHash = await hashPassword(data.password);

    // Create user
    await db.insert(schema.users).values({
      id: userId,
      email: data.email.toLowerCase(),
      password_hash: passwordHash,
      name: data.name,
      is_admin: false,
      created_at: now,
      updated_at: now,
    });

    // Create team
    await db.insert(schema.teams).values({
      id: teamId,
      name: data.teamName,
      slug,
      created_at: now,
      updated_at: now,
    });

    // Create membership (owner role)
    await db.insert(schema.team_memberships).values({
      id: membershipId,
      user_id: userId,
      team_id: teamId,
      role: 'owner',
      created_at: now,
    });

    // Set session
    const session = await getSession();
    await session.update({
      userId,
      teamId,
      email: data.email.toLowerCase(),
      isAdmin: false,
    });

    return { ok: true, userId, teamId };
  });

// Login
export const login = createServerFn({ method: 'POST' })
  .inputValidator(loginSchema)
  .handler(async ({ data }) => {
    console.log('[login] Attempting login for:', data.email);
    const db = await getDb();
    console.log('[login] DB connected');

    try {
      // Find user by email
      const userRows = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.email, data.email.toLowerCase()))
        .limit(1);
      
      console.log('[login] Query result:', userRows.length, 'rows found');

      if (userRows.length === 0) {
        console.log('[login] User not found');
        throw new Error('Invalid credentials');
      }

      const user = userRows[0];
      console.log('[login] User found:', user.email);

      // Verify password
      console.log('[login] Verifying password...');
      const valid = await verifyPassword(data.password, user.password_hash);
      console.log('[login] Password valid:', valid);
      
      if (!valid) {
        throw new Error('Invalid credentials');
      }

      // Get user's team membership
      const membershipRows = await db
        .select({ team_id: schema.team_memberships.team_id })
        .from(schema.team_memberships)
        .where(eq(schema.team_memberships.user_id, user.id))
        .limit(1);

      const teamId = membershipRows.length > 0 ? membershipRows[0].team_id : null;

      // Set session
      const session = await getSession();
      await session.update({
        userId: user.id,
        teamId: teamId ?? undefined,
        email: user.email,
        isAdmin: user.is_admin,
      });

      return { ok: true, userId: user.id, teamId };
    } catch (err) {
      console.error('[login] Error during login:', err);
      throw err;
    }
  });

// Logout
export const logout = createServerFn({ method: 'POST' })
  .handler(async () => {
    const session = await getSession();
    await session.clear();
    return { ok: true };
  });

// Switch team (for users with multiple teams - future feature)
export const switchTeam = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ teamId: z.string() }))
  .handler(async ({ data }) => {
    const session = await getSession();
    const userId = session.data.userId;

    if (!userId) {
      throw new Error('Not authenticated');
    }

    const db = await getDb();

    // Verify user has access to this team
    const membership = await db
      .select()
      .from(schema.team_memberships)
      .where(and(
        eq(schema.team_memberships.user_id, userId),
        eq(schema.team_memberships.team_id, data.teamId)
      ))
      .limit(1);

    if (membership.length === 0) {
      throw new Error('Access denied');
    }

    // Update session with new team
    await session.update({
      ...session.data,
      teamId: data.teamId,
    });

    return { ok: true };
  });

// Helper to require authentication
export async function requireAuth(): Promise<{ id: string; email: string; teamId?: string }> {
  const session = await getSession();
  if (!session.data.userId) {
    throw new Error('Unauthorized');
  }
  if (!session.data.email) {
    throw new Error('Session missing email');
  }
  return {
    id: session.data.userId,
    email: session.data.email,
    teamId: session.data.teamId,
  };
}
