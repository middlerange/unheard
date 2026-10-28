import { canonicalResearchUrl } from './research-collectors';

export function researchWatchUrlAliases(watches: string[]): string[] {
  const aliases = new Set<string>();
  for (const watch of watches) {
    const canonical = canonicalResearchUrl(watch);
    for (const value of [watch, canonical]) {
      const url = new URL(value); url.hash = '';
      aliases.add(url.href);
      if (url.pathname !== '/') {
        url.pathname = url.pathname.endsWith('/') ? url.pathname.slice(0, -1) : url.pathname + '/';
        aliases.add(url.href);
      }
    }
    aliases.add(watch);
  }
  return [...aliases];
}
