import { describe, expect, it } from "vitest";
import { researchJobErrorMessage } from "./research-errors";

describe("research job failure reporting", () => {
  it("preserves the underlying D1 cause without returning a query or its bindings", () => {
    const cause = new Error("D1_ERROR: UNIQUE constraint failed: research_findings.team_id, research_findings.family_key");
    const error = new Error(`Failed query: insert into research_findings\nparams: ${"private content".repeat(1000)}`, {
      cause: new Error("Database operation failed", { cause }),
    });
    expect(researchJobErrorMessage(error)).toBe(cause.message);
  });

  it("does not expose query parameters when an underlying cause is unavailable", () => {
    expect(researchJobErrorMessage(new Error("Failed query: insert into records\nparams: private"))).toBe(
      "Research storage failed; no underlying database error was available.",
    );
    expect(researchJobErrorMessage(new Error("Request failed\nparams: private"))).not.toContain("private");
  });

  it("bounds a long underlying diagnostic to the persisted failure limit", () => {
    const message = `D1_ERROR: ${"x".repeat(2000)}`;
    expect(researchJobErrorMessage(new Error("Wrapper", { cause: new Error(message) }))).toBe(message.slice(0, 500));
  });

  it("handles serialized or string causes and cyclic errors without losing the diagnostic", () => {
    expect(researchJobErrorMessage(new Error("Wrapper", { cause: { message: "D1_ERROR: database unavailable" } }))).toBe("D1_ERROR: database unavailable");
    expect(researchJobErrorMessage(new Error("Wrapper", { cause: "D1_ERROR: database unavailable" }))).toBe("D1_ERROR: database unavailable");
    const cycle = new Error("Source returned HTTP 429");
    cycle.cause = cycle;
    expect(researchJobErrorMessage(cycle)).toBe("Source returned HTTP 429");
    expect(researchJobErrorMessage(null)).toBe("Research job failed");
  });
});
