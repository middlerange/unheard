// ABOUTME: Tool definitions for the AI chat assistant.
// ABOUTME: Each tool defines schema + server-side execution for use with TanStack AI chat().

import { z } from 'zod';
import { v4 as uuid } from 'uuid';
import OpenAI from 'openai';
import { listTemplates, listPostsWithDetails, insertPost, insertPostTarget, insertIdea, updatePost, getDefaultChannelByPlatform, getChannelByPlatformAndGroup, type BrandProfile } from '@/lib/db/queries';
import { noSlopRules } from '@/lib/writing-rules';
import { findNextOpenSlot } from '@/lib/scheduling';
import { uploadFile } from '@/lib/storage';
import { maxCharacters } from '@/lib/twitter';
import { getSession } from '@/lib/auth';

export interface PostSuggestion {
  templateId?: string;
  templateName: string;
  content: string;
  thread: string[];
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace < 0 || lastBrace <= firstBrace) return null;
    try {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1)) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(item => typeof item === 'string');
}

export function convertToTwitter(brand: BrandProfile | null) {
  let brandInstructions = '';
  if (brand) {
    brandInstructions = `\nBrand voice: ${brand.voice}\nTarget audience: ${brand.audience}`;
    if (brand.writing_prompt) brandInstructions += `\nWriting guidelines: ${brand.writing_prompt}`;
    brandInstructions += '\nApply this voice and style to all tweets.\n';
  }

  return {
    name: 'convertToTwitter' as const,
    description: 'Rewrite content as punchy tweets. Splits into a thread if needed.',
    inputSchema: z.object({
      content: z.string(),
    }),
    async execute(args: { content: string }) {
      const twitterLimit = maxCharacters();
      const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const response = await client.chat.completions.create({
        model: 'gpt-4.1-mini',
        messages: [
          {
            role: 'system' as const,
            content: `You rewrite content for Twitter/X. Rules:
- Each tweet must be under ${twitterLimit} characters
- If the content needs multiple tweets, split into a thread
- Make it punchy, engaging, and natural
- Return JSON: { "content": "first tweet text", "thread": ["second tweet", "third tweet", ...] }
- If it fits in one tweet, return an empty thread array
- If the limit is above 280 characters, prefer one post with an empty thread unless a thread is clearly necessary
- Never use hashtags unless the original content has them
${brandInstructions}
${noSlopRules}`,
          },
          { role: 'user' as const, content: args.content },
        ],
        response_format: { type: 'json_object' as const },
        max_completion_tokens: 1000,
      });

      const text = response.choices[0]?.message?.content ?? '';
      const parsed = parseJsonObject(text) as { content?: unknown; thread?: unknown } | null;
      const content = typeof parsed?.content === 'string' ? parsed.content : args.content.slice(0, twitterLimit);
      const thread = toStringArray(parsed?.thread);

      if (twitterLimit > 280) {
        const merged = [content, ...thread].map(item => item.trim()).filter(Boolean).join('\n\n');
        if (merged.length <= twitterLimit) {
          return { content: merged, thread: [] };
        }
      }

      return {
        content,
        thread,
      };
    },
  };
}

