// ABOUTME: Chat-based AI assistant API route using TanStack AI with SSE streaming.
// ABOUTME: Supports tool calling (e.g. convertToTwitter) via the AG-UI protocol.

import { createFileRoute } from '@tanstack/react-router';
import { chat, toServerSentEventsResponse, maxIterations } from '@tanstack/ai';
import { openaiText } from '@tanstack/ai-openai';
import { convertToTwitter, suggestPosts, suggestCoverImages, generateCoverImage, schedulePost, createPost, suggestHashtags, rewriteForPlatform, generateThread, suggestTrendingTopics } from '@/lib/assistant-tools';
import { getBrandProfile, getDefaultBrandProfile, getTemplate, type BrandProfile } from '@/lib/db/queries';
import { getRequestTeamId } from '@/lib/auth';
import { noSlopRules } from '@/lib/writing-rules';

const SYSTEM_PROMPT = `You are a social media content assistant.
When the user shares an idea, immediately call suggestPosts — no preamble, no introduction.
When asked to rewrite, regenerate, rephrase, create variations, or try again, call suggestPosts with the relevant content. NEVER return rewritten options as plain text — always use suggestPosts so the UI renders them as separate cards.
Once suggestPosts results are in the conversation, respond briefly (e.g. "Here are your drafts — use the Schedule button to queue any of them.") without calling any tools.
When asked to convert content for Twitter, use convertToTwitter.
When asked about cover images or banner images for a post, call suggestCoverImages.
When asked to generate a specific cover image (e.g. "Generate the cover image: ..."), call generateCoverImage.
When asked to schedule a post, call schedulePost with the post content and optional thread.
When asked to create a post from an outline or idea with AI generation (brand voice + template), use createPost. It generates platform-specific content and optionally schedules it.
Be concise. Don't repeat tool output back.

${noSlopRules}`;

function brandContext(brand: BrandProfile): string {
  const parts = [`\nBrand: ${brand.name}`];
  if (brand.voice) parts.push(`Voice: ${brand.voice}`);
  if (brand.audience) parts.push(`Audience: ${brand.audience}`);
  if (brand.writing_prompt) parts.push(`Writing guidelines: ${brand.writing_prompt}`);
  return parts.join('\n');
}

export const Route = createFileRoute('/api/assistant')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const teamId = await getRequestTeamId(request);
        if (teamId instanceof Response) return teamId;


        const { messages, data } = await request.json();

        const brandId = data?.brandId as string | undefined;
        const templateId = data?.templateId as string | undefined;
        const writingPrompt = data?.writingPrompt as string | undefined;
        const postContent = data?.postContent as string | undefined;
        const brand = brandId
          ? await getBrandProfile(brandId, teamId)
          : await getDefaultBrandProfile(teamId);

        const selectedTemplate = templateId && templateId !== 'freeform' ? await getTemplate(templateId, teamId) : null;

        let systemPrompt = SYSTEM_PROMPT;
        if (brand) {
          systemPrompt += brandContext(brand);
        }
        if (templateId === 'freeform') {
          systemPrompt += `\n\nThe user has selected "Free-form" mode — no template structure. When calling suggestPosts, posts should be written naturally without any template.`;
        } else if (selectedTemplate) {
          systemPrompt += `\n\nThe user has selected the "${selectedTemplate.name}" template. When they say "rewrite", "use this template", or refer to the selected template, use suggestPosts — it will automatically use this template.`;
        }
        if (postContent?.trim()) {
          systemPrompt += `\n\nThe user is currently editing this post:\n---\n${postContent.trim()}\n---\nWhen they say "this post" or "rewrite", refer to the content above.`;
        }

        const stream = chat({
          adapter: openaiText('gpt-4o-mini'),
          systemPrompts: [systemPrompt],
          messages: messages ?? [],
          tools: [
            convertToTwitter(brand), 
            suggestPosts(brand, teamId, templateId, writingPrompt), 
            suggestCoverImages(brand), 
            generateCoverImage(brand), 
            schedulePost, 
            createPost(brand),
            suggestHashtags,
            rewriteForPlatform,
            generateThread,
            suggestTrendingTopics,
          ],
          agentLoopStrategy: maxIterations(1),
        });

        return toServerSentEventsResponse(stream);
      },
    },
  },
});
