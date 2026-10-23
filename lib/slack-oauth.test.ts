import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
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
import type { AgentIdentity } from "./auth";
import * as schema from "./schema";
vi.setConfig({ testTimeout: 30_000 });
const state = vi.hoisted(() => ({
  db: undefined as unknown,
  identity: {
    teamId: "a",
    userId: "owner-a",
    scopes: ["read", "write"],
    tokenType: "session",
  } as AgentIdentity | null,
}));
vi.mock("./db/client", () => ({ getDb: async () => state.db }));
vi.mock("./auth", () => ({
  getRequestAgentIdentity: async () =>
    state.identity ?? Response.json({ error: "Unauthorized" }, { status: 401 }),
}));
import {
  handleSlackConnect,
  handleSlackOAuthCallback,
  getSlackOptions,
} from "./slack-oauth";
import {
  getSlackCredentials,
  getSlackSettings,
  updateSlackSettings,
} from "./slack";
import { decrypt, encrypt } from "./crypto";
import { handleSlackEvents } from "./slack-ingress";
import { SLACK_BOT_SCOPES } from "./slack-manifest";

const folder = mkdtempSync(join(tmpdir(), "content-hub-slack-oauth-")),
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
function run(sql: string, params: unknown[] = []) {
  return execute({ queries: [{ sql, params }] })[0];
}
function row(sql: string) {
  return run(sql).results[0];
}
const origin = "https://content.example.com",
  botToken = "xoxb-oauth-token",
  signingSecret = "b".repeat(32);
const request = (path: string) => new Request(`${origin}${path}`);
const json = (value: unknown) =>
  new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json" },
  });
const oauthResult = () => ({
  ok: true,
  access_token: botToken,
  token_type: "bot",
  scope: SLACK_BOT_SCOPES.join(","),
  team: { id: "T12345678" },
  bot_user_id: "U98765432",
  is_enterprise_install: false,
});
function successfulFetch() {
  return vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) =>
    String(input).endsWith("oauth.v2.access")
      ? json(oauthResult())
      : json({ ok: true, team_id: "T12345678", user_id: "U98765432" }),
  );
}
async function begin() {
  const response = await handleSlackConnect(request("/api/slack/connect"));
  expect(response.status).toBe(302);
  const url = new URL(response.headers.get("location")!);
  return { response, url, state: url.searchParams.get("state")! };
}
const callback = (state: string, extra = "code=temporary-code") =>
  request(
    `/api/slack/oauth/callback?state=${encodeURIComponent(state)}&${extra}`,
  );