export async function generatePostSuggestions(args: {
  content: string;
  brand: BrandProfile | null;
  teamId: string;
  templateId?: string;
  writingPrompt?: string;
}): Promise<{ suggestions: PostSuggestion[]; error?: string }> {
  const { content, brand, teamId, templateId, writingPrompt } = args;
  let brandInstructions = '';
  if (brand) {
    brandInstructions = `\nBrand voice: ${brand.voice}\nTarget audience: ${brand.audience}`;
    if (brand.writing_prompt) brandInstructions += `\nWriting guidelines: ${brand.writing_prompt}`;
    brandInstructions += '\nApply this voice and style to all suggested posts.\n';
  }

  const isFreeform = templateId === 'freeform';
  const isAuto = templateId === 'auto' || !templateId;

  let systemContent: string;

  if (isFreeform) {
    let freeformInstruction = `You are a social media content strategist. Write 2-3 post drafts based on the idea. No template structure — write naturally.`;
    if (writingPrompt) freeformInstruction += `\n\nAdditional writing instructions: ${writingPrompt}`;
    systemContent = `${freeformInstruction}
${brandInstructions}
Return JSON: { "suggestions": [{ "templateName": "Free-form", "content": "full post text", "thread": [] }] }
- "content" is the complete post body — do NOT split it across multiple fields
- "thread" should always be an empty array unless the content naturally works as a Twitter thread
- Keep "content" under 3000 characters (LinkedIn limit) unless the user explicitly asks for longer content
- Make posts punchy and engaging
- Do NOT end posts with engagement questions like "What's your approach?", "I'd love to hear your thoughts", "Comment below", or similar calls to action asking readers to respond

${noSlopRules}`;
  } else {
    const allTemplates = await listTemplates(teamId);
    const templates = !isAuto && templateId
      ? allTemplates.filter(t => t.id === templateId)
      : allTemplates;
    const templateDescriptions = templates.map(t => `- id:${t.id} name:"${t.name}" (${t.category}): ${t.content}`).join('\n');

    const selectionInstruction = !isAuto && templateId
      ? 'Use the provided template and write one draft post.'
      : 'Pick the 2-3 templates that best fit and write a draft post for each.';

    systemContent = `You are a social media content strategist. Given an idea and a list of templates, ${selectionInstruction}

Available templates:
${templateDescriptions}
${brandInstructions}
Return JSON: { "suggestions": [{ "templateId": "<exact id from list>", "templateName": "...", "content": "full post text", "thread": [] }] }
- "templateId" MUST be the exact id string from the template list (e.g. "14f8cb75-e288-4eb5-9500-54c68caa419b")
- "content" is the complete post body — do NOT split it across multiple fields
- "thread" should always be an empty array unless the template explicitly calls for a Twitter thread format
- Keep "content" under 3000 characters (LinkedIn limit) unless the user explicitly asks for longer content
- Make posts punchy and engaging
- CRITICAL: Do NOT include template structural labels like [HEADLINE], [HOOK], [CTA], [PROBLEM], [SOLUTION], [HASHTAGS], or any other [LABEL] markers in the output. Templates use these as structural guides only — write the actual post content without them.
- Do NOT include YAML frontmatter separators (---) in the output
- Do NOT end posts with engagement questions like "What's your approach?", "I'd love to hear your thoughts", "Comment below", or similar calls to action asking readers to respond

${noSlopRules}`;
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await client.chat.completions.create({
    model: 'gpt-4.1-mini',
    messages: [
      {
        role: 'system' as const,
        content: systemContent,
      },
      { role: 'user' as const, content },
    ],
    response_format: { type: 'json_object' as const },
    max_completion_tokens: 2000,
  });

  const text = response.choices[0]?.message?.content ?? '';
  const parsed = parseJsonObject(text) as { suggestions?: unknown } | null;

  if (!parsed || !Array.isArray(parsed.suggestions)) {
    console.error('[suggestPosts] templateId:', templateId, 'raw output:', JSON.stringify(text).slice(0, 500));
  }

  const suggestions = Array.isArray(parsed?.suggestions)
    ? parsed.suggestions
        .filter((item): item is { templateId?: unknown; templateName?: unknown; content?: unknown; thread?: unknown } =>
          !!item && typeof item === 'object')
        .map(item => ({
          templateId: typeof item.templateId === 'string' ? item.templateId : undefined,
          templateName: typeof item.templateName === 'string' ? item.templateName : 'Draft',
          content: typeof item.content === 'string' ? item.content : '',
          thread: toStringArray(item.thread),
        }))
        .filter(item => item.content.trim().length > 0)
    : [];

  if (suggestions.length > 0) {
    return { suggestions };
  }

  return {
    suggestions: [],
    error: 'Model returned invalid JSON while generating suggestions. Please try again.',
  };
}

export function suggestPosts(brand: BrandProfile | null, teamId: string, templateId?: string, writingPrompt?: string) {
  return {
    name: 'suggestPosts' as const,
    description: 'Generate 2-3 post drafts from templates that best match an idea.',
    inputSchema: z.object({
      content: z.string(),
    }),
    async execute(args: { content: string }) {
      return generatePostSuggestions({
        content: args.content,
        brand,
        teamId,
        templateId,
        writingPrompt,
      });
    },
  };
}

export function suggestCoverImages(_brand: BrandProfile | null) {
  return {
    name: 'suggestCoverImages' as const,
    description: 'Generate cover/banner image ideas for a post — a mix of serious and meme concepts.',
    inputSchema: z.object({
      content: z.string(),
    }),
    async execute(args: { content: string }) {
      const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const response = await client.chat.completions.create({
        model: 'gpt-4.1-mini',
        messages: [
          {
            role: 'system' as const,
            content: `You generate cover image ideas for social media posts.
Given a post, produce 2-3 serious ideas and 1-2 meme/humorous ideas.
Return JSON: { "suggestions": [{ "title": "short title", "description": "what the image looks like", "prompt": "detailed DALL-E prompt", "type": "serious" | "meme" }] }
- Prompts should be vivid and specific, suitable for DALL-E 3
- Serious images should be professional and visually striking
- Meme images should be funny and relevant to the post content`,
          },
          { role: 'user' as const, content: args.content },
        ],
        response_format: { type: 'json_object' as const },
        max_completion_tokens: 1200,
      });

      const text = response.choices[0]?.message?.content ?? '';
      const parsed = parseJsonObject(text) as { suggestions?: unknown } | null;

      const suggestions = Array.isArray(parsed?.suggestions)
        ? parsed.suggestions
            .filter((item): item is { title?: unknown; description?: unknown; prompt?: unknown; type?: unknown } =>
              !!item && typeof item === 'object')
            .map(item => ({
              title: typeof item.title === 'string' ? item.title : 'Cover image',
              description: typeof item.description === 'string' ? item.description : '',
              prompt: typeof item.prompt === 'string' ? item.prompt : '',
              type: item.type === 'meme' ? 'meme' : 'serious',
            }))
            .filter(item => item.prompt.trim().length > 0)
        : [];

      return { suggestions };
    },
  };
}

export function generateCoverImage(_brand: BrandProfile | null) {
  return {
    name: 'generateCoverImage' as const,
    description: 'Generate a cover image using DALL-E 3 and upload it to storage.',
    inputSchema: z.object({
      prompt: z.string(),
      title: z.string(),
    }),
    async execute(args: { prompt: string; title: string }) {
      const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const result = await client.images.generate({
        model: 'dall-e-3',
        prompt: args.prompt,
        size: '1792x1024',
        n: 1,
      });

      const imageUrl = result.data?.[0]?.url;
      if (!imageUrl) throw new Error('DALL-E returned no image URL');

      const imageResponse = await fetch(imageUrl);
      if (!imageResponse.ok) throw new Error('Failed to fetch generated image');

      const buffer = Buffer.from(await imageResponse.arrayBuffer());
      const id = uuid();
      const path = `media/${id}.png`;
      const url = await uploadFile(path, buffer, 'image/png');

      return { id, filename: `${id}.png`, path, url, type: 'image' as const, title: args.title };
    },
  };
}

export const schedulePost = {
  name: 'schedulePost' as const,
  description: 'Schedule a post for the next available time slot (9am, 1pm, or 5pm) on both Twitter and LinkedIn.',
  inputSchema: z.object({
    content: z.string(),
    thread: z.array(z.string()).optional(),
    channel_group: z.enum(['personal', 'company']).nullable().optional(),
    twitter_content: z.string().optional(),
    twitter_thread: z.array(z.string()).optional(),
  }),
  async execute(args: { content: string; thread?: string[]; channel_group?: 'personal' | 'company'; twitter_content?: string; twitter_thread?: string[] }) {
    const session = await getSession();
    const teamId = session.data.teamId;
    if (!teamId) throw new Error('No team selected');

    const existing = await listPostsWithDetails(teamId, ['scheduled', 'published']);
    const occupied = new Set(existing.filter(p => p.publish_at).map(p => p.publish_at!));
    const slotDate = findNextOpenSlot(occupied);

    const postId = uuid();
    const now = Date.now();
    const publishAt = slotDate.getTime();
    const group = args.channel_group ?? 'personal';

    await insertPost(postId, teamId, 'scheduled', publishAt, now, group);
    const [twitterChannel, linkedinChannel] = await Promise.all([
      getChannelByPlatformAndGroup(teamId, 'twitter', group),
      getChannelByPlatformAndGroup(teamId, 'linkedin', group),
    ]);

    const twitterContent = args.twitter_content ?? args.content;
    const twitterThread = args.twitter_thread ?? args.thread ?? null;

    await Promise.all([
      insertPostTarget(uuid(), postId, twitterChannel?.id ?? null, 'twitter', twitterContent, 'everyone', false, null, twitterThread),
      insertPostTarget(uuid(), postId, linkedinChannel?.id ?? null, 'linkedin', args.content, 'everyone', false, null, null),
    ]);

    return {
      postId,
      scheduledAt: slotDate.toISOString(),
      scheduledDisplay: slotDate.toLocaleString('en-US', {
        weekday: 'short', month: 'short', day: 'numeric',
        hour: 'numeric', minute: '2-digit', hour12: true,
      }),
    };
  },
};

export function createPost(brand: BrandProfile | null) {
  return {
    name: 'createPost' as const,
    description: 'Generate a full post from an outline using AI (brand voice + template), optionally schedule it.',
    inputSchema: z.object({
      outline: z.string(),
      template_slug: z.string().optional(),
      channel_group: z.enum(['personal', 'company']).nullable().optional(),
      schedule: z.boolean().optional(),
    }),
    async execute(args: { outline: string; template_slug?: string; channel_group?: string; schedule?: boolean }) {
      const session = await getSession();
      const teamId = session.data.teamId;
      if (!teamId) throw new Error('No team selected');

      const ideaId = uuid();
      const now = Date.now();
      await insertIdea(ideaId, teamId, args.outline, now);

      const templates = await listTemplates(teamId);
      const selectedTemplate = args.template_slug
        ? templates.find(template => template.slug === args.template_slug || template.slug.startsWith(`${args.template_slug}-`))
        : undefined;
      if (args.template_slug && !selectedTemplate) {
        throw new Error(`Template not found: ${args.template_slug}`);
      }

      const generated = await generatePostSuggestions({
        content: args.outline,
        brand,
        teamId,
        templateId: selectedTemplate?.id ?? 'auto',
      });
      const suggestion = generated.suggestions[0];
      if (!suggestion) {
        throw new Error(generated.error ?? 'No post suggestion generated');
      }

      const postId = uuid();
      const group = args.channel_group ?? 'personal';
      await insertPost(postId, teamId, 'draft', null, now, group, suggestion.templateId ?? selectedTemplate?.id ?? null, brand?.writing_prompt ?? null, ideaId, brand?.id ?? null);

      const [linkedinChannel, twitterChannel] = await Promise.all([
        getChannelByPlatformAndGroup(teamId, 'linkedin', group),
        getChannelByPlatformAndGroup(teamId, 'twitter', group),
      ]);

      await insertPostTarget(uuid(), postId, linkedinChannel?.id ?? null, 'linkedin', suggestion.content, 'everyone', false, null, []);
      const twitter = await convertToTwitter(brand).execute({ content: suggestion.content });
      await insertPostTarget(uuid(), postId, twitterChannel?.id ?? null, 'twitter', twitter.content, 'everyone', false, null, twitter.thread);

      const post = {
        id: postId,
        content: suggestion.content,
        thread: twitter.thread,
        templateUsed: suggestion.templateName,
      };

      if (!args.schedule) {
        return { postId: post.id, content: post.content, thread: post.thread, templateUsed: post.templateUsed };
      }

      const existing = await listPostsWithDetails(teamId, ['scheduled', 'published']);
      const occupied = new Set(existing.filter(p => p.publish_at).map(p => p.publish_at!));
      const slotDate = findNextOpenSlot(occupied);
      await updatePost(post.id, teamId, 'scheduled', slotDate.getTime(), Date.now(), group, suggestion.templateId ?? selectedTemplate?.id ?? null, brand?.writing_prompt ?? null, ideaId);

      return {
        postId: post.id,
        content: post.content,
        thread: post.thread,
        templateUsed: post.templateUsed,
        scheduledAt: slotDate.toISOString(),
        scheduledDisplay: slotDate.toLocaleString('en-US', {
          weekday: 'short', month: 'short', day: 'numeric',
          hour: 'numeric', minute: '2-digit', hour12: true,
        }),
      };
    },
  };
}

// Issue #6: AI Content Assistant Tools
export const suggestHashtags = {
  name: 'suggestHashtags' as const,
  description: 'Suggest relevant hashtags for the given content to improve discoverability and engagement.',
  inputSchema: z.object({
    content: z.string(),
    platform: z.enum(['twitter', 'linkedin', 'instagram', 'facebook', 'youtube', 'reddit', 'discord']).optional(),
    count: z.number().min(3).max(10).default(5),
  }),
  async execute(args: { content: string; platform?: string; count: number }) {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    
    const platformContext = args.platform ? `for ${args.platform}` : 'for social media';
    const prompt = `Given this content, suggest ${args.count} relevant hashtags ${platformContext}:

Content: """${args.content}"""

Return ONLY the hashtags, comma-separated, no explanations`;

    const result = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
    });

    const hashtags = result.choices[0]?.message?.content?.trim() || '';
    const cleaned = hashtags.split(',').map(h => h.trim()).filter(Boolean);

    return { hashtags: cleaned };
  },
};

