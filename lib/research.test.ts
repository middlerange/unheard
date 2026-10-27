import {
  getResearchProfiles,
  updateResearchProfile,
} from "./research-profiles";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";
import {
  assertPublicResearchUrl,
  canonicalResearchUrl,
  parseResearchFeed,
  parseResearchDate,
  fetchResearchText,
  parsePublicCaptionText,
  parsePublicCaptionTracks,
  articleResearchText,
  discoverResearchLinks,
} from "./research-collectors";
import {
  signResearchRequest,
  verifyResearchRequest,
} from "./research-internal";
import {
  researchHash, validateResearchEvidence,
  RESEARCH_SCREEN_INSTRUCTIONS, RESEARCH_EVIDENCE_INSTRUCTIONS,
  RESEARCH_SCREEN_BATCH_SIZE,
} from "./research-model";
import { callResearchModel } from "./research-model";
import { RESEARCH_WRITING_MODEL } from "./research-writing";
import { beginResearchUsage, finishResearchUsage, getResearchUsage } from "./research-usage";
import {
  processResearchDraftJob,
  rewriteResearchDraftContent,
} from "./research-drafts";
import { createSlackTestReview } from "./slack-test-review";
import { SLACK_TEST_EVIDENCE, SLACK_TEST_PROMPT } from "./slack-test-content";
import type { ResearchSourceSeed } from "./research-types";
import { RESEARCH_SOURCE_SEEDS } from "./research-sources";
function editorialFixture(content: string) {
  return {
    writingStyle: "b2b-practitioner-teardown", styleRationale: "The source describes a concrete practitioner workflow to inspect.",
    sourceFact: "A practitioner describes a specific user action and the surrounding workflow.",
    evidenceQuote: content.slice(0, Math.min(120, content.length)),
    alpha: "Inspect the alternate route before changing which steps are required for new users.",
    readerDecision: "Audit each entry route before adding a setup gate to onboarding.",
    boundary: "This account does not measure the effect on conversion.",
  };
}
function modelResponseFixture(value: {
  status: string;
  usage?: unknown;
  output?: Array<{ content: Array<{ type: string; text: string }> }>;
}) {
  return Response.json({
    ...value,
    stop_reason: value.status === "completed" ? "end_turn" : "max_tokens",
    content: value.output?.flatMap(item => item.content.map(part => ({ ...part, type: "text" }))),
  });
}
function editorialReviewFixture() {
  return modelResponseFixture({ status: "completed", usage: { input_tokens: 10, output_tokens: 5 }, output: [{ content: [{ type: "output_text", text: JSON.stringify({ verdict: "ready", reason: "A specific source supports a bounded reader decision.", issues: [] }) }] }] });
}
function screeningFixture(value: unknown, items?: Array<{ id: string }>) {
  const output = value as { itemIds?: string[] };
  if (!Array.isArray(output?.itemIds)) return value;
  return { ...output, assessments: (items || []).map(item => ({
    itemId: item.id, selected: output.itemIds!.includes(item.id),
    reason: output.itemIds!.includes(item.id) ? "A specific supported workflow merits full evidence review." : "No usable profile-relevant mechanism is supplied.",
  })) };
}
const state = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("./db/client", () => ({ getDb: async () => state.db }));
import {
  actOnResearchFinding,
  createResearchRun,
  getResearchSnapshot,
  initializeResearch,
  processResearchJob,
  researchSourceErrorMessage,
  updateResearchSettings,
  updateResearchSource,
} from "./research";
async function finishResearchDraftJob(runId: string) {
  let result = await processResearchDraftJob(runId);
  while ("pending" in result && result.pending) result = await processResearchDraftJob(runId);
  return result;
}
async function finishResearchRankJob(runId: string) {
  let result = await processResearchJob({ operation: "rank", runId });
  while ("pending" in result && result.pending) result = await processResearchJob({ operation: "rank", runId });
  return result;
}
const source: ResearchSourceSeed = {
  id: "example",
  name: "Example",
  url: "https://example.com",
  feedUrl: "https://example.com/feed",
  kind: "rss",
  category: "practitioner",
  enabled: true,
  notes: "",
  priority: 1,
};
describe("research collectors and grounded evidence", () => {
  it("reports underlying source storage errors without exposing SQL bindings", () => {
    expect(researchSourceErrorMessage(new Error("Failed query: insert values params: private", { cause: new Error("D1_ERROR: Too many requests") }))).toBe("D1_ERROR: Too many requests");
    expect(researchSourceErrorMessage(new Error("Failed query: insert values params: private"))).not.toContain("private");
    expect(researchSourceErrorMessage(new Error("Source returned HTTP 429"))).toBe("Source returned HTTP 429");
  });
  it("parses RSS and Atom dates without treating missing or updated dates as fresh", () => {
    const rss = parseResearchFeed(
      "<rss><channel><item><title><![CDATA[Practical <b>growth</b>]]></title><link>https://example.com/story?utm_source=x</link><pubDate>Thu, 22 Oct 2026 10:00:00 GMT</pubDate><description><![CDATA[Original insight &amp; details]]></description></item><item><title>Old undated post</title><link>https://example.com/old</link></item></channel></rss>",
      source,
    );
    expect(rss[0].title).toBe("Practical growth");
    expect(rss[0].url).toBe("https://example.com/story");
    expect(rss[0].publishedAt).not.toBeNull();
    expect(rss[1].publishedAt).toBeNull();
    const atom = parseResearchFeed(
      '<feed><entry><title>Original research</title><link rel="alternate" href="https://example.com/atom"/><updated>2026-10-22</updated></entry></feed>',
      source,
    );
    expect(atom[0].url).toBe("https://example.com/atom");
    expect(atom[0].publishedAt).toBeNull();
    expect(parseResearchDate("tomorrow")).toBeNull();
  });
  it("canonicalizes tracking parameters and rejects XML entities/private hosts/redirects", async () => {
    expect(
      canonicalResearchUrl("https://example.com/a/?utm_campaign=a&b=1#section"),
    ).toBe("https://example.com/a?b=1");
    for (const url of [
      "http://example.com",
      "https://127.0.0.1",
      "https://[::1]",
      "https://private.local",
      "https://u:p@example.com",
      "https://2130706433",
    ])
      expect(() => assertPublicResearchUrl(url)).toThrow();
    expect(() =>
      parseResearchFeed(
        '<!DOCTYPE x [<!ENTITY x SYSTEM "file:///etc/passwd">]><rss/>',
        source,
      ),
    ).toThrow();
    const fetcher = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://127.0.0.1/private" },
        }),
    );
    await expect(
      fetchResearchText(
        "https://example.com/feed",
        new Set(["example.com"]),
        fetcher,
      ),
    ).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("bounds streamed bodies and extracts article text ahead of navigation", async () => {
    await expect(
      fetchResearchText(
        "https://example.com",
        new Set(["example.com"]),
        async () => new Response("x".repeat(1_500_001)),
      ),
    ).rejects.toThrow("too large");
    expect(
      articleResearchText(
        "<nav>Menu</nav><article>Actual evidence</article><aside>Promotions</aside>",
      ),
    ).toBe("Actual evidence");
  });
  it("discovers content links ahead of global navigation", () => {
    expect(
      discoverResearchLinks(
        '<nav><a href="/pricing">Explore our pricing options</a></nav><main><a href="/actual-article">A practical original article</a></main>',
        source,
      ),
    ).toEqual(["https://example.com/actual-article"]);
  });
  it("discovers Beehiiv archive cards whose article title is an accessible label", () => {
    const beehiivSource = {
      ...source,
      url: "https://www.growthunhinged.com/archive",
      feedUrl: undefined,
      kind: "web" as const,
    };
    // Growth Unhinged puts the heading outside the anchor, while its visible anchor text contains only a short category.
    const html = `<nav><a href="/premium-perks" aria-label="Explore premium benefits">Premium</a></nav><div><a href="/p/ai-brain-for-your-positioning" class="relative" aria-label="How to build an AI brain for your positioning "><div><strong>Marketing</strong></div></a><h3>How to build an AI brain for your positioning</h3></div><a aria-label="Usage based pricing for AI products" href="/p/usage-based-pricing-for-ai"><span>Pricing</span></a><a href="/settings">Settings</a>`;
    expect(discoverResearchLinks(html, beehiivSource)).toEqual([
      "https://www.growthunhinged.com/p/ai-brain-for-your-positioning",
      "https://www.growthunhinged.com/p/usage-based-pricing-for-ai",
    ]);
  });
  it("accepts only exact supplied evidence and refuses unknown model item IDs", () => {
    const valid = {
      itemId: "known",
      score: 90,
      summary: "Summary",
      whyItMatters: "Useful",
      contentAngle: "Angle",
      evidence: "the actual published evidence",
      limitations: "Anecdotal",
      familyKey: "original-event",
    };
    expect(
      validateResearchEvidence(
        [
          valid,
          { ...valid, itemId: "invented" },
          {
            ...valid,
            itemId: "other",
            evidence: "unsupported invented evidence",
          },
        ],
        [
          {
            id: "known",
            content: "Here is the actual published evidence in full.",
          },
          { id: "other", content: "No support here." },
        ],
      ),
    ).toEqual([valid]);
  });
  it("extracts public captions without treating metadata as a transcript", () => {
    expect(
      parsePublicCaptionTracks(
        '{"captionTracks":[{"baseUrl":"https://www.youtube.com/api/timedtext?a=1","languageCode":"en"}]}',
      ),
    ).toEqual([
      {
        baseUrl: "https://www.youtube.com/api/timedtext?a=1",
        languageCode: "en",
      },
    ]);
    expect(parsePublicCaptionTracks("Video description only")).toEqual([]);
    expect(
      parsePublicCaptionText(
        '{"events":[{"segs":[{"utf8":"Hello"},{"utf8":" world"}]}]}',
      ),
    ).toBe("Hello world");
  });
});
describe("internal workflow authentication", () => {
  it("rejects tampering, expiry, and missing/weak secrets", async () => {
    const body = '{"operation":"daily"}';
    const secret = "a".repeat(32);
    const signed = await signResearchRequest(body, secret);
    const request = new Request("https://app.test/api/research/process", {
      headers: {
        "x-research-timestamp": signed.timestamp,
        "x-research-signature": signed.signature,
      },
    });
    expect(await verifyResearchRequest(request, body, secret)).toBe(true);
    expect(await verifyResearchRequest(request, `${body} `, secret)).toBe(
      false,
    );
    expect(
      await verifyResearchRequest(request, body, secret, Date.now() + 300_001),
    ).toBe(false);
    expect(await verifyResearchRequest(request, body, "weak")).toBe(false);
  });
});
// Real SQLite exercises D1 SQL, conflict handling and tenant boundaries without a cloud account.
describe("research persistence and team isolation", () => {
  const folder = mkdtempSync(join(tmpdir(), "content-research-test-"));
  const path = join(folder, "db.sqlite");
  const python = `import json,sqlite3,sys\np=json.load(sys.stdin)\nc=sqlite3.connect(p['path'])\nc.row_factory=sqlite3.Row\nc.execute('PRAGMA foreign_keys=ON')\nif 'script' in p:\n c.executescript(p['script']); c.commit(); print('[]')\nelse:\n out=[]\n for q in p['queries']:\n  cur=c.execute(q['sql'],q.get('params',[])); out.append({'results':[dict(r) for r in cur.fetchall()],'success':True,'meta':{'changes':cur.rowcount}})\n c.commit(); print(json.dumps(out))`;
  function execute(payload: object) {
    const inputPath = join(folder, "query.json");
    writeFileSync(inputPath, JSON.stringify({ path, ...payload }));
    const input = openSync(inputPath, "r");
    try {
      const result = spawnSync("python3", ["-c", python], {
        stdio: [input, "pipe", "pipe"], encoding: "utf8", timeout: 30_000, maxBuffer: 16 * 1024 * 1024,
      });
      if (result.status !== 0) throw result.error || new Error(result.stderr);
      return JSON.parse(result.stdout);
    } finally {
      closeSync(input);
    }
  }
  class Statement {
    constructor(
      public sql: string,
      public params: unknown[] = [],
    ) {}
    bind(...params: unknown[]) {
      return new Statement(this.sql, params);
    }
    async all() {
      return execute({ queries: [this] })[0];
    }
    async raw() {
      const result = await this.all();
      return result.results.map((row: Record<string, unknown>) =>
        Object.values(row),
      );
    }
    async run() {
      return this.all();
    }
  }
  beforeAll(async () => {
    execute({
      script: readdirSync("drizzle-d1")
        .filter((name) => name.endsWith(".sql"))
        .sort()
        .map((name) => readFileSync(join("drizzle-d1", name), "utf8"))
        .join("\n"),
    });
    const binding = {
      prepare: (sql: string) => new Statement(sql),
      batch: async (queries: Statement[]) => execute({ queries }),
    };
    state.db = drizzle(binding as never, { schema });
    execute({
      queries: ["a", "b"].map((id) => ({
        sql: "INSERT INTO teams(id,name,slug,created_at,updated_at) VALUES(?,?,?,?,?)",
        params: [id, id, id, 0, 0],
      })),
    });
    await initializeResearch("a");
    await initializeResearch("b");
  });
  afterAll(() => {
    rmSync(folder, { recursive: true, force: true });
    globalThis.__contentHubResearchWorkflow__ = undefined;
  });
  it("keeps source preferences and runs inside their team", async () => {
    const a = await getResearchSnapshot("a");
    const seedId = a.sources[0].id;
    await updateResearchSource("a", { id: seedId, enabled: false });
    expect((await getResearchSnapshot("a")).sources[0].enabled).toBe(false);
    expect((await getResearchSnapshot("b")).sources[0].enabled).toBe(
      a.sources[0].enabled,
    );
    globalThis.__contentHubResearchWorkflow__ = {
      create: vi.fn(async () => ({})),
    };
    const first = await createResearchRun("a", { mode: "collect", days: 30 });
    const second = await createResearchRun("a", { mode: "collect", days: 30 });
    expect(first.run.id).toBe(second.run.id);
    expect((await getResearchSnapshot("b")).runs).toHaveLength(0);
    expect(
      globalThis.__contentHubResearchWorkflow__.create,
    ).toHaveBeenLastCalledWith({
      id: first.run.id,
      params: { runId: first.run.id },
    });
    await processResearchJob({
      operation: "fail",
      runId: first.run.id,
      error: "test finished",
    });
  }, 20_000);
  it("accepts a seven-day discovery run, respects publication and discovery windows, and never drafts", async () => {
    const now = Date.now();
    const seed = RESEARCH_SOURCE_SEEDS.find(source => source.feedUrl && source.kind === "rss")!;
    execute({ queries: [{ sql: "INSERT INTO teams(id,name,slug,created_at,updated_at) VALUES('weekly-window','Weekly window','weekly-window',?,?)", params: [now, now] }] });
    await initializeResearch("weekly-window");
    execute({ queries: [
      { sql: "UPDATE research_sources SET enabled=0 WHERE team_id='weekly-window'" },
      { sql: "UPDATE research_sources SET enabled=1 WHERE team_id='weekly-window' AND seed_id=?", params: [seed.id] },
    ] });
    globalThis.__contentHubResearchWorkflow__ = { create: vi.fn(async () => ({})) };
    const previousKey = process.env.OPENAI_API_KEY;
    const previousAnthropicKey = process.env.ANTHROPIC_API_KEY;
    process.env.OPENAI_API_KEY = "weekly-test-key";
    process.env.ANTHROPIC_API_KEY = "weekly-test-key";
    const evidence = "The team separated optional marketing consent from required account creation checks across every authentication path.";
    let fetcher: ReturnType<typeof vi.spyOn> | undefined;
    try {
      const { run } = await createResearchRun("weekly-window", { days: 7, mode: "scan" }, true);
      expect(run).toMatchObject({ days: 7, editorial: false });
      execute({ queries: [{ sql: "INSERT INTO research_run_sources(id,run_id,source_id,status) VALUES(?,?,?,'completed')", params: ["weekly-step", run.id, seed.id] }] });
      const rows = [
        { id: "weekly-inside", date: run.createdAt - 6 * 86_400_000 },
        { id: "weekly-boundary", date: run.createdAt - 7 * 86_400_000 },
        { id: "weekly-too-old", date: run.createdAt - 7 * 86_400_000 - 1 },
        { id: "weekly-future", date: run.createdAt + 1 },
        { id: "weekly-undated", date: null },
      ];
      execute({ queries: rows.map(row => ({
        sql: "INSERT INTO research_items(id,team_id,source_id,canonical_url,title,excerpt,published_at,collected_at,content,content_provenance) VALUES(?,'weekly-window',?,?,?,?,?,?,?,'article')",
        params: [row.id, seed.id, new URL(row.id, seed.url).href, row.id, evidence, row.date, row.id === "weekly-too-old" ? run.createdAt - 8 * 86_400_000 : now, evidence.repeat(10)],
      })) });
      const selected = ["weekly-inside", "weekly-boundary"];
      fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
        expect(String(url)).toBe("https://api.anthropic.com/v1/messages");
        const request = JSON.parse(String(init?.body));
        const input = JSON.parse(request.input ?? request.messages[0].content);
      if (input.proposed) return editorialReviewFixture();
        expect(input.items.map((item: { id: string }) => item.id).sort()).toEqual([...selected].sort());
        const value = (request.text?.format.schema ?? request.output_config.format.schema).properties.assessments
          ? { itemIds: selected }
          : { findings: selected.map((id, index) => ({ itemId: id, score: index ? 75 : 85, summary: "A documented account creation decision", whyItMatters: "Optional consent should not block signup", contentAngle: "Audit authentication paths", evidence, limitations: "A first-party descriptive account, not a conversion experiment", familyKey: id })) };
        return modelResponseFixture({ status: "completed", usage: { input_tokens: 100, output_tokens: 50 }, output: [{ content: [{ type: "output_text", text: JSON.stringify(screeningFixture(value, input.items)) }] }] });
      });
      await processResearchJob({ operation: "rank", runId: run.id });
      await processResearchJob({ operation: "drafts", runId: run.id });
      const snapshot = await getResearchSnapshot("weekly-window");
      expect(snapshot.runs.find(row => row.id === run.id)).toMatchObject({ status: "completed", days: 7, editorial: false, diagnostics: { eligibleCount: 2, screenedCount: 2, undatedCount: 1 } });
      expect(snapshot.findings.map(row => row.itemId).sort()).toEqual([...selected].sort());
      expect(snapshot.drafts).toEqual([]);
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally {
      fetcher?.mockRestore();
      if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previousKey;
      if (previousAnthropicKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = previousAnthropicKey;
    }
  }, 20_000);
  it("collects RSS once per step, recovers missing dates/public evidence, and preserves an established publication date", async () => {
    globalThis.__contentHubResearchWorkflow__ = { create: vi.fn(async () => ({})) };
    const seed = RESEARCH_SOURCE_SEEDS.find(
      (source) => source.feedUrl && source.kind === "rss",
    )!;
    execute({
      queries: [
        { sql: "UPDATE research_sources SET enabled=0 WHERE team_id='b'" },
        {
          sql: "UPDATE research_sources SET enabled=1 WHERE team_id='b' AND seed_id=?",
          params: [seed.id],
        },
      ],
    });
    const hostname = new URL(seed.url).origin;
    const fetcher = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(
          `<rss><channel><item><title>Useful original practitioner lesson</title><link>${hostname}/research-test-story</link><description>First hand account</description></item></channel></rss>`,
          { headers: { "content-type": "application/rss+xml" } },
        ),
      );
    try {
      const { run } = await createResearchRun("b", {
        mode: "collect",
        days: 30,
      });
      expect(
        await processResearchJob({ operation: "plan", runId: run.id }),
      ).toEqual({ sourceIds: [seed.id] });
      await expect(
        processResearchJob({ operation: "rank", runId: run.id }),
      ).rejects.toThrow("not finished");
      expect(
        await processResearchJob({
          operation: "collect",
          runId: run.id,
          sourceId: seed.id,
        }),
      ).toMatchObject({ collected: 1 });
      expect(
        await processResearchJob({
          operation: "collect",
          runId: run.id,
          sourceId: seed.id,
        }),
      ).toMatchObject({ collected: 1 });
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(
        execute({
          queries: [
            {
              sql: "SELECT published_at FROM research_items WHERE team_id='b'",
            },
          ],
        })[0].results,
      ).toEqual([{ published_at: null }]);
      await processResearchJob({ operation: "rank", runId: run.id });
      expect((await getResearchSnapshot("b")).runs[0].status).toBe("completed");
      const published = Date.parse("2026-10-22T10:00:00Z");
      const publicText = "A public practitioner lesson explaining how interviews improve customer adoption. ".repeat(12).trim();
      fetcher.mockResolvedValueOnce(new Response(
        `<rss><channel><item><title>Updated original practitioner lesson</title><link>${hostname}/research-test-story</link><description>More useful public context</description><pubDate>Thu, 22 Oct 2026 10:00:00 GMT</pubDate><content:encoded><![CDATA[<p>${publicText}</p>]]></content:encoded></item></channel></rss>`,
        { headers: { "content-type": "application/rss+xml" } },
      ));
      const second = await createResearchRun("b", { mode: "collect", days: 30 });
      expect(await processResearchJob({ operation: "collect", runId: second.run.id, sourceId: seed.id })).toMatchObject({ collected: 0 });
      expect(execute({ queries: [{ sql: "SELECT title,excerpt,published_at,content,content_provenance FROM research_items WHERE team_id='b'" }] })[0].results).toEqual([{
        title: "Updated original practitioner lesson", excerpt: "More useful public context",
        published_at: published, content: publicText, content_provenance: "public_feed",
      }]);
      await processResearchJob({ operation: "rank", runId: second.run.id });
      const articleText = "Full public article evidence with the study methodology, outcomes, and relevant limitations. ".repeat(24).trim();
      execute({ queries: [{
        sql: "UPDATE research_items SET content=?,content_provenance='article',content_hash='verified-article-hash' WHERE team_id='b'",
        params: [articleText],
      }] });
      fetcher.mockResolvedValueOnce(new Response(
        `<rss><channel><item><title>Latest metadata for the same article</title><link>${hostname}/research-test-story</link><description>Another metadata refresh</description><pubDate>Fri, 23 Oct 2026 10:00:00 GMT</pubDate><content:encoded><![CDATA[<p>${publicText}</p>]]></content:encoded></item></channel></rss>`,
        { headers: { "content-type": "application/rss+xml" } },
      ));
      const third = await createResearchRun("b", { mode: "collect", days: 30 });
      expect(await processResearchJob({ operation: "collect", runId: third.run.id, sourceId: seed.id })).toMatchObject({ collected: 0 });
      expect(execute({ queries: [{ sql: "SELECT title,excerpt,published_at,content,content_provenance,content_hash FROM research_items WHERE team_id='b'" }] })[0].results).toEqual([{
        title: "Latest metadata for the same article", excerpt: "Another metadata refresh",
        published_at: published, content: articleText, content_provenance: "article", content_hash: "verified-article-hash",
      }]);
      await processResearchJob({ operation: "rank", runId: third.run.id });
      expect(fetcher).toHaveBeenCalledTimes(3);
    } finally {
      fetcher.mockRestore();
    }
  }, 30_000);
  it("chooses one complete configured identity and repairs a mixed model response", async () => {
    const now = Date.now();
    const quote = "Required consent is collected on every account-creation path.";
    const profiles = [
      { id: "identity-company-li", platform: "linkedin", group: "company" },
      { id: "identity-company-x", platform: "twitter", group: "company" },
      { id: "identity-personal-li", platform: "linkedin", group: "personal" },
      { id: "identity-personal-x", platform: "twitter", group: "personal" },
    ];
    execute({ queries: [
      { sql: "INSERT INTO teams(id,name,slug,created_at,updated_at) VALUES('identity-generation','Identity generation','identity-generation',0,0)" },
      ...profiles.map(profile => ({ sql: "INSERT INTO channels(id,team_id,name,platform,group_name,research_enabled,system_prompt,created_at) VALUES(?,'identity-generation',?,?,?,1,'Write concrete product onboarding lessons',0)", params: [profile.id, profile.id, profile.platform, profile.group] })),
      { sql: "INSERT INTO research_runs(id,team_id,mode,status,days,editorial,created_at,icp,source_ids) VALUES('identity-generation-run','identity-generation','scan','drafting',1,1,?,'Product teams',?)", params: [now, JSON.stringify(["identity-source"])] },
      { sql: "INSERT INTO research_items(id,team_id,source_id,canonical_url,title,excerpt,published_at,collected_at,content,content_provenance) VALUES('identity-generation-item','identity-generation','identity-source','https://example.com/identity-story','Signup paths',?,?,?,?,'article')", params: [quote, now - 1000, now, quote.repeat(15)] },
      { sql: "INSERT INTO research_findings(id,team_id,run_id,item_id,source_id,title,url,published_at,score,summary,why_it_matters,content_angle,evidence,limitations,created_at,family_key) VALUES('identity-generation-finding','identity-generation','identity-generation-run','identity-generation-item','identity-source','Signup paths','https://example.com/identity-story',?,90,'Signup gates','Preserve consent','Audit every path',?,'No conversion measurements',?,'identity-generation-family')", params: [now - 1000, quote, now] },
      { sql: "INSERT INTO research_items(id,team_id,source_id,canonical_url,title,excerpt,published_at,collected_at,content,content_provenance) VALUES('identity-supporting-item','identity-generation','identity-source','https://example.com/identity-support','Independent signup account',?,?,?,?,'article')", params: ["A separate workflow keeps required consent before account creation.", now - 2000, now, "A separate workflow keeps required consent before account creation. Additional independent explanation of signup routes."] },
      { sql: "INSERT INTO research_cache(id,team_id,value,created_at) VALUES('research-family-sources:identity-generation-run:identity-generation-family','identity-generation',?,?)", params: [JSON.stringify({ items: [{ itemId: "identity-generation-item", evidence: quote }, { itemId: "identity-supporting-item", evidence: "A separate workflow keeps required consent before account creation." }] }), now] },
    ] });
    const previousKey = process.env.OPENAI_API_KEY;
    const previousAnthropicKey = process.env.ANTHROPIC_API_KEY;
    process.env.OPENAI_API_KEY = "test-identity-key";
    process.env.ANTHROPIC_API_KEY = "test-identity-key";
    let calls = 0;
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      expect(String(url)).toBe("https://api.openai.com/v1/responses");
      const request = JSON.parse(String(init?.body));
      expect(request.model).toBe(RESEARCH_WRITING_MODEL);
      const input = JSON.parse(request.input ?? request.messages[0].content);
      expect(input.source.supportingSources).toMatchObject([{ url: "https://example.com/identity-support", content: expect.stringContaining("A separate workflow") }]);
      expect(input.allowedWritingStyles.map((style: { writingStyle: string }) => style.writingStyle)).toContain("b2b-research-insight");
      if (input.proposed) return editorialReviewFixture();
      expect(input.identityGroups.map((group: { channelIds: string[] }) => group.channelIds.slice().sort()).sort()).toEqual([
        ["identity-company-li", "identity-company-x"], ["identity-personal-li", "identity-personal-x"],
      ]);
      calls++;
      const chosen = calls === 1 ? [profiles[0], profiles[2]] : profiles.slice(0, 2);
      return modelResponseFixture({ status: "completed", usage: { input_tokens: 100, output_tokens: 40 }, output: [{ content: [{ type: "output_text", text: JSON.stringify({ ready: true, editorial: editorialFixture(input.source.content), reason: "Fits this identity", targets: chosen.map(profile => ({ channelId: profile.id, platform: profile.platform, content: `Audit every signup path. Sources: ${input.source.url} https://example.com/identity-support`, thread: [], supportQuote: quote, redditTitle: null, subreddit: null })) }) }] }] });
    });
    try {
      expect(await finishResearchDraftJob("identity-generation-run")).toEqual({ drafted: 1 });
      expect(calls).toBe(2);
      const draft = execute({ queries: [{ sql: "SELECT content FROM research_drafts WHERE team_id='identity-generation'" }] })[0].results[0];
      expect(JSON.parse(draft.content).targets.map((target: { channelId: string }) => target.channelId).sort()).toEqual(["identity-company-li", "identity-company-x"]);
      expect(execute({ queries: [{ sql: "SELECT DISTINCT model,cost_status FROM research_usage WHERE team_id='identity-generation'" }] })[0].results)
        .toEqual([{ model: RESEARCH_WRITING_MODEL, cost_status: "unknown" }]);
    } finally {
      fetcher.mockRestore();
      if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previousKey;
      if (previousAnthropicKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = previousAnthropicKey;
    }
  }, 20_000);
  it("repairs an oversized draft once, accounts for both calls and continues after an invalid story", async () => {
    const now = Date.now();
    const quote = "Every required consent is checked before an account can be created.";
    const stories = ["never-valid", "repairable", "already-valid"];
    execute({ queries: [
      { sql: "INSERT INTO teams(id,name,slug,created_at,updated_at) VALUES('repairs','Repairs','repairs',0,0)" },
      { sql: "INSERT INTO channels(id,team_id,name,platform,group_name,research_enabled,system_prompt,created_at) VALUES('repairs-x','repairs','Product decisions','twitter','custom',1,'Explain concrete product onboarding decisions and credit sources',0)" },
      { sql: "INSERT INTO research_runs(id,team_id,mode,status,days,editorial,created_at,icp,source_ids,diagnostics) VALUES('repairs-run','repairs','scan','drafting',1,1,?,'Product managers',?,?)", params: [now, JSON.stringify(["repair-source"]), JSON.stringify({ rejectedStories: [] })] },
      ...stories.flatMap((title, index) => [
        { sql: "INSERT INTO research_items(id,team_id,source_id,canonical_url,title,excerpt,published_at,collected_at,content,content_provenance) VALUES(?,'repairs','repair-source',?,?,?,?,?,?,'article')", params: [`repair-item-${title}`, `https://example.com/${title}`, title, quote, now - 1000, now, `${quote} ${"Specific implementation details. ".repeat(30)}`] },
        { sql: "INSERT INTO research_findings(id,team_id,run_id,item_id,source_id,title,url,published_at,score,summary,why_it_matters,content_angle,evidence,limitations,created_at,family_key) VALUES(?,'repairs','repairs-run',?,'repair-source',?,?,?,?, 'Signup decisions','Account creation paths','Audit all paths',?,'No conversion results',?,?)", params: [`repair-finding-${title}`, `repair-item-${title}`, title, `https://example.com/${title}`, now - 1000, 95 - index, quote, now, `repair-family-${title}`] },
      ]),
    ] });
    const previousKey = process.env.OPENAI_API_KEY;
    const previousAnthropicKey = process.env.ANTHROPIC_API_KEY;
    process.env.OPENAI_API_KEY = "test-repair-key";
    process.env.ANTHROPIC_API_KEY = "test-repair-key";
    const calls: string[] = [];
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      expect(String(url)).toBe("https://api.openai.com/v1/responses");
      const request = JSON.parse(String(init?.body));
      const input = JSON.parse(request.input ?? request.messages[0].content);
      if (input.proposed) return editorialReviewFixture();
      const title = input.source.title;
      calls.push(title);
      const invalid = title === "never-valid" || (title === "repairable" && calls.filter(value => value === title).length === 1);
      return modelResponseFixture({ status: "completed", usage: { input_tokens: 100, output_tokens: 20 }, output: [{ content: [{ type: "output_text", text: JSON.stringify({ ready: true, editorial: editorialFixture(input.source.content), reason: "A practical product case", targets: [{ channelId: "repairs-x", platform: "twitter", content: invalid ? `${"x".repeat(281)} ${input.source.url}` : `Audit every signup path. Source: ${input.source.url}`, thread: [], supportQuote: quote, redditTitle: null, subreddit: null }] }) }] }] });
    });
    try {
      expect(await finishResearchDraftJob("repairs-run")).toEqual({ drafted: 2 });
      expect(calls).toEqual(["never-valid", "never-valid", "repairable", "repairable", "already-valid"]);
      const snapshot = await getResearchSnapshot("repairs");
      expect(snapshot.runs[0]).toMatchObject({ status: "completed", inputTokens: 520, outputTokens: 110 });
      expect(snapshot.runs[0].diagnostics?.rejectedStories).toEqual(expect.arrayContaining([expect.objectContaining({ title: "never-valid" })]));
      expect(snapshot.drafts.map(draft => draft.title).sort()).toEqual(["already-valid", "repairable"]);
      const usage = execute({ queries: [{ sql: "SELECT stage,operation FROM research_usage WHERE team_id='repairs' ORDER BY created_at" }] })[0].results;
      expect(usage).toHaveLength(7);
      expect(usage.every((row: { stage: string }) => row.stage === "draft_generation")).toBe(true);
      expect(usage.filter((row: { operation: string }) => row.operation === "draft_repair")).toHaveLength(2);
      expect(execute({ queries: [{ sql: "SELECT input_tokens,output_tokens FROM research_drafts WHERE team_id='repairs' ORDER BY input_tokens DESC" }] })[0].results).toEqual([{ input_tokens: 210, output_tokens: 45 }, { input_tokens: 110, output_tokens: 25 }]);
    } finally {
      fetcher.mockRestore();
      if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previousKey;
      if (previousAnthropicKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = previousAnthropicKey;
    }
  }, 20_000);
  it("updates accepted assessments without losing saved ideas and never drafts an older finding rejected by the current scan", async () => {
    const seed = RESEARCH_SOURCE_SEEDS.find(source => source.feedUrl && source.kind === "rss")!;
    const now = Date.now();
    const strongQuote = "The optional marketing consent never blocks account creation, while every required consent must be accepted.";
    const weakQuote = "Our launch campaign celebrates the new brand with a collection of broad productivity tips.";
    const rejectedReason = "A promotional campaign with no concrete product decision, implementation detail, or useful profile-specific lesson.";
    const items = [
      { id: "assessed-strong", title: "A documented signup design tradeoff", quote: strongQuote },
      { id: "assessed-weak", title: "A generic launch campaign", quote: weakQuote },
    ];
    const findingIds = await Promise.all(items.map(item => researchHash(`assessments:${item.id}`)));
    execute({ queries: [
      { sql: "INSERT INTO teams(id,name,slug,created_at,updated_at) VALUES('assessments','Assessments','assessments',?,?)", params: [now, now] },
      { sql: "INSERT INTO ideas(id,team_id,text,created_at,updated_at) VALUES('assessment-idea','assessments','A saved product lesson',?,?)", params: [now - 120_000, now - 120_000] },
      { sql: "INSERT INTO channels(id,team_id,name,platform,group_name,research_enabled,system_prompt,created_at) VALUES('assessments-linkedin','assessments','Product lessons','linkedin','custom',1,'Write practical onboarding observations for product managers',?)", params: [now] },
      { sql: "INSERT INTO research_runs(id,team_id,mode,status,days,created_at,icp) VALUES('assessments-previous','assessments','scan','completed',30,?,'Product managers')", params: [now - 120_000] },
      {
        sql: "INSERT INTO research_runs(id,team_id,mode,status,days,editorial,created_at,icp,source_count,source_ids) VALUES('assessments-run','assessments','scan','collecting',1,1,?,'Product managers evaluating onboarding decisions',1,?)",
        params: [now, JSON.stringify([seed.id])],
      },
      { sql: "INSERT INTO research_run_sources(id,run_id,source_id,status) VALUES('assessments-step','assessments-run',?,'completed')", params: [seed.id] },
      ...items.map(item => ({
        sql: "INSERT INTO research_items(id,team_id,source_id,canonical_url,title,excerpt,published_at,collected_at,content,content_provenance) VALUES(?,'assessments',?,?,?,?,?,?,?,'public_feed')",
        params: [item.id, seed.id, `${new URL(seed.url).origin}/${item.id}`, item.title, item.quote, now - 60_000, now, `${item.quote} ${"Public context for this specific account. ".repeat(20)}`],
      })),
      ...items.map((item, index) => ({
        sql: "INSERT INTO research_findings(id,team_id,run_id,item_id,source_id,title,url,published_at,score,summary,why_it_matters,content_angle,evidence,limitations,status,idea_id,created_at,family_key) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        params: [findingIds[index], "assessments", "assessments-previous", item.id, seed.id, item.title, `${new URL(seed.url).origin}/${item.id}`, now - 60_000, index === 0 ? 78 : 90, "Earlier summary", "Earlier implication", "Earlier angle", item.quote, "Earlier limitation", index === 0 ? "saved" : "new", index === 0 ? "assessment-idea" : null, now - 120_000, `previous-family-${index}`],
      })),
    ] });
    const previousKey = process.env.OPENAI_API_KEY;
    const previousAnthropicKey = process.env.ANTHROPIC_API_KEY;
    process.env.OPENAI_API_KEY = "test-assessments-key";
    process.env.ANTHROPIC_API_KEY = "test-assessments-key";
    const draftedTitles: string[] = [];
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      if (!/^https:\/\/api\.(?:openai|anthropic)\.com\//.test(String(url))) throw new Error("Public feed evidence should already be available");
      const request = JSON.parse(String(init?.body));
      const input = JSON.parse(request.input ?? request.messages[0].content);
      if (input.proposed) return editorialReviewFixture();
      if (input.source) {
        draftedTitles.push(input.source.title);
        return modelResponseFixture({
          status: "completed", usage: { input_tokens: 100, output_tokens: 50 },
          output: [{ content: [{ type: "output_text", text: JSON.stringify({
            ready: true, editorial: editorialFixture(input.source.content), reason: "A specific documented onboarding decision.",
            targets: [{ channelId: "assessments-linkedin", platform: "linkedin", content: `Required and optional consent follow different signup paths. Audit alternate authentication paths before changing gates. Source: ${input.source.url}`, thread: [], supportQuote: strongQuote, redditTitle: null, subreddit: null }],
          }) }] }],
        });
      }
      expect(input.items.map((item: { id: string }) => item.id).sort()).toEqual(items.map(item => item.id).sort());
      if ((request.text?.format.schema ?? request.output_config.format.schema).properties.findings) {
        expect((request.text?.format.schema ?? request.output_config.format.schema).properties.findings).toMatchObject({ minItems: 2, maxItems: 2 });
      }
      const value = (request.text?.format.schema ?? request.output_config.format.schema).properties.assessments
        ? { itemIds: items.map(item => item.id) }
        : { findings: items.map((item, index) => ({
          itemId: item.id,
          score: index === 0 ? 86 : 62,
          summary: index === 0 ? "Required and optional consent follow separate signup paths." : "A broad promotional launch.",
          whyItMatters: index === 0 ? "Product teams must consider every account-creation path." : "No meaningful product implication is documented.",
          contentAngle: index === 0 ? "Audit alternate authentication paths before changing consent gates." : "No supported editorial angle.",
          evidence: item.quote,
          limitations: index === 0 ? "A descriptive first-party public-feed account; no conversion impact was measured." : rejectedReason,
          familyKey: index === 0 ? "signup-consent-design" : "generic-launch-campaign",
        })) };
      return modelResponseFixture({
        status: "completed", usage: { input_tokens: 100, output_tokens: 50 },
        output: [{ content: [{ type: "output_text", text: JSON.stringify(screeningFixture(value, input.items)) }] }],
      });
    });
    try {
      await processResearchJob({ operation: "rank", runId: "assessments-run" });
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(execute({ queries: [{ sql: "SELECT item_id,score FROM research_findings WHERE team_id='assessments' AND run_id='assessments-run'" }] })[0].results)
        .toEqual([{ item_id: "assessed-strong", score: 86 }]);
      expect(execute({ queries: [{ sql: "SELECT score,status,idea_id,created_at,summary FROM research_findings WHERE item_id='assessed-strong' AND team_id='assessments'" }] })[0].results)
        .toEqual([{ score: 86, status: "saved", idea_id: "assessment-idea", created_at: now - 120_000, summary: "Required and optional consent follow separate signup paths." }]);
      expect(execute({ queries: [{ sql: "SELECT score,run_id FROM research_findings WHERE item_id='assessed-weak' AND team_id='assessments'" }] })[0].results)
        .toEqual([{ score: 90, run_id: "assessments-previous" }]);
      const [stored] = execute({ queries: [{ sql: "SELECT status,diagnostics FROM research_runs WHERE id='assessments-run'" }] })[0].results;
      expect(stored.status).toBe("drafting");
      expect(JSON.parse(stored.diagnostics)).toMatchObject({
        shortlistedCount: 2, evidenceCount: 2,
        rejectedStories: [{ title: "A generic launch campaign", score: 62, reason: rejectedReason }],
      });
      expect(await finishResearchDraftJob("assessments-run")).toEqual({ drafted: 1 });
      expect(draftedTitles).toEqual(["A documented signup design tradeoff"]);
      expect(fetcher).toHaveBeenCalledTimes(4);
    } finally {
      fetcher.mockRestore();
      if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previousKey;
      if (previousAnthropicKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = previousAnthropicKey;
    }
  }, 20_000);
  it("reviews every potentially useful story beyond twelve and preserves evidence-stage rejection", async () => {
    const seed = RESEARCH_SOURCE_SEEDS.find(source => source.kind === "rss" && source.feedUrl)!;
    const now = Date.now();
    const useful = Array.from({ length: 17 }, (_, index) => ({
      id: `recall-useful-${index}`,
      title: `Practitioner workflow decision ${index}`,
      quote: `For workflow ${index}, the team kept the first useful action visible before asking for optional setup.`,
    }));
    const thinAd = { id: "recall-thin-ad", title: "A vague campaign", quote: "Our revolutionary solution will transform how every team works forever." };
    const career = { id: "recall-career", title: "Interview outfit inspiration", quote: "Choose a matching jacket for your next interview outfit." };
    const all = [...useful, thinAd, career];
    execute({ queries: [
      { sql: "INSERT INTO teams(id,name,slug,created_at,updated_at) VALUES('recall','Recall','recall',?,?)", params: [now, now] },
      { sql: "INSERT INTO research_runs(id,team_id,mode,status,days,created_at,icp,source_count,source_ids) VALUES('recall-run','recall','scan','collecting',7,?,'Product managers and growth practitioners',1,?)", params: [now, JSON.stringify([seed.id])] },
      { sql: "INSERT INTO research_run_sources(id,run_id,source_id,status) VALUES('recall-step','recall-run',?,'completed')", params: [seed.id] },
      ...all.map((item, index) => ({
        sql: "INSERT INTO research_items(id,team_id,source_id,canonical_url,title,excerpt,published_at,collected_at,content,content_provenance) VALUES(?,'recall',?,?,?,?,?,?,?,'public_feed')",
        params: [item.id, seed.id, `${new URL(seed.url).origin}/${item.id}`, item.title, item.quote, now - (index + 1) * 60_000, now, `${item.quote} ${"This is a first-party account of one product workflow. ".repeat(20)}`],
      })),
    ] });
    const previousKey = process.env.OPENAI_API_KEY;
    const previousAnthropicKey = process.env.ANTHROPIC_API_KEY;
    process.env.OPENAI_API_KEY = "test-recall-key";
    process.env.ANTHROPIC_API_KEY = "test-recall-key";
    const reviewedIds: string[] = [];
    const evidenceBatchSizes: number[] = [];
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      expect(String(url)).toBe("https://api.anthropic.com/v1/messages");
      const request = JSON.parse(String(init?.body));
      const input = JSON.parse(request.input ?? request.messages[0].content);
      if (input.proposed) return editorialReviewFixture();
      let value: unknown;
      if ((request.text?.format.schema ?? request.output_config.format.schema).properties.assessments) {
        expect(request.instructions ?? request.system).toBe(RESEARCH_SCREEN_INSTRUCTIONS);
        expect(input.items.length).toBeLessThanOrEqual(RESEARCH_SCREEN_BATCH_SIZE);
        expect((request.text?.format.schema ?? request.output_config.format.schema).properties.assessments.maxItems).toBe(input.items.length);
        value = { itemIds: input.items.filter((item: { id: string }) => item.id !== career.id).map((item: { id: string }) => item.id) };
      } else {
        expect(request.instructions ?? request.system).toBe(RESEARCH_EVIDENCE_INSTRUCTIONS);
        expect(input.items.length).toBeLessThanOrEqual(6);
        evidenceBatchSizes.push(input.items.length);
        value = { findings: input.items.map((item: { id: string }) => {
          reviewedIds.push(item.id);
          const original = all.find(candidate => candidate.id === item.id)!;
          return {
            itemId: item.id, score: item.id === thinAd.id ? 42 : 84,
            summary: original.title, whyItMatters: "A concrete onboarding decision for practitioners.",
            contentAngle: "Examine optional setup before the first useful action.",
            evidence: original.quote,
            limitations: item.id === thinAd.id ? "Thin promotional claims without a specific supported workflow." : "First-party public-feed account; no measured business uplift.",
            familyKey: item.id,
          };
        }) };
      }
      return modelResponseFixture({ status: "completed", usage: { input_tokens: 20, output_tokens: 10 }, output: [{ content: [{ type: "output_text", text: JSON.stringify(screeningFixture(value, input.items)) }] }] });
    });
    try {
      await processResearchJob({ operation: "rank", runId: "recall-run" });
      expect(reviewedIds.sort()).toEqual([...useful.map(item => item.id), thinAd.id].sort());
      expect(evidenceBatchSizes).toEqual([6, 6, 6]);
      expect(fetcher).toHaveBeenCalledTimes(Math.ceil(all.length / RESEARCH_SCREEN_BATCH_SIZE) + 3);
      const snapshot = await getResearchSnapshot("recall");
      expect(snapshot.findings.map(finding => finding.itemId).sort()).toEqual(useful.map(item => item.id).sort());
      expect(snapshot.runs[0]).toMatchObject({
        findingsCount: 17,
        diagnostics: {
          eligibleCount: 19, screenedCount: 19, shortlistedCount: 18, evidenceCount: 18,
          rejectedStories: expect.arrayContaining([{ title: thinAd.title, score: 42, reason: "Thin promotional claims without a specific supported workflow." }]),
        },
      });
      expect(snapshot.drafts).toHaveLength(0);
    } finally {
      fetcher.mockRestore();
      if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previousKey;
      if (previousAnthropicKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = previousAnthropicKey;
    }
  }, 20_000);
  it("retains an existing reviewed story and bundles verified sources when multiple articles produce the same family", async () => {
    const seed = RESEARCH_SOURCE_SEEDS.find(source => source.kind === "rss" && source.feedUrl)!;
    const now = Date.now();
    const quote = "A shared product scaffold removes repeated setup before the first prototype.";
    execute({ queries: [
      { sql: "INSERT INTO teams(id,name,slug,created_at,updated_at) VALUES('family','Family','family',?,?)", params: [now, now] },
      { sql: "INSERT INTO research_runs(id,team_id,mode,status,days,created_at,icp,source_count,source_ids) VALUES('family-run','family','scan','collecting',7,?,'Product practitioners',1,?)", params: [now, JSON.stringify([seed.id])] },
      { sql: "INSERT INTO research_run_sources(id,run_id,source_id,status) VALUES('family-step','family-run',?,'completed')", params: [seed.id] },
      ...["original", "second", "third"].map(id => ({
        sql: "INSERT INTO research_items(id,team_id,source_id,canonical_url,title,excerpt,published_at,collected_at,content,content_provenance) VALUES(?,'family',?,?,?,?,?,?,?,'public_feed')",
        params: [id, seed.id, `${new URL(seed.url).origin}/family-${id}`, id, quote, now - 1000, now, `${id}: ${quote} ${"Detailed product workflow evidence. ".repeat(30)}`],
      })),
      { sql: "INSERT INTO research_findings(id,team_id,run_id,item_id,source_id,title,url,published_at,score,summary,why_it_matters,content_angle,evidence,limitations,created_at,family_key,status) VALUES('original-finding','family','family-run','original',?,'Original','https://example.com/original',?,85,'Saved summary','Useful','Saved angle',?,'Attributed',?,'shared-scaffold','dismissed')", params: [seed.id, now - 1000, quote, now] },
      { sql: "INSERT INTO research_drafts(id,team_id,run_id,finding_id,content,status,revision,slack_channel_id,slack_thread_ts,created_at,updated_at) VALUES('family-existing-review','family','family-run','original-finding','{\"targets\":[]}','pending',3,'CEXISTING','123.456',?,?)", params: [now, now] },
    ] });
    const previousKey = process.env.OPENAI_API_KEY;
    const previousAnthropicKey = process.env.ANTHROPIC_API_KEY;
    process.env.OPENAI_API_KEY = "test-family-key";
    process.env.ANTHROPIC_API_KEY = "test-family-key";
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      const input = JSON.parse(request.input ?? request.messages[0].content);
      const value = (request.text?.format.schema ?? request.output_config.format.schema).properties.assessments
        ? { itemIds: ["second", "third"] }
        : { findings: input.items.map((item: { id: string }) => ({ itemId: item.id, score: 90, summary: "New coverage", whyItMatters: "Useful", contentAngle: "Same launch", evidence: quote, limitations: "Attributed", familyKey: "shared-scaffold" })) };
      return modelResponseFixture({ status: "completed", usage: { input_tokens: 20, output_tokens: 10 }, output: [{ content: [{ type: "output_text", text: JSON.stringify(screeningFixture(value, input.items)) }] }] });
    });
    try {
      expect(await processResearchJob({ operation: "rank", runId: "family-run" })).toEqual({ ok: true, pending: false });
      expect(execute({ queries: [{ sql: "SELECT id,item_id,status,score,summary FROM research_findings WHERE team_id='family'" }] })[0].results)
        .toEqual([{ id: "original-finding", item_id: "original", status: "dismissed", score: 85, summary: "Saved summary" }]);
      const run = (await getResearchSnapshot("family")).runs[0];
      expect(run.status).toBe("completed");
      expect(run.diagnostics).toMatchObject({ evidenceCount: 2, rejectedStories: expect.arrayContaining([{ title: "second", score: 90, reason: expect.stringContaining("already has a saved finding") }]) });
      const [bundle] = execute({ queries: [{ sql: "SELECT value FROM research_cache WHERE id='research-family-sources:family-run:shared-scaffold'" }] })[0].results;
      expect(JSON.parse(bundle.value)).toEqual({ items: [{ itemId: "second", evidence: quote }, { itemId: "third", evidence: quote }] });
      expect(execute({ queries: [{ sql: "SELECT content,status,revision,slack_channel_id,slack_thread_ts FROM research_drafts WHERE id='family-existing-review'" }] })[0].results)
        .toEqual([{ content: '{"targets":[]}', status: "pending", revision: 3, slack_channel_id: "CEXISTING", slack_thread_ts: "123.456" }]);
      await processResearchJob({ operation: "rank", runId: "family-run" });
      expect(execute({ queries: [{ sql: "SELECT value FROM research_cache WHERE id='research-family-sources:family-run:shared-scaffold'" }] })[0].results).toEqual([bundle]);
    } finally {
      fetcher.mockRestore();
      if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previousKey;
      if (previousAnthropicKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = previousAnthropicKey;
    }
  }, 20_000);
  it("screens older eligible items beyond the first metadata batch and caches model responses", async () => {
    const seed = RESEARCH_SOURCE_SEEDS.find(
      (source) => source.feedUrl && source.kind === "rss",
    )!;
    const now = Date.now();
    const articleUrl = `${new URL(seed.url).origin}/valuable-older-article`;
    const evidence =
      "The actual practitioner evidence is a concrete lesson about onboarding.";
    const content = `${evidence} ${"Detailed first hand lessons and practical context. ".repeat(80)}`;
    execute({
      queries: [
        {
          sql: "INSERT INTO research_runs(id,team_id,mode,status,days,created_at,icp,source_count,source_ids) VALUES(?,?,?,?,?,?,?,?,?)",
          params: [
            "ranking-run",
            "a",
            "scan",
            "collecting",
            30,
            now,
            "Product managers at B2B SaaS",
            1,
            JSON.stringify([seed.id]),
          ],
        },
        {
          sql: "INSERT INTO research_run_sources(id,run_id,source_id,status) VALUES(?,?,?,?)",
          params: ["ranking-step", "ranking-run", seed.id, "completed"],
        },
        ...Array.from({ length: 81 }, (_, index) => ({
          sql: "INSERT INTO research_items(id,team_id,source_id,canonical_url,title,excerpt,published_at,collected_at,content,content_provenance) VALUES(?,?,?,?,?,?,?,?,?,?)",
          params: [
            `rank-item-${index}`,
            "a",
            seed.id,
            index === 80
              ? articleUrl
              : `${new URL(seed.url).origin}/metadata-${index}`,
            index === 80
              ? "Valuable older practitioner lesson"
              : `Generic news ${index}`,
            "Metadata context",
            now - index * 60_000,
            now,
            index === 80 ? content : null,
            index === 80 ? "public_feed" : "unknown",
          ],
        })),
      ],
    });
    const previousKey = process.env.OPENAI_API_KEY;
    const previousAnthropicKey = process.env.ANTHROPIC_API_KEY;
    process.env.OPENAI_API_KEY = "test-key";
    process.env.ANTHROPIC_API_KEY = "test-key";
    const screenedIds: string[] = [];
    const fetcher = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (url, init) => {
        if (/^https:\/\/api\.(?:openai|anthropic)\.com\//.test(String(url))) {
          const request = JSON.parse(String(init?.body));
          const input = JSON.parse(request.input ?? request.messages[0].content);
      if (input.proposed) return editorialReviewFixture();
          const extraction = String(request.instructions ?? request.system).includes(
            "Act as a strict",
          );
          let value: unknown;
          if (extraction) {
            expect(input.items[0]).toMatchObject({
              content, contentProvenance: "public_feed",
            });
            expect(request.instructions ?? request.system).toContain("never infer a paid continuation");
            value = {
              findings: [
                {
                  itemId: "rank-item-80",
                  score: 95,
                  summary: "A grounded lesson",
                  whyItMatters: "Improves onboarding",
                  contentAngle: "Explain the lesson",
                  evidence,
                  limitations: "Practitioner account",
                  familyKey: "older-original-lesson",
                },
              ],
            };
          } else {
            const older = input.items.find((item: { id: string }) => item.id === "rank-item-80");
            if (older) expect(older).toMatchObject({
              publicText: content, contentProvenance: "public_feed",
            });
            screenedIds.push(
              ...input.items.map((item: { id: string }) => item.id),
            );
            value = {
              itemIds: input.items.some(
                (item: { id: string }) => item.id === "rank-item-80",
              )
                ? ["rank-item-80"]
                : [],
            };
          }
          return modelResponseFixture({
            status: "completed",
            output: [
              {
                content: [{ type: "output_text", text: JSON.stringify(screeningFixture(value, input.items)) }],
              },
            ],
            usage: { input_tokens: 20, output_tokens: 10 },
          });
        }
        throw new Error(`Retained public feed evidence should not require an article fetch: ${String(url)}`);
      });
    try {
      await finishResearchRankJob("ranking-run");
      expect(screenedIds).toHaveLength(81);
      expect(screenedIds).toContain("rank-item-80");
      expect(
        (await getResearchSnapshot("a")).findings.some(
          (finding) => finding.itemId === "rank-item-80",
        ),
      ).toBe(true);
      expect((await getResearchSnapshot("a")).runs.find(run => run.id === "ranking-run")?.diagnostics).toMatchObject({
        eligibleCount: 81, screenedCount: 81, shortlistedCount: 1, evidenceCount: 1,
        outcome: "Reviewed public evidence for 1 shortlisted stories.",
      });
      expect(
        execute({
          queries: [
            {
              sql: "SELECT input_tokens FROM research_runs WHERE id='ranking-run'",
            },
          ],
        })[0].results,
      ).toEqual([{ input_tokens: 20 * (Math.ceil(81 / RESEARCH_SCREEN_BATCH_SIZE) + 1) }]);
      execute({
        queries: [
          {
            sql: "UPDATE research_runs SET status='ranking' WHERE id='ranking-run'",
          },
          {
            sql: "DELETE FROM research_cache WHERE id='rank-progress:ranking-run'",
          },
        ],
      });
      await finishResearchRankJob("ranking-run");
      expect(fetcher).toHaveBeenCalledTimes(Math.ceil(81 / RESEARCH_SCREEN_BATCH_SIZE) + 1);
      expect(
        execute({
          queries: [
            {
              sql: "SELECT cache_hits FROM research_runs WHERE id='ranking-run'",
            },
          ],
        })[0].results,
      ).toEqual([{ cache_hits: Math.ceil(81 / RESEARCH_SCREEN_BATCH_SIZE) + 1 }]);
    } finally {
      fetcher.mockRestore();
      if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previousKey;
      if (previousAnthropicKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = previousAnthropicKey;
    }
  }, 20_000);
  it("resumes more than eighteen shortlisted stories without re-screening hydrated evidence or new arrivals", async () => {
    const seed = RESEARCH_SOURCE_SEEDS.find(source => source.kind === "rss" && source.feedUrl)!;
    const now = Date.now();
    const items = Array.from({ length: 25 }, (_, index) => ({
      id: `resume-item-${index}`, title: `Product workflow ${index}`,
      quote: `Workflow ${index} shows the first useful action before optional setup.`,
    }));
    const content = (index: number) => `${items[index].quote} ${"A detailed first-party product implementation account. ".repeat(20)}`;
    execute({ queries: [
      { sql: "INSERT INTO teams(id,name,slug,created_at,updated_at) VALUES('resume','Resume','resume',?,?)", params: [now, now] },
      { sql: "INSERT INTO research_runs(id,team_id,mode,status,days,editorial,created_at,icp,source_count,source_ids) VALUES('resume-run','resume','scan','collecting',1,1,?,'Product managers and growth practitioners',1,?)", params: [now, JSON.stringify([seed.id])] },
      { sql: "INSERT INTO research_run_sources(id,run_id,source_id,status) VALUES('resume-step','resume-run',?,'completed')", params: [seed.id] },
      ...items.map((item, index) => ({
        sql: "INSERT INTO research_items(id,team_id,source_id,canonical_url,title,excerpt,published_at,collected_at,content,content_provenance) VALUES(?,'resume',?,?,?,?,?,?,?,'public_feed')",
        params: [item.id, seed.id, `${new URL(seed.url).origin}/${item.id}`, item.title, item.quote, now - (index + 1) * 60_000, now, index === 0 ? null : content(index)],
      })),
    ] });
    const previousKey = process.env.OPENAI_API_KEY;
    const previousAnthropicKey = process.env.ANTHROPIC_API_KEY;
    process.env.OPENAI_API_KEY = "test-resume-key";
    process.env.ANTHROPIC_API_KEY = "test-resume-key";
    let screened = 0;
    const reviewedIds: string[] = [];
    const batchSizes: number[] = [];
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      if (!/^https:\/\/api\.(?:openai|anthropic)\.com\//.test(String(url))) {
        expect(String(url)).toBe(`${new URL(seed.url).origin}/resume-item-0`);
        return new Response(`<html><main><h1>Product workflow 0</h1><p>${content(0)}</p></main></html>`);
      }
      const request = JSON.parse(String(init?.body));
      const input = JSON.parse(request.input ?? request.messages[0].content);
      if (input.proposed) return editorialReviewFixture();
      let value: unknown;
      if ((request.text?.format.schema ?? request.output_config.format.schema).properties.assessments) {
        screened++;
        expect(input.items.length).toBeLessThanOrEqual(RESEARCH_SCREEN_BATCH_SIZE);
        value = { itemIds: input.items.map((item: { id: string }) => item.id) };
      } else {
        batchSizes.push(input.items.length);
        value = { findings: input.items.map((item: { id: string }) => {
          reviewedIds.push(item.id);
          const original = items.find(candidate => candidate.id === item.id)!;
          return {
            itemId: item.id, score: item.id === "resume-item-5" ? 42 : 84,
            summary: original.title, whyItMatters: "A specific first-value decision for product teams.",
            contentAngle: "Examine whether setup delays the first useful action.", evidence: original.quote,
            limitations: item.id === "resume-item-5" ? "Unsupported broad claims in this example." : "First-party experience; no measured uplift.",
            familyKey: item.id,
          };
        }) };
      }
      return modelResponseFixture({ status: "completed", usage: { input_tokens: 20, output_tokens: 10 }, output: [{ content: [{ type: "output_text", text: JSON.stringify(screeningFixture(value, input.items)) }] }] });
    });
    try {
      let firstEvidence = await processResearchJob({ operation: "rank", runId: "resume-run" });
      while (!batchSizes.length && "pending" in firstEvidence && firstEvidence.pending) {
        firstEvidence = await processResearchJob({ operation: "rank", runId: "resume-run" });
      }
      expect(firstEvidence).toEqual({ ok: true, pending: true });
      expect(batchSizes).toEqual([6, 6, 6]);
      const [partial] = execute({ queries: [{ sql: "SELECT status,completed_at,findings_count,diagnostics FROM research_runs WHERE id='resume-run'" }] })[0].results;
      expect(partial).toMatchObject({ status: "ranking", completed_at: null, findings_count: 17 });
      expect(JSON.parse(partial.diagnostics)).toMatchObject({ screenedCount: 25, shortlistedCount: 25, evidenceCount: 18, rejectedStories: [{ title: items[5].title, score: 42 }] });
      const [checkpoint] = execute({ queries: [{ sql: "SELECT value FROM research_cache WHERE id='rank-progress:resume-run'" }] })[0].results;
      expect(JSON.parse(checkpoint.value)).toMatchObject({ selectedIds: items.map(item => item.id), nextOffset: 18 });
      execute({ queries: [{
        sql: "INSERT INTO research_items(id,team_id,source_id,canonical_url,title,excerpt,published_at,collected_at,content,content_provenance) VALUES('resume-new-arrival','resume',?,?,'New arrival','New material',?,?,?,'public_feed')",
        params: [seed.id, `${new URL(seed.url).origin}/new-arrival`, now - 1000, now, content(0)],
      }] });
      expect(await processResearchJob({ operation: "rank", runId: "resume-run" })).toEqual({ ok: true, pending: false });
      expect(screened).toBe(Math.ceil(25 / RESEARCH_SCREEN_BATCH_SIZE));
      expect(batchSizes).toEqual([6, 6, 6, 6, 1]);
      expect(reviewedIds).toEqual(items.map(item => item.id));
      const [finished] = execute({ queries: [{ sql: "SELECT status,completed_at,findings_count,diagnostics FROM research_runs WHERE id='resume-run'" }] })[0].results;
      expect(finished).toMatchObject({ status: "drafting", findings_count: 24 });
      expect(finished.completed_at).toBeGreaterThanOrEqual(now);
      expect(JSON.parse(finished.diagnostics)).toMatchObject({ eligibleCount: 25, screenedCount: 25, shortlistedCount: 25, evidenceCount: 25, rejectedStories: [{ title: items[5].title, score: 42 }] });
      const calls = fetcher.mock.calls.length;
      expect(await processResearchJob({ operation: "rank", runId: "resume-run" })).toEqual({ ok: true, pending: false });
      expect(fetcher).toHaveBeenCalledTimes(calls);
      expect(execute({ queries: [{ sql: "SELECT COUNT(*) AS count FROM research_findings WHERE run_id='resume-run'" }] })[0].results).toEqual([{ count: 24 }]);
    } finally {
      fetcher.mockRestore();
      if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previousKey;
      if (previousAnthropicKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = previousAnthropicKey;
    }
  }, 20_000);
  it("continues every original article page in bounded durable chunks and preserves first-seen metadata", async () => {
    const seed = RESEARCH_SOURCE_SEEDS.find(source => source.kind === "rss" && source.feedUrl)!;
    const now = Date.now();
    const origin = new URL(seed.url).origin;
    const articles = Array.from({ length: 13 }, (_, index) => ({
      url: `${origin}/chunked-article-${index}`,
      at: Math.floor((now - (index === 12 ? 180 * 86400000 : 1000)) / 1000) * 1000,
    }));
    const content = "A concrete original onboarding workflow describes the first useful action and the optional setup tradeoff. ".repeat(20);
    execute({ queries: [
      { sql: "INSERT INTO teams(id,name,slug,created_at,updated_at) VALUES('article-chunks','Article chunks','article-chunks',0,0)" },
      { sql: "INSERT INTO research_runs(id,team_id,mode,status,days,editorial,created_at,icp,source_count,source_ids) VALUES('article-chunks-run','article-chunks','collect','collecting',1,0,?,'Product teams',1,?)", params: [now, JSON.stringify([seed.id])] },
    ] });
    let feedFetches = 0;
    const fetched: string[] = [];
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async input => {
      const url = String(input);
      if (url === seed.feedUrl) {
        feedFetches++;
        return new Response(`<rss><channel>${articles.map((article, index) => `<item><title>Original workflow ${index}</title><link>${article.url}</link><pubDate>${new Date(article.at).toUTCString()}</pubDate><description>A short original workflow teaser.</description></item>`).join("")}</channel></rss>`);
      }
      const article = articles.find(article => article.url === url);
      if (!article) throw new Error(`Unexpected fetch ${url}`);
      fetched.push(url);
      return new Response(`<html><article><h1>Original workflow details</h1><time datetime="${new Date(article.at).toISOString()}"></time><p>${content}</p></article></html>`);
    });
    try {
      expect(await processResearchJob({ operation: "collect", runId: "article-chunks-run", sourceId: seed.id })).toEqual({ collected: 13, pending: true });
      expect(fetched).toHaveLength(12);
      const [initial, checkpoint] = execute({ queries: [
        { sql: "SELECT collected_at FROM research_items WHERE team_id='article-chunks' AND canonical_url=?", params: [articles[12].url] },
        { sql: "SELECT value FROM research_cache WHERE id=?", params: [`collection-progress:article-chunks-run:${seed.id}`] },
      ] }).map((result: { results: unknown[] }) => result.results[0]);
      expect(JSON.parse(checkpoint.value)).toMatchObject({ articleOffset: 12, articles: articles.map(article => ({ url: article.url })) });
      expect(checkpoint.value).not.toContain(content);
      expect(await processResearchJob({ operation: "collect", runId: "article-chunks-run", sourceId: seed.id })).toEqual({ collected: 13, error: null });
      expect(fetched).toEqual(articles.map(article => article.url));
      expect(feedFetches).toBe(1);
      const [last] = execute({ queries: [{ sql: "SELECT published_at,collected_at,content FROM research_items WHERE team_id='article-chunks' AND canonical_url=?", params: [articles[12].url] }] })[0].results;
      expect(last).toMatchObject({ published_at: articles[12].at, collected_at: initial.collected_at });
      expect(last.content).toContain(content.trim());
    } finally {
      fetcher.mockRestore();
    }
  }, 30_000);

  it("continues all public video transcripts beyond six without recollecting the source", async () => {
    const seed = RESEARCH_SOURCE_SEEDS.find(source => source.kind === "youtube")!;
    const now = Date.now();
    const videos = Array.from({ length: 8 }, (_, index) => `vid0000000${index}`);
    const transcript = "A practitioner explains a specific product onboarding decision, implementation and limits. ".repeat(20);
    execute({ queries: [
      { sql: "INSERT INTO teams(id,name,slug,created_at,updated_at) VALUES('all-transcripts','All transcripts','all-transcripts',0,0)" },
      { sql: "INSERT INTO research_runs(id,team_id,mode,status,days,editorial,created_at,icp,source_count,source_ids) VALUES('all-transcripts-run','all-transcripts','collect','collecting',1,0,?,'Product teams',1,?)", params: [now, JSON.stringify([seed.id])] },
    ] });
    let feedFetches = 0;
    const watched: string[] = [];
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async input => {
      const url = new URL(String(input));
      if (url.pathname.includes("feeds/")) {
        feedFetches++;
        return new Response(`<feed>${videos.map(id => `<entry><title>Practitioner interview ${id}</title><link rel="alternate" href="https://www.youtube.com/watch?v=${id}"/><published>${new Date(now - 1000).toISOString()}</published></entry>`).join("")}</feed>`);
      }
      if (url.pathname === "/watch") {
        watched.push(url.searchParams.get("v")!);
        return new Response(`{"captionTracks":[{"baseUrl":"https://www.youtube.com/api/timedtext?v=${url.searchParams.get("v")}","languageCode":"en"}]}`);
      }
      if (url.pathname === "/api/timedtext") return Response.json({ events: [{ segs: [{ utf8: transcript }] }] });
      throw new Error(`Unexpected network request: ${url.origin}${url.pathname}`);
    });
    try {
      expect(await processResearchJob({ operation: "collect", runId: "all-transcripts-run", sourceId: seed.id })).toEqual({ collected: 8, pending: true });
      expect(watched).toHaveLength(6);
      expect(await processResearchJob({ operation: "collect", runId: "all-transcripts-run", sourceId: seed.id })).toEqual({ collected: 8, error: null });
      expect(watched).toEqual(videos);
      expect(feedFetches).toBe(1);
      expect(execute({ queries: [{ sql: "SELECT COUNT(*) count FROM research_items WHERE team_id='all-transcripts' AND transcript_status='available'" }] })[0].results).toEqual([{ count: 8 }]);
      const calls = fetcher.mock.calls.length;
      expect(await processResearchJob({ operation: "collect", runId: "all-transcripts-run", sourceId: seed.id })).toEqual({ collected: 8 });
      expect(fetcher).toHaveBeenCalledTimes(calls);
    } finally {
      fetcher.mockRestore();
    }
  }, 30_000);

  it("labels newly discovered evergreen signals without redating or resurfacing known old sources", async () => {
    const seed = RESEARCH_SOURCE_SEEDS.find(source => source.kind === "rss" && source.feedUrl)!;
    const now = Date.now();
    const quote = "This older original essay explains a practical onboarding choice and its tradeoff.";
    const rows = [
      { id: "lane-fresh", publishedAt: now - 1000, discoveredAt: now - 500 },
      { id: "lane-new-evergreen", publishedAt: now - 180 * 86400000, discoveredAt: now - 500 },
      { id: "lane-known-old", publishedAt: now - 180 * 86400000, discoveredAt: now - 2 * 86400000 },
      { id: "lane-undated", publishedAt: null, discoveredAt: now - 500 },
      { id: "lane-future", publishedAt: now + 1000, discoveredAt: now - 500 },
    ];
    execute({ queries: [
      { sql: "INSERT INTO teams(id,name,slug,created_at,updated_at) VALUES('signal-lanes','Signal lanes','signal-lanes',0,0)" },
      { sql: "INSERT INTO research_runs(id,team_id,mode,status,days,editorial,created_at,icp,source_count,source_ids) VALUES('signal-lanes-run','signal-lanes','scan','collecting',1,0,?,'Product managers',1,?)", params: [now, JSON.stringify([seed.id])] },
      { sql: "INSERT INTO research_run_sources(id,run_id,source_id,status) VALUES('signal-lanes-step','signal-lanes-run',?,'completed')", params: [seed.id] },
      ...rows.map(row => ({
        sql: "INSERT INTO research_items(id,team_id,source_id,canonical_url,title,excerpt,published_at,collected_at,content) VALUES(?,'signal-lanes',?,?,?,?,?,?,?)",
        params: [row.id, seed.id, `${new URL(seed.url).origin}/${row.id}`, row.id, quote, row.publishedAt, row.discoveredAt, `${quote} ${"Detailed original reasoning. ".repeat(25)}`],
      })),
    ] });
    const priorKey = process.env.OPENAI_API_KEY;
    const priorAnthropicKey = process.env.ANTHROPIC_API_KEY;
    process.env.OPENAI_API_KEY = "test-signal-lanes";
    process.env.ANTHROPIC_API_KEY = "test-signal-lanes";
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      const input = JSON.parse(request.input ?? request.messages[0].content);
      expect(input.items.map((item: { id: string }) => item.id)).toEqual(["lane-fresh", "lane-new-evergreen"]);
      expect(input.items[0]).toMatchObject({ signalKind: "fresh", publishedAt: now - 1000, discoveredAt: now - 500 });
      expect(input.items[1]).toMatchObject({ signalKind: "evergreen_newly_discovered", publishedAt: now - 180 * 86400000, discoveredAt: now - 500 });
      const value = (request.text?.format.schema ?? request.output_config.format.schema).properties.assessments
        ? { itemIds: input.items.map((item: { id: string }) => item.id) }
        : { findings: input.items.map((item: { id: string }) => ({ itemId: item.id, score: 85, summary: "A bounded original decision", whyItMatters: "A practical onboarding choice", contentAngle: "Evaluate the tradeoff", evidence: quote, limitations: "Historical practitioner essay, not a new release", familyKey: item.id })) };
      return modelResponseFixture({ status: "completed", usage: { input_tokens: 10, output_tokens: 10 }, output: [{ content: [{ type: "output_text", text: JSON.stringify(screeningFixture(value, input.items)) }] }] });
    });
    try {
      expect(await processResearchJob({ operation: "rank", runId: "signal-lanes-run" })).toEqual({ ok: true, pending: false });
      const [run, evergreen] = execute({ queries: [
        { sql: "SELECT diagnostics FROM research_runs WHERE id='signal-lanes-run'" },
        { sql: "SELECT published_at FROM research_findings WHERE team_id='signal-lanes' AND item_id='lane-new-evergreen'" },
      ] }).map((result: { results: unknown[] }) => result.results[0]);
      expect(JSON.parse(run.diagnostics)).toMatchObject({ eligibleCount: 2, freshCount: 1, evergreenCount: 1, undatedCount: 1, screenedCount: 2, evidenceCount: 2 });
      expect(evergreen.published_at).toBe(now - 180 * 86400000);
    } finally {
      fetcher.mockRestore();
      if (priorKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = priorKey;
      if (priorAnthropicKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = priorAnthropicKey;
    }
  }, 30_000);

  it("screens every eligible item beyond one thousand using a frozen, resumable queue", async () => {
    const seed = RESEARCH_SOURCE_SEEDS.find(source => source.kind === "rss" && source.feedUrl)!;
    const now = Date.now();
    const quote = "The final source documents a concrete onboarding decision and its tradeoff.";
    const items = Array.from({ length: 1005 }, (_, index) => ({ id: `uncapped-item-${index}`, title: `Workflow ${index}` }));
    const insertItem = (id: string, title: string, at: number) => ({
      sql: "INSERT INTO research_items(id,team_id,source_id,canonical_url,title,excerpt,published_at,collected_at,content) VALUES(?,'uncapped-screen',?,?,?,?,?,?,?)",
      params: [id, seed.id, `${new URL(seed.url).origin}/${id}`, title, quote, at, now, `${quote} ${"Detailed implementation evidence. ".repeat(20)}`],
    });
    execute({ queries: [
      { sql: "INSERT INTO teams(id,name,slug,created_at,updated_at) VALUES('uncapped-screen','Uncapped','uncapped-screen',0,0)" },
      { sql: "INSERT INTO research_runs(id,team_id,mode,status,days,editorial,created_at,icp,source_count,source_ids) VALUES('uncapped-screen-run','uncapped-screen','scan','collecting',1,0,?,'Product managers',1,?)", params: [now, JSON.stringify([seed.id])] },
      { sql: "INSERT INTO research_run_sources(id,run_id,source_id,status) VALUES('uncapped-screen-step','uncapped-screen-run',?,'completed')", params: [seed.id] },
      ...items.map((item, index) => insertItem(item.id, item.title, now - index * 1000)),
    ] });
    const priorKey = process.env.OPENAI_API_KEY;
    const priorAnthropicKey = process.env.ANTHROPIC_API_KEY;
    process.env.OPENAI_API_KEY = "test-uncapped-screen-key";
    process.env.ANTHROPIC_API_KEY = "test-uncapped-screen-key";
    const screened: string[] = [];
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      const input = JSON.parse(request.input ?? request.messages[0].content);
      if (input.proposed) return editorialReviewFixture();
      let value: unknown;
      if ((request.text?.format.schema ?? request.output_config.format.schema).properties.assessments) {
        screened.push(...input.items.map((item: { id: string }) => item.id));
        value = { itemIds: input.items.filter((item: { id: string }) => item.id === items.at(-1)!.id).map((item: { id: string }) => item.id) };
      } else {
        expect(input.items.map((item: { id: string }) => item.id)).toEqual([items.at(-1)!.id]);
        value = { findings: [{ itemId: items.at(-1)!.id, score: 85, summary: "A concrete onboarding decision", whyItMatters: "A practical product tradeoff", contentAngle: "Audit the first useful action", evidence: quote, limitations: "First-party account", familyKey: "uncapped-final-workflow" }] };
      }
      return modelResponseFixture({ status: "completed", usage: { input_tokens: 20, output_tokens: 10 }, output: [{ content: [{ type: "output_text", text: JSON.stringify(screeningFixture(value, input.items)) }] }] });
    });
    try {
      let result = await processResearchJob({ operation: "rank", runId: "uncapped-screen-run" });
      expect(result).toMatchObject({ pending: true });
      const firstCount = screened.length;
      execute({ queries: [insertItem("uncapped-new-arrival", "New arrival after snapshot", now - 1)] });
      let continuations = 0;
      while ("pending" in result && result.pending) {
        result = await processResearchJob({ operation: "rank", runId: "uncapped-screen-run" });
        expect(++continuations).toBeLessThan(Math.ceil(items.length / RESEARCH_SCREEN_BATCH_SIZE) + 1);
      }
      expect(firstCount).toBeLessThan(items.length);
      expect(screened).toEqual(items.map(item => item.id));
      expect(new Set(screened).size).toBe(1005);
      const [stored] = execute({ queries: [{ sql: "SELECT status,diagnostics,findings_count,error FROM research_runs WHERE id='uncapped-screen-run'" }] })[0].results;
      expect(stored).toMatchObject({ status: "completed", findings_count: 1, error: null });
      expect(JSON.parse(stored.diagnostics)).toMatchObject({ eligibleCount: 1005, screenedCount: 1005, shortlistedCount: 1, evidenceCount: 1 });
      const calls = fetcher.mock.calls.length;
      await processResearchJob({ operation: "rank", runId: "uncapped-screen-run" });
      expect(fetcher).toHaveBeenCalledTimes(calls);
    } finally {
      fetcher.mockRestore();
      if (priorKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = priorKey;
      if (priorAnthropicKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = priorAnthropicKey;
    }
  }, 120_000);

  it("archives incomplete or duplicate evidence responses without advancing or reusing invalid paid output", async () => {
    const seed = RESEARCH_SOURCE_SEEDS.find(source => source.kind === "rss" && source.feedUrl)!;
    const now = Date.now();
    const ids = ["coverage-a", "coverage-b"];
    const quote = "The original workflow removes optional setup before the first useful action.";
    execute({ queries: [
      { sql: "INSERT INTO teams(id,name,slug,created_at,updated_at) VALUES('coverage-boundary','Coverage boundary','coverage-boundary',0,0)" },
      { sql: "INSERT INTO research_runs(id,team_id,mode,status,days,editorial,created_at,icp,source_count,source_ids) VALUES('coverage-boundary-run','coverage-boundary','scan','collecting',1,0,?,'Product managers',1,?)", params: [now, JSON.stringify([seed.id])] },
      { sql: "INSERT INTO research_run_sources(id,run_id,source_id,status) VALUES('coverage-boundary-step','coverage-boundary-run',?,'completed')", params: [seed.id] },
      ...ids.map((id, index) => ({
        sql: "INSERT INTO research_items(id,team_id,source_id,canonical_url,title,excerpt,published_at,collected_at,content) VALUES(?,'coverage-boundary',?,?,?,?,?,?,?)",
        params: [id, seed.id, `${new URL(seed.url).origin}/${id}`, id, quote, now - (index + 1) * 1000, now, `${quote} ${"Concrete workflow details and scope. ".repeat(25)}`],
      })),
    ] });
    const priorKey = process.env.OPENAI_API_KEY;
    const priorAnthropicKey = process.env.ANTHROPIC_API_KEY;
    process.env.OPENAI_API_KEY = "test-coverage-boundary";
    process.env.ANTHROPIC_API_KEY = "test-coverage-boundary";
    let evidenceCalls = 0;
    let screenCalls = 0;
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      const input = JSON.parse(request.input ?? request.messages[0].content);
      let value: unknown;
      if ((request.text?.format.schema ?? request.output_config.format.schema).properties.assessments) {
        screenCalls++;
        value = screeningFixture({ itemIds: ids }, input.items);
      } else {
        evidenceCalls++;
        const findings = ids.map(id => ({ itemId: id, score: 85, summary: "A concrete onboarding decision", whyItMatters: "First useful action", contentAngle: "Audit optional setup", evidence: quote, limitations: "One practitioner workflow", familyKey: id }));
        value = { findings: evidenceCalls === 1 ? findings.slice(0, 1) : evidenceCalls === 2 ? [findings[0], findings[0]] : findings };
      }
      return modelResponseFixture({ status: "completed", usage: { input_tokens: 10, output_tokens: 10 }, output: [{ content: [{ type: "output_text", text: JSON.stringify(value) }] }] });
    });
    try {
      for (let attempt = 1; attempt <= 2; attempt++) {
        await expect(processResearchJob({ operation: "rank", runId: "coverage-boundary-run" })).rejects.toThrow();
        expect(evidenceCalls).toBe(attempt);
        const [checkpoint, cache, archives] = execute({ queries: [
          { sql: "SELECT value FROM research_cache WHERE id='rank-progress:coverage-boundary-run'" },
          { sql: "SELECT COUNT(*) count FROM research_cache WHERE team_id='coverage-boundary' AND id NOT LIKE 'invalid:%' AND json_type(value,'$.findings')='array'" },
          { sql: "SELECT COUNT(*) count FROM research_cache WHERE team_id='coverage-boundary' AND id LIKE 'invalid:%'" },
        ] }).map((result: { results: unknown[] }) => result.results[0]);
        expect(JSON.parse(checkpoint.value)).toMatchObject({ selectedIds: ids, nextOffset: 0, diagnostics: { evidenceCount: 0 } });
        expect(cache.count).toBe(0);
        expect(archives.count).toBe(attempt);
      }
      expect(await processResearchJob({ operation: "rank", runId: "coverage-boundary-run" })).toEqual({ ok: true, pending: false });
      expect(screenCalls).toBe(1);
      expect(evidenceCalls).toBe(3);
      expect(execute({ queries: [{ sql: "SELECT findings_count FROM research_runs WHERE id='coverage-boundary-run'" }] })[0].results).toEqual([{ findings_count: 2 }]);
    } finally {
      fetcher.mockRestore();
      if (priorKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = priorKey;
      if (priorAnthropicKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = priorAnthropicKey;
    }
  }, 30_000);

  it("saves a fixed local daily time and claims concurrent minute ticks without consuming a busy occurrence", async () => {
    execute({ queries: [
      { sql: "UPDATE research_settings SET daily_enabled=0" },
      { sql: "INSERT INTO teams(id,name,slug,created_at,updated_at) VALUES('fixed-daily','Fixed','fixed-daily',0,0)" },
    ] });
    const now = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-23T03:44:00Z"));
    const previousKey = process.env.OPENAI_API_KEY;
    const previousAnthropicKey = process.env.ANTHROPIC_API_KEY;
    process.env.OPENAI_API_KEY = "test-daily-key";
    process.env.ANTHROPIC_API_KEY = "test-daily-key";
    const dispatch = vi.fn(async () => ({}));
    globalThis.__contentHubResearchWorkflow__ = { create: dispatch };
    try {
      await updateResearchSettings("fixed-daily", { dailyTime: "09:15", dailyTimezone: "Asia/Kolkata" });
      const due = Date.parse("2026-10-23T03:45:00Z");
      expect((await getResearchSnapshot("fixed-daily")).settings).toMatchObject({
        dailyTime: "09:15", dailyTimezone: "Asia/Kolkata", nextDailyAt: due,
      });
      await expect(updateResearchSettings("fixed-daily", { dailyTime: "24:00" })).rejects.toThrow();
      await expect(updateResearchSettings("fixed-daily", { dailyTimezone: "Bad/Zone" })).rejects.toThrow();
      expect(await processResearchJob({ operation: "daily", scheduledTime: Date.now() })).toEqual({ dispatched: 0 });
      const manual = await createResearchRun("fixed-daily", { days: 1, mode: "scan" }, true);
      now.mockReturnValue(due);
      expect(await processResearchJob({ operation: "daily", scheduledTime: due })).toEqual({ dispatched: 0 });
      expect((await getResearchSnapshot("fixed-daily")).settings.nextDailyAt).toBe(due);
      execute({ queries: [{ sql: "UPDATE research_runs SET status='completed' WHERE id=?", params: [manual.run.id] }] });
      execute({ queries: [{ sql: "UPDATE research_settings SET daily_claim_id='another-worker',daily_claim_until=? WHERE team_id='fixed-daily'", params: [due + 60_000] }] });
      expect(await processResearchJob({ operation: "daily", scheduledTime: due })).toEqual({ dispatched: 0 });
      execute({ queries: [{ sql: "UPDATE research_settings SET daily_claim_until=? WHERE team_id='fixed-daily'", params: [due - 1] }] });
      const results = await Promise.all([
        processResearchJob({ operation: "daily", scheduledTime: due }),
        processResearchJob({ operation: "daily", scheduledTime: due }),
      ]);
      expect(results.reduce((sum, result) => sum + ("dispatched" in result ? result.dispatched ?? 0 : 0), 0)).toBe(1);
      expect(dispatch).toHaveBeenCalledTimes(2);
      expect((await getResearchSnapshot("fixed-daily")).settings.nextDailyAt).toBe(Date.parse("2026-10-24T03:45:00Z"));
      await updateResearchSettings("fixed-daily", { icp: "Updated product teams and customer research audience" });
      expect((await getResearchSnapshot("fixed-daily")).settings.nextDailyAt).toBe(Date.parse("2026-10-24T03:45:00Z"));
      await updateResearchSettings("fixed-daily", { dailyTime: "10:15" });
      expect((await getResearchSnapshot("fixed-daily")).settings.nextDailyAt).toBe(Date.parse("2026-10-24T04:45:00Z"));
      await updateResearchSettings("fixed-daily", { dailyEnabled: false });
      expect((await getResearchSnapshot("fixed-daily")).settings.nextDailyAt).toBeNull();
      now.mockReturnValue(Date.parse("2026-10-23T03:46:00Z"));
      await updateResearchSettings("fixed-daily", { dailyEnabled: true });
      expect((await getResearchSnapshot("fixed-daily")).settings.nextDailyAt).toBe(Date.parse("2026-10-24T04:45:00Z"));
      await updateResearchSettings("fixed-daily", { dailyTime: null });
      expect((await getResearchSnapshot("fixed-daily")).settings).toMatchObject({ dailyTime: null, nextDailyAt: null });
    } finally {
      now.mockRestore();
      if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previousKey;
      if (previousAnthropicKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = previousAnthropicKey;
    }
  }, 30_000);
  it("retries a failed scheduled workflow dispatch using the same queued run ID", async () => {
    execute({ queries: [
      { sql: "UPDATE research_settings SET daily_enabled=0" },
      { sql: "INSERT INTO teams(id,name,slug,created_at,updated_at) VALUES('retry-daily','Retry','retry-daily',0,0)" },
    ] });
    const now = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-23T03:44:00Z"));
    const previousKey = process.env.OPENAI_API_KEY;
    const previousAnthropicKey = process.env.ANTHROPIC_API_KEY;
    process.env.OPENAI_API_KEY = "test-daily-key";
    process.env.ANTHROPIC_API_KEY = "test-daily-key";
    const dispatch = vi.fn(async () => ({})).mockRejectedValueOnce(new Error("Workflow temporarily unavailable"));
    globalThis.__contentHubResearchWorkflow__ = { create: dispatch };
    try {
      await updateResearchSettings("retry-daily", { dailyTime: "09:15", dailyTimezone: "Asia/Kolkata" });
      const due = Date.parse("2026-10-23T03:45:00Z");
      now.mockReturnValue(due);
      expect(await processResearchJob({ operation: "daily", scheduledTime: due })).toEqual({ dispatched: 0 });
      expect((await getResearchSnapshot("retry-daily")).runs[0].status).toBe("queued");
      expect((await getResearchSnapshot("retry-daily")).settings.nextDailyAt).toBe(due);
      expect(await processResearchJob({ operation: "daily", scheduledTime: due + 60_000 })).toEqual({ dispatched: 1 });
      expect(dispatch.mock.calls[0]).toEqual(dispatch.mock.calls[1]);
      expect((await getResearchSnapshot("retry-daily")).runs).toHaveLength(1);
    } finally {
      now.mockRestore();
      if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previousKey;
      if (previousAnthropicKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = previousAnthropicKey;
    }
  }, 30_000);
  it("recovers a queued daily run across schedule edits and an interruption after dispatch", async () => {
    execute({ queries: [
      { sql: "UPDATE research_settings SET daily_enabled=0" },
      { sql: "INSERT INTO teams(id,name,slug,created_at,updated_at) VALUES('changed-daily','Changed','changed-daily',0,0)" },
    ] });
    const now = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-23T03:44:00Z"));
    const previousKey = process.env.OPENAI_API_KEY;
    const previousAnthropicKey = process.env.ANTHROPIC_API_KEY;
    process.env.OPENAI_API_KEY = "test-daily-key";
    process.env.ANTHROPIC_API_KEY = "test-daily-key";
    const dispatch = vi.fn(async () => ({})).mockRejectedValueOnce(new Error("Workflow temporarily unavailable"));
    globalThis.__contentHubResearchWorkflow__ = { create: dispatch };
    try {
      await updateResearchSettings("changed-daily", { dailyTime: "09:15", dailyTimezone: "Asia/Kolkata" });
      now.mockReturnValue(Date.parse("2026-10-23T03:45:00Z"));
      expect(await processResearchJob({ operation: "daily", scheduledTime: Date.now() })).toEqual({ dispatched: 0 });
      const queued = (await getResearchSnapshot("changed-daily")).runs[0];
      await updateResearchSettings("changed-daily", { dailyTime: "05:00", dailyTimezone: "UTC" });
      now.mockReturnValue(Date.parse("2026-10-23T05:00:00Z"));
      dispatch.mockImplementationOnce(async () => {
        execute({ queries: [
          { sql: "UPDATE research_runs SET status='completed' WHERE id=?", params: [queued.id] },
          { sql: "UPDATE research_settings SET daily_claim_id='interrupted-worker',daily_claim_until=? WHERE team_id='changed-daily'", params: [Date.now() - 1] },
        ] });
        return {};
      });
      expect(await processResearchJob({ operation: "daily", scheduledTime: Date.now() })).toEqual({ dispatched: 0 });
      expect(dispatch.mock.calls[0]).toEqual(dispatch.mock.calls[1]);
      expect(execute({ queries: [{ sql: "SELECT daily_pending_run_id FROM research_settings WHERE team_id='changed-daily'" }] })[0].results).toEqual([{ daily_pending_run_id: queued.id }]);
      expect(await processResearchJob({ operation: "daily", scheduledTime: Date.now() })).toEqual({ dispatched: 1 });
      expect((await getResearchSnapshot("changed-daily")).settings.nextDailyAt).toBe(Date.parse("2026-10-24T05:00:00Z"));
      expect(execute({ queries: [{ sql: "SELECT daily_pending_run_id FROM research_settings WHERE team_id='changed-daily'" }] })[0].results).toEqual([{ daily_pending_run_id: null }]);
      expect(await processResearchJob({ operation: "daily", scheduledTime: Date.now() })).toEqual({ dispatched: 0 });
      expect(dispatch).toHaveBeenCalledTimes(2);
      expect((await getResearchSnapshot("changed-daily")).runs).toHaveLength(1);
    } finally {
      now.mockRestore();
      if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previousKey;
      if (previousAnthropicKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = previousAnthropicKey;
    }
  }, 30_000);
  it("dispatches one 24-hour editorial scan on unaligned cron ticks without repeating model work", async () => {
    execute({
      queries: [
        { sql: "UPDATE research_settings SET daily_enabled=0" },
        {
          sql: "INSERT INTO teams(id,name,slug,created_at,updated_at) VALUES('daily','Daily','daily',0,0)",
        },
      ],
    });
    await initializeResearch("daily");
    const dispatch = vi.fn(async () => ({}));
    globalThis.__contentHubResearchWorkflow__ = { create: dispatch };
    const fetcher = vi.spyOn(globalThis, "fetch");
    const previousKey = process.env.OPENAI_API_KEY;
    const previousAnthropicKey = process.env.ANTHROPIC_API_KEY;
    process.env.OPENAI_API_KEY = "test-daily-key";
    process.env.ANTHROPIC_API_KEY = "test-daily-key";
    const tick = Date.parse("2026-10-26T09:50:51.409Z");
    const now = vi.spyOn(Date, "now").mockReturnValue(tick);
    try {
      expect(await processResearchJob({ operation: "daily", scheduledTime: tick })).toEqual({
        dispatched: 1,
      });
      expect((await getResearchSnapshot("daily")).runs[0]).toMatchObject({
        mode: "scan",
        days: 1,
        editorial: true,
      });
      execute({ queries: [{ sql: "UPDATE research_runs SET status='completed' WHERE team_id='daily'" }] });
      now.mockReturnValue(tick + 60_000);
      expect(await processResearchJob({ operation: "daily", scheduledTime: Date.now() })).toEqual({
        dispatched: 0,
      });
      now.mockReturnValue(tick + 86_400_000 - 1);
      expect(await processResearchJob({ operation: "daily", scheduledTime: Date.now() })).toEqual({ dispatched: 0 });
      expect(dispatch).toHaveBeenCalledTimes(1);
      now.mockReturnValue(tick + 86_400_000 + 500);
      expect(await processResearchJob({ operation: "daily", scheduledTime: Date.now() })).toEqual({ dispatched: 1 });
      expect(await processResearchJob({ operation: "daily", scheduledTime: Date.now() })).toEqual({ dispatched: 0 });
      expect(dispatch).toHaveBeenCalledTimes(2);
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      now.mockRestore();
      fetcher.mockRestore();
      if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previousKey;
      if (previousAnthropicKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = previousAnthropicKey;
    }
  }, 20_000);
  it("keeps a daily scan due when a manual discovery run occupies the workflow", async () => {
    execute({ queries: [
      { sql: "UPDATE research_settings SET daily_enabled=0" },
      { sql: "INSERT INTO teams(id,name,slug,created_at,updated_at) VALUES('manual-busy','Busy','manual-busy',0,0)" },
    ] });
    await initializeResearch("manual-busy");
    const previousKey = process.env.OPENAI_API_KEY;
    const previousAnthropicKey = process.env.ANTHROPIC_API_KEY;
    process.env.OPENAI_API_KEY = "test-daily-key";
    process.env.ANTHROPIC_API_KEY = "test-daily-key";
    globalThis.__contentHubResearchWorkflow__ = { create: vi.fn(async () => ({})) };
    try {
      const manual = await createResearchRun("manual-busy", { days: 30, mode: "scan" });
      expect(await processResearchJob({ operation: "daily" })).toEqual({ dispatched: 0 });
      expect(execute({ queries: [{ sql: "SELECT last_daily_at FROM research_settings WHERE team_id='manual-busy'" }] })[0].results).toEqual([{ last_daily_at: null }]);
      execute({ queries: [{ sql: "UPDATE research_runs SET status='completed' WHERE id=?", params: [manual.run.id] }] });
      expect(await processResearchJob({ operation: "daily" })).toEqual({ dispatched: 1 });
      const snapshot = await getResearchSnapshot("manual-busy");
      expect(snapshot.runs.find(run => run.editorial)).toMatchObject({ days: 1, mode: "scan" });
    } finally {
      if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previousKey;
      if (previousAnthropicKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = previousAnthropicKey;
    }
  }, 20_000);
  it("keeps per-profile prompts team-scoped and rejects missing prompts and asset-only formats", async () => {
    execute({
      queries: [
        {
          sql: "INSERT INTO channels(id,team_id,name,platform,group_name,created_at) VALUES('profile-a','a','My custom brand','facebook','custom',0)",
        },
        {
          sql: "INSERT INTO channels(id,team_id,name,platform,group_name,created_at) VALUES('profile-video','a','Video channel','youtube','custom',0)",
        },
      ],
    });
    await expect(
      updateResearchProfile("b", {
        id: "profile-a",
        enabled: true,
        systemPrompt: "Write practical lessons for independent designers",
      }),
    ).rejects.toThrow("not found");
    await expect(
      updateResearchProfile("a", {
        id: "profile-a",
        enabled: true,
        systemPrompt: "Too short",
      }),
    ).rejects.toThrow("20 characters");
    await expect(
      updateResearchProfile("a", {
        id: "profile-video",
        enabled: true,
        systemPrompt: "Write practical lessons for independent designers",
      }),
    ).rejects.toThrow("publishing format");
    await updateResearchProfile("a", {
      id: "profile-a",
      enabled: true,
      systemPrompt: "Write practical lessons for independent designers",
    });
    expect(
      (await getResearchProfiles("a")).profiles.find(
        (profile) => profile.id === "profile-a",
      ),
    ).toMatchObject({
      enabled: true,
      platform: "facebook",
      systemPrompt: "Write practical lessons for independent designers",
    });
    expect((await getResearchProfiles("b")).profiles).toHaveLength(0);
  });
  it("ranks a24hour run without spending tokens on stale, future, or undated items", async () => {
    const now = Date.now();
    const seed = RESEARCH_SOURCE_SEEDS.find(
      (entry) => entry.enabled && entry.feedUrl,
    )!;
    execute({
      queries: [
        {
          sql: "INSERT INTO teams(id,name,slug,created_at,updated_at) VALUES('empty-daily','Empty daily','empty-daily',0,0)",
        },
        {
          sql: "INSERT INTO research_runs(id,team_id,mode,status,days,editorial,created_at,icp,source_count,source_ids) VALUES('empty-daily-run','empty-daily','scan','collecting',1,1,?,'ICP',1,?)",
          params: [now, JSON.stringify([seed.id])],
        },
        {
          sql: "INSERT INTO research_run_sources(id,run_id,source_id,status) VALUES('empty-daily-step','empty-daily-run',?,'completed')",
          params: [seed.id],
        },
        ...[now - 86400001, now + 1, null].map((at, index) => ({
          sql: "INSERT INTO research_items(id,team_id,source_id,canonical_url,title,excerpt,published_at,collected_at) VALUES(?,'empty-daily',?,?,'Out of window','Not eligible',?,?)",
          params: [
            `excluded-${index}`,
            seed.id,
            `https://example.com/excluded-${index}`,
            at,
            index === 0 ? now - 2 * 86400000 : now,
          ],
        })),
        {
          sql: "INSERT INTO research_items(id,team_id,source_id,canonical_url,title,excerpt,published_at,collected_at,content_type,transcript_status) VALUES('unreadable-video','empty-daily',?,'https://example.com/video','Fresh video','No public transcript',?,?,'video','unavailable')",
          params: [seed.id, now - 1000, now],
        },
        {
          sql: "INSERT INTO research_items(id,team_id,source_id,canonical_url,title,excerpt,published_at,collected_at) VALUES('other-source-undated','empty-daily','not-in-this-run','https://example.com/other-source','Unselected source','Does not affect coverage',NULL,?)",
          params: [now],
        },
      ],
    });
    const fetcher = vi.spyOn(globalThis, "fetch");
    try {
      await processResearchJob({ operation: "rank", runId: "empty-daily-run" });
      expect(fetcher).not.toHaveBeenCalled();
      const snapshot = await getResearchSnapshot("empty-daily");
      expect(snapshot.runs[0]).toMatchObject({
        status: "drafting",
        days: 1,
        inputTokens: 0,
        outputTokens: 0,
        findingsCount: 0,
        diagnostics: {
          eligibleCount: 0, undatedCount: 1, unavailableVideoCount: 1,
          screenedCount: 0, shortlistedCount: 0, evidenceCount: 0,
          outcome: "No dated, readable items in this window. Check source coverage and unavailable transcripts.",
        },
      });
      expect(snapshot.findings).toHaveLength(0);
    } finally {
      fetcher.mockRestore();
    }
  }, 20_000);
  it("continues beyond twenty draft candidates without regenerating existing reviews or retrying declined stories", async () => {
    const now = Date.now();
    const quote = "Customer interviews exposed a specific setup step that delayed the first useful action.";
    const ids = Array.from({ length: 25 }, (_, index) => `uncapped-draft-${index}`);
    const insertFinding = (id: string, score: number) => [
      { sql: "INSERT INTO research_items(id,team_id,source_id,canonical_url,title,excerpt,published_at,collected_at,content) VALUES(?,'uncapped-drafts','uncapped-source',?,?,?,?,?,?)", params: [`item-${id}`, `https://example.com/${id}`, id, quote, id === ids[24] ? now - 30 * 86400000 : now - 1000, now, `${quote} ${"The implementation and limits are described. ".repeat(20)}`] },
      { sql: "INSERT INTO research_findings(id,team_id,run_id,item_id,source_id,title,url,published_at,score,summary,why_it_matters,content_angle,evidence,limitations,created_at,family_key) VALUES(?,'uncapped-drafts','uncapped-draft-run',?,'uncapped-source',?,?,?,?, 'Specific setup friction','First useful action','Audit optional setup',?,'One practitioner example',?,?)", params: [id, `item-${id}`, id, `https://example.com/${id}`, id === ids[24] ? now - 30 * 86400000 : now - 1000, score, quote, now, `family-${id}`] },
    ];
    execute({ queries: [
      { sql: "INSERT INTO teams(id,name,slug,created_at,updated_at) VALUES('uncapped-drafts','Uncapped drafts','uncapped-drafts',0,0)" },
      { sql: "INSERT INTO channels(id,team_id,name,platform,group_name,research_enabled,system_prompt,created_at) VALUES('uncapped-li','uncapped-drafts','Product lessons','linkedin','custom',1,'Explain specific product decisions to product managers with original evidence',0)" },
      { sql: "INSERT INTO research_runs(id,team_id,mode,status,days,editorial,created_at,icp,source_ids) VALUES('uncapped-draft-run','uncapped-drafts','scan','drafting',1,1,?,'Product teams',?)", params: [now, JSON.stringify(["uncapped-source"])] },
      ...ids.flatMap((id, index) => insertFinding(id, 99 - index)),
      { sql: "INSERT INTO research_drafts(id,team_id,run_id,finding_id,content,status,revision,created_at,updated_at) VALUES('preserved-review','uncapped-drafts','uncapped-draft-run',?,?,'pending',3,?,?)", params: [ids[0], JSON.stringify({ preserved: "Existing approved copy and review state" }), now, now] },
    ] });
    const priorKey = process.env.OPENAI_API_KEY;
    const priorAnthropicKey = process.env.ANTHROPIC_API_KEY;
    process.env.OPENAI_API_KEY = "test-uncapped-draft-key";
    process.env.ANTHROPIC_API_KEY = "test-uncapped-draft-key";
    const calls: string[] = [];
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      const input = JSON.parse(request.input ?? request.messages[0].content);
      if (input.proposed) return editorialReviewFixture();
      if (input.source.title === ids[24]) expect(input.source).toMatchObject({ signalKind: "evergreen_newly_discovered", publishedAt: new Date(now - 30 * 86400000).toISOString() });
      calls.push(input.source.title);
      const value = input.source.title === ids[1]
        ? { ready: false, reason: "The source is too thin for this audience", targets: [] }
        : { ready: true, editorial: editorialFixture(input.source.content), reason: "A practical supported decision", targets: [{ channelId: "uncapped-li", platform: "linkedin", content: `Audit optional setup before requiring it. Source: ${input.source.url}`, thread: [], supportQuote: input.source.title === ids[2] ? "An unsupported quote that does not exist in the article." : quote, redditTitle: null, subreddit: null }] };
      return modelResponseFixture({ status: "completed", usage: { input_tokens: 10, output_tokens: 10 }, output: [{ content: [{ type: "output_text", text: JSON.stringify(screeningFixture(value, input.items)) }] }] });
    });
    try {
      let result = await processResearchDraftJob("uncapped-draft-run");
      expect(result).toEqual({ drafted: 1, pending: true });
      execute({ queries: insertFinding("uncapped-arrival-after-snapshot", 100) });
      let continuations = 0;
      while ("pending" in result && result.pending) {
        result = await processResearchDraftJob("uncapped-draft-run");
        expect(++continuations).toBeLessThan(40);
      }
      expect(result).toEqual({ drafted: 23 });
      expect(calls).not.toContain(ids[0]);
      expect(calls).not.toContain("uncapped-arrival-after-snapshot");
      expect(calls.filter(id => id === ids[1])).toHaveLength(1);
      expect(calls.filter(id => id === ids[2])).toHaveLength(2);
      expect(new Set(calls)).toEqual(new Set(ids.slice(1)));
      const [stored, preserved, counts] = execute({ queries: [
        { sql: "SELECT status,diagnostics FROM research_runs WHERE id='uncapped-draft-run'" },
        { sql: "SELECT content,status,revision FROM research_drafts WHERE id='preserved-review'" },
        { sql: "SELECT COUNT(*) count FROM research_drafts WHERE team_id='uncapped-drafts'" },
      ] }).map((result: { results: unknown[] }) => result.results[0]);
      expect(stored.status).toBe("completed");
      expect(JSON.parse(stored.diagnostics)).toMatchObject({ draftCandidatesCount: 25, draftedCount: 23 });
      expect(JSON.parse(stored.diagnostics).rejectedStories).toEqual(expect.arrayContaining([
        expect.objectContaining({ title: ids[1], reason: expect.stringContaining("too thin") }),
        expect.objectContaining({ title: ids[2], reason: expect.stringContaining("validation failed") }),
      ]));
      expect(preserved).toEqual({ content: JSON.stringify({ preserved: "Existing approved copy and review state" }), status: "pending", revision: 3 });
      expect(counts.count).toBe(23);
      const totalCalls = fetcher.mock.calls.length;
      expect(await processResearchDraftJob("uncapped-draft-run")).toEqual({ drafted: 23 });
      expect(fetcher).toHaveBeenCalledTimes(totalCalls);
    } finally {
      fetcher.mockRestore();
      if (priorKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = priorKey;
      if (priorAnthropicKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = priorAnthropicKey;
    }
  }, 60_000);

  it("chooses two strong24hour profile fits even after the top finding is declined, with cached edits and no auto-publishing", async () => {
    const now = Date.now();
    const quote = "Talk to customers before changing the onboarding flow.";
    execute({
      queries: [
        {
          sql: "INSERT INTO teams(id,name,slug,created_at,updated_at) VALUES('editorial','Editorial','editorial',0,0)",
        },
        {
          sql: "INSERT INTO channels(id,team_id,name,platform,group_name,research_enabled,system_prompt,created_at) VALUES('editorial-linkedin','editorial','My LinkedIn','linkedin','custom',1,'Write practical onboarding observations for product managers',0)",
        },
        {
          sql: "INSERT INTO research_runs(id,team_id,mode,status,days,editorial,created_at,icp) VALUES('editorial-run','editorial','scan','drafting',1,1,?,'B2B SaaS founders')",
          params: [now],
        },
        ...[
          { id: "old", at: now - 86400001, score: 99 },
          { id: "future", at: now + 1, score: 99 },
          { id: "weak", at: now - 1000, score: 69 },
          { id: "best", at: now - 86400000, score: 95 },
          { id: "runner", at: now - 1000, score: 75 },
          { id: "third", at: now - 1000, score: 70 },
          { id: "previous-manual", at: now - 1000, score: 99 },
        ].flatMap((entry) => [
          {
            sql: "INSERT INTO research_items(id,team_id,source_id,canonical_url,title,excerpt,published_at,collected_at,content) VALUES(?,'editorial','practitioner',?,?,?, ?,?,?)",
            params: [
              `ed-item-${entry.id}`,
              `https://example.com/${entry.id}`,
              entry.id,
              quote,
              entry.at,
              now,
              quote.repeat(20),
            ],
          },
          {
            sql: "INSERT INTO research_findings(id,team_id,run_id,item_id,source_id,title,url,published_at,score,summary,why_it_matters,content_angle,evidence,limitations,created_at,family_key) VALUES(?,'editorial','editorial-run',?,'practitioner',?,?,?,?,?,'Practical','Angle',?,'Anecdotal',?,?)",
            params: [
              `ed-finding-${entry.id}`,
              `ed-item-${entry.id}`,
              entry.id,
              `https://example.com/${entry.id}`,
              entry.at,
              entry.score,
              quote,
              quote,
              now,
              `family-${entry.id}`,
            ],
          },
        ]),
      ],
    });
    execute({
      queries: [
        {
          sql: "UPDATE research_runs SET source_ids=?,diagnostics=? WHERE id='editorial-run'",
          params: [JSON.stringify(["practitioner"]), JSON.stringify({ eligibleCount: 3, screenedCount: 3, shortlistedCount: 3, evidenceCount: 3 })],
        },
        {
          sql: "INSERT INTO research_runs(id,team_id,mode,status,days,created_at,icp) VALUES('editorial-manual-run','editorial','scan','completed',30,?,'ICP')",
          params: [now - 1],
        },
        {
          sql: "UPDATE research_findings SET run_id='editorial-manual-run' WHERE id IN ('ed-finding-previous-manual','ed-finding-old')",
        },
      ],
    });
    const priorKey = process.env.OPENAI_API_KEY;
    const priorAnthropicKey = process.env.ANTHROPIC_API_KEY;
    process.env.OPENAI_API_KEY = "test-editorial-key";
    process.env.ANTHROPIC_API_KEY = "test-editorial-key";
    const fetcher = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (url, init) => {
        expect(String(url)).toBe("https://api.openai.com/v1/responses");
        const data = JSON.parse(String(init?.body));
        const input = JSON.parse(data.input ?? data.messages[0].content);
      if (input.proposed) return editorialReviewFixture();
        expect(["best", "runner", "third"]).toContain(input.source.title);
        return modelResponseFixture({
          status: "completed",
          output: [
            {
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify(
                    input.source.title === "best"
                      ? {
                          ready: false,
                          reason:
                            "Strong evidence but not relevant to this profile",
                          targets: [],
                        }
                      : {
                          ready: true, editorial: editorialFixture(input.source.content),
                          reason: "Useful first hand evidence",
                          targets: [
                            {
                              channelId: "editorial-linkedin",
                              platform: "linkedin",
                              content: `Customer conversations expose onboarding gaps. A practitioner suggests starting with interviews. Source: ${input.source.url}`,
                              thread: [],
                              supportQuote: quote,
                              redditTitle: null,
                              subreddit: null,
                            },
                          ],
                        },
                  ),
                },
              ],
            },
          ],
          usage: { input_tokens: 30, output_tokens: 40 },
        });
      });
    try {
      expect(await finishResearchDraftJob("editorial-run")).toEqual({
        drafted: 2,
      });
      expect(await finishResearchDraftJob("editorial-run")).toEqual({
        drafted: 2,
      });
      expect(fetcher).toHaveBeenCalledTimes(5);
      const snapshot = await getResearchSnapshot("editorial");
      expect(snapshot.drafts).toHaveLength(2);
      expect(snapshot.drafts[0].content.targets[0].channelName).toBe(
        "My LinkedIn",
      );
      execute({
        queries: [
          {
            sql: "INSERT INTO slack_integrations(team_id,workspace_id,channel_id,credentials,created_at,updated_at) VALUES('editorial','TEDITORIAL','CEDITORIAL','{}',0,0)",
          },
          {
            sql: "UPDATE research_drafts SET slack_channel_id='CEDITORIAL',slack_thread_ts='1234567890.123456' WHERE id=?",
            params: [snapshot.drafts[0].id],
          },
        ],
      });
      expect(
        (await getResearchSnapshot("editorial")).drafts.find(
          (draft) => draft.id === snapshot.drafts[0].id,
        )?.slackThreadUrl,
      ).toBe(
        "https://app.slack.com/client/TEDITORIAL/CEDITORIAL/thread/CEDITORIAL-1234567890.123456",
      );
      expect((await getResearchSnapshot("b")).drafts).toHaveLength(0);
      expect(snapshot.drafts.map((draft) => draft.title).sort()).toEqual([
        "runner",
        "third",
      ]);
      expect(snapshot.runs[0]).toMatchObject({
        status: "completed",
        inputTokens: 110,
        outputTokens: 130,
        diagnostics: {
          eligibleCount: 3, screenedCount: 3, shortlistedCount: 3, evidenceCount: 3,
          draftCandidatesCount: 3, draftedCount: 2,
          outcome: "Created 2 drafts; review delivery is tracked with each draft.",
        },
      });
      expect(
        execute({
          queries: [
            {
              sql: "SELECT COUNT(*) count FROM research_draft_revisions WHERE team_id='editorial'",
            },
            {
              sql: "SELECT COUNT(*) count FROM posts WHERE team_id='editorial' AND state IN ('scheduled','published','publishing')",
            },
          ],
        }).map((entry: { results: unknown }) => entry.results),
      ).toEqual([[{ count: 2 }], [{ count: 0 }]]);
      await expect(
        rewriteResearchDraftContent(snapshot.drafts[0].id, "b", "Shorten it"),
      ).rejects.toThrow("not found");
      expect(
        (
          await rewriteResearchDraftContent(
            snapshot.drafts[0].id,
            "editorial",
            "Shorten it",
          )
        ).inputTokens,
      ).toBe(40);
      expect(
        (
          await rewriteResearchDraftContent(
            snapshot.drafts[0].id,
            "editorial",
            "Shorten it",
          )
        ).inputTokens,
      ).toBe(0);
      expect(fetcher).toHaveBeenCalledTimes(7);
      // Replaying rank after a manual30-day scan must never generate approval drafts.
      execute({
        queries: [
          { sql: "UPDATE research_runs SET days=30 WHERE id='editorial-run'" },
        ],
      });
      expect(await finishResearchDraftJob("editorial-run")).toEqual({
        drafted: 0,
        skipped: true,
      });
      expect(fetcher).toHaveBeenCalledTimes(7);
    } finally {
      fetcher.mockRestore();
      if (priorKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = priorKey;
      if (priorAnthropicKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = priorAnthropicKey;
    }
  }, 20_000);
  it("rewrites setup samples with real evidence loading and model validation while keeping disabled profiles unchanged", async () => {
    execute({
      queries: [
        {
          sql: "INSERT INTO teams(id,name,slug,created_at,updated_at) VALUES('test-rewrite','Test rewrite','test-rewrite',0,0)",
        },
        {
          sql: "INSERT INTO channels(id,team_id,name,platform,group_name,research_enabled,system_prompt,created_at) VALUES('test-preview','test-rewrite','Preview only','linkedin','personal',0,'',0)",
        },
      ],
    });
    const test = await createSlackTestReview(
      "test-rewrite",
      "https://example.com",
    );
    const priorKey = process.env.OPENAI_API_KEY;
    const priorAnthropicKey = process.env.ANTHROPIC_API_KEY;
    process.env.OPENAI_API_KEY = "test-key";
    process.env.ANTHROPIC_API_KEY = "test-key";
    const fetcher = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (url, init) => {
        expect(String(url)).toBe("https://api.openai.com/v1/responses");
        const request = JSON.parse(String(init?.body));
        expect(request.model).toBe(RESEARCH_WRITING_MODEL);
        const input = JSON.parse(request.input ?? request.messages[0].content);
      if (input.proposed) return editorialReviewFixture();
        expect(input.source.content).toBe(SLACK_TEST_EVIDENCE);
        expect(input.destinations).toEqual([
          {
            id: "test-preview",
            platform: "linkedin",
            name: "Preview only",
            groupName: "personal",
            systemPrompt: SLACK_TEST_PROMPT,
          },
        ]);
        expect(input.editorialInstruction).toBe("Make it shorter");
        return modelResponseFixture({
          status: "completed",
          output: [
            {
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({
                    ready: true, editorial: editorialFixture(input.source.content),
                    reason: "Internal setup sample",
                    targets: [
                      {
                        channelId: "test-preview",
                        platform: "linkedin",
                        content: `Inspect the latest preview before approving. ${input.source.url}`,
                        thread: [],
                        supportQuote:
                          "A reviewer should inspect the latest preview before approving it.",
                        redditTitle: null,
                        subreddit: null,
                      },
                    ],
                  }),
                },
              ],
            },
          ],
          usage: { input_tokens: 60, output_tokens: 20 },
        });
      });
    try {
      const result = await rewriteResearchDraftContent(
        test.draftId,
        "test-rewrite",
        "Make it shorter",
      );
      expect(result.content.targets[0].content).toContain(
        "Inspect the latest preview",
      );
      expect(result.inputTokens).toBe(70);
      expect(fetcher).toHaveBeenCalledTimes(2);
      const snapshot = await getResearchSnapshot("test-rewrite");
      expect(snapshot.drafts[0].isTest).toBe(true);
      expect(snapshot.findings).toHaveLength(0);
      expect(snapshot.runs[0].mode).toBe("test");
      expect(
        (await getResearchProfiles("test-rewrite")).profiles[0],
      ).toMatchObject({ enabled: false, systemPrompt: "" });
      expect(await finishResearchDraftJob(snapshot.runs[0].id)).toEqual({
        drafted: 0,
        skipped: true,
      });
    } finally {
      fetcher.mockRestore();
      if (priorKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = priorKey;
      if (priorAnthropicKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = priorAnthropicKey;
    }
  }, 20_000);
  it("keeps usage totals isolated, prices once, and buckets revisions on their own billing date", async () => {
    execute({ queries: [
      { sql: "INSERT INTO teams(id,name,slug,created_at,updated_at) VALUES('usage','Usage','usage',0,0)" },
      { sql: "INSERT INTO research_runs(id,team_id,mode,status,days,created_at,icp) VALUES('usage-run','usage','scan','completed',1,?,'ICP')", params: [Date.parse('2026-10-01T00:00:00Z')] },
    ] });
    const context = { teamId: 'usage', runId: 'usage-run', stage: 'research' as const, operation: 'screen' };
    const id = await beginResearchUsage(context, 'gpt-6-luna');
    const response = { model: 'gpt-6-luna', tier: 'default', status: 'completed', usage: { input_tokens: 1000, output_tokens: 100, input_tokens_details: { cached_tokens: 100, cache_write_tokens: 200 } } };
    await finishResearchUsage(id, context, response);
    await finishResearchUsage(id, context, response);
    const revision = await beginResearchUsage({ ...context, stage: 'slack_revision', operation: 'rewrite' }, 'gpt-6-luna');
    await finishResearchUsage(revision, context, { ...response, usage: { input_tokens: 2000, output_tokens: 200 } });
    const interrupted = await beginResearchUsage(context, 'gpt-6-luna');
    await finishResearchUsage(interrupted, context, { model: 'gpt-6-luna', tier: 'default', status: 'unknown' });
    execute({ queries: [
      { sql: "UPDATE research_usage SET created_at=? WHERE id=?", params: [Date.parse('2026-10-01T00:10:00Z'), id] },
      { sql: "UPDATE research_usage SET created_at=? WHERE id=?", params: [Date.parse('2026-09-30T23:40:00Z'), revision] },
    ] });
    const india = await getResearchUsage('usage', 'Asia/Kolkata');
    const utc = await getResearchUsage('usage', 'UTC');
    expect(india.allTime).toMatchObject({ inputTokens: 3000, outputTokens: 300, requestCount: 3, estimatedRequests: 1, unknownRequests: 1 });
    expect(india.allTime.costUsd).toBeCloseTo(0.000496, 9);
    expect(india.monthly.find(row => row.month === '2026-10')?.inputTokens).toBe(3000);
    expect(utc.monthly.find(row => row.month === '2026-09')?.inputTokens).toBe(2000);
    expect(india.runs[0].stages.find(row => row.stage === 'slack_revision')?.inputTokens).toBe(2000);
    expect(india.runs[0].inputTokens).toBe(3000);
    expect((await getResearchUsage('b', 'UTC')).allTime.requestCount).toBe(0);
    expect(execute({ queries: [{ sql: "SELECT input_tokens,output_tokens FROM research_runs WHERE id='usage-run'" }] })[0].results).toEqual([{ input_tokens: 3000, output_tokens: 300 }]);
    await expect(getResearchUsage('usage', 'Invalid/Timezone')).rejects.toThrow('timezone');
  });

  it("retains billed tokens for malformed or incomplete responses and flags unknown network outcomes", async () => {
    execute({ queries: [{ sql: "INSERT INTO research_runs(id,team_id,mode,status,days,created_at,icp) VALUES('usage-errors','usage','scan','completed',1,?,'ICP')", params: [Date.now()] }] });
    const context = { teamId: 'usage', runId: 'usage-errors', stage: 'draft_generation' as const, operation: 'draft' };
    const previousKey = process.env.OPENAI_API_KEY;
    const previousAnthropicKey = process.env.ANTHROPIC_API_KEY;
    process.env.OPENAI_API_KEY = 'test-key';
    process.env.ANTHROPIC_API_KEY = 'test-key';
    const fetcher = vi.spyOn(globalThis, 'fetch');
    try {
      fetcher.mockResolvedValueOnce(modelResponseFixture({ status: 'completed', usage: { input_tokens: 100, output_tokens: 30 }, output: [{ content: [{ type: 'output_text', text: 'invalid json' }] }] }));
      await expect(callResearchModel('system', {}, {}, 100, context)).rejects.toThrow();
      fetcher.mockResolvedValueOnce(modelResponseFixture({ status: 'incomplete', usage: { input_tokens: 200, output_tokens: 40 } }));
      await expect(callResearchModel('system', {}, {}, 100, context)).rejects.toThrow('did not complete');
      fetcher.mockRejectedValueOnce(new Error('Network interrupted'));
      await expect(callResearchModel('system', {}, {}, 100, context)).rejects.toThrow('Network interrupted');
      const summary = await getResearchUsage('usage', 'UTC');
      const run = summary.runs.find(row => row.runId === 'usage-errors')!;
      expect(run).toMatchObject({ inputTokens: 300, outputTokens: 70, requestCount: 3, unknownRequests: 1 });
      expect(run.stages.find(row => row.stage === 'draft_generation')?.inputTokens).toBe(300);
    } finally {
      fetcher.mockRestore();
      if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previousKey;
      if (previousAnthropicKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = previousAnthropicKey;
    }
  });

  it("saves exactly one idea on repeated requests and rejects cross-team finding access", async () => {
    const runId = "saved-run";
    const now = Date.now();
    execute({
      queries: [
        {
          sql: "INSERT INTO research_runs(id,team_id,mode,status,days,created_at,icp) VALUES(?,?,?,?,?,?,?)",
          params: [runId, "a", "scan", "completed", 30, now, "ICP"],
        },
        {
          sql: "INSERT INTO research_items(id,team_id,source_id,canonical_url,title,excerpt,published_at,collected_at) VALUES(?,?,?,?,?,?,?,?)",
          params: [
            "item",
            "a",
            "source",
            "https://example.com/one",
            "Original",
            "Evidence",
            now,
            now,
          ],
        },
        {
          sql: "INSERT INTO research_findings(id,team_id,run_id,item_id,source_id,title,url,published_at,score,summary,why_it_matters,content_angle,evidence,limitations,created_at,family_key) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
          params: [
            "finding",
            "a",
            runId,
            "item",
            "source",
            "Original",
            "https://example.com/one",
            now,
            90,
            "Summary",
            "Useful",
            "Angle",
            "Actual evidence quote",
            "Anecdote",
            now,
            "event",
          ],
        },
      ],
    });
    await expect(
      actOnResearchFinding("b", { id: "finding", action: "save_idea" }),
    ).rejects.toThrow("not found");
    expect(
      await actOnResearchFinding("a", { id: "finding", action: "save_idea" }),
    ).toEqual({ ideaId: "research-finding" });
    await actOnResearchFinding("a", { id: "finding", action: "save_idea" });
    expect(
      execute({ queries: [{ sql: "SELECT COUNT(*) AS count FROM ideas WHERE team_id='a'" }] })[0]
        .results,
    ).toEqual([{ count: 1 }]);
    expect((await getResearchSnapshot("b")).findings).toHaveLength(0);
    expect(
      (await getResearchSnapshot("a")).findings.find(
        (finding) => finding.id === "finding",
      )?.status,
    ).toBe("saved");
  });
});
