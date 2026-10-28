import { afterEach, describe, expect, it, vi } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { coverResearchEvidence, ResearchCoveragePending, RESEARCH_WINDOW_SCOPE_INSTRUCTIONS, type ResearchCoverageAccess, type ResearchCoverageSource } from "./research-coverage";
import { evidenceJsonSchemaForItems, researchEvidenceSchema } from "./research-model";
import { researchEvidenceItemCacheId, type EvidenceCacheContext, type EvidenceCacheValue } from "./research-evidence-cache";
import { researchSourceSections } from "./research-sections";
import { researchEvidenceWindows } from "./research-window-focus";
import { researchQuoteRepairPlan } from "./research-quote-repair";

const folders: string[] = [];
const workers: ReturnType<typeof spawn>[] = [];
afterEach(() => { for (const worker of workers.splice(0)) worker.kill(); for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true }); vi.restoreAllMocks(); });
const context: EvidenceCacheContext = { teamId: "team", model: "frozen-model", promptVersion: "frozen-source-rubric", system: "Frozen qualification and section instructions.",
  audience: { publishingProfiles: [{ id: "personal" }, { id: "company" }] }, selectionViewVersion: "selection-v1", selectionAudience: { frozen: true },
  schemaForItem: id => evidenceJsonSchemaForItems([id], ["personal", "company"], { sectionCoverage: true }) };
