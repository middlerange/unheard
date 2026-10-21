// ABOUTME: Drizzle Kit configuration for D1 schema migrations.
// ABOUTME: Points to lib/schema.ts and outputs SQLite SQL to drizzle-d1/.

import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './lib/schema.ts',
  out: './drizzle-d1',
  dialect: 'sqlite',
});