export const rewriteForPlatform = {
  name: 'rewriteForPlatform' as const,
  description: 'Rewrite content to be optimized for a specific social media platform.',
  inputSchema: z.object({
    content: z.string(),
    platform: z.enum(['twitter', 'linkedin', 'instagram', 'facebook', 'youtube', 'reddit', 'discord']),
    tone: z.enum(['professional', 'casual', 'witty', 'promotional']).optional(),
  }),
  async execute(args: { content: string; platform: string; tone?: string }) {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    
    const platformRules: Record<string, string> = {
      twitter: '280 characters max, punchy, use emojis sparingly',
      linkedin: 'Professional tone, 3000 characters max, thought leadership',
      instagram: 'Caption-first, punchy opening, 2200 characters max, optimized for reels or feed posts',
      facebook: 'Readable social post copy, front-load the hook, suitable for page posts and video descriptions',
      youtube: 'Write as a YouTube description with a strong title line and concise supporting context',
      reddit: 'Authentic, discussion-provoking, avoid overt marketing',
      discord: 'Community-focused, conversational, can use emojis',
    };

    const prompt = `Rewrite this content for ${args.platform}:

Original: """${args.content}"""

Rules: ${platformRules[args.platform]}
${args.tone ? `Tone: ${args.tone}` : ''}

Return only the rewritten content.`;

    const result = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.8,
    });

    const rewritten = result.choices[0]?.message?.content?.trim() || args.content;

    return { original: args.content, rewritten, platform: args.platform, characterCount: rewritten.length };
  },
};