function source(id: string, paragraphs = 34): ResearchCoverageSource {
  return { id, sourceId: "publisher", title: `Source ${id}`, url: `https://example.com/${id}`, publishedAt: null, discoveredAt: 100,
    contentProvenance: "article", content: `The defined sample records practitioner choices without establishing causal effectiveness.\n\n` + Array.from({ length: paragraphs }, (_, index) =>
      `Case ${id}-${index} records a concrete workflow decision and the assumptions needed to interpret it. Teams compare the documented tradeoff before choosing the next experiment, without claiming a measured business improvement.\n\n`).join("") };
}
const quote = (body: string) => body.match(/[^\n.!?]{30,220}[.!?]/)![0].trim();
function grade(item: ResearchCoverageSource, familyKey = `parent-${item.id}`, evidence = quote(item.content), rejected = false): EvidenceCacheValue {
  return researchEvidenceSchema.parse({ findings: [{ itemId: item.id, summary: "A specific documented practitioner distinction.", evidence, contentAngle: "Compare this distinction before selecting an experiment.",
    whyItMatters: "The reader can inspect a concrete assumption.", limitations: "Reported practice, without a causal effectiveness claim.", familyKey, claimBasis: "measured_observation",
    profileChecks: { personal: { fits: true, relevance: 22, reason: "A specific practitioner comparison." }, company: { fits: false, relevance: 0, reason: "Outside this company's remit." } },
    qualityComponents: { sourceSupport: "supported_bounded_claim", usefulDecision: "useful_distinction_or_signal", scopeHonesty: rejected ? "material_gap" : "accurately_bounded" }, additionalIdeas: [], sectionChecks: [],
  }] });
}
async function harness(inputs: ResearchCoverageSource[]) {
  const folder = mkdtempSync(join(tmpdir(), "research-coverage-")); folders.push(folder);
  const path = join(folder, "cache.sqlite"), clock = { value: 1_000_000 };
  const python = "import json,sqlite3,sys\nc=sqlite3.connect(sys.argv[1])\nc.row_factory=sqlite3.Row\nfor line in sys.stdin:\n try:\n  p=json.loads(line); q=c.execute(p['sql'],p.get('params',[])); r=[dict(x) for x in q.fetchall()]; c.commit(); print(json.dumps({'rows':r,'changes':q.rowcount}),flush=True)\n except Exception as e:\n  print(json.dumps({'error':str(e)}),flush=True)";
  const worker = spawn("python3", ["-u", "-c", python, path], { stdio: ["pipe", "pipe", "pipe"] }); workers.push(worker);
  const requests: Array<{ resolve: (value: { rows: Array<{ id: string; value: string }>; changes: number }) => void; reject: (error: Error) => void }> = [];
  let buffer = "";
  worker.stdout!.on("data", chunk => {
    buffer += chunk.toString();
    while (buffer.includes("\n")) {
      const end = buffer.indexOf("\n"), response = JSON.parse(buffer.slice(0, end)), request = requests.shift()!; buffer = buffer.slice(end + 1);
      if (response.error) request.reject(new Error(response.error)); else request.resolve(response);
    }
  });
  worker.on("error", error => { for (const request of requests.splice(0)) request.reject(error); });
  const sql = (query: string, params: unknown[] = []) => new Promise<{ rows: Array<{ id: string; value: string }>; changes: number }>((resolve, reject) => {
    requests.push({ resolve, reject }); worker.stdin!.write(JSON.stringify({ sql: query, params }) + "\n");
  });
  await sql("CREATE TABLE cache (id TEXT PRIMARY KEY, value TEXT NOT NULL)");
  const read = async (id: string) => { const row = (await sql("SELECT value FROM cache WHERE id=?", [id])).rows[0]; return row ? JSON.parse(row.value) : null; };
  const put = async (id: string, value: unknown) => { await sql("INSERT INTO cache(id,value) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value", [id, JSON.stringify(value)]); };
  const sources = new Map(inputs.map(item => [item.id, item]));
  const generated: ResearchCoverageSource[] = [];
  const defaultGenerate = async (item: ResearchCoverageSource) => {
    const descriptor = item.windowFocus as { window: { start: number; end: number } };
    const original = sources.get(item.id)!;
    return grade(item, `window-${item.id}-${descriptor.window.start}`, quote(original.content.slice(descriptor.window.start, descriptor.window.end)));
  };
  const generate = vi.fn(async (item: ResearchCoverageSource) => { generated.push(item); return defaultGenerate(item); });
  const access: ResearchCoverageAccess = { context, now: () => clock.value, read,
    claim: async (id, value) => (await sql("INSERT OR IGNORE INTO cache(id,value) VALUES(?,?)", [id, JSON.stringify(value)])).changes === 1,
    save: async (id, expected, value) => (await sql("UPDATE cache SET value=? WHERE id=? AND value=?", [JSON.stringify(value), id, JSON.stringify(expected)])).changes === 1,
    writeImmutable: async (id, value) => { await sql("INSERT OR IGNORE INTO cache(id,value) VALUES(?,?)", [id, JSON.stringify(value)]); }, generate };
  const records = async (prefix: string) => (await sql("SELECT id,value FROM cache WHERE substr(id,1,?)=? ORDER BY id", [prefix.length, prefix])).rows.map(row => ({ id: row.id, value: JSON.parse(row.value) }));
  return { access, read, put, records, generate, generated, defaultGenerate, clock, sources };
}
async function finish(items: ResearchCoverageSource[], base: EvidenceCacheValue, access: ResearchCoverageAccess) {
  for (let checkpoints = 0; checkpoints < 30; checkpoints++) {
    try { return await coverResearchEvidence(items, base, access); }
    catch (error) { if (!(error instanceof ResearchCoveragePending)) throw error; }
  }
  throw new Error("Coverage did not finish within the fixture's expected checkpoints");
}
async function failureValue(item: ResearchCoverageSource, access: ResearchCoverageAccess, put: (id: string, value: unknown) => Promise<void>) {
  const rawGrade = grade(item, "unsupported-parent-core", "A paraphrased statement absent from this captured public source body.");
  const contextId = await researchEvidenceItemCacheId(context, item), plan = await researchQuoteRepairPlan(rawGrade, item, ["personal", "company"], contextId);
  const receipt = { state: "failed", contextId, sourceId: item.id, bodyHash: plan.bodyHash, gradeHash: plan.gradeHash,
    rawGrade, failureKind: "unsupported_core", error: "No captured passage supports the existing core." };
  await put(plan.id, receipt);
  return { findings: [], evidenceFailures: [{ itemId: item.id, receiptId: plan.id, reason: "Terminal quote grounding failure (unsupported_core): No captured passage supports the existing core." }] };
}

