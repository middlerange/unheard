import { researchIdentityKey, type ResearchIdentityProfile } from './research-identity';

export type ResearchPriorDraft = {
  id: string; runId: string; findingId: string; content: string; createdAt: number;
  status: string; isTest: boolean; familyKey: string; title: string; url: string;
  publishedAt: number; summary: string; contentAngle: string; evidence: string;
};
export type ResearchPriorPost = {
  draftId: string; runId: string; createdAt: string; status: string;
  familyKey: string; title: string; sourceUrl: string; sourcePublishedAt: string;
  identityGroupIds: string[]; channelIds: string[];
  sourceFact: string; alpha: string | null; readerDecision: string | null;
  findingContentAngle: string; copyExcerpt: string; legacyWithoutEditorial: boolean;
};
export type ResearchNoveltyContext = {
  priorPosts: ResearchPriorPost[];
  priorPostRetrieval: { scannedCount: number; eligibleCount: number; matchingCount: number; includedCount: number; contextLimitPerIdentity: number; identities: Array<{ identityGroupId: string; matchingCount: number; includedCount: number }> };
};

const contextLimit = 8;
const stopWords = new Set('a an and are as at be been before by can could did do does for from had has have how i if in into is it its may more most new no not of on one only or our out over post reader same should source than that the their them then there these they this those to under up use used using was we were what when where which while who will with would you your article content finding insight decision useful practical specific supported evidence'.split(' '));
function terms(value: string) {
  return new Set((value.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}-]*/gu) || []).filter(word => word.length > 2 && !stopWords.has(word)).map(word => {
    if (word.length > 6 && word.endsWith('ing')) word = word.slice(0, -3);
    if (word.length > 4 && word.endsWith('s')) word = word.slice(0, -1);
    if (word.length > 5 && word.endsWith('e')) word = word.slice(0, -1);
    return word;
  }));
}
function sourceKey(value: string) {
  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()]) if (/^utm_/i.test(key) || ['fbclid', 'gclid'].includes(key)) url.searchParams.delete(key);
    url.searchParams.sort();
    return `${url.hostname.toLowerCase()}${url.pathname.replace(/\/$/, '')}${url.search}`;
  } catch {
    return value;
  }
}
function excerpt(value: string) {
  return value.length <= 1800 ? value : `${value.slice(0, 1100)}\n[…]\n${value.slice(-700)}`;
}

/** Inspect all saved history before selecting a small, auditable model context. */
export function researchNoveltyContext(
  drafts: ResearchPriorDraft[], channels: ResearchIdentityProfile[],
  current: { runId: string; findingId: string; familyKey: string; title: string; url: string; summary: string; contentAngle: string; evidence: string; content: string },
  destinations: ResearchIdentityProfile[],
): ResearchNoveltyContext {
  const identities = new Set(destinations.map(researchIdentityKey));
  const profiles = new Map(channels.map(channel => [channel.id, channel]));
  const eligible: Array<{ post: ResearchPriorPost; words: Set<string> }> = [];
  for (const draft of drafts) {
    if (draft.findingId === current.findingId && draft.runId === current.runId || draft.isTest) continue;
    let parsed: { targets?: Array<{ channelId: string; content: string; thread?: string[] }>; editorial?: { sourceFact?: string; alpha?: string; readerDecision?: string } };
    try { parsed = JSON.parse(draft.content); } catch { continue; }
    if (!parsed || !Array.isArray(parsed.targets)) continue;
    const targets = parsed.targets.filter(target => target && typeof target.channelId === 'string' && typeof target.content === 'string');
    const identityFor = (channelId: string) => profiles.has(channelId) ? researchIdentityKey(profiles.get(channelId)!) : `channel:${channelId}`;
    const targetIdentities = [...new Set(targets.map(target => identityFor(target.channelId)))];
    for (const identity of targetIdentities) {
      if (!identities.has(identity)) continue;
      const scopedTargets = targets.filter(target => identityFor(target.channelId) === identity);
      const channelIds = [...new Set(scopedTargets.map(target => target.channelId))];
      const copies = scopedTargets.map(target => [target.content, ...(Array.isArray(target.thread) ? target.thread.filter(part => typeof part === 'string') : [])].join('\n'));
      const copy = copies.sort((a, b) => b.length - a.length)[0] || '';
      // A legacy mixed-account draft has no trustworthy shared decision ledger.
      const ledger = targetIdentities.length === 1 ? parsed.editorial : undefined;
      const post: ResearchPriorPost = {
        draftId: draft.id, runId: draft.runId, createdAt: new Date(draft.createdAt).toISOString(), status: draft.status,
        familyKey: draft.familyKey, title: draft.title, sourceUrl: draft.url, sourcePublishedAt: new Date(draft.publishedAt).toISOString(),
        identityGroupIds: [identity], channelIds, sourceFact: ledger?.sourceFact || draft.evidence || draft.summary,
        alpha: ledger?.alpha || null, readerDecision: ledger?.readerDecision || null,
        findingContentAngle: draft.contentAngle, copyExcerpt: excerpt(copy), legacyWithoutEditorial: !ledger?.readerDecision,
      };
      eligible.push({ post, words: terms([draft.title, post.sourceFact, post.alpha, post.readerDecision, post.findingContentAngle, post.copyExcerpt].join(' ')) });
    }
  }
  const priority = terms([current.title, current.summary, current.contentAngle, current.evidence].join(' '));
  const query = terms(current.content);
  for (const term of priority) query.add(term);
  const frequencies = new Map<string, number>();
  for (const { words } of eligible) for (const word of words) frequencies.set(word, (frequencies.get(word) || 0) + 1);
  const relevant = eligible.flatMap(({ post, words }) => {
    const overlap = [...words].filter(word => query.has(word));
    const sameSource = sourceKey(post.sourceUrl) === sourceKey(current.url);
    const sameFamily = post.familyKey === current.familyKey;
    const specificMatch = overlap.some(word => priority.has(word) && (frequencies.get(word) || 0) <= 2);
    if (!sameSource && !sameFamily && overlap.length < 2 && !specificMatch) return [];
    const score = (sameSource ? 1000 : 0) + (sameFamily ? 10 : 0) + overlap.reduce((sum, word) => sum + (priority.has(word) ? 3 : 1) * (1 + Math.log(1 + eligible.length / (frequencies.get(word) || 1))), 0) / Math.sqrt(Math.max(1, words.size));
    return [{ post, score }];
  }).sort((a, b) => b.score - a.score || b.post.createdAt.localeCompare(a.post.createdAt) || a.post.draftId.localeCompare(b.post.draftId));
  const selected = new Map<string, ResearchPriorPost>();
  const coverage = [...identities].map(identityGroupId => {
    const matches = relevant.filter(entry => entry.post.identityGroupIds.includes(identityGroupId));
    const included = matches.slice(0, contextLimit);
    for (const entry of included) selected.set(`${entry.post.draftId}:${identityGroupId}`, entry.post);
    return { identityGroupId, matchingCount: matches.length, includedCount: included.length };
  });
  const priorPosts = [...selected.values()];
  return { priorPosts, priorPostRetrieval: { scannedCount: drafts.length, eligibleCount: eligible.length, matchingCount: relevant.length, includedCount: priorPosts.length, contextLimitPerIdentity: contextLimit, identities: coverage } };
}
