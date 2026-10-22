import { ZodError } from "zod";
import { getRequestTeamId } from "./auth";
export async function researchHttp(
  request: Request,
  action: (teamId: string) => Promise<unknown>,
  status = 200,
) {
  const teamId = await getRequestTeamId(request);
  if (teamId instanceof Response) return teamId;
  try {
    return Response.json(await action(teamId), {
      status,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof ZodError || error instanceof SyntaxError)
      return Response.json(
        {
          error: "Invalid research request",
          ...(error instanceof ZodError
            ? { details: error.issues.map((issue) => issue.message) }
            : {}),
        },
        { status: 400 },
      );
    const message =
      error instanceof Error ? error.message : "Research request failed";
    if (/not found/i.test(message))
      return Response.json({ error: message }, { status: 404 });
    if (/Enable at least|Set OPENAI_API_KEY/i.test(message))
      return Response.json({ error: message }, { status: 400 });
    if (/Workflow is unavailable/i.test(message))
      return Response.json({ error: message }, { status: 503 });
    console.error("Research request failed:", error);
    return Response.json(
      { error: "Research request failed. Please retry." },
      { status: 500 },
    );
  }
}
