import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from './db/client';
import { research_cache } from './schema';
import { retryResearchStorage } from './research-storage';
import { anthropicResearchOutput, anthropicResearchRequest, type AnthropicResearchResponse } from './research-anthropic';
import { readResearchProviderResponse, researchProviderRejection } from './research-provider-error';
import { priceResearchUsage } from './research-pricing';
import { researchHash } from './research-model';

const version = 'research-generation-health-v1';
export const RESEARCH_HEALTH_MODEL = 'claude-sonnet-5-5';
export const RESEARCH_HEALTH_MAX_OUTPUT_TOKENS = 64;
const apiVersion = '2026-10-21';
const schema = { type: 'object', properties: { ok: { type: 'boolean', const: true } }, required: ['ok'], additionalProperties: false };
const request = () => anthropicResearchRequest(RESEARCH_HEALTH_MODEL,
  'Submit exactly {"ok":true} through submit_research. This is a harmless generation health check with no external action.',
  { health: true }, schema, RESEARCH_HEALTH_MAX_OUTPUT_TOKENS, 'tool');
const operationIdSchema = z.uuid();
type State = 'pending' | 'completed' | 'rejected' | 'transport_error' | 'unexpected_response' | 'unconfigured';
type HealthUsage = ReturnType<typeof priceResearchUsage>;
type HealthReceipt = {
  version: typeof version; teamId: string; operationId: string; contractHash: string; nonce: string; startedAt: number;
  state: State; completedAt?: number; providerRequests: 0 | 1; usage: HealthUsage; diagnostic?: Record<string, unknown>;
};
const unknownUsage = () => priceResearchUsage(RESEARCH_HEALTH_MODEL, 'standard');
async function healthStorage<T>(action: () => PromiseLike<T>): Promise<T> {
  try { return await action(); } catch { throw new Error('Generation health receipt storage unavailable'); }
}
function invalidReceipt(): never { throw new Error('Generation health receipt is missing or changed'); }
function diagnostic(inspected: Awaited<ReturnType<typeof readResearchProviderResponse>>, httpStatus: number) {
  return { httpStatus, contentType: inspected.contentType, bodyKind: inspected.bodyKind, requestIdPresent: inspected.requestId !== null };
}

