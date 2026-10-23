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
  });
});
