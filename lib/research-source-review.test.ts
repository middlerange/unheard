import { afterEach, describe, expect, it, vi } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reviewResearchSources, ResearchSourceReviewPending, type ResearchSourceReviewAccess, type ResearchSourceReviewInput, type ResearchSourceReviewRequest } from "./research-source-review";
import { RESEARCH_SOURCE_REVIEW_INSTRUCTIONS, researchSourceReviewPassages } from "./research-source-review-model";
import { ResearchCoveragePending } from "./research-coverage";
import { evidenceJsonSchemaForItems, researchEvidenceSchema, researchHash } from "./research-model";
import { researchEvidenceItemCacheId, type EvidenceCacheContext, type EvidenceCacheValue } from "./research-evidence-cache";
import { researchSectionInventory, researchSourceSections } from "./research-sections";
import { researchQuoteRepairPlan } from "./research-quote-repair";

const folders: string[] = [], workers: ReturnType<typeof spawn>[] = [];
afterEach(() => { workers.splice(0).forEach(worker => worker.kill()); folders.splice(0).forEach(folder => rmSync(folder, { recursive: true, force: true })); vi.restoreAllMocks(); });
const audience = { generalAudience: "Product and growth practitioners.", publishingProfiles: [
  { id: "personal", name: "Builder", platform: "linkedin", groupName: "personal", enabled: true as const, kind: "publishing_profile" as const, systemPrompt: "Research product, growth and team decisions; preserve attribution and uncertainty." },
  { id: "company", name: "Company", platform: "linkedin", groupName: "company", enabled: true as const, kind: "publishing_profile" as const, systemPrompt: "Research product adoption workflows; exclude unsupported hype." },
] };
const context: EvidenceCacheContext = { teamId: "team", model: "claude-haiku-5-5", promptVersion: "frozen-v26", system: "Immutable old qualification contract.", audience,
  selectionViewVersion: "old-selection", selectionAudience: { frozen: true }, schemaForItem: id => evidenceJsonSchemaForItems([id], ["personal", "company"], { sectionCoverage: true }) };
