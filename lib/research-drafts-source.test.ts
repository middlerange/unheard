import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from './schema';
import { createSyncResearchSqlite } from './research-test-sqlite';
import { rewriteResearchDraftContent, validateResearchDraftContent } from './research-drafts';
import type { ResearchDraftWritingInput } from './research-drafts';

const state = vi.hoisted(() => ({ db: null as unknown, generate: vi.fn() }));
vi.mock('./db/client', () => ({ getDb: async () => state.db }));
vi.mock('./research-model', async importOriginal => ({
  ...await importOriginal<typeof import('./research-model')>(), callResearchModel: state.generate,
}));

describe('complete draft source evidence', () => {
  it('freezes late primary and bundled literal evidence without changing attribution or source eligibility', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'research-draft-source-'));
    const sqlite = createSyncResearchSqlite(join(folder, 'db.sqlite'));
    function query(sql: string, params: unknown[] = []) {
      return sqlite.execute({ queries: [{ sql, params }] })[0].results;
    }
    class Statement {
      constructor(public sql: string, public params: unknown[] = []) {}
      bind(...params: unknown[]) { return new Statement(this.sql, params); }
      async all() { return sqlite.execute({ queries: [this] })[0]; }
      async raw() { return (await this.all()).results.map((row: object) => Object.values(row)); }
      async run() { return this.all(); }
    }
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network calls are forbidden in this fixture'));
    try {
      sqlite.execute({ script: readdirSync('drizzle-d1').filter(name => name.endsWith('.sql')).sort()
        .map(name => readFileSync(join('drizzle-d1', name), 'utf8')).join('\n') });
      state.db = drizzle({ prepare: (sql: string) => new Statement(sql),
        batch: async (statements: Statement[]) => sqlite.execute({ queries: statements }) } as never, { schema });
      const primaryQuote = 'A reviewer records the decision rationale before handing the approved plan to the implementer.';
      const relatedQuote = 'The implementer preserves the original rationale and returns unresolved assumptions to the reviewer.';
      const prefix = 'The public reference introduces the context for the documented workflow. '.repeat(230);
      const primaryContent = `${prefix}\n\n${primaryQuote}`;
      const relatedContent = `${prefix}\n\n${relatedQuote}`;
      const primaryUrl = 'https://publisher.example/decision';
      const relatedUrl = 'https://publisher.example/handoff';
      expect(primaryContent.indexOf(primaryQuote)).toBeGreaterThan(14_000);
      expect(relatedContent.indexOf(relatedQuote)).toBeGreaterThan(14_000);
      const current = { targets: [{ channelId: 'profile', platform: 'linkedin',
        content: `Preserve the decision rationale. ${primaryUrl}`, thread: [] }] };
      query("INSERT INTO teams(id,name,slug,created_at,updated_at) VALUES('team','Team','team',0,0),('other','Other','other',0,0)");
      query("INSERT INTO channels(id,team_id,name,platform,system_prompt,research_enabled,group_name,created_at) VALUES('profile','team','Builder','linkedin','Explain a grounded product-team workflow with truthful attribution.',1,'personal',0)");
      query("INSERT INTO research_runs(id,team_id,mode,status,days,created_at,icp) VALUES('run','team','scan','completed',1,2000,'Product-team decisions.')");
      const sources = [
        { id: 'primary', team: 'team', url: primaryUrl, content: primaryContent, publishedAt: 1000 },
        { id: 'a-foreign', team: 'other', url: 'https://publisher.example/foreign', content: relatedContent, publishedAt: 1000 },
        { id: 'b-unquoted', team: 'team', url: 'https://publisher.example/unquoted', content: `${prefix} Different ending.`, publishedAt: 1000 },
        { id: 'c-future', team: 'team', url: 'https://publisher.example/future', content: relatedContent, publishedAt: 3000 },
        { id: 'd-video', team: 'team', url: 'https://publisher.example/video', content: relatedContent, publishedAt: 1000 },
        { id: 'e-related', team: 'team', url: relatedUrl, content: relatedContent, publishedAt: 1000 },
      ];
      for (const source of sources) query('INSERT INTO research_items(id,team_id,source_id,canonical_url,title,excerpt,published_at,collected_at,content,content_provenance,content_type,transcript_status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
        [source.id, source.team, 'publisher', source.url, source.id, '', source.publishedAt, 1500, source.content, 'article',
          source.id === 'd-video' ? 'video' : 'article', source.id === 'd-video' ? 'unavailable' : 'not_applicable']);
      query("INSERT INTO research_findings(id,team_id,run_id,item_id,source_id,title,url,published_at,score,summary,why_it_matters,content_angle,evidence,limitations,created_at,family_key) VALUES('finding','team','run','primary','publisher','Decision handoff',?,1000,80,'A documented decision handoff.','Keep the rationale available.','Inspect the handoff.',?,'One described method.',1500,'decision-handoff')", [primaryUrl, primaryQuote]);
      query("INSERT INTO research_drafts(id,team_id,run_id,finding_id,content,created_at,updated_at) VALUES('draft','team','run','finding',?,1500,1500)", [JSON.stringify(current)]);
      query('INSERT INTO research_cache(id,team_id,value,created_at) VALUES(?,?,?,0)',
        ['research-family-sources:run:decision-handoff', 'team', JSON.stringify({ items: sources.map(source => ({ itemId: source.id,
          evidence: source.id === 'primary' ? primaryQuote : relatedQuote })) })]);
      const requests: ResearchDraftWritingInput[] = [];
      state.generate.mockImplementation(async (_instructions: string, input: ResearchDraftWritingInput) => {
        requests.push(input);
        return { value: { ready: false, reason: 'Fixture inspects evidence only; no draft is produced.', editorial: null, targets: [] }, inputTokens: 0, outputTokens: 0 };
      });
      await expect(rewriteResearchDraftContent('draft', 'team', 'Keep the source attribution.')).rejects.toThrow('cannot be supported by this source');
      expect(requests).toHaveLength(1);
      const inspected = requests[0].source;
      expect(inspected.content).toBe(primaryContent);
      expect(inspected.supportingSources).toEqual([{ url: relatedUrl, title: 'e-related', publishedAt: new Date(1000).toISOString(),
        content: relatedContent, contentProvenance: 'article' }]);
      const [frozen] = query("SELECT value FROM research_cache WHERE id LIKE 'research-writing-input:%'");
      expect(JSON.parse(frozen.value).source).toEqual(inspected);
      const content = `Preserve the rationale across the handoff. ${primaryUrl} ${relatedUrl}`;
      const generated = { ready: true, reason: 'A literal source-grounded fixture.', targets: [{
        channelId: 'profile', platform: 'linkedin', content, thread: [], supportQuote: primaryQuote, redditTitle: null, subreddit: null,
      }] };
      expect(validateResearchDraftContent(generated, requests[0].destinations, inspected)?.targets).toHaveLength(1);
      generated.targets[0].supportQuote = relatedQuote;
      expect(validateResearchDraftContent(generated, requests[0].destinations, inspected)?.targets).toHaveLength(1);
      generated.targets[0].supportQuote = 'An invented handoff guarantee unsupported by either complete document.';
      expect(() => validateResearchDraftContent(generated, requests[0].destinations, inspected)).toThrow('support quote');
      generated.targets[0].supportQuote = relatedQuote;
      generated.targets[0].content = `Preserve the rationale. ${primaryUrl}`;
      expect(() => validateResearchDraftContent(generated, requests[0].destinations, inspected)).toThrow('credit');
      expect(query("SELECT content,revision FROM research_drafts WHERE id='draft'")).toEqual([{ content: JSON.stringify(current), revision: 1 }]);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      sqlite.close(); rmSync(folder, { recursive: true, force: true }); vi.restoreAllMocks(); state.generate.mockReset();
    }
  });
});
