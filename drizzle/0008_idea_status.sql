ALTER TABLE ideas ADD COLUMN status text NOT NULL DEFAULT 'open';
ALTER TABLE ideas ADD CONSTRAINT ideas_status_check CHECK (status IN ('open', 'closed'));
