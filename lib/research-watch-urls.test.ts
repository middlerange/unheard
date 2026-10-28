import { expect, it } from 'vitest';
import { researchWatchUrlAliases } from './research-watch-urls';
import { canonicalResearchUrl } from './research-collectors';

it('matches stored slash variants while preserving meaningful queries and exact watch identity', () => {
  const watch = 'https://publisher.example/article?b=2&a=1&utm_source=reference#section';
  const aliases = researchWatchUrlAliases([watch, watch]);
  expect(aliases).toContain('https://publisher.example/article/?a=1&b=2');
  expect(aliases).toContain('https://publisher.example/article/?b=2&a=1&utm_source=reference');
  expect(aliases.every(url => canonicalResearchUrl(url) === canonicalResearchUrl(watch))).toBe(true);
  expect(new Set(aliases).size).toBe(aliases.length);
  expect(aliases).not.toContain('https://publisher.example/article/other?a=1&b=2');
  expect(aliases).not.toContain('https://publisher.example/article/?a=private&b=2');
});
