// ABOUTME: One-time seed script to import template markdown files into the database.
// ABOUTME: Run after the D1 runtime binding is configured for local scripts.

import fs from 'fs';
import path from 'path';
import { v4 as uuid } from 'uuid';
import { upsertTemplate } from '../lib/db';

const TEMPLATES_DIR = path.join(process.cwd(), 'data/templates');

function parseFilename(filename: string): { slug: string; category: string; name: string } {
  const base = filename.replace(/\.md$/, '');
  const parts = base.split('-');
  const categoryRaw = parts[1];
  const nameParts = parts.slice(2);
  const name = nameParts.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  const category = categoryRaw.charAt(0).toUpperCase() + categoryRaw.slice(1);
  return { slug: base, category, name };
}

async function run() {
  const files = fs.readdirSync(TEMPLATES_DIR)
    .filter(f => f.endsWith('.md') && f !== 'INDEX.md')
    .sort();

  console.log(`Seeding ${files.length} templates...`);
  const now = Date.now();

  for (const file of files) {
    const { slug, category, name } = parseFilename(file);
    const content = fs.readFileSync(path.join(TEMPLATES_DIR, file), 'utf-8');
    await upsertTemplate(uuid(), name, slug, category, content, now);
    console.log(`  ✓ ${name} (${category})`);
  }

  console.log('Done.');
  process.exit(0);
}

run().catch(err => { console.error(err); process.exit(1); });
