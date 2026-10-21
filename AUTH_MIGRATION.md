# Authentication & Multi-Tenancy Migration

This document describes the migration from env-based admin auth to database-backed multi-tenant auth with users, teams, and memberships.

## Changes Made

### Database Schema

New tables added:
- `users` - stores user accounts with email, password hash, name, is_admin flag
- `teams` - stores team/organization accounts  
- `team_memberships` - stores many-to-many relationships between users and teams

Modified tables (added `team_id` column):
- `posts` - now scoped to a team
- `ideas` - now scoped to a team
- `templates` - now scoped to a team (composite unique on `slug + team_id`)
- `channels` - now scoped to a team
- `brand_profiles` - now scoped to a team

### Auth System

**Old:**
- Single-user auth using `ADMIN_EMAIL` and `ADMIN_PASSWORD_HASH` env vars
- Session stored email only

**New:**
- Database-backed user accounts
- Anyone can sign up and create their own team
- Session stores: `userId`, `teamId`, `email`, `isAdmin`
- Default support account can be seeded via script

### API Changes

All server functions now require team context:
- `getTeamId()` helper extracts teamId from session
- All queries filter by `team_id` for authorization
- API routes check for teamId in session

### New Routes

- `/signup` - New account creation with team
- `/login` - Updated to link to signup, uses database auth

## Migration Steps

### 1. Run Database Migrations

Apply the SQL migration:

```bash
cd /Users/mukesh/.openclaw/workspace/content
npm run migrate
# OR manually apply drizzle-d1/0001_add_users_and_teams.sql
```

### 2. Seed Default Admin Account

Run the seed script to create the default support@userorbit.com account:

```bash
# Set required env vars
export CLOUDFLARE_ACCOUNT_ID=your_account_id
export CLOUDFLARE_D1_DATABASE_ID=your_database_id  
export CLOUDFLARE_API_TOKEN=your_api_token

# Run the seed script
node scripts/seed-admin.mjs
```

This creates:
- User: `support@userorbit.com` (admin)
- Team: "UserOrbit" 
- Membership: Owner role

**Password:** Use a unique password generated locally; never commit passwords or password hashes.

### 3. Update Environment Variables

Update `.env.local`:

```bash
# Remove (no longer needed):
# ADMIN_EMAIL=...
# ADMIN_PASSWORD_HASH=...

# Keep/Update:
SESSION_SECRET=your-session-secret

# Add (if not present):
CLOUDFLARE_ACCOUNT_ID=...
CLOUDFLARE_API_TOKEN=...
```

### 4. Deploy and Test

1. Deploy the code changes
2. Visit `/signup` to create a new account
3. Visit `/login` to log in with existing accounts
4. Test that data is properly scoped to teams

## Admin Credentials

Create an admin account with a unique password. Keep credentials in a password
manager or deployment secrets, and never commit passwords or password hashes.

Password hashes use the scrypt `salt:hash` format expected by `verifyPassword`.

## Rollback Plan

If needed, you can temporarily re-enable env-based auth by:

1. Setting `ADMIN_EMAIL` and `ADMIN_PASSWORD_HASH` in env
2. Modifying `app/server-fns/auth.ts` login function to check env vars as fallback

## Security Notes

1. All queries are now scoped by `team_id` for data isolation
2. Session uses encrypted cookies with `SESSION_SECRET`
3. Passwords are hashed with scrypt (salt:hash format)
4. Users can only access data from their own team(s)
5. Admin users (`is_admin=true`) can be granted additional permissions in the future

## Future Enhancements

Potential improvements:
- Team switching UI for users with multiple teams
- Invite users to existing teams
- Role-based permissions (owner/admin/member)
- Team settings and branding
- Audit logging