/** Separate health ledger: no research run, benchmark usage aggregate, source or writing mutation. */
export async function probeResearchGenerationHealth(teamId: string, operationId: string, fetcher: typeof fetch = fetch) {
  if (!operationIdSchema.safeParse(operationId).success || !teamId) throw new SyntaxError('Invalid generation health request');
  const body = request(), contractHash = await researchHash(JSON.stringify({ version, apiVersion, body }));
  const id = `research-provider-health:v1:${await researchHash(JSON.stringify([teamId, operationId]))}`;
  const db = await healthStorage(() => getDb());
  async function read() {
    const row = await healthStorage(() => db.select().from(research_cache).where(and(eq(research_cache.id, id), eq(research_cache.team_id, teamId))).get());
    if (!row) return null;
    let saved: HealthReceipt;
    try { saved = JSON.parse(row.value); } catch { return invalidReceipt(); }
    if (saved.version !== version || saved.teamId !== teamId || saved.operationId !== operationId || saved.contractHash !== contractHash
      || typeof saved.nonce !== 'string' || !saved.nonce || !Number.isFinite(saved.startedAt)
      || !['pending', 'completed', 'rejected', 'transport_error', 'unexpected_response', 'unconfigured'].includes(saved.state)
      || saved.state !== 'pending' && (!Number.isFinite(saved.completedAt) || saved.completedAt! < saved.startedAt)) return invalidReceipt();
    return saved;
  }
  const result = (saved: HealthReceipt, replayed: boolean) => ({
    provider: 'Anthropic', model: RESEARCH_HEALTH_MODEL, operation: 'generation_health', operationId, receiptId: id,
    contractHash, status: saved.state, generationAccess: saved.state === 'completed' ? 'verified' : saved.state === 'rejected' ? 'rejected'
      : saved.state === 'unexpected_response' ? 'responded_not_verified' : 'unknown',
    replayed, providerRequestsMadeNow: replayed ? 0 : saved.providerRequests, requestMayHaveBeenSent: saved.state === 'pending' || saved.providerRequests === 1, automaticRetry: false,
    usageScope: 'separate_provider_health_receipt', includedInBenchmarkUsage: false,
    usage: saved.usage, ...(saved.diagnostic ? { diagnostic: saved.diagnostic } : {}),
  });
  const previous = await read();
  if (previous) return result(previous, true);
  const pending: HealthReceipt = { version, teamId, operationId, contractHash, nonce: crypto.randomUUID(), startedAt: Date.now(),
    state: 'pending', providerRequests: 0, usage: unknownUsage() };
  const pendingValue = JSON.stringify(pending);
  await healthStorage(() => retryResearchStorage(() => db.insert(research_cache).values({ id, team_id: teamId, value: pendingValue, created_at: pending.startedAt }).onConflictDoNothing()));
  const claimed = await read();
  if (!claimed) return invalidReceipt();
  if (JSON.stringify(claimed) !== pendingValue) return result(claimed, true);
  let terminal: HealthReceipt;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) terminal = { ...pending, state: 'unconfigured', completedAt: Date.now() };
  else {
    try {
      const response = await fetcher('https://api.anthropic.com/v1/messages', {
        method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(90_000),
        headers: { 'x-api-key': key, 'anthropic-version': apiVersion, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!response.ok) {
        const rejected = (await researchProviderRejection(response, 'Anthropic')).diagnostic;
        const { requestId: _requestId, limits: _limits, ...safe } = rejected;
        terminal = { ...pending, state: 'rejected', completedAt: Date.now(), providerRequests: 1, diagnostic: { ...safe, requestIdPresent: rejected.requestId !== null } };
      } else {
        const inspected = await readResearchProviderResponse(response), value = inspected.body as AnthropicResearchResponse | null;
        const modelMatches = typeof value?.model === 'string' && /^claude-sonnet-5-5(?:-\d{8}|-\d{4}-\d{2}-\d{2})?$/.test(value.model);
        const output = value && Array.isArray(value.content) ? anthropicResearchOutput(value, 'tool', RESEARCH_HEALTH_MODEL) : '';
        let valid = false;
        try { valid = modelMatches && Boolean(output) && z.object({ ok: z.literal(true) }).strict().safeParse(JSON.parse(output!)).success; } catch { /* Malformed provider output is not a successful health result. */ }
        const priced = priceResearchUsage(RESEARCH_HEALTH_MODEL, 'standard', value?.usage);
        const usage = modelMatches ? priced : { ...priced, costNanoUsd: null, costStatus: 'unknown', rateCard: null };
        terminal = { ...pending, state: valid ? 'completed' : 'unexpected_response', completedAt: Date.now(), providerRequests: 1, usage,
          diagnostic: { ...diagnostic(inspected, response.status), structuredToolResultValid: valid, resolvedModelMatches: modelMatches } };
      }
    } catch {
      terminal = { ...pending, state: 'transport_error', completedAt: Date.now(), providerRequests: 1,
        diagnostic: { httpStatus: null, reasonClassification: 'transport_unknown', billingOutcome: 'unknown' } };
    }
  }
  const terminalValue = JSON.stringify(terminal);
  await healthStorage(() => retryResearchStorage(() => db.update(research_cache).set({ value: terminalValue }).where(and(
    eq(research_cache.id, id), eq(research_cache.team_id, teamId), eq(research_cache.value, pendingValue),
  ))));
  const saved = await read();
  if (!saved || JSON.stringify(saved) !== terminalValue) return invalidReceipt();
  return result(saved, false);
}
