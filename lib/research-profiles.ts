import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "./db/client";
import { channels } from "./schema";

export const RESEARCH_TEXT_PLATFORMS = [
  "twitter",
  "linkedin",
  "facebook",
  "discord",
  "reddit",
] as const;
export type ResearchProfile = {
  id: string;
  name: string;
  platform: string;
  enabled: boolean;
  systemPrompt: string;
  supported: boolean;
  requiresMedia: boolean;
};
export async function getResearchProfiles(
  teamId: string,
): Promise<{ profiles: ResearchProfile[] }> {
  const db = await getDb();
  const rows = await db
    .select({
      id: channels.id,
      name: channels.name,
      platform: channels.platform,
      enabled: channels.research_enabled,
      systemPrompt: channels.system_prompt,
    })
    .from(channels)
    .where(eq(channels.team_id, teamId))
    .orderBy(channels.platform, channels.name);
  return {
    profiles: rows.map((row) => ({
      ...row,
      supported: (RESEARCH_TEXT_PLATFORMS as readonly string[]).includes(
        row.platform,
      ),
      requiresMedia: row.platform === "instagram" || row.platform === "youtube",
    })),
  };
}
export async function updateResearchProfile(teamId: string, input: unknown) {
  const data = z
    .object({
      id: z.string().min(1).max(200),
      enabled: z.boolean(),
      systemPrompt: z.string().trim().max(8000),
    })
    .strict()
    .parse(input);
  const db = await getDb();
  const profile = await db
    .select()
    .from(channels)
    .where(and(eq(channels.id, data.id), eq(channels.team_id, teamId)))
    .get();
  if (!profile) throw new Error("Profile not found");
  if (
    data.enabled &&
    !(RESEARCH_TEXT_PLATFORMS as readonly string[]).includes(profile.platform)
  )
    throw new Error(
      "This profile needs a supported text publishing format before daily research can use it",
    );
  if (data.enabled && data.systemPrompt.length < 20)
    throw new Error(
      "Add at least 20 characters describing this profile’s audience and posting rules",
    );
  await db
    .update(channels)
    .set({ research_enabled: data.enabled, system_prompt: data.systemPrompt })
    .where(and(eq(channels.id, data.id), eq(channels.team_id, teamId)));
  return getResearchProfiles(teamId);
}
