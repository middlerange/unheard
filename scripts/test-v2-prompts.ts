// ABOUTME: Generate and save draft posts from an idea using the v2 brand prompts.
// ABOUTME: Run with: tsx --env-file=.env.local scripts/test-v2-prompts.ts

import { readFileSync } from 'fs';
import { v4 as uuid } from 'uuid';
import OpenAI from 'openai';
import {
  listBrandProfiles,
  listIdeas,
  insertPost,
  insertPostTarget,
  getDefaultChannelByPlatform,
} from '../lib/db';
import { splitIntoTweetChunks } from '../lib/text';

const noSlopRules = readFileSync('data/writing-prompts/no-slop.md', 'utf-8');
const TWITTER_LIMIT = 280;

interface BrandCtx {
  name: string;
  voice: string;
  audience: string;
  writing_prompt: string;
}

function buildBrandContext(b: BrandCtx): string {
  return [
    `Brand: ${b.name}`,
    b.voice ? `Voice: ${b.voice}` : '',
    b.audience ? `Audience: ${b.audience}` : '',
    b.writing_prompt ? `Writing guidelines: ${b.writing_prompt}` : '',
  ].filter(Boolean).join('\n');
}

async function generateLinkedIn(client: OpenAI, model: string, ideaText: string, brand: BrandCtx): Promise<string> {
  const response = await client.chat.completions.create({
    model,
    messages: [
      {
        role: 'system',
        content: `You write high-quality LinkedIn posts.\nReturn only post text.\nDo not include labels, markdown headings, YAML, or analysis.\nKeep the result under 3000 characters.\n\n${noSlopRules}`,
      },
      { role: 'user', content: `Idea:\n${ideaText}\n\n${buildBrandContext(brand)}` },
    ],
    max_completion_tokens: 1400,
  });
  const content = response.choices[0]?.message?.content?.trim() ?? '';
  if (!content) throw new Error('AI returned empty LinkedIn content');
  return content;
}

async function generateTwitter(client: OpenAI, model: string, ideaText: string, brand: BrandCtx): Promise<{ content: string; thread: string[] }> {
  const response = await client.chat.completions.create({
    model,
    messages: [
      {
        role: 'system',
        content: `You write high-quality Twitter/X copy.\nReturn JSON only in this format:\n{ "content": "first tweet", "thread": ["second tweet", "third tweet"] }\nRules:\n- Every tweet must be <= ${TWITTER_LIMIT} characters\n- Split by paragraph boundaries whenever possible\n- Do not cut a sentence in half unless one sentence alone exceeds ${TWITTER_LIMIT} characters\n- Keep it natural and concise for X\n- Do not include labels, markdown headings, YAML, or analysis\n\n${noSlopRules}`,
      },
      { role: 'user', content: `Idea:\n${ideaText}\n\n${buildBrandContext(brand)}` },
    ],
    response_format: { type: 'json_object' },
    max_completion_tokens: 1400,
  });

  const text = response.choices[0]?.message?.content ?? '';
  let parsed: { content?: string; thread?: string[] };
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Failed to parse Twitter JSON');
  }

  const firstTweet = typeof parsed.content === 'string' ? parsed.content.trim() : '';
  const rest = Array.isArray(parsed.thread) ? parsed.thread.map(t => t.trim()).filter(Boolean) : [];
  const combined = [firstTweet, ...rest].filter(Boolean);
  if (combined.length === 0) throw new Error('AI returned empty Twitter thread');

  const normalized = combined.flatMap(item =>
    item.length <= TWITTER_LIMIT ? [item] : splitIntoTweetChunks(item, TWITTER_LIMIT)
  );

  return { content: normalized[0] ?? '', thread: normalized.slice(1) };
}

async function run() {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const model = 'gpt-4o-mini';

  // 1. Find v2 brands (already in DB)
  const allBrands = await listBrandProfiles();
  const v2Brands = allBrands.filter(b => b.name.endsWith(' v2'));
  if (v2Brands.length === 0) {
    console.error('No v2 brands found in DB. Push them first.');
    process.exit(1);
  }
  console.log(`Found ${v2Brands.length} v2 brands\n`);

  // 2. Pick an open idea
  const ideas = await listIdeas();
  const openIdeas = ideas.filter(i => i.status === 'open');
  if (openIdeas.length === 0) {
    console.error('No open ideas found.');
    process.exit(1);
  }
  const idea = openIdeas[0];
  console.log(`Idea: "${idea.text.slice(0, 200)}${idea.text.length > 200 ? '...' : ''}"\n`);

  // 3. For each brand: generate LinkedIn + Twitter, save as draft post
  for (const brand of v2Brands) {
    console.log(`${'─'.repeat(60)}`);
    console.log(`  ${brand.name}`);
    console.log(`${'─'.repeat(60)}`);

    const brandCtx: BrandCtx = {
      name: brand.name,
      voice: brand.voice,
      audience: brand.audience,
      writing_prompt: brand.writing_prompt,
    };

    // Generate both platforms
    console.log('  Generating LinkedIn...');
    const linkedinContent = await generateLinkedIn(client, model, idea.text, brandCtx);

    console.log('  Generating Twitter...');
    let twitterContent: string;
    let twitterThread: string[];
    try {
      const tw = await generateTwitter(client, model, idea.text, brandCtx);
      twitterContent = tw.content;
      twitterThread = tw.thread;
    } catch (err) {
      console.warn('  Twitter generation failed, falling back to split:', err);
      const fallback = splitIntoTweetChunks(linkedinContent, TWITTER_LIMIT);
      twitterContent = fallback[0] ?? linkedinContent.slice(0, TWITTER_LIMIT);
      twitterThread = fallback.slice(1);
    }

    // Save to DB as draft
    const postId = uuid();
    const now = Date.now();
    const [linkedinChannel, twitterChannel] = await Promise.all([
      getDefaultChannelByPlatform('linkedin'),
      getDefaultChannelByPlatform('twitter'),
    ]);
    await insertPost(postId, 'draft', null, now, 'personal', null, brand.name);
    await Promise.all([
      insertPostTarget(uuid(), postId, linkedinChannel?.id ?? null, 'linkedin', linkedinContent, 'everyone', false, null, null),
      insertPostTarget(uuid(), postId, twitterChannel?.id ?? null, 'twitter', twitterContent, 'everyone', false, null, twitterThread),
    ]);

    console.log(`  Saved post ${postId}\n`);

    // Print content
    console.log('  [LinkedIn]');
    console.log(linkedinContent);
    console.log('');
    console.log('  [Twitter]');
    console.log(`  1/ ${twitterContent}`);
    twitterThread.forEach((t, i) => console.log(`  ${i + 2}/ ${t}`));
    console.log('');
  }

  console.log(`${'═'.repeat(60)}`);
  console.log(`Done. ${v2Brands.length} draft posts created from idea "${idea.text.slice(0, 80)}..."`);
  process.exit(0);
}

run().catch(err => { console.error(err); process.exit(1); });
