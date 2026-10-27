import { anthropicResearchRequest, anthropicResearchOutput, type AnthropicResearchResponse } from '../lib/research-anthropic';
import { RESEARCH_POST_MIN_SCORE } from '../lib/research-policy';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { RESEARCH_MODEL, RESEARCH_SCREEN_BATCH_SIZE, researchScreeningSchema, validateResearchScreening, validateResearchEvidenceCoverage, RESEARCH_PROMPT_VERSION, RESEARCH_SCREEN_INSTRUCTIONS, RESEARCH_EVIDENCE_INSTRUCTIONS, screeningJsonSchema, screeningJsonSchemaForItems, evidenceJsonSchema, researchEvidenceSchema, matchResearchQuote, researchHash, type ResearchEvidence } from '../lib/research-model';

type ModelValue = { assessments?: Array<{ itemId: string; selected: boolean; reason: string }>; itemIds?: string[]; findings?: ResearchEvidence[] };
type Assessment = ResearchEvidence & { grounded: boolean };
type Case = { id: string; label: 'positive' | 'negative'; title: string; source_text: string; split: string; family_id: string; content_provenance?: string; source_urls?: string[]; source_id?: string; date?: string; source_date?: string };
const args = process.argv.slice(2);
function argument(name: string, fallback?: string) { const index = args.indexOf(`--${name}`); const value = index < 0 ? fallback : args[index + 1]; if (!value) throw new Error(`Missing --${name}`); return value; }
const benchmarkPath = argument('benchmark'), output = argument('out'), variant = argument('variant', 'current'), split = argument('split', 'development');
if (!['baseline', 'current'].includes(variant)) throw new Error('--variant must be baseline or current');
const threshold = Number(argument('threshold', variant === 'baseline' ? '80' : String(RESEARCH_POST_MIN_SCORE)));
if (!Number.isInteger(threshold) || threshold < 70 || threshold > 100) throw new Error('Threshold must be 70–100');
const benchmark = await Bun.file(benchmarkPath).json();
const cases: Case[] = (Array.isArray(benchmark) ? benchmark : benchmark.cases).filter((item: Case) => split === 'all' || item.split === split);
if (!cases.length || new Set(cases.map(item => item.id)).size !== cases.length) throw new Error('Benchmark must have unique cases in the selected split');
for (const item of cases) if (!['positive', 'negative'].includes(item.label) || !item.source_text || !item.family_id) throw new Error(`Invalid benchmark case ${item.id}`);
const context = await Bun.file(argument('context')).json();
if (typeof context.icp !== 'string' || !context.icp) throw new Error('Context requires icp');
const legacy = variant === 'baseline' ? await Bun.file(argument('legacy-prompts')).json() : null;
const screenInstructions = legacy?.screen ?? RESEARCH_SCREEN_INSTRUCTIONS;
const evidenceInstructions = legacy?.evidence ?? RESEARCH_EVIDENCE_INSTRUCTIONS;
const version = legacy?.version ?? RESEARCH_PROMPT_VERSION;
await mkdir(join(output, 'calls'), { recursive: true });
const calls: Array<{ stage: string; cache: boolean; usage: unknown; file: string }> = [];
async function model(stage: string, instructions: string, items: unknown[], schema: Record<string, unknown>, maxOutputTokens: number): Promise<ModelValue> {
  const input = JSON.stringify({ icp: context.icp, items });
  const hash = await researchHash(JSON.stringify({ model: RESEARCH_MODEL, instructions, input, schema, maxOutputTokens }));
  const file = join(output, 'calls', `${hash}.json`);
  if (await Bun.file(file).exists()) { const saved = await Bun.file(file).json(); if (saved.status === 'completed') { calls.push({ stage, cache: true, usage: saved.usage, file }); return saved.value as ModelValue; } if (saved.status === 'parse_error' && args.includes('--retry-invalid-output') && !await Bun.file(file + '.failed.json').exists()) { await Bun.write(file + '.failed.json', JSON.stringify(saved, null, 2)); } else throw new Error(`Previous call has unresolved outcome: ${file}`); }
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY unavailable');
  await Bun.write(file, JSON.stringify({ stage, status: 'pending', started_at: new Date().toISOString(), request_hash: hash }, null, 2));
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', signal: AbortSignal.timeout(90_000), headers: { 'x-api-key': key, 'anthropic-version': '2026-10-21', 'Content-Type': 'application/json' },
    body: JSON.stringify(anthropicResearchRequest(RESEARCH_MODEL, instructions, { icp: context.icp, items }, schema, maxOutputTokens)),
  });
  if (!response.ok) { await Bun.write(file, JSON.stringify({ stage, status: 'http_error', http_status: response.status }, null, 2)); throw new Error(`Evaluation model request failed: HTTP ${response.status}`); }
  const result = await response.json() as AnthropicResearchResponse;
  const text = anthropicResearchOutput(result);
  const saved = { stage, status: result.stop_reason === 'end_turn' ? 'completed' : result.stop_reason, response_id: result.id, model: result.model, usage: result.usage, raw_output: text, value: null as ModelValue | null };
  await Bun.write(file, JSON.stringify(saved, null, 2));
  if (result.stop_reason === 'end_turn' && text) {
    try { saved.value = JSON.parse(text) as ModelValue; } catch { saved.status = 'parse_error'; }
    await Bun.write(file, JSON.stringify(saved, null, 2));
  }
  calls.push({ stage, cache: false, usage: result.usage, file });
  if (!saved.value) throw new Error(`Evaluation did not complete; saved usage at ${file}`);
  return saved.value as ModelValue;
}
const items = cases.map(item => ({ id: item.id, title: item.title, sourceId: item.source_id ?? (item.source_urls?.[0] ? new URL(item.source_urls[0]).hostname : 'supplied-source'), publishedAt: (item.source_date ?? item.date) ? Date.parse(item.source_date ?? item.date!) || null : null, content: item.source_text.slice(0, 14000), contentProvenance: item.content_provenance ?? 'article' }));
const metadata = items.map(item => ({ id: item.id, title: item.title, excerpt: item.content.slice(0, 900), publicText: item.content, contentProvenance: item.contentProvenance, publishedAt: item.publishedAt, sourceId: item.sourceId }));
const selected = new Set<string>();
const screenSchema = variant === 'baseline' ? { type: 'object', additionalProperties: false, required: ['itemIds'], properties: { itemIds: { type: 'array', items: { type: 'string' }, maxItems: 12 } } } : screeningJsonSchema;
const screenBatchSize = variant === 'baseline' ? 80 : RESEARCH_SCREEN_BATCH_SIZE;
for (let start = 0; start < metadata.length; start += screenBatchSize) {
  const batch = metadata.slice(start, start + screenBatchSize), allowed = new Set(batch.map(item => item.id));
  const value = await model('screen', screenInstructions, batch, variant === 'baseline' ? screenSchema : screeningJsonSchemaForItems(batch.map(item => item.id)), variant === 'baseline' ? 1000 : 5000);
  if (variant !== 'baseline') value.itemIds = validateResearchScreening(researchScreeningSchema.parse(value), batch.map(item => item.id)).itemIds;
  for (const id of value.itemIds ?? []) if (allowed.has(id)) selected.add(id);
}
if (variant === 'baseline' && selected.size > 12) {
  const value = await model('shortlist', screenInstructions + ' Choose the best 12 overall from these batch shortlists, giving substantive older insights the same consideration as recent entries.', metadata.filter(item => selected.has(item.id)), screenSchema, 1000);
  const allowed = new Set(selected); selected.clear(); for (const id of value.itemIds ?? []) if (allowed.has(id)) selected.add(id);
}
const reviewed = items.filter(item => selected.has(item.id));
const assessments = new Map<string, Assessment>();
for (let start = 0; start < reviewed.length; start += 6) {
  const batch = reviewed.slice(start, start + 6), allowed = new Map(batch.map(item => [item.id, item]));
  const schema = { ...evidenceJsonSchema, properties: { findings: { ...evidenceJsonSchema.properties.findings, minItems: batch.length, maxItems: batch.length } } };
  const raw = researchEvidenceSchema.parse(await model('evidence', evidenceInstructions, batch.map(({ sourceId, ...item }) => ({ ...item, sourceId })), schema, 5000));
  if (variant !== 'baseline') validateResearchEvidenceCoverage(raw.findings, batch.map(item => item.id));
  for (const finding of raw.findings) { const item = allowed.get(finding.itemId); if (item && !assessments.has(item.id)) assessments.set(item.id, { ...finding, grounded: !!matchResearchQuote(item.content, finding.evidence) }); }
}
const results = cases.map(item => { const assessment = assessments.get(item.id); return { id: item.id, label: item.label, family_id: item.family_id, split: item.split, title: item.title, screened: selected.has(item.id), score: assessment?.score ?? null, grounded: assessment?.grounded ?? false, qualified: !!(assessment?.grounded && assessment.score >= threshold), useful: !!(assessment?.grounded && assessment.score >= 70), assessment: assessment ?? null }; });
function metrics(rows: typeof results) { const positive = rows.filter(row => row.label === 'positive'), negative = rows.filter(row => row.label === 'negative'); const tp = positive.filter(row => row.qualified).length, fp = negative.filter(row => row.qualified).length; return { cases: rows.length, positive: positive.length, negative: negative.length, selected: rows.filter(row => row.screened).length, qualified: tp + fp, true_positive: tp, false_positive: fp, false_negative: positive.length - tp, screening_recall: positive.length ? positive.filter(row => row.screened).length / positive.length : null, qualification_recall: positive.length ? tp / positive.length : null, precision: tp + fp ? tp / (tp + fp) : null, false_positive_rate: negative.length ? fp / negative.length : null, grounding_failures: rows.filter(row => row.score !== null && !row.grounded).length }; }
const report = { evaluated_at: new Date().toISOString(), variant, prompt_version: version, qualification_threshold: threshold, model: RESEARCH_MODEL, split, measurement: 'Classifier recall conditional on supplied readable source text. Collection availability and date-window eligibility are separate audits. Labels and engagement are excluded from model inputs.', benchmark_sha256: await researchHash(await Bun.file(benchmarkPath).text()), context_sha256: await researchHash(context.icp), metrics: metrics(results), results, calls };
await Bun.write(join(output, 'evaluation.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ variant, version, threshold, split, metrics: report.metrics, report: join(output, 'evaluation.json') }));
