-- Migration: Add users, teams, and team_memberships tables
-- Also add team_id to all existing tables for multi-tenant support

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT,
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Teams table
CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Team memberships table
CREATE TABLE IF NOT EXISTS team_memberships (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'owner',
  created_at INTEGER NOT NULL
);

-- Add team_id to existing tables (will need migration of existing data)
-- For new multi-tenant support

-- Posts table - add team_id
ALTER TABLE posts ADD COLUMN team_id TEXT REFERENCES teams(id) ON DELETE CASCADE;

-- Ideas table - add team_id  
ALTER TABLE ideas ADD COLUMN team_id TEXT REFERENCES teams(id) ON DELETE CASCADE;

-- Templates table - add team_id
ALTER TABLE templates ADD COLUMN team_id TEXT REFERENCES teams(id) ON DELETE CASCADE;

-- Channels table - add team_id
ALTER TABLE channels ADD COLUMN team_id TEXT REFERENCES teams(id) ON DELETE CASCADE;

-- Brand profiles table - add team_id
ALTER TABLE brand_profiles ADD COLUMN team_id TEXT REFERENCES teams(id) ON DELETE CASCADE;

-- Remove unique constraint on templates.slug (now scoped by team)
-- Note: SQLite doesn't support DROP CONSTRAINT directly, so we need to recreate the table
-- This will be handled in application code with composite unique checks

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_teams_slug ON teams(slug);
CREATE INDEX IF NOT EXISTS idx_team_memberships_user ON team_memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_team_memberships_team ON team_memberships(team_id);
CREATE INDEX IF NOT EXISTS idx_posts_team ON posts(team_id);
CREATE INDEX IF NOT EXISTS idx_ideas_team ON ideas(team_id);
CREATE INDEX IF NOT EXISTS idx_templates_team ON templates(team_id);
CREATE INDEX IF NOT EXISTS idx_channels_team ON channels(team_id);
CREATE INDEX IF NOT EXISTS idx_brand_profiles_team ON brand_profiles(team_id);
