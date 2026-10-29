const knownCodes = new Set([
  'rate_limit_exceeded', 'rate_limit_error', 'insufficient_quota',
  'billing_hard_limit_reached', 'invalid_api_key', 'model_not_found',
  'invalid_request_error', 'authentication_error', 'permission_error',
  'not_found_error', 'overloaded_error', 'server_error', 'context_length_exceeded',
]);
type ConfigurationIssue = 'schema_complexity' | 'output_token_limit' | 'unsupported_schema' | 'unsupported_api_version' | 'request_format';

function classifyConfigurationIssue(message: unknown): ConfigurationIssue | null {
  if (typeof message !== 'string') return null;
  const patterns: Array<[ConfigurationIssue, RegExp]> = [
    ['schema_complexity', /\b(?:schemas?|(?:compiled\s+)?grammar)\b.{0,160}\b(?:too (?:complex|large)|complexity limit|compilation timeout)\b/i],
    ['output_token_limit', /\bmax_(?:output_)?tokens\b.{0,160}(?:\b(?:maximum|limit|exceeds?|too (?:large|high)|out of range|greater than|less than|at most)\b|<=)/i],
    ['unsupported_schema', /(?:\b(?:schema|additionalProperties|anyOf|allOf|oneOf)\b.{0,120}\b(?:unsupported|not supported|not allowed|must be false|unknown keyword)\b|\bunsupported\b.{0,80}\b(?:schema|schema keyword)\b)/i],
    ['unsupported_api_version', /(?:\b(?:anthropic-version|api[_ -]version)\b.{0,120}\b(?:unsupported|invalid|not supported|unrecognized|not recognized|required|missing)\b|\b(?:invalid|unsupported|missing)\b.{0,80}\b(?:anthropic-version|api[_ -]version)\b)/i],
    ['request_format', /(?:\b(?:messages?|system|output_config|output_format|response_format|thinking|service_tier|tools?)\b.{0,120}\b(?:extra inputs? (?:are )?not permitted|(?:field )?required|invalid (?:type|value)|must be|input should be|not permitted|not allowed|not supported|unknown (?:field|parameter))\b|\b(?:invalid|malformed) (?:request body|json)\b)/i],
  ];
  return patterns.find(([, pattern]) => pattern.test(message))?.[0] ?? null;
}

function duration(value: string | null) {
  if (!value || !/^(?:\d+(?:\.\d+)?(?:ms|s|m|h))+$/.test(value)) return null;
  const units: Record<string, number> = { ms: 1, s: 1000, m: 60000, h: 3600000 };
  return [...value.matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h)/g)]
    .reduce((sum, match) => sum + Number(match[1]) * units[match[2]], 0);
}

export class ResearchModelRateLimitError extends Error {
  usageId?: string;
  constructor(message: string, readonly retryAfterMs: number, readonly confirmedRejection = true) {
    super(message);
    this.name = 'ResearchModelRateLimitError';
  }
}

export async function readResearchProviderResponse(response: Response) {
  const mime = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  const contentType = !mime ? 'missing' : ['application/json', 'text/html', 'text/plain'].includes(mime) ? mime : 'other';
  const candidateId = response.headers.get('x-request-id') || response.headers.get('request-id');
  const requestId = candidateId && /^req[_-][a-zA-Z0-9_-]{5,100}$/.test(candidateId) && !/sk-|bearer/i.test(candidateId) ? candidateId : null;
  const result = (bodyKind: 'json' | 'invalid_json' | 'html' | 'text' | 'empty' | 'oversized' | 'unreadable', body: unknown = null) => ({ contentType, bodyKind, requestId, body });
  const reader = response.body?.getReader();
  if (!reader) return result('empty');
  const decoder = new TextDecoder();
  let text = '', bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 65_536) return result('oversized');
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    if (!text.trim()) return result('empty');
    try { return result('json', JSON.parse(text)); } catch {
      return result(contentType === 'application/json' ? 'invalid_json' : contentType === 'text/html' || /^\s*<(?:!doctype\s+html|html)\b/i.test(text) ? 'html' : 'text');
    }
  } catch { return result('unreadable'); }
  finally { await reader.cancel().catch(() => undefined); }
}

