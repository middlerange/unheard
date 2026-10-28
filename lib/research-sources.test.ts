import { describe, expect, it } from 'vitest';
import { RESEARCH_SOURCE_SEEDS } from './research-sources';

describe('research source selection', () => {
  it('retains the original registry lineage while keeping competitor and community collection opt-in', () => {
    const originals = RESEARCH_SOURCE_SEEDS.filter(source => source.id.startsWith('original-'));

    expect(originals).toHaveLength(43);
    expect(originals.map(source => [source.name, source.url])).toEqual(expect.arrayContaining([
      ['Lenny’s archive', 'https://www.lennysnewsletter.com/archive'],
      ['Growth Unhinged archive', 'https://www.growthunhinged.com/archive'],
      ['Elena’s Growth Scoop archive', 'https://www.elenaverna.com/archive'],
      ['Appcues changelog', 'https://feedback.appcues.com/changelog'],
      ['r/ProductManagement', 'https://www.reddit.com/r/ProductManagement/'],
    ]));
    expect(RESEARCH_SOURCE_SEEDS.filter(source => source.enabled && ['competitor', 'community'].includes(source.category))).toEqual([]);
  });

  it('uses unique stable identifiers and collectable public entry points', () => {
    expect(new Set(RESEARCH_SOURCE_SEEDS.map(source => source.id)).size).toBe(RESEARCH_SOURCE_SEEDS.length);
    for (const source of RESEARCH_SOURCE_SEEDS) {
      expect(new URL(source.url).protocol).toBe('https:');
      if (source.kind === 'rss' || source.kind === 'youtube') {
        expect(new URL(source.feedUrl!).protocol).toBe('https:');
      }
      if (source.kind === 'youtube') {
        expect(source.channelId).toMatch(/^UC[\w-]{22}$/);
        expect(new URL(source.feedUrl!).searchParams.get('channel_id')).toBe(source.channelId);
        expect(source.notes).toContain('Descriptions are not transcripts');
      }
    }
  });

  it('covers primary AI announcements, original research and operator experiments by default', () => {
    const enabled = RESEARCH_SOURCE_SEEDS.filter(source => source.enabled);
    const industryHosts = enabled.filter(source => source.category === 'industry').map(source => new URL(source.url).hostname);
    expect(industryHosts).toEqual(expect.arrayContaining([
      'openai.com', 'www.anthropic.com', 'blog.google', 'huggingface.co', 'github.blog', 'stripe.com',
    ]));
    const researchHosts = enabled.filter(source => source.category === 'research').map(source => new URL(source.url).hostname);
    expect(researchHosts).toEqual(expect.arrayContaining([
      'deepmind.google', 'www.microsoft.com', 'www.nngroup.com', 'hai.stanford.edu', 'airbnb.tech', 'netflixtechblog.com',
    ]));
    expect(enabled.find(source => source.author === 'Ethan Mollick')?.category).toBe('practitioner');
    expect(enabled.filter(source => source.category === 'practitioner').map(source => source.author))
      .toEqual(expect.arrayContaining(['Simon Willison', 'Addy Osmani', 'Alexey Grigorev', 'Tim Herbig']));
  });

  it('bounds new web discovery to publisher article paths', () => {
    for (const id of ['anthropic-news', 'anthropic-research', 'anthropic-engineering', 'github-ai-workflows', 'stanford-hai-research', 'tim-herbig-product-practice']) {
      const source = RESEARCH_SOURCE_SEEDS.find(item => item.id === id)!;
      expect(source.kind).toBe('web');
      expect(source.maxDiscoveryLinks).toBeGreaterThan(0);
      expect(source.maxDiscoveryLinks).toBeLessThanOrEqual(24);
      expect(source.articlePathPrefixes?.length).toBeGreaterThan(0);
      for (const prefix of source.articlePathPrefixes ?? []) {
        expect(prefix).toMatch(/^\/[^/]+\/$/);
      }
    }
    expect(RESEARCH_SOURCE_SEEDS.find(source => source.id === 'google-ai-news')?.feedUrl)
      .toBe('https://blog.google/innovation-and-ai/technology/ai/rss/');
    expect(RESEARCH_SOURCE_SEEDS.find(source => source.id === 'alexey-on-data')?.feedUrl)
      .toBe('https://aishippingblog.com/feed');
    expect(RESEARCH_SOURCE_SEEDS.find(source => source.id === 'anthropic-engineering')?.articlePathPrefixes)
      .toEqual(['/engineering/', '/research/']);
  });

  it('adds bounded topic discovery without enabling competitor sources', () => {
    const discovery = RESEARCH_SOURCE_SEEDS.filter(source => source.kind === 'search' && source.discoveryProvider !== 'hackernews');
    expect(discovery.map(source => source.id).sort()).toEqual([
      'discovery-ai-workflows', 'discovery-practitioner-experiments', 'discovery-product-research',
    ]);
    expect(discovery.map(source => source.discoveryQueries?.length).sort()).toEqual([2, 3, 3]);
    const queries = discovery.flatMap(source => source.discoveryQueries ?? []);
    expect(new Set(queries).size).toBe(8);
    for (const source of discovery) {
      expect(source.enabled).toBe(true);
      expect(['practitioner', 'research']).toContain(source.category);
      expect(source.url).toBe('https://treg.to');
      expect(source.feedUrl).toBeUndefined();
      expect(source.notes).toContain('free-only');
      expect(source.notes).toContain('no paid fallback');
      expect(source.notes).toMatch(/original publication date|original date/);
      for (const query of source.discoveryQueries ?? []) {
        expect(query).toContain('-jobs');
        expect(query).toContain('-careers');
        expect(query).toMatch(/workflow|pricing|production|usability|study|research|experiment|case study|evaluation/);
      }
    }
    expect(RESEARCH_SOURCE_SEEDS.filter(source => source.category === 'competitor').every(source => !source.enabled)).toBe(true);
  });

  it('distinguishes Latent Space primary interviews from secondary roundup discovery', () => {
    const source = RESEARCH_SOURCE_SEEDS.find(source => source.id === 'latent-space')!;
    expect(source).toMatchObject({ enabled: true, kind: 'rss', url: 'https://latent.space', feedUrl: 'https://latent.space/feed' });
    expect(source.notes).toContain('two original interviews');
    expect(source.notes).toContain('secondary curation');
    expect(source.notes).toContain('preserve original dates');
  });
  it('adds public HN discovery without requiring a logged-in social account', () => {
    const source = RESEARCH_SOURCE_SEEDS.find(source => source.id === 'discovery-hackernews-public-signals')!;
    expect(source).toMatchObject({ enabled: true, kind: 'search', discoveryProvider: 'hackernews', url: 'https://hn.algolia.com' });
    expect(source.discoveryQueries).toHaveLength(3);
    expect(source.notes).toContain('verify its own publication date');
  });

  it('connects original upstream methods and preserves undated reference boundaries', () => {
    const feeds = RESEARCH_SOURCE_SEEDS.filter(source => ['jeff-gothelf-original', 'aws-ai-development-original', 'gartner-original-public-research'].includes(source.id));
    expect(feeds).toHaveLength(3);
    expect(feeds.every(source => source.enabled && source.kind === 'rss' && source.feedUrl)).toBe(true);
    for (const [id, prefix] of [['swan-original-changelog', '/changelog/'], ['rehearsals-original-updates', '/updates/']]) {
      expect(RESEARCH_SOURCE_SEEDS.find(source => source.id === id)).toMatchObject({ enabled: true, kind: 'web', articlePathPrefixes: [prefix] });
    }
    expect(RESEARCH_SOURCE_SEEDS.find(source => source.id === 'gartner-original-public-research')?.notes).toContain('HTTP403');
    for (const [id, original] of [
      ['aws-ai-development-original', 'https://aws.amazon.com/blogs/devops/ai-driven-development-life-cycle/'],
      ['swan-original-changelog', 'https://www.getswan.com/changelog/the-brain'],
      ['gartner-original-public-research', 'https://www.gartner.com/en/newsroom/press-releases/2025-06-25-gartner-predicts-over-40-percent-of-agentic-ai-projects-will-be-canceled-by-end-of-2027'],
    ]) expect(RESEARCH_SOURCE_SEEDS.find(source => source.id === id)?.backfillUrls).toContain(original);
    for (const id of ['marketing-skills-reference', 'outreach2day-product-economics']) {
      const reference = RESEARCH_SOURCE_SEEDS.find(source => source.id === id);
      expect(reference).toMatchObject({ enabled: true, kind: 'web', pageMode: 'article' });
      expect(reference?.notes).toContain('undated reference');
      expect(reference?.notes).toContain('do not treat a crawl as a launch');
    }
  });

});


it('restricts feed hydration and free fetch to their reviewed publisher and section watches', () => {
  const ids = ['google-deepmind-research', 'openai-news'];
  expect(RESEARCH_SOURCE_SEEDS.filter(source => source.hydratePublishedWindowOnly).map(source => source.id).sort()).toEqual(ids);
  expect(RESEARCH_SOURCE_SEEDS.filter(source => source.freeArticleFallback).map(source => source.id).sort()).toEqual(['google-ads-dynamic-prospecting', ...ids]);
  expect(RESEARCH_SOURCE_SEEDS.find(source => source.id === 'google-ads-dynamic-prospecting')).toMatchObject({
    kind: 'web', pageMode: 'article', articleSectionHeading: 'About dynamic prospecting', freeArticleFallback: true,
  });
  expect(RESEARCH_SOURCE_SEEDS.filter(source => source.trustedArticleHosts?.length).map(source => [source.id, source.trustedArticleHosts])).toEqual([['google-deepmind-research', ['blog.google']]]);
});
