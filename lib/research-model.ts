import { z } from "zod";
import { beginResearchUsage, finishResearchUsage, type ResearchUsageContext } from "./research-usage";
import type { ModelUsage } from "./research-pricing";
export const RESEARCH_MODEL = "gpt-6-luna";
export const RESEARCH_PROMPT_VERSION = "research-v4";
const text = z.string().max(1600);
export const researchEvidenceSchema = z.object({
  findings: z
    .array(
      z.object({
        itemId: z.string(),
        score: z.number().int().min(0).max(100),
        summary: text,
        whyItMatters: text,
        contentAngle: text,
        evidence: z.string().min(20).max(600),
        limitations: text,
        familyKey: z.string().min(3).max(160),
      }),
    )
    .max(12),
});
export type ResearchEvidence = z.infer<
  typeof researchEvidenceSchema
>["findings"][number];
export async function researchHash(value: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
export function validateResearchEvidence(
  evidence: ResearchEvidence[],
  items: Array<{ id: string; content: string }>,
) {
  const inputs = new Map(
    items.map((item) => [
      item.id,
      item.content.replace(/\s+/g, " ").toLowerCase(),
    ]),
  );
  const seen = new Set<string>();
  return evidence.filter((finding) => {
    const content = inputs.get(finding.itemId);
    if (
      !content ||
      seen.has(finding.itemId) ||
      finding.score < 70 ||
      !content.includes(finding.evidence.replace(/\s+/g, " ").toLowerCase())
    )
      return false;
    seen.add(finding.itemId);
    return true;
  });
}
export async function callResearchModel(
  system: string,
  data: unknown,
  outputSchema: Record<string, unknown>,
  maxOutputTokens = 4000,
  usageContext: ResearchUsageContext,
) {
  const key = process.env.OPENAI_API_KEY;
  if (!key)
    throw new Error("Set OPENAI_API_KEY in Cloudflare secrets to run research");
  const usageId = await beginResearchUsage(usageContext, RESEARCH_MODEL);
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      signal: AbortSignal.timeout(90_000),
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: RESEARCH_MODEL,
        service_tier: "default",
        store: false,
        reasoning: { effort: "none" },
        instructions: system,
        input: JSON.stringify(data),
        max_output_tokens: maxOutputTokens,
        text: {
          format: { type: "json_schema", name: "research", strict: true, schema: outputSchema },
        },
      }),
    });
    if (!response.ok)
      throw new Error(`OpenAI request failed (HTTP ${response.status}). Check API key, model access, and account limits.`);
    const result = (await response.json()) as {
      id?: string;
      model?: string;
      service_tier?: string;
      status?: string;
      output?: Array<{ content?: Array<{ type: string; text?: string }> }>;
      usage?: ModelUsage;
    };
    await finishResearchUsage(usageId, usageContext, {
      model: result.model || RESEARCH_MODEL, tier: result.service_tier || "default",
      responseId: result.id, status: result.status || "unknown", usage: result.usage,
    });
    if (result.status !== "completed")
      throw new Error("OpenAI did not complete the research response within the output budget");
    const output = result.output
      ?.flatMap((item) => item.content || [])
      .filter((item) => item.type === "output_text")
      .map((item) => item.text || "")
      .join("");
    if (!output) throw new Error("OpenAI returned no structured research response");
    return {
      value: JSON.parse(output),
      inputTokens: result.usage?.input_tokens || 0,
      outputTokens: result.usage?.output_tokens || 0,
    };
  } catch (error) {
    await finishResearchUsage(usageId, usageContext, {
      model: RESEARCH_MODEL, tier: "default", status: "unknown",
    });
    throw error;
  }
}
export const screeningJsonSchema = {
  type: "object",
  properties: {
    itemIds: { type: "array", items: { type: "string" }, maxItems: 12 },
  },
  required: ["itemIds"],
  additionalProperties: false,
};
export const evidenceJsonSchema = {
  type: "object",
  properties: {
    findings: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          itemId: { type: "string" },
          score: { type: "integer", minimum: 0, maximum: 100 },
          summary: { type: "string" },
          whyItMatters: { type: "string" },
          contentAngle: { type: "string" },
          evidence: { type: "string" },
          limitations: { type: "string" },
          familyKey: { type: "string" },
        },
        required: [
          "itemId",
          "score",
          "summary",
          "whyItMatters",
          "contentAngle",
          "evidence",
          "limitations",
          "familyKey",
        ],
      },
    },
  },
  required: ["findings"],
  additionalProperties: false,
};
