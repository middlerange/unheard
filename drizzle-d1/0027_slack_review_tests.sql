ALTER TABLE posts ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0;
ALTER TABLE research_drafts ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0;

CREATE TRIGGER posts_test_marker_immutable
BEFORE UPDATE OF is_test ON posts
WHEN NEW.is_test <> OLD.is_test
BEGIN
  SELECT RAISE(ABORT, 'Test post marker cannot be changed');
END;

CREATE TRIGGER research_drafts_test_marker_immutable
BEFORE UPDATE OF is_test ON research_drafts
WHEN NEW.is_test <> OLD.is_test
BEGIN
  SELECT RAISE(ABORT, 'Test review marker cannot be changed');
END;