async function integration(
  teamId = "a",
  workspace = "T12345678",
  credentials = { botToken, signingSecret, appManaged: true },
) {
  const encrypted = await encrypt(JSON.stringify(credentials));
  run(
    "INSERT INTO slack_integrations(team_id,workspace_id,channel_id,approver_user_ids,credentials,enabled,created_at,updated_at)VALUES(?,?,'C12345678','[\"U12345678\"]',?,1,1,1)",
    [teamId, workspace, encrypted],
  );
}
async function signedEvent(body: string, secret = signingSecret) {
  const ts = Math.floor(Date.now() / 1000).toString();
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`v0:${ts}:${body}`),
  );
  const sig = Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  return new Request(`${origin}/api/slack/events`, {
    method: "POST",
    headers: {
      "x-slack-request-timestamp": ts,
      "x-slack-signature": `v0=${sig}`,
    },
    body,
  });
}
beforeAll(() => {
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
    "INSERT INTO users(id,email,password_hash,created_at,updated_at)VALUES('owner-a','a@example.com','hash',1,1),('owner-b','b@example.com','hash',1,1),('member','member@example.com','hash',1,1)",
  );
  run(
    "INSERT INTO team_memberships(id,user_id,team_id,role,created_at)VALUES('a-owner','owner-a','a','owner',1),('b-owner','owner-b','b','owner',1),('a-member','member','a','member',1)",
  );
});
beforeEach(() => {
  run("DELETE FROM slack_oauth_states");
  run("DELETE FROM slack_integrations");
  state.identity = {
    teamId: "a",
    userId: "owner-a",
    scopes: ["read", "write"],
    tokenType: "session",
  };
  vi.stubEnv("SLACK_CLIENT_ID", "123.456");
  vi.stubEnv("SLACK_CLIENT_SECRET", "secret-client");
  vi.stubEnv("SLACK_SIGNING_SECRET", signingSecret);
  vi.stubEnv("CREDENTIALS_ENCRYPTION_KEY", "c".repeat(64));
  vi.stubEnv("CONTENT_HUB_PUBLIC_URL", "");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
afterAll(() => rmSync(folder, { recursive: true, force: true }));
describe("Slack OAuth installation", () => {
  it("allows only a team owner and reports missing deployment credentials", async () => {
    state.identity = null;
    expect(
      (await handleSlackConnect(request("/api/slack/connect"))).status,
    ).toBe(401);
    state.identity = {
      teamId: "a",
      userId: "member",
      scopes: ["read", "write"],
      tokenType: "session",
    };
    expect(
      (await handleSlackConnect(request("/api/slack/connect"))).status,
    ).toBe(403);
    state.identity = {
      teamId: "a",
      userId: "owner-a",
      scopes: ["read", "write"],
      tokenType: "session",
    };
    vi.stubEnv("SLACK_CLIENT_SECRET", "");
    expect(
      (await handleSlackConnect(request("/api/slack/connect"))).status,
    ).toBe(503);
  });
  it("uses a random hash-only owner-bound expiring state and canonical redirect", async () => {
    vi.stubEnv("CONTENT_HUB_PUBLIC_URL", "https://canonical.example.com/path");
    const { url, state, response } = await begin();
    expect(url.origin).toBe("https://slack.com");
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://canonical.example.com/api/slack/oauth/callback",
    );
    const stored = row("SELECT * FROM slack_oauth_states");
    expect(stored.id).not.toBe(state);
    expect(stored.id).toMatch(/^[a-f0-9]{64}$/);
    expect(stored.user_id).toBe("owner-a");
    expect(stored.team_id).toBe("a");
    expect(stored.expires_at - stored.created_at).toBe(600_000);
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });
  it("exchanges once with HTTP Basic and persists encrypted bot credentials with delivery disabled", async () => {
    const fetcher = successfulFetch();
    vi.stubGlobal("fetch", fetcher);
    const { state } = await begin();
    const response = await handleSlackOAuthCallback(callback(state));
    expect(response.headers.get("location")).toBe(
      `${origin}/settings/slack?slack=connected`,
    );
    const exchange = fetcher.mock.calls.find(([url]) =>
      String(url).endsWith("oauth.v2.access"),
    )!;
    expect(exchange[1]?.headers).toEqual(
      expect.objectContaining({
        Authorization: `Basic ${btoa("123.456:secret-client")}`,
      }),
    );
    expect(
      new URLSearchParams(String(exchange[1]?.body)).get("redirect_uri"),
    ).toBe(`${origin}/api/slack/oauth/callback`);
    const stored = row("SELECT * FROM slack_integrations WHERE team_id='a'");
    expect(stored.credentials).not.toContain(botToken);
    expect(JSON.parse(await decrypt(stored.credentials))).toEqual({
      botToken,
      signingSecret,
      appManaged: true,
    });
    expect(stored.enabled).toBe(0);
    expect(stored.channel_id).toBe("");
    expect(stored.approver_user_ids).toBe("[]");
    expect((await getSlackSettings("a")).oauthAvailable).toBe(true);
    expect(JSON.stringify(await getSlackSettings("a"))).not.toContain(botToken);
    const replay = await handleSlackOAuthCallback(callback(state));
    expect(replay.headers.get("location")).toContain("slack=error");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("rejects swapped owner sessions and expired state without exchanging codes", async () => {
    const fetcher = successfulFetch();
    vi.stubGlobal("fetch", fetcher);
    const { state: oauthState } = await begin();
    state.identity = {
      teamId: "b",
      userId: "owner-b",
      scopes: ["read", "write"],
      tokenType: "session",
    };
    expect(
      (await handleSlackOAuthCallback(callback(oauthState))).headers.get(
        "location",
      ),
    ).toContain("slack=error");
    expect(
      row("SELECT consumed_at FROM slack_oauth_states").consumed_at,
    ).toBeNull();
    state.identity = {
      teamId: "a",
      userId: "owner-a",
      scopes: ["read", "write"],
      tokenType: "session",
    };
    run("UPDATE slack_oauth_states SET expires_at=?", [Date.now() - 1]);
    expect(
      (await handleSlackOAuthCallback(callback(oauthState))).headers.get(
        "location",
      ),
    ).toContain("slack=error");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("consumes denial states and sanitizes provider errors", async () => {
    const fetcher = successfulFetch();
    vi.stubGlobal("fetch", fetcher);
    const denied = await begin();
    expect(
      (
        await handleSlackOAuthCallback(
          callback(denied.state, "error=access_denied"),
        )
      ).headers.get("location"),
    ).toContain("slack=denied");
    expect(
      row("SELECT consumed_at FROM slack_oauth_states").consumed_at,
    ).not.toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
    const failed = await begin();
    fetcher.mockResolvedValue(
      json({ ok: false, error: "secret-provider-error xoxb-secret-token" }),
    );
    const response = await handleSlackOAuthCallback(callback(failed.state));
    expect(response.headers.get("location")).toBe(
      `${origin}/settings/slack?slack=error`,
    );
    expect(await response.text()).not.toContain("secret-provider");
  });
  it("rejects workspace identity mismatches, missing scopes, enterprise and rotating tokens", async () => {
    for (const override of [
      { scope: "chat:write" },
      { is_enterprise_install: true },
      { refresh_token: "xoxe-refresh", expires_in: 43200 },
    ]) {
      const { state } = await begin();
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => json({ ...oauthResult(), ...override })),
      );
      expect(
        (await handleSlackOAuthCallback(callback(state))).headers.get(
          "location",
        ),
      ).toContain("slack=error");
    }
    const mismatch = await begin();
    const fetcher = successfulFetch();
    fetcher.mockImplementation(async (input) =>
      String(input).endsWith("oauth.v2.access")
        ? json(oauthResult())
        : json({ ok: true, team_id: "TDIFFERENT", user_id: "U98765432" }),
    );
    vi.stubGlobal("fetch", fetcher);
    expect(
      (await handleSlackOAuthCallback(callback(mismatch.state))).headers.get(
        "location",
      ),
    ).toContain("slack=error");
    expect(row("SELECT count(*) AS n FROM slack_integrations").n).toBe(0);
  });
  it("rejects workspace collisions and retains only same-workspace channel preferences on reconnect", async () => {
    await integration("b");
    vi.stubGlobal("fetch", successfulFetch());
    const first = await begin();
    expect(
      (await handleSlackOAuthCallback(callback(first.state))).headers.get(
        "location",
      ),
    ).toContain("slack=error");
    run("DELETE FROM slack_integrations");
    await integration("a");
    const reconnect = await begin();
    expect(
      (await handleSlackOAuthCallback(callback(reconnect.state))).headers.get(
        "location",
      ),
    ).toContain("slack=connected");
    expect(
      row("SELECT channel_id FROM slack_integrations WHERE team_id='a'")
        .channel_id,
    ).toBe("C12345678");
    expect(
      row("SELECT enabled FROM slack_integrations WHERE team_id='a'").enabled,
    ).toBe(0);
  });
});
describe("Slack channel and reviewer discovery", () => {
  it("collects all pages, filters bots/deleted users and private nonmembers, and exposes names without tokens", async () => {
    await integration();
    const fetcher = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(new Headers(init?.headers).get("content-type")).toBe("application/x-www-form-urlencoded; charset=utf-8");
        const data = Object.fromEntries(new URLSearchParams(String(init?.body)));
        expect(data.limit).toBe("200");
        if (String(input).endsWith("conversations.list")) {
          expect(data.types).toBe("public_channel,private_channel");
          expect(data.exclude_archived).toBe("true");
        }
        if (String(input).endsWith("conversations.list"))
          return json(
            data.cursor
              ? {
                  ok: true,
                  channels: [
                    {
                      id: "GPRIVATE1",
                      name: "private",
                      is_private: true,
                      is_member: true,
                    },
                    {
                      id: "GHIDDEN12",
                      name: "hidden",
                      is_private: true,
                      is_member: false,
                    },
                  ],
                  response_metadata: { next_cursor: "" },
                }
              : {
                  ok: true,
                  channels: [
                    { id: "CPUBLIC12", name: "public", is_member: false },
                    { id: "CARCHIVED", name: "archived", is_archived: true },
                  ],
                  response_metadata: { next_cursor: "channels-next" },
                },
          );
        return json(
          data.cursor
            ? {
                ok: true,
                members: [
                  { id: "USECOND12", name: "second", team_id: "T12345678" },
                  { id: "UEXTERNAL", name: "external", team_id: "TOTHER123" },
                ],
                response_metadata: { next_cursor: "" },
              }
            : {
                ok: true,
                members: [
                  {
                    id: "UHUMAN123",
                    name: "handle",
                    profile: { display_name: "Human" },
                  },
                  { id: "UBOT12345", name: "bot", is_bot: true },
                  { id: "UDELETED1", deleted: true },
                  { id: "USLACKBOT", name: "slackbot" },
                ],
                response_metadata: { next_cursor: "users-next" },
              },
        );
      },
    );
    vi.stubGlobal("fetch", fetcher);
    const options = await getSlackOptions("a");
    expect(options.channels.map((c) => c.id)).toEqual([
      "GPRIVATE1",
      "CPUBLIC12",
    ]);
    expect(options.reviewers).toEqual([
      { id: "UHUMAN123", name: "Human" },
      { id: "USECOND12", name: "second" },
    ]);
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(JSON.stringify(options)).not.toContain(botToken);
  });
  it("surfaces cursor loops instead of silently dropping options", async () => {
    await integration();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input) =>
        json(
          String(input).endsWith("conversations.list")
            ? {
                ok: true,
                channels: [],
                response_metadata: { next_cursor: "repeat" },
              }
            : { ok: true, members: [], response_metadata: { next_cursor: "" } },
        ),
      ),
    );
    await expect(getSlackOptions("a")).rejects.toThrow("repeated page cursor");
  });
  it("joins the selected public channel before saving and preserves OAuth signing mode", async () => {
    await integration();
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      return json(
        url.endsWith("auth.test")
          ? { ok: true, team_id: "T12345678", user_id: "U98765432" }
          : url.endsWith("conversations.info")
            ? {
                ok: true,
                channel: {
                  id: "C12345678",
                  name: "public",
                  is_private: false,
                  is_member: false,
                },
              }
            : url.endsWith("conversations.join")
              ? { ok: true, channel: { id: "C12345678", is_member: true } }
              : { ok: true, user: { id: "U12345678", team_id: "T12345678" } },
      );
    });
    vi.stubGlobal("fetch", fetcher);
    await updateSlackSettings("a", {
      channelId: "C12345678",
      approverUserIds: ["U12345678"],
      enabled: true,
    });
    expect(
      fetcher.mock.calls.some(([url]) =>
        String(url).endsWith("conversations.join"),
      ),
    ).toBe(true);
    expect((await getSlackCredentials("a")).appManaged).toBe(true);
  });
  it("verifies global setup challenges before installation and ignores signed unconfigured workspace events", async () => {
    const body = JSON.stringify({
      type: "url_verification",
      challenge: "setup-ready",
    });
    expect(
      await (await handleSlackEvents(await signedEvent(body))).json(),
    ).toEqual({ challenge: "setup-ready" });
    const event = JSON.stringify({
      type: "event_callback",
      team_id: "TUNLINKED",
      event: { type: "message", text: "ignored" },
    });
    expect((await handleSlackEvents(await signedEvent(event))).status).toBe(
      200,
    );
    expect(row("SELECT count(*) AS n FROM slack_jobs").n).toBe(0);
  });
  it("stops accepting an old app signing secret after global rotation", async () => {
    await integration();
    vi.stubEnv("SLACK_SIGNING_SECRET", "d".repeat(32));
    const body = JSON.stringify({
      type: "event_callback",
      team_id: "T12345678",
      event: { type: "message", text: "ignored" },
    });
    expect((await handleSlackEvents(await signedEvent(body))).status).toBe(401);
    expect(
      (await handleSlackEvents(await signedEvent(body, "d".repeat(32)))).status,
    ).toBe(200);
  });
});
