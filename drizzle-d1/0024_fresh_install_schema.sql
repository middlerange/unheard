-- Analytics was previously created outside the D1 migration chain.
CREATE TABLE IF NOT EXISTS analytics (
  id TEXT PRIMARY KEY NOT NULL,
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES post_targets(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  impressions INTEGER NOT NULL DEFAULT 0,
  engagements INTEGER NOT NULL DEFAULT 0,
  likes INTEGER NOT NULL DEFAULT 0,
  comments INTEGER NOT NULL DEFAULT 0,
  shares INTEGER NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  recorded_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_analytics_post ON analytics(post_id);
CREATE INDEX IF NOT EXISTS idx_analytics_target ON analytics(target_id);

-- Templates belong to a team; a global slug constraint blocks other teams
-- from using the same starter templates.
DROP INDEX IF EXISTS templates_slug_unique;