function source(id: string, count = 4): ResearchSourceReviewInput {
  return { id, sourceId: "publisher", title: `Source ${id}`, url: `https://example.com/${id}`, publishedAt: null, discoveredAt: 123,
    contentProvenance: "article", content: Array.from({ length: count }, (_, index) => `Case ${id}-${index}: A coordinator records the proposed change and its unresolved assumptions. A reviewer checks those assumptions before handing the decision record to the implementer, without claiming a measured business improvement.`).join("\n\n") };
}
function baseGrade(item: ResearchSourceReviewInput, familyKey = `base-${item.id}`, rejected = false): EvidenceCacheValue {
  return researchEvidenceSchema.parse({ findings: [{ itemId: item.id, summary: "The documented workflow records assumptions before review and handoff.", evidence: researchSourceReviewPassages(item.content).find(passage => passage.selectable)!.text,
    contentAngle: "Compare an explicit decision handoff to an informal queue.", whyItMatters: "A reader can test where an assumption gets reviewed.", limitations: "Described workflow, not proven effectiveness.", familyKey,
    claimBasis: "described_method", profileChecks: { personal: { fits: true, relevance: 22, reason: "A concrete product-team decision." }, company: { fits: false, relevance: 0, reason: "Outside the company remit." } },
    qualityComponents: { sourceSupport: "supported_bounded_claim", usefulDecision: "useful_distinction_or_signal", scopeHonesty: rejected ? "material_gap" : "accurately_bounded" }, additionalIdeas: [], sectionChecks: [],
  }] });
}
function frame(ids: number[], familyKey: string, rejected = false) {
  return { claimBasis: rejected ? "no_useful_core" : "described_method", profileChecks: [{ profileId: "personal", fits: !rejected, relevance: rejected ? 0 : 22, reason: rejected ? "No supported useful practitioner core." : "A concrete workflow comparison." },
    { profileId: "company", fits: false, relevance: 0, reason: "Outside this company's remit." }],
    claim: { summary: "The coordinator records the assumptions, and a reviewer hands a checked decision to the implementer.", evidencePassageIds: ids,
      contentAngle: "As a proposed test, inspect the review and implementation handoff separately.", whyItMatters: "It identifies who checks the assumptions and what carries forward.", limitations: "A documented method, not evidence of faster work." },
    familyKey, qualityComponents: { sourceSupport: rejected ? "unsupported" : "supported_bounded_claim", usefulDecision: rejected ? "none" : "concrete_decision", scopeHonesty: "accurately_bounded" } };
}
function rawReview(request: ResearchSourceReviewRequest, familyKey?: string) {
  const item = request.data.items[0], passages = item.passages as ReturnType<typeof researchSourceReviewPassages>, ids = passages.filter(passage => passage.selectable).map(passage => passage.passageId);
  return { findings: { [String(item.id)]: { ...frame([ids[0], ids.at(-1)!], familyKey || `review-${item.id}`), additionalIdeas: [] } } };
}
async function harness() {
  const folder = mkdtempSync(join(tmpdir(), "source-review-")); folders.push(folder);
  const python = "import json,sqlite3,sys\nc=sqlite3.connect(sys.argv[1]); c.row_factory=sqlite3.Row\nfor line in sys.stdin:\n try:\n  p=json.loads(line); q=c.execute(p['sql'],p.get('params',[])); r=[dict(x) for x in q.fetchall()]; c.commit(); print(json.dumps({'rows':r,'changes':q.rowcount}),flush=True)\n except Exception as e:\n  print(json.dumps({'error':str(e)}),flush=True)";
  const worker = spawn("python3", ["-u", "-c", python, join(folder, "cache.sqlite")], { stdio: ["pipe", "pipe", "pipe"] }); workers.push(worker);
  const pending: Array<{ resolve: (value: any) => void; reject: (error: Error) => void }> = []; let buffer = "";
  worker.stdout!.on("data", chunk => { buffer += chunk.toString(); while (buffer.includes("\n")) { const end = buffer.indexOf("\n"), value = JSON.parse(buffer.slice(0, end)), request = pending.shift()!; buffer = buffer.slice(end + 1); if (value.error) request.reject(new Error(value.error)); else request.resolve(value); } });
  worker.on("error", error => pending.splice(0).forEach(request => request.reject(error)));
  const sql = (query: string, params: unknown[] = []) => new Promise<any>((resolve, reject) => { pending.push({ resolve, reject }); worker.stdin!.write(JSON.stringify({ sql: query, params }) + "\n"); });
  await sql("CREATE TABLE cache(id TEXT PRIMARY KEY,value TEXT NOT NULL)");
  const read = async (id: string) => { const row = (await sql("SELECT value FROM cache WHERE id=?", [id])).rows[0]; return row ? JSON.parse(row.value) : null; };
  const put = async (id: string, value: unknown) => { await sql("INSERT INTO cache VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value", [id, JSON.stringify(value)]); };
  const records = async (prefix: string) => (await sql("SELECT id,value FROM cache WHERE substr(id,1,?)=? ORDER BY id", [prefix.length, prefix])).rows.map((row: any) => ({ id: row.id, value: JSON.parse(row.value) }));
  const clock = { value: 1_000_000 }, generate = vi.fn(async (request: ResearchSourceReviewRequest): Promise<unknown> => rawReview(request));
  const access: ResearchSourceReviewAccess = { context, now: () => clock.value, read, generate,
    claim: async (id, value) => (await sql("INSERT OR IGNORE INTO cache VALUES(?,?)", [id, JSON.stringify(value)])).changes === 1,
    save: async (id, expected, value) => (await sql("UPDATE cache SET value=? WHERE id=? AND value=?", [JSON.stringify(value), id, JSON.stringify(expected)])).changes === 1,
    writeImmutable: async (id, value) => { await sql("INSERT OR IGNORE INTO cache VALUES(?,?)", [id, JSON.stringify(value)]); } };
  return { access, read, put, records, generate, clock };
}
async function finish(items: ResearchSourceReviewInput[], base: EvidenceCacheValue, access: ResearchSourceReviewAccess) {
  for (let checkpoint = 0; checkpoint < 10; checkpoint++) { try { return await reviewResearchSources(items, base, access); } catch (error) { if (!(error instanceof ResearchSourceReviewPending)) throw error; } }
  throw new Error("Source review did not finish its fixture checkpoints");
}
async function failedBase(item: ResearchSourceReviewInput, h: Awaited<ReturnType<typeof harness>>) {
  const decorated = researchSourceSections(item), raw = baseGrade(item, "invalid-parent"); raw.findings[0].evidence = "A paraphrased assertion that is absent from the original source.";
  const cacheId = await researchEvidenceItemCacheId(context, decorated), plan = await researchQuoteRepairPlan(raw, decorated, ["personal", "company"], cacheId);
  const receipt = { state: "failed", contextId: cacheId, sourceId: item.id, bodyHash: plan.bodyHash, gradeHash: plan.gradeHash, rawGrade: raw, failureKind: "unsupported_core", error: "No captured passage supports this claim." };
  await h.put(plan.id, receipt);
  return { findings: [], evidenceFailures: [{ itemId: item.id, receiptId: plan.id, reason: "Terminal quote grounding failure (unsupported_core): No captured passage supports this claim." }] };
}

