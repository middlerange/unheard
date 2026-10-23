import { assertNotSlackManagedPost } from '@/lib/slack-post-lock';
// ABOUTME: Converts an idea into a generated post using template + default brand voice.
// ABOUTME: Saves/updates a draft post keyed by idea id and optionally returns a cover suggestion prompt.

import { createFileRoute } from '@tanstack/react-router';
import OpenAI from 'openai';
import { z } from 'zod';
import { v4 as uuid } from 'uuid';
import { getRequestTeamId } from '@/lib/auth';
import {
  getIdea,
  listTemplates,
  getBrandProfile,
  getDefaultBrandProfile,
  getPostWithDetails,
  getDefaultChannelByPlatform,
  getChannelByPlatformAndGroup,
  insertPost,
  updatePost as dbUpdatePost,
  deletePostTargets,
  deletePostMedia,
  insertPostTarget,
  insertPostMedia,
} from '@/lib/db/queries';
import { splitIntoTweetChunks } from '@/lib/text';
import { maxCharacters } from '@/lib/twitter';
import { uploadFile } from '@/lib/storage';
import { noSlopRules } from '@/lib/writing-rules';

const ConvertIdeaInput = z.object({
  ideaId: z.string().min(1).optional(),
  sourceText: z.string().min(1).optional(),
  templateSlug: z.string().optional(),
  templateId: z.string().optional(),
  brandId: z.string().optional(),
  postId: z.string().optional(),
  model: z.string().optional(),
  cover: z.string().optional(),
  cover_style: z.string().optional(),
  channel_group: z.enum(['personal', 'company']).optional(),
  previewOnly: z.boolean().optional(),
}).refine(data => Boolean(data.ideaId || data.sourceText?.trim()), {
  message: 'ideaId or sourceText is required',
});

interface CoverSuggestion {
  title: string;
  description: string;
  prompt: string;
}

interface GeneratedCoverMedia {
  id: string;
  filename: string;
  path: string;
  url: string;
  type: 'image';
}

interface BrandContextInput {
  name: string;
  voice: string;
  audience: string;
  writing_prompt: string;
}

function parseTemplateReferences(text: string): string[] {
  const direct = text.match(/templates?\s*:\s*([^\n\r]+)/i)?.[1] ?? '';
  const directCodes = Array.from(direct.matchAll(/\b\d{3}\b/g)).map(match => match[0]);
  if (directCodes.length > 0) return directCodes;

  return Array.from(text.matchAll(/\b\d{3}\b/g)).map(match => match[0]);
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    const first = trimmed.indexOf('{');
    const last = trimmed.lastIndexOf('}');
    if (first < 0 || last <= first) return null;
    try {
      return JSON.parse(trimmed.slice(first, last + 1)) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function buildBrandContext(brand: BrandContextInput | null): string {
  return brand
    ? [
        `Brand: ${brand.name}`,
        brand.voice ? `Voice: ${brand.voice}` : '',
        brand.audience ? `Audience: ${brand.audience}` : '',
        brand.writing_prompt ? `Writing guidelines: ${brand.writing_prompt}` : '',
      ].filter(Boolean).join('\n')
    : 'No brand profile found. Use a clear, professional, practical tone.';
}

function buildTemplateContext(templateContent: string | undefined): string {
  return templateContent
    ? `Template structure to follow:\n${templateContent}`
    : 'No explicit template was matched. Use a strong hook, useful body, and clear CTA.';
}

async function generateLinkedInPost(
  model: string,
  ideaText: string,
  templateContent: string | undefined,
  brand: BrandContextInput | null,
): Promise<string> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const brandContext = buildBrandContext(brand);
  const templateContext = buildTemplateContext(templateContent);

  const response = await client.chat.completions.create({
    model,
    messages: [
      {
        role: 'system',
        content: `You write high-quality LinkedIn posts.
Return only post text.
Do not include labels, markdown headings, YAML, or analysis.
Keep the result under 3000 characters.

${noSlopRules}`,
      },
      {
        role: 'user',
        content: `Idea:\n${ideaText}\n\n${brandContext}\n\n${templateContext}`,
      },
    ],
    max_completion_tokens: 1400,
  });

  const content = response.choices[0]?.message?.content?.trim() ?? '';
  if (!content) throw new Error('AI returned empty content');
  return content;
}

async function generateTwitterThread(
  model: string,
  ideaText: string,
  templateContent: string | undefined,
  brand: BrandContextInput | null,
  twitterLimit: number,
): Promise<{ content: string; thread: string[] }> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const brandContext = buildBrandContext(brand);
  const templateContext = buildTemplateContext(templateContent);

  const response = await client.chat.completions.create({
    model,
    messages: [
      {
        role: 'system',
        content: `You write high-quality Twitter/X copy.
Return JSON only in this format:
{ "content": "first tweet", "thread": ["second tweet", "third tweet"] }
Rules:
- Every tweet must be <= ${twitterLimit} characters
- Split by paragraph boundaries whenever possible
- Do not cut a sentence in half unless one sentence alone exceeds ${twitterLimit} characters
- Keep it natural and concise for X
- Do not include labels, markdown headings, YAML, or analysis

${noSlopRules}`,
      },
      {
        role: 'user',
        content: `Idea:\n${ideaText}\n\n${brandContext}\n\n${templateContext}`,
      },
    ],
    response_format: { type: 'json_object' },
    max_completion_tokens: 1400,
  });

  const text = response.choices[0]?.message?.content ?? '';
  const parsed = parseJsonObject(text) as { content?: unknown; thread?: unknown } | null;
  const firstTweet = typeof parsed?.content === 'string' ? parsed.content.trim() : '';
  const rest = toStringArray(parsed?.thread).map(item => item.trim());

  const combined = [firstTweet, ...rest].filter(Boolean);
  if (combined.length === 0) {
    throw new Error('AI returned empty Twitter thread');
  }

  const normalized = combined.flatMap(item =>
    item.length <= twitterLimit ? [item] : splitIntoTweetChunks(item, twitterLimit)
  );

  return {
    content: normalized[0] ?? '',
    thread: normalized.slice(1),
  };
}

