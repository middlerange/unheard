import {
  afterEach,
  beforeAll,
  afterAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";
vi.setConfig({ testTimeout: 30_000 });
const state = vi.hoisted(() => ({
  db: undefined as unknown,
  published: vi.fn(),
  rewrite: vi.fn(),
}));
vi.mock("./db/client", () => ({ getDb: async () => state.db }));
vi.mock("./publisher", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./publisher")>()),
  publishApprovedPost: state.published,
}));
vi.mock("./research-drafts", () => ({
  rewriteResearchDraftContent: state.rewrite,
}));
import { encrypt } from "./crypto";
import {
  getSlackSettings,
  updateSlackSettings,
  verifySlackRequest,
  testSlackConnection,
} from "./slack";
import { handleSlackEvents, handleSlackInteractions } from "./slack-ingress";
import {
  enqueueSlackJob,
  getResearchDraft,
  processSlackJob,
  queueResearchDraftForSlack,
  hasPendingSlackEdits,
  retrySlackReview,
  buildSlackReviewPacket,
} from "./slack-review";
import { buildApprovalSnapshot } from "./approval";
import {
  getPostWithDetails,
  listPostsWithDetails,
  getDueScheduledPosts,
} from "./db/queries";
import { targetsPendingPublication } from "./publisher";
import { createSlackTestReview } from "./slack-test-review";
import { assertNotSlackManagedPost } from "./slack-post-lock";
import { saveResearchFindingSnapshot } from "./research-finding-snapshots";

const folder = mkdtempSync(join(tmpdir(), "content-hub-slack-")),
  path = join(folder, "db.sqlite");
const python = `import json,sqlite3,sys\np=json.load(sys.stdin)\nc=sqlite3.connect(p['path']);c.row_factory=sqlite3.Row;c.execute('PRAGMA foreign_keys=ON')\nif 'script' in p:\n c.executescript(p['script']);c.commit();print('[]')\nelse:\n out=[]\n for q in p['queries']:\n  cur=c.execute(q['sql'],q.get('params',[]));out.append({'results':[dict(r) for r in cur.fetchall()],'success':True,'meta':{'changes':cur.rowcount}})\n c.commit();print(json.dumps(out))`;
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
    return (await this.all()).results.map((r: Record<string, unknown>) =>
      Object.values(r),
    );
  }
  async run() {
    return this.all();
  }
}
const secret = "a".repeat(32),
  token = "xoxb-test-token";
async function signedRequest(
  body: string,
  path = "events",
  timestamp = Math.floor(Date.now() / 1000).toString(),
) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const buffer = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`v0:${timestamp}:${body}`),
  );
  const signature = Array.from(new Uint8Array(buffer), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  return new Request(`https://example.com/api/slack/${path}`, {
    method: "POST",
    headers: {
      "x-slack-request-timestamp": timestamp,
      "x-slack-signature": `v0=${signature}`,
    },
    body,
  });
}
function run(sql: string, params: unknown[] = []) {
  return execute({ queries: [{ sql, params }] })[0];
}
function row(sql: string) {
  return run(sql).results[0];
}
function finding(id: string) {
  run(
    "INSERT INTO research_items(id,team_id,source_id,canonical_url,title,excerpt,collected_at)VALUES(?,'a','source',?,'Title','Excerpt',1)",
    [`item-${id}`, `https://example.com/${id}`],
  );
  run(
    `INSERT INTO research_findings(id,team_id,run_id,item_id,source_id,title,url,published_at,score,summary,why_it_matters,content_angle,evidence,limitations,created_at,family_key) VALUES(?, 'a','run',?,'source','Strong practitioner lesson','https://example.com/article',1,90,'Summary','Fits product leaders','Angle','Exact source statement supports this claim','Practitioner opinion',1,?)`,
    [id, `item-${id}`, id],
  );
}
function draft(id: string) {
  finding(id);
  run(
    `INSERT INTO research_drafts(id,team_id,run_id,finding_id,content,created_at,updated_at)VALUES(?,'a','run',?,?,1,1)`,
    [
      id,
      id,
      JSON.stringify({
        targets: [
          {
            channelId: "channel",
            platform: "linkedin",
            content:
              "A practical product observation. https://example.com/article",
            thread: [],
          },
        ],
      }),
    ],
  );
}
const response = () =>
  new Response(JSON.stringify({ ok: true, ts: "123.456" }), {
    headers: { "content-type": "application/json" },
  });