describe("source-led whole-capture review with real SQLite checkpoints", () => {
  it("retains the default v1 immutable plan identity", async () => {
    const item=source("policy"),h=await harness();
    await reviewResearchSources([item],baseGrade(item),h.access);
    expect((await h.records("research-source-review-plan:"))[0].id).toBe("research-source-review-plan:v1:7685a0d73c641df63ff512c7b367f322fa64df2a0762279a8b6cdfd2715fa792");
  });
  it("chains a distinct policy once while preserving v1 claims, dates, proofs and diagnostics", async () => {
    const item={...source("policy-chain"),publishedAt:123456,discoveredAt:456789},base=baseGrade(item),h=await harness();
    h.generate.mockImplementation(async request=>{
      const wire=rawReview(request);
      wire.findings[item.id].additionalIdeas=[frame([99999],"invalid-v1-proof")] as never[];
      return wire;
    });
    const first=await reviewResearchSources([item],base,h.access),before=JSON.stringify(first.value),oldRecords=await h.records("research-source-review-");
    expect(await reviewResearchSources([item],base,h.access)).toEqual(first);expect(h.generate).toHaveBeenCalledTimes(1);
    const policy={version:"fixture-review-v2",instructions:"Review the complete documented handoff, preserving existing supported cores.",model:"fixture-review-model"};
    h.generate.mockImplementation(async request=>{
      expect(request.model).toBe(policy.model);expect(request.instructions).toBe(policy.instructions);expect(request.data.sourceReviewVersion).toBe(policy.version);
      const ids=(request.data.items[0].passages as ReturnType<typeof researchSourceReviewPassages>).filter(passage=>passage.selectable).map(passage=>passage.passageId);
      const duplicate=frame([ids[1],ids[2]],"review-policy-chain");duplicate.claim.summary="A later phrasing must not replace an already accepted family.";duplicate.profileChecks[0].relevance=30;
      return {findings:{[item.id]:{...duplicate,additionalIdeas:[frame([ids[1],ids[2]],"separate-checked-handoff"),frame([99999],"invalid-v2-proof")]}}};
    });
    const second=await reviewResearchSources([item],first.value,h.access,policy);
    expect(h.generate).toHaveBeenCalledTimes(2);expect(JSON.stringify(first.value)).toBe(before);
    const ideas=(value:EvidenceCacheValue)=>{const {itemId:_id,additionalIdeas,sectionChecks:_checks,...primary}=value.findings[0];return [primary,...(additionalIdeas||[])];};
    for(const idea of ideas(first.value))expect(ideas(second.value).find(candidate=>candidate.familyKey===idea.familyKey)).toEqual(idea);
    expect(ideas(second.value).map(idea=>idea.familyKey)).toEqual(["base-policy-chain","review-policy-chain","separate-checked-handoff"]);
    expect(second.manifestIds).toHaveLength(2);expect(second.manifestIds[0]).toBe(first.manifestIds[0]);expect(second.value.sourceReviewManifestIds).toEqual(second.manifestIds);
    expect(second.value.multiProofs.filter(proof=>first.manifestIds.includes(proof.reviewManifestId))).toEqual(first.value.multiProofs);
    expect(second.value.multiProofs).toHaveLength(2);expect(second.value.multiProofs[0].evidencePassageIds).not.toEqual(second.value.multiProofs[1].evidencePassageIds);
    expect(second.value.multiProofs.map(proof=>proof.familyKey)).toEqual(["review-policy-chain","separate-checked-handoff"]);
    expect(second.value.sourceReviewDiagnostics.slice(0,first.value.sourceReviewDiagnostics.length)).toEqual(first.value.sourceReviewDiagnostics);
    expect(second.value.sourceReviewDiagnostics).toHaveLength(2);
    for(const record of oldRecords)expect(await h.read(record.id)).toEqual(record.value);
    const plans=await h.records("research-source-review-plan:");expect(plans).toHaveLength(2);expect(plans[0].id).not.toBe(plans[1].id);
    const nextPlan=plans.find((row:{value:{version:string}})=>row.value.version===policy.version)!.value;
    expect(nextPlan.catalogSource).toMatchObject({publishedAt:item.publishedAt,discoveredAt:item.discoveredAt});
    expect(nextPlan.request).toMatchObject({model:policy.model,instructions:policy.instructions});expect(nextPlan.researchView.sourceReviewVersion).toBe(policy.version);
    const repeatedV1=await reviewResearchSources([item],base,h.access);
    expect(await reviewResearchSources([item],repeatedV1.value,h.access,policy)).toEqual(second);expect(h.generate).toHaveBeenCalledTimes(2);
  });
  it("keeps accepted v1 families and proof when a later policy fails without repeating it", async () => {
    const item=source("failed-policy"),h=await harness(),first=await reviewResearchSources([item],baseGrade(item),h.access);
    h.generate.mockRejectedValue(new Error("Later policy request did not complete"));
    const policy={version:"fixture-failed-v2",instructions:"Inspect only supported additional distinctions."};
    const failed=await reviewResearchSources([item],first.value,h.access,policy);
    expect(failed.value.findings).toEqual(first.value.findings);expect(failed.value.multiProofs).toEqual(first.value.multiProofs);
    expect(failed.value.sourceReviewDiagnostics).toEqual(first.value.sourceReviewDiagnostics);expect(failed.manifestIds).toHaveLength(2);
    expect(failed.manifestIds).toContain(first.manifestIds[0]);expect((await h.read(failed.manifestIds[1])).terminalState).toBe("failed");
    expect((await h.records("research-source-review-attempt:")).filter((row:{value:{version:string}})=>row.value.version===policy.version)).toHaveLength(1);
    expect(await reviewResearchSources([item],first.value,h.access,policy)).toEqual(failed);expect(h.generate).toHaveBeenCalledTimes(2);
  });
  it("reviews short and long sources once, budgets2 calls globally and never repeats base/window work", async () => {
    const items = [source("short"), source("long", 35), source("third")], h = await harness(), base = { findings: items.flatMap(item => baseGrade(item).findings) };
    await h.put("research-coverage-attempt:v1:old", { immutable: "old window grade" });
    let offset = 0;
    try { await reviewResearchSources(items, base, h.access); offset++; } catch (error) { expect(error).toBeInstanceOf(ResearchSourceReviewPending); expect(error).toBeInstanceOf(ResearchCoveragePending); }
    expect(offset).toBe(0); expect(h.generate).toHaveBeenCalledTimes(2);
    const completed = await finish(items, base, h.access); offset++;
    expect(offset).toBe(1); expect(h.generate).toHaveBeenCalledTimes(3); expect(completed.manifestIds).toHaveLength(3);
    expect(await reviewResearchSources(items, base, h.access)).toEqual(completed); expect(h.generate).toHaveBeenCalledTimes(3);
    expect(await h.read("research-coverage-attempt:v1:old")).toEqual({ immutable: "old window grade" });
    for (const [request] of h.generate.mock.calls) { expect(request.instructions).toBe(RESEARCH_SOURCE_REVIEW_INSTRUCTIONS); expect(request.data.items).toHaveLength(1); expect(request.data.items[0]).not.toHaveProperty("content"); expect(request.data.items[0].passages).toBeDefined(); }
  });
  it("preserves accepted base families while retaining all passages for new distinct compound frames", async () => {
    const item = source("a"), base = baseGrade(item), before = JSON.stringify(base), h = await harness();
    h.generate.mockImplementation(async request => {
      const wire = rawReview(request, "Base A"), ids = (request.data.items[0].passages as ReturnType<typeof researchSourceReviewPassages>).filter(passage => passage.selectable).map(passage => passage.passageId);
      wire.findings.a.additionalIdeas = [frame([ids[1], ids[2]], "new-compound-frame")] as never[]; return wire;
    });
    const result = await reviewResearchSources([item], base, h.access);
    expect(result.value.findings[0].score).toBe(base.findings[0].score); expect(result.value.findings[0].evidence).toBe(base.findings[0].evidence);
    expect(result.value.multiProofs).toHaveLength(1); expect(result.value.multiProofs[0].familyKey).toBe("new-compound-frame"); expect(result.value.multiProofs[0].passages).toHaveLength(2);
    expect(result.value.multiProofs[0].bodyHash).toBe(await researchHash(item.content));
    expect(JSON.stringify(base)).toBe(before);
    const manifest = await h.read(result.manifestIds[0]); expect(manifest.parent.findings[0]).toEqual(base.findings[0]); expect(manifest.selections[0].decision).toBe("accepted_parent_precedence");
  });
  it("keeps valid siblings when extra frames have bad IDs, missing profiles or score overrides", async () => {
    const item = source("a"), h = await harness();
    h.generate.mockImplementation(async request => {
      const wire = rawReview(request), valid = frame([1, 2], "valid-extra");
      wire.findings.a.additionalIdeas = [valid, { ...frame([9999], "unknown-id") }, { ...frame([1], "override"), score: 100 }, { ...frame([1], "missing-profile"), profileChecks: [] }] as never[];
      return wire;
    });
    const result = await reviewResearchSources([item], baseGrade(item), h.access);
    expect(result.value.multiProofs.map(proof => proof.familyKey)).toEqual(["review-a", "valid-extra"]);
    expect(result.value.sourceReviewDiagnostics).toHaveLength(3);
    expect(result.value.findings[0].additionalIdeas!.map(idea => idea.score)).toEqual([92, 92]);
    expect(h.generate).toHaveBeenCalledTimes(1);
  });
  it("replaces only a rejected base family and retains both raw grades and selected proof in lineage", async () => {
    const item = source("a"), base = baseGrade(item, "review-a", true), h = await harness();
    const result = await reviewResearchSources([item], base, h.access), manifest = await h.read(result.manifestIds[0]);
    expect(base.findings[0].score).toBe(69); expect(result.value.findings[0].score).toBe(92);
    expect(manifest.parent.findings[0].score).toBe(69); expect(manifest.review.findings[0].score).toBe(92); expect(manifest.rawReview.findings.a).toBeDefined();
    expect(manifest.selections[0].decision).toBe("replaced_rejected_family"); expect(result.value.multiProofs).toHaveLength(1);
  });
  it("allows only independently validated new ideas to replace a verified failed parent's status", async () => {
    const item = source("a"), h = await harness(), base = await failedBase(item, h);
    const result = await reviewResearchSources([item], base, h.access), manifest = await h.read(result.manifestIds[0]);
    expect(result.value.findings).toHaveLength(1); expect(result.value.evidenceFailures || []).toEqual([]);
    expect(JSON.stringify(result.value.findings)).not.toContain("invalid-parent"); expect(manifest.parentFailure.failure).toEqual(base.evidenceFailures[0]);
    const other = source("rejected"), failure = await failedBase(other, h);
    h.generate.mockImplementation(async request => ({ findings: { [String(request.data.items[0].id)]: { ...frame([], "no-core", true), additionalIdeas: [] } } }));
    const rejected = await reviewResearchSources([other], failure, h.access);
    expect(rejected.value.findings).toEqual([]); expect(rejected.value.evidenceFailures).toEqual(failure.evidenceFailures);
  });
  it("claims overlapping reviews atomically and makes stale requests indeterminate without late overwrite or paid retry", async () => {
    const items = [source("a"), source("b")], base = { findings: items.flatMap(item => baseGrade(item).findings) }, h = await harness();
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); let active = 0, maximum = 0;
    h.generate.mockImplementation(async request => { active++; maximum = Math.max(maximum, active); await gate; active--; return rawReview(request); });
    const first = reviewResearchSources(items, base, h.access);
    for (let i = 0; i < 50 && h.generate.mock.calls.length < 2; i++) await new Promise(resolve => setTimeout(resolve, 0));
    await expect(reviewResearchSources(items, base, h.access)).rejects.toMatchObject({ retryAfterMs: 15_000, activeSources: 2 });
    h.clock.value += 120_001;
    const stale = await reviewResearchSources(items, base, h.access); release(); await first;
    expect(maximum).toBe(2); expect(h.generate).toHaveBeenCalledTimes(2); expect(stale.value.multiProofs).toEqual([]);
    expect((await h.records("research-source-review-attempt:")).every((row: any) => row.value.state === "indeterminate")).toBe(true);
    expect(await reviewResearchSources(items, base, h.access)).toEqual(stale); expect(h.generate).toHaveBeenCalledTimes(2);
  });
  it("shares the upstream budget and skips captures below500 without inventing source grades", async () => {
    const item = source("a"), h = await harness(), budget = { remaining: 0 };
    await expect(reviewResearchSources([item], baseGrade(item), { ...h.access, budget })).rejects.toBeInstanceOf(ResearchSourceReviewPending);
    expect(h.generate).not.toHaveBeenCalled();
    const short = source("tiny", 1), base = baseGrade(short);
    const result = await reviewResearchSources([short], base, h.access);
    expect(result.value.findings).toEqual(base.findings); expect(result.manifestIds).toEqual([]); expect(h.generate).not.toHaveBeenCalled();
  });
  it("binds full frozen context and source data, and rejects altered receipts/plans without new calls", async () => {
    const item = source("a"), h = await harness(), base = baseGrade(item), first = await reviewResearchSources([item], base, h.access);
    const receipt = (await h.records("research-source-review-attempt:"))[0];
    await h.put(receipt.id, { ...receipt.value, bodyHash: "forged" });
    await expect(reviewResearchSources([item], base, h.access)).rejects.toThrow("frozen source context"); expect(h.generate).toHaveBeenCalledTimes(1);
    await h.put(receipt.id, receipt.value);
    const plan = (await h.records("research-source-review-plan:"))[0]; await h.put(plan.id, { ...plan.value, baseCoveredHash: "forged" });
    await expect(reviewResearchSources([item], base, h.access)).rejects.toThrow("immutable record"); expect(h.generate).toHaveBeenCalledTimes(1);
    await h.put(plan.id, plan.value);
    const changed = { ...context, audience: { ...audience, generalAudience: "Changed frozen audience." } };
    const next = await reviewResearchSources([item], base, { ...h.access, context: changed });
    expect(next.manifestIds[0]).not.toBe(first.manifestIds[0]); expect(h.generate).toHaveBeenCalledTimes(2);
  });
  it("reuses each declared source review when the parent batch expands", async () => {
    const a = source("a"), b = source("b"), h = await harness(), first = await reviewResearchSources([a], baseGrade(a), h.access);
    const expanded = await reviewResearchSources([a, b], { findings: [...baseGrade(a).findings, ...baseGrade(b).findings] }, h.access);
    expect(h.generate).toHaveBeenCalledTimes(2); expect(expanded.manifestIds).toContain(first.manifestIds[0]);
    expect(expanded.value.multiProofs.filter(proof => proof.itemId === a.id)).toEqual(first.value.multiProofs);
  });
  it("keeps compound evidence across sections separate from the legacy primary-anchor section mapping", async () => {
    const item = { ...source("a"), content: `Finding 1: Intake responsibility\n\n${source("intake", 2).content}\n\nFinding 2: Implementation handoff\n\n${source("handoff", 2).content}` }, h = await harness();
    const sections = researchSectionInventory(item.content), passages = researchSourceReviewPassages(item.content);
    const intake = passages.find(passage => passage.start >= sections[0].bodyStart && passage.end <= sections[0].end)!, handoff = passages.find(passage => passage.start >= sections[1].bodyStart && passage.end <= sections[1].end)!;
    const base = baseGrade(item); base.findings[0].evidence = intake.text; base.findings[0].sectionChecks = sections.map((section, index) => ({ sectionId: section.id, familyKeys: index ? [] : ["base-a"], notPostworthyReason: index ? "No independent parent idea was returned for the handoff section." : "" }));
    h.generate.mockImplementation(async () => ({ findings: { a: { ...frame([intake.passageId, handoff.passageId], "compound-handoff"), additionalIdeas: [] } } }));
    const result = await reviewResearchSources([item], base, h.access), checks = result.value.findings[0].sectionChecks!;
    expect(result.value.multiProofs[0].passages.map(passage => passage.text)).toEqual([intake.text, handoff.text]);
    expect(checks[0].familyKeys).toContain("compound-handoff"); expect(checks[1].familyKeys).not.toContain("compound-handoff");
    expect(checks[1].notPostworthyReason).toBeTruthy();
  });
  it("makes a request failure terminal while valid neighboring sources finish without automatic API retries", async () => {
    const a = source("a"), b = source("b"), h = await harness(), base = { findings: [...baseGrade(a).findings, ...baseGrade(b).findings] };
    h.generate.mockImplementation(async request => { if (request.data.items[0].id === "a") throw new Error("Provider request did not complete"); return rawReview(request); });
    const result = await reviewResearchSources([a, b], base, h.access);
    expect(result.value.findings.find(finding => finding.itemId === "a")!.additionalIdeas).toEqual([]);
    expect(result.value.multiProofs.map(proof => proof.itemId)).toEqual(["b"]);
    expect((await h.records("research-source-review-attempt:")).filter((row: any) => row.value.state === "failed")).toHaveLength(1);
    expect(await reviewResearchSources([a, b], base, h.access)).toEqual(result); expect(h.generate).toHaveBeenCalledTimes(2);
  });
  it("retries idempotent storage responses without repeating the declared source review", async () => {
    const item = source("a"), h = await harness(), claim = h.access.claim, save = h.access.save;
    let lostClaim = false, lostSave = false;
    h.access.claim = async (id, value) => { const inserted = await claim(id, value); if (inserted && !lostClaim) { lostClaim = true; throw new Error("Network connection lost."); } return inserted; };
    h.access.save = async (id, expected, value) => { const saved = await save(id, expected, value); if (saved && !lostSave) { lostSave = true; throw new Error("D1_ERROR: Network connection lost."); } return saved; };
    const result = await reviewResearchSources([item], baseGrade(item), h.access);
    expect(lostClaim && lostSave).toBe(true); expect(h.generate).toHaveBeenCalledTimes(1);
    expect(await reviewResearchSources([item], baseGrade(item), h.access)).toEqual(result); expect(h.generate).toHaveBeenCalledTimes(1);
  });
});
