import { describe, expect, it } from 'vitest';
import { assertRecallReplayCompatible, assertRecallModelCallAllowed, parseRecallEvidence, recallEvaluationContext, recallEvidenceRoute, recallEvidenceSchema } from './evaluate-research-recall-context';

describe('qualification evaluation paid-call guard', () => {
  it('defaults to cache-only and refuses any cache miss before requesting a key or making a call', () => {
    expect(() => assertRecallModelCallAllowed(false, 0, 0)).toThrow('Cache-only');
  });
  it('requires explicit permission and stops exactly at the declared new-call scope', () => {
    expect(() => assertRecallModelCallAllowed(true, 3, 2)).not.toThrow();
    expect(() => assertRecallModelCallAllowed(true, 3, 3)).toThrow('budget reached');
    expect(() => assertRecallModelCallAllowed(true, 0, 0)).toThrow('budget reached');
    expect(() => assertRecallModelCallAllowed(true, Infinity, 0)).toThrow('nonnegative integer');
  });
});

const profiles = [
  { id: 'company', name: 'Company', platform: 'linkedin', groupName: 'company', systemPrompt: 'Product onboarding only.' },
  { id: 'personal', name: 'Builder', platform: 'twitter', groupName: 'personal', systemPrompt: 'Growth and distribution decisions.' },
];
const captured = `Product and growth\n\nPublishing profiles: ${JSON.stringify(profiles)}`;
const assessment = { itemId: 'source', summary: 'A measured source observation.', evidence: 'A supporting source sentence.', contentAngle: 'Inspect referral measurement.', whyItMatters: 'A distribution decision.', limitations: 'Observational.', familyKey: 'search', score: 82 };

describe('recall evaluator production audience contract', () => {
  it('sends separately captured alternatives, preserving exact IDs and instructions, without legacy icp nesting', () => {
    const current = recallEvaluationContext('current', { icp: captured });
    expect(current.profileIds).toEqual(['company', 'personal']);
    expect(current.payload).toEqual({ generalAudience: 'Product and growth', publishingProfiles: profiles.map(profile => ({ ...profile, enabled: true, kind: 'publishing_profile' })) });
    expect(current.payload).not.toHaveProperty('icp');
  });
  it('keeps historical baseline payload and legacy evidence schema/validation unchanged', () => {
    expect(recallEvaluationContext('baseline', { icp: captured })).toEqual({ payload: { icp: captured }, profileIds: [] });
    expect(recallEvidenceSchema('baseline', ['source'], []).properties.findings).toMatchObject({ type: 'array', minItems: 1, maxItems: 1 });
    expect(parseRecallEvidence('baseline', { findings: [assessment] }, ['source'], []).findings).toEqual([assessment]);
  });
  it('tags genuinely plain legacy ICP as audience-only and rejects malformed captured profiles', () => {
    expect(recallEvaluationContext('current', { icp: 'Product research' }).profileIds).toEqual(['audience-only:general']);
    expect(() => recallEvaluationContext('current', { icp: 'Product research Publishing profiles: broken' })).toThrow();
    expect(() => recallEvaluationContext('current', { icp: `Product research\n\nPublishing profiles: ${JSON.stringify([profiles[0], profiles[0]])}` })).toThrow();
  });
  it('requires a real chosen-profile enum and validates it even for a cached structured response', () => {
    const schema = recallEvidenceSchema('current', ['source'], ['company', 'personal']);
    expect(schema.properties.findings).toMatchObject({ type: 'array', items: { $ref: '#/$defs/sourceAssessment' } });
    expect(schema.$defs.sourceAssessment.required).toEqual(expect.arrayContaining(['claimBasis', 'profileChecks', 'qualityComponents']));
    expect(schema.$defs.profileCheck.properties.profileId.enum).toEqual(['company', 'personal']);
    expect(() => parseRecallEvidence('current', { findings: [assessment] }, ['source'], ['company', 'personal'])).toThrow('choose a supplied');
    expect(() => parseRecallEvidence('current', { findings: [{ ...assessment, chosenProfileId: 'invented', profileFit: 'Fits distribution.' }] }, ['source'], ['personal'])).toThrow();
    expect(() => parseRecallEvidence('current', { findings: [{ ...assessment, chosenProfileId: null, profileFit: 'No fit.' }] }, ['source'], ['personal'])).toThrow();
    expect(parseRecallEvidence('current', { findings: [{ ...assessment, chosenProfileId: 'personal', profileFit: 'Personal distribution measurement remit.' }] }, ['source'], ['personal']).findings[0].chosenProfileId).toBe('personal');
    expect(parseRecallEvidence('current', { findings: [{ ...assessment, score: 40, chosenProfileId: null, profileFit: 'No audience fits.' }] }, ['source'], ['personal']).findings[0].score).toBe(40);
  });
  it('rejects missing assessment coverage rather than silently counting an unassessed case as rejected', () => {
    expect(() => parseRecallEvidence('current', { findings: [] }, ['source'], ['personal'])).toThrow('every input');
  });
});

describe('recall evaluator routing and resume identity', () => {
  const readable = { title: 'Research', sourceId: 'primary', content: 'A source-supported practitioner observation. '.repeat(16) };
  it('routes existing readable evidence directly while historical controls still screen it', () => {
    expect(recallEvidenceRoute('current', readable)).toBe('direct_evidence');
    expect(recallEvidenceRoute('baseline', readable)).toBe('metadata_screen');
    expect(recallEvidenceRoute('current', { ...readable, content: 'A short supplied excerpt.' })).toBe('metadata_screen');
  });
  it('uses the same registered Pew chrome guard instead of treating serialized widgets as evidence', () => {
    expect(recallEvidenceRoute('current', { ...readable, sourceId: 'pew-ai-original-research', content: readable.content + ' data-wp-context="{}"' })).toBe('metadata_screen');
    expect(recallEvidenceRoute('current', { ...readable, sourceId: 'pew-ai-original-research' })).toBe('direct_evidence');
  });
  it('requires a new output directory for old current runs, changed profiles, schemas or routing', () => {
    const expected = { version: 'v15', audience: { id: 'personal' }, schema: 'profile-choice', routing: 'direct-evidence' };
    expect(() => assertRecallReplayCompatible(expected, null, ['evaluation.json', 'calls'])).toThrow('new --out');
    expect(() => assertRecallReplayCompatible(expected, { ...expected, audience: { id: 'company' } }, ['replay-context.json'])).toThrow();
    expect(() => assertRecallReplayCompatible(expected, { ...expected, schema: 'legacy' }, [])).toThrow();
    expect(() => assertRecallReplayCompatible(expected, { ...expected, routing: 'screen-all' }, [])).toThrow();
    expect(() => assertRecallReplayCompatible(expected, null, [])).not.toThrow();
    expect(() => assertRecallReplayCompatible(expected, structuredClone(expected), ['replay-context.json', 'calls'])).not.toThrow();
  });
});
