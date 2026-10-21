// ABOUTME: Quick D1 smoke test that prints the latest posts from the bound local database.
// ABOUTME: Run with: wrangler d1 execute content-hub --local --command "SELECT id, idea_id, template_id, writing_prompt FROM posts ORDER BY created_at DESC LIMIT 5"

console.log('Use wrangler d1 execute to inspect the D1 database.');
