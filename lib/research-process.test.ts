import { afterEach, describe, expect, it, vi } from "vitest";
import { invokeResearchProcess, runResearchWorkflow } from "../scripts/research-runtime.mjs";

const state = vi.hoisted(() => ({ process: vi.fn() }));
vi.mock("@/lib/research", () => ({ processResearchJob: state.process }));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => options,
}));
import { handleResearchProcess } from "../app/routes/api/research/process";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  state.process.mockReset();
});

describe("signed research failure boundary", () => {
  it("records a safe nested storage cause after a large query failure", async () => {
    const secret = "test-only-research-secret-with-at-least-32-characters";
    vi.stubEnv("SESSION_SECRET", secret);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const message = "D1_ERROR: UNIQUE constraint failed: research_findings.team_id, research_findings.family_key";
    state.process.mockImplementation(async (job: { operation: string }) => {
      if (job.operation === "plan") return { sourceIds: [] };
      if (job.operation === "rank") throw new Error(
        `Failed query: insert into research_findings\nparams: ${"private draft text".repeat(600)}`,
        { cause: new Error(message) },
      );
      return { status: "failed" };
    });
    const handler = { fetch: (request: Request) => handleResearchProcess(request) };
    const step = { do: async (_name: string, _config: unknown, work: () => Promise<unknown>) => work() };
    await expect(runResearchWorkflow("run-1", step, (payload: unknown) =>
      invokeResearchProcess(handler, { SESSION_SECRET: secret }, payload),
    )).rejects.toThrow(message);
    expect(state.process.mock.calls.map(([job]) => job.operation)).toEqual(["plan", "rank", "fail"]);
    expect(state.process).toHaveBeenLastCalledWith({ operation: "fail", runId: "run-1", error: message });
    expect(log).toHaveBeenCalledWith("Research job failed:", message);
    expect(JSON.stringify(log.mock.calls)).not.toContain("private draft text");
  });
});
