// ABOUTME: Entry point for database functionality.
// ABOUTME: Re-exports types for both client/server, and queries for server-only.

export * from './types';

// We don't export queries here to avoid accidentally pulling 'drizzle-orm' and 'd1' into client bundles.
// Server-side code should import from '@/lib/db/queries' directly.
