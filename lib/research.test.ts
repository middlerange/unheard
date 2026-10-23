import {
  getResearchProfiles,
  updateResearchProfile,
} from "./research-profiles";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
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
import { validateResearchEvidence } from "./research-model";
import {
  processResearchDraftJob,
  rewriteResearchDraftContent,
} from "./research-drafts";
import type { ResearchSourceSeed } from "./research-types";
import { RESEARCH_SOURCE_SEEDS } from "./research-sources";
const state = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("./db/client", () => ({ getDb: async () => state.db }));
import {
  actOnResearchFinding,
  createResearchRun,
  getResearchSnapshot,
  initializeResearch,
  processResearchJob,
  updateResearchSource,
} from "./research";
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
  const python = `import json,sqlite3,sys\np=json.load(sys.stdin)\nc=sqlite3.connect(p['path'])\nc.row_factory=sqlite3.Row\nc.execute('PRAGMA foreign_keys=ON')\nif 'script' in p:\n c.executescript(p['script']); c.commit(); print('[]')\nelse:\n out=[]\n for q in p['queries']:\n  cur=c.execute(q['sql'],q.get('params',[])); out.append({'results':[dict(r) for r in cur.fetchall()],'success':True,'meta':{}})\n c.commit(); print(json.dumps(out))`;
  function execute(payload: object) {
    const result = spawnSync("python3", ["-c", python], {
      input: JSON.stringify({ path, ...payload }),
      encoding: "utf8",
    });
    if (result.status !== 0) throw new Error(result.stderr);
    return JSON.parse(result.stdout);
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
  it("collects RSS over HTTP once per source step and leaves undated items unknown", async () => {
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
    } finally {
      fetcher.mockRestore();
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
    const content = `${evidence} ${"Detailed first hand lessons and practical context. ".repeat(20)}`;
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
          sql: "INSERT INTO research_items(id,team_id,source_id,canonical_url,title,excerpt,published_at,collected_at) VALUES(?,?,?,?,?,?,?,?)",
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
          ],
        })),
      ],
    });
    const previousKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-key";
    const screenedIds: string[] = [];
    const fetcher = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (url, init) => {
        if (String(url).startsWith("https://api.openai.com/")) {
          const request = JSON.parse(String(init?.body));
          const input = JSON.parse(request.input);
          const extraction = String(request.instructions).includes(
            "Act as a strict",
          );
          let value: unknown;
          if (extraction)
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
          else {
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
          return Response.json({
            status: "completed",
            output: [
              {
                content: [{ type: "output_text", text: JSON.stringify(value) }],
              },
            ],
            usage: { input_tokens: 20, output_tokens: 10 },
          });
        }
        expect(String(url)).toBe(articleUrl);
        return new Response(`<article>${content}</article>`);
      });
    try {
      await processResearchJob({ operation: "rank", runId: "ranking-run" });
      expect(screenedIds).toHaveLength(81);
      expect(screenedIds).toContain("rank-item-80");
      expect(
        (await getResearchSnapshot("a")).findings.some(
          (finding) => finding.itemId === "rank-item-80",
        ),
      ).toBe(true);
      expect(
        execute({
          queries: [
            {
              sql: "SELECT input_tokens FROM research_runs WHERE id='ranking-run'",
            },
          ],
        })[0].results,
      ).toEqual([{ input_tokens: 60 }]);
      execute({
        queries: [
          {
            sql: "UPDATE research_runs SET status='ranking' WHERE id='ranking-run'",
          },
        ],
      });
      await processResearchJob({ operation: "rank", runId: "ranking-run" });
      expect(fetcher).toHaveBeenCalledTimes(4);
      expect(
        execute({
          queries: [
            {
              sql: "SELECT cache_hits FROM research_runs WHERE id='ranking-run'",
            },
          ],
        })[0].results,
      ).toEqual([{ cache_hits: 3 }]);
    } finally {
      fetcher.mockRestore();
      if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previousKey;
    }
  }, 20_000);
  it("dispatches one editorial scan of exactly24hours daily, with model work in durable steps", async () => {
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
    process.env.OPENAI_API_KEY = "test-daily-key";
    try {
      expect(await processResearchJob({ operation: "daily" })).toEqual({
        dispatched: 1,
      });
      expect(await processResearchJob({ operation: "daily" })).toEqual({
        dispatched: 0,
      });
      expect(dispatch).toHaveBeenCalledTimes(1);
      expect((await getResearchSnapshot("daily")).runs[0]).toMatchObject({
        mode: "scan",
        days: 1,
        editorial: true,
      });
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      fetcher.mockRestore();
      if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previousKey;
    }
  }, 20_000);
  it("keeps a daily scan due when a manual discovery run occupies the workflow", async () => {
    execute({ queries: [
      { sql: "UPDATE research_settings SET daily_enabled=0" },
      { sql: "INSERT INTO teams(id,name,slug,created_at,updated_at) VALUES('manual-busy','Busy','manual-busy',0,0)" },
    ] });
    await initializeResearch("manual-busy");
    const previousKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-daily-key";
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
            now,
          ],
        })),
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
      });
      expect(snapshot.findings).toHaveLength(0);
    } finally {
      fetcher.mockRestore();
    }
  }, 20_000);
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
          { id: "weak", at: now - 1000, score: 79 },
          { id: "best", at: now - 86400000, score: 95 },
          { id: "runner", at: now - 1000, score: 90 },
          { id: "third", at: now - 1000, score: 85 },
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
          sql: "UPDATE research_runs SET source_ids='[\"practitioner\"]' WHERE id='editorial-run'",
        },
        {
          sql: "INSERT INTO research_runs(id,team_id,mode,status,days,created_at,icp) VALUES('editorial-manual-run','editorial','scan','completed',30,?,'ICP')",
          params: [now - 1],
        },
        {
          sql: "UPDATE research_findings SET run_id='editorial-manual-run' WHERE id='ed-finding-third'",
        },
      ],
    });
    const priorKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-editorial-key";
    const fetcher = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (url, init) => {
        expect(String(url)).toBe("https://api.openai.com/v1/responses");
        const data = JSON.parse(String(init?.body));
        const input = JSON.parse(data.input);
        expect(["best", "runner", "third"]).toContain(input.source.title);
        return Response.json({
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
                          ready: true,
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
      expect(await processResearchDraftJob("editorial-run")).toEqual({
        drafted: 2,
      });
      expect(await processResearchDraftJob("editorial-run")).toEqual({
        drafted: 2,
      });
      expect(fetcher).toHaveBeenCalledTimes(3);
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
        inputTokens: 90,
        outputTokens: 120,
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
      ).toBe(30);
      expect(
        (
          await rewriteResearchDraftContent(
            snapshot.drafts[0].id,
            "editorial",
            "Shorten it",
          )
        ).inputTokens,
      ).toBe(0);
      expect(fetcher).toHaveBeenCalledTimes(4);
      // Replaying rank after a manual30-day scan must never generate approval drafts.
      execute({
        queries: [
          { sql: "UPDATE research_runs SET days=30 WHERE id='editorial-run'" },
        ],
      });
      expect(await processResearchDraftJob("editorial-run")).toEqual({
        drafted: 0,
        skipped: true,
      });
      expect(fetcher).toHaveBeenCalledTimes(4);
    } finally {
      fetcher.mockRestore();
      if (priorKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = priorKey;
    }
  }, 20_000);
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
      execute({ queries: [{ sql: "SELECT COUNT(*) AS count FROM ideas" }] })[0]
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