export const generateThread = {
  name: 'generateThread' as const,
  description: 'Generate a thread (series of connected posts) from a main content piece.',
  inputSchema: z.object({
    mainContent: z.string(),
    platform: z.enum(['twitter', 'reddit']).default('twitter'),
    hook: z.string().optional(),
    posts: z.number().min(3).max(10).default(5),
  }),
  async execute(args: { mainContent: string; platform: string; hook?: string; posts: number }) {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const charLimit = args.platform === 'twitter' ? 280 : 40000;

    const prompt = `Create a ${args.posts}-post thread from this content:

Main: """${args.mainContent}"""
${args.hook ? `Hook: """${args.hook}"""` : ''}

Each post under ${charLimit} chars. Format: Numbered list.`;

    const result = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.8,
    });

    const raw = result.choices[0]?.message?.content?.trim() || '';
    const posts = raw.split('\n').filter(l => l.trim()).map(l => l.replace(/^\d+[/.)]\s*/, '').trim());

    return { mainContent: args.mainContent, thread: posts, platform: args.platform, postCount: posts.length };
  },
};

export const suggestTrendingTopics = {
  name: 'suggestTrendingTopics' as const,
  description: 'Suggest trending topics for content creation based on industry and audience.',
  inputSchema: z.object({
    industry: z.string(),
    audience: z.string().optional(),
    count: z.number().min(3).max(8).default(5),
  }),
  async execute(args: { industry: string; audience?: string; count: number }) {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const prompt = `Suggest ${args.count} trending content ideas for ${args.industry} ${args.audience ? `for ${args.audience}` : ''}.

For each: title, description, why trending, angle. JSON format.`;

    const result = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.9,
    });

    const raw = result.choices[0]?.message?.content?.trim() || '[]';
    let topics = [];
    try {
      const match = raw.match(/\[.*\]/s);
      if (match) topics = JSON.parse(match[0]);
    } catch {
      topics = raw.split('\n\n').map((b, i) => ({
        title: b.split('\n')[0]?.replace(/^\d+\.?\s*/, '') || `Topic ${i + 1}`,
        description: b.split('\n')[1] || '',
        trendingReason: b.split('\n')[2] || '',
        angle: b.split('\n')[3] || '',
      }));
    }

    return { topics, industry: args.industry };
  },
};
