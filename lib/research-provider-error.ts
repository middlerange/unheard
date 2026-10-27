const knownCodes = new Set([
  'rate_limit_exceeded', 'rate_limit_error', 'insufficient_quota',
  'billing_hard_limit_reached', 'invalid_api_key', 'model_not_found',
  'invalid_request_error', 'authentication_error', 'permission_error',
  'not_found_error', 'overloaded_error', 'server_error', 'context_length_exceeded',
]);

function duration(value: string | null) {
  if (!value || !/^(?:\d+(?:\.\d+)?(?:ms|s|m|h))+$/.test(value)) return null;
  const units: Record<string, number> = { ms: 1, s: 1000, m: 60000, h: 3600000 };
  return [...value.matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h)/g)]
    .reduce((sum, match) => sum + Number(match[1]) * units[match[2]], 0);
}

export class ResearchModelRateLimitError extends Error {
  constructor(message: string, readonly retryAfterMs: number) {
    super(message);
    this.name = 'ResearchModelRateLimitError';
  }
}

/** Retain useful rejection diagnostics without response messages, prompts or credentials. */
export async function researchProviderRejection(response: Response, provider: string, now = Date.now()) {
  const body = await response.json().catch(() => null) as { error?: { code?: unknown; type?: unknown } } | null;
  const safeCode = (value: unknown) => typeof value === 'string' && knownCodes.has(value) ? value : null;
  const code = safeCode(body?.error?.code), type = safeCode(body?.error?.type);
  const quota = [code, type].some(value => value === 'insufficient_quota' || value === 'billing_hard_limit_reached');
  const codeAbsent = body?.error?.code === undefined || body?.error?.code === null;
  const rateCode = code === 'rate_limit_exceeded' || code === 'rate_limit_error';
  const temporary = response.status === 429 && !quota
    && ((rateCode && (!type || type === 'rate_limit_error')) || (codeAbsent && type === 'rate_limit_error'));
  const retry = response.headers.get('retry-after');
  const retryMs = retry && /^\d+(?:\.\d+)?$/.test(retry) ? Number(retry) * 1000
    : retry && Number.isFinite(Date.parse(retry)) ? Math.max(0, Date.parse(retry) - now) : null;
  const resets = [retryMs, duration(response.headers.get('x-ratelimit-reset-tokens')), duration(response.headers.get('x-ratelimit-reset-requests'))]
    .filter((value): value is number => value !== null && Number.isFinite(value) && value >= 0);
  const retryAfterMs = temporary ? Math.max(1000, resets.length ? Math.ceil(Math.max(...resets)) + 1000 : 60000) : null;
  const candidateId = response.headers.get('x-request-id') || response.headers.get('request-id');
  const requestId = candidateId && /^req[_-][a-zA-Z0-9_-]{5,100}$/.test(candidateId) && !/sk-|bearer/i.test(candidateId) ? candidateId : null;
  const limits = Object.fromEntries(['x-ratelimit-limit-tokens', 'x-ratelimit-remaining-tokens', 'x-ratelimit-limit-requests', 'x-ratelimit-remaining-requests'].flatMap(name => {
    const value = response.headers.get(name);
    return value && /^\d+$/.test(value) ? [[name, Number(value)]] : [];
  }));
  const diagnostic = { provider, httpStatus: response.status, code, type, requestId, temporary, retryAfterMs, limits };
  const suffix = temporary ? ` Wait ${Math.ceil(retryAfterMs! / 1000)} seconds before continuing the rejected request.`
    : quota ? ' Check provider billing or account quota.' : ' Check model access and account limits.';
  const message = `${provider} request rejected (HTTP ${response.status}${code || type ? `; ${code || type}` : ''}).${suffix}`;
  return { diagnostic, error: temporary ? new ResearchModelRateLimitError(message, retryAfterMs!) : new Error(message) };
}