async function generateCoverSuggestion(
  model: string,
  content: string,
  cover: string,
  coverStyle?: string,
): Promise<CoverSuggestion | null> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const styleLine = coverStyle?.trim() ? `Preferred style: ${coverStyle.trim()}.` : '';

  const response = await client.chat.completions.create({
    model,
    messages: [
      {
        role: 'system',
        content: `Generate one cover-image suggestion for a social post.
Return JSON only in this shape:
{ "title": "...", "description": "...", "prompt": "..." }`,
      },
      {
        role: 'user',
        content: `Post content:\n${content}\n\nCover mode: ${cover}.\n${styleLine}\nMake the prompt production-ready for DALL-E 3.`,
      },
    ],
    response_format: { type: 'json_object' },
    max_completion_tokens: 700,
  });

  const text = response.choices[0]?.message?.content ?? '';
  const parsed = parseJsonObject(text) as { title?: unknown; description?: unknown; prompt?: unknown } | null;
  if (!parsed) return null;

  if (typeof parsed.title !== 'string' || typeof parsed.description !== 'string' || typeof parsed.prompt !== 'string') {
    return null;
  }

  return {
    title: parsed.title.trim(),
    description: parsed.description.trim(),
    prompt: parsed.prompt.trim(),
  };
}

function buildFallbackCoverPrompt(content: string, cover: string, coverStyle?: string): string {
  const styleLine = coverStyle?.trim() ? `Visual style: ${coverStyle.trim()}.` : '';
  return [
    'Create a polished 16:9 social media cover image.',
    `Theme: ${cover}.`,
    styleLine,
    `Post content:\n${content.slice(0, 1800)}`,
    'No text overlay, no logos, no watermarks. High contrast and visually striking.',
  ].filter(Boolean).join('\n\n');
}

async function generateCoverImage(prompt: string): Promise<GeneratedCoverMedia> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const result = await client.images.generate({
    model: 'dall-e-3',
    prompt,
    size: '1792x1024',
    n: 1,
  });

  const imageUrl = result.data?.[0]?.url;
  if (!imageUrl) throw new Error('DALL-E returned no image URL');

  const imageResponse = await fetch(imageUrl);
  if (!imageResponse.ok) throw new Error('Failed to fetch generated cover image');

  const buffer = Buffer.from(await imageResponse.arrayBuffer());
  const id = uuid();
  const path = `media/${id}.png`;
  const url = await uploadFile(path, buffer, 'image/png');

  return { id, filename: `${id}.png`, path, url, type: 'image' };
}

