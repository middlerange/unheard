import {
  getResearchProfiles,
  updateResearchProfile,
} from "./research-profiles";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
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
  researchHash, researchEvidenceSchema, validateResearchEvidence,
  RESEARCH_SCREEN_INSTRUCTIONS, RESEARCH_EVIDENCE_INSTRUCTIONS,
  RESEARCH_SCREEN_BATCH_SIZE,
} from "./research-model";
import { callResearchModel } from "./research-model";
import { RESEARCH_WRITING_MODEL } from "./research-writing";
import { beginResearchUsage, finishResearchUsage, getResearchUsage } from "./research-usage";
import {
  processResearchDraftJob,
  runResearchDraftWriting,
  rewriteResearchDraftContent,
} from "./research-drafts";
import { researchFindingDates, researchFindingSourceContext } from "./research-dates";
import { createSlackTestReview } from "./slack-test-review";
import { SLACK_TEST_EVIDENCE, SLACK_TEST_PROMPT } from "./slack-test-content";
import type { ResearchSourceSeed } from "./research-types";
import { RESEARCH_SOURCE_SEEDS } from "./research-sources";
import { getRunResearchFindings, researchRunFindingsCount, saveResearchFindingSnapshot } from "./research-finding-snapshots";
import { getFrozenResearchAudience, RESEARCH_AUDIENCE_ONLY_PROFILE_ID } from "./research-audience";
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
function fixtureResearchSchema(request: ReturnType<typeof JSON.parse>) {
  return request.text?.format?.schema ?? request.output_config?.format?.schema ?? request.tools?.[0]?.input_schema;
}