describe("checkpointed generic evidence coverage with real SQLite receipts", () => {
  it("spends at most2 windows then checkpoints without advancing a replay offset; terminal reuse spends zero", async () => {
    const item = source("a"), base = grade(item), h = await harness([item]);
    let offset = 0;
    try { await coverResearchEvidence([item], base, h.access); offset++; } catch (error) {
      expect(error).toBeInstanceOf(ResearchCoveragePending);
      expect((error as ResearchCoveragePending).retryAfterMs).toBe(0);
    }
    expect(offset).toBe(0);
    expect(h.generate).toHaveBeenCalledTimes(2);
    const completed = await finish([item], base, h.access); offset++;
    expect(offset).toBe(1);
    expect(h.generate).toHaveBeenCalledTimes(researchEvidenceWindows(item.content).length);
    expect(completed.manifestIds).toHaveLength(1);
    const count = h.generate.mock.calls.length;
    expect(await coverResearchEvidence([item], base, h.access)).toEqual(completed);
    expect(h.generate).toHaveBeenCalledTimes(count);
    expect(h.generated.every(input => input.windowScopeInstructions === RESEARCH_WINDOW_SCOPE_INSTRUCTIONS)).toBe(true);
  });
  it("shares a2-window budget across wrappers and preserves short parent identity without coverage records", async () => {
    const a = source("a", 24), b = source("b", 24), h = await harness([a, b]), budget = { remaining: 2 };
    expect(researchEvidenceWindows(a.content)).toHaveLength(2);
    await coverResearchEvidence([a], grade(a), { ...h.access, budget });
    await expect(coverResearchEvidence([b], grade(b), { ...h.access, budget })).rejects.toBeInstanceOf(ResearchCoveragePending);
    expect(h.generate).toHaveBeenCalledTimes(2);
    const short = source("short", 2), shortBase = grade(short);
    expect(await coverResearchEvidence([short], shortBase, { ...h.access, budget })).toEqual({ value: shortBase, manifestIds: [] });
    expect((await coverResearchEvidence([short], shortBase, h.access)).value).toBe(shortBase);
  });
  it("reuses source-local coverage when a cached parent batch expands and never writes base cache IDs", async () => {
    const a = source("a"), b = source("b"), h = await harness([a, b]);
    const parentId = await researchEvidenceItemCacheId(context, researchSourceSections(a)); await h.put(parentId, grade(a));
    const first = await finish([a], grade(a), h.access), calls = h.generate.mock.calls.length;
    const expanded = await finish([a, b], { findings: [...grade(a).findings, ...grade(b).findings] }, h.access);
    expect(h.generate.mock.calls.length - calls).toBe(researchEvidenceWindows(b.content).length);
    expect(expanded.manifestIds).toContain(first.manifestIds[0]);
    expect(await h.read(parentId)).toEqual(grade(a));
  });
  it("atomically claims overlapping calls and allows only2 concurrent callbacks", async () => {
    const item = source("a", 24), h = await harness([item]);
    let release!: () => void, active = 0, maximum = 0;
    const gate = new Promise<void>(resolve => { release = resolve; });
    h.generate.mockImplementation(async input => { active++; maximum = Math.max(maximum, active); await gate; active--; return h.defaultGenerate(input); });
    const first = coverResearchEvidence([item], grade(item), h.access);
    for (let i = 0; i < 50 && h.generate.mock.calls.length < 2; i++) await new Promise(resolve => setTimeout(resolve, 0));
    await expect(coverResearchEvidence([item], grade(item), h.access)).rejects.toMatchObject({ retryAfterMs: 15_000, activeWindows: 2 });
    expect(h.generate).toHaveBeenCalledTimes(2);
    release(); await first;
    expect(maximum).toBe(2);
    expect((await h.records("research-coverage-attempt:")).every(row => row.value.state === "assessed")).toBe(true);
  });
  it("turns stale started attempts into terminal indeterminate outcomes without paid retries or late overwrite", async () => {
    const item = source("a", 24), h = await harness([item]);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    h.generate.mockImplementation(async input => { await gate; return h.defaultGenerate(input); });
    const first = coverResearchEvidence([item], grade(item), h.access);
    for (let i = 0; i < 50 && h.generate.mock.calls.length < 2; i++) await new Promise(resolve => setTimeout(resolve, 0));
    h.clock.value += 120_001;
    const stale = await coverResearchEvidence([item], grade(item), h.access);
    expect(stale.value.findings[0].additionalIdeas).toEqual([]);
    release(); await first;
    expect(h.generate).toHaveBeenCalledTimes(2);
    expect((await h.records("research-coverage-attempt:")).every(row => row.value.state === "indeterminate")).toBe(true);
    expect(await coverResearchEvidence([item], grade(item), h.access)).toEqual(stale);
    expect(h.generate).toHaveBeenCalledTimes(2);
  });
  it("reserves concurrency for in-flight windows when the visible source batch expands or changes order", async () => {
    const a = source("a", 24), b = source("b", 24), h = await harness([a, b]);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    h.generate.mockImplementation(async input => { await gate; return h.defaultGenerate(input); });
    const first = coverResearchEvidence([a], grade(a), h.access);
    for (let i = 0; i < 50 && h.generate.mock.calls.length < 2; i++) await new Promise(resolve => setTimeout(resolve, 0));
    await expect(coverResearchEvidence([b, a], { findings: [...grade(b).findings, ...grade(a).findings] }, h.access)).rejects.toMatchObject({ activeWindows: 2, retryAfterMs: 0 });
    expect(h.generate).toHaveBeenCalledTimes(2);
    release(); await first;
    await finish([b, a], { findings: [...grade(b).findings, ...grade(a).findings] }, h.access);
    expect(h.generate).toHaveBeenCalledTimes(4);
  });
  it("caches a focal-invalid result as terminal failure, continues its neighbors and never retries it", async () => {
    const item = source("a"), h = await harness([item]), spans = researchEvidenceWindows(item.content);
    h.generate.mockImplementation(async input => {
      const descriptor = input.windowFocus as { window: { start: number } };
      return descriptor.window.start === spans[1].start ? grade(input, "context-only-family", quote(item.content)) : h.defaultGenerate(input);
    });
    const result = await finish([item], grade(item), h.access);
    expect(result.value.findings[0].additionalIdeas!.some(idea => idea.familyKey === "context-only-family")).toBe(false);
    const failed = (await h.records("research-coverage-attempt:")).filter(row => row.value.state === "failed");
    expect(failed).toHaveLength(1);
    expect(failed[0].value.reason).toContain("context-only quotes");
    expect((await h.read(result.manifestIds[0])).coverageComplete).toBe(false);
    const calls = h.generate.mock.calls.length; await coverResearchEvidence([item], grade(item), h.access);
    expect(h.generate).toHaveBeenCalledTimes(calls);
  });
  it("recovers only scoped ideas from a verified failed parent and retains its raw failure solely in the manifest", async () => {
    const item = source("a"), h = await harness([item]), decorated = researchSourceSections(item);
    const base = await failureValue(decorated, h.access, h.put);
    const result = await finish([item], base, h.access);
    expect(result.value.findings).toHaveLength(1);
    expect(result.value.evidenceFailures || []).toEqual([]);
    expect(JSON.stringify(result.value.findings)).not.toContain("unsupported-parent-core");
    expect((await h.read(result.manifestIds[0])).parent.failure).toEqual(base.evidenceFailures[0]);
  });
  it("reverifies projected terminal failures on reuse and rejects forged source/plan receipts without new calls", async () => {
    const item = source("a", 24), h = await harness([item]);
    h.generate.mockImplementation(async input => failureValue(input, h.access, h.put));
    const result = await finish([item], grade(item), h.access);
    expect(result.value.findings[0].additionalIdeas).toEqual([]);
    const attempts = await h.records("research-coverage-attempt:");
    expect(attempts.every(row => row.value.failureKind === "projected_evidence_failure")).toBe(true);
    const failure = attempts[0].value.result.evidenceFailures[0], receipt = await h.read(failure.receiptId);
    await h.put(failure.receiptId, { ...receipt, bodyHash: "forged" });
    await expect(coverResearchEvidence([item], grade(item), h.access)).rejects.toThrow();
    expect(h.generate).toHaveBeenCalledTimes(2);
    await h.put(failure.receiptId, receipt);
    await h.put(attempts[0].id, { ...attempts[0].value, projectionHash: "forged" });
    await expect(coverResearchEvidence([item], grade(item), h.access)).rejects.toThrow("frozen source context");
    expect(h.generate).toHaveBeenCalledTimes(2);
  });
  it("retries lost storage responses idempotently without repeating a model callback", async () => {
    const item = source("a", 24), h = await harness([item]), claim = h.access.claim, save = h.access.save;
    let lostClaim = false, lostSave = false;
    h.access.claim = async (id, value) => {
      const inserted = await claim(id, value);
      if (inserted && !lostClaim) { lostClaim = true; throw new Error("D1_ERROR: Network connection lost."); }
      return inserted;
    };
    h.access.save = async (id, expected, value) => {
      const saved = await save(id, expected, value);
      if (saved && !lostSave) { lostSave = true; throw new Error("Network connection lost."); }
      return saved;
    };
    const result = await coverResearchEvidence([item], grade(item), h.access);
    expect(result.manifestIds).toHaveLength(1);
    expect(lostClaim && lostSave).toBe(true);
    expect(h.generate).toHaveBeenCalledTimes(2);
    await coverResearchEvidence([item], grade(item), h.access);
    expect(h.generate).toHaveBeenCalledTimes(2);
  });
  it("retains the verified parent failure when all scoped assessments are rejected", async () => {
    const item = source("a", 24), h = await harness([item]), base = await failureValue(researchSourceSections(item), h.access, h.put);
    h.generate.mockImplementation(async input => {
      const result = await h.defaultGenerate(input);
      return grade(input, result.findings[0].familyKey, result.findings[0].evidence, true);
    });
    const result = await coverResearchEvidence([item], base, h.access);
    expect(result.value.findings).toEqual([]);
    expect(result.value.evidenceFailures).toEqual(base.evidenceFailures);
    const manifest = await h.read(result.manifestIds[0]);
    expect(manifest.lineage.every((entry: any) => entry.assessment.score === 69)).toBe(true);
    expect(manifest.parent.failure).toEqual(base.evidenceFailures[0]);
    await coverResearchEvidence([item], base, h.access);
    expect(h.generate).toHaveBeenCalledTimes(2);
  });
  it("rejects altered immutable plans and final manifests without trusting them or spending again", async () => {
    const item = source("a", 24), h = await harness([item]), result = await coverResearchEvidence([item], grade(item), h.access);
    const plan = (await h.records("research-coverage-plan:"))[0];
    await h.put(plan.id, { ...plan.value, strategyHash: "forged" });
    await expect(coverResearchEvidence([item], grade(item), h.access)).rejects.toThrow("immutable record differs");
    await h.put(plan.id, plan.value);
    const manifest = await h.read(result.manifestIds[0]);
    await h.put(result.manifestIds[0], { ...manifest, sourceId: "foreign-source" });
    await expect(coverResearchEvidence([item], grade(item), h.access)).rejects.toThrow("immutable record differs");
    expect(h.generate).toHaveBeenCalledTimes(2);
  });
});
