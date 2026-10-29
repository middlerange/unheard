import { z } from 'zod';
import { researchHttp } from './research-http';
import { probeResearchGenerationHealth } from './research-provider-health';
import { RESEARCH_MODEL } from './research-model';
import { RESEARCH_WRITING_MODEL } from './research-writing';
import { readResearchProviderResponse, researchProviderRejection } from './research-provider-error';

export async function checkResearchProviders(fetcher: typeof fetch = fetch) {
  const key = process.env.ANTHROPIC_API_KEY;
  const base = {
    provider: 'Anthropic', model: RESEARCH_MODEL, configured: Boolean(key),
    operation: 'retrieve_model_metadata', generationAccess: 'not_tested', accountBalance: 'not_checked', automaticRetry: false,
  };
  const writing = { provider: RESEARCH_WRITING_MODEL.startsWith('claude-') ? 'Anthropic' : 'OpenAI', model: RESEARCH_WRITING_MODEL, checked: false };
  if (!key) return { research: { ...base, status: 'unconfigured' }, writing };
  try {
    const response = await fetcher(`https://api.anthropic.com/v1/models/${RESEARCH_MODEL}`, {
      method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(10_000),
      headers: { 'x-api-key': key, 'anthropic-version': '2026-10-21', Accept: 'application/json' },
    });
    if (!response.ok) {
      const { diagnostic } = await researchProviderRejection(response, 'Anthropic');
      return { research: { ...base, status: 'rejected', ...diagnostic }, writing };
    }
    const inspected = await readResearchProviderResponse(response);
    const model = inspected.body as { type?: unknown; id?: unknown } | null;
    const resolvedModelId = model?.type === 'model' && typeof model.id === 'string'
      && /^claude-[a-z0-9][a-z0-9.-]{0,99}$/.test(model.id) && !/sk-|bearer/i.test(model.id)
      && (model.id === RESEARCH_MODEL || model.id.startsWith(`${RESEARCH_MODEL}-`)) ? model.id : null;
    return { research: { ...base, status: resolvedModelId ? 'metadata_accessible' : 'unexpected_response', resolvedModelId,
      httpStatus: response.status, contentType: inspected.contentType, bodyKind: inspected.bodyKind, requestId: inspected.requestId }, writing };
  } catch {
    return { research: { ...base, status: 'transport_error', httpStatus: null }, writing };
  }
}

const providerRequestSchema = z.union([
  z.object({ operation: z.literal('metadata').optional() }).strict(),
  z.object({ operation: z.literal('generation_health'), operationId: z.uuid() }).strict(),
]);
async function readProviderRequest(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) return { operation: 'metadata' as const };
  const decoder = new TextDecoder(); let text = '', bytes = 0;
  try {
    while (true) { const chunk = await reader.read(); if (chunk.done) break; bytes += chunk.value.byteLength;
      if (bytes > 512) throw new SyntaxError('Invalid provider request'); text += decoder.decode(chunk.value, { stream: true }); }
    text += decoder.decode();
  } finally { await reader.cancel(); }
  const parsed = providerRequestSchema.safeParse(text.trim() ? JSON.parse(text) : {});
  if (!parsed.success) throw new SyntaxError('Invalid provider request');
  return parsed.data;
}
export function researchProvidersHttp(request: Request) {
  return researchHttp(request, async teamId => {
    const operation = await readProviderRequest(request);
    return operation.operation === 'generation_health'
      ? { generationHealth: await probeResearchGenerationHealth(teamId, operation.operationId), writing: { checked: false } }
      : checkResearchProviders();
  });
}