export const Route = createFileRoute('/api/ideas/convert-to-post')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const teamId = await getRequestTeamId(request);
        if (teamId instanceof Response) return teamId;

        const parsed = ConvertIdeaInput.safeParse(await request.json());
        if (!parsed.success) {
          return Response.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request body' }, { status: 400 });
        }

        const { ideaId, sourceText, templateSlug, templateId, brandId, postId: overridePostId, model, cover, cover_style, channel_group, previewOnly } = parsed.data;
        const idea = ideaId ? await getIdea(ideaId, teamId) : null;
        if (ideaId && !idea) return Response.json({ error: 'Idea not found' }, { status: 404 });
        if (!previewOnly && !idea) return Response.json({ error: 'ideaId is required when creating a post' }, { status: 400 });
        const ideaText = idea?.text ?? sourceText!.trim();

        const templates = await listTemplates(teamId);
        let matchedTemplate;
        if (templateId) {
          matchedTemplate = templates.find(t => t.id === templateId);
          if (!matchedTemplate) return Response.json({ error: 'Template not found' }, { status: 404 });
        } else if (templateSlug) {
          matchedTemplate = templates.find(t => t.slug === templateSlug || t.slug.startsWith(`${templateSlug}-`));
          if (!matchedTemplate) return Response.json({ error: `Template not found: ${templateSlug}` }, { status: 404 });
        } else {
          const refs = idea ? parseTemplateReferences(ideaText) : [];
          matchedTemplate = refs
            .map(ref => templates.find(t => t.slug.startsWith(`${ref}-`) || t.slug === ref))
            .find(Boolean) ?? (idea ? templates[0] : undefined);
        }

        const brand = brandId ? await getBrandProfile(brandId, teamId) : await getDefaultBrandProfile(teamId);
        if (brandId && !brand) return Response.json({ error: 'Brand voice not found' }, { status: 404 });
        const selectedModel = model?.trim() || 'gpt-4o-mini';

        try {
          const content = await generateLinkedInPost(
            selectedModel,
            ideaText,
            matchedTemplate?.content,
            brand ? {
              name: brand.name,
              voice: brand.voice,
              audience: brand.audience,
              writing_prompt: brand.writing_prompt,
            } : null,
          );

          let twitterContent = '';
          let twitterThread: string[] = [];
          const twitterLimit = maxCharacters();

          if (twitterLimit > 280) {
            twitterContent = content;
          } else {
            try {
              const generatedTwitter = await generateTwitterThread(
                selectedModel,
                ideaText,
                matchedTemplate?.content,
                brand ? {
                  name: brand.name,
                  voice: brand.voice,
                  audience: brand.audience,
                  writing_prompt: brand.writing_prompt,
                } : null,
                twitterLimit,
              );
              twitterContent = generatedTwitter.content;
              twitterThread = generatedTwitter.thread;
            } catch (twitterError) {
              console.warn('[convert-to-post] Twitter generation failed, using paragraph fallback split:', twitterError);
              const fallback = splitIntoTweetChunks(content, twitterLimit);
              twitterContent = fallback[0] ?? content.slice(0, twitterLimit);
              twitterThread = fallback.slice(1);
            }
          }

          if (previewOnly) {
            return Response.json({
              brand: brand ? { id: brand.id, name: brand.name } : null,
              targets: [
                { platform: 'linkedin', content, thread: [] },
                { platform: 'twitter', content: twitterContent, thread: twitterThread },
              ],
              templateUsed: matchedTemplate?.slug ?? '',
            });
          }

          const postId = overridePostId || idea!.id;
          const now = Date.now();
          const group = channel_group ?? 'personal';
          const existingPost = await getPostWithDetails(postId, teamId);
          if (existingPost) {
            await assertNotSlackManagedPost(postId, teamId);
            await dbUpdatePost(postId, teamId, 'draft', null, now, channel_group ?? existingPost.channel_group, matchedTemplate?.id ?? null, brand?.writing_prompt ?? null, idea!.id, brand?.id ?? null);
            await deletePostTargets(postId);
            await deletePostMedia(postId);
          } else {
            await insertPost(postId, teamId, 'draft', null, now, group, matchedTemplate?.id ?? null, brand?.writing_prompt ?? null, idea!.id, brand?.id ?? null);
          }

          const resolveChannel = (platform: 'linkedin' | 'twitter') =>
            channel_group
              ? getChannelByPlatformAndGroup(teamId, platform, channel_group)
              : getDefaultChannelByPlatform(teamId, platform);

          const [linkedinChannel, twitterChannel] = await Promise.all([
            resolveChannel('linkedin'),
            resolveChannel('twitter'),
          ]);

          await Promise.all([
            insertPostTarget(uuid(), postId, linkedinChannel?.id ?? null, 'linkedin', content, 'everyone', false, null, null),
            insertPostTarget(uuid(), postId, twitterChannel?.id ?? null, 'twitter', twitterContent, 'everyone', false, null, twitterThread),
          ]);

          let coverImageSuggestion: CoverSuggestion | null = null;
          let generatedMedia: GeneratedCoverMedia[] = [];
          if (cover?.trim()) {
            const coverMode = cover.trim();
            coverImageSuggestion = await generateCoverSuggestion(selectedModel, content, coverMode, cover_style);
            const coverPrompt = coverImageSuggestion?.prompt || buildFallbackCoverPrompt(content, coverMode, cover_style);

            try {
              const coverMedia = await generateCoverImage(coverPrompt);
              await insertPostMedia(
                coverMedia.id,
                postId,
                null,
                coverMedia.filename,
                coverMedia.path,
                coverMedia.url,
                coverMedia.type,
              );
              generatedMedia = [coverMedia];
            } catch (coverError) {
              console.warn('[convert-to-post] Cover image generation failed:', coverError);
            }
          }

          const fullThread = [twitterContent, ...twitterThread].filter(Boolean);

          return Response.json({
            content,
            thread: fullThread,
            id: postId,
            templateUsed: matchedTemplate?.slug ?? '',
            media: generatedMedia,
            coverImageSuggestion,
            brand: brand ? { id: brand.id, name: brand.name } : null,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to convert idea to post';
          return Response.json({ error: message }, { status: 500 });
        }
      },
    },
  },
});
