// ABOUTME: Update existing v2 brand prompts in DB from the fixed markdown files.
// ABOUTME: Run with: tsx --env-file=.env.local scripts/update-v2-prompts.ts

import { readFileSync } from 'fs';
import {
  listBrandProfiles,
  updateBrandProfile,
} from '../lib/db';

const FILES: Record<string, string> = {
  'Marie LinkedIn v2': 'data/brand-prompts-v2/marie-linkedin.md',
  'Aakash Twitter v2': 'data/brand-prompts-v2/aakash-twitter.md',
  'UO Blog Social v2': 'data/brand-prompts-v2/uo-blog-social.md',
  'Company LinkedIn v2': 'data/brand-prompts-v2/company-linkedin.md',
};

async function run() {
  const brands = await listBrandProfiles();
  const v2 = brands.filter(b => b.name.endsWith(' v2'));

  for (const brand of v2) {
    const file = FILES[brand.name];
    if (!file) {
      console.log(`  Skipping ${brand.name} (no file mapping)`);
      continue;
    }
    const writingPrompt = readFileSync(file, 'utf-8');
    await updateBrandProfile(brand.id, brand.name, brand.voice, brand.audience, writingPrompt, Date.now());
    console.log(`  Updated ${brand.name} (${brand.id})`);
  }

  process.exit(0);
}

run().catch(err => { console.error(err); process.exit(1); });
