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
  it("dispatches daily collection once per day without making model requests", async () => {
    execute({ queries: [
      { sql: "UPDATE research_settings SET daily_enabled=0" },
      { sql: "INSERT INTO teams(id,name,slug,created_at,updated_at) VALUES('daily','Daily','daily',0,0)" },
    ] });
    await initializeResearch("daily");
    const dispatch = vi.fn(async () => ({}));
    globalThis.__contentHubResearchWorkflow__ = { create: dispatch };
    const fetcher = vi.spyOn(globalThis, "fetch");
    try {
      expect(await processResearchJob({ operation: "daily" })).toEqual({ dispatched: 1 });
      expect(await processResearchJob({ operation: "daily" })).toEqual({ dispatched: 0 });
      expect(dispatch).toHaveBeenCalledTimes(1);
      expect((await getResearchSnapshot("daily")).runs[0].mode).toBe("collect");
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      fetcher.mockRestore();
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
