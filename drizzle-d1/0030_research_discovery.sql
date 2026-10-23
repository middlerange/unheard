ALTER TABLE research_runs ADD COLUMN diagnostics TEXT NOT NULL DEFAULT '{}';
ALTER TABLE research_items ADD COLUMN content_provenance TEXT NOT NULL DEFAULT 'unknown';
UPDATE research_items SET content_provenance = CASE
 WHEN content_type = 'video' AND transcript_status = 'available' THEN 'transcript'
 WHEN content IS NOT NULL AND content_type = 'article' THEN 'article'
 ELSE 'unknown' END;
