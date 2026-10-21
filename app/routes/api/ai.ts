// ABOUTME: API route for AI content generation with streaming response.
// ABOUTME: Supports OpenAI GPT-5 and Google Gemini Flash via POST body model param.

import { createFileRoute } from '@tanstack/react-router';
import { generateContent, type AIModel } from '@/lib/ai';
import { getBrandProfile, getTemplate } from '@/lib/db/queries';
import { getRequestTeamId } from '@/lib/auth';

export const Route = createFileRoute('/api/ai')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const teamId = await getRequestTeamId(request);
        if (teamId instanceof Response) return teamId;


        const body = await request.json();
        const { prompt, platform, tone, model, existingContent, brandProfileId, templateId } = body;

        if (!prompt || !platform || !model) {
          return Response.json(
            { error: 'prompt, platform, and model are required' },
            { status: 400 },
          );
        }

        try {
          const [brandProfile, template] = await Promise.all([
            brandProfileId ? getBrandProfile(brandProfileId, teamId) : Promise.resolve(undefined),
            templateId ? getTemplate(templateId, teamId) : Promise.resolve(undefined),
          ]);

          const stream = await generateContent(
            prompt,
            platform,
            tone ?? 'engaging',
            model as AIModel,
            existingContent,
            brandProfile ?? undefined,
            template?.content,
          );
          return new Response(stream, {
            headers: {
              'Content-Type': 'text/plain; charset=utf-8',
              'Transfer-Encoding': 'chunked',
            },
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'AI generation failed';
          return Response.json({ error: msg }, { status: 500 });
        }
      },
    },
  },
});
