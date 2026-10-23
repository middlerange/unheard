import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { processSlackJob, retrySlackJobs } from "@/lib/slack-review";
import { verifyResearchRequest } from "@/lib/research-internal";
export async function handleSlackProcess(request: Request) {
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
  try {
    const input = z
      .discriminatedUnion("operation", [
        z.object({ operation: z.literal("dispatch") }).strict(),
        z
          .object({
            operation: z.literal("process"),
            jobId: z.string().min(1).max(200),
          })
          .strict(),
      ])
      .parse(JSON.parse(body));
    return Response.json(
      input.operation === "dispatch"
        ? await retrySlackJobs()
        : await processSlackJob(input.jobId),
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Slack job failed" },
      { status: 500 },
    );
  }
}
export const Route = createFileRoute("/api/slack/process")({
  server: { handlers: { POST: ({ request }) => handleSlackProcess(request) } },
});