const fetcher = vi.fn(async (_url?: RequestInfo | URL, _init?: RequestInit) =>
  response(),
);
beforeAll(async () => {
  process.env.CREDENTIALS_ENCRYPTION_KEY = "a".repeat(64);
  execute({
    script: readdirSync("drizzle-d1")
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .map((f) => readFileSync(join("drizzle-d1", f), "utf8"))
      .join("\n"),
  });
  state.db = drizzle(
    {
      prepare: (sql: string) => new Statement(sql),
      batch: async (queries: Statement[]) => execute({ queries }),
    } as never,
    { schema },
  );
  run(
    "INSERT INTO teams(id,name,slug,created_at,updated_at)VALUES('a','A','a',1,1),('b','B','b',1,1)",
  );
  run(
    "INSERT INTO channels(id,team_id,name,platform,account_type,account_id,group_name,credentials,created_at,research_enabled,system_prompt)VALUES('channel','a','Test profile','linkedin','personal','account-1','personal','encrypted',1,1,'Write for product leaders')",
  );
  run(
    "INSERT INTO research_runs(id,team_id,mode,status,days,created_at,icp)VALUES('run','a','scan','completed',1,1,'Product leaders')",
  );
  run(
    "INSERT INTO research_items(id,team_id,source_id,canonical_url,title,excerpt,collected_at)VALUES('item','a','source','https://example.com/article','Title','Excerpt',1)",
  );
  const credentials = await encrypt(
    JSON.stringify({ botToken: token, signingSecret: secret }),
  );
  run(
    "INSERT INTO slack_integrations(team_id,workspace_id,channel_id,approver_user_ids,credentials,enabled,created_at,updated_at)VALUES('a','T12345678','C12345678','[\"U12345678\"]',?,1,1,1)",
    [credentials],
  );
});
afterAll(() => rmSync(folder, { recursive: true, force: true }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  fetcher.mockClear();
  state.published.mockReset();
  state.rewrite.mockReset();
});
describe("Slack signing and safe integration configuration", () => {
  it("checks exact raw bytes and rejects stale or altered requests", async () => {
    const body = JSON.stringify({
        type: "event_callback",
        team_id: "T12345678",
      }),
      request = await signedRequest(body);
    expect(await verifySlackRequest(request, body, secret)).toBe(true);
    expect(await verifySlackRequest(request, `${body} `, secret)).toBe(false);
    expect(
      await verifySlackRequest(
        await signedRequest(body, "events", "1000000000"),
        body,
        secret,
      ),
    ).toBe(false);
  });
  it("returns no decrypted secrets and isolates settings by team", async () => {
    const settings = await getSlackSettings("a");
    expect(settings.configured).toBe(true);
    expect(JSON.stringify(settings)).not.toContain(token);
    expect(JSON.stringify(settings)).not.toContain(secret);
    expect((await getSlackSettings("b")).configured).toBe(false);
  });
  it("validates bot workspace, membership, and explicit human approvers before saving", async () => {
    const api = vi.fn(
      async (url: RequestInfo | URL) =>
        new Response(
          JSON.stringify(
            String(url).endsWith("auth.test")
              ? { ok: true, team_id: "T12345678", user_id: "UBOT12345" }
              : String(url).endsWith("conversations.info")
                ? {
                    ok: true,
                    channel: {
                      id: "C12345678",
                      name: "approvals",
                      is_member: true,
                    },
                  }
                : {
                    ok: true,
                    user: {
                      id: "U12345678",
                      team_id: "T12345678",
                      is_bot: false,
                    },
                  },
          ),
        ),
    );
    vi.stubGlobal("fetch", api);
    await expect(
      updateSlackSettings("b", {
        botToken: token,
        signingSecret: secret,
        channelId: "C12345678",
        approverUserIds: ["U12345678"],
        enabled: true,
      }),
    ).rejects.toThrow("another Content Hub team");
    expect(api).toHaveBeenCalledTimes(3);
  });
  it("answers a signed setup challenge without model or Slack API calls", async () => {
    vi.stubGlobal("fetch", fetcher);
    const body = JSON.stringify({
      type: "url_verification",
      challenge: "challenge",
    });
    expect(
      await (await handleSlackEvents(await signedRequest(body))).json(),
    ).toEqual({ challenge: "challenge" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
describe("Slack review threads and approval safety", () => {
  it("delivers the original run's qualification after another run requalifies the source", async () => {
    draft("historical-review");
    const original = await getResearchDraft("a", "historical-review");
    await saveResearchFindingSnapshot(row("SELECT * FROM research_findings WHERE id='historical-review'"));
    run("INSERT INTO research_runs(id,team_id,mode,status,days,created_at,icp)VALUES('rescan-review','a','scan','completed',1,2,'Product leaders')");
    run("UPDATE research_findings SET run_id='rescan-review',title='Changed later title',url='https://example.com/later',score=75,why_it_matters='Later qualification implication',evidence='Later source claim replaces the original assessment' WHERE id='historical-review'");
    const historicalFetch = vi.fn(async (_url?: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ ok: true, ts: "124.456" }), { headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", historicalFetch);
    const job = await queueResearchDraftForSlack("historical-review");
    await expect(processSlackJob(job.jobId)).resolves.toEqual({ status: "completed" });
    const packet = JSON.stringify(JSON.parse(String(historicalFetch.mock.calls[0]?.[1]?.body)));
    expect(packet).toContain("Strong practitioner lesson");
    expect(packet).toContain("Fits product leaders");
    expect(packet).toContain("Exact source statement supports this claim");
    expect(packet).not.toContain("Later qualification implication");
    expect(packet).not.toContain("Later source claim");
    expect(packet).not.toContain("Changed later title");
    const saved = await getResearchDraft("a", "historical-review");
    expect(saved).toMatchObject({ content: original!.content, revision: original!.revision, status: "pending" });
    expect(row("SELECT state FROM posts WHERE id='research-historical-review'").state).toBe("awaiting_approval");
    expect(state.published).not.toHaveBeenCalled();
  });
  it("delivers an exact destination preview and never publishes when sending", async () => {
    draft("initial");
    vi.stubGlobal("fetch", fetcher);
    const job = await queueResearchDraftForSlack("initial");
    await expect(processSlackJob(job.jobId)).resolves.toEqual({
      status: "completed",
    });
    const saved = await getResearchDraft("a", "initial");
    expect(saved?.status).toBe("pending");
    expect(saved?.post_id).toBe("research-initial");
    expect(
      row("SELECT state FROM posts WHERE id='research-initial'").state,
    ).toBe("awaiting_approval");
    const packet = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    expect(JSON.stringify(packet)).toContain("account-1");
    expect(JSON.stringify(packet)).toContain("Approve & publish");
    expect(
      packet.blocks.some(
        (b: { text?: { type: string; text: string } }) =>
          b.text?.type === "plain_text" &&
          b.text.text.includes("A practical product observation."),
      ),
    ).toBe(true);
    expect(state.published).not.toHaveBeenCalled();
  });
  it("acknowledges signed callbacks while disabled without enqueuing work", async () => {
    run("UPDATE slack_integrations SET enabled=0 WHERE team_id='a'");
    const body = JSON.stringify({
      type: "event_callback",
      team_id: "T12345678",
      event_id: "EvDisabled",
      event: {
        type: "message",
        channel: "C12345678",
        thread_ts: "123.456",
        user: "U12345678",
        text: "Change this draft",
      },
    });
    try {
      expect((await handleSlackEvents(await signedRequest(body))).status).toBe(
        200,
      );
      expect(
        row("SELECT count(*) AS n FROM slack_jobs WHERE id='event-EvDisabled'")
          .n,
      ).toBe(0);
    } finally {
      run("UPDATE slack_integrations SET enabled=1 WHERE team_id='a'");
    }
  });
  it("deduplicates human edit events and ignores bots, outsiders, other threads, and message changes", async () => {
    const event = {
      type: "message",
      channel: "C12345678",
      thread_ts: "123.456",
      user: "U12345678",
      text: "Make this shorter",
    };
    const body = JSON.stringify({
      type: "event_callback",
      team_id: "T12345678",
      event_id: "EvEdit1",
      event,
    });
    expect((await handleSlackEvents(await signedRequest(body))).status).toBe(
      200,
    );
    await handleSlackEvents(await signedRequest(body));
    expect(
      row("SELECT count(*) AS n FROM slack_jobs WHERE id='event-EvEdit1'").n,
    ).toBe(1);
    for (const [index, mutation] of [
      { bot_id: "B123" },
      { user: "UOUTSIDE1" },
      { thread_ts: "wrong" },
      { subtype: "message_changed" },
    ].entries()) {
      const ignored = JSON.stringify({
        type: "event_callback",
        team_id: "T12345678",
        event_id: `EvIgnore${index}`,
        event: { ...event, ...mutation },
      });
      await handleSlackEvents(await signedRequest(ignored));
    }
    expect(
      row(
        "SELECT count(*) AS n FROM slack_jobs WHERE id LIKE 'event-EvIgnore%'",
      ).n,
    ).toBe(0);
    expect(await hasPendingSlackEdits("a", "initial")).toBe(true);
  });
  it("refuses approval while an earlier edit is queued", async () => {
    vi.stubGlobal("fetch", fetcher);
    const current = await getResearchDraft("a", "initial");
    const value = JSON.stringify({
      draftId: "initial",
      revision: current!.revision,
      snapshotHash: current!.snapshot_hash,
    });
    const body = new URLSearchParams({
      payload: JSON.stringify({
        type: "block_actions",
        team: { id: "T12345678" },
        user: { id: "U12345678" },
        channel: { id: "C12345678" },
        message: { ts: current!.slack_message_ts },
        actions: [{ action_id: "research_approve", value, action_ts: "123.7" }],
      }),
    }).toString();
    expect(
      (await handleSlackInteractions(await signedRequest(body, "interactions")))
        .status,
    ).toBe(200);
    expect(
      row("SELECT count(*) AS n FROM slack_jobs WHERE kind='approve'").n,
    ).toBe(0);
    expect(state.published).not.toHaveBeenCalled();
  });
  it("turns thread instructions into a new exact preview; text approval never publishes", async () => {
    vi.stubGlobal("fetch", fetcher);
    state.rewrite.mockResolvedValue({
      content: {
        targets: [
          {
            channelId: "channel",
            platform: "linkedin",
            content: "Shorter copy. https://example.com/article",
            thread: [],
          },
        ],
      },
      inputTokens: 100,
      outputTokens: 20,
    });
    await processSlackJob("event-EvEdit1");
    const current = await getResearchDraft("a", "initial");
    expect(current?.revision).toBe(2);
    expect(current?.status).toBe("pending");
    expect(current?.input_tokens).toBe(100);
    expect(
      row("SELECT content FROM post_targets WHERE post_id='research-initial'")
        .content,
    ).toContain("Shorter copy");
    expect(
      row(
        "SELECT count(*) AS n FROM research_draft_revisions WHERE draft_id='initial'",
      ).n,
    ).toBe(1);
    expect(state.published).not.toHaveBeenCalled();
  });
  it("rejects stale revisions and publishing snapshots changed outside Slack", async () => {
    vi.stubGlobal("fetch", fetcher);
    const current = await getResearchDraft("a", "initial");
    const stale = await enqueueSlackJob("a", "approve", {
      draftId: "initial",
      revision: 1,
      snapshotHash: current!.snapshot_hash!,
      userId: "U12345678",
      channelId: "C12345678",
      threadTs: "123.456",
      messageTs: current!.slack_message_ts!,
    });
    await processSlackJob(stale.jobId);
    expect(state.published).not.toHaveBeenCalled();
    run(
      "UPDATE channels SET account_id='different-account' WHERE id='channel'",
    );
    const changed = await enqueueSlackJob("a", "approve", {
      draftId: "initial",
      revision: 2,
      snapshotHash: current!.snapshot_hash!,
      userId: "U12345678",
      channelId: "C12345678",
      threadTs: "123.456",
      messageTs: current!.slack_message_ts!,
    });
    expect((await processSlackJob(changed.jobId)).status).toBe("failed");
    expect(state.published).not.toHaveBeenCalled();
    run("UPDATE channels SET account_id='account-1' WHERE id='channel'");
  });
  it("publishes only the matching button once, with exact stored copy", async () => {
    draft("publish");
    vi.stubGlobal("fetch", fetcher);
    await processSlackJob((await queueResearchDraftForSlack("publish")).jobId);
    state.published.mockImplementation(async (post: { id: string }) => {
      run("UPDATE posts SET state='published' WHERE id=?", [post.id]);
    });
    const current = await getResearchDraft("a", "publish");
    const payload = {
      draftId: "publish",
      revision: 1,
      snapshotHash: current!.snapshot_hash!,
      userId: "U12345678",
      channelId: "C12345678",
      threadTs: "123.456",
      messageTs: current!.slack_message_ts!,
    };
    const body = new URLSearchParams({
      payload: JSON.stringify({
        type: "block_actions",
        team: { id: "T12345678" },
        user: { id: "U12345678" },
        channel: { id: "C12345678" },
        message: { ts: current!.slack_message_ts },
        actions: [
          {
            action_id: "research_approve",
            value: JSON.stringify(payload),
            action_ts: "124.001",
          },
        ],
      }),
    }).toString();
    await handleSlackInteractions(await signedRequest(body, "interactions"));
    await handleSlackInteractions(await signedRequest(body, "interactions"));
    const jobs = run(
      "SELECT id FROM slack_jobs WHERE kind='approve' AND json_extract(payload,'$.draftId')='publish'",
    ).results;
    expect(jobs).toHaveLength(1);
    await processSlackJob(jobs[0].id);
    await processSlackJob(jobs[0].id);
    expect(state.published).toHaveBeenCalledTimes(1);
    expect(state.published.mock.calls[0][0].targets[0].content).toBe(
      "A practical product observation. https://example.com/article",
    );
    expect((await getResearchDraft("a", "publish"))?.status).toBe("published");
  });
  it("serializes rapid edits without losing instructions", async () => {
    draft("serial");
    vi.stubGlobal("fetch", fetcher);
    await processSlackJob((await queueResearchDraftForSlack("serial")).jobId);
    state.rewrite.mockImplementation(async () => ({
      content: {
        targets: [
          {
            channelId: "channel",
            platform: "linkedin",
            content: `Revision ${state.rewrite.mock.calls.length}. https://example.com/article`,
            thread: [],
          },
        ],
      },
      inputTokens: 1,
      outputTokens: 1,
    }));
    const first = await enqueueSlackJob(
      "a",
      "edit",
      {
        draftId: "serial",
        userId: "U12345678",
        text: "Make it concise",
        channelId: "C12345678",
        threadTs: "123.456",
      },
      "serial-first",
    );
    const second = await enqueueSlackJob(
      "a",
      "edit",
      {
        draftId: "serial",
        userId: "U12345678",
        text: "Add the practical implication",
        channelId: "C12345678",
        threadTs: "123.456",
      },
      "serial-second",
    );
    run("UPDATE slack_jobs SET created_at=10 WHERE id='serial-first'");
    run("UPDATE slack_jobs SET created_at=11 WHERE id='serial-second'");
    expect((await processSlackJob(second.jobId)).status).toBe("deferred");
    expect((await processSlackJob(first.jobId)).status).toBe("completed");
    expect((await processSlackJob(second.jobId)).status).toBe("completed");
    expect((await getResearchDraft("a", "serial"))?.revision).toBe(3);
    expect(state.rewrite).toHaveBeenCalledTimes(2);
    expect(state.published).not.toHaveBeenCalled();
  });
  it("invalidates approval when its publishing profile is disabled", async () => {
    draft("paused");
    vi.stubGlobal("fetch", fetcher);
    await processSlackJob((await queueResearchDraftForSlack("paused")).jobId);
    const current = await getResearchDraft("a", "paused");
    run("UPDATE channels SET research_enabled=0 WHERE id='channel'");
    const job = await enqueueSlackJob("a", "approve", {
      draftId: "paused",
      revision: 1,
      snapshotHash: current!.snapshot_hash!,
      userId: "U12345678",
      channelId: "C12345678",
      threadTs: "123.456",
      messageTs: current!.slack_message_ts!,
    });
    expect((await processSlackJob(job.jobId)).status).toBe("failed");
    expect(state.published).not.toHaveBeenCalled();
    run("UPDATE channels SET research_enabled=1 WHERE id='channel'");
  });
  it("keeps long research metadata inside Slack section limits", async () => {
    const snapshot = { version: 1 as const, post_id: 'metadata-packet', team_id: 'a', channel_group: 'personal', publish_at: null, targets: [], media: [] };
    const packet = buildSlackReviewPacket(
      { id: "long", revision: 1, content: JSON.stringify({
        editorial: {
          writingStyle: "b2b-growth-mechanism", alpha: "a".repeat(1200), readerDecision: "d".repeat(900),
        },
        sourceContext: { publishedAt: "2025-08-01T00:00:00.000Z", discoveredAt: "2026-10-27T00:00:00.000Z", signalKind: "evergreen_newly_discovered" },
      }) },
      snapshot,
      {
        title: "Title",
        url: "https://example.com/article",
        why_it_matters: "<".repeat(1600),
        limitations: ">".repeat(1600),
        evidence: "&".repeat(600),
      },
      "a".repeat(64),
    );
    for (const block of packet.blocks as Array<{
      type: string;
      text?: { text: string };
    }>) {
      if (block.type === "section")
        expect(block.text!.text.length).toBeLessThanOrEqual(3000);
    }
    expect(JSON.stringify(packet)).toContain("Writing style: growth mechanism");
    expect(JSON.stringify(packet)).toContain("Original publication: 2025-08-01");
    expect(JSON.stringify(packet)).toContain("not a new announcement");
    expect(JSON.stringify(packet)).toContain("Reader decision:");
  });
  it("keeps an undated reference's first observation out of the publication date", async () => {
    const snapshot = { version: 1 as const, post_id: 'undated-packet', team_id: 'a', channel_group: 'personal', publish_at: null, targets: [], media: [] };
    const firstSeen = Date.parse("2026-10-28T12:00:00Z");
    const packet = buildSlackReviewPacket(
      { id: "undated", revision: 1, content: JSON.stringify({ sourceContext: { publishedAt: null, discoveredAt: new Date(firstSeen).toISOString(), signalKind: "undated_reference" } }) },
      snapshot,
      { title: "Public resource", url: "https://example.com/resource", why_it_matters: "A bounded framework", limitations: "Date unknown", evidence: "A substantive public description", published_at: firstSeen, source_published_at: null, source_discovered_at: firstSeen, signal_kind: "undated_reference" },
      "a".repeat(64),
    );
    const text = JSON.stringify(packet);
    expect(text).toContain("Publication date unknown");
    expect(text).toContain(`first collected ${new Date(firstSeen).toISOString()}`);
    expect(text).not.toContain("Original publication:");
    expect(text).not.toContain("Published in this scan's window");
  });
  it("blocks mixed identities on legacy previews and before approval even if content is unchanged", async () => {
    run("INSERT INTO channels(id,team_id,name,platform,account_type,account_id,group_name,credentials,created_at,research_enabled,system_prompt)VALUES('identity-second','a','Another channel','twitter','personal','identity-second-account','personal','encrypted',1,1,'Write for product leaders')");
    draft("identity-boundary");
    const content = { targets: [
      { channelId: "channel", platform: "linkedin", content: "A source-backed observation. https://example.com/article", thread: [] },
      { channelId: "identity-second", platform: "twitter", content: "A source-backed observation. https://example.com/article", thread: [] },
    ] };
    run("UPDATE research_drafts SET content=? WHERE id='identity-boundary'", [JSON.stringify(content)]);
    vi.stubGlobal("fetch", fetcher);
    await processSlackJob((await queueResearchDraftForSlack("identity-boundary")).jobId);
    const pending = await getResearchDraft("a", "identity-boundary");
    expect(pending?.status).toBe("pending");
    run("UPDATE channels SET group_name='company' WHERE id='identity-second'");
    await processSlackJob((await enqueueSlackJob("a", "approve", {
      draftId: "identity-boundary", revision: pending!.revision, snapshotHash: pending!.snapshot_hash!,
      userId: "U12345678", channelId: "C12345678", threadTs: "123.456", messageTs: pending!.slack_message_ts!,
    })).jobId);
    expect(state.published).not.toHaveBeenCalled();
    const blocked = await getResearchDraft("a", "identity-boundary");
    expect(blocked?.error).toContain("cannot be mixed");
    fetcher.mockClear();
    await processSlackJob((await retrySlackReview("a", "identity-boundary")).jobId);
    expect((await getResearchDraft("a", "identity-boundary"))?.error).toContain("cannot be mixed");
    expect(state.published).not.toHaveBeenCalled();
    expect(fetcher.mock.calls.every(([, init]) => !JSON.parse(String(init?.body)).blocks)).toBe(true);
    run("UPDATE channels SET research_enabled=0 WHERE id='identity-second'");
  });
  it("retries only failed destinations after a fresh approval and preserves successful post IDs", async () => {
    run(
      "INSERT INTO channels(id,team_id,name,platform,account_type,account_id,group_name,credentials,created_at,research_enabled,system_prompt)VALUES('channel2','a','Second profile','linkedin','personal','account-2','personal','encrypted',1,1,'Write for product leaders')",
    );
    draft("partial");
    const copy = {
      targets: [
        {
          channelId: "channel",
          platform: "linkedin",
          content: "First profile copy https://example.com/article",
          thread: [],
        },
        {
          channelId: "channel2",
          platform: "linkedin",
          content: "Second profile copy https://example.com/article",
          thread: [],
        },
      ],
    };
    run("UPDATE research_drafts SET content=? WHERE id='partial'", [
      JSON.stringify(copy),
    ]);
    vi.stubGlobal("fetch", fetcher);
    await processSlackJob((await queueResearchDraftForSlack("partial")).jobId);
    const pendingCalls: string[][] = [];
    state.published.mockImplementation(
      async (
        post: NonNullable<Awaited<ReturnType<typeof getPostWithDetails>>>,
      ) => {
        const pending = targetsPendingPublication(post.targets);
        pendingCalls.push(pending.map((target) => target.channel_id!));
        const success =
          pendingCalls.length === 1 ? pending.slice(0, 1) : pending;
        for (const target of success)
          run("UPDATE post_targets SET platform_post_id=? WHERE id=?", [
            `published-${target.channel_id}`,
            target.id,
          ]);
        run("UPDATE posts SET state=? WHERE id=?", [
          pendingCalls.length === 1 ? "failed" : "published",
          post.id,
        ]);
      },
    );
    const approve = async () => {
      const current = await getResearchDraft("a", "partial");
      return processSlackJob(
        (
          await enqueueSlackJob("a", "approve", {
            draftId: "partial",
            revision: current!.revision,
            snapshotHash: current!.snapshot_hash!,
            userId: "U12345678",
            channelId: "C12345678",
            threadTs: "123.456",
            messageTs: current!.slack_message_ts!,
          })
        ).jobId,
      );
    };
    await approve();
    expect((await getResearchDraft("a", "partial"))?.status).toBe("failed");
    await processSlackJob((await retrySlackReview("a", "partial")).jobId);
    expect(JSON.stringify(fetcher.mock.calls)).toContain("retry ONLY");
    expect(JSON.stringify(fetcher.mock.calls)).toContain("published-channel");
    await approve();
    expect(pendingCalls).toEqual([["channel", "channel2"], ["channel2"]]);
    expect((await getResearchDraft("a", "partial"))?.status).toBe("published");
    run("UPDATE channels SET research_enabled=0 WHERE id='channel2'");
  });
  it("binds ready thread checkpoints into review and blocks ambiguous writes", async () => {
    draft("checkpoint");
    vi.stubGlobal("fetch", fetcher);
    await processSlackJob(
      (await queueResearchDraftForSlack("checkpoint")).jobId,
    );
    const progress = {
      version: 1,
      contentHash: "a".repeat(64),
      phase: "ready",
      rootId: "root-id",
      lastId: "root-id",
      publishedCount: 1,
      totalCount: 3,
    };
    run(
      "UPDATE post_targets SET platform_post_id='root-id',publication_progress=? WHERE post_id='research-checkpoint'",
      [JSON.stringify(progress)],
    );
    run("UPDATE posts SET state='failed' WHERE id='research-checkpoint'");
    run("UPDATE research_drafts SET status='failed' WHERE id='checkpoint'");
    const oldHash = (await getResearchDraft("a", "checkpoint"))!.snapshot_hash;
    await processSlackJob((await retrySlackReview("a", "checkpoint")).jobId);
    const reviewed = await getResearchDraft("a", "checkpoint");
    expect(reviewed?.status).toBe("pending");
    expect(reviewed?.snapshot_hash).not.toBe(oldHash);
    expect(JSON.stringify(fetcher.mock.calls)).toContain("1/3 parts published");
    run(
      "UPDATE post_targets SET publication_progress=? WHERE post_id='research-checkpoint'",
      [JSON.stringify({ ...progress, phase: "sending_reply" })],
    );
    await expect(retrySlackReview("a", "checkpoint")).rejects.toThrow(
      "may already have published",
    );
    expect(state.published).not.toHaveBeenCalled();
  });
  it("locks managed posts against generic editing, scheduling, deletion, or Telegram approval", async () => {
    await expect(
      assertNotSlackManagedPost("research-initial", "a"),
    ).rejects.toThrow("managed in its Slack");
    await expect(
      assertNotSlackManagedPost("research-publish", "a"),
    ).resolves.toBeUndefined();
    await expect(
      assertNotSlackManagedPost("research-initial", "b"),
    ).resolves.toBeUndefined();
    await expect(
      assertNotSlackManagedPost("unrelated", "a"),
    ).resolves.toBeUndefined();
  });
});

describe("safe live Slack review tests", () => {
  it("creates, edits and approves a signed test review without enabling daily profiles or calling the publisher", async () => {
    let sequence = 0;
    const api = vi.fn(
      async (url: RequestInfo | URL) =>
        new Response(
          JSON.stringify(
            String(url).endsWith("auth.test")
              ? { ok: true, team_id: "T12345678", user_id: "UBOT12345" }
              : String(url).endsWith("conversations.info")
                ? {
                    ok: true,
                    channel: {
                      id: "C12345678",
                      name: "approvals",
                      is_member: true,
                    },
                  }
                : String(url).endsWith("users.info")
                  ? {
                      ok: true,
                      user: {
                        id: "U12345678",
                        team_id: "T12345678",
                        is_bot: false,
                      },
                    }
                  : { ok: true, ts: `999.${++sequence}` },
          ),
        ),
    );
    vi.stubGlobal("fetch", api);
    run(
      "UPDATE channels SET research_enabled=0,system_prompt='' WHERE id='channel'",
    );
    run("UPDATE slack_integrations SET enabled=0 WHERE team_id='a'");
    try {
      const sent = await testSlackConnection("a", "https://example.com");
      expect(sent.channelName).toBe("approvals");
      expect((await processSlackJob(sent.jobId)).status).toBe("completed");
      const repeated = await testSlackConnection("a", "https://example.com");
      expect(repeated.draftId).not.toBe(sent.draftId);
      expect((await getResearchDraft("a", repeated.draftId))?.is_test).toBe(
        true,
      );
      const first = (await getResearchDraft("a", sent.draftId))!;
      expect(first.is_test).toBe(true);
      expect(
        row(`SELECT is_test FROM posts WHERE id='${first.post_id}'`).is_test,
      ).toBe(1);
      const packets = JSON.stringify(api.mock.calls);
      expect(packets).toContain("Test review — nothing will publish");
      expect(packets).toContain("Approve test");
      expect(packets).not.toContain("Approve & publish");
      const original = JSON.parse(first.content);
      state.rewrite.mockResolvedValue({
        content: {
          targets: original.targets.map((target: object) => ({
            ...target,
            content:
              "Inspect the latest revision before approving. https://example.com/settings/slack",
          })),
        },
        inputTokens: 50,
        outputTokens: 20,
      });
      const edit = JSON.stringify({
        type: "event_callback",
        team_id: "T12345678",
        event_id: "EvTestReviewEdit",
        event: {
          type: "message",
          user: "U12345678",
          channel: first.slack_channel_id,
          thread_ts: first.slack_thread_ts,
          text: "Shorten the opening",
        },
      });
      expect((await handleSlackEvents(await signedRequest(edit))).status).toBe(
        200,
      );
      expect((await processSlackJob("event-EvTestReviewEdit")).status).toBe(
        "completed",
      );
      const revised = (await getResearchDraft("a", sent.draftId))!;
      expect(revised.revision).toBe(2);
      expect(revised.is_test).toBe(true);
      expect(
        row(`SELECT content FROM post_targets WHERE post_id='${first.post_id}'`)
          .content,
      ).toContain("Inspect the latest revision");
      const approve = async (draft: typeof first, actionTs: string) => {
        const body = new URLSearchParams({
          payload: JSON.stringify({
            type: "block_actions",
            team: { id: "T12345678" },
            user: { id: "U12345678" },
            channel: { id: draft.slack_channel_id },
            message: { ts: draft.slack_message_ts },
            actions: [
              {
                action_id: "research_approve",
                action_ts: actionTs,
                value: JSON.stringify({
                  draftId: draft.id,
                  revision: draft.revision,
                  snapshotHash: draft.snapshot_hash,
                }),
              },
            ],
          }),
        }).toString();
        await handleSlackInteractions(
          await signedRequest(body, "interactions"),
        );
      };
      await approve(first, "100.1");
      expect(
        run(
          "SELECT id FROM slack_jobs WHERE kind='approve' AND json_extract(payload,'$.draftId')=?",
          [first.id],
        ).results,
      ).toHaveLength(0);
      await approve(revised, "100.2");
      const job = run(
        "SELECT id FROM slack_jobs WHERE kind='approve' AND json_extract(payload,'$.draftId')=?",
        [first.id],
      ).results[0];
      expect((await processSlackJob(job.id)).status).toBe("completed");
      expect((await getResearchDraft("a", first.id))?.status).toBe(
        "approved_test",
      );
      expect(
        row(`SELECT state FROM posts WHERE id='${first.post_id}'`).state,
      ).toBe("awaiting_approval");
      expect(
        run(
          "SELECT * FROM post_targets WHERE post_id=? AND platform_post_id IS NOT NULL",
          [first.post_id],
        ).results,
      ).toHaveLength(0);
      expect(JSON.stringify(api.mock.calls)).toContain("Test approved");
      expect(state.published).not.toHaveBeenCalled();
      await approve(revised, "100.3");
      expect(
        run(
          "SELECT id FROM slack_jobs WHERE kind='approve' AND json_extract(payload,'$.draftId')=?",
          [first.id],
        ).results,
      ).toHaveLength(1);
      expect(
        row(
          "SELECT research_enabled,system_prompt FROM channels WHERE id='channel'",
        ),
      ).toEqual({ research_enabled: 0, system_prompt: "" });
      expect(
        row("SELECT enabled FROM slack_integrations WHERE team_id='a'").enabled,
      ).toBe(0);
      await expect(
        assertNotSlackManagedPost(first.post_id!, "a"),
      ).rejects.toThrow("Test review posts can never");
      const post = (await getPostWithDetails(first.post_id!, "a"))!;
      expect(
        (await listPostsWithDetails("a")).some((item) => item.id === post.id),
      ).toBe(false);
      run("UPDATE posts SET state='scheduled',publish_at=1 WHERE id=?", [
        post.id,
      ]);
      expect(
        (await getDueScheduledPosts()).some((item) => item.id === post.id),
      ).toBe(false);
      const actualPublisher =
        await vi.importActual<typeof import("./publisher")>("./publisher");
      api.mockClear();
      await expect(
        actualPublisher.publishApprovedPost(post, "a"),
      ).rejects.toThrow("Test review posts can never");
      expect(api).not.toHaveBeenCalled();
      expect(() =>
        run("UPDATE research_drafts SET is_test=0 WHERE id=?", [first.id]),
      ).toThrow("marker cannot be changed");
      expect(() =>
        run("UPDATE posts SET is_test=0 WHERE id=?", [first.post_id]),
      ).toThrow("marker cannot be changed");
      run("DELETE FROM research_drafts WHERE id=?", [first.id]);
      await expect(
        actualPublisher.publishApprovedPost(post, "a"),
      ).rejects.toThrow("Test review posts can never");
      expect(api).not.toHaveBeenCalled();
    } finally {
      run(
        "UPDATE channels SET research_enabled=1,system_prompt='Write for product leaders' WHERE id='channel'",
      );
      run("UPDATE slack_integrations SET enabled=1 WHERE team_id='a'");
    }
  });
  it("requires a text profile in the same team for a test preview", async () => {
    await expect(
      createSlackTestReview("b", "https://example.com"),
    ).rejects.toThrow("Connect a text publishing profile");
    expect(
      run("SELECT * FROM research_drafts WHERE team_id='b'").results,
    ).toHaveLength(0);
  });
});

describe("Research candidate selection", () => {
  it("groups angles by source, ranks groups by best score, and keeps distinct decisions", async () => {
    const { groupResearchCandidates } = await import("./research-selection");
    const rows = [
      { id: "a1", url: "https://example.com/a", score: 80, content_angle: "Choose a subscription migration" },
      { id: "b1", url: "https://example.com/b", score: 85, content_angle: "Measure trial activation" },
      { id: "a2", url: "https://example.com/a", score: 95, content_angle: "Compare AI packaging" },
      { id: "a3", url: "https://example.com/a", score: 70, content_angle: "  COMPARE AI PACKAGING  " },
    ];
    expect(groupResearchCandidates(rows).map(group => group.map(row => row.id))).toEqual([["a2", "a1"], ["b1"]]);
    expect(groupResearchCandidates([...rows].reverse()).map(group => group.map(row => row.id))).toEqual([["a2", "a1"], ["b1"]]);
  });
  it("never silently truncates or repeats an uncertain Slack delivery", async () => {
    const { sendResearchSelection } = await import("./research-selection");
    run("INSERT INTO research_runs(id,team_id,mode,status,days,created_at,icp,source_ids)VALUES('selection-oversize','a','scan','completed',1,100,'Product leaders','[\"source\"]'),('selection-uncertain','a','scan','completed',1,100,'Product leaders','[\"source\"]')");
    for (const id of ["selection-oversize", "selection-uncertain"]) {
      run("INSERT INTO research_findings(id,team_id,run_id,item_id,source_id,title,url,published_at,score,summary,why_it_matters,content_angle,evidence,limitations,created_at,family_key) VALUES(?,'a',?,'item','source','Article',?,1,90,'Summary','Why','Angle','Evidence','Limits',1,?)", [id, id, id === "selection-oversize" ? `https://example.com/${"x".repeat(40000)}` : "https://example.com/article", id]);
    }
    vi.stubGlobal("fetch", fetcher);
    await expect(sendResearchSelection("a", "selection-oversize")).rejects.toThrow("single-message limit");
    expect(fetcher).not.toHaveBeenCalled();
    fetcher.mockRejectedValueOnce(new Error("connection lost"));
    await expect(sendResearchSelection("a", "selection-uncertain")).rejects.toThrow("connection lost");
    await expect(sendResearchSelection("a", "selection-uncertain")).rejects.toThrow("delivery is unconfirmed");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("freezes every distinct candidate in one message and only queues authorized replies", async () => {
    const { sendResearchSelection, parseSelectionNumbers } = await import("./research-selection");
    run("INSERT INTO research_runs(id,team_id,mode,status,days,created_at,icp,source_ids)VALUES('selection-run','a','scan','completed',1,100,'Product leaders','[\"source\"]')");
    for (const [id, angle] of [["selection-a", "First angle"], ["selection-b", "Second angle"], ["selection-copy", "First angle"]]) {
      run("INSERT INTO research_items(id,team_id,source_id,canonical_url,title,excerpt,collected_at)VALUES(?,'a','source',?,'Title','Excerpt',1)", [`item-${id}`, `https://example.com/${id}`]);
      run("INSERT INTO research_findings(id,team_id,run_id,item_id,source_id,title,url,published_at,score,summary,why_it_matters,content_angle,evidence,limitations,created_at,family_key) VALUES(?,'a','selection-run',?,'source','Article','https://example.com/article',1,90,'Summary','Why',?,'Evidence','Limits',1,?)", [id, `item-${id}`, angle, id]);
    }
    vi.stubGlobal("fetch", fetcher);
    expect(await sendResearchSelection("a", "selection-run")).toEqual({ count: 2, sent: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const packet = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    expect(packet.text).toContain("*<https://example.com/article|Article>*");
    expect(packet.text).toContain("1. First angle (score 90)");
    expect(packet.text).toContain("2. Second angle (score 90)");
    expect(await sendResearchSelection("a", "selection-run")).toEqual({ count: 2, sent: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(parseSelectionNumbers("1, 2 1", 2)).toEqual([1, 2]);
    expect(parseSelectionNumbers("1, 3", 2)).toBeNull();
    expect(parseSelectionNumbers("1 and 2", 2)).toBeNull();
    const event = (user: string, eventId: string) => JSON.stringify({ type: "event_callback", team_id: "T12345678", event_id: eventId, event: { type: "message", user, channel: "C12345678", thread_ts: "123.456", text: "2" } });
    await handleSlackEvents(await signedRequest(event("U99999999", "EvUnauthorized")));
    expect(row("SELECT count(*) AS n FROM slack_jobs WHERE id='event-EvUnauthorized'").n).toBe(0);
    const body = event("U12345678", "EvSelection");
    await handleSlackEvents(await signedRequest(body));
    await handleSlackEvents(await signedRequest(body));
    expect(row("SELECT count(*) AS n FROM slack_jobs WHERE id='event-EvSelection' AND kind='selection'").n).toBe(1);
    const { processSelectionReply } = await import("./research-selection");
    const previous = globalThis.__contentHubResearchWorkflow__;
    const create = vi.fn(async () => ({}));
    globalThis.__contentHubResearchWorkflow__ = { create };
    const input = { runId: "selection-run", userId: "U12345678", channelId: "C12345678", threadTs: "123.456" };
    try {
      // The two candidates share a title, so an ambiguous title cannot write.
      await processSelectionReply("a", { ...input, text: "Article" }, "ambiguous");
      expect(create).not.toHaveBeenCalled();
      await expect(processSelectionReply("a", { ...input, userId: "U99999999", text: "1" }, "unauthorized")).rejects.toThrow("no longer authorized");
      await Promise.all([
        processSelectionReply("a", { ...input, text: "1" }, "one"),
        processSelectionReply("a", { ...input, text: "2" }, "two"),
      ]);
      const selected = JSON.parse(row("SELECT value FROM research_cache WHERE id='research-selection:selection-run'").value);
      expect(new Set(selected.selectedIds)).toEqual(new Set(selected.candidateIds));
      expect(create).toHaveBeenCalledTimes(2);
    } finally { globalThis.__contentHubResearchWorkflow__ = previous; }
  });
});
