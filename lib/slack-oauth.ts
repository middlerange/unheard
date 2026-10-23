import { and, eq, gt, isNull, lt } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "./db/client";
import { slack_integrations, slack_oauth_states } from "./schema";
import { encrypt } from "./crypto";
import { researchHash } from "./research-model";
import { getSlackOwnerIdentity } from "./slack-http";
import {
  getSlackCredentials,
  getSlackIntegration,
  slackApi,
  slackOAuthAvailable,
} from "./slack";
import { SLACK_BOT_SCOPES } from "./slack-manifest";
import type { SlackOptions } from "./slack-types";

function oauthConfiguration() {
  if (!slackOAuthAvailable())
    throw new Error("Slack OAuth is not configured on this deployment");
  return {
    clientId: process.env.SLACK_CLIENT_ID!,
    clientSecret: process.env.SLACK_CLIENT_SECRET!,
    signingSecret: process.env.SLACK_SIGNING_SECRET!,
  };
}
function publicOrigin(request: Request) {
  const url = new URL(process.env.CONTENT_HUB_PUBLIC_URL || request.url);
  if (url.protocol !== "https:" && url.hostname !== "localhost")
    throw new Error("Slack OAuth requires HTTPS");
  return url.origin;
}
function callbackUrl(request: Request) {
  const url = new URL("/api/slack/oauth/callback", publicOrigin(request));
  if (url.protocol !== "https:" && url.hostname !== "localhost")
    throw new Error("Slack OAuth requires HTTPS");
  return url.toString();
}
function resultRedirect(
  request: Request,
  result: "connected" | "denied" | "error",
) {
  let origin: string;
  try {
    origin = publicOrigin(request);
  } catch {
    origin = new URL(request.url).origin;
  }
  const url = new URL("/settings/slack", origin);
  url.searchParams.set("slack", result);
  return new Response(null, {
    status: 303,
    headers: {
      Location: url.toString(),
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}
export async function handleSlackConnect(request: Request) {
  const identity = await getSlackOwnerIdentity(request);
  if (identity instanceof Response) return identity;
  if (!slackOAuthAvailable())
    return Response.json(
      { error: "Slack OAuth is not configured on this deployment" },
      { status: 503 },
    );
  const configuration = oauthConfiguration(),
    db = await getDb(),
    now = Date.now();
  await db
    .delete(slack_oauth_states)
    .where(lt(slack_oauth_states.expires_at, now));
  const state = btoa(
    String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))),
  )
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
  await db.insert(slack_oauth_states).values({
    id: await researchHash(state),
    team_id: identity.teamId,
    user_id: identity.userId,
    expires_at: now + 600_000,
    created_at: now,
  });
  const url = new URL("https://slack.com/oauth/v2/authorize");
  url.searchParams.set("client_id", configuration.clientId);
  url.searchParams.set("scope", SLACK_BOT_SCOPES.join(","));
  url.searchParams.set("redirect_uri", callbackUrl(request));
  url.searchParams.set("state", state);
  return new Response(null, {
    status: 302,
    headers: {
      Location: url.toString(),
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}
const oauthResultSchema = z.object({
  ok: z.literal(true),
  access_token: z
    .string()
    .regex(/^xoxb-[A-Za-z0-9-]+$/)
    .max(500),
  token_type: z.literal("bot"),
  scope: z.string(),
  team: z.object({ id: z.string().regex(/^T[A-Z0-9]{8,}$/) }),
  bot_user_id: z.string().regex(/^[UW][A-Z0-9]{8,}$/),
  is_enterprise_install: z.boolean().optional(),
  refresh_token: z.string().optional(),
  expires_in: z.number().optional(),
});
export async function handleSlackOAuthCallback(request: Request) {
  try {
    const configuration = oauthConfiguration(),
      identity = await getSlackOwnerIdentity(request);
    if (identity instanceof Response) return resultRedirect(request, "error");
    const query = new URL(request.url).searchParams,
      state = query.get("state") || "";
    if (!/^[A-Za-z0-9_-]{43}$/.test(state))
      return resultRedirect(request, "error");
    const db = await getDb(),
      now = Date.now();
    const consumed = await db
      .update(slack_oauth_states)
      .set({ consumed_at: now })
      .where(
        and(
          eq(slack_oauth_states.id, await researchHash(state)),
          eq(slack_oauth_states.team_id, identity.teamId),
          eq(slack_oauth_states.user_id, identity.userId),
          gt(slack_oauth_states.expires_at, now),
          isNull(slack_oauth_states.consumed_at),
        ),
      )
      .returning({ id: slack_oauth_states.id });
    if (!consumed.length) return resultRedirect(request, "error");
    if (query.has("error"))
      return resultRedirect(
        request,
        query.get("error") === "access_denied" ? "denied" : "error",
      );
    const code = z.string().min(1).max(2048).parse(query.get("code"));
    const response = await fetch("https://slack.com/api/oauth.v2.access", {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${configuration.clientId}:${configuration.clientSecret}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        code,
        redirect_uri: callbackUrl(request),
      }).toString(),
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) return resultRedirect(request, "error");
    const result = oauthResultSchema.parse(await response.json());
    if (
      result.is_enterprise_install ||
      result.refresh_token ||
      result.expires_in
    )
      return resultRedirect(request, "error");
    const granted = new Set(
      result.scope.split(",").map((scope) => scope.trim()),
    );
    if (SLACK_BOT_SCOPES.some((scope) => !granted.has(scope)))
      return resultRedirect(request, "error");
    const auth = await slackApi<{ team_id: string; user_id: string }>(
      result.access_token,
      "auth.test",
    );
    if (auth.team_id !== result.team.id || auth.user_id !== result.bot_user_id)
      return resultRedirect(request, "error");
    const collision = (
      await db
        .select({ teamId: slack_integrations.team_id })
        .from(slack_integrations)
        .where(eq(slack_integrations.workspace_id, result.team.id))
        .limit(1)
    )[0];
    if (collision && collision.teamId !== identity.teamId)
      return resultRedirect(request, "error");
    const existing = await getSlackIntegration(identity.teamId),
      sameWorkspace = existing?.workspace_id === result.team.id;
    const values = {
      team_id: identity.teamId,
      workspace_id: result.team.id,
      channel_id: sameWorkspace ? existing.channel_id : "",
      approver_user_ids: sameWorkspace ? existing.approver_user_ids : "[]",
      credentials: await encrypt(
        JSON.stringify({
          botToken: result.access_token,
          signingSecret: configuration.signingSecret,
          appManaged: true,
        }),
      ),
      enabled: false,
      created_at: existing?.created_at ?? now,
      updated_at: now,
    };
    await db
      .insert(slack_integrations)
      .values(values)
      .onConflictDoUpdate({ target: slack_integrations.team_id, set: values });
    return resultRedirect(request, "connected");
  } catch {
    // Authorization codes, bot tokens, and provider errors never enter redirects or logs.
    return resultRedirect(request, "error");
  }
}

type PageMetadata = { response_metadata?: { next_cursor?: string } };
async function slackPages<T>(
  token: string,
  method: string,
  key: string,
  data: Record<string, unknown>,
) {
  const values: T[] = [],
    seen = new Set<string>();
  let cursor = "";
  for (let page = 0; page < 100; page++) {
    const result = await slackApi<Record<string, unknown> & PageMetadata>(
      token,
      method,
      { ...data, limit: 200, ...(cursor ? { cursor } : {}) },
    );
    if (!Array.isArray(result[key]))
      throw new Error(`Slack ${method} returned an invalid page`);
    values.push(...(result[key] as T[]));
    const next = result.response_metadata?.next_cursor?.trim() || "";
    if (!next) return values;
    if (seen.has(next))
      throw new Error(
        "Slack returned a repeated page cursor. Please retry discovery",
      );
    seen.add(next);
    cursor = next;
  }
  throw new Error(
    "Slack discovery exceeded its page limit. Please contact the Content Hub administrator",
  );
}
export async function getSlackOptions(teamId: string): Promise<SlackOptions> {
  const integration = await getSlackIntegration(teamId);
  if (!integration) throw new Error("Connect Slack before choosing a channel");
  const { botToken } = await getSlackCredentials(teamId);
  type Channel = {
    id: string;
    name: string;
    is_private?: boolean;
    is_member?: boolean;
    is_archived?: boolean;
    is_im?: boolean;
    is_mpim?: boolean;
  };
  type User = {
    id: string;
    name?: string;
    real_name?: string;
    team_id?: string;
    deleted?: boolean;
    is_bot?: boolean;
    is_app_user?: boolean;
    profile?: { display_name?: string; real_name?: string };
  };
  const [channels, users] = await Promise.all([
    slackPages<Channel>(botToken, "conversations.list", "channels", {
      types: "public_channel,private_channel",
      exclude_archived: true,
    }),
    slackPages<User>(botToken, "users.list", "members", {}),
  ]);
  const channelMap = new Map(
    channels
      .filter(
        (channel) =>
          channel.id &&
          channel.name &&
          !channel.is_archived &&
          !channel.is_im &&
          !channel.is_mpim &&
          (!channel.is_private || channel.is_member),
      )
      .map((channel) => [
        channel.id,
        {
          id: channel.id,
          name: channel.name,
          isPrivate: Boolean(channel.is_private),
          isMember: Boolean(channel.is_member),
        },
      ]),
  );
  const userMap = new Map(
    users
      .filter(
        (user) =>
          user.id &&
          user.id !== "USLACKBOT" &&
          !user.deleted &&
          !user.is_bot &&
          !user.is_app_user &&
          (!user.team_id || user.team_id === integration.workspace_id),
      )
      .map((user) => [
        user.id,
        {
          id: user.id,
          name:
            user.profile?.display_name?.trim() ||
            user.profile?.real_name?.trim() ||
            user.real_name?.trim() ||
            user.name ||
            user.id,
        },
      ]),
  );
  return {
    workspaceId: integration.workspace_id,
    channels: [...channelMap.values()].sort((a, b) =>
      a.name.localeCompare(b.name),
    ),
    reviewers: [...userMap.values()].sort((a, b) =>
      a.name.localeCompare(b.name),
    ),
  };
}
