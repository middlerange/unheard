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
});
