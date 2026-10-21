// ABOUTME: Quick script to list all brand profiles and their writing prompts.
// ABOUTME: Run with: tsx --env-file=.env.local scripts/list-brands.ts

import { listBrandProfiles } from '../lib/db';

async function run() {
  const brands = await listBrandProfiles();
  for (const b of brands) {
    console.log('---');
    console.log('ID:', b.id);
    console.log('Name:', b.name);
    console.log('Default:', b.is_default);
    console.log('Voice:', b.voice || '(empty)');
    console.log('Audience:', b.audience || '(empty)');
    console.log('Writing Prompt Length:', b.writing_prompt?.length ?? 0);
    console.log('Writing Prompt:\n' + (b.writing_prompt || '(empty)'));
  }
  console.log('---');
  console.log('Total brands:', brands.length);
  process.exit(0);
}

run().catch(err => { console.error(err); process.exit(1); });
