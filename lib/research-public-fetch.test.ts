import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { collectDiscoveredResearchSource, fetchDiscoveredResearchArticle } from './research-discovery';
import { fetchFreePublicWatchHtml } from './research-public-fetch';
import type { ResearchSourceSeed } from './research-types';

const source: ResearchSourceSeed = { id: 'public-watch', name: 'Publisher resource', url: 'https://publisher.example/resource', kind: 'web', pageMode: 'article', category: 'research', enabled: true, priority: 1, notes: '' };
const endpoint = 'https://treg.to/call/tinyfish.web.fetch';
const end = Date.parse('2026-10-28T12:00:00Z');
const quote = 'The original publisher describes a specific review step and its implementation tradeoff.';
const html = (date?: string) => `<html><head>${date ? `<meta property="article:published_time" content="${date}">` : ''}</head><main><h1>Original public framework</h1><p>${quote.repeat(12)}</p></main></html>`;
const record = () => ({ url: source.url, final_url: source.url, format: 'html', text: html(), title: 'Untrusted vendor title', published_date: '2026-10-28T11:00:00Z' });
beforeEach(() => {
  vi.stubEnv('TREG_TOKEN', 'test-free-fetch-token');
  vi.stubEnv('TREG_ORG', 'test-organization');
  vi.stubGlobal('fetch', vi.fn(async input => { throw new Error(`Unexpected network request: ${String(input)}`); }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it.each([undefined, '2025-09-01T10:00:00Z'])('uses only the free raw-HTML route and original public date after direct failure: %s', async date => {
  const fetcher = vi.fn(async (input: string | URL, options?: RequestInit) => {
    if (String(input) === source.url) {
      expect(options?.headers).not.toHaveProperty('X-Treg-Token');
      return new Response('Direct fetch blocked', { status: 403 });
    }
    expect(String(input)).toBe(endpoint);
    expect(options).toMatchObject({ method: 'POST', redirect: 'manual', headers: { 'X-Treg-Token': 'test-free-fetch-token', 'X-Treg-Org': 'test-organization', 'X-Treg-Route-Max-Cost': '0', 'X-Treg-Route-Waterfall': '0' } });
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(String(options?.body))).toEqual({ urls: [source.url], format: 'html', page_metadata: true, ttl: 0, per_url_timeout_ms: 12000 });
    return Response.json({ results: [{ ...record(), text: html(date) }], errors: [] });
  });
  vi.stubGlobal('fetch', fetcher);
  const result = await collectDiscoveredResearchSource(source, end - 86_400_000, end, new Set(), { deferArticleFetch: true });
  expect(result.items[0]).toMatchObject({ url: source.url, title: 'Original public framework', contentProvenance: 'article', publishedAt: date ? Date.parse(date) : null, content: expect.stringContaining(quote) });
  expect(result.items[0].title).not.toBe(record().title);
  expect(result.warning).toContain('public publisher body retrieved via free fetch');
  expect(result.items[0].retrievalNote).toBe(result.warning);
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it('never follows a broker redirect or forwards its credentials', async () => {
  const fetcher = vi.fn(async (input: string | URL) => String(input) === source.url
    ? new Response('', { status: 403 })
    : new Response(null, { status: 302, headers: { location: 'https://foreign.example/credential-capture' } }));
  vi.stubGlobal('fetch', fetcher);
  await expect(collectDiscoveredResearchSource(source, end - 1, end, new Set())).rejects.toThrow('Free public fetch returned HTTP 302');
  expect(fetcher.mock.calls.map(call => String(call[0]))).toEqual([source.url, endpoint]);
});

it.each([
  { url: 'https://publisher.example/other' },
  { final_url: 'https://foreign.example/resource' },
  { final_url: 'https://127.0.0.1/private' },
  { final_url: 'https://publisher.example/%6cogin' },
  { final_url: 'https://publisher.example/resource?access_token=private' },
  { final_url: undefined },
  { text: '' },
  { format: 'markdown', text: quote.repeat(12) },
  { format: 'summary' },
  { text: `<main><h1>Sign in to continue</h1><form><input type="password"></form>${quote.repeat(12)}</main>` },
  { text: `<article><h1>Subscriber article</h1>${'Subscribe to read this article. '.repeat(30)}</article>` },
  { text: `<script type="application/ld+json">{"isAccessibleForFree":false}</script>${html()}` },
  { text: `${html()}<aside class="paywall-gate">Subscriber access required</aside>` },
  { status_code: 403 },
])('rejects mismatched, gated or non-HTML results: %j', async change => {
  const fetcher = vi.fn(async () => Response.json({ results: [{ ...record(), ...change }], errors: [] }));
  vi.stubGlobal('fetch', fetcher);
  await expect(fetchFreePublicWatchHtml(source)).rejects.toThrow('Free public fetch');
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it.each([
  { results: [record(), record()], errors: [] },
  { results: [record()], errors: [{ message: 'Not a successful fetch' }] },
  { results: [], errors: [] },
])('requires exactly one successful requested result: %j', async payload => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(payload)));
  await expect(fetchFreePublicWatchHtml(source)).rejects.toThrow('Free public fetch');
});

it.each(['/login', '/resource.pdf', '/resource?access_token=private'])('does not proxy an authentication or media URL: %s', async path => {
  const fetcher = vi.fn(async () => new Response('', { status: 403 }));
  vi.stubGlobal('fetch', fetcher);
  await expect(collectDiscoveredResearchSource({ ...source, url: `https://publisher.example${path}` }, end - 1, end, new Set())).rejects.toThrow('HTTP 403');
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it.each([401, 402, 429])('keeps direct access and rate-limit failures on their existing path: %s', async status => {
  const fetcher = vi.fn(async () => new Response('', { status }));
  vi.stubGlobal('fetch', fetcher);
  await expect(collectDiscoveredResearchSource(source, end - 1, end, new Set())).rejects.toThrow(`HTTP ${status}`);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it.each(['index', undefined] as const)('never enables the fallback for an index source: %s', async pageMode => {
  const fetcher = vi.fn(async () => new Response('', { status: 403 }));
  vi.stubGlobal('fetch', fetcher);
  await expect(collectDiscoveredResearchSource({ ...source, pageMode }, end - 1, end, new Set())).rejects.toThrow('HTTP 403');
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('cancels streamed broker responses at 1.5MB', async () => {
  let cancelled = false;
  const body = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(800_000)); }, cancel() { cancelled = true; } });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(body)));
  await expect(fetchFreePublicWatchHtml(source)).rejects.toThrow('response is too large');
  expect(cancelled).toBe(true);
});

it('does not request a broker connection when no Worker token is configured', async () => {
  vi.stubEnv('TREG_TOKEN', '');
  const fetcher = vi.fn(async () => new Response('', { status: 403 }));
  vi.stubGlobal('fetch', fetcher);
  await expect(collectDiscoveredResearchSource(source, end - 1, end, new Set())).rejects.toThrow('HTTP 403');
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('reports rejected direct redirect hostnames without paths, queries or credentials', async () => {
  vi.stubEnv('TREG_TOKEN', '');
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 302, headers: { location: 'https://user:private-password@foreign.example/private-path?private-query=value' } })));
  const error = await collectDiscoveredResearchSource(source, end - 1, end, new Set()).catch(error => error as Error);
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toContain('host: foreign.example');
  for (const privateValue of ['user:', 'private-password', 'private-path', 'private-query']) expect((error as Error).message).not.toContain(privateValue);
});


it.each([undefined, '2025-09-01T10:00:00Z'])('hydrates an explicitly approved RSS original with free HTML and original date: %s', async date => {
  const rssSource: ResearchSourceSeed = { ...source, kind: 'rss', url: 'https://feed.example/news', feedUrl: 'https://feed.example/rss', freeArticleFallback: true, trustedArticleHosts: ['publisher.example'] };
  const fetcher = vi.fn(async (input: string | URL, options?: RequestInit) => {
    if (String(input) === source.url) return new Response('', { status: 403 });
    expect(String(input)).toBe(endpoint);
    expect(options?.headers).toMatchObject({ 'X-Treg-Route-Max-Cost': '0', 'X-Treg-Route-Waterfall': '0' });
    expect(JSON.parse(String(options?.body)).urls).toEqual([source.url]);
    return Response.json({ results: [{ ...record(), text: html(date) }], errors: [] });
  });
  vi.stubGlobal('fetch', fetcher);
  const item = await fetchDiscoveredResearchArticle(rssSource, { url: source.url, title: 'Feed title' }, end);
  expect(item).toMatchObject({ url: source.url, title: 'Original public framework', content: expect.stringContaining(quote), contentProvenance: 'article', publishedAt: date ? Date.parse(date) : null, retrievalNote: expect.stringContaining('free fetch') });
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it.each([401, 402, 429])('does not use an RSS fallback for access or rate limits: %s', async status => {
  const fetcher = vi.fn(async () => new Response('', { status }));
  vi.stubGlobal('fetch', fetcher);
  await expect(fetchDiscoveredResearchArticle({ ...source, kind: 'rss', feedUrl: 'https://publisher.example/feed', freeArticleFallback: true }, { url: source.url }, end)).rejects.toThrow(`HTTP ${status}`);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('never self-authorizes a foreign RSS target or proxies a rejected publisher redirect', async () => {
  const rssSource: ResearchSourceSeed = { ...source, kind: 'rss', feedUrl: 'https://publisher.example/feed', freeArticleFallback: true, trustedArticleHosts: ['blog.google'] };
  const fetcher = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'https://foreign.example/secret' } }));
  vi.stubGlobal('fetch', fetcher);
  await expect(fetchDiscoveredResearchArticle(rssSource, { url: 'https://foreign.example/article' }, end)).rejects.toThrow('outside the approved');
  expect(fetcher).not.toHaveBeenCalled();
  await expect(fetchDiscoveredResearchArticle(rssSource, { url: source.url }, end)).rejects.toThrow('Source redirect rejected');
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('keeps fallback disabled for RSS without explicit approval and for missing chapters', async () => {
  const fetcher = vi.fn(async () => new Response('', { status: 403 }));
  vi.stubGlobal('fetch', fetcher);
  await expect(fetchDiscoveredResearchArticle({ ...source, kind: 'rss', feedUrl: 'https://publisher.example/feed' }, { url: source.url }, end)).rejects.toThrow('HTTP 403');
  expect(fetcher).toHaveBeenCalledTimes(1);
  fetcher.mockImplementation(async () => new Response(html()));
  await expect(collectDiscoveredResearchSource({ ...source, articleSectionHeading: 'Absent chapter' }, end - 1, end, new Set())).rejects.toThrow('chapter heading');
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it.each(['https://x.com/resource', 'https://publisher.example/login'])('does not proxy social or gated RSS pages: %s', url => {
  const rssSource: ResearchSourceSeed = { ...source, url, kind: 'rss', feedUrl: `${new URL(url).origin}/feed`, freeArticleFallback: true };
  const fetcher = vi.fn(async () => new Response('', { status: 403 }));
  vi.stubGlobal('fetch', fetcher);
  return expect(fetchDiscoveredResearchArticle(rssSource, { url }, end)).rejects.toThrow('HTTP 403');
});


it('accepts only the configured sibling publisher as an RSS free-fetch final host', async () => {
  const rssSource: ResearchSourceSeed = { ...source, kind: 'rss', feedUrl: 'https://publisher.example/feed', freeArticleFallback: true, trustedArticleHosts: ['blog.google'] };
  const fetcher = vi.fn(async (input: string | URL) => String(input) === source.url
    ? new Response('', { status: 403 })
    : Response.json({ results: [{ ...record(), final_url: 'https://blog.google/official-original', text: html('2026-10-28T10:00:00Z') }], errors: [] }));
  vi.stubGlobal('fetch', fetcher);
  const item = await fetchDiscoveredResearchArticle(rssSource, { url: source.url }, end);
  expect(item).toMatchObject({ url: source.url, publishedAt: Date.parse('2026-10-28T10:00:00Z'), content: expect.stringContaining(quote) });
  fetcher.mockImplementation(async (input: string | URL) => String(input) === source.url
    ? new Response('', { status: 403 })
    : Response.json({ results: [{ ...record(), final_url: 'https://news.blog.google/foreign-original' }], errors: [] }));
  await expect(fetchDiscoveredResearchArticle(rssSource, { url: source.url }, end)).rejects.toThrow('approved source domains');
});


it('does not invent an extra www alias when an RSS entry uses a trusted article host', async () => {
  const rssSource: ResearchSourceSeed = { ...source, kind: 'rss', feedUrl: 'https://publisher.example/feed', freeArticleFallback: true, trustedArticleHosts: ['blog.google'] };
  const target = 'https://blog.google/official-original';
  const fetcher = vi.fn(async (input: string | URL) => String(input) === target
    ? new Response('', { status: 403 })
    : Response.json({ results: [{ ...record(), url: target, final_url: 'https://www.blog.google/official-original' }], errors: [] }));
  vi.stubGlobal('fetch', fetcher);
  await expect(fetchDiscoveredResearchArticle(rssSource, { url: target }, end)).rejects.toThrow('approved source domains');
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it('independently retrieves an opted-in public section at its original URL after a blocked redirect', async () => {
  const sectionSource = { ...source, articleSectionHeading: 'Public steps', freeArticleFallback: true };
  const originalHtml = `<meta property="article:published_time" content="2025-09-01T10:00:00Z"><main><h1>Original public framework</h1><p>${'Earlier definitions. '.repeat(1000)}</p><h2>Public steps</h2><p>${quote.repeat(12)}</p><h2>Next section</h2><p>Excluded source remainder.</p></main>`;
  const fetcher = vi.fn(async (input: string | URL, options?: RequestInit) => {
    if (String(input) === source.url) return new Response(null, { status: 302, headers: { location: 'https://www.google.com/unapproved-redirect' } });
    expect(String(input)).toBe(endpoint);
    expect(options).toMatchObject({ redirect: 'manual', headers: { 'X-Treg-Route-Max-Cost': '0', 'X-Treg-Route-Waterfall': '0' } });
    expect(JSON.parse(String(options?.body)).urls).toEqual([source.url]);
    return Response.json({ results: [{ ...record(), text: originalHtml }], errors: [] });
  });
  vi.stubGlobal('fetch', fetcher);
  const collection = await collectDiscoveredResearchSource(sectionSource, end - 1, end, new Set(), { deferArticleFetch: true });
  expect(collection.items[0]).toMatchObject({ url: source.url, title: 'Original public framework — Public steps', contentProvenance: 'public_section',
    content: `Public steps\n\n${quote.repeat(12)}`, publishedAt: Date.parse('2025-09-01T10:00:00Z'), retrievalNote: expect.stringContaining('free fetch') });
  expect(collection.warning).toContain('free fetch');
  expect(fetcher.mock.calls.map(call => String(call[0]))).toEqual([source.url, endpoint]);
});

it.each([
  { final_url: `${source.url}/other` },
  { final_url: `${source.url}?different=1` },
  { final_url: 'https://www.google.com/unapproved-redirect' },
  { final_url: 'https://publisher.example/login' },
  { text: `<main><h1>Sign in to continue</h1><input type="password"><p>${quote.repeat(12)}</p></main>` },
  { text: `${html()}<aside class="paywall-gate">Restricted.</aside>` },
])('does not reuse a different final page or gated HTML for an opted-in section: %j', async change => {
  const sectionSource = { ...source, articleSectionHeading: 'Public steps', freeArticleFallback: true };
  const fetcher = vi.fn(async (input: string | URL) => String(input) === source.url
    ? new Response(null, { status: 302, headers: { location: 'https://www.google.com/unapproved-redirect' } })
    : Response.json({ results: [{ ...record(), ...change }], errors: [] }));
  vi.stubGlobal('fetch', fetcher);
  await expect(collectDiscoveredResearchSource(sectionSource, end - 1, end, new Set())).rejects.toThrow('Free public fetch');
  expect(fetcher.mock.calls.map(call => String(call[0]))).toEqual([source.url, endpoint]);
});

it.each([401, 402, 429])('does not authorize a section fallback for HTTP%s', async status => {
  const fetcher = vi.fn(async () => new Response('', { status }));
  vi.stubGlobal('fetch', fetcher);
  await expect(collectDiscoveredResearchSource({ ...source, articleSectionHeading: 'Public steps', freeArticleFallback: true }, end - 1, end, new Set()))
    .rejects.toThrow(`HTTP ${status}`);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('does not repeat the free request when the original returned page lacks its configured section', async () => {
  const fetcher = vi.fn(async (input: string | URL) => String(input) === source.url
    ? new Response(null, { status: 302, headers: { location: 'https://www.google.com/unapproved-redirect' } })
    : Response.json({ results: [record()], errors: [] }));
  vi.stubGlobal('fetch', fetcher);
  await expect(collectDiscoveredResearchSource({ ...source, articleSectionHeading: 'Missing section', freeArticleFallback: true }, end - 1, end, new Set()))
    .rejects.toThrow('chapter heading');
  expect(fetcher.mock.calls.map(call => String(call[0]))).toEqual([source.url, endpoint]);
  fetcher.mockImplementation(async () => new Response(html()));
  await expect(collectDiscoveredResearchSource({ ...source, articleSectionHeading: 'Missing section', freeArticleFallback: true }, end - 1, end, new Set()))
    .rejects.toThrow('chapter heading');
  expect(fetcher).toHaveBeenCalledTimes(3);
});

it('retains the redirect block without both explicit fallback approval and an actual section selector', async () => {
  const fetcher = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'https://www.google.com/unapproved-redirect' } }));
  vi.stubGlobal('fetch', fetcher);
  for (const unapproved of [{ ...source, freeArticleFallback: true }, { ...source, articleSectionHeading: 'Public steps' }])
    await expect(collectDiscoveredResearchSource(unapproved, end - 1, end, new Set())).rejects.toThrow('Source redirect rejected');
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it('requires explicit fallback approval for a section even on an ordinary direct403 failure', async () => {
  const fetcher = vi.fn(async () => new Response('', { status: 403 }));
  vi.stubGlobal('fetch', fetcher);
  await expect(collectDiscoveredResearchSource({ ...source, articleSectionHeading: 'Public steps' }, end - 1, end, new Set())).rejects.toThrow('HTTP 403');
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('preserves the complete timestamp interval through the opted-in original-page fallback', async () => {
  const timestampSource = { ...source, freeArticleFallback: true, articleTimestampRange: { start: '0:10:00', end: '0:11:00' } };
  const selected = `Guest [0:10:00]: ${'The captured explanation stays complete. '.repeat(400).trim()}`;
  const originalHtml = `<main><h1>Original public framework</h1><p>${selected}</p><p>Host [0:11:00]: Excluded next topic.</p></main>`;
  const fetcher = vi.fn(async (input: string | URL) => String(input) === source.url
    ? new Response(null, { status: 302, headers: { location: 'https://www.google.com/unapproved-redirect' } })
    : Response.json({ results: [{ ...record(), text: originalHtml }], errors: [] }));
  vi.stubGlobal('fetch', fetcher);
  const result = await fetchDiscoveredResearchArticle(timestampSource, { url: source.url }, end);
  expect(result).toMatchObject({ url: source.url, publishedAt: null, contentProvenance: 'public_section', transcriptStatus: 'available', content: selected,
    retrievalNote: expect.stringContaining('free fetch') });
  expect(result.content!.length).toBeGreaterThan(14_000);
  expect(fetcher.mock.calls.map(call => String(call[0]))).toEqual([source.url, endpoint]);
});
