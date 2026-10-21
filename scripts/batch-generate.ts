// ABOUTME: Generates a draft post for every brand profile writing prompt, for comparison.
// ABOUTME: Run with: tsx --env-file=.env.local scripts/batch-generate.ts

import { v4 as uuid } from 'uuid';
import OpenAI from 'openai';
import {
  listBrandProfiles,
  insertPost,
  insertPostTarget,
  getDefaultChannelByPlatform,
  insertIdea,
  getIdea,
  type BrandProfile,
} from '../lib/db';

const IDEA_TEXT = `[P7 Help Center] "How we index a help center article against the actual codebase"
Angle: Technical walk-through — parsing article content, mapping to routes/components, scoring alignment.
Templates: 008 (Feature Deep-Dive), 018 (Behind-the-Scenes)
Hook: Technical transparency`;

const MODEL = 'gpt-4o-mini';
const CONCURRENCY = 3;

async function generatePost(
  client: OpenAI,
  ideaText: string,
  brand: BrandProfile,
): Promise<string> {
  const systemPrompt = brand.writing_prompt || 'You write high-quality LinkedIn posts. Return only post text.';

  const response = await client.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `Write a LinkedIn post based on this idea. Return only the post text, no labels or meta.\n\nIdea:\n${ideaText}`,
      },
    ],
    max_completion_tokens: 1400,
  });

  return response.choices[0]?.message?.content?.trim() ?? '';
}

async function processBatch<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
  }
  return results;
}

async function run() {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const brands = await listBrandProfiles();

  console.log(`Brand profiles: ${brands.length}`);
  console.log(`Model: ${MODEL}`);
  console.log(`Idea: ${IDEA_TEXT.slice(0, 80)}...`);
  console.log('---');

  const ideaId = uuid();
  const existing = await getIdea(ideaId);
  if (!existing) {
    await insertIdea(ideaId, IDEA_TEXT, Date.now());
    console.log(`Created idea: ${ideaId}`);
  }

  const results: { brandName: string; brandId: string; postId: string; content: string }[] = [];

  await processBatch(brands, CONCURRENCY, async (brand) => {
    process.stdout.write(`Generating: ${brand.name}...`);

    try {
      const content = await generatePost(client, IDEA_TEXT, brand);
      const postId = uuid();
      const now = Date.now();
      const [linkedinChannel, twitterChannel] = await Promise.all([
        getDefaultChannelByPlatform('linkedin'),
        getDefaultChannelByPlatform('twitter'),
      ]);

      await insertPost(postId, 'draft', null, now, 'personal');
      await insertPostTarget(uuid(), postId, linkedinChannel?.id ?? null, 'linkedin', content, 'everyone', false, null, null);
      await insertPostTarget(uuid(), postId, twitterChannel?.id ?? null, 'twitter', content, 'everyone', false, null, null);

      results.push({ brandName: brand.name, brandId: brand.id, postId, content });
      console.log(` done (${content.length} chars)`);
    } catch (err) {
      console.log(` FAILED: ${err instanceof Error ? err.message : err}`);
    }
  });

  console.log('\n=== RESULTS ===\n');
  for (const r of results) {
    console.log(`--- ${r.brandName} | brand:${r.brandId} | post:${r.postId} ---`);
    console.log(r.content);
    console.log('');
  }

  console.log(`\nGenerated ${results.length}/${brands.length} drafts.`);
  console.log(`Idea ID: ${ideaId}`);
  process.exit(0);
}

run().catch(err => { console.error(err); process.exit(1); });
