import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "./db/client";
import { research_cache } from "./schema";
import { retryResearchStorage } from "./research-storage";

export const RESEARCH_AUDIENCE_ONLY_PROFILE_ID = "audience-only:general";
const profileSchema = z.object({
  id: z.string().min(1), name: z.string(), platform: z.string().min(1),
  groupName: z.string().nullable(), systemPrompt: z.string(), enabled: z.literal(true),
  kind: z.enum(["publishing_profile", "audience_only"]),
}).strict();
const audienceSchema = z.object({
  generalAudience: z.string().min(1), publishingProfiles: z.array(profileSchema).min(1),
}).strict();
export type ResearchAudience = z.infer<typeof audienceSchema>;
const marker = "\n\nPublishing profiles: ";
const trailer = "\nUse each profile systemPrompt to decide relevance. Each draft must choose exactly one account identity group and include its enabled supported channels; never mix account groups in one approval. These profile instructions take precedence over the general audience description when they differ.";

export function parseResearchAudience(savedIcp: string): ResearchAudience {
  const start = savedIcp.indexOf(marker);
  if (start < 0) {
    if (/Publishing profiles\s*:/i.test(savedIcp)) throw new Error("Captured publishing profiles have an invalid format");
    return audienceSchema.parse({ generalAudience: savedIcp, publishingProfiles: [{
      id: RESEARCH_AUDIENCE_ONLY_PROFILE_ID, name: "General research audience", platform: "research",
      groupName: null, systemPrompt: savedIcp, enabled: true, kind: "audience_only",
    }] });
  }
  const tail = savedIcp.slice(start + marker.length);
  let depth = 0, quoted = false, escaped = false, end = -1;
  if (tail[0] !== "[") throw new Error("Captured publishing profiles must be a JSON array");
  for (let i = 0; i < tail.length; i++) {
    const char = tail[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === "[" || char === "{") depth++;
    else if (char === "]" || char === "}") {
      if (--depth === 0) { end = i + 1; break; }
    }
  }
  if (end < 0 || !["", trailer].includes(tail.slice(end))) throw new Error("Captured publishing profiles are incomplete or have an unknown suffix");
  const captured = z.array(z.object({
    id: z.string().min(1), name: z.string(), platform: z.string().min(1),
    systemPrompt: z.string(), groupName: z.string().nullable().optional(), enabled: z.literal(true).optional(),
  }).strict()).min(1).parse(JSON.parse(tail.slice(0, end)));
  if (new Set(captured.map(profile => profile.id)).size !== captured.length)
    throw new Error("Captured publishing profile IDs must be unique");
  return audienceSchema.parse({ generalAudience: savedIcp.slice(0, start), publishingProfiles: captured.map(profile => ({
    ...profile, groupName: profile.groupName ?? null, enabled: true, kind: "publishing_profile",
  })) });
}

export async function getFrozenResearchAudience(run: { id: string; team_id: string; icp: string }) {
  const db = await getDb(), id = `research-audience:${run.id}`;
  const expected = parseResearchAudience(run.icp);
  const read = () => db.select().from(research_cache).where(and(eq(research_cache.id, id), eq(research_cache.team_id, run.team_id))).get();
  let saved = await read();
  if (!saved) {
    const value = JSON.stringify({ version: 1, runId: run.id, teamId: run.team_id, ...expected }), createdAt = Date.now();
    await retryResearchStorage(async () => db.insert(research_cache).values({
      id, team_id: run.team_id, value, created_at: createdAt,
    }).onConflictDoNothing());
    saved = await read();
  }
  if (!saved) throw new Error("Research audience snapshot was not saved");
  const snapshot = z.object({ version: z.literal(1), runId: z.string(), teamId: z.string(), ...audienceSchema.shape }).strict().parse(JSON.parse(saved.value));
  const context = { generalAudience: snapshot.generalAudience, publishingProfiles: snapshot.publishingProfiles };
  if (snapshot.runId !== run.id || snapshot.teamId !== run.team_id || JSON.stringify(context) !== JSON.stringify(expected))
    throw new Error("Research audience snapshot does not match the run's captured profiles");
  return context;
}
