import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getRequestAgentIdentity } from "./auth";
import { getDb } from "./db/client";
import { team_memberships } from "./schema";
export async function getSlackOwnerIdentity(request: Request) {
  const identity = await getRequestAgentIdentity(request);
  if (identity instanceof Response) return identity;
  if (!identity.userId || identity.tokenType === "oauth")
    return Response.json(
      { error: "Session or API key required" },
      { status: 401 },
    );
  const db = await getDb();
  const membership = (
    await db
      .select()
      .from(team_memberships)
      .where(
        and(
          eq(team_memberships.team_id, identity.teamId),
          eq(team_memberships.user_id, identity.userId),
        ),
      )
      .limit(1)
  )[0];
  if (membership?.role !== "owner")
    return Response.json(
      { error: "Only the team owner can configure Slack approvals" },
      { status: 403 },
    );
  return identity as typeof identity & { userId: string };
}
export async function slackOwnerHttp(
  request: Request,
  action: (teamId: string) => Promise<unknown>,
) {
  const identity = await getSlackOwnerIdentity(request);
  if (identity instanceof Response) return identity;
  try {
    return Response.json(await action(identity.teamId), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Slack request failed";
    if (error instanceof z.ZodError || error instanceof SyntaxError)
      return Response.json(
        { error: "Invalid Slack settings" },
        { status: 400 },
      );
    console.error("Slack configuration request failed:", message);
    return Response.json(
      { error: message },
      { status: /not found/i.test(message) ? 404 : 400 },
    );
  }
}
