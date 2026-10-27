import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { processResearchJob } from "@/lib/research";
import { verifyResearchRequest } from "@/lib/research-internal";
import { researchJobErrorMessage } from "@/lib/research-errors";
export const researchJobSchema = z
  .object({
    operation: z.enum(["plan", "collect", "rank", "drafts", "fail", "daily"]),
    runId: z.string().max(100).optional(),
    sourceId: z.string().max(200).optional(),
    error: z.string().max(1000).optional(),
    scheduledTime: z.number().int().nonnegative().optional(),
  })
  .strict();
export async function handleResearchProcess(request: Request) {
  if (Number(request.headers.get("content-length") || 0) > 5000)
    return Response.json({ error: "Payload too large" }, { status: 413 });
  const body = await request.text();
  if (body.length > 5000)
    return Response.json({ error: "Payload too large" }, { status: 413 });
  if (
    !(await verifyResearchRequest(
      request,
      body,
      process.env.SESSION_SECRET || "",
    ))
  )
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  let job: z.infer<typeof researchJobSchema>;
  try {
    job = researchJobSchema.parse(JSON.parse(body));
  } catch {
    return Response.json({ error: "Invalid research job" }, { status: 400 });
  }
  try {
    return Response.json(await processResearchJob(job));
  } catch (error) {
    const message = researchJobErrorMessage(error);
    console.error("Research job failed:", message);
    return Response.json(
      { error: message },
      { status: 500 },
    );
  }
}
export const Route = createFileRoute("/api/research/process")({
  server: {
    handlers: { POST: ({ request }) => handleResearchProcess(request) },
  },
});
