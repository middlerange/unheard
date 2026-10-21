// ABOUTME: AI content generation using OpenAI GPT-5 or Gemini, switchable via model param.
// ABOUTME: Returns a streamed text response for use in the AI assistant panel.

import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import type { BrandProfile } from './db/types';
import { maxCharacters } from './twitter';
import { noSlopRules } from './writing-rules';
import type { PlatformId } from './platforms';

export type AIModel = 'gpt-5' | 'gemini-flash';

const defaultSystemPrompt = `You are a social media content writer. Write engaging, concise posts suitable for the requested platform.
Return only the post text — no explanations, no quotes around it, no formatting instructions.

${noSlopRules}`;

function buildSystemPrompt(brandProfile?: BrandProfile): string {
  if (!brandProfile?.writing_prompt) return defaultSystemPrompt;
  let prompt = brandProfile.writing_prompt + '\n\n' + noSlopRules;
  if (brandProfile.voice) prompt += `\n\nVoice/Style: ${brandProfile.voice}`;
  if (brandProfile.audience) prompt += `\nTarget Audience: ${brandProfile.audience}`;
  return prompt;
}

export async function rewriteText(text: string, brandProfile?: BrandProfile, instruction?: string, templateContent?: string): Promise<string> {
  const systemPrompt = buildSystemPrompt(brandProfile);
  const guidance = instruction ? `\n\nGuidance: ${instruction}` : '';
  const templateGuidance = templateContent ? `\n\nUse this template structure as a guide:\n${templateContent}` : '';
  const userMessage = `Rewrite the following idea in the brand voice. Keep the core meaning intact but adapt the tone and style.${guidance}${templateGuidance}\n\nIdea:\n${text}`;

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await client.chat.completions.create({
    model: 'gpt-4.1-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    max_completion_tokens: 800,
  });

  return response.choices[0]?.message?.content?.trim() ?? '';
}

export async function generateContent(
  prompt: string,
  platform: PlatformId,
  tone: string,
  model: AIModel,
  existingContent?: string,
  brandProfile?: BrandProfile,
  templateContent?: string,
): Promise<ReadableStream<Uint8Array>> {
  const charLimit = platform === 'twitter' ? maxCharacters() : 3000;
  const context = existingContent ? `\n\nExisting draft to improve:\n${existingContent}` : '';
  const templateGuide = templateContent ? `\n\nUse this template structure as a guide:\n${templateContent}` : '';
  const userMessage = `Platform: ${platform} (max ${charLimit} characters)\nTone: ${tone}\nRequest: ${prompt}${context}${templateGuide}`;
  const systemPrompt = buildSystemPrompt(brandProfile);

  if (model === 'gpt-5') {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const stream = await client.chat.completions.create({
      model: 'gpt-5-2025-08-07',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      stream: true,
      max_completion_tokens: 500,
    });

    return new ReadableStream({
      async start(controller) {
        for await (const chunk of stream) {
          const text = chunk.choices[0]?.delta?.content ?? '';
          if (text) controller.enqueue(new TextEncoder().encode(text));
        }
        controller.close();
      },
    });
  }

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY ?? '');
  const geminiModel = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
  const result = await geminiModel.generateContentStream(`${systemPrompt}\n\n${userMessage}`);

  return new ReadableStream({
    async start(controller) {
      for await (const chunk of result.stream) {
        const text = chunk.text();
        if (text) controller.enqueue(new TextEncoder().encode(text));
      }
      controller.close();
    },
  });
}