function modelResponseFixture(value: {
  status: string;
  usage?: unknown;
  output?: Array<{ content: Array<{ type: string; text: string }> }>;
}) {
  const output = value.output?.map(item => ({ ...item, content: item.content.map(part => {
    let parsed;
    try { parsed = JSON.parse(part.text); } catch { return part; }
    if (!Array.isArray(parsed.findings)) return part;
    return { ...part, text: JSON.stringify({ ...parsed, findings: parsed.findings.map((finding: { chosenProfileId?: string | null; profileFit?: string }) => ({
      chosenProfileId: RESEARCH_AUDIENCE_ONLY_PROFILE_ID, profileFit: "The saved general audience covers this bounded practitioner decision.", ...finding,
    })) }) };
  }) }));
  return Response.json({
    ...value,
    output,
    stop_reason: value.status === "completed" ? "end_turn" : "max_tokens",
    content: output?.flatMap(item => item.content.map(part => ({ ...part, type: "text" }))),
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
  cachedResearchBaseModel,
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
beforeEach(() => vi.stubGlobal("fetch", vi.fn(async input => {
  throw new Error(`Unexpected network request in research test: ${String(input)}`);
})));
afterEach(() => vi.unstubAllGlobals());
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
  let storageFault: ((queries: Array<{ sql: string; params: unknown[] }>, phase: 'before' | 'after') => void) | undefined;
  function storageExecute(queries: Array<{ sql: string; params: unknown[] }>) {
    storageFault?.(queries, 'before');
    const result = execute({ queries });
    storageFault?.(queries, 'after');
    return result;
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
      return storageExecute([this])[0];
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
      batch: async (queries: Statement[]) => storageExecute(queries),
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
  it("reuses per-source evidence after an incomplete batch, reordered replay and one changed body", async () => {
    const profileId = RESEARCH_AUDIENCE_ONLY_PROFILE_ID;
    const inputs = ["a", "b", "c"].map(id => ({
      id: `itemcache-${id}`, title: `Workflow ${id}`, sourceId: "test-public-publisher", publishedAt: 1000,
      discoveredAt: 2000, signalKind: "dated_reference", contentProvenance: "article",
      content: `The ${id} workflow checks actual customer behavior before selecting a product change.`,
    }));
    const makeRun = (id: string) => {
      execute({ queries: [{ sql: "INSERT INTO research_runs(id,team_id,mode,status,days,created_at,icp) VALUES(?,'a','replay','ranking',14,0,?)", params: [id, "Independent cache integration audience for concrete product decisions."] }] });
      return execute({ queries: [{ sql: "SELECT * FROM research_runs WHERE id=?", params: [id] }] })[0].results[0];
    };
    const first = makeRun("itemcache-first"), replay = makeRun("itemcache-replay");
    const calls: string[][] = [];
    let omittedC = false;
    const previousKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "test-item-cache-only";
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      expect(String(url)).toBe("https://api.anthropic.com/v1/messages");
      const request = JSON.parse(String(init?.body));
      const { items } = JSON.parse(request.messages[0].content) as { items: typeof inputs };
      calls.push(items.map(item => item.id));
      expect(items).toHaveLength(1);
      expect(request).not.toHaveProperty("tools");
      const omit = items[0].id === "itemcache-c" && !omittedC;
      if (omit) omittedC = true;
      const returned = omit ? [] : items;
      return modelResponseFixture({ status: "completed", usage: { input_tokens: 10, output_tokens: 5 }, output: [{ content: [{ type: "output_text", text: JSON.stringify({ findings: returned.map(item => ({
        itemId: item.id, summary: "Observe behavior before choosing a change.", evidence: item.content,
        contentAngle: "Inspect the actual customer workflow before prioritizing.", whyItMatters: "The observed bottleneck can differ from a feature request.",
        limitations: "A described workflow, without measured business outcomes.", familyKey: item.id, additionalIdeas: [],
        claimBasis: "described_method", profileChecks: [{ profileId, fits: true, relevance: 25, reason: "A concrete product judgment decision." }],
        qualityComponents: { sourceSupport: 23, usefulDecision: 25, scopeHonesty: 14 },
      })) }) }] }] });
    });
    const assess = (run: typeof first, items: typeof inputs) => cachedResearchBaseModel(run, "evidence", items, RESEARCH_EVIDENCE_INSTRUCTIONS, {}, 8192);
    try {
      await expect(assess(first, inputs)).rejects.toThrow("every input exactly once");
      const saved = execute({ queries: [{ sql: "SELECT value FROM research_cache WHERE team_id='a' AND id LIKE 'evidence-item:v1:%'", params: [] }] })[0].results;
      expect(saved.map((row: { value: string }) => JSON.parse(row.value).findings[0].itemId).filter((id: string) => id.startsWith("itemcache-"))).toEqual(expect.arrayContaining(["itemcache-a", "itemcache-b"]));
      expect(execute({ queries: [{ sql: "SELECT findings_count FROM research_runs WHERE id=?", params: [first.id] }] })[0].results[0].findings_count).toBe(0);
      const result = researchEvidenceSchema.parse(await assess(replay, [...inputs].reverse()));
      expect(result.findings.map(finding => finding.itemId)).toEqual(["itemcache-c", "itemcache-b", "itemcache-a"]);
      const changed = { ...inputs[1], content: "The changed workflow requires human approval before an agent publishes the campaign." };
      await assess(replay, [inputs[0], changed, inputs[2]]);
      const added = { ...inputs[2], id: "itemcache-new", content: "A new workflow turns an explicit customer goal into an inspectable activation step." };
      await assess(replay, [inputs[0], changed, added]);
      expect(calls).toEqual([["itemcache-a"], ["itemcache-b"], ["itemcache-c"], ["itemcache-c"], ["itemcache-b"], ["itemcache-new"]]);
    } finally {
      fetcher.mockRestore();
      if (previousKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = previousKey;
    }
  }, 30_000);
  it("scores with frozen structured profiles and reuses the paid response after live profile edits", async () => {
    const team = "structured-audience", now = Date.now();
    const seed = RESEARCH_SOURCE_SEEDS.find(source => source.enabled && source.kind === "rss" && source.feedUrl)!;
    const general = "B2B product and growth practitioners investigating practical decisions.";
    const company = "Only onboarding, activation and product adoption for the company account.";
    const personal = "Product, marketing, SEO and distribution decisions for a personal practitioner profile.";
    execute({ queries: [
      { sql: "INSERT INTO teams(id,name,slug,created_at,updated_at) VALUES(?,?,?,0,0)", params: [team, team, team] },
      ...[["audience-company", "Company", company], ["audience-personal", "Personal", personal]].map(([id, group, prompt]) => ({
        sql: "INSERT INTO channels(id,team_id,name,platform,group_name,research_enabled,system_prompt,created_at) VALUES(?,?,?,'linkedin',?,1,?,0)", params: [id, team, id, group, prompt],
      })),
    ] });
    await initializeResearch(team);
    execute({ queries: [{ sql: "UPDATE research_settings SET icp=? WHERE team_id=?", params: [general, team] }] });
    const previousKey = process.env.ANTHROPIC_API_KEY, previousWorkflow = globalThis.__contentHubResearchWorkflow__;
    process.env.ANTHROPIC_API_KEY = "test-structured-audience";
    globalThis.__contentHubResearchWorkflow__ = { create: vi.fn(async () => ({})) };
    const quote = "People who encountered an AI summary clicked a traditional search result less often in the observed visits.";
    let sourceCalls = 0, reviewCalls = 0;
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const request = JSON.parse(String(init?.body)), input = JSON.parse(request.messages[0].content);
      expect(input.icp).toBeUndefined();
      expect(input.generalAudience).toBe(general);
      expect(input.publishingProfiles).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: "audience-company", selectionInstructions: company, enabled: true }),
        expect.objectContaining({ id: "audience-personal", selectionInstructions: personal, enabled: true }),
      ]));
      expect(input.publishingProfiles).toHaveLength(2);
      const choices = fixtureResearchSchema(request).$defs.profileCheck.properties.profileId.enum;
      expect([...choices].sort()).toEqual(["audience-company", "audience-personal"]);
      if (Array.isArray(input.items[0].passages)) {
        reviewCalls++;
        expect(input.items[0]).not.toHaveProperty("content");
        expect(input.items[0]).not.toHaveProperty("excerpt");
        expect(input.items[0].passages.some((passage: { text: string }) => passage.text.includes(quote))).toBe(true);
        return modelResponseFixture({ status: "completed", usage: { input_tokens: 20, output_tokens: 10 }, output: [{ content: [{ type: "output_text", text: JSON.stringify({ findings: {
          "audience-item": {
            claimBasis: "no_useful_core", familyKey: "no-additional-reviewed-core",
            profileChecks: input.publishingProfiles.map((profile: { id: string }) => ({ profileId: profile.id, fits: false, relevance: 0, reason: "No additional supported reader decision beyond the preserved parent finding." })),
            qualityComponents: { sourceSupport: "unsupported", usefulDecision: "none", scopeHonesty: "accurately_bounded" },
            claim: { summary: "No additional supported core.", evidencePassageIds: [], contentAngle: "", whyItMatters: "", limitations: "The accepted parent finding remains unchanged." },
            additionalIdeas: [],
          },
        } }) }] }] });
      }
      sourceCalls++;
      expect(input.items[0].content).toBe(quote.repeat(8));
      return modelResponseFixture({ status: "completed", usage: { input_tokens: 20, output_tokens: 10 }, output: [{ content: [{ type: "output_text", text: JSON.stringify({ findings: [{
        itemId: "audience-item", chosenProfileId: "audience-personal", profileFit: "The personal profile explicitly covers distribution; inspect qualified referral traffic rather than treating company onboarding scope as a veto.",
        summary: "Observed search referral behavior", evidence: quote, contentAngle: "Measure qualified search referrals before changing distribution priorities", whyItMatters: "A personal growth practitioner chooses a distribution test", limitations: "Observational study, no causal claim", familyKey: "observed-search-referrals", score: 82,
      }] }) }] }] });
    });
    try {
      const { run } = await createResearchRun(team, { days: 7, mode: "scan", sourceIds: [seed.id] });
      execute({ queries: [
        { sql: "INSERT INTO research_run_sources(id,run_id,source_id,status) VALUES(?,?,?,'completed')", params: ["audience-source-step", run.id, seed.id] },
        { sql: "INSERT INTO research_items(id,team_id,source_id,canonical_url,title,excerpt,published_at,collected_at,content,content_provenance) VALUES('audience-item',?,?,?,'Search behavior',?,?,?,?,'article')", params: [team, seed.id, `${new URL(seed.url).origin}/audience-item`, quote, now - 1000, now, quote.repeat(8)] },
        { sql: "UPDATE channels SET system_prompt='Changed later to company adoption only',research_enabled=0 WHERE team_id=?", params: [team] },
      ] });
      storageFault = (queries, phase) => {
        if (phase === "before" && queries.some(query => query.params.includes(`rank-progress:${run.id}`)
          && query.params.some(param => typeof param === "string" && param.includes('"nextOffset":1')))) throw new Error("Network connection lost.");
      };
      await expect(processResearchJob({ operation: "rank", runId: run.id })).rejects.toThrow("Network connection lost");
      expect({ sourceCalls, reviewCalls }).toEqual({ sourceCalls: 1, reviewCalls: 2 });
      storageFault = undefined;
      await finishResearchRankJob(run.id);
      expect({ sourceCalls, reviewCalls }).toEqual({ sourceCalls: 1, reviewCalls: 2 });
      expect(fetcher).toHaveBeenCalledTimes(3);
      expect(execute({ queries: [{ sql: "SELECT findings_count,cache_hits FROM research_runs WHERE id=?", params: [run.id] }] })[0].results[0]).toMatchObject({ findings_count: 1, cache_hits: 1 });
      expect((await getRunResearchFindings(team, run.id))[0]).toMatchObject({ score: 82, evidence: quote, family_key: "observed-search-referrals" });
      const saved = execute({ queries: [{ sql: "SELECT * FROM research_runs WHERE id=?", params: [run.id] }] })[0].results[0];
      expect((await getFrozenResearchAudience(saved)).publishingProfiles.find(profile => profile.id === "audience-personal")?.systemPrompt).toBe(personal);
      const snapshot = execute({ queries: [{ sql: "SELECT value FROM research_cache WHERE id=?", params: [`research-audience:${run.id}`] }] })[0].results[0].value;
      const tampered = JSON.parse(snapshot); tampered.publishingProfiles.pop();
      execute({ queries: [{ sql: "UPDATE research_cache SET value=? WHERE id=?", params: [JSON.stringify(tampered), `research-audience:${run.id}`] }] });
      await expect(getFrozenResearchAudience(saved)).rejects.toThrow("captured profiles");
    } finally {
      storageFault = undefined; fetcher.mockRestore(); globalThis.__contentHubResearchWorkflow__ = previousWorkflow;
      if (previousKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = previousKey;
    }
  }, 30_000);
  it.each([false, true])("recovers a failed audience-snapshot setup without stranding the run (scheduled: %s)", async scheduled => {
    const team = `audience-setup-${scheduled}`, seed = RESEARCH_SOURCE_SEEDS.find(source => source.enabled)!;
    const savedAudience = "Original product practitioners and growth decision makers.";
    execute({ queries: [{ sql: "INSERT INTO teams(id,name,slug,created_at,updated_at) VALUES(?,?,?,0,0)", params: [team, team, team] }] });
    await initializeResearch(team);
    execute({ queries: [{ sql: "UPDATE research_settings SET icp=? WHERE team_id=?", params: [savedAudience, team] }] });
    const previousWorkflow = globalThis.__contentHubResearchWorkflow__, dispatch = vi.fn(async () => ({}));
    globalThis.__contentHubResearchWorkflow__ = { create: dispatch };
    const scheduledId = scheduled ? "scheduled-audience-setup" : undefined;
    try {
      let snapshotWrites = 0;
      storageFault = (queries, phase) => {
        if (phase === "before" && queries.some(query => /^insert/i.test(query.sql) && query.params.some(param => typeof param === "string" && param.startsWith("research-audience:")))) {
          snapshotWrites++; throw new Error("Network connection lost.");
        }
      };
      await expect(createResearchRun(team, { days: 7, mode: "collect", sourceIds: [seed.id] }, false, scheduledId)).rejects.toThrow();
      expect(snapshotWrites).toBe(3);
      storageFault = undefined;
      const failed = execute({ queries: [{ sql: "SELECT * FROM research_runs WHERE team_id=?", params: [team] }] })[0].results[0];
      expect(failed.status).toBe(scheduled ? "queued" : "failed");
      expect(dispatch).not.toHaveBeenCalled();
      execute({ queries: [{ sql: "UPDATE research_settings SET icp='Different settings changed after the failed capture' WHERE team_id=?", params: [team] }] });
      const { run } = await createResearchRun(team, { days: 7, mode: "collect", sourceIds: [seed.id] }, false, scheduledId);
      expect(dispatch).toHaveBeenCalledTimes(1);
      if (scheduled) {
        expect(run.id).toBe(failed.id);
        expect((await getFrozenResearchAudience(failed)).generalAudience).toBe(savedAudience);
      } else expect(run.id).not.toBe(failed.id);
    } finally { storageFault = undefined; globalThis.__contentHubResearchWorkflow__ = previousWorkflow; }
  }, 20_000);
  it("preserves each run's qualification through a shared-item rescan and resumed writing", async () => {
    const team = "run-finding-snapshots", oldRun = "qualification-old", newRun = "qualification-new";
    const seed = RESEARCH_SOURCE_SEEDS.find(source => source.enabled && source.kind === "rss" && source.feedUrl)!;
    const now = Date.now(), oldQuote = "The original source explains why teams validate requirements before implementation.";
    const newQuote = "The updated source describes explicit human approval gates before implementing the proposed work.";
    const findingId = await researchHash(`${team}:shared-qualification-item`);
    const sourceUrl = `${new URL(seed.url).origin}/shared-qualification`;
    execute({ queries: [
      { sql: "INSERT INTO teams(id,name,slug,created_at,updated_at) VALUES(?,?,?,0,0)", params: [team, team, team] },
      { sql: "INSERT INTO channels(id,team_id,name,platform,group_name,research_enabled,system_prompt,created_at) VALUES('snapshot-li',?,'Product reasoning','linkedin','custom',1,'Explain concrete product team decisions with attributed source evidence',0)", params: [team] },
      { sql: "INSERT INTO research_runs(id,team_id,mode,status,days,editorial,created_at,icp,source_count,source_ids) VALUES(?,?,'scan','failed',1,1,?,'Product practitioners',1,?)", params: [oldRun, team, now, JSON.stringify([seed.id])] },
      { sql: "INSERT INTO research_runs(id,team_id,mode,status,days,editorial,created_at,icp,source_count,source_ids) VALUES(?,?,'scan','collecting',7,0,?,'Product practitioners',1,?)", params: [newRun, team, now + 1, JSON.stringify([seed.id])] },
      { sql: "INSERT INTO research_run_sources(id,run_id,source_id,status) VALUES('snapshot-collection',?,?,'completed')", params: [newRun, seed.id] },
      ...["shared-qualification-item", "legacy-peer-a", "legacy-peer-b"].map(id => ({
        sql: "INSERT INTO research_items(id,team_id,source_id,canonical_url,title,excerpt,published_at,collected_at,content,content_provenance) VALUES(?,?,?,?,?,?,?,?,?,'article')",
        params: [id, team, id === "shared-qualification-item" ? seed.id : "legacy-source", `${sourceUrl}/${id}`, "Updated source title", newQuote, now - 1000, now, `${oldQuote} ${newQuote} ${"Specific implementation detail and limitations. ".repeat(25)}`],
      })),
      ...[findingId, "legacy-finding-a", "legacy-finding-b"].map((id, index) => ({
        sql: "INSERT INTO research_findings(id,team_id,run_id,item_id,source_id,title,url,published_at,score,summary,why_it_matters,content_angle,evidence,limitations,created_at,family_key,status) VALUES(?,?,?,?,?,'Original source title',?, ?,85,'Original summary','Original implication','Original angle',?,'Original limitations',?,?,'new')",
        params: [id, team, oldRun, ["shared-qualification-item", "legacy-peer-a", "legacy-peer-b"][index], index ? "legacy-source" : seed.id, sourceUrl, now - 2000, oldQuote, now, `old-family-${index}`],
      })),
      { sql: "INSERT INTO research_cache(id,team_id,value,created_at) VALUES(?,?,?,?)", params: [`draft-progress:${oldRun}`, team, JSON.stringify({ candidateIds: [findingId], selectedIds: [findingId], nextOffset: 0, validationSkips: 0, rejectedStories: [], deliveryIds: [], deliveryOffset: 0 }), now] },
    ] });
    await saveResearchFindingSnapshot((await getRunResearchFindings(team, oldRun, ["legacy-finding-a"]))[0]);
    const oldGlobals = execute({ queries: [{ sql: "SELECT * FROM research_findings WHERE id=?", params: [findingId] }] })[0].results[0];
    const previousOpenAI = process.env.OPENAI_API_KEY, previousAnthropic = process.env.ANTHROPIC_API_KEY;
    process.env.OPENAI_API_KEY = "test-snapshot", process.env.ANTHROPIC_API_KEY = "test-snapshot";
    let writingCalls = 0;
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      const input = JSON.parse(request.input ?? request.messages[0].content);
      let value: unknown;
      if (input.items) value = (fixtureResearchSchema(request)).properties.assessments
        ? screeningFixture({ itemIds: ["shared-qualification-item"] }, input.items)
        : { findings: [{ itemId: "shared-qualification-item", score: 88, summary: "Updated summary", whyItMatters: "Updated implication", contentAngle: "Updated angle", evidence: newQuote, limitations: "Updated limitations", familyKey: "new-family" }] };
      else {
        writingCalls++;
        if (writingCalls === 1) {
          expect(input.source).toMatchObject({ title: "Original source title", url: sourceUrl, publishedAt: new Date(now - 2000).toISOString() });
          expect(input.finding).toMatchObject({ summary: "Original summary", contentAngle: "Original angle", evidence: oldQuote });
        } else {
          expect(input.source).toMatchObject({ title: "Drifted later title", url: "https://example.com/new-attribution" });
          expect(input.finding).toMatchObject({ summary: "Drifted summary", contentAngle: "Drifted angle", evidence: newQuote });
        }
        expect(input.priorPosts.find((post: { draftId: string }) => post.draftId === "snapshot-existing-review"))
          .toMatchObject({ title: "Original source title", sourceUrl, familyKey: "old-family-1", findingContentAngle: "Original angle", sourceFact: oldQuote });
        value = { ready: false, reason: "Controlled local decline after verifying original qualification input", targets: [] };
      }
      return modelResponseFixture({ status: "completed", usage: { input_tokens: 10, output_tokens: 5 }, output: [{ content: [{ type: "output_text", text: JSON.stringify(value) }] }] });
    });
    try {
      await finishResearchRankJob(newRun);
      const [oldFinding] = await getRunResearchFindings(team, oldRun, [findingId]);
      const newFindingId = await researchHash(`${team}:shared-qualification-item:angle:new-family`);
      const [newFinding] = await getRunResearchFindings(team, newRun, [newFindingId]);
      expect(oldFinding).toEqual(oldGlobals);
      expect(execute({ queries: [{ sql: 'SELECT * FROM research_findings WHERE id=?', params: [findingId] }] })[0].results).toEqual([oldGlobals]);
      expect(newFinding.id).not.toBe(findingId);
      expect(newFinding).toMatchObject({ run_id: newRun, score: 88, title: "Updated source title", published_at: now - 1000, summary: "Updated summary", content_angle: "Updated angle", evidence: newQuote });
      await saveResearchFindingSnapshot(oldFinding);
      await saveResearchFindingSnapshot({ ...oldFinding, summary: "Do not replace immutable original", score: 1 });
      expect((await getRunResearchFindings(team, oldRun, [findingId]))[0].summary).toBe("Original summary");
      try {
        storageFault = queries => {
          for (const query of queries) expect(query.params.length).toBeLessThanOrEqual(81);
        };
        expect(await getRunResearchFindings(team, oldRun, Array.from({ length: 101 }, () => findingId)))
          .toEqual([oldFinding]);
      } finally { storageFault = undefined; }
      await (state.db as ReturnType<typeof drizzle>).update(schema.research_runs).set({ findings_count: researchRunFindingsCount(team, oldRun) }).where(eq(schema.research_runs.id, oldRun));
      expect(execute({ queries: [{ sql: "SELECT findings_count FROM research_runs WHERE id=?", params: [oldRun] }] })[0].results[0].findings_count).toBe(3);
      execute({ queries: [{ sql: "UPDATE research_findings SET status='dismissed' WHERE id=?", params: [findingId] }] });
      expect((await getRunResearchFindings(team, oldRun, [findingId]))[0]).toMatchObject({ score: 85, status: "dismissed" });
      expect(await getRunResearchFindings("b", oldRun, [findingId])).toEqual([]);
      const previousCopy = JSON.stringify({ targets: [{ channelId: "snapshot-li", platform: "linkedin", content: "Original pending review copy", thread: [] }] });
      execute({ queries: [
        { sql: "INSERT INTO research_drafts(id,team_id,run_id,finding_id,content,status,revision,created_at,updated_at) VALUES('snapshot-existing-review',?,?,'legacy-finding-a',?,'pending',3,?,?)", params: [team, oldRun, previousCopy, now, now] },
        { sql: "UPDATE research_findings SET run_id=?, title='Drifted later title',url='https://example.com/new-attribution',summary='Drifted summary',why_it_matters='Drifted rationale',content_angle='Drifted angle',evidence=?,family_key='drifted-family' WHERE id='legacy-finding-a'", params: [newRun, newQuote] },
      ] });
      const priorReview = (await getResearchSnapshot(team)).drafts.find(draft => draft.id === "snapshot-existing-review");
      expect(priorReview).toMatchObject({ title: "Original source title", sourceUrl, whyItMatters: "Original implication", revision: 3, status: "pending" });
      expect(priorReview?.content.targets[0].content).toBe("Original pending review copy");
      execute({ queries: [{ sql: "UPDATE research_findings SET status='new' WHERE id=?", params: [findingId] }, { sql: "UPDATE research_runs SET status='drafting' WHERE id=?", params: [oldRun] }] });
      await finishResearchDraftJob(oldRun);
      expect(writingCalls).toBe(1);
      expect((await getRunResearchFindings(team, oldRun, [findingId]))[0]).toMatchObject({ score: 85, content_angle: "Original angle", evidence: oldQuote });
      execute({ queries: [
        { sql: "UPDATE research_runs SET status='drafting',days=1,editorial=1 WHERE id=?", params: [newRun] },
        { sql: "INSERT INTO research_cache(id,team_id,value,created_at) VALUES(?,?,?,?)", params: [`draft-progress:${newRun}`, team, JSON.stringify({ candidateIds: ["legacy-finding-a"], selectedIds: ["legacy-finding-a"], nextOffset: 0, validationSkips: 0, rejectedStories: [], deliveryIds: [], deliveryOffset: 0 }), now] },
      ] });
      await finishResearchDraftJob(newRun);
      expect(writingCalls).toBe(2);
      expect(execute({ queries: [{ sql: "SELECT content,revision,status FROM research_drafts WHERE id='snapshot-existing-review'" }] })[0].results)
        .toEqual([{ content: previousCopy, revision: 3, status: "pending" }]);
    } finally {
      fetcher.mockRestore();
      if (previousOpenAI === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previousOpenAI;
      if (previousAnthropic === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = previousAnthropic;
    }
  }, 30_000);
  it("requires both provider keys before starting an editorial scan", async () => {
    const previousWorkflow = globalThis.__contentHubResearchWorkflow__;
    const dispatch = vi.fn(async () => ({}));
    globalThis.__contentHubResearchWorkflow__ = { create: dispatch };
    const runsBefore = execute({ queries: [{ sql: "SELECT id FROM research_runs WHERE team_id='a'" }] })[0].results;
    try {
      vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
      vi.stubEnv("OPENAI_API_KEY", "");
      await expect(createResearchRun("a", { days: 1, mode: "scan" }, true)).rejects.toThrow("OPENAI_API_KEY");
      vi.stubEnv("ANTHROPIC_API_KEY", "");
      vi.stubEnv("OPENAI_API_KEY", "test-key");
      await expect(createResearchRun("a", { days: 1, mode: "scan" }, true)).rejects.toThrow("ANTHROPIC_API_KEY");
      expect(dispatch).not.toHaveBeenCalled();
      expect(execute({ queries: [{ sql: "SELECT id FROM research_runs WHERE team_id='a'" }] })[0].results).toEqual(runsBefore);
    } finally {
      vi.unstubAllEnvs();
      globalThis.__contentHubResearchWorkflow__ = previousWorkflow;
    }
  });
  it("keeps automatic-drafting preferences isolated and skips writing calls during qualification-only scans", async () => {
    const team = "qualification-only", previousWorkflow = globalThis.__contentHubResearchWorkflow__;
    execute({ queries: [{ sql: "INSERT INTO teams(id,name,slug,created_at,updated_at) VALUES(?,?,?,0,0)", params: [team, team, team] }] });
    const dispatch = vi.fn(async () => ({}));
    globalThis.__contentHubResearchWorkflow__ = { create: dispatch };
    vi.stubEnv("ANTHROPIC_API_KEY", "test-research-key");
    vi.stubEnv("OPENAI_API_KEY", "");
    const fetcher = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Unexpected provider or Slack call"));
    try {
      await initializeResearch(team);
      const initial = (await getResearchSnapshot(team)).settings;
      expect(initial.autoDrafts).toBe(true);
      await updateResearchSettings(team, { autoDrafts: false });
      const settings = (await getResearchSnapshot(team)).settings;
      expect(settings).toEqual({ ...initial, autoDrafts: false });
      expect((await getResearchSnapshot("b")).settings.autoDrafts).toBe(true);
      const { run } = await createResearchRun(team, { days: 1, mode: "scan" }, true);
      expect(run.editorial).toBe(false);
      execute({ queries: [{ sql: "UPDATE research_runs SET status='completed' WHERE id=?", params: [run.id] }] });
      expect(await processResearchDraftJob(run.id)).toEqual({ drafted: 0, skipped: true });
      for (const table of ["research_drafts", "research_usage"]) {
        expect(execute({ queries: [{ sql: `SELECT COUNT(*) count FROM ${table} WHERE team_id=?`, params: [team] }] })[0].results[0].count).toBe(0);
      }
      expect(fetcher).not.toHaveBeenCalled();
      await updateResearchSettings(team, { autoDrafts: true });
      await expect(createResearchRun(team, { days: 1, mode: "scan" }, true)).rejects.toThrow("OPENAI_API_KEY");
      vi.stubEnv("OPENAI_API_KEY", "test-writing-key");
      const writing = await createResearchRun(team, { days: 1, mode: "scan" }, true);
      expect(writing.run.editorial).toBe(true);
      await updateResearchSettings(team, { autoDrafts: false });
      expect((await getResearchSnapshot(team)).runs.find(item => item.id === writing.run.id)?.editorial).toBe(true);
      expect(dispatch).toHaveBeenCalledTimes(2);
    } finally {
      fetcher.mockRestore();
      vi.unstubAllEnvs();
      globalThis.__contentHubResearchWorkflow__ = previousWorkflow;
    }
  }, 30_000);
  it('validates explicit source subsets before dispatch and preserves preferences and the all-enabled default', async () => {
    const teamId = 'source-subset';
    const seeds = RESEARCH_SOURCE_SEEDS.filter(source => source.enabled).slice(0, 3);
    execute({ queries: [{ sql: 'INSERT INTO teams(id,name,slug,created_at,updated_at) VALUES(?,?,?,0,0)', params: [teamId, teamId, teamId] }] });
    await initializeResearch(teamId);
    execute({ queries: [
      { sql: 'UPDATE research_sources SET enabled=0 WHERE team_id=? AND seed_id=?', params: [teamId, seeds[2].id] },
      { sql: "UPDATE research_settings SET daily_time='21:51',daily_timezone='Asia/Kolkata',next_daily_at=1793118060000 WHERE team_id=?", params: [teamId] },
    ] });
    const preferences = execute({ queries: [
      { sql: 'SELECT * FROM research_sources WHERE team_id=? ORDER BY id', params: [teamId] },
      { sql: 'SELECT * FROM research_settings WHERE team_id=?', params: [teamId] },
    ] });
    expect(execute({ queries: [{ sql: "SELECT enabled FROM research_sources WHERE team_id='b' AND seed_id=?", params: [seeds[2].id] }] })[0].results[0].enabled).toBe(1);
    const priorWorkflow = globalThis.__contentHubResearchWorkflow__;
    const dispatch = vi.fn(async () => ({}));
    globalThis.__contentHubResearchWorkflow__ = { create: dispatch };
    try {
      for (const ids of [[], [seeds[0].id, seeds[0].id], ['not-a-registered-source'], [seeds[2].id]]) {
        await expect(createResearchRun(teamId, { mode: 'collect', days: 7, sourceIds: ids })).rejects.toThrow();
      }
      expect(dispatch).not.toHaveBeenCalled();
      expect(execute({ queries: [{ sql: 'SELECT id FROM research_runs WHERE team_id=?', params: [teamId] }] })[0].results).toHaveLength(0);
      const sourceIds = [seeds[1].id, seeds[0].id];
      const first = await createResearchRun(teamId, { mode: 'collect', days: 7, sourceIds });
      expect(first.run.sourceCount).toBe(2);
      expect(await processResearchJob({ operation: 'plan', runId: first.run.id })).toEqual({ sourceIds });
      const repeated = await createResearchRun(teamId, { mode: 'collect', days: 7, sourceIds: [...sourceIds].reverse() });
      expect(repeated.run.id).toBe(first.run.id);
      expect(dispatch).toHaveBeenCalledTimes(2);
      await expect(createResearchRun(teamId, { mode: 'collect', sourceIds: [seeds[0].id] })).rejects.toThrow('different sources');
      await expect(createResearchRun(teamId, { mode: 'collect', sourceIds: [seeds[2].id] })).rejects.toThrow('enabled for this team');
      expect(dispatch).toHaveBeenCalledTimes(2);
      await processResearchJob({ operation: 'fail', runId: first.run.id, error: 'Subset verification finished' });
      const all = await createResearchRun(teamId, { mode: 'collect', days: 7 });
      const expectedIds = preferences[0].results.filter((source: { enabled: number; seed_id: string }) => source.enabled && RESEARCH_SOURCE_SEEDS.some(seed => seed.id === source.seed_id)).map((source: { seed_id: string }) => source.seed_id);
      const plan = await processResearchJob({ operation: 'plan', runId: all.run.id });
      expect('sourceIds' in plan ? plan.sourceIds?.slice().sort() : undefined).toEqual(expectedIds.sort());
      expect(all.run.sourceCount).toBe(expectedIds.length);
      expect(execute({ queries: [
        { sql: 'SELECT * FROM research_sources WHERE team_id=? ORDER BY id', params: [teamId] },
        { sql: 'SELECT * FROM research_settings WHERE team_id=?', params: [teamId] },
      ] })).toEqual(preferences);
      await processResearchJob({ operation: 'fail', runId: all.run.id, error: 'Default verification finished' });
    } finally {
      globalThis.__contentHubResearchWorkflow__ = priorWorkflow;
    }
  }, 30_000);

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
  it("routes usable public bodies directly to evidence while screening incomplete sources and retaining negative assessments", async () => {
    const team = "body-routing", runId = "body-routing-run", now = Date.now();
    const seed = RESEARCH_SOURCE_SEEDS.find(source => source.kind === "rss" && source.feedUrl)!;
    const quote = "The team validates the proposed requirements before implementation and keeps the decision context in the repository.";
    const body = `${quote} ${"The public account describes the method and its practical limitations. ".repeat(12)}`;
    const items = [
      ...["article", "public_feed", "abstract", "transcript"].map(provenance => ({ id: `full-${provenance}`, provenance, content: body })),
      { id: "full-off-profile", provenance: "article", content: `A complete account of telescope optics, with no product-team implication. ${body}` },
      { id: "full-promotion", provenance: "public_feed", content: `An unsupported promotional promise, without a concrete mechanism. ${body}` },
      { id: "partial-useful", provenance: "unknown", content: null },
      { id: "partial-reject", provenance: "unknown", content: "General company update." },
    ];
    execute({ queries: [
      { sql: "INSERT INTO teams(id,name,slug,created_at,updated_at) VALUES(?,?,?,0,0)", params: [team, team, team] },
      { sql: "INSERT INTO research_runs(id,team_id,mode,status,days,editorial,created_at,icp,source_count,source_ids) VALUES(?,?,'scan','collecting',7,0,?,'Product practitioners',1,?)", params: [runId, team, now, JSON.stringify([seed.id])] },
      { sql: "INSERT INTO research_run_sources(id,run_id,source_id,status) VALUES(?,?,?,'completed')", params: [`${runId}-step`, runId, seed.id] },
      ...items.map((item, index) => ({
        sql: "INSERT INTO research_items(id,team_id,source_id,canonical_url,title,excerpt,published_at,collected_at,content,content_provenance,content_type,transcript_status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
        params: [item.id, team, seed.id, `${new URL(seed.url).origin}/${item.id}`, item.id, quote, now - (index + 1) * 1000, now, item.content, item.provenance, item.provenance === "transcript" ? "video" : "article", item.provenance === "transcript" ? "available" : "not_applicable"],
      })),
    ] });
    const previousKey = process.env.ANTHROPIC_API_KEY; process.env.ANTHROPIC_API_KEY = "test-routing";
    const screened: string[] = [], assessed: string[] = [];
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      if (String(url) === `${new URL(seed.url).origin}/partial-useful`) return new Response(`<article><p>${body}</p></article>`);
      expect(String(url)).toBe("https://api.anthropic.com/v1/messages");
      const request = JSON.parse(String(init?.body)), input = JSON.parse(request.messages[0].content);
      const value = fixtureResearchSchema(request).properties.assessments
        ? (screened.push(...input.items.map((item: { id: string }) => item.id)), screeningFixture({ itemIds: ["partial-useful"] }, input.items))
        : { findings: input.items.map((item: { id: string; contentProvenance: string }) => {
          assessed.push(item.id);
          const original = items.find(candidate => candidate.id === item.id)!;
          expect(item.contentProvenance).toBe(item.id === "partial-useful" ? "article" : original.provenance);
          return { itemId: item.id, score: item.id === "full-off-profile" ? 20 : item.id === "full-promotion" ? 45 : 85,
            summary: item.id, whyItMatters: "Review the requirements handoff", contentAngle: "Inspect human approval and persisted context", evidence: quote,
            limitations: item.id === "full-off-profile" ? "Outside the product-practitioner audience" : item.id === "full-promotion" ? "Unsupported promotion" : "Descriptive method, no outcome proof", familyKey: item.id };
        }) };
      return modelResponseFixture({ status: "completed", usage: { input_tokens: 10, output_tokens: 5 }, output: [{ content: [{ type: "output_text", text: JSON.stringify(value) }] }] });
    });
    try {
      await finishResearchRankJob(runId);
      expect(screened).toEqual(["partial-useful", "partial-reject"]);
      expect(assessed).toEqual(items.filter(item => item.id !== "partial-reject").map(item => item.id));
      const [run, audit] = execute({ queries: [
        { sql: "SELECT findings_count,diagnostics FROM research_runs WHERE id=?", params: [runId] },
        { sql: "SELECT value FROM research_cache WHERE id=?", params: [`research-routing:${runId}:0`] },
      ] }).map((result: { results: any[] }) => result.results[0]);
      expect(run.findings_count).toBe(5);
      expect(JSON.parse(run.diagnostics)).toMatchObject({ eligibleCount: 8, routedCount: 8, directEvidenceCount: 6, screenedCount: 2, incompleteScreenedCount: 2, routingUnavailableCount: 0, shortlistedCount: 7, evidenceCount: 7,
        rejectedStories: expect.arrayContaining([{ title: "full-off-profile", score: 20, reason: "Outside the product-practitioner audience" }, { title: "full-promotion", score: 45, reason: "Unsupported promotion" }]) });
      expect(JSON.parse(audit.value).decisions.map((decision: { route: string }) => decision.route)).toEqual([...Array(6).fill("direct_evidence"), "metadata_screen", "metadata_screen"]);
      expect(JSON.parse(audit.value).screenInput.map((item: { id: string }) => item.id)).toEqual(screened);
      const calls = fetcher.mock.calls.length;
      await finishResearchRankJob(runId);
      expect(fetcher).toHaveBeenCalledTimes(calls);
    } finally { fetcher.mockRestore(); if (previousKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = previousKey; }
  }, 30_000);
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
        const value = fixtureResearchSchema(request).properties.assessments
          ? { itemIds: selected }
          : { findings: selected.map((id, index) => ({ itemId: id, score: index ? 75 : 85, summary: "A documented account creation decision", whyItMatters: "Optional consent should not block signup", contentAngle: "Audit authentication paths", evidence, limitations: "A first-party descriptive account, not a conversion experiment", familyKey: id })) };
        return modelResponseFixture({ status: "completed", usage: { input_tokens: 100, output_tokens: 50 }, output: [{ content: [{ type: "output_text", text: JSON.stringify(screeningFixture(value, input.items)) }] }] });
      });
      await processResearchJob({ operation: "rank", runId: run.id });
      await processResearchJob({ operation: "drafts", runId: run.id });
      const snapshot = await getResearchSnapshot("weekly-window");
      expect(snapshot.runs.find(row => row.id === run.id)).toMatchObject({ status: "completed", days: 7, editorial: false, diagnostics: { eligibleCount: 2, routedCount: 2, directEvidenceCount: 2, screenedCount: 0, undatedCount: 1 } });
      expect(snapshot.findings.map(row => row.itemId).sort()).toEqual([...selected].sort());
      expect(snapshot.drafts).toEqual([]);
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally {
      fetcher?.mockRestore();
      if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previousKey;
      if (previousAnthropicKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = previousAnthropicKey;
    }
  }, 20_000);
  it("rehydrates cached Pew publisher chrome while preserving dates, first-seen identity, and usable bodies", async () => {
    const team = "pew-cached-body", now = Date.now();
    const seed = RESEARCH_SOURCE_SEEDS.find(source => source.id === "pew-ai-original-research")!;
    const base = "https://www.pewresearch.org/short-reads/2026/10/23/";
    const title = "A public AI research study";
    const urls = [`${base}jobs-study`, `${base}usage-study`, canonicalResearchUrl(seed.backfillUrls![0])];
    const firstSeen = now - 1000, originalDate = now - 2 * 86_400_000;
    const cleanBody = "The researchers describe the sampling decisions, the observed comparison, and limitations of this study. ".repeat(7).trim();
    const stale = [
      `Short Reads | October 23, 2026 ${title} X Threads WhatsApp Facebook LinkedIn ${"Nicole Smith is a senior researcher studying technology at Pew Research Center. ".repeat(10)}`,
      `The researchers describe how respondents reported their use of these tools. data-wp-context="${"serialized chart configuration ".repeat(25)}"`,
      cleanBody,
    ];
    globalThis.__contentHubResearchWorkflow__ = { create: vi.fn(async () => ({})) };
    execute({ queries: [{ sql: "INSERT INTO teams(id,name,slug,created_at,updated_at) VALUES(?,?,?,0,0)", params: [team, team, team] }] });
    await initializeResearch(team);
    execute({ queries: [
      { sql: "UPDATE research_sources SET enabled=0 WHERE team_id=?", params: [team] },
      { sql: "UPDATE research_sources SET enabled=1 WHERE team_id=? AND seed_id=?", params: [team, seed.id] },
      ...urls.map((url, index) => ({
        sql: "INSERT INTO research_items(id,team_id,source_id,canonical_url,title,excerpt,published_at,collected_at,content,content_provenance) VALUES(?,?,?,?,?,'',?,?,?,'article')",
        params: [`pew-cached-${index}`, team, seed.id, url, title, originalDate, firstSeen, stale[index]],
      })),
    ] });
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async input => {
      const url = new URL(String(input));
      if (url.href === seed.url) return new Response(urls.slice(0, 2).map(href => `<a href="${href}">${title}</a>`).join(""));
      expect(url.pathname).toBe("/wp-json/wp/v2/short-read");
      const slug = url.searchParams.get("slug")!;
      expect(["jobs-study", "usage-study"]).toContain(slug);
      return Response.json([{
        status: "publish", type: "short-read", categories: [299], link: `${base}${slug}/`,
        date_gmt: new Date(originalDate).toISOString().slice(0, 19),
        title: { rendered: title }, content: { protected: false, rendered: `<p>${cleanBody}</p>` },
      }]);
    });
    try {
      const { run } = await createResearchRun(team, { mode: "collect", days: 7 });
      await processResearchJob({ operation: "collect", runId: run.id, sourceId: seed.id });
      expect(fetcher).toHaveBeenCalledTimes(3);
      const rows = execute({ queries: [{ sql: "SELECT id,canonical_url,published_at,collected_at,content FROM research_items WHERE team_id=? ORDER BY id", params: [team] }] })[0].results;
      expect(rows).toEqual(urls.map((url, index) => ({ id: `pew-cached-${index}`, canonical_url: url, published_at: originalDate, collected_at: firstSeen, content: cleanBody })));
    } finally { fetcher.mockRestore(); }
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
  it.each(['rate_limit_exceeded', 'insufficient_quota', 'unknown_rejection'])('freezes writing history across an explicitly rejected repair and only continues known temporary limits: %s', async code => {
    const teamId = `writing-limit-${code}`;
    const runId = `${teamId}-run`;
    const now = Date.now();
    const quote = 'The team moved account setup after the first preview so users could inspect the output first.';
    execute({ queries: [
      { sql: 'INSERT INTO teams(id,name,slug,created_at,updated_at) VALUES(?,?,?,0,0)', params: [teamId, teamId, teamId] },
      { sql: "INSERT INTO channels(id,team_id,name,platform,group_name,research_enabled,system_prompt,created_at) VALUES(?,?,'Personal','twitter','personal',1,'Explain specific product decisions and useful practitioner tests.',0)", params: [`${teamId}-x`, teamId] },
      ...['prior', 'current'].map(kind => ({ sql: 'INSERT INTO research_runs(id,team_id,mode,status,days,editorial,created_at,icp,source_ids) VALUES(?,?,?,?,1,1,?,?,?)', params: [kind === 'prior' ? `${teamId}-prior-run` : runId, teamId, 'scan', kind === 'prior' ? 'completed' : 'drafting', now, 'Product teams', JSON.stringify(['limit-source'])] })),
      ...['prior', 'current'].flatMap(kind => [
        { sql: 'INSERT INTO research_items(id,team_id,source_id,canonical_url,title,excerpt,published_at,collected_at,content,content_provenance) VALUES(?,?,?,?,?,?,?,?,?,?)', params: [`${teamId}-${kind}-item`, teamId, 'limit-source', `https://example.com/${teamId}-${kind}`, 'Preview onboarding setup choices', quote, now - 1000, now, quote.repeat(10), 'article'] },
        { sql: 'INSERT INTO research_findings(id,team_id,run_id,item_id,source_id,title,url,published_at,score,summary,why_it_matters,content_angle,evidence,limitations,created_at,family_key) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', params: [`${teamId}-${kind}-finding`, teamId, kind === 'prior' ? `${teamId}-prior-run` : runId, `${teamId}-${kind}-item`, 'limit-source', 'Preview onboarding setup choices', `https://example.com/${teamId}-${kind}`, now - 1000, 90, 'Preview precedes setup.', 'Commitment follows useful output.', 'Inspect the first-preview path before asking for setup.', quote, 'Reported workflow, no conversion result.', now, `${teamId}-${kind}-family`] },
      ]),
      { sql: 'INSERT INTO research_drafts(id,team_id,run_id,finding_id,content,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)', params: [`${teamId}-prior-draft`, teamId, `${teamId}-prior-run`, `${teamId}-prior-finding`, JSON.stringify({ targets: [{ channelId: `${teamId}-x`, platform: 'twitter', content: 'Use onboarding preview feedback to identify who owns the setup guidance.', thread: [] }] }), 'draft', now - 1000, now - 1000] },
    ] });
    const previousKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'test-frozen-writing';
    let draftCalls = 0, repairCalls = 0, reviewCalls = 0;
    const requests: unknown[] = [];
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const input = JSON.parse(JSON.parse(String(init?.body)).input);
      requests.push(input);
      expect(input.priorPosts).toHaveLength(1);
      expect(input.priorPosts[0]).toMatchObject({ draftId: `${teamId}-prior-draft`, status: 'draft' });
      if (input.proposed) { reviewCalls++; return editorialReviewFixture(); }
      if (input.previousInvalidResponse) {
        repairCalls++;
        expect(input.validationError).toContain('281 characters');
        if (repairCalls === 1) return Response.json({ error: { code, message: 'Private provider detail must not be retained.' } }, { status: 429, headers: { 'retry-after': '59' } });
      } else draftCalls++;
      const content = input.previousInvalidResponse ? `Inspect the preview before asking for account setup. Source: ${input.source.url}` : `${'x'.repeat(257)} ${input.source.url}`;
      return modelResponseFixture({ status: 'completed', usage: { input_tokens: 20, output_tokens: 10 }, output: [{ content: [{ type: 'output_text', text: JSON.stringify({ ready: true, reason: 'A bounded first-preview decision.', editorial: editorialFixture(quote), targets: [{ channelId: `${teamId}-x`, platform: 'twitter', content, thread: [], supportQuote: quote, redditTitle: null, subreddit: null }] }) }] }] });
    });
    try {
      if (code !== 'rate_limit_exceeded') {
        await expect(processResearchDraftJob(runId)).rejects.toThrow('HTTP 429');
      } else expect(await processResearchDraftJob(runId)).toEqual({ drafted: 0, pending: true, retryAfterMs: 60000 });
      const [savedInput, progress] = execute({ queries: [
        { sql: "SELECT value FROM research_cache WHERE team_id=? AND id LIKE 'research-writing-input:%'", params: [teamId] },
        { sql: 'SELECT value FROM research_cache WHERE id=?', params: [`draft-progress:${runId}`] },
      ] }).map((result: { results: unknown[] }) => result.results[0]);
      expect(JSON.parse(progress.value)).toMatchObject({ nextOffset: 0, validationSkips: 0 });
      expect(JSON.parse(savedInput.value).priorPosts[0].status).toBe('draft');
      expect(draftCalls).toBe(1);
      expect(repairCalls).toBe(1);
      expect(fetcher).toHaveBeenCalledTimes(2);
      if (code !== 'rate_limit_exceeded') return;
      execute({ queries: [{ sql: "UPDATE research_drafts SET status='pending',updated_at=? WHERE id=?", params: [now + 1000, `${teamId}-prior-draft`] }] });
      expect(await processResearchDraftJob(runId)).toEqual({ drafted: 1 });
      expect(draftCalls).toBe(1);
      expect(repairCalls).toBe(2);
      expect(reviewCalls).toBe(1);
      expect(fetcher).toHaveBeenCalledTimes(4);
      expect(requests[1]).toEqual(requests[2]);
      expect(execute({ queries: [{ sql: "SELECT value FROM research_cache WHERE team_id=? AND id LIKE 'research-writing-input:%'", params: [teamId] }] })[0].results).toEqual([{ value: savedInput.value }]);
      const [drafts, revisions, run, usage] = execute({ queries: [
        { sql: 'SELECT COUNT(*) count FROM research_drafts WHERE run_id=?', params: [runId] },
        { sql: 'SELECT COUNT(*) count FROM research_draft_revisions WHERE team_id=?', params: [teamId] },
        { sql: 'SELECT cache_hits FROM research_runs WHERE id=?', params: [runId] },
        { sql: 'SELECT operation,status FROM research_usage WHERE run_id=? ORDER BY created_at', params: [runId] },
      ] }).map((result: { results: unknown[] }) => result.results);
      expect(drafts).toEqual([{ count: 1 }]);
      expect(revisions).toEqual([{ count: 1 }]);
      expect(run).toEqual([{ cache_hits: 1 }]);
      expect(usage).toEqual([{ operation: 'draft', status: 'completed' }, { operation: 'draft_repair', status: 'http_429' }, { operation: 'draft_repair', status: 'completed' }, { operation: 'editorial_review', status: 'completed' }]);
    } finally {
      fetcher.mockRestore();
      if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previousKey;
    }
  }, 30_000);

  it.each(['committed reply lost', 'checkpoint outage'])('persists writing once through storage failure without repeating paid requests: %s', async mode => {
    const teamId = mode === 'committed reply lost' ? 'writing-storage-committed' : 'writing-storage-outage';
    const runId = `${teamId}-run`;
    const now = Date.now();
    const quote = 'The team moved account setup after the first preview so users could inspect the output first.';
    execute({ queries: [
      { sql: 'INSERT INTO teams(id,name,slug,created_at,updated_at) VALUES(?,?,?,0,0)', params: [teamId, teamId, teamId] },
      { sql: "INSERT INTO channels(id,team_id,name,platform,group_name,research_enabled,system_prompt,created_at) VALUES(?,?,'Personal','linkedin','personal',1,'Explain specific product decisions and useful practitioner tests.',0)", params: [`${teamId}-li`, teamId] },
      { sql: "INSERT INTO research_runs(id,team_id,mode,status,days,editorial,created_at,icp,source_ids) VALUES(?,?,'scan','drafting',1,1,?,'Product teams',?)", params: [runId, teamId, now, JSON.stringify(['writing-storage-source'])] },
      { sql: 'INSERT INTO research_items(id,team_id,source_id,canonical_url,title,excerpt,published_at,collected_at,content,content_provenance) VALUES(?,?,?,?,?,?,?,?,?,?)', params: [`${teamId}-item`, teamId, 'writing-storage-source', `https://example.com/${teamId}`, 'Inspect the first preview before setup', quote, now - 1000, now, quote.repeat(10), 'article'] },
      { sql: 'INSERT INTO research_findings(id,team_id,run_id,item_id,source_id,title,url,published_at,score,summary,why_it_matters,content_angle,evidence,limitations,created_at,family_key) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', params: [`${teamId}-finding`, teamId, runId, `${teamId}-item`, 'writing-storage-source', 'Inspect the first preview before setup', `https://example.com/${teamId}`, now - 1000, 90, 'Preview precedes setup.', 'Commitment follows useful output.', 'Inspect the first-preview path before asking for setup.', quote, 'Reported workflow, no conversion result.', now, teamId] },
    ] });
    const priorKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'test-writing-storage';
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const input = JSON.parse(JSON.parse(String(init?.body)).input);
      if (input.proposed) return editorialReviewFixture();
      return modelResponseFixture({ status: 'completed', usage: { input_tokens: 20, output_tokens: 10 }, output: [{ content: [{ type: 'output_text', text: JSON.stringify({ ready: true, reason: 'A bounded first-preview decision.', editorial: editorialFixture(quote), targets: [{ channelId: `${teamId}-li`, platform: 'linkedin', content: `Show users an inspectable output before asking for account setup. Audit whether the setup step needs information that the first preview has not yet given them. Source: ${input.source.url}`, thread: [], supportQuote: quote, redditTitle: null, subreddit: null }] }) }] }] });
    });
    const writes = new Map<string, unknown[][]>();
    storageFault = (queries, phase) => {
      let kind: string | undefined;
      const cache = queries.find(query => query.sql.startsWith('insert into "research_cache"') && query.params.includes(teamId));
      if (cache?.params.some(param => typeof param === 'string' && /^[a-f0-9]{64}$/.test(param))) kind = cache.params.some(param => typeof param === 'string' && param.includes('"verdict":"ready"')) ? 'editorial-cache' : 'draft-cache';
      if (queries.some(query => query.sql.startsWith('insert into "research_drafts"'))) kind = 'draft-revision';
      if (cache?.params.includes(`draft-progress:${runId}`) && cache.params.some(param => typeof param === 'string' && param.includes('"nextOffset":1'))) kind = 'checkpoint';
      if (queries.some(query => query.sql.startsWith('update "research_runs"') && query.params.includes('completed'))) kind = 'completion';
      if (!kind || phase !== (mode === 'checkpoint outage' && kind === 'checkpoint' ? 'before' : 'after')) return;
      const attempts = writes.get(kind) || [];
      attempts.push(queries.map(query => ({ sql: query.sql, params: [...query.params] })));
      writes.set(kind, attempts);
      if (mode === 'checkpoint outage' && kind === 'checkpoint') throw new Error('D1_ERROR: Network connection lost.');
      if (mode === 'committed reply lost' && attempts.length === 1) throw new Error('Network connection lost.');
    };
    try {
      if (mode === 'checkpoint outage') {
        await expect(processResearchDraftJob(runId)).rejects.toThrow('Network connection lost');
        expect(writes.get('checkpoint')).toHaveLength(3);
        expect(execute({ queries: [{ sql: 'SELECT COUNT(*) count FROM research_cache WHERE team_id=? AND length(id)=64', params: [teamId] }] })[0].results[0].count).toBe(2);
        const saved = execute({ queries: [{ sql: 'SELECT value FROM research_cache WHERE id=?', params: [`draft-progress:${runId}`] }] })[0].results[0];
        expect(JSON.parse(saved.value).nextOffset).toBe(0);
        storageFault = undefined;
      }
      expect(await processResearchDraftJob(runId)).toEqual({ drafted: 1 });
      expect(fetcher).toHaveBeenCalledTimes(2);
      const [draftCount, revisionCount, cacheCount, checkpoint, run, usage, reviewJobs] = execute({ queries: [
        { sql: 'SELECT COUNT(*) count FROM research_drafts WHERE run_id=?', params: [runId] },
        { sql: 'SELECT COUNT(*) count FROM research_draft_revisions WHERE team_id=?', params: [teamId] },
        { sql: 'SELECT COUNT(*) count FROM research_cache WHERE team_id=? AND length(id)=64', params: [teamId] },
        { sql: 'SELECT value FROM research_cache WHERE id=?', params: [`draft-progress:${runId}`] },
        { sql: 'SELECT status,diagnostics,input_tokens,output_tokens FROM research_runs WHERE id=?', params: [runId] },
        { sql: 'SELECT COUNT(*) count FROM research_usage WHERE run_id=?', params: [runId] },
        { sql: "SELECT COUNT(*) count FROM slack_jobs WHERE team_id=? AND kind='review'", params: [teamId] },
      ] }).map((result: { results: unknown[] }) => result.results[0]);
      expect(draftCount.count).toBe(1);
      expect(revisionCount.count).toBe(1);
      expect(cacheCount.count).toBe(2);
      expect(usage.count).toBe(2);
      expect(reviewJobs.count).toBe(1);
      expect(JSON.parse(checkpoint.value)).toMatchObject({ nextOffset: 1, deliveryOffset: 1 });
      expect(JSON.parse(run.diagnostics)).toMatchObject({ draftCandidatesCount: 1, draftedCount: 1 });
      expect(run).toMatchObject({ status: 'completed', input_tokens: 30, output_tokens: 15 });
      for (const [kind, attempts] of writes) {
        const retryCount = mode === 'checkpoint outage' && kind === 'checkpoint' ? 3 : mode === 'committed reply lost' ? 2 : 1;
        expect(attempts.length).toBeGreaterThanOrEqual(retryCount);
        expect(attempts.slice(0, retryCount).every(value => JSON.stringify(value) === JSON.stringify(attempts[0]))).toBe(true);
      }
      if (mode === 'committed reply lost') expect([...writes.keys()].sort()).toEqual(['checkpoint', 'completion', 'draft-cache', 'draft-revision', 'editorial-cache']);
    } finally {
      storageFault = undefined;
      fetcher.mockRestore();
      if (priorKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = priorKey;
    }
  }, 30_000);

  it('retrieves legacy and current-run novelty history across family aliases while excluding an edit from its own history', async () => {
    const teamId = 'novelty-history';
    const now = Date.now();
    const quote = 'Lock navigation to one flow for a hypothesis test, then open exploration for feedback.';
    const body = `${quote} Review the PRD before engineering handoff. Each annotation includes the element, code location and intent.`;
    const legacyCopy = `Reddit Proto uses realistic signed-in data. ${'Implementation context matters. '.repeat(70)} Review the PRD and engineering-readiness checkpoints before handing off the realistic prototype.`;
    const itemQueries = ['legacy', 'navigation', 'handoff'].flatMap((name, index) => [
      { sql: 'INSERT INTO research_items(id,team_id,source_id,canonical_url,title,excerpt,published_at,collected_at,content,content_provenance) VALUES(?,?,?,?,?,?,?,?,?,?)', params: [`novelty-${name}-item`, teamId, 'novelty-source', `https://example.com/novelty-${name}`, `Reddit Proto ${name}`, quote, now - 1000, now, body, 'article'] },
      { sql: 'INSERT INTO research_findings(id,team_id,run_id,item_id,source_id,title,url,published_at,score,summary,why_it_matters,content_angle,evidence,limitations,created_at,family_key) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', params: [`novelty-${name}-finding`, teamId, name === 'legacy' ? 'novelty-earlier-run' : 'novelty-current-run', `novelty-${name}-item`, 'novelty-source', `Reddit Proto ${name}`, `https://example.com/novelty-${name}`, now - 1000, 99 - index, 'Realistic prototypes, reviewed PRDs and engineering-readiness checkpoints.', 'Choose a concrete prototype review procedure.', name === 'navigation' ? 'Lock navigation for a hypothesis test; open exploration for feedback.' : 'Review the specification before engineering handoff.', quote, 'Reported practitioner workflow, no measured outcomes.', now, `different-alias-${name}`] },
    ]);
    execute({ queries: [
      { sql: 'INSERT INTO teams(id,name,slug,created_at,updated_at) VALUES(?,?,?,0,0)', params: [teamId, teamId, teamId] },
      { sql: "INSERT INTO channels(id,team_id,name,platform,group_name,research_enabled,system_prompt,created_at) VALUES('novelty-li',?,'Personal','linkedin','personal',1,'Write concrete product research lessons for practitioners.',0)", params: [teamId] },
      { sql: "INSERT INTO research_runs(id,team_id,mode,status,days,editorial,created_at,icp,source_ids) VALUES('novelty-earlier-run',?,'scan','completed',1,1,?,'Product teams',?)", params: [teamId, now - 86400000, JSON.stringify(['novelty-source'])] },
      { sql: "INSERT INTO research_runs(id,team_id,mode,status,days,editorial,created_at,icp,source_ids) VALUES('novelty-current-run',?,'scan','drafting',1,1,?,'Product teams',?)", params: [teamId, now, JSON.stringify(['novelty-source'])] },
      ...itemQueries,
      { sql: "INSERT INTO research_drafts(id,team_id,run_id,finding_id,content,status,created_at,updated_at) VALUES('novelty-legacy-draft',?,'novelty-earlier-run','novelty-legacy-finding',?,'draft',?,?)", params: [teamId, JSON.stringify({ targets: [{ channelId: 'novelty-li', platform: 'linkedin', content: legacyCopy, thread: [] }] }), now - 86400000, now - 86400000] },
    ] });
    const priorKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'test-novelty';
    let generationCalls = 0;
    let reviewCalls = 0;
    let observedCurrentRun = false;
    let observedOwnEditExclusion = false;
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      const input = JSON.parse(request.input);
      const legacy = input.priorPosts.find((post: { draftId: string }) => post.draftId === 'novelty-legacy-draft');
      expect(legacy).toMatchObject({ identityGroupIds: ['group:personal'], legacyWithoutEditorial: true, readerDecision: null, status: 'draft', copyExcerpt: expect.stringContaining('engineering-readiness checkpoints') });
      if (input.proposed) {
        reviewCalls++;
        return editorialReviewFixture();
      }
      generationCalls++;
      if (input.current) {
        observedOwnEditExclusion = true;
        expect(input.priorPosts.map((post: { draftId: string }) => post.draftId)).toEqual(['novelty-legacy-draft']);
      } else if (input.source.title.endsWith('handoff')) {
        observedCurrentRun = true;
        expect(input.priorPosts).toEqual(expect.arrayContaining([expect.objectContaining({ runId: 'novelty-current-run', readerDecision: expect.stringContaining('Lock navigation') })]));
        return modelResponseFixture({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify({ ready: false, reason: 'The prior reviewed-PRD decision already covers this specification-before-handoff point; different family keys do not add a decision.', editorial: null, targets: [] }) }] }] });
      } else expect(input.priorPostRetrieval).toMatchObject({ scannedCount: 1, includedCount: 1 });
      const point = 'Lock navigation to one flow for a hypothesis test; open exploration for feedback so the review procedure matches the question.';
      return modelResponseFixture({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify({ ready: true, reason: 'A distinct review procedure is supported.', editorial: { ...editorialFixture(body), readerDecision: point }, targets: [{ channelId: 'novelty-li', platform: 'linkedin', content: `${point} Source: ${input.source.url}`, thread: [], supportQuote: quote, redditTitle: null, subreddit: null }] }) }] }] });
    });
    try {
      expect(await finishResearchDraftJob('novelty-current-run')).toEqual({ drafted: 1 });
      const drafts = execute({ queries: [{ sql: "SELECT id FROM research_drafts WHERE run_id='novelty-current-run'" }] })[0].results;
      expect(drafts).toHaveLength(1);
      expect(observedCurrentRun).toBe(true);
      await rewriteResearchDraftContent(drafts[0].id, teamId, 'Clarify the review procedure while preserving its supported distinction.');
      expect(observedOwnEditExclusion).toBe(true);
      expect(generationCalls).toBe(3);
      expect(reviewCalls).toBe(2);
      expect(fetcher).toHaveBeenCalledTimes(5);
    } finally {
      fetcher.mockRestore();
      if (priorKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = priorKey;
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
  it("saves distinct quote-valid ideas per item with stable family IDs and preserves an earlier family's saved idea and pending review", async () => {
    const team = 'distinct-idea-integration', itemId = `${team}-item`, now = Date.now();
    const seed = RESEARCH_SOURCE_SEEDS.find(source => source.kind === 'rss' && source.feedUrl)!;
    const quotes = [
      'The team reviews the consent requirements before changing the signup flow.',
      'A separate preview lets users inspect useful output before connecting their data.',
      'An explicit confirmation gate keeps the final publication under human control.',
    ];
    const sourceBody = (firstQuote: string) => `Finding 1: An explicit user control\n\n${(firstQuote + ' ').repeat(10)}\n\nFinding 2: An inspectable preview\n\n${(quotes[1] + ' ').repeat(10)}`;
    const runIds = [`${team}-first`, `${team}-second`];
    const profiles = [
      { id: 'company-linkedin', platform: 'linkedin', groupName: 'company' },
      { id: 'company-twitter', platform: 'twitter', groupName: 'company' },
      { id: 'personal-twitter', platform: 'twitter', groupName: 'personal' },
      { id: 'personal-linkedin', platform: 'linkedin', groupName: 'personal' },
    ].map(profile => ({ ...profile, name: profile.id, systemPrompt: profile.groupName === 'company'
      ? 'Select only documented releases and adoption lessons from our own named product.'
      : 'Select independent product-builder workflow, growth, distribution and judgment decisions.' }));
    const capturedIcp = `Product teams\n\nPublishing profiles: ${JSON.stringify(profiles)}`;
    execute({ queries: [
      { sql: 'INSERT INTO teams(id,name,slug,created_at,updated_at) VALUES(?,?,?,0,0)', params: [team, team, team] },
      ...runIds.map((id, index) => ({
        sql: "INSERT INTO research_runs(id,team_id,mode,status,days,editorial,created_at,icp,source_count,source_ids) VALUES(?,?,'scan',?,1,0,?,?,1,?)", params: [id, team, index === 0 ? 'collecting' : 'completed', now + index, capturedIcp, JSON.stringify([seed.id])],
      })),
      ...runIds.map(id => ({ sql: "INSERT INTO research_run_sources(id,run_id,source_id,status) VALUES(?,?,?,'completed')", params: [`${id}:${seed.id}`, id, seed.id] })),
      { sql: "INSERT INTO research_items(id,team_id,source_id,canonical_url,title,excerpt,published_at,collected_at,content,content_provenance) VALUES(?,?,?,?,?,?,?,?,?,'article')", params: [itemId, team, seed.id, `${new URL(seed.url).origin}/distinct-decision-report`, 'Independently supported workflow decisions', quotes[0], now - 1000, now, sourceBody(quotes[0])] },
    ] });
    const idea = (familyKey: string, evidence: string, suppliedProfiles: Array<{ id: string; groupName: string }>) => ({
      familyKey, evidence, claimBasis: 'described_method',
      profileChecks: suppliedProfiles.map(profile => ({ profileId: profile.id,
        fits: profile.id === 'personal-linkedin', relevance: profile.id === 'personal-linkedin' ? 27 : profile.groupName === 'company' ? 30 : 8,
        reason: profile.id === 'personal-linkedin' ? 'A concrete independent product-builder decision fits this personal profile.' : 'This specific decision does not fit this profile’s captured selection remit.',
      })),
      qualityComponents: { sourceSupport: 'supported_bounded_claim', usefulDecision: 'concrete_decision', scopeHonesty: 'accurately_bounded' },
      summary: familyKey, contentAngle: `Inspect ${familyKey} before adopting this workflow.`,
      whyItMatters: 'A separate practical product-team decision.', limitations: 'A practitioner account; no measured uplift.',
    });
    const previousKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'test-distinct-ideas';
    let calls = 0;
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      expect(String(url)).toBe('https://api.anthropic.com/v1/messages');
      const request = JSON.parse(String(init?.body)), input = JSON.parse(request.messages[0].content);
      expect(input.items.map((item: { id: string }) => item.id)).toEqual([itemId]);
      expect(input.publishingProfiles.map((profile: { id: string }) => profile.id)).toEqual(profiles.map(profile => profile.id));
      for (const profile of input.publishingProfiles) {
        expect(profile.selectionInstructions).toBe(profiles.find(captured => captured.id === profile.id)?.systemPrompt);
        expect(profile).not.toHaveProperty('systemPrompt');
      }
      expect(fixtureResearchSchema(request).$defs.profileCheck.properties.profileId.enum).toEqual(profiles.map(profile => profile.id));
      expect(input.items[0].sourceSections).toHaveLength(2);
      expect(fixtureResearchSchema(request).$defs.sourceAssessment.required).toContain('sectionChecks');
      const primary = ++calls === 1 ? idea('consent-review', quotes[0], input.publishingProfiles) : idea('publication-confirmation', quotes[2], input.publishingProfiles);
      const additional = idea('preview-before-connection', quotes[1], input.publishingProfiles);
      for (const assessment of [primary, additional]) {
        for (const derived of ['score', 'chosenProfileId', 'profileFit']) expect(assessment).not.toHaveProperty(derived);
      }
      const nested = (assessment: typeof primary) => {
        const { summary, evidence, contentAngle, whyItMatters, limitations, ...decision } = assessment;
        return { ...decision, claim: { summary, evidence, contentAngle, whyItMatters, limitations } };
      };
      expect(request).not.toHaveProperty('tools');
      expect(request.output_config.format.schema.properties.findings.required).toEqual([itemId]);
      return Response.json({ id: `msg-distinct-${calls}`, model: 'claude-haiku-5-5', stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 }, content: [{ type: 'text', text: JSON.stringify({ findings: { [itemId]: { ...nested(primary), additionalIdeas: [nested(additional)], sectionChecks: input.items[0].sourceSections.map((section: { id: string }, index: number) => ({ sectionId: section.id, familyKeys: [index === 0 ? primary.familyKey : additional.familyKey], notPostworthyReason: '' })) } } }) }] });
    });
    try {
      await finishResearchRankJob(runIds[0]);
      const firstId = await researchHash(`${team}:${itemId}`), secondId = await researchHash(`${team}:${itemId}:angle:preview-before-connection`);
      const first = await getRunResearchFindings(team, runIds[0]);
      expect(first.map(finding => finding.id).sort()).toEqual([firstId, secondId].sort());
      expect(first.map(finding => finding.score)).toEqual([97, 97]);
      expect(first.map(finding => finding.evidence).sort()).toEqual(quotes.slice(0, 2).sort());
      expect((await processResearchJob({ operation: 'rank', runId: runIds[0] }))).toEqual({ sourceIds: [], done: true });
      expect(calls).toBe(1);
      const saved = await actOnResearchFinding(team, { id: firstId, action: 'save_idea' });
      execute({ queries: [
        { sql: "INSERT INTO research_drafts(id,team_id,run_id,finding_id,content,status,revision,slack_channel_id,slack_thread_ts,slack_message_ts,snapshot_hash,created_at,updated_at) VALUES(?,?,?,?,'{\"targets\":[]}','pending',4,'C-PENDING','123.456','123.789','unchanged-snapshot',?,?)", params: [`${team}-review`, team, runIds[0], firstId, now, now] },
        { sql: "INSERT INTO research_draft_revisions(id,team_id,draft_id,revision,content,instruction,slack_user_id,created_at) VALUES(?,?,?,4,'Exact approved-for-review copy','Keep this decision','U-REVIEWER',?)", params: [`${team}-revision`, team, `${team}-review`, now] },
      ] });
      const prior = execute({ queries: [
        { sql: 'SELECT * FROM research_findings WHERE id=?', params: [firstId] },
        { sql: 'SELECT * FROM research_drafts WHERE team_id=?', params: [team] },
        { sql: 'SELECT * FROM research_draft_revisions WHERE team_id=?', params: [team] },
        { sql: 'SELECT * FROM ideas WHERE id=?', params: ['ideaId' in saved ? saved.ideaId : ''] },
      ] }).map((result: { results: unknown[] }) => result.results);
      execute({ queries: [
        { sql: "UPDATE research_runs SET status='collecting' WHERE id=?", params: [runIds[1]] },
        { sql: 'UPDATE research_items SET content=? WHERE id=?', params: [sourceBody(quotes[2]), itemId] },
      ] });
      await finishResearchRankJob(runIds[1]);
      const newPrimaryId = await researchHash(`${team}:${itemId}:angle:publication-confirmation`);
      const second = await getRunResearchFindings(team, runIds[1]);
      expect(second.map(finding => finding.id).sort()).toEqual([newPrimaryId, secondId].sort());
      expect(second.map(finding => finding.score)).toEqual([97, 97]);
      expect(second.find(finding => finding.id === newPrimaryId)).toMatchObject({ status: 'new', idea_id: null, family_key: 'publication-confirmation' });
      expect(second.find(finding => finding.id === secondId)?.created_at).toBe(first.find(finding => finding.id === secondId)?.created_at);
      expect(execute({ queries: [
        { sql: 'SELECT * FROM research_findings WHERE id=?', params: [firstId] },
        { sql: 'SELECT * FROM research_drafts WHERE team_id=?', params: [team] },
        { sql: 'SELECT * FROM research_draft_revisions WHERE team_id=?', params: [team] },
        { sql: 'SELECT * FROM ideas WHERE id=?', params: ['ideaId' in saved ? saved.ideaId : ''] },
      ] }).map((result: { results: unknown[] }) => result.results)).toEqual(prior);
      expect((await getRunResearchFindings(team, runIds[0])).map(finding => finding.id).sort()).toEqual([firstId, secondId].sort());
      expect(execute({ queries: [{ sql: 'PRAGMA foreign_key_check' }] })[0].results).toEqual([]);
      const cached = execute({ queries: [{ sql: "SELECT value FROM research_cache WHERE team_id=? AND length(id)=64 AND json_type(value,'$.findings')='array'", params: [team] }] })[0].results;
      expect(cached).toHaveLength(2);
      const normalized = cached.flatMap((row: { value: string }) => researchEvidenceSchema.parse(JSON.parse(row.value)).findings)
        .flatMap((finding: ReturnType<typeof researchEvidenceSchema.parse>['findings'][number]) => [finding, ...(finding.additionalIdeas || [])]);
      expect(normalized).toHaveLength(4);
      for (const assessment of normalized) expect(assessment).toMatchObject({ chosenProfileId: 'personal-linkedin', score: 97, qualificationRubric: 'source_qualification_v1', profileFit: 'A concrete independent product-builder decision fits this personal profile.' });
      expect(calls).toBe(2);
    } finally {
      fetcher.mockRestore();
      if (previousKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = previousKey;
    }
  }, 30_000);

  it("saves newly selected families without taking earlier saved ideas and never drafts a finding rejected by the current scan", async () => {
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
      if (fixtureResearchSchema(request).properties.findings) {
        const findingsSchema = fixtureResearchSchema(request).properties.findings;
        expect(findingsSchema.type).toBe("object");
        expect(findingsSchema.required.sort()).toEqual(items.map(item => item.id).sort());
        expect(Object.keys(findingsSchema.properties).sort()).toEqual(items.map(item => item.id).sort());
        expect(findingsSchema.additionalProperties).toBe(false);
      }
      const value = fixtureResearchSchema(request).properties.assessments
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
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(execute({ queries: [{ sql: "SELECT item_id,score FROM research_findings WHERE team_id='assessments' AND run_id='assessments-run'" }] })[0].results)
        .toEqual([{ item_id: "assessed-strong", score: 86 }]);
      expect(execute({ queries: [{ sql: "SELECT score,status,idea_id,created_at,summary FROM research_findings WHERE item_id='assessed-strong' AND team_id='assessments' ORDER BY score" }] })[0].results)
        .toEqual([
          { score: 78, status: "saved", idea_id: "assessment-idea", created_at: now - 120_000, summary: "Earlier summary" },
          { score: 86, status: "new", idea_id: null, created_at: expect.any(Number), summary: "Required and optional consent follow separate signup paths." },
        ]);
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
      expect(fetcher).toHaveBeenCalledTimes(3);
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
        params: [item.id, seed.id, `${new URL(seed.url).origin}/${item.id}`, item.title, item.quote, now - (index + 1) * 60_000, now, item.id === career.id ? item.quote : `${item.quote} ${"This is a first-party account of one product workflow. ".repeat(20)}`],
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
      if (fixtureResearchSchema(request).properties.assessments) {
        expect(request.instructions ?? request.system).toBe(RESEARCH_SCREEN_INSTRUCTIONS);
        expect(input.items.length).toBeLessThanOrEqual(RESEARCH_SCREEN_BATCH_SIZE);
        expect(fixtureResearchSchema(request).properties.assessments.required).toEqual(input.items.map((item: { id: string }) => item.id));
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
      expect(fetcher).toHaveBeenCalledTimes(4);
      const snapshot = await getResearchSnapshot("recall");
      expect(snapshot.findings.map(finding => finding.itemId).sort()).toEqual(useful.map(item => item.id).sort());
      expect(snapshot.runs[0]).toMatchObject({
        findingsCount: 17,
        diagnostics: {
          eligibleCount: 19, routedCount: 19, directEvidenceCount: 18, screenedCount: 1, shortlistedCount: 18, evidenceCount: 18,
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
  }, 60_000);
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
        params: [id, seed.id, `${new URL(seed.url).origin}/family-${id}`, id, quote, now - 1000, now, id === "original" ? quote : `${id}: ${quote} ${"Detailed product workflow evidence. ".repeat(30)}`],
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
      const value = fixtureResearchSchema(request).properties.assessments
        ? { itemIds: [] }
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
      expect(screenedIds).toHaveLength(80);
      expect(screenedIds).not.toContain("rank-item-80");
      expect(
        (await getResearchSnapshot("a")).findings.some(
          (finding) => finding.itemId === "rank-item-80",
        ),
      ).toBe(true);
      expect((await getResearchSnapshot("a")).runs.find(run => run.id === "ranking-run")?.diagnostics).toMatchObject({
        eligibleCount: 81, routedCount: 81, directEvidenceCount: 1, screenedCount: 80, shortlistedCount: 1, evidenceCount: 1,
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
      ).toEqual([{ input_tokens: 20 * (Math.ceil(80 / RESEARCH_SCREEN_BATCH_SIZE) + 1) }]);
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
      expect(fetcher).toHaveBeenCalledTimes(Math.ceil(80 / RESEARCH_SCREEN_BATCH_SIZE) + 1);
      expect(
        execute({
          queries: [
            {
              sql: "SELECT cache_hits FROM research_runs WHERE id='ranking-run'",
            },
          ],
        })[0].results,
      ).toEqual([{ cache_hits: Math.ceil(80 / RESEARCH_SCREEN_BATCH_SIZE) + 1 }]);
    } finally {
      fetcher.mockRestore();
      if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previousKey;
      if (previousAnthropicKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = previousAnthropicKey;
    }
  }, 90_000);
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
      if (fixtureResearchSchema(request).properties.assessments) {
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
      expect(JSON.parse(partial.diagnostics)).toMatchObject({ routedCount: 25, directEvidenceCount: 24, screenedCount: 1, shortlistedCount: 25, evidenceCount: 18, rejectedStories: [{ title: items[5].title, score: 42 }] });
      const [checkpoint] = execute({ queries: [{ sql: "SELECT value FROM research_cache WHERE id='rank-progress:resume-run'" }] })[0].results;
      expect(JSON.parse(checkpoint.value)).toMatchObject({ selectedIds: items.map(item => item.id), nextOffset: 18 });
      execute({ queries: [{
        sql: "INSERT INTO research_items(id,team_id,source_id,canonical_url,title,excerpt,published_at,collected_at,content,content_provenance) VALUES('resume-new-arrival','resume',?,?,'New arrival','New material',?,?,?,'public_feed')",
        params: [seed.id, `${new URL(seed.url).origin}/new-arrival`, now - 1000, now, content(0)],
      }] });
      expect(await processResearchJob({ operation: "rank", runId: "resume-run" })).toEqual({ ok: true, pending: false });
      expect(screened).toBe(1);
      expect(batchSizes).toEqual([6, 6, 6, 6, 1]);
      expect(reviewedIds).toEqual(items.map(item => item.id));
      const [finished] = execute({ queries: [{ sql: "SELECT status,completed_at,findings_count,diagnostics FROM research_runs WHERE id='resume-run'" }] })[0].results;
      expect(finished).toMatchObject({ status: "drafting", findings_count: 24 });
      expect(finished.completed_at).toBeGreaterThanOrEqual(now);
      expect(JSON.parse(finished.diagnostics)).toMatchObject({ eligibleCount: 25, routedCount: 25, directEvidenceCount: 24, screenedCount: 1, shortlistedCount: 25, evidenceCount: 25, rejectedStories: [{ title: items[5].title, score: 42 }] });
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
  }, 60_000);
  it("skips item writes for unchanged feeds while preserving hydrated evidence and applying actual updates", async () => {
    const seed = RESEARCH_SOURCE_SEEDS.find(source => source.kind === "rss" && source.feedUrl)!;
    const now = Date.now();
    const published = Math.floor((now - 10_000) / 1000) * 1000;
    const origin = new URL(seed.url).origin;
    const body = "A practitioner explains a concrete onboarding decision, implementation and limits. ".repeat(20).trim();
    const changedBody = "The revised source describes a different setup tradeoff and the supporting details. ".repeat(20).trim();
    const fullArticle = "The hydrated original article contains additional verified implementation evidence. ".repeat(25).trim();
    const fullTranscript = `${fullArticle} Additional transcript-specific commentary.`;
    let changed = false;
    const feed = () => {
      const rows = [
        { id: "stable", title: "Stable original", excerpt: "Stable summary", at: changed ? published + 1000 : published, content: body },
        { id: "metadata", title: changed ? "Updated title" : "Original title", excerpt: changed ? "Updated supporting quote" : "Original quote", at: published, content: changed ? changedBody : body },
        { id: "undated", title: "Original date missing", excerpt: "Same summary", at: changed ? published : null, content: body },
        { id: "hydrated", title: changed ? "Updated hydrated title" : "Hydrated title", excerpt: changed ? "New public excerpt" : "Public excerpt", at: published, content: changed ? changedBody : body },
        { id: "transcript", title: changed ? "Updated transcript title" : "Transcript title", excerpt: changed ? "Updated caption quote" : "Caption summary", at: published, content: changed ? changedBody : body },
        ...(changed ? [{ id: "new", title: "Newly published original", excerpt: "New publication", at: published + 2000, content: body }] : []),
      ];
      return `<rss><channel>${rows.map(row => `<item><title>${row.title}</title><link>${origin}/metadata-repeat-${row.id}</link><description>${row.excerpt}</description>${row.at === null ? "" : `<pubDate>${new Date(row.at).toUTCString()}</pubDate>`}<content:encoded><![CDATA[<p>${row.content}</p>]]></content:encoded></item>`).join("")}</channel></rss>`;
    };
    execute({ queries: [{ sql: "INSERT INTO teams(id,name,slug,created_at,updated_at) VALUES('metadata-repeat','Metadata repeat','metadata-repeat',0,0)" }] });
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async input => {
      expect(String(input)).toBe(seed.feedUrl);
      return new Response(feed());
    });
    const db = state.db as ReturnType<typeof drizzle>;
    const insert = vi.spyOn(db, "insert"), update = vi.spyOn(db, "update");
    async function collect(id: string, at: number) {
      clock.mockReturnValue(at);
      execute({ queries: [{ sql: "INSERT INTO research_runs(id,team_id,mode,status,days,editorial,created_at,icp,source_count,source_ids) VALUES(?,'metadata-repeat','collect','collecting',1,0,?,'Product teams',1,?)", params: [id, at, JSON.stringify([seed.id])] }] });
      const result = await processResearchJob({ operation: "collect", runId: id, sourceId: seed.id });
      await processResearchJob({ operation: "rank", runId: id });
      return result;
    }
    try {
      expect(await collect("metadata-repeat-first", now)).toEqual({ collected: 5, error: null });
      const hydratedHash = await researchHash(fullArticle);
      const transcriptHash = await researchHash(fullTranscript);
      execute({ queries: [
        { sql: "UPDATE research_items SET content=?,content_hash=?,content_provenance='article' WHERE team_id='metadata-repeat' AND canonical_url=?", params: [fullArticle, hydratedHash, `${origin}/metadata-repeat-hydrated`] },
        { sql: "UPDATE research_items SET content=?,content_hash=?,content_provenance='transcript',content_type='video',transcript_status='available' WHERE team_id='metadata-repeat' AND canonical_url=?", params: [fullTranscript, transcriptHash, `${origin}/metadata-repeat-transcript`] },
      ] });
      insert.mockClear(); update.mockClear();
      expect(await collect("metadata-repeat-second", now + 1000)).toEqual({ collected: 0, error: null });
      expect(insert.mock.calls.filter(([table]) => table === schema.research_items)).toHaveLength(0);
      expect(update.mock.calls.filter(([table]) => table === schema.research_items)).toHaveLength(0);
      changed = true;
      expect(await collect("metadata-repeat-third", now + 2000)).toEqual({ collected: 1, error: null });
      const rows = execute({ queries: [{ sql: "SELECT canonical_url,title,excerpt,published_at,collected_at,content,content_hash,content_changed_at,content_provenance,transcript_status FROM research_items WHERE team_id='metadata-repeat'" }] })[0].results;
      const item = (id: string) => rows.find((row: { canonical_url: string }) => row.canonical_url === `${origin}/metadata-repeat-${id}`);
      expect(item("stable")).toMatchObject({ title: "Stable original", published_at: published, collected_at: now, content: body });
      expect(item("metadata")).toMatchObject({ title: "Updated title", excerpt: "Updated supporting quote", content: changedBody, content_hash: await researchHash(changedBody), collected_at: now });
      expect(item("undated")).toMatchObject({ published_at: published, collected_at: now });
      expect(item("hydrated")).toMatchObject({ title: "Updated hydrated title", excerpt: "New public excerpt", content: fullArticle, content_hash: hydratedHash, content_provenance: "article", published_at: published, collected_at: now });
      expect(item("transcript")).toMatchObject({ title: "Updated transcript title", excerpt: "Updated caption quote", content: fullTranscript, content_hash: transcriptHash, content_provenance: "transcript", transcript_status: "available", published_at: published, collected_at: now });
      expect(item("new")).toMatchObject({ published_at: published + 2000, collected_at: now + 2000 });
      for (const id of ['stable', 'undated', 'hydrated', 'transcript']) expect(item(id).content_changed_at).toBe(now);
      for (const id of ['metadata', 'new']) expect(item(id).content_changed_at).toBe(now + 2000);
      expect(fetcher).toHaveBeenCalledTimes(3);
    } finally {
      insert.mockRestore(); update.mockRestore(); fetcher.mockRestore(); clock.mockRestore();
    }
  }, 30_000);

  it('qualifies an old undated watch only after its stored public body actually changes', async () => {
    const seed = RESEARCH_SOURCE_SEEDS.find(source => source.kind === 'web')!, search = RESEARCH_SOURCE_SEEDS.find(source => source.kind === 'search')!;
    const priorMode = seed.pageMode, priorUrl = seed.url, origin = new URL(seed.url).origin;
    seed.pageMode = 'article'; seed.url = `${origin}/body-change-watch`;
    const team = 'body-change-watch', now = Date.now(), firstSeen = now - 30 * 86_400_000;
    const itemId = await researchHash(`${team}:${seed.url}`);
    const oldQuote = 'An existing public resource explains how teams review a proposed workflow.';
    const newQuote = 'The updated public resource adds a human review step before a consequential action.';
    const page = (quote: string) => `<article><h1>Public workflow</h1><p>${quote.repeat(12)}</p></article>`;
    const oldBody = articleResearchText(page(oldQuote));
    execute({ queries: [
      { sql: 'INSERT INTO teams(id,name,slug,created_at,updated_at) VALUES(?,?,?,0,0)', params: [team, team, team] },
      { sql: "INSERT INTO research_items(id,team_id,source_id,canonical_url,title,excerpt,published_at,collected_at,content,content_provenance) VALUES(?,?,?,?,?,?,NULL,?,?,'article')", params: [itemId, team, search.id, seed.url, 'Public workflow', oldBody.slice(0, 1600), firstSeen, oldBody] },
      { sql: "INSERT INTO research_items(id,team_id,source_id,canonical_url,title,excerpt,published_at,collected_at,content,content_provenance,content_changed_at) VALUES(?,?,?,?,?,?,NULL,?,?,'article',?)", params: [`${team}-ordinary`, team, search.id, `${origin}/ordinary-undated`, 'An unrelated undated reference', oldBody, firstSeen, oldBody, now + 1000] },
    ] });
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now), previousKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'test-body-change';
    let changed = false, assessments = 0;
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      if (String(url) === seed.url) return new Response(page(changed ? newQuote : oldQuote));
      expect(String(url)).toBe('https://api.anthropic.com/v1/messages');
      const input = JSON.parse(JSON.parse(String(init?.body)).messages[0].content);
      expect(input.items).toHaveLength(1);
      expect(input.items[0]).toMatchObject({ id: itemId, publishedAt: null, discoveredAt: firstSeen, signalKind: 'undated_reference' });
      assessments++;
      return modelResponseFixture({ status: 'completed', usage: { input_tokens: 1, output_tokens: 1 }, output: [{ content: [{ type: 'output_text', text: JSON.stringify({ findings: { [itemId]: {
        claimBasis: 'described_method', profileChecks: Object.fromEntries(input.publishingProfiles.map((profile: { id: string }) => [profile.id, { fits: true, relevance: 27, reason: 'A supported product workflow review decision.' }])),
        summary: 'A human review step', evidence: newQuote, contentAngle: 'Inspect the review gate before automating this action.', whyItMatters: 'A consequential product workflow decision.', limitations: 'Publication date is unknown; observing a body update does not establish novelty.', familyKey: 'observed-body-review-gate', qualityComponents: { sourceSupport: 22, usefulDecision: 25, scopeHonesty: 14 }, additionalIdeas: [],
      } } }) }] }] });
    });
    async function collectAndRank(id: string, at: number) {
      clock.mockReturnValue(at);
      execute({ queries: [
        { sql: "INSERT INTO research_runs(id,team_id,mode,status,days,editorial,created_at,icp,source_count,source_ids) VALUES(?,?,'scan','collecting',1,0,?,'Product teams',2,?)", params: [id, team, at - 10, JSON.stringify([seed.id, search.id])] },
        { sql: "INSERT INTO research_run_sources(id,run_id,source_id,status) VALUES(?,?,?,'completed')", params: [`${id}:${search.id}`, id, search.id] },
      ] });
      expect(await processResearchJob({ operation: 'collect', runId: id, sourceId: seed.id })).toEqual({ collected: 0, error: null });
      await finishResearchRankJob(id);
    }
    const stored = () => execute({ queries: [{ sql: 'SELECT source_id,published_at,collected_at,content_hash,content_changed_at FROM research_items WHERE id=?', params: [itemId] }] })[0].results[0];
    try {
      await collectAndRank(`${team}-unchanged`, now);
      expect(stored()).toMatchObject({ source_id: search.id, published_at: null, collected_at: firstSeen, content_hash: await researchHash(oldBody), content_changed_at: null });
      expect(assessments).toBe(0);
      changed = true;
      await collectAndRank(`${team}-updated`, now + 1000);
      expect(stored()).toMatchObject({ source_id: search.id, published_at: null, collected_at: firstSeen, content_changed_at: now + 1000 });
      const [finding] = await getRunResearchFindings(team, `${team}-updated`);
      expect(finding).toMatchObject({ item_id: itemId, source_content_changed_at: now + 1000, source_discovered_at: firstSeen, source_published_at: null, signal_kind: 'undated_reference' });
      expect(researchFindingSourceContext(finding, { created_at: now + 990, days: 1 }, firstSeen)).toMatchObject({ publishedAt: null, discoveredAt: new Date(firstSeen).toISOString(), contentChangedAt: new Date(now + 1000).toISOString(), signalKind: 'undated_reference' });
      expect(assessments).toBe(1);
      await collectAndRank(`${team}-unchanged-later`, now + 2 * 86_400_000);
      expect(stored().content_changed_at).toBe(now + 1000);
      expect(await getRunResearchFindings(team, `${team}-unchanged-later`)).toEqual([]);
      expect(assessments).toBe(1);
    } finally {
      seed.pageMode = priorMode; seed.url = priorUrl; fetcher.mockRestore(); clock.mockRestore();
      if (previousKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = previousKey;
    }
  }, 30_000);

  it.each(['rss', 'web'] as const)("captures immutable %s observations before excluding known items and retries only storage", async kind => {
    const seed = RESEARCH_SOURCE_SEEDS.find(source => source.kind === kind && !source.backfillUrls?.length &&
      (kind === 'rss' ? Boolean(source.feedUrl) : !source.feedUrl))!;
    const team = `collection-observation-${kind}`, runId = `${team}-run`, now = Date.now();
    const published = Math.floor((now - 1000) / 1000) * 1000;
    const url = `${new URL(seed.url).origin}/observation-known`, deferredUrl = `${new URL(seed.url).origin}/observation-old-backoff`;
    const body = 'A concrete public workflow describes a practitioner decision and its implementation limits. '.repeat(20).trim();
    execute({ queries: [
      { sql: 'INSERT INTO teams(id,name,slug,created_at,updated_at) VALUES(?,?,?,0,0)', params: [team, team, team] },
      { sql: "INSERT INTO research_runs(id,team_id,mode,status,days,editorial,created_at,icp,source_count,source_ids) VALUES(?,?,'collect','collecting',14,0,?,'Product teams',1,?)", params: [runId, team, now, JSON.stringify([seed.id])] },
      ...[url, deferredUrl].map((canonicalUrl, index) => ({
        sql: 'INSERT INTO research_items(id,team_id,source_id,canonical_url,title,excerpt,published_at,collected_at,content,content_hash,content_provenance) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
        params: [`${team}-${index}`, team, seed.id, canonicalUrl, 'Known original workflow', 'Public summary', published, now - 1000, body, '', 'article'],
      })),
      { sql: 'INSERT INTO research_cache(id,team_id,value,created_at) VALUES(?,?,?,?)', params: [`collection-backoff:${team}:${seed.id}`, team, JSON.stringify({ retryAtByHost: {}, targets: [{ url: deferredUrl, title: 'Old deferred page' }] }), now] },
    ] });
    let changed = false, attempts = 0;
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      expect(String(input)).toBe(seed.feedUrl || seed.url);
      const title = changed ? 'Changed index title' : 'Known original workflow';
      return new Response(kind === 'rss'
        ? `<rss><channel><item><title>${title}</title><link>${url}</link><description>Public summary</description><pubDate>${new Date(published).toUTCString()}</pubDate><content:encoded><![CDATA[<p>${body}</p>]]></content:encoded></item></channel></rss>`
        : `<main><a href="${url}">${title}</a></main>`);
    });
    const observationId = `collection-observation:${runId}:${seed.id}`;
    storageFault = (queries, phase) => {
      if (phase === (kind === 'rss' ? 'after' : 'before') && queries.some(query => query.sql.startsWith('insert into "research_cache"') && query.params.includes(observationId))) {
        if (++attempts === 1) throw new Error('D1_ERROR: Network connection lost.');
      }
    };
    try {
      expect(await processResearchJob({ operation: 'collect', runId, sourceId: seed.id })).toEqual({ collected: 0, error: null });
      expect(attempts).toBe(2);
      expect(fetcher).toHaveBeenCalledTimes(1);
      const [saved] = execute({ queries: [{ sql: 'SELECT team_id,value,created_at FROM research_cache WHERE id=?', params: [observationId] }] })[0].results;
      expect(saved.team_id).toBe(team);
      expect(JSON.parse(saved.value)).toEqual({
        teamId: team, runId, sourceId: seed.id, observedAt: now, windowStart: now - 14 * 86_400_000, windowEnd: now,
        items: kind === 'rss' ? [{ url, title: 'Known original workflow', publishedAt: published, contentType: 'article', transcriptStatus: 'not_applicable', contentProvenance: 'public_feed', bodyCharacters: body.length }] : [],
        pendingArticles: kind === 'web' ? [{ url }] : [],
        deferredArticles: [{ url: deferredUrl, title: 'Old deferred page' }], warning: null,
      });
      expect(saved.value).not.toContain(body);
      storageFault = undefined;
      changed = true;
      clock.mockReturnValue(now + 1000);
      execute({ queries: [
        { sql: "UPDATE research_run_sources SET status='pending' WHERE id=?", params: [`${runId}:${seed.id}`] },
        { sql: 'DELETE FROM research_cache WHERE id=?', params: [`collection-progress:${runId}:${seed.id}`] },
      ] });
      await processResearchJob({ operation: 'collect', runId, sourceId: seed.id });
      await processResearchJob({ operation: 'collect', runId, sourceId: seed.id });
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(execute({ queries: [{ sql: 'SELECT team_id,value,created_at FROM research_cache WHERE id=?', params: [observationId] }] })[0].results).toEqual([saved]);
    } finally { storageFault = undefined; fetcher.mockRestore(); clock.mockRestore(); }
  }, 20_000);

  it('does not fabricate a collection observation when index retrieval fails', async () => {
    const seed = RESEARCH_SOURCE_SEEDS.find(source => source.kind === 'rss' && source.feedUrl && !source.backfillUrls?.length)!;
    const team = 'collection-observation-failure', runId = `${team}-run`, now = Date.now();
    execute({ queries: [
      { sql: 'INSERT INTO teams(id,name,slug,created_at,updated_at) VALUES(?,?,?,0,0)', params: [team, team, team] },
      { sql: "INSERT INTO research_runs(id,team_id,mode,status,days,editorial,created_at,icp,source_count,source_ids) VALUES(?,?,'collect','collecting',14,0,?,'Product teams',1,?)", params: [runId, team, now, JSON.stringify([seed.id])] },
    ] });
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Unavailable', { status: 503 }));
    try {
      expect(await processResearchJob({ operation: 'collect', runId, sourceId: seed.id })).toMatchObject({ collected: 0, error: expect.stringContaining('503') });
      expect(execute({ queries: [{ sql: 'SELECT value FROM research_cache WHERE id=?', params: [`collection-observation:${runId}:${seed.id}`] }] })[0].results).toEqual([]);
      expect(execute({ queries: [{ sql: 'SELECT status FROM research_run_sources WHERE id=?', params: [`${runId}:${seed.id}`] }] })[0].results).toEqual([{ status: 'failed' }]);
    } finally { fetcher.mockRestore(); }
  });

  function savedArticleQueue(team: string, source: ResearchSourceSeed, urls: string[], now: number, rateLimits = {}) {
    const runId = `${team}-run`;
    execute({ queries: [
      { sql: "INSERT INTO teams(id,name,slug,created_at,updated_at) VALUES(?,?,?,0,0)", params: [team, team, team] },
      { sql: "INSERT INTO research_runs(id,team_id,mode,status,days,editorial,created_at,icp,source_count,source_ids) VALUES(?,?,'collect','collecting',1,0,?,'Product teams',1,?)", params: [runId, team, now, JSON.stringify([source.id])] },
      ...urls.map((url, index) => ({
        sql: "INSERT INTO research_items(id,team_id,source_id,canonical_url,title,excerpt,published_at,collected_at) VALUES(?,?,?,?,?,'',?,?)",
        params: [`${team}-${index}`, team, source.id, url, `Article ${index}`, now - 180 * 86400000, now - 2 * 86400000],
      })),
      { sql: "INSERT INTO research_cache(id,team_id,value,created_at) VALUES(?,?,?,?)", params: [`collection-progress:${runId}:${source.id}`, team, JSON.stringify({ urls: [], nextOffset: 0, count: urls.length, warning: null, articles: urls.map(url => ({ url })), articleOffset: 0, rateLimits }), now] },
    ] });
    return runId;
  }
  const recoveredArticle = "The original practitioner describes a concrete onboarding decision and the implementation tradeoff. ".repeat(20);
  it.each([
    { sourceId: "openai-news", resume: false },
    { sourceId: "google-deepmind-research", resume: true },
    { sourceId: "ordinary", resume: true },
  ])("filters only window-source legacy hydration queues using stored publication dates ($sourceId, resume:$resume)", async ({ sourceId, resume }) => {
    const seed = sourceId === "ordinary"
      ? RESEARCH_SOURCE_SEEDS.find(source => source.kind === "rss" && source.feedUrl && !source.hydratePublishedWindowOnly)!
      : RESEARCH_SOURCE_SEEDS.find(source => source.id === sourceId)!;
    const team = `legacy-publication-${sourceId}`, runId = `${team}-run`, now = Date.now();
    const base = new URL(seed.url).origin;
    const rows = [
      { name: "archive", date: now - 180 * 86_400_000 },
      { name: "current", date: now - 1000 },
      { name: "unknown", date: null },
      { name: "future", date: now + 1000 },
      { name: "backfill", date: null },
      { name: "watch", date: now - 180 * 86_400_000 },
    ].map(row => ({ ...row, url: `${base}/${team}-${row.name}` }));
    const targets = rows.map(row => ({ url: row.url, title: row.name }));
    const watch: ResearchSourceSeed = { id: `${team}-watch`, name: "Explicit reference", url: rows[5].url,
      kind: "web", pageMode: "article", category: "research", enabled: true, notes: "Test reference", priority: 1 };
    const progressId = `collection-progress:${runId}:${seed.id}`;
    execute({ queries: [
      { sql: "INSERT INTO teams(id,name,slug,created_at,updated_at) VALUES(?,?,?,0,0)", params: [team, team, team] },
      { sql: "INSERT INTO research_runs(id,team_id,mode,status,days,created_at,icp,source_count,source_ids) VALUES(?,?,'collect','collecting',1,?,'Product teams',2,?)", params: [runId, team, now, JSON.stringify([seed.id, watch.id])] },
      ...rows.map(row => ({
        sql: "INSERT INTO research_items(id,team_id,source_id,canonical_url,title,excerpt,published_at,collected_at) VALUES(?,?,?,?,?,'',?,?)",
        params: [`${team}-${row.name}`, team, seed.id, row.url, row.name, row.date, now - 500],
      })),
      { sql: "INSERT INTO research_cache(id,team_id,value,created_at) VALUES(?,?,?,?)", params: [`collection-backoff:${team}:${seed.id}`, team, JSON.stringify({ retryAtByHost: {}, targets }), now] },
      ...(resume ? [{ sql: "INSERT INTO research_cache(id,team_id,value,created_at) VALUES(?,?,?,?)", params: [progressId, team, JSON.stringify({
        urls: [], nextOffset: 0, count: 0, warning: null, articles: targets, articleOffset: 0,
        deferredArticles: targets.filter(target => /-(archive|unknown|future)$/.test(target.url)).map(target => ({ ...target, retryAt: now - 1, reason: "Legacy deferred page" })),
      }), now] }] : []),
    ] });
    const priorBackfills = seed.backfillUrls, fetched: string[] = [];
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async input => {
      const url = String(input);
      if (url === seed.feedUrl) return new Response("<rss><channel></channel></rss>");
      expect(rows.some(row => row.url === url)).toBe(true);
      fetched.push(url);
      return new Response(`<main><h1>Original documented workflow</h1><p>${recoveredArticle}</p></main>`);
    });
    try {
      seed.backfillUrls = [rows[4].url];
      RESEARCH_SOURCE_SEEDS.push(watch);
      let result = await processResearchJob({ operation: "collect", runId, sourceId: seed.id });
      while ("pending" in result && result.pending) result = await processResearchJob({ operation: "collect", runId, sourceId: seed.id });
      const expected = seed.hydratePublishedWindowOnly ? rows.filter(row => ["current", "backfill", "watch"].includes(row.name)) : rows;
      expect(fetched.sort()).toEqual(expected.map(row => row.url).sort());
      const saved = execute({ queries: [{ sql: "SELECT value FROM research_cache WHERE id=?", params: [progressId] }] })[0].results[0];
      const queue = JSON.parse(saved.value);
      if (seed.hydratePublishedWindowOnly) {
        expect(queue.articles.map((target: { url: string }) => target.url).sort()).toEqual(expected.map(row => row.url).sort());
        expect(queue.deferredArticles || []).toEqual([]);
      }
    } finally {
      seed.backfillUrls = priorBackfills;
      RESEARCH_SOURCE_SEEDS.splice(RESEARCH_SOURCE_SEEDS.indexOf(watch), 1);
      fetcher.mockRestore();
    }
  }, 30_000);

  it("retains a throttled target, stops the host queue, and resumes after its saved cooldown", async () => {
    const seed = RESEARCH_SOURCE_SEEDS.find(source => source.kind === "rss" && source.feedUrl)!;
    const now = Date.now();
    const urls = Array.from({ length: 6 }, (_, index) => `${new URL(seed.url).origin}/cooldown-${index}`);
    const runId = savedArticleQueue("cooldown-resume", seed, urls, now);
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    let limited = true;
    const calls: string[] = [];
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async input => {
      const url = String(input);
      calls.push(url);
      if (url === urls[0] && limited) return new Response("Slow down", { status: 429, headers: { "retry-after": "120" } });
      return new Response(`<article><h1>Original workflow</h1><p>${recoveredArticle}</p></article>`);
    });
    try {
      expect(await processResearchJob({ operation: "collect", runId, sourceId: seed.id })).toEqual({ collected: 6, pending: true, retryAfterMs: 120_000 });
      expect(calls).toEqual(urls.slice(0, 3));
      const [saved] = execute({ queries: [{ sql: "SELECT value FROM research_cache WHERE id=?", params: [`collection-progress:${runId}:${seed.id}`] }] })[0].results;
      expect(JSON.parse(saved.value).articleOffset).toBe(2);
      expect(JSON.parse(saved.value).articles.slice(0, 3)).toEqual([{ url: urls[1] }, { url: urls[2] }, { url: urls[0] }]);
      await processResearchJob({ operation: "collect", runId, sourceId: seed.id });
      expect(calls).toHaveLength(3);
      limited = false;
      clock.mockReturnValue(now + 120_001);
      expect(await processResearchJob({ operation: "collect", runId, sourceId: seed.id })).toEqual({ collected: 6, error: null });
      expect(calls.filter(url => url === urls[0])).toHaveLength(2);
      expect(calls.filter(url => url === urls[1])).toHaveLength(1);
      expect(calls.filter(url => url === urls[2])).toHaveLength(1);
      const [backlog, stored] = execute({ queries: [
        { sql: "SELECT value FROM research_cache WHERE id=?", params: [`collection-backoff:cooldown-resume:${seed.id}`] },
        { sql: "SELECT COUNT(*) count,MIN(collected_at) first_seen FROM research_items WHERE team_id='cooldown-resume' AND content IS NOT NULL" },
      ] }).map((result: { results: unknown[] }) => result.results[0]);
      expect(JSON.parse(backlog.value).targets).toEqual([]);
      expect(stored).toEqual({ count: 6, first_seen: now - 2 * 86400000 });
    } finally {
      fetcher.mockRestore(); clock.mockRestore();
    }
  }, 30_000);

  it("defers every same-host target after a long Retry-After and rehydrates the saved backlog on a later run", async () => {
    const seed = RESEARCH_SOURCE_SEEDS.find(source => source.kind === "rss" && source.feedUrl)!;
    const now = Date.now();
    const urls = Array.from({ length: 6 }, (_, index) => `${new URL(seed.url).origin}/long-cooldown-${index}`);
    const runId = savedArticleQueue("cooldown-later", seed, urls, now);
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    let limited = true;
    const calls: string[] = [];
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async input => {
      const url = String(input); calls.push(url);
      if (url === seed.feedUrl) return new Response("<rss><channel></channel></rss>");
      if (limited) return new Response("Slow down", { status: 429, headers: { "retry-after": "3600" } });
      return new Response(`<article><h1>Recovered original workflow</h1><p>${recoveredArticle}</p></article>`);
    });
    try {
      const result = await processResearchJob({ operation: "collect", runId, sourceId: seed.id });
      expect(result).toMatchObject({ collected: 6, error: expect.stringContaining("6 original article page(s) deferred") });
      expect(result).not.toHaveProperty("pending");
      expect(calls).toHaveLength(3);
      const [saved] = execute({ queries: [{ sql: "SELECT value FROM research_cache WHERE id=?", params: [`collection-backoff:cooldown-later:${seed.id}`] }] })[0].results;
      expect(JSON.parse(saved.value).targets.map((target: { url: string }) => target.url).sort()).toEqual([...urls].sort());
      await processResearchJob({ operation: "rank", runId });
      const later = now + 2 * 86400000;
      clock.mockReturnValue(later); limited = false;
      execute({ queries: [{ sql: "INSERT INTO research_runs(id,team_id,mode,status,days,editorial,created_at,icp,source_count,source_ids) VALUES('cooldown-later-next','cooldown-later','collect','collecting',1,0,?,'Product teams',1,?)", params: [later, JSON.stringify([seed.id])] }] });
      expect(await processResearchJob({ operation: "collect", runId: "cooldown-later-next", sourceId: seed.id })).toEqual({ collected: 0, error: null });
      expect(calls).toHaveLength(10);
      const [backlog, stored] = execute({ queries: [
        { sql: "SELECT value FROM research_cache WHERE id=?", params: [`collection-backoff:cooldown-later:${seed.id}`] },
        { sql: "SELECT COUNT(*) count,MIN(collected_at) first_seen,MAX(published_at) published_at FROM research_items WHERE team_id='cooldown-later' AND content IS NOT NULL" },
      ] }).map((result: { results: unknown[] }) => result.results[0]);
      expect(JSON.parse(backlog.value).targets).toEqual([]);
      expect(stored).toEqual({ count: 6, first_seen: now - 2 * 86400000, published_at: now - 180 * 86400000 });
    } finally {
      fetcher.mockRestore(); clock.mockRestore();
    }
  }, 30_000);

  it("exhausts only technical rate-limit retries and explicitly defers the remaining host queue", async () => {
    const seed = RESEARCH_SOURCE_SEEDS.find(source => source.kind === "rss" && source.feedUrl)!;
    const now = Date.now();
    const urls = [0, 1].map(index => `${new URL(seed.url).origin}/retry-budget-${index}`);
    const runId = savedArticleQueue("cooldown-budget", seed, urls, now);
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("Slow down", { status: 429, headers: { "retry-after": "1" } }));
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        clock.mockReturnValue(now + attempt * 1001);
        expect(await processResearchJob({ operation: "collect", runId, sourceId: seed.id })).toMatchObject({ pending: true, retryAfterMs: 1000 });
      }
      clock.mockReturnValue(now + 2002);
      const result = await processResearchJob({ operation: "collect", runId, sourceId: seed.id });
      expect(result).toMatchObject({ error: expect.stringContaining("2 original article page(s) deferred") });
      expect(result).not.toHaveProperty("pending");
      expect(fetcher).toHaveBeenCalledTimes(6);
      const [saved] = execute({ queries: [{ sql: "SELECT value FROM research_cache WHERE id=?", params: [`collection-progress:${runId}:${seed.id}`] }] })[0].results;
      expect(JSON.parse(saved.value).deferredArticles).toHaveLength(2);
      expect(Object.values(JSON.parse(saved.value).rateLimits)).toEqual([{ attempts: 3, retryAt: now + 3002, exhausted: true }]);
    } finally {
      fetcher.mockRestore(); clock.mockRestore();
    }
  }, 30_000);

  it("continues other hosts without requesting a cooled-down host later in a batch", async () => {
    const seed = RESEARCH_SOURCE_SEEDS.find(source => source.kind === "search")!;
    const now = Date.now();
    const urls = ["https://other.example.com/first", "https://limited.example.com/deferred", "https://other.example.com/last"];
    const runId = savedArticleQueue("cooldown-mixed", seed, urls, now, { "limited.example.com": { attempts: 1, retryAt: now + 3600_000 } });
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    const fetched: string[] = [];
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async input => {
      fetched.push(String(input));
      return new Response(`<article><h1>Original workflow</h1><p>${recoveredArticle}</p></article>`);
    });
    try {
      const result = await processResearchJob({ operation: "collect", runId, sourceId: seed.id });
      expect(result).toMatchObject({ error: expect.stringContaining("1 original article page(s) deferred") });
      expect(result).not.toHaveProperty("pending");
      expect(fetched).toEqual([urls[0], urls[2]]);
    } finally {
      fetcher.mockRestore(); clock.mockRestore();
    }
  }, 30_000);

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
      const [last] = execute({ queries: [{ sql: "SELECT published_at,collected_at,content,content_changed_at FROM research_items WHERE team_id='article-chunks' AND canonical_url=?", params: [articles[12].url] }] })[0].results;
      expect(last).toMatchObject({ published_at: articles[12].at, collected_at: initial.collected_at });
      expect(last.content).toContain(content.trim());
      expect(last.content_changed_at).toBeGreaterThanOrEqual(initial.collected_at);
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

  it("keeps publication-window feeds out of paid ranking for newly collected archives while preserving exact watches", async () => {
    const team = "publication-window-rank", runId = `${team}-run`, now = Date.now(), start = now - 86_400_000;
    const guarded = RESEARCH_SOURCE_SEEDS.filter(source => source.hydratePublishedWindowOnly);
    expect(guarded.map(source => source.id).sort()).toEqual(["google-deepmind-research", "openai-news"]);
    const ordinary = RESEARCH_SOURCE_SEEDS.find(source => source.kind === "rss" && !source.hydratePublishedWindowOnly)!;
    const watches = RESEARCH_SOURCE_SEEDS.filter(source => source.kind === "web" && source.pageMode === "article").slice(0, 2);
    expect(watches).toHaveLength(2);
    const roster = [...guarded, ordinary, ...watches].map(source => source.id);
    const quote = "The documented workflow preserves original context so a user can inspect the evidence before choosing the next action.";
    const rows = [
      { id: "window-openai-fresh", sourceId: "openai-news", url: "https://openai.com/news/fresh-test", date: now - 1000, body: true },
      { id: "window-deepmind-boundary", sourceId: "google-deepmind-research", url: "https://deepmind.google/blog/boundary-test", date: start, body: true },
      { id: "window-openai-archive-metadata", sourceId: "openai-news", url: "https://openai.com/news/archive-test", date: start - 1, body: false },
      { id: "window-deepmind-archive-body", sourceId: "google-deepmind-research", url: "https://deepmind.google/blog/archive-test", date: now - 180 * 86_400_000, body: true },
      { id: "window-openai-future", sourceId: "openai-news", url: "https://openai.com/news/future-test", date: now + 1, body: true },
      { id: "window-deepmind-undated", sourceId: "google-deepmind-research", url: "https://deepmind.google/blog/undated-test", date: null, body: false },
      { id: "window-ordinary-evergreen", sourceId: ordinary.id, url: new URL("ordinary-evergreen", ordinary.url).href, date: now - 180 * 86_400_000, body: true },
      { id: "window-exact-dated-watch", sourceId: "openai-news", url: canonicalResearchUrl(watches[0].url), date: now - 180 * 86_400_000, body: true },
      { id: "window-exact-undated-watch", sourceId: "google-deepmind-research", url: canonicalResearchUrl(watches[1].url), date: null, body: true },
      { id: "window-unconfigured-watch-path", sourceId: "openai-news", url: `${canonicalResearchUrl(watches[0].url)}-other`, date: start - 1, body: false },
    ];
    execute({ queries: [
      { sql: "INSERT INTO teams(id,name,slug,created_at,updated_at) VALUES(?,?,?,0,0)", params: [team, team, team] },
      { sql: "INSERT INTO research_runs(id,team_id,mode,status,days,created_at,icp,source_count,source_ids) VALUES(?,?,'scan','collecting',1,?,'Product practitioners',?,?)", params: [runId, team, now, roster.length, JSON.stringify(roster)] },
      ...roster.map(sourceId => ({ sql: "INSERT INTO research_run_sources(id,run_id,source_id,status) VALUES(?,?,?,'completed')", params: [`${runId}:${sourceId}`, runId, sourceId] })),
      ...rows.map(row => ({
        sql: "INSERT INTO research_items(id,team_id,source_id,canonical_url,title,excerpt,published_at,collected_at,content,content_provenance) VALUES(?,?,?,?,?,?,?,?,?,?)",
        params: [row.id, team, row.sourceId, row.url, row.id, quote, row.date, now - 500, row.body ? quote.repeat(8) : null, row.body ? "article" : "unknown"],
      })),
    ] });
    const priorKey = process.env.ANTHROPIC_API_KEY, assessed: string[] = [];
    process.env.ANTHROPIC_API_KEY = "test-publication-window-rank";
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      expect(String(url)).toBe("https://api.anthropic.com/v1/messages");
      const request = JSON.parse(String(init?.body)), input = JSON.parse(request.messages[0].content);
      expect(fixtureResearchSchema(request).properties.assessments).toBeUndefined();
      expect(input.items).toHaveLength(1);
      const item = input.items[0];
      assessed.push(item.id);
      return modelResponseFixture({ status: "completed", usage: { input_tokens: 1, output_tokens: 1 }, output: [{ content: [{ type: "output_text", text: JSON.stringify({ findings: [{
        itemId: item.id, summary: "Inspect the source context before choosing a next action.", evidence: quote,
        contentAngle: "Make original evidence visible beside a recommended priority.", whyItMatters: "A user can check the basis before accepting the suggestion.",
        limitations: "A described method, not independent outcome proof.", familyKey: item.id, additionalIdeas: [], sectionChecks: [],
        claimBasis: "described_method", profileChecks: [{ profileId: RESEARCH_AUDIENCE_ONLY_PROFILE_ID, fits: true, relevance: 25, reason: "A concrete product workflow decision." }],
        qualityComponents: { sourceSupport: 23, usefulDecision: 25, scopeHonesty: 14 },
      }] }) }] }] });
    });
    try {
      await finishResearchRankJob(runId);
      expect(assessed.sort()).toEqual(["window-openai-fresh", "window-deepmind-boundary", "window-ordinary-evergreen", "window-exact-dated-watch", "window-exact-undated-watch"].sort());
      const [run] = execute({ queries: [{ sql: "SELECT diagnostics FROM research_runs WHERE id=?", params: [runId] }] })[0].results;
      expect(JSON.parse(run.diagnostics)).toMatchObject({ eligibleCount: 5, freshCount: 2, evergreenCount: 2, directEvidenceCount: 5, screenedCount: 0, evidenceCount: 5 });
    } finally {
      fetcher.mockRestore();
      if (priorKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = priorKey;
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
      const value = fixtureResearchSchema(request).properties.assessments
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
      expect(JSON.parse(run.diagnostics)).toMatchObject({ eligibleCount: 2, freshCount: 1, evergreenCount: 1, undatedCount: 1, routedCount: 2, directEvidenceCount: 2, screenedCount: 0, evidenceCount: 2 });
      expect(evergreen.published_at).toBe(now - 180 * 86400000);
    } finally {
      fetcher.mockRestore();
      if (priorKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = priorKey;
      if (priorAnthropicKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = priorAnthropicKey;
    }
  }, 30_000);

  it("qualifies exact article-watch URLs already owned by another source without retagging or inventing dates", async () => {
    const seed = RESEARCH_SOURCE_SEEDS.find(source => source.kind === 'web')!;
    const search = RESEARCH_SOURCE_SEEDS.find(source => source.kind === 'search')!;
    const previousMode = seed.pageMode, previousUrl = seed.url, sourceCount = RESEARCH_SOURCE_SEEDS.length;
    const origin = new URL(seed.url).origin;
    seed.pageMode = 'article';
    seed.url = `${origin}/watch-current/?utm_source=fixture#watch`;
    for (const id of ['watch-thin', 'watch-known-old', 'watch-after-cutoff'])
      RESEARCH_SOURCE_SEEDS.push({ ...seed, id: `fixture-${id}`, url: `${origin}/${id}` });
    const roster = RESEARCH_SOURCE_SEEDS.map(source => source.id).filter(id => id !== search.id);
    const team = 'undated-article-watch', runId = `${team}-run`, now = Date.now(), firstSeen = now + 10;
    const quote = 'This public resource describes a concrete product decision and the limits of its approach.';
    const rows = [
      { id: 'watch-current', sourceId: search.id, firstSeen, body: quote.repeat(12) },
      { id: 'watch-thin', sourceId: seed.id, firstSeen, body: quote },
      { id: 'watch-known-old', sourceId: seed.id, firstSeen: now - 2 * 86_400_000, body: quote.repeat(12) },
      { id: 'watch-after-cutoff', sourceId: seed.id, firstSeen: now + 1000, body: quote.repeat(12) },
      { id: 'search-undated', sourceId: search.id, firstSeen, body: quote.repeat(12) },
      { id: 'watch-unconfigured-path', sourceId: seed.id, firstSeen, body: quote.repeat(12) },
    ];
    execute({ queries: [
      { sql: 'INSERT INTO teams(id,name,slug,created_at,updated_at) VALUES(?,?,?,0,0)', params: [team, team, team] },
      { sql: "INSERT INTO research_runs(id,team_id,mode,status,days,editorial,created_at,icp,source_count,source_ids) VALUES(?,?,'scan','collecting',1,0,?,'Product teams',?,?)", params: [runId, team, now, roster.length, JSON.stringify(roster)] },
      ...roster.map(sourceId => ({
        sql: "INSERT INTO research_run_sources(id,run_id,source_id,status) VALUES(?,?,?,'completed')", params: [`${runId}:${sourceId}`, runId, sourceId],
      })),
      ...rows.map(row => ({
        sql: "INSERT INTO research_items(id,team_id,source_id,canonical_url,title,excerpt,published_at,collected_at,content,content_provenance,content_changed_at) VALUES(?,?,?,?,?,?,NULL,?,?,'article',?)",
        params: [row.id, team, row.sourceId, `${new URL(seed.url).origin}/${row.id}`, row.id, quote, row.firstSeen, row.body, row.id === 'watch-after-cutoff' ? now + 1000 : null],
      })),
    ] });
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 50);
    const previousKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'test-undated-watch';
    storageFault = queries => {
      for (const query of queries) if (query.sql.includes('from "research_items"') && query.params.length > 100)
        throw new Error('D1 bound-parameter limit exceeded');
    };
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      const input = JSON.parse(request.input ?? request.messages[0].content);
      expect(input.items).toHaveLength(1);
      expect(input.items[0]).toMatchObject({ publishedAt: null, discoveredAt: firstSeen, signalKind: 'undated_reference' });
      const screening = fixtureResearchSchema(request).properties.assessments;
      expect(input.items[0].id).toBe(screening ? 'watch-thin' : 'watch-current');
      const value = screening ? screeningFixture({ itemIds: [] }, input.items) : {
        findings: [{ itemId: 'watch-current', score: 85, summary: 'A bounded public framework', whyItMatters: 'A product decision to inspect', contentAngle: 'Inspect the resource before adopting its process', evidence: quote, limitations: 'Publication date is unknown; first observation does not prove novelty', familyKey: 'undated-watch-test' }],
      };
      return modelResponseFixture({ status: 'completed', usage: { input_tokens: 1, output_tokens: 1 }, output: [{ content: [{ type: 'output_text', text: JSON.stringify(value) }] }] });
    });
    try {
      expect(await processResearchJob({ operation: 'rank', runId })).toEqual({ ok: true, pending: false });
      const [finding] = await getRunResearchFindings(team, runId);
      expect(researchFindingDates(finding)).toEqual({ publishedAt: null, discoveredAt: firstSeen, signalKind: 'undated_reference' });
      expect(finding.source_id).toBe(search.id);
      expect(execute({ queries: [{ sql: "SELECT source_id,published_at,collected_at FROM research_items WHERE id='watch-current'" }] })[0].results)
        .toEqual([{ source_id: search.id, published_at: null, collected_at: firstSeen }]);
      const snapshot = await getResearchSnapshot(team);
      expect(snapshot.findings[0]).toMatchObject({ publishedAt: null, discoveredAt: firstSeen, signalKind: 'undated_reference' });
      expect(snapshot.runs.find(run => run.id === runId)?.diagnostics).toMatchObject({ eligibleCount: 2, freshCount: 0, evergreenCount: 0, directEvidenceCount: 1, incompleteScreenedCount: 1 });
      const invoke = vi.fn(async (_instructions, input: unknown) => {
        expect((input as { source: unknown }).source).toMatchObject({ publishedAt: null, discoveredAt: new Date(firstSeen).toISOString(), signalKind: 'undated_reference' });
        return { ready: false, reason: 'No new draft requested', editorial: null, targets: [] };
      });
      await runResearchDraftWriting({ source: { url: finding.url, content: quote.repeat(12), ...researchFindingSourceContext(finding, { created_at: now, days: 1 }, now) }, destinations: [], current: null }, invoke);
      expect(invoke).toHaveBeenCalledTimes(1);
      const idea = await actOnResearchFinding(team, { id: finding.id, action: 'save_idea' });
      const text = execute({ queries: [{ sql: 'SELECT text FROM ideas WHERE id=?', params: [idea.ideaId] }] })[0].results[0].text;
      expect(text).toContain(`Publication date unknown\nFirst seen: ${new Date(firstSeen).toISOString()}`);
      expect(text).not.toContain('Published:');
      const withoutWatch = `${team}-without-watch`;
      execute({ queries: [
        { sql: "INSERT INTO research_runs(id,team_id,mode,status,days,editorial,created_at,icp,source_count,source_ids) VALUES(?,?,'scan','collecting',1,0,?,'Product teams',1,?)", params: [withoutWatch, team, now + 1, JSON.stringify([search.id])] },
        { sql: "INSERT INTO research_run_sources(id,run_id,source_id,status) VALUES(?,?,?,'completed')", params: [`${withoutWatch}:${search.id}`, withoutWatch, search.id] },
      ] });
      expect(await processResearchJob({ operation: 'rank', runId: withoutWatch })).toEqual({ ok: true, pending: false });
      expect(await getRunResearchFindings(team, withoutWatch)).toEqual([]);
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally {
      storageFault = undefined; seed.pageMode = previousMode; seed.url = previousUrl; RESEARCH_SOURCE_SEEDS.splice(sourceCount); fetcher.mockRestore(); clock.mockRestore();
      if (previousKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = previousKey;
    }
  }, 30_000);

  it.each([false, true])("preserves legacy screen counts and explicitly reports a missing selected body: %s", async sourceMissing => {
    const team = `legacy-routing-${sourceMissing}`, runId = `${team}-run`, now = Date.now();
    const seed = RESEARCH_SOURCE_SEEDS.find(source => source.kind === "rss" && source.feedUrl)!;
    const quote = "The team reviews the proposed requirements before implementation and persists decision context.";
    execute({ queries: [
      { sql: "INSERT INTO teams(id,name,slug,created_at,updated_at) VALUES(?,?,?,0,0)", params: [team, team, team] },
      { sql: "INSERT INTO research_runs(id,team_id,mode,status,days,editorial,created_at,icp,source_count,source_ids) VALUES(?,?,'scan','ranking',7,0,?,'Product practitioners',1,?)", params: [runId, team, now, JSON.stringify([seed.id])] },
      { sql: "INSERT INTO research_run_sources(id,run_id,source_id,status) VALUES(?,?,?,'completed')", params: [`${runId}-step`, runId, seed.id] },
      ...[...(sourceMissing ? [] : ["legacy-selected"]), "new-incomplete"].map(id => ({
        sql: "INSERT INTO research_items(id,team_id,source_id,canonical_url,title,excerpt,published_at,collected_at,content) VALUES(?,?,?,?,?,?,?,?,?)",
        params: [`${team}-${id}`, team, seed.id, `${new URL(seed.url).origin}/${team}-${id}`, id, quote, now - 1000, now, id === "legacy-selected" ? quote.repeat(8) : null],
      })),
      { sql: "INSERT INTO research_cache(id,team_id,value,created_at) VALUES(?,?,?,?)", params: [`rank-progress:${runId}`, team, JSON.stringify({ candidateIds: [`${team}-legacy-selected`, `${team}-new-incomplete`], discoveryCutoff: now, screenOffset: 1, selectedIds: [`${team}-legacy-selected`], nextOffset: 0, diagnostics: { eligibleCount: 2, screenedCount: 1, shortlistedCount: 1, evidenceCount: 0, rejectedStories: [] }, coverageWarning: null }), now] },
    ] });
    const previousKey = process.env.ANTHROPIC_API_KEY; process.env.ANTHROPIC_API_KEY = "test-legacy-routing";
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const request = JSON.parse(String(init?.body)), input = JSON.parse(request.messages[0].content);
      const value = fixtureResearchSchema(request).properties.assessments ? screeningFixture({ itemIds: [] }, input.items)
        : { findings: [{ itemId: `${team}-legacy-selected`, score: 85, summary: "An attributed requirements method", evidence: quote, contentAngle: "Review requirements before implementation", whyItMatters: "A product-team handoff", limitations: "No outcome proof", familyKey: `${team}-method` }] };
      return modelResponseFixture({ status: "completed", usage: { input_tokens: 10, output_tokens: 5 }, output: [{ content: [{ type: "output_text", text: JSON.stringify(value) }] }] });
    });
    try {
      await finishResearchRankJob(runId);
      const [run] = execute({ queries: [{ sql: "SELECT findings_count,diagnostics FROM research_runs WHERE id=?", params: [runId] }] })[0].results;
      const diagnostics = JSON.parse(run.diagnostics);
      expect(diagnostics).toMatchObject({ routedCount: 2, directEvidenceCount: 0, screenedCount: 2, incompleteScreenedCount: 1, shortlistedCount: 1, evidenceCount: sourceMissing ? 0 : 1 });
      expect(run.findings_count).toBe(sourceMissing ? 0 : 1);
      expect(fetcher).toHaveBeenCalledTimes(sourceMissing ? 1 : 2);
      if (sourceMissing) expect(diagnostics.rejectedStories).toContainEqual({ title: `${team}-legacy-selected`, score: null, reason: "Public evidence unavailable: the frozen selected item no longer exists." });
    } finally { fetcher.mockRestore(); if (previousKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = previousKey; }
  }, 20_000);
  it("screens every eligible item beyond one thousand using a frozen, resumable queue", async () => {
    const seed = RESEARCH_SOURCE_SEEDS.find(source => source.kind === "rss" && source.feedUrl)!;
    const now = Date.now();
    const quote = "The final source documents a concrete onboarding decision and its tradeoff.";
    const items = Array.from({ length: 1005 }, (_, index) => ({ id: `uncapped-item-${index}`, title: `Workflow ${index}` }));
    const insertItem = (id: string, title: string, at: number) => ({
      sql: "INSERT INTO research_items(id,team_id,source_id,canonical_url,title,excerpt,published_at,collected_at,content) VALUES(?,'uncapped-screen',?,?,?,?,?,?,?)",
      params: [id, seed.id, `${new URL(seed.url).origin}/${id}`, title, quote, at, now, quote],
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
      if (fixtureResearchSchema(request).properties.assessments) {
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

  it.each([
    { mode: 'committed reply lost', route: 'screen', sourceDisappears: false }, { mode: 'checkpoint outage', route: 'screen', sourceDisappears: false },
    { mode: 'committed reply lost', route: 'evidence', sourceDisappears: false }, { mode: 'checkpoint outage', route: 'evidence', sourceDisappears: false },
    { mode: 'checkpoint outage', route: 'screen', sourceDisappears: true },
  ])('preserves paid $route assessment through $mode (missing source: $sourceDisappears)', async ({ mode, route, sourceDisappears }) => {
    const teamId = `${mode === 'committed reply lost' ? 'storage-committed' : 'storage-exhausted'}-${route}${sourceDisappears ? '-missing' : ''}`;
    const runId = `${teamId}-run`;
    const seed = RESEARCH_SOURCE_SEEDS.find(source => source.kind === 'rss' && source.feedUrl)!;
    const now = Date.now();
    execute({ queries: [
      { sql: 'INSERT INTO teams(id,name,slug,created_at,updated_at) VALUES(?,?,?,0,0)', params: [teamId, teamId, teamId] },
      { sql: "INSERT INTO research_runs(id,team_id,mode,status,days,editorial,created_at,icp,source_count,source_ids) VALUES(?,?,'scan','collecting',1,0,?,'Product managers',1,?)", params: [runId, teamId, now, JSON.stringify([seed.id])] },
      { sql: "INSERT INTO research_run_sources(id,run_id,source_id,status) VALUES(?,?,?,'completed')", params: [`${teamId}-step`, runId, seed.id] },
      { sql: 'INSERT INTO research_items(id,team_id,source_id,canonical_url,title,excerpt,published_at,collected_at,content) VALUES(?,?,?,?,?,?,?,?,?)', params: [`${teamId}-item`, teamId, seed.id, `${new URL(seed.url).origin}/${teamId}`, 'A general update', 'No concrete mechanism.', now - 1000, now, 'No concrete mechanism. '.repeat(route === 'evidence' ? 30 : 1)] },
    ] });
    const previousKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'test-storage';
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      const input = JSON.parse(request.input ?? request.messages[0].content);
      const value = route === 'screen' ? screeningFixture({ itemIds: [] }, input.items) : { findings: [{ itemId: `${teamId}-item`, score: 20, summary: 'Generic promotion', evidence: '', contentAngle: 'No supported method', whyItMatters: 'Off-profile', limitations: 'No concrete mechanism', familyKey: 'generic-update' }] };
      return modelResponseFixture({ status: 'completed', usage: { input_tokens: 20, output_tokens: 10 }, output: [{ content: [{ type: 'output_text', text: JSON.stringify(value) }] }] });
    });
    let cacheFailures = 0;
    const cacheWrites: unknown[][] = [];
    const checkpointWrites: unknown[][] = [];
    storageFault = (queries, phase) => {
      const cache = queries.find(query => query.sql.startsWith('insert into "research_cache"') && query.params.some(param => typeof param === 'string' && /^[a-f0-9]{64}$/.test(param)));
      if (mode === 'committed reply lost' && phase === 'after' && cache) {
        cacheWrites.push([...cache.params]);
        if (cacheFailures++ === 0) throw new Error('Network connection lost.');
      }
      const checkpoint = queries.find(query => query.params.includes(`rank-progress:${runId}`) && query.params.some(param => typeof param === 'string' && param.includes(route === 'screen' ? '"screenOffset":1' : '"nextOffset":1')));
      if (checkpoint && phase === (mode === 'committed reply lost' ? 'after' : 'before')) {
        expect(queries).toHaveLength(2);
        expect(queries[1].sql.toLowerCase()).toContain('update');
        checkpointWrites.push([...checkpoint.params]);
        if (mode === 'checkpoint outage' || checkpointWrites.length === 1) throw new Error('D1_ERROR: Network connection lost.');
      }
    };
    try {
      if (mode === 'checkpoint outage') {
        await expect(processResearchJob({ operation: 'rank', runId })).rejects.toThrow('Network connection lost');
        expect(checkpointWrites).toHaveLength(3);
        const checkpoint = execute({ queries: [{ sql: 'SELECT value FROM research_cache WHERE id=?', params: [`rank-progress:${runId}`] }] })[0].results[0];
        expect(JSON.parse(checkpoint.value)[route === 'screen' ? 'screenOffset' : 'nextOffset']).toBe(0);
        expect(execute({ queries: [{ sql: `SELECT COUNT(*) count FROM research_cache WHERE team_id=? AND json_type(value,'$.${route === 'screen' ? 'assessments' : 'findings'}')='array'`, params: [teamId] }] })[0].results[0].count).toBe(1);
        if (sourceDisappears) execute({ queries: [{ sql: 'DELETE FROM research_items WHERE team_id=?', params: [teamId] }] });
        else if (route === 'screen') execute({ queries: [{ sql: 'UPDATE research_items SET excerpt=? WHERE team_id=?', params: ['Refreshed metadata must not change the already-paid frozen screening input.', teamId] }] });
        storageFault = undefined;
      }
      expect(await processResearchJob({ operation: 'rank', runId })).toEqual({ ok: true, pending: false });
      expect(fetcher).toHaveBeenCalledTimes(1);
      const [checkpoint, run, usage] = execute({ queries: [
        { sql: 'SELECT value FROM research_cache WHERE id=?', params: [`rank-progress:${runId}`] },
        { sql: 'SELECT diagnostics,input_tokens,output_tokens,cache_hits FROM research_runs WHERE id=?', params: [runId] },
        { sql: 'SELECT COUNT(*) count FROM research_usage WHERE run_id=?', params: [runId] },
      ] }).map((result: { results: unknown[] }) => result.results[0]);
      expect(JSON.parse(checkpoint.value)).toMatchObject({ screenOffset: 1, diagnostics: { routedCount: 1, directEvidenceCount: route === 'evidence' ? 1 : 0, screenedCount: route === 'screen' ? 1 : 0, evidenceCount: route === 'evidence' ? 1 : 0, rejectedStories: [{ title: 'A general update' }] } });
      expect(JSON.parse(run.diagnostics).screenedCount).toBe(route === 'screen' ? 1 : 0);
      expect(run).toMatchObject({ input_tokens: 20, output_tokens: 10, cache_hits: mode === 'checkpoint outage' ? 1 : 0 });
      expect(usage.count).toBe(1);
      expect(checkpointWrites.slice(0, mode === 'checkpoint outage' ? 3 : 2).every(params => JSON.stringify(params) === JSON.stringify(checkpointWrites[0]))).toBe(true);
      if (mode === 'committed reply lost') {
        expect(cacheWrites).toHaveLength(2);
        expect(cacheWrites[1]).toEqual(cacheWrites[0]);
      }
    } finally {
      storageFault = undefined;
      fetcher.mockRestore();
      if (previousKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = previousKey;
    }
  }, 30_000);

  it('records usage exactly once when begin and finish commit before their replies are lost', async () => {
    const context = { teamId: 'a', runId: 'storage-usage-run', stage: 'research' as const, operation: 'screen' };
    execute({ queries: [{ sql: "INSERT INTO research_runs(id,team_id,mode,status,days,created_at,icp) VALUES(?,'a','scan','ranking',1,?,'ICP')", params: [context.runId, Date.now()] }] });
    const insertWrites: unknown[][] = [];
    let finishWrites = 0;
    storageFault = (queries, phase) => {
      if (phase !== 'after') return;
      const insert = queries.find(query => query.sql.startsWith('insert into "research_usage"'));
      if (insert) {
        insertWrites.push([...insert.params]);
        if (insertWrites.length === 1) throw new Error('Network connection lost.');
      }
      if (queries.length === 2 && queries.some(query => query.sql.includes('update "research_usage"'))) {
        if (finishWrites++ === 0) throw new Error('Network connection lost.');
      }
    };
    try {
      const id = await beginResearchUsage(context, 'gpt-6-luna');
      await finishResearchUsage(id, context, { model: 'gpt-6-luna', tier: 'default', status: 'completed', usage: { input_tokens: 123, output_tokens: 45 } });
      expect(insertWrites).toHaveLength(2);
      expect(insertWrites[1]).toEqual(insertWrites[0]);
      expect(finishWrites).toBe(2);
      expect(execute({ queries: [{ sql: 'SELECT input_tokens,output_tokens FROM research_runs WHERE id=?', params: [context.runId] }] })[0].results).toEqual([{ input_tokens: 123, output_tokens: 45 }]);
      expect(execute({ queries: [{ sql: 'SELECT id,status,input_tokens,output_tokens FROM research_usage WHERE run_id=?', params: [context.runId] }] })[0].results).toEqual([{ id, status: 'completed', input_tokens: 123, output_tokens: 45 }]);
    } finally {
      storageFault = undefined;
    }
  });

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
      if (fixtureResearchSchema(request).properties.assessments) {
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
      expect(screenCalls).toBe(0);
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
  }, 180_000);

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
