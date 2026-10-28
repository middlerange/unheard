import { articleResearchText, articleResearchTitle, assertPublicResearchUrl, canonicalResearchUrl, ResearchRateLimitError, sourceHosts } from './research-collectors';
import type { ResearchSourceSeed } from './research-types';

export const PUBLIC_FETCH_RETRIEVAL_NOTE = 'Direct fetch failed; public publisher body retrieved via free fetch. Publication dates still require evidence in the original HTML.';
const endpoint = 'https://treg.to/call/tinyfish.web.fetch';
const maxBytes = 1_500_000;

function restrictedUrl(url: URL) {
  let path: string;
  try { path = decodeURIComponent(url.pathname); } catch { return true; }
  return /\/(?:login|log-in|signin|sign-in|oauth|auth|private|account|checkout|paywall|subscribe)(\/|$)/i.test(path)
    || /\.(?:pdf|zip|gz|mp[34]|webm|mov|wav|ogg|png|jpe?g|gif|webp|avif|svg)$/i.test(path)
    || [...url.searchParams.keys()].some(key => /^(?:access_token|auth(?:_token)?|authorization|api_key|key|token|password|session(?:id)?|signature|sig)$/i.test(key));
}

export function canUseFreePublicWatchFetch(source: ResearchSourceSeed, error: unknown) {
  if (source.kind !== 'web' || source.pageMode !== 'article' || !process.env.TREG_TOKEN || error instanceof ResearchRateLimitError
    || error instanceof Error && /\bHTTP (?:401|402)\b/.test(error.message)) return false;
  try { return !restrictedUrl(assertPublicResearchUrl(source.url, sourceHosts(source))); }
  catch { return false; }
}

export async function fetchFreePublicWatchHtml(source: ResearchSourceSeed) {
  const hosts = sourceHosts(source), target = assertPublicResearchUrl(source.url, hosts), token = process.env.TREG_TOKEN;
  if (!token || source.kind !== 'web' || source.pageMode !== 'article' || restrictedUrl(target))
    throw new Error('Free public fetch is unavailable for this source');
  const requested = canonicalResearchUrl(target.href);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json', 'X-Treg-Token': token,
    'X-Treg-Route-Max-Cost': '0', 'X-Treg-Route-Waterfall': '0',
  };
  if (process.env.TREG_ORG) headers['X-Treg-Org'] = process.env.TREG_ORG;
  const response = await fetch(endpoint, {
    method: 'POST', headers, redirect: 'manual', signal: AbortSignal.timeout(20_000),
    body: JSON.stringify({ urls: [source.url], format: 'html', page_metadata: true, ttl: 0, per_url_timeout_ms: 12000 }),
  });
  if (!response.ok || Number(response.headers.get('content-length') || 0) > maxBytes) {
    await response.body?.cancel();
    throw new Error(response.ok ? 'Free public fetch response is too large' : `Free public fetch returned HTTP ${response.status}`);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Free public fetch returned no body');
  const decoder = new TextDecoder();
  let text = '', bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) throw new Error('Free public fetch response is too large');
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
  } finally { await reader.cancel(); }
  let payload: { results?: Array<{ url?: unknown; final_url?: unknown; text?: unknown; format?: unknown; status_code?: unknown }>; errors?: unknown[] };
  try { payload = JSON.parse(text); }
  catch { throw new Error('Free public fetch returned invalid JSON'); }
  const result = payload?.results?.[0];
  if (!Array.isArray(payload?.results) || payload.results.length !== 1 || payload.errors?.length
    || typeof result?.url !== 'string' || typeof result.final_url !== 'string' || result.format !== 'html' || typeof result.text !== 'string'
    || typeof result.status_code === 'number' && (result.status_code < 200 || result.status_code >= 300))
    throw new Error('Free public fetch did not return one successful publisher HTML result');
  try {
    const returned = assertPublicResearchUrl(result.url, hosts), final = assertPublicResearchUrl(result.final_url, hosts);
    if (canonicalResearchUrl(returned.href) !== requested || restrictedUrl(returned) || restrictedUrl(final)) throw new Error('Rejected result');
  } catch { throw new Error('Free public fetch did not return the requested public page on approved source domains'); }
  const body = articleResearchText(result.text), title = articleResearchTitle(result.text);
  if (!/<(?:html|main|article)\b/i.test(result.text) || body.trim().length < 500
    || /<input\b[^>]*\btype\s*=\s*["']?password\b/i.test(result.text)
    || /["']isAccessibleForFree["']\s*:\s*["']?false\b/i.test(result.text)
    || /<(?:div|section|form|aside)\b[^>]*(?:id|class)=["'][^"']*(?:paywall|subscriber-only|membership-gate)[^"']*["']/i.test(result.text)
    || /^(?:sign[ -]?in|log[ -]?in|access denied|verify (?:you are|you're) human)\b/i.test(title)
    || /\b(?:subscribe to (?:read|continue|unlock)|sign in to (?:read|view this content)|subscriber[ -]only|members[ -]only|verify (?:you are|you're) human)\b/i.test(body))
    throw new Error('Free public fetch did not expose a substantive public article body');
  return result.text;
}