/** Retain useful rejection diagnostics without response messages, prompts or credentials. */
export async function researchProviderRejection(response: Response, provider: string, now = Date.now()) {
  const inspected = await readResearchProviderResponse(response);
  const body = inspected.body as { error?: { code?: unknown; type?: unknown; message?: unknown } } | null;
  const safeCode = (value: unknown) => typeof value === 'string' && knownCodes.has(value) ? value : null;
  const code = safeCode(body?.error?.code), type = safeCode(body?.error?.type);
  const configurationIssue = response.status === 400 && (code === 'invalid_request_error' || type === 'invalid_request_error')
    ? classifyConfigurationIssue(body?.error?.message) : null;
  const quota = [code, type].some(value => value === 'insufficient_quota' || value === 'billing_hard_limit_reached');
  const codeAbsent = body?.error?.code === undefined || body?.error?.code === null;
  const rateCode = code === 'rate_limit_exceeded' || code === 'rate_limit_error';
  const classifiedRateLimit = response.status === 429 && !quota
    && ((rateCode && (!type || type === 'rate_limit_error')) || (codeAbsent && type === 'rate_limit_error'));
  const retry = response.headers.get('retry-after');
  const retryMs = retry && /^\d+(?:\.\d+)?$/.test(retry) ? Number(retry) * 1000
    : retry && Number.isFinite(Date.parse(retry)) ? Math.max(0, Date.parse(retry) - now) : null;
  const resets = [retryMs, duration(response.headers.get('x-ratelimit-reset-tokens')), duration(response.headers.get('x-ratelimit-reset-requests'))]
    .filter((value): value is number => value !== null && Number.isFinite(value) && value >= 0);
  // Claude spend/tier limits can be a 429 without any usable reset. Do not
  // assume a 60-second cooldown or repeatedly bill an unrecoverable request.
  const temporary = classifiedRateLimit && (provider !== 'Anthropic' || retryMs !== null && Number.isFinite(retryMs));
  const retryAfterMs = temporary ? Math.max(1000, resets.length ? Math.ceil(Math.max(...resets)) + 1000 : 60000) : null;
  const requestId = inspected.requestId;
  const limits = Object.fromEntries(['x-ratelimit-limit-tokens', 'x-ratelimit-remaining-tokens', 'x-ratelimit-limit-requests', 'x-ratelimit-remaining-requests'].flatMap(name => {
    const value = response.headers.get(name);
    return value && /^\d+$/.test(value) ? [[name, Number(value)]] : [];
  }));
  const kind = (value: unknown) => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  const shape = { topLevel: kind(inspected.body), error: kind(body?.error),
    codePresent: Boolean(body?.error && typeof body.error === 'object' && Object.hasOwn(body.error, 'code')),
    typePresent: Boolean(body?.error && typeof body.error === 'object' && Object.hasOwn(body.error, 'type')),
    messagePresent: Boolean(body?.error && typeof body.error === 'object' && Object.hasOwn(body.error, 'message')) };
  const reasonClassification = quota ? 'billing_or_quota' : [code, type].some(value => value === 'invalid_api_key' || value === 'authentication_error') ? 'authentication'
    : [code, type].includes('permission_error') ? 'permission' : temporary ? 'rate_limit' : configurationIssue ? 'request_configuration'
    : inspected.bodyKind === 'json' ? 'unclassified_json_rejection' : inspected.bodyKind === 'html' ? 'html_rejection' : 'unclassified_rejection';
  const diagnostic = { provider, httpStatus: response.status, code, type, requestId, temporary, retryAfterMs, limits,
    contentType: inspected.contentType, bodyKind: inspected.bodyKind, configurationIssue, reasonClassification, shape };
  const suffix = temporary ? ` Wait ${Math.ceil(retryAfterMs! / 1000)} seconds before continuing the rejected request.`
    : quota ? ' Check provider billing or account quota.' : configurationIssue ? ' Check request configuration.' : ' Check model access and account limits.';
  const message = `${provider} request rejected (HTTP ${response.status}${code || type ? `; ${code || type}` : ''}).${suffix}`;
  return { diagnostic, error: temporary ? new ResearchModelRateLimitError(message, retryAfterMs!) : new Error(message) };
}
