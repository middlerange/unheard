import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from './schema';
import { researchReplayAction, researchReplayStatus, researchReplayRequestSchema, researchReplayItemSchema, researchReplayEligibility, researchReplayRoute, readResearchReplayRequest, researchReplaySignalKind } from './research-replay';
import { processResearchJob, createResearchRun, cachedResearchSourcePackets } from './research';
import { createSyncResearchSqlite } from './research-test-sqlite';
import { researchHash } from './research-model';
import { RESEARCH_SOURCE_SEEDS } from './research-sources';
import { RESEARCH_SOURCE_FORM_FORMAT, RESEARCH_SOURCE_FORM_VERSION } from './research-source-form';
import { researchSourceArtifactRoutingContract } from './research-source-artifact';
import { RESEARCH_SOURCE_ARTIFACT_VERSION } from './research-source-artifact';
const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('./db/client', () => ({ getDb: async () => state.db }));
const body = 'A practitioner describes checking each user entry route before adding an onboarding requirement. '.repeat(8);
const item = (id: string) => ({ id, sourceId: 'linear-product-craft', url: `https://linear.app/now/${id}`, title: 'An observed workflow', excerpt: body.slice(0, 300), publishedAt: 1500, discoveredAt: 2200,
  content: body, contentProvenance: 'public_feed', contentType: 'article' as const, transcriptStatus: 'not_applicable' as const });
const prepare = (runId: string, count = 1) => ({ operation: 'prepare', runId, audienceRunId: 'saved-audience', windowStart: 1000, windowEnd: 2000, inventorySha256: 'a'.repeat(64), inventoryCount: count, sourceIds: ['linear-product-craft'] });
async function rankPending(runId: string) { const result = await processResearchJob({ operation: 'rank', runId }); return 'pending' in result && result.pending; }
function rejectedSourceReview(payload: any) {
  return { findings: Object.fromEntries(payload.items.map((source: any) => {
    const frame = {
      claimBasis: 'no_useful_core',
      profileChecks: payload.publishingProfiles.map((profile: any) => ({ profileId: profile.id, fits: false, relevance: 0, reason: 'No additional supported core beyond the existing fixture finding.' })),
      claim: { summary: 'No additional supported core beyond the existing fixture finding.', evidencePassageIds: [], contentAngle: '', whyItMatters: '', limitations: 'The source supports the cached base finding only.' },
      familyKey: '', qualityComponents: { sourceSupport: 'unsupported', usefulDecision: 'none', scopeHonesty: 'accurately_bounded' }, additionalIdeas: [],
    };
    return [source.id, source.depth || source.groups ? { wholeSource: frame, groups: Object.fromEntries(Object.keys(source.groups).map(id => [id, frame])) } : frame];
  })) };
}
function modelResponse(value: unknown, id: string) {
  return Response.json({ id, model: 'claude-haiku-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(value) }], usage: { input_tokens: 10, output_tokens: 10 } });
}
const runIds = ['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444'];
it('rejects labels, expected outcomes, private URLs and unsupported inventory sizes before preparation', () => {
  expect(researchReplayRequestSchema.safeParse({ ...prepare(runIds[0]), expectedGrade: 90 }).success).toBe(false);
  expect(researchReplayRequestSchema.safeParse({ ...prepare(runIds[0]), artifactSourceIds: [] }).success).toBe(false);
  for (const artifactSourceFormats of [{}, { missing: 'research_intake_form' }, { routed: 'unknown' }, { routed: 'inspectable_public_artifact' }, { '': 'research_intake_form' }])
    expect(researchReplayRequestSchema.safeParse({ ...prepare(runIds[0]), artifactSourceIds: ['routed'], artifactSourceFormats }).success).toBe(false);
  expect(researchReplayRequestSchema.safeParse({ ...prepare(runIds[0]), artifactSourceFormats: { routed: 'research_intake_form' } }).success).toBe(false);
  expect(researchReplayRequestSchema.parse({ ...prepare(runIds[0]), artifactSourceIds: ['routed', 'default'], artifactSourceFormats: { routed: 'research_intake_form' } })).toHaveProperty('artifactSourceFormats.routed', 'research_intake_form');
  expect(researchReplayRequestSchema.safeParse({ ...prepare(runIds[0]), sourcePacketReviewVersion: 'coherent-synthesis-v2' }).success).toBe(false);
  expect(researchReplayRequestSchema.safeParse({ ...prepare(runIds[0]), sourcePacketReviewVersion: 'unknown' }).success).toBe(false);
  expect(researchReplayRequestSchema.safeParse({ ...prepare(runIds[0]), sourcePacketReviewVersion: 'mechanism-completeness-v6' }).success).toBe(false);
  expect(researchReplayRequestSchema.safeParse({ ...prepare(runIds[0]), sourcePacketReviewVersion: 'decision-completeness-v7' }).success).toBe(false);
  expect(researchReplayRequestSchema.safeParse({ ...prepare(runIds[0]), sourcePacketReviewVersion: 'reader-decision-synthesis-v3' }).success).toBe(false);
  expect(researchReplayRequestSchema.safeParse({ ...prepare(runIds[0]), artifactSourceIds: ['same', 'same'] }).success).toBe(false);
  expect(researchReplayItemSchema.safeParse({ ...item('x'), impressions: 12000 }).success).toBe(false);
  expect(researchReplayItemSchema.safeParse({ ...item('x'), url: 'https://127.0.0.1/private' }).success).toBe(false);
  expect(researchReplayRequestSchema.safeParse({ ...prepare(runIds[0]), inventoryCount: Number.MAX_SAFE_INTEGER }).success).toBe(false);
  for (const depthModel of ['gpt-6-sol', 'claude-sonnet-5-5'])
    expect(researchReplayRequestSchema.parse({ ...prepare(runIds[0]), depthModel })).toMatchObject({ depthModel });
  for (const depthModel of ['claude-haiku-5-5', 'claude-sonnet-5-5-latest', 'gpt-6-sol-latest', 'gpt-6-astra', null])
    expect(researchReplayRequestSchema.safeParse({ ...prepare(runIds[0]), depthModel }).success).toBe(false);
});
it('preserves complete captured source bodies beyond14k and rejects bodies beyond64k', () => {
  const content = 'A complete public transcript section retains its original text. '.repeat(400);
  expect(content.length).toBeGreaterThan(14_000);
  const captured = { ...item('complete-transcript-section'), content };
  expect(researchReplayItemSchema.parse(captured).content).toBe(content);
  expect(researchReplayItemSchema.safeParse({ ...captured, content: 'x'.repeat(64_001) }).success).toBe(false);
  expect(researchReplayItemSchema.safeParse({ ...captured, excerpt: 'x'.repeat(14_001) }).success).toBe(false);
});
it('cancels an oversized request stream without buffering its remainder', async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(1_800_001)); }, cancel() { cancelled = true; } });
  const request = new Request('https://app.test/api/research/replays', { method: 'POST', body: stream, duplex: 'half' } as RequestInit);
  await expect(readResearchReplayRequest(request)).rejects.toThrow('too large');
  expect(cancelled).toBe(true);
});
it('keeps strict original dates, end-exclusive window and current readable-body routing', () => {
  const config = prepare(runIds[0]);
  expect(researchReplayEligibility({ ...item('start'), publishedAt: 1000 }, config)).toBeNull();
  expect(researchReplayEligibility({ ...item('end'), publishedAt: 2000 }, config)).toBe('outside_frozen_window');
  expect(researchReplayEligibility({ ...item('old'), publishedAt: 999, discoveredAt: 1500 }, config)).toBe('outside_frozen_window');
  expect(researchReplayEligibility({ ...item('undated'), publishedAt: null }, config)).toBe('undated');
  expect(researchReplayRoute(item('full'))).toBe('direct_evidence');
  expect(researchReplayRoute({ ...item('short'), content: 'A short description.' })).toBe('metadata_screen');
});

it('separates undated watch observations and historical references from fresh publication dates',()=>{
  const observed={...item('watch'),publishedAt:null,discoveredAt:1500};
  const config={...prepare(runIds[0]),articleWatchUrls:[observed.url],observationWindowStart:1000,observationWindowEnd:2000};
  expect(researchReplayEligibility(observed,config)).toBeNull();
  expect(researchReplayEligibility({...observed,url:'https://linear.app/now/not-watched'},config)).toBe('undated');
  expect(researchReplayEligibility({...observed,discoveredAt:2000},config)).toBe('undated');
  expect(researchReplayEligibility({...observed,discoveredAt:999},config)).toBe('undated');
  expect(researchReplayEligibility(observed,prepare(runIds[0]))).toBe('undated');
  expect(researchReplaySignalKind(observed,{windowStart:0,freshnessWindowStart:1200})).toBe('undated_reference');
  expect(researchReplaySignalKind({...item('old'),publishedAt:1100},{windowStart:0,freshnessWindowStart:1200})).toBe('evergreen_newly_discovered');
  expect(researchReplaySignalKind({...item('new'),publishedAt:1200},{windowStart:0,freshnessWindowStart:1200})).toBe('fresh');
  expect(()=>researchReplayRequestSchema.parse({...prepare(runIds[0]),observationWindowStart:1000})).toThrow('Observation windows');
});

describe('configured replay persistence and paid cache boundary', () => {
  const folder = mkdtempSync(join(tmpdir(), 'research-replay-')), path = join(folder, 'db.sqlite');
  const sqlite = createSyncResearchSqlite(path), execute = sqlite.execute;
  let fault: ((queries: Array<{sql:string;params:unknown[]}>, phase:string) => void) | undefined;
  function query(sql:string,params:unknown[]=[]) { return execute({queries:[{sql,params}]})[0].results; }
  function storage(queries:Array<{sql:string;params:unknown[]}>) {
    for (const query of queries) if (/\blike\b/i.test(query.sql) && query.params.some(value => typeof value === 'string' && value.length > 50)) throw Error('LIKE or GLOB pattern too complex: SQLITE_ERROR');
    fault?.(queries,'before');const out=execute({queries});
    if (out.some((result:any) => Buffer.byteLength(JSON.stringify(result.results)) > 1_000_000)) throw Error('D1 simulated aggregate query result limit exceeded');
    fault?.(queries,'after');return out;
  }
  class Statement { constructor(public sql:string,public params:unknown[]=[]){ } bind(...params:unknown[]){return new Statement(this.sql,params);}async all(){return storage([this])[0];}async raw(){return(await this.all()).results.map((r:object)=>Object.values(r));}async run(){return this.all();}}
  let paidCalls = 0, reviewCalls = 0;
  const requests: any[] = [];
  beforeAll(() => {
    execute({script:readdirSync('drizzle-d1').filter(f=>f.endsWith('.sql')).sort().map(f=>readFileSync(join('drizzle-d1',f),'utf8')).join('\n')});
    state.db = drizzle({prepare:(sql:string)=>new Statement(sql),batch:async(q:Statement[])=>storage(q)} as never,{schema});
    query("INSERT INTO teams(id,name,slug,created_at,updated_at) VALUES('team','Team','team',0,0)");
    query("INSERT INTO research_runs(id,team_id,mode,status,days,created_at,icp) VALUES('saved-audience','team','scan','completed',1,10,?)",['General product decision audience.\n\nPublishing profiles: '+JSON.stringify([{id:'personal',name:'Personal',platform:'linkedin',systemPrompt:'Distribution, product building, growth, product delivery and research.',groupName:'Personal'},{id:'company',name:'Company',platform:'linkedin',systemPrompt:'Product adoption and onboarding.',groupName:'Company'}])]);
    query("INSERT INTO research_sources(id,team_id,seed_id,enabled) VALUES('source','team','linear-product-craft',0)");
    process.env.ANTHROPIC_API_KEY='mock-replay-key';
    globalThis.__contentHubResearchWorkflow__={create:vi.fn(async()=>({id:'mock'}))};
    vi.stubGlobal('fetch',vi.fn(async (_url:string,init:RequestInit)=>{
      const request=JSON.parse(String(init.body)),payload=JSON.parse(request.messages[0].content);
      if(Array.isArray(payload.items?.[0]?.passages)){reviewCalls++;return modelResponse(rejectedSourceReview(payload),'review-'+reviewCalls);}
      paidCalls++;requests.push(payload);
      const findings=Object.fromEntries(payload.items.map((row:any)=>[row.id,{chosenProfileId:row.id.endsWith('reject')?null:'personal',profileFit:row.id.endsWith('reject')?'No supported audience decision.':'Personal product delivery remit includes this action.',summary:'A bounded method for inspecting onboarding.',evidence:row.id.endsWith('reject')?'':body.slice(0,100),contentAngle:row.id.endsWith('reject')?'':'Check the route before changing the requirement.',whyItMatters:'A concrete practitioner decision.',limitations:'One account; no measured improvement.',familyKey:row.id.endsWith('reject')?'':'route-check',score:row.id.endsWith('reject')?0:80}]));
      const value=request.system.startsWith('Screen for potential editorial usefulness')?{assessments:Object.fromEntries(payload.items.map((row:any)=>[row.id,{reason:'A concrete method warrants evidence inspection.',selected:true}]))}:{findings};
      return Response.json({id:'msg_'+paidCalls,model:'claude-haiku-5-5',stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify(value)}],usage:{input_tokens:100,output_tokens:100}});
    }));
  });
  afterAll(()=>{fault=undefined;vi.unstubAllGlobals();globalThis.__contentHubResearchWorkflow__=undefined;sqlite.close();rmSync(folder,{recursive:true,force:true});});
  it.each(['gpt-6-sol','claude-sonnet-5-5'] as const)('freezes the optional depth-only model pin %s and preserves completed old replay status reads', async depthModel => {
    const defaultId=depthModel==='gpt-6-sol'?'90909090-9090-4090-8090-909090909090':'96969696-9696-4696-8696-969696969696';
    const overrideId=depthModel==='gpt-6-sol'?'91919191-9191-4191-8191-919191919191':'97979797-9797-4797-8797-979797979797';
    const ordinary=await researchReplayAction('team',prepare(defaultId));
    expect(ordinary).not.toHaveProperty('depthModel');
    const request={...prepare(overrideId),depthModel};
    const opted=await researchReplayAction('team',request);
    expect(opted).toMatchObject({model:'claude-haiku-5-5',depthModel});
    expect(await researchReplayAction('team',request)).toEqual(opted);
    await expect(researchReplayAction('team',prepare(overrideId))).rejects.toThrow('differs');
    await expect(researchReplayAction('team',{...prepare(defaultId),depthModel})).rejects.toThrow('differs');
    await expect(researchReplayAction('team',{...prepare(overrideId),depthModel:depthModel==='gpt-6-sol'?'claude-sonnet-5-5':'gpt-6-sol'})).rejects.toThrow('differs');
    const configId=`research-replay:${overrideId}:config`;
    const saved=JSON.parse(query('SELECT value FROM research_cache WHERE id=?',[configId])[0].value);
    const defaultConfig=JSON.parse(query('SELECT value FROM research_cache WHERE id=?',[`research-replay:${defaultId}:config`])[0].value);
    expect(saved.model).toBe(defaultConfig.model);expect(saved.contractHash).not.toBe(defaultConfig.contractHash);
    for(const changedModel of ['gpt-6-astra',undefined,depthModel==='gpt-6-sol'?'claude-sonnet-5-5':'gpt-6-sol']){
      query('UPDATE research_cache SET value=? WHERE id=?',[JSON.stringify({...saved,depthModel:changedModel}),configId]);
      await expect(researchReplayAction('team',{operation:'upload',runId:overrideId,chunkIndex:0,items:[item('pin-tamper')]})).rejects.toThrow('contract changed');
    }
    query('UPDATE research_cache SET value=? WHERE id=?',[JSON.stringify({...saved,contractHash:'prior-completed-contract'}),configId]);
    query("UPDATE research_runs SET status='completed' WHERE id=?",[overrideId]);
    const historical=await researchReplayStatus('team',overrideId);
    expect(historical.run.status).toBe('completed');
    expect(historical.records.find(row=>row.id===configId)?.value.contractHash).toBe('prior-completed-contract');
  });
  it.each(['gpt-6-sol','claude-sonnet-5-5'] as const)('uses the replay depth canary model %s only for depth and reuses both provider caches', async depthModel => {
    const id=depthModel==='gpt-6-sol'?'92929292-9292-4292-8292-929292929292':'94949494-9494-4494-8494-949494949494';
    const later=depthModel==='gpt-6-sol'?'93939393-9393-4393-8393-939393939393':'95959595-9595-4595-8595-959595959595';
    const source=item('mixed-provider-depth-canary-'+depthModel);
    const requests:Array<{model:string;catalog:boolean;depth:boolean}>=[];
    const previousKey=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='mock-depth-canary-key';
    const fetcher=vi.spyOn(globalThis,'fetch').mockImplementation(async(url,init)=>{
      const request=JSON.parse(String(init?.body));
      const openai=String(url)==='https://api.openai.com/v1/responses';
      const payload=JSON.parse(openai?request.input:request.messages[0].content),input=payload.items[0];
      const catalog=Array.isArray(input.passages),depth=Boolean(input.depth||input.groups);
      requests.push({model:request.model,catalog,depth});
      expect(openai).toBe(depth&&depthModel==='gpt-6-sol');expect(request.model).toBe(depth?depthModel:'claude-haiku-5-5');
      if(openai){expect(request.reasoning).toEqual({effort:'none'});expect(request.text.format).toMatchObject({type:'json_schema',strict:true});}
      if(depth&&depthModel==='claude-sonnet-5-5'){
        expect(input.reviewTransport).toBe('anthropic-tool-v1');
        expect(request.tool_choice).toEqual({type:'auto',disable_parallel_tool_use:true});
        expect(request.thinking).toEqual({type:'between_tools'});
        expect(request.tools[0].name).toBe('submit_research');expect(request.tools[0].input_schema).toHaveProperty('properties.findings');
        expect(request).not.toHaveProperty('output_config');
      }else if(!openai){expect(request).toHaveProperty('output_config');expect(request).not.toHaveProperty('tools');}
      const value=catalog?rejectedSourceReview(payload):{findings:{[input.id]:{
        claimBasis:'described_method',profileChecks:payload.publishingProfiles.map((profile:any)=>({profileId:profile.id,fits:profile.id==='personal',relevance:profile.id==='personal'?25:0,reason:'An inspectable product-entry workflow.'})),
        claim:{summary:'A practitioner checks user entry routes before choosing an onboarding requirement.',evidence:body.slice(0,100),contentAngle:'Inspect the route before adding the requirement.',whyItMatters:'Different routes can need different setup steps.',limitations:'A described workflow without measured outcomes.'},
        familyKey:'mixed-provider-route-check',qualityComponents:{sourceSupport:'supported_bounded_claim',usefulDecision:'concrete_decision',scopeHonesty:'accurately_bounded'},additionalIdeas:[],sectionChecks:[],
      }}};
      if(depth&&depthModel==='claude-sonnet-5-5')return Response.json({id:'sonnet-depth-canary',model:depthModel,stop_reason:'tool_use',content:[{type:'tool_use',name:'submit_research',input:value}],usage:{input_tokens:10,output_tokens:10}});
      return openai?Response.json({id:'sol-depth-canary',model:'gpt-6-sol',status:'completed',output:[{type:'message',phase:'final_answer',content:[{type:'output_text',text:JSON.stringify(value)}]}],usage:{input_tokens:10,output_tokens:10}}):modelResponse(value,'haiku-canary-'+requests.length);
    });
    try{
      const run=async(runId:string)=>{
        await researchReplayAction('team',{...prepare(runId),depthModel});
        await researchReplayAction('team',{operation:'upload',runId,chunkIndex:0,items:[source]});
        await researchReplayAction('team',{operation:'start',runId});
        let steps=0;while(await rankPending(runId))if(++steps>20)throw Error('Mixed-provider replay did not finish');
        return researchReplayStatus('team',runId);
      };
      const first=await run(id);
      expect(first.run.status).toBe('completed');expect(first.run.findings_count).toBe(1);
      expect(requests).toEqual([{model:'claude-haiku-5-5',catalog:false,depth:false},{model:'claude-haiku-5-5',catalog:true,depth:false},{model:'claude-haiku-5-5',catalog:true,depth:false},{model:depthModel,catalog:true,depth:true}]);
      const replay=await run(later);expect(replay.run.status).toBe('completed');expect(replay.run.findings_count).toBe(1);expect(requests).toHaveLength(4);
      expect(query('SELECT COUNT(*) n FROM research_usage WHERE run_id=?',[later])[0].n).toBe(0);
      expect(query('SELECT model,COUNT(*) n FROM research_usage WHERE run_id=? GROUP BY model ORDER BY model',[id])).toEqual([{model:'claude-haiku-5-5',n:3},{model:depthModel,n:1}]);
    }finally{fetcher.mockRestore();if(previousKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=previousKey;}
  },60000);
  it('keeps real SQLite errors, foreign keys and batch rollback across persistent requests', () => {
    execute({ script: 'CREATE TABLE fixture_parent(id INTEGER PRIMARY KEY); CREATE TABLE fixture_child(id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES fixture_parent(id));' });
    expect(() => execute({ queries: [{ sql: 'INSERT INTO fixture_parent VALUES(1)' }, { sql: 'INSERT INTO fixture_child VALUES(1,99)' }] })).toThrow('FOREIGN KEY constraint failed');
    expect(query('SELECT * FROM fixture_parent')).toEqual([]);
    expect(() => query('SELECT missing_column FROM fixture_parent')).toThrow('no such column');
    query('INSERT INTO fixture_parent VALUES(2)');
    query('INSERT INTO fixture_child VALUES(2,2)');
    expect(query('SELECT * FROM fixture_child')).toEqual([{ id: 2, parent_id: 2 }]);
  });
  it('continues replay after a verified terminal quote failure and reuses failed and valid source caches', async () => {
    const id='66666666-6666-4666-8666-666666666666',later='77777777-7777-4777-8777-777777777777';
    const inputs=[item('grounding-failed'),item('grounding-valid')];
    let grades=0,repairs=0,reviews=0;
    const fetcher=vi.spyOn(globalThis,'fetch').mockImplementation(async(_url,init)=>{
      const request=JSON.parse(String(init?.body)),payload=JSON.parse(request.messages[0].content);
      if(Array.isArray(payload.items?.[0]?.passages)){reviews++;return modelResponse(rejectedSourceReview(payload),'quote-review-'+reviews);}
      let value:unknown;
      if(payload.claims){repairs++;value={'route-check':{passageId:0,supportsCore:false}};}
      else{
        grades++;expect(payload.items).toHaveLength(1);const source=payload.items[0];
        value={findings:{[source.id]:{claimBasis:'described_method',profileChecks:[
          {profileId:'personal',fits:true,relevance:25,reason:'A concrete product delivery decision.'},
          {profileId:'company',fits:true,relevance:20,reason:'A concrete onboarding decision.'}],
          claim:{summary:'Inspect every entry route before requiring setup.',evidence:source.id==='grounding-failed'?'A paraphrased claim that never appears in the actual source.':body.slice(0,100),
            contentAngle:'Compare actual entry routes before choosing an onboarding gate.',whyItMatters:'Alternative paths can change which setup steps are necessary.',limitations:'A described workflow without causal outcome measurement.'},
          familyKey:'route-check',qualityComponents:{sourceSupport:'supported_bounded_claim',usefulDecision:'concrete_decision',scopeHonesty:'accurately_bounded'},additionalIdeas:[],sectionChecks:[]}}};
      }
      return Response.json({id:'quote-continuation-'+grades+'-'+repairs,model:'claude-haiku-5-5',stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify(value)}],usage:{input_tokens:10,output_tokens:10}});
    });
    try{
      const run=async(runId:string)=>{
        await researchReplayAction('team',prepare(runId,2));await researchReplayAction('team',{operation:'upload',runId,chunkIndex:0,items:inputs});await researchReplayAction('team',{operation:'start',runId});
        let steps=0;while(await rankPending(runId))if(++steps>12)throw Error('Replay failed to advance');
        return researchReplayStatus('team',runId);
      };
      const result=await run(id);
      expect(result.run.status).toBe('completed');expect(result.run.findings_count).toBe(1);
      const progress=result.records.find(row=>row.id.endsWith(':progress'))!.value;
      expect(progress).toMatchObject({evidenceOffset:2,evidenceCount:2,qualifiedCount:1,groundingFailureCount:1});
      const evidence=result.records.find(row=>row.id.endsWith(':evidence:0'))!.value;
      expect(evidence.ids).toEqual(['grounding-failed','grounding-valid']);
      expect(evidence.assessments.map((finding:any)=>finding.itemId)).toEqual(['grounding-valid']);
      expect(evidence.acceptedIds).toEqual(['grounding-valid']);expect(evidence.evidenceFailures).toHaveLength(1);
      expect(evidence.evidenceFailures[0].reason).toContain('unsupported_core');
      const receipt=JSON.parse(query('SELECT value FROM research_cache WHERE id=?',[evidence.evidenceFailures[0].receiptId])[0].value);
      expect(receipt.rawGrade.findings['grounding-failed'].claim.evidence).toContain('paraphrased');
      expect(grades).toBe(2);expect(repairs).toBe(1);expect(reviews).toBe(6);
      const replay=await run(later);expect(replay.run.findings_count).toBe(1);
      expect(grades).toBe(2);expect(repairs).toBe(1);expect(reviews).toBe(6);
      expect(query('SELECT COUNT(*) count FROM research_usage WHERE run_id=?',[later])[0].count).toBe(0);
    }finally{fetcher.mockRestore();}
  },60000);
  it('checkpoints excerpt coverage after cached parents and reuses the complete derived result', async () => {
    const id='88888888-8888-4888-8888-888888888888',later='99999999-9999-4999-8999-999999999999';
    const source={...item('windowed-source'),content:Array.from({length:20},(_,n)=>`Workflow case ${n}: ${body}`).join('\n\n').slice(0,14000)};
    let baseCalls=0,windowCalls=0,reviews=0;
    const fetcher=vi.spyOn(globalThis,'fetch').mockImplementation(async(_url,init)=>{
      const request=JSON.parse(String(init?.body)),payload=JSON.parse(request.messages[0].content),input=payload.items[0];
      if(Array.isArray(input.passages)){reviews++;return modelResponse(rejectedSourceReview(payload),'coverage-review-'+reviews);}
      const focus=input.windowFocus;
      if(focus)windowCalls++;else baseCalls++;
      const introLength=focus?.ranges.filter((range:any)=>range.role==='introduction').reduce((n:number,range:any)=>n+range.end-range.start,0)||0;
      const evidence=input.content.slice(introLength,introLength+110).trim();
      const value={findings:{[input.id]:{claimBasis:'described_method',profileChecks:[
        {profileId:'personal',fits:true,relevance:25,reason:'A concrete product delivery decision.'},
        {profileId:'company',fits:true,relevance:20,reason:'A concrete onboarding decision.'}],
        claim:{summary:focus?'A scoped practitioner observation.':'The unchanged whole-source parent.',evidence,
          contentAngle:'Compare actual entry routes before choosing an onboarding gate.',whyItMatters:'Alternative paths can change required setup.',limitations:'A described workflow without measured outcome claims.'},
        familyKey:focus?'route-window-'+focus.window.start:'parent-route-review',
        qualityComponents:{sourceSupport:'supported_bounded_claim',usefulDecision:'concrete_decision',scopeHonesty:'accurately_bounded'},additionalIdeas:[],sectionChecks:[]}}};
      return Response.json({id:'coverage-'+baseCalls+'-'+windowCalls,model:'claude-haiku-5-5',stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify(value)}],usage:{input_tokens:10,output_tokens:10}});
    });
    try{
      const start=async(runId:string)=>{await researchReplayAction('team',prepare(runId));await researchReplayAction('team',{operation:'upload',runId,chunkIndex:0,items:[source]});await researchReplayAction('team',{operation:'start',runId});};
      await start(id);expect(await rankPending(id)).toBe(true);expect(await rankPending(id)).toBe(true);
      expect(baseCalls).toBe(1);expect(windowCalls).toBe(2);
      const partial=await researchReplayStatus('team',id);
      expect(partial.records.find(row=>row.id.endsWith(':progress'))!.value.evidenceOffset).toBe(0);
      expect(partial.records.some(row=>row.id===`research-replay:${id}:evidence:0`)).toBe(false);
      let steps=0;while(await rankPending(id))if(++steps>10)throw Error('Coverage failed to checkpoint');
      const first=await researchReplayStatus('team',id),evidence=first.records.find(row=>row.id.endsWith(':evidence:0'))!.value;
      expect(first.run.status).toBe('completed');expect(evidence.coverageManifestIds).toHaveLength(1);
      expect(evidence.assessments[0].summary).toBe('The unchanged whole-source parent.');
      expect({baseCalls,windowCalls}).toEqual({baseCalls:1,windowCalls:5});
      expect(reviews).toBe(3);const calls={baseCalls,windowCalls,reviews};await start(later);steps=0;while(await rankPending(later))if(++steps>5)throw Error('Cached coverage failed to complete');
      expect({baseCalls,windowCalls,reviews}).toEqual(calls);
      expect(query('SELECT COUNT(*) n FROM research_usage WHERE run_id=?',[later])[0].n).toBe(0);
      expect((await researchReplayStatus('team',later)).run.findings_count).toBe(first.run.findings_count);
    }finally{fetcher.mockRestore();}
  },60000);

  it.each([false,true])('preserves a multi-passage review idea when consistency and depth add supported families: %s, then replays all stages without paid calls', async consistencyAdds => {
    const id=consistencyAdds?'cccccccc-cccc-4ccc-8ccc-cccccccccccc':'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',later=consistencyAdds?'dddddddd-dddd-4ddd-8ddd-dddddddddddd':'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',third=consistencyAdds?'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee':'ffffffff-ffff-4fff-8fff-ffffffffffff';
    const intake='A coordinator records the request and its unresolved assumptions before assigning an owner.';
    const handoff='A reviewer checks those assumptions and passes a checked decision record to the implementer.';
    const source={...item('compound-source-'+consistencyAdds),content:[intake,body.repeat(12),handoff].join('\n\n')};
    let bases=0,windows=0,reviews=0,repairs=0;
    let selectedIds:number[]=[];
    const fetcher=vi.spyOn(globalThis,'fetch').mockImplementation(async(_url,init)=>{
      const request=JSON.parse(String(init?.body)),payload=JSON.parse(request.messages[0].content),input=payload.items?.[0];
      if(payload.claims){repairs++;throw Error('Literal fixture evidence must not need repair');}
      const catalog=Array.isArray(input.passages),windowed=Boolean(input.windowFocus);
      const profileChecks=[
        {profileId:'personal',fits:catalog||!windowed,relevance:catalog||!windowed?25:0,reason:'An explicit intake and review handoff.'},
        {profileId:'company',fits:false,relevance:0,reason:'Outside this company fixture remit.'},
      ];
      if(catalog){
        reviews++;expect(input).not.toHaveProperty('content');
        if(input.depth||input.groups){
          const response=rejectedSourceReview(payload);
          expect(Object.keys(response.findings[input.id].groups)).toEqual(Object.keys(input.groups));
          if(consistencyAdds){
            const handoffId=input.passages.find((passage:any)=>passage.text===handoff).passageId;
            const group=Object.values(input.groups).find((group:any)=>group.selectablePassageIds.includes(handoffId)) as {id:string;selectablePassageIds:number[]};
            expect(group).toBeDefined();
            response.findings[input.id].groups[group.id]={
              claimBasis:'described_method',profileChecks,
              claim:{summary:'An implementer receives a decision record after review checks unresolved assumptions.',evidencePassageIds:[handoffId],contentAngle:'Check whether the implementation handoff includes the reviewed assumptions.',whyItMatters:'A checked record makes the review-to-implementation boundary inspectable.',limitations:'A described handoff without measured delivery outcomes.'},
              familyKey:'implementation-checked-record',qualityComponents:{sourceSupport:'supported_bounded_claim',usefulDecision:'concrete_decision',scopeHonesty:'accurately_bounded'},additionalIdeas:[],
            };
          }
          return modelResponse(response,'compound-depth-'+reviews);
        }
        if(reviews===2&&!consistencyAdds)return modelResponse(rejectedSourceReview(payload),'compound-consistency-rejection');
        selectedIds=input.passages.filter((passage:any)=>passage.selectable&&(passage.text===intake||passage.text===handoff)).map((passage:any)=>passage.passageId);
        expect(selectedIds).toHaveLength(2);expect(new Set(selectedIds).size).toBe(2);
        return modelResponse({findings:{[input.id]:{
          claimBasis:'described_method',profileChecks,
          claim:{summary:reviews===1?'A coordinator records assumptions before assignment, then a reviewer checks them and hands a decision record to the implementer.':'A reviewer checks unresolved assumptions before passing a checked decision record to the implementer.',evidencePassageIds:selectedIds,
            contentAngle:reviews===1?'Test whether intake ownership and the checked implementation handoff are explicit.':'Inspect the review-to-implementation handoff for a checked decision record.',whyItMatters:reviews===1?'A request can be recorded without its assumptions ever reaching the person implementing it.':'Implementation can inherit unresolved assumptions if the review handoff does not carry its checked decision.',limitations:'A described workflow, not measured delivery improvement.'},
          familyKey:reviews===1?'reviewed-intake-handoff':'checked-handoff-owner',qualityComponents:{sourceSupport:'supported_bounded_claim',usefulDecision:'concrete_decision',scopeHonesty:'accurately_bounded'},additionalIdeas:[],
        }}},'compound-review-'+reviews);
      }
      if(windowed)windows++;else bases++;
      return modelResponse({findings:{[input.id]:{
        claimBasis:windowed?'no_useful_core':'described_method',profileChecks,
        claim:{summary:windowed?'No independent supported window core.':'A coordinator records assumptions before assignment.',evidence:windowed?'':intake,
          contentAngle:windowed?'':'Inspect the intake record before assigning implementation.',whyItMatters:'Make unresolved assumptions visible.',limitations:'A documented practice without measured results.'},
        familyKey:windowed?'':'intake-record',qualityComponents:{sourceSupport:windowed?'unsupported':'supported_bounded_claim',usefulDecision:windowed?'none':'concrete_decision',scopeHonesty:'accurately_bounded'},additionalIdeas:[],sectionChecks:[],
      }}},'compound-base-'+bases+'-window-'+windows);
    });
    try{
      const run=async(runId:string)=>{
        await researchReplayAction('team',prepare(runId));await researchReplayAction('team',{operation:'upload',runId,chunkIndex:0,items:[source]});await researchReplayAction('team',{operation:'start',runId});
        let steps=0;while(await rankPending(runId))if(++steps>30)throw Error('Multi-passage replay did not finish');
        return researchReplayStatus('team',runId);
      };
      const result=await run(id),evidence=result.records.find(row=>row.id.endsWith(':evidence:0'))!.value;
      expect(result.run.status).toBe('completed');expect(result.run.findings_count).toBe(consistencyAdds?4:2);
      expect(bases).toBe(1);expect(windows).toBe(3);expect(reviews).toBe(3);expect(repairs).toBe(0);
      expect(evidence.assessments[0]).toMatchObject({familyKey:'intake-record',evidence:intake});
      expect(evidence.acceptedIdeas.map((idea:any)=>idea.familyKey)).toEqual(['intake-record','reviewed-intake-handoff',...(consistencyAdds?['checked-handoff-owner','implementation-checked-record']:[])]);
      expect(evidence.sourceReviewManifestIds).toHaveLength(3);expect(evidence.multiProofs).toHaveLength(consistencyAdds?3:1);
      const proof=evidence.multiProofs.find((proof:any)=>proof.familyKey==='reviewed-intake-handoff');
      expect(proof).toMatchObject({itemId:source.id,familyKey:'reviewed-intake-handoff',bodyHash:await researchHash(source.content),evidencePassageIds:selectedIds,reviewManifestId:evidence.sourceReviewManifestIds[0]});
      expect(proof.passages.map((passage:any)=>passage.text)).toEqual([intake,handoff]);
      for(const passage of proof.passages)expect(source.content.slice(passage.start,passage.end)).toBe(passage.text);
      expect(evidence.acceptedIdeas[1].evidence).toBe(intake);
      const manifest=JSON.parse(query('SELECT value FROM research_cache WHERE id=?',[proof.reviewManifestId])[0].value);
      expect(manifest.result.multiProofs[0].passages).toEqual(proof.passages);
      expect(manifest.parent.findings[0].familyKey).toBe('intake-record');
      expect(query('SELECT operation,COUNT(*) n FROM research_usage WHERE run_id=? GROUP BY operation ORDER BY operation',[id])).toEqual([{operation:'replay_evidence',n:1},{operation:'replay_review_evidence',n:3},{operation:'replay_window_evidence',n:windows}]);
      const calls={bases,windows,reviews,repairs},replay=await run(later);
      expect({bases,windows,reviews,repairs}).toEqual(calls);expect(replay.run.findings_count).toBe(consistencyAdds?4:2);
      expect(query('SELECT COUNT(*) n FROM research_usage WHERE run_id=?',[later])[0].n).toBe(0);
      expect(replay.records.find(row=>row.id.endsWith(':evidence:0'))!.value.multiProofs).toEqual(evidence.multiProofs);
      const checkedManifest=JSON.parse(query('SELECT value FROM research_cache WHERE id=?',[evidence.sourceReviewManifestIds[1]])[0].value);
      expect(checkedManifest.parent.findings[0].additionalIdeas.map((idea:any)=>idea.familyKey)).toEqual(['reviewed-intake-handoff']);
      expect(checkedManifest.result.findings[0].additionalIdeas.map((idea:any)=>idea.familyKey)).toEqual(['reviewed-intake-handoff',...(consistencyAdds?['checked-handoff-owner']:[])]);
      const depthManifest=JSON.parse(query('SELECT value FROM research_cache WHERE id=?',[evidence.sourceReviewManifestIds[2]])[0].value);
      expect(depthManifest.terminalState).toBe('completed');
      expect(depthManifest.review.diagnostics).toEqual([]);
      expect(depthManifest.parent.findings[0].additionalIdeas.map((idea:any)=>idea.familyKey)).toEqual(['reviewed-intake-handoff',...(consistencyAdds?['checked-handoff-owner']:[])]);
      if(consistencyAdds){
        const depthProof=evidence.multiProofs.find((proof:any)=>proof.familyKey==='implementation-checked-record');
        expect(depthProof.groupId).toBeTruthy();expect(depthProof.focalPassageIds).toContain(depthProof.evidencePassageIds[0]);
        expect(depthProof.passages.map((passage:any)=>passage.text)).toEqual([handoff]);
        const consistencyProof=evidence.multiProofs.find((proof:any)=>proof.familyKey==='checked-handoff-owner');
        expect(consistencyProof.reviewManifestId).toBe(evidence.sourceReviewManifestIds[1]);
        expect(consistencyProof.passages.map((passage:any)=>passage.text)).toEqual([intake,handoff]);
      }
      const cachedAgain=await run(third);
      expect({bases,windows,reviews,repairs}).toEqual(calls);
      expect(cachedAgain.records.find(row=>row.id.endsWith(':evidence:0'))!.value.multiProofs).toEqual(evidence.multiProofs);
      expect(query('SELECT COUNT(*) n FROM research_usage WHERE run_id=?',[third])[0].n).toBe(0);
      for(const table of ['research_items','research_findings','research_drafts','slack_jobs','research_run_sources'])expect(query(`SELECT COUNT(*) n FROM ${table}`)[0].n).toBe(0);
    }finally{fetcher.mockRestore();}
  },60000);

  it('starts a corpus over1MB through D1-safe pages and status excludes uploaded bodies in SQL', async () => {
    const id='55555555-5555-4555-8555-555555555555',items=Array.from({length:80},(_,n)=>({...item('large-'+n),content:body.repeat(20).slice(0,14000)}));
    expect(Buffer.byteLength(JSON.stringify(items))).toBeGreaterThan(1_000_000);
    await researchReplayAction('team',prepare(id,80));
    for(let n=0;n<80;n+=20)await researchReplayAction('team',{operation:'upload',runId:id,chunkIndex:n/20,items:items.slice(n,n+20)});
    await researchReplayAction('team',{operation:'start',runId:id});
    const result=await researchReplayStatus('team',id);
    expect(result.records.some(row=>row.id.includes(':upload:'))).toBe(false);
    expect(result.records.find(row=>row.id.endsWith(':plan'))?.value.eligibleIds).toHaveLength(80);
  },60000);
  it('prepares/uploads idempotently, freezes exact audience/corpus and resumes cached paid evidence after a lost checkpoint',async()=>{
    const id=runIds[0];await researchReplayAction('team',prepare(id,2));await researchReplayAction('team',prepare(id,2));
    await expect(researchReplayAction('team',{...prepare(id,2),windowEnd:2001})).rejects.toThrow('differs');
    const upload={operation:'upload',runId:id,chunkIndex:0,items:[item('accepted'),item('reject')]};await researchReplayAction('team',upload);await researchReplayAction('team',upload);
    await expect(researchReplayAction('team',{...upload,items:[{...item('accepted'),content:'changed'},item('reject')]})).rejects.toThrow('differs');
    await researchReplayAction('team',{operation:'start',runId:id});
    await expect(researchReplayAction('team',upload)).rejects.toThrow('frozen');
    await processResearchJob({operation:'plan',runId:id});await processResearchJob({operation:'rank',runId:id});
    const before=paidCalls;
    let fail=true;fault=(q,phase)=>{if(fail&&phase==='before'&&q.some(r=>r.sql.includes('insert into "research_cache"')&&r.params.includes(`research-replay:${id}:progress`))){fail=false;throw Error('Permanent checkpoint failure');}};
    await expect((async()=>{let steps=0;while(await rankPending(id))if(++steps>12)throw Error('Checkpoint did not advance');})()).rejects.toThrow('Permanent checkpoint');fault=undefined;
    expect(paidCalls).toBe(before+2);
    expect(query('SELECT operation,COUNT(*) n FROM research_usage WHERE run_id=? GROUP BY operation ORDER BY operation',[id])).toEqual([{operation:'replay_evidence',n:2},{operation:'replay_review_evidence',n:6}]);
    await processResearchJob({operation:'rank',runId:id});await processResearchJob({operation:'rank',runId:id});
    expect(paidCalls).toBe(before+2);
    const result=await researchReplayStatus('team',id);expect(result.run.status).toBe('completed');expect(result.run.findings_count).toBe(1);
    expect(query('SELECT operation,COUNT(*) n FROM research_usage WHERE run_id=? GROUP BY operation ORDER BY operation',[id])).toEqual([{operation:'replay_evidence',n:2},{operation:'replay_review_evidence',n:6}]);
    expect(requests.at(-1).publishingProfiles.map((p:any)=>p.id)).toEqual(['personal','company']);
    for(const table of ['research_items','research_findings','research_drafts','slack_jobs','research_run_sources'])expect(query(`SELECT COUNT(*) n FROM ${table}`)[0].n).toBe(0);
    expect(query("SELECT status FROM research_runs WHERE id='saved-audience'")[0].status).toBe('completed');
    await expect(researchReplayStatus('other',id)).rejects.toThrow('not found');
  },60000);
  it('allows concurrent replay and ordinary active research but preserves the normal one-active constraint',async()=>{
    const id=runIds[1];await researchReplayAction('team',prepare(id));
    query("INSERT INTO research_runs(id,team_id,mode,status,days,created_at,icp) VALUES('normal-active','team','scan','drafting',1,20,'Audience')");
    const active=await createResearchRun('team',{days:7,mode:'scan'});expect(active.run.id).toBe('normal-active');
    expect(()=>query("INSERT INTO research_runs(id,team_id,mode,status,days,created_at,icp) VALUES('second-normal','team','scan','ranking',1,20,'Audience')")).toThrow();
    await researchReplayAction('team',{operation:'upload',runId:id,chunkIndex:0,items:[item('concurrent')]});await researchReplayAction('team',{operation:'start',runId:id});
    let steps=0;while(await rankPending(id))if(++steps>6)throw Error('Concurrent replay did not finish its review checkpoints');
    expect(query("SELECT status FROM research_runs WHERE id='normal-active'")[0].status).toBe('drafting');
    expect((await researchReplayStatus('team',id)).run.status).toBe('completed');
    query("UPDATE research_runs SET status='completed' WHERE id='normal-active'");
  },60000);
  it('changes only attributed-quote depth requests and pins their adaptive output budget', async()=>{
    const baselineId='a1000000-0000-4000-8000-000000000001',quoteId='a1000000-0000-4000-8000-000000000002',faqId='a1000000-0000-4000-8000-000000000003';
    const quoteBody=body+'\n'+Array.from({length:20},(_,index)=>`“The team explicitly checks user entry route ${index} before deciding which onboarding requirement to show.” —Alex Morgan\n`).join('\n');
    const sources=[{...item('quote-focused-source'),content:quoteBody},item('quote-unfocused-source'),{...item('faq-focused-source'),content:body+'\n\nFrequently asked questions\n\nHow does the routing mode choose a destination?\n\n'+body+'\n\nCan every account inspect its routing history?\n\n'+body}];
    const originalFetch=globalThis.fetch,observed:Array<{model:string;quote:boolean;question:boolean;tokens:number;timeout?:number;lease?:number}>=[];
    vi.stubGlobal('fetch',vi.fn(async(_url:string,init:RequestInit)=>{
      const request=JSON.parse(String(init.body)),payload=JSON.parse(request.messages[0].content),source=payload.items[0];
      if(source.depth){observed.push({model:request.model,quote:source.depth.version==='research-source-depth-quotes-v2',question:source.depth.version==='research-source-depth-questions-v1',tokens:request.max_tokens,timeout:source.reviewTimeoutMs,lease:source.reviewClaimLeaseMs});
        const value=rejectedSourceReview(payload);
        return Response.json({id:'quote-depth',model:request.model,stop_reason:'tool_use',content:[{type:'tool_use',name:'submit_research',input:value}],usage:{input_tokens:10,output_tokens:10}});}
      return originalFetch(_url,init);
    }));
    try{
      for(const [runId,grouping]of[[baselineId,undefined],[quoteId,'literal-attributed-quotes-v1'],[faqId,'attributed-quotes-and-questions-v2']]as const){
        const request={...prepare(runId,sources.length),depthModel:'claude-sonnet-5-5',...(grouping?{depthGroupingVersion:grouping}:{})};
        const prepared=await researchReplayAction('team',request);
        expect('sourceReviewVersion' in prepared ? prepared.sourceReviewVersion : null).toBe(grouping==='attributed-quotes-and-questions-v2'?'research-source-review-v1+consistency-v1+depth-quotes-and-questions-v2':grouping?'research-source-review-v1+consistency-v1+depth-quotes-v2':'research-source-review-v1+consistency-v1+depth-v1');
        await researchReplayAction('team',{operation:'upload',runId,chunkIndex:0,items:sources});await researchReplayAction('team',{operation:'start',runId});
        let steps=0;while(await rankPending(runId))if(++steps>20)throw Error('Quote replay failed to finish');
      }
      expect(observed.filter(row=>!row.quote&&!row.question)).toHaveLength(3);expect(observed.filter(row=>row.quote)).toHaveLength(1);expect(observed.filter(row=>row.question)).toHaveLength(1);
      expect(query('SELECT operation,COUNT(*) n FROM research_usage WHERE run_id=? GROUP BY operation',[faqId])).toEqual([{operation:'replay_review_evidence',n:1}]);
      expect(observed.find(row=>row.quote)?.tokens).toBe(23552);
      expect(observed.find(row=>row.question)).toMatchObject({timeout:240000,lease:270000});
      expect(query('SELECT operation,COUNT(*) n FROM research_usage WHERE run_id=? GROUP BY operation',[quoteId])).toEqual([{operation:'replay_review_evidence',n:1}]);
      const saved=(await researchReplayStatus('team',quoteId)).records.find(row=>row.id.endsWith(':config'))!.value;
      query('UPDATE research_cache SET value=? WHERE id=?',[JSON.stringify({...saved,depthGroupingVersion:undefined}),`research-replay:${quoteId}:config`]);
      query("UPDATE research_runs SET status='ranking' WHERE id=?",[quoteId]);
      await expect(rankPending(quoteId)).rejects.toThrow('contract changed');
      query('UPDATE research_cache SET value=? WHERE id=?',[JSON.stringify(saved),`research-replay:${quoteId}:config`]);query("UPDATE research_runs SET status='completed' WHERE id=?",[quoteId]);
    }finally{vi.stubGlobal('fetch',originalFetch);}
  },60000);
  it('qualifies a packet after all source batches and reuses its exact proof without editorial writes',async()=>{
    const firstId='a2000000-0000-4000-8000-000000000001',secondId='a2000000-0000-4000-8000-000000000002',v2Id='a2000000-0000-4000-8000-000000000003',v2RepeatId='a2000000-0000-4000-8000-000000000004',v3Id='a2000000-0000-4000-8000-000000000005',v3RepeatId='a2000000-0000-4000-8000-000000000006',v4Id='a2000000-0000-4000-8000-000000000007',v4RepeatId='a2000000-0000-4000-8000-000000000008',v5Id='a2000000-0000-4000-8000-000000000009',v5RepeatId='a2000000-0000-4000-8000-000000000010',v6Id='a2000000-0000-4000-8000-000000000011',v6RepeatId='a2000000-0000-4000-8000-000000000012',v7Id='a2000000-0000-4000-8000-000000000013',v7RepeatId='a2000000-0000-4000-8000-000000000014';
    const sources=Array.from({length:7},(_,index)=>item('packet-source-'+index));
    const packet={id:'configured-public-workflow',primarySourceId:sources[0].id,sourceIds:[sources[0].id,sources[6].id],relationship:{type:'same_publisher',reason:'Two original documentation pages for one documented workflow.'}};
    const originalFetch=globalThis.fetch;let packetCalls=0;
    vi.stubGlobal('fetch',vi.fn(async(_url:string,init:RequestInit)=>{
      const request=JSON.parse(String(init.body)),payload=JSON.parse(request.messages[0].content),input=payload.items[0];
      if(!Array.isArray(input.sources))return originalFetch(_url,init);
      packetCalls++;const evidencePrefix=`research-replay:${firstId}:evidence:`;expect(query('SELECT value FROM research_cache WHERE substr(id,1,?)=?',[evidencePrefix.length,evidencePrefix]).length).toBeGreaterThanOrEqual(2);
      expect(request.model).toBe('claude-sonnet-5-5');
      const value={findings:{[input.id]:{primarySourceId:input.primarySourceId,evidenceCitations:input.sources.map((source:any)=>({sourceId:source.id,passageIds:[0]})),
        relationshipSupport:'documented_relationship',relationshipExplanation:'Both references document inspecting user entry routes before changing an onboarding requirement.',
        claimBasis:'described_method',profileChecks:payload.publishingProfiles.map((profile:any)=>({profileId:profile.id,fits:profile.id==='personal',relevance:profile.id==='personal'?22:0,reason:'Bounded original workflow reference.'})),
        claim:{summary:'The publisher describes checking user entry routes before changing onboarding requirements across two related references.',contentAngle:'Inspect the entry route before adding the requirement.',whyItMatters:'A specific documented product decision.',limitations:'Publisher-described method without measured outcomes.'},
        familyKey:'joined-reference',qualityComponents:{sourceSupport:'supported_bounded_claim',usefulDecision:'concrete_decision',scopeHonesty:'accurately_bounded'},additionalIdeas:[]}}};
      return Response.json({id:'packet-transport',model:request.model,stop_reason:'tool_use',content:[{type:'tool_use',name:'submit_research',input:value}],usage:{input_tokens:10,output_tokens:10}});
    }));
    try{
      for(const runId of[firstId,secondId,v2Id,v2RepeatId,v3Id,v3RepeatId,v4Id,v4RepeatId,v5Id,v5RepeatId,v6Id,v6RepeatId,v7Id,v7RepeatId]){
        const v7=runId===v7Id||runId===v7RepeatId,v6=runId===v6Id||runId===v6RepeatId,v5=runId===v5Id||runId===v5RepeatId,v4=runId===v4Id||runId===v4RepeatId,v3=runId===v3Id||runId===v3RepeatId,upgraded=runId===v2Id||runId===v2RepeatId||v3||v4||v5||v6||v7;
        const prepared=await researchReplayAction('team',{...prepare(runId,sources.length),sourcePackets:[packet],...(upgraded?{...(v5?{cacheOnly:true}:{}),sourcePacketReviewVersion:v7?'decision-completeness-v7':v6?'mechanism-completeness-v6':v5?'empty-claim-placeholders-v5':v4?'whole-reader-story-v4':v3?'reader-decision-synthesis-v3':'coherent-synthesis-v2'}:{})});
        expect(prepared).toMatchObject({sourcePacketVersion:upgraded?'research-source-packet-v2':'research-source-packet-v1'});
        await researchReplayAction('team',{operation:'upload',runId,chunkIndex:0,items:sources});await researchReplayAction('team',{operation:'start',runId});
        let steps=0;while(await rankPending(runId))if(++steps>35)throw Error('Packet replay failed to finish');
        const status=await researchReplayStatus('team',runId),joined=status.records.find(row=>row.id.endsWith(':source-packets'))!.value;
        expect(status.run.findings_count).toBe(8);expect(joined.acceptedIdeas).toHaveLength(1);expect(joined.packetProofs[0].sources.map((source:any)=>source.sourceId)).toEqual(packet.sourceIds);
        expect(joined.packetProofs[0].sources[1]).toMatchObject({url:sources[6].url,publishedAt:1500,firstSeen:2200});
        if(upgraded)expect(joined.packetProofs[0]).toMatchObject({version:'research-source-packet-v1',qualificationPolicyVersion:'research-source-packet-v2'});
      }
      expect(packetCalls).toBe(6);expect(query('SELECT COUNT(*) n FROM research_usage WHERE run_id=?',[secondId])[0].n).toBe(0);
      expect(query('SELECT operation,COUNT(*) n FROM research_usage WHERE run_id=? GROUP BY operation',[v2Id])).toEqual([{operation:'replay_packet_evidence',n:1}]);
      expect(query('SELECT COUNT(*) n FROM research_usage WHERE run_id=?',[v2RepeatId])[0].n).toBe(0);
      expect(query('SELECT operation,COUNT(*) n FROM research_usage WHERE run_id=? GROUP BY operation',[v3Id])).toEqual([{operation:'replay_packet_evidence',n:1}]);
      expect(query('SELECT COUNT(*) n FROM research_usage WHERE run_id=?',[v3RepeatId])[0].n).toBe(0);
      expect(query('SELECT operation,COUNT(*) n FROM research_usage WHERE run_id=? GROUP BY operation',[v4Id])).toEqual([{operation:'replay_packet_evidence',n:1}]);
      expect(query('SELECT COUNT(*) n FROM research_usage WHERE run_id=?',[v4RepeatId])[0].n).toBe(0);
      for(const id of [v5Id,v5RepeatId])expect(query('SELECT COUNT(*) n FROM research_usage WHERE run_id=?',[id])[0].n).toBe(0);
      expect(query('SELECT operation,COUNT(*) n FROM research_usage WHERE run_id=? GROUP BY operation',[v6Id])).toEqual([{operation:'replay_packet_evidence',n:1}]);
      expect(query('SELECT COUNT(*) n FROM research_usage WHERE run_id=?',[v6RepeatId])[0].n).toBe(0);
      expect(query('SELECT operation,COUNT(*) n FROM research_usage WHERE run_id=? GROUP BY operation',[v7Id])).toEqual([{operation:'replay_packet_evidence',n:1}]);
      expect(query('SELECT COUNT(*) n FROM research_usage WHERE run_id=?',[v7RepeatId])[0].n).toBe(0);
      const v7ConfigId=`research-replay:${v7Id}:config`,savedV7=JSON.parse(query('SELECT value FROM research_cache WHERE id=?',[v7ConfigId])[0].value);
      query('UPDATE research_cache SET value=? WHERE id=?',[JSON.stringify({...savedV7,sourcePacketReviewVersion:'mechanism-completeness-v6'}),v7ConfigId]);query("UPDATE research_runs SET status='ranking' WHERE id=?",[v7Id]);
      await expect(rankPending(v7Id)).rejects.toThrow('contract changed');query('UPDATE research_cache SET value=? WHERE id=?',[JSON.stringify(savedV7),v7ConfigId]);query("UPDATE research_runs SET status='completed' WHERE id=?",[v7Id]);
      const v6ConfigId=`research-replay:${v6Id}:config`,savedV6=JSON.parse(query('SELECT value FROM research_cache WHERE id=?',[v6ConfigId])[0].value);
      query('UPDATE research_cache SET value=? WHERE id=?',[JSON.stringify({...savedV6,sourcePacketReviewVersion:'empty-claim-placeholders-v5'}),v6ConfigId]);query("UPDATE research_runs SET status='ranking' WHERE id=?",[v6Id]);
      await expect(rankPending(v6Id)).rejects.toThrow('contract changed');query('UPDATE research_cache SET value=? WHERE id=?',[JSON.stringify(savedV6),v6ConfigId]);query("UPDATE research_runs SET status='completed' WHERE id=?",[v6Id]);
      const derived=query("SELECT value FROM research_cache WHERE id LIKE 'research-source-packet-attempt:%'").map((row:any)=>JSON.parse(row.value)).filter((value:any)=>value.normalizationOnly);expect(derived).toHaveLength(1);expect(derived[0].reusedFrom.normalizerVersion).toBe('structured-inference-v2+empty-content-angle-note-v1');
      const v4ConfigId=`research-replay:${v4Id}:config`,savedV4=JSON.parse(query('SELECT value FROM research_cache WHERE id=?',[v4ConfigId])[0].value);
      query('UPDATE research_cache SET value=? WHERE id=?',[JSON.stringify({...savedV4,sourcePacketReviewVersion:'reader-decision-synthesis-v3'}),v4ConfigId]);query("UPDATE research_runs SET status='ranking' WHERE id=?",[v4Id]);
      await expect(rankPending(v4Id)).rejects.toThrow('contract changed');query('UPDATE research_cache SET value=? WHERE id=?',[JSON.stringify(savedV4),v4ConfigId]);query("UPDATE research_runs SET status='completed' WHERE id=?",[v4Id]);
      const v3ConfigId=`research-replay:${v3Id}:config`,savedV3=JSON.parse(query('SELECT value FROM research_cache WHERE id=?',[v3ConfigId])[0].value);
      query('UPDATE research_cache SET value=? WHERE id=?',[JSON.stringify({...savedV3,sourcePacketReviewVersion:'coherent-synthesis-v2'}),v3ConfigId]);query("UPDATE research_runs SET status='ranking' WHERE id=?",[v3Id]);
      await expect(rankPending(v3Id)).rejects.toThrow('contract changed');query('UPDATE research_cache SET value=? WHERE id=?',[JSON.stringify(savedV3),v3ConfigId]);query("UPDATE research_runs SET status='completed' WHERE id=?",[v3Id]);
      const configId=`research-replay:${v2Id}:config`,saved=JSON.parse(query('SELECT value FROM research_cache WHERE id=?',[configId])[0].value);
      query('UPDATE research_cache SET value=? WHERE id=?',[JSON.stringify({...saved,sourcePacketReviewVersion:undefined}),configId]);query("UPDATE research_runs SET status='ranking' WHERE id=?",[v2Id]);
      await expect(rankPending(v2Id)).rejects.toThrow('contract changed');query('UPDATE research_cache SET value=? WHERE id=?',[JSON.stringify(saved),configId]);query("UPDATE research_runs SET status='completed' WHERE id=?",[v2Id]);
      expect(query('SELECT COUNT(*) n FROM research_findings')[0].n).toBe(0);expect(query('SELECT COUNT(*) n FROM research_drafts')[0].n).toBe(0);
    }finally{vi.stubGlobal('fetch',originalFetch);}
  },60000);
  it('finds targeted slash-URL packet watches owned by inactive archives and freezes every cited document',async()=>{
    const primarySeed={id:'test-packet-primary',name:'Primary public watch',url:'https://publisher.example/primary',kind:'web' as const,category:'practitioner' as const,enabled:true,priority:1 as const,notes:'Public reference',pageMode:'article' as const,
      referencePacket:{id:'normal-public-workflow',enabled:true,sourceIds:['test-packet-reference'],relationship:{type:'same_publisher' as const,reason:'Two original documentation references describe the same product workflow.'}}};
    const referenceSeed={...primarySeed,id:'test-packet-reference',name:'Reference public watch',url:'https://publisher.example/reference',referencePacket:undefined};
    RESEARCH_SOURCE_SEEDS.push(primarySeed,referenceSeed);
    const primaryUrl=primarySeed.url+'/',referenceUrl=referenceSeed.url+'/';
    const now=Date.now(),old=now-30*86400000,icp=query("SELECT icp FROM research_runs WHERE id='saved-audience'")[0].icp;
    query("INSERT INTO teams(id,name,slug,created_at,updated_at) VALUES('normal-packet','Normal packet','normal-packet',?,?)",[now,now]);
    query("INSERT INTO research_runs(id,team_id,mode,status,days,created_at,icp,source_count,source_ids) VALUES('normal-packet-run','normal-packet','scan','ranking',7,?,?,2,?)",[now,icp,JSON.stringify([primarySeed.id,referenceSeed.id])]);
    for(const seed of[primarySeed,referenceSeed])query("INSERT INTO research_run_sources(id,run_id,source_id,status) VALUES(?,'normal-packet-run',?,'completed')",[seed.id,seed.id]);
    query("INSERT INTO research_items(id,team_id,source_id,canonical_url,title,excerpt,published_at,collected_at,content,content_provenance) VALUES('normal-primary','normal-packet','earlier-archive',?,'Primary workflow',?,?,?,?,'public_feed')",[primaryUrl,body.slice(0,300),now-2000,now-1000,body]);
    query("INSERT INTO research_items(id,team_id,source_id,canonical_url,title,excerpt,published_at,collected_at,content,content_provenance) VALUES('normal-reference','normal-packet','earlier-reference',?,'Reference workflow',?,NULL,?,?,'public_feed')",[referenceUrl,body.slice(0,300),old,body]);
    query("INSERT INTO research_items(id,team_id,source_id,canonical_url,title,excerpt,published_at,collected_at,content,content_provenance) VALUES('normal-neighbor','normal-packet','earlier-archive',?,'Neighbor must not match',?,?,?,?,'public_feed')",[primarySeed.url+'-other',body.slice(0,300),now-2000,now-1000,body]);
    const originalFetch=globalThis.fetch,previousPacketPolicy=process.env.RESEARCH_PACKET_POLICY;delete process.env.RESEARCH_PACKET_POLICY;let packetCalls=0;
    vi.stubGlobal('fetch',vi.fn(async(_url:string,init:RequestInit)=>{
      const request=JSON.parse(String(init.body)),payload=JSON.parse(request.messages[0].content),input=payload.items[0];
      if(!Array.isArray(input.sources))return originalFetch(_url,init);
      packetCalls++;
      const value={findings:{[input.id]:{primarySourceId:input.primarySourceId,evidenceCitations:input.sources.map((source:any)=>({sourceId:source.id,passageIds:[0]})),
        relationshipSupport:'documented_relationship',relationshipExplanation:'Both references describe inspecting entry routes before changing the onboarding requirement.',claimBasis:'described_method',
        profileChecks:payload.publishingProfiles.map((profile:any)=>({profileId:profile.id,fits:profile.id==='personal',relevance:profile.id==='personal'?22:0,reason:'Specific inspectable public workflow.'})),
        claim:{summary:'The publisher describes inspecting entry routes before changing onboarding requirements across related public references.',contentAngle:'Inspect the documented handoff before adding a requirement.',whyItMatters:'A bounded product decision.',limitations:'Public reference descriptions establish no measured outcomes.'},
        familyKey:'route-check',qualityComponents:{sourceSupport:'supported_bounded_claim',usefulDecision:'concrete_decision',scopeHonesty:'accurately_bounded'},additionalIdeas:[]}}};
      return Response.json({id:'normal-packet-message',model:request.model,stop_reason:'tool_use',content:[{type:'tool_use',name:'submit_research',input:value}],usage:{input_tokens:10,output_tokens:10}});
    }));
    try{
      let steps=0;while(await rankPending('normal-packet-run'))if(++steps>15)throw Error('Normal packet rank did not finish');
      expect(packetCalls).toBe(1);
      const frozen=JSON.parse(query("SELECT value FROM research_cache WHERE id='rank-progress:normal-packet-run'")[0].value);expect(frozen.candidateIds).toEqual(['normal-primary']);
      expect(JSON.parse(query("SELECT source_ids FROM research_runs WHERE id='normal-packet-run'")[0].source_ids)).toEqual([primarySeed.id,referenceSeed.id]);
      const finding=query("SELECT * FROM research_findings WHERE team_id='normal-packet' AND family_key='packet-normal-public-workflow-route-check'")[0];expect(finding.source_id).toBe('earlier-archive');expect(finding.url).toBe(primaryUrl);expect(finding.limitations).toContain(referenceSeed.url);
      const snapshot=JSON.parse(query('SELECT value FROM research_cache WHERE id=?',[`research-finding-snapshot:normal-packet-run:${finding.id}`])[0].value);
      expect(snapshot.source_packet_proofs[0].sources[0]).toMatchObject({sourceId:'normal-primary',url:primaryUrl});expect(snapshot.source_packet_id).toBe('normal-public-workflow');expect(snapshot.source_packet_model_family).toBe('route-check');expect(query("SELECT COUNT(*) n FROM research_findings WHERE team_id='normal-packet'")[0].n).toBe(2);expect(snapshot.source_packet_proofs[0].sources).toHaveLength(2);expect(snapshot.source_packet_proofs[0].sources[1]).toMatchObject({sourceId:'normal-reference',url:referenceUrl,publishedAt:null,firstSeen:old});
      expect(query("SELECT COUNT(*) n FROM research_drafts WHERE team_id='normal-packet'")[0].n).toBe(0);
      expect(JSON.parse(query("SELECT value FROM research_cache WHERE id='research-depth-policy:normal-packet-run'")[0].value)).toEqual({});
      await rankPending('normal-packet-run');expect(packetCalls).toBe(1);
      expect(JSON.parse(query("SELECT value FROM research_cache WHERE id='research-packet-policy:normal-packet-run'")[0].value)).toEqual({});
      const packets=JSON.parse(query("SELECT value FROM research_cache WHERE id='research-reference-packets:normal-packet-run:plan'")[0].value).packets;
      process.env.RESEARCH_PACKET_POLICY='coherent-synthesis-v2';
      const originalRun=query("SELECT * FROM research_runs WHERE id='normal-packet-run'")[0];
      expect((await cachedResearchSourcePackets(originalRun,packets,{remaining:0})).qualificationPolicyVersion).toBeUndefined();expect(packetCalls).toBe(1);
      query("INSERT INTO research_runs(id,team_id,mode,status,days,created_at,icp) VALUES('normal-packet-v2-run','normal-packet','scan','ranking',7,?,?)",[now,icp]);
      const nextRun=query("SELECT * FROM research_runs WHERE id='normal-packet-v2-run'")[0];
      expect((await cachedResearchSourcePackets(nextRun,packets)).qualificationPolicyVersion).toBe('research-source-packet-v2');expect(packetCalls).toBe(2);
      const frozenV2=JSON.parse(query("SELECT value FROM research_cache WHERE id='research-packet-policy:normal-packet-v2-run'")[0].value);expect(frozenV2.reviewVersion).toBe('coherent-synthesis-v2');expect(frozenV2.contractHash).toMatch(/^[a-f0-9]{64}$/);
      process.env.RESEARCH_PACKET_POLICY='reader-decision-synthesis-v3';
      expect((await cachedResearchSourcePackets(nextRun,packets,{remaining:0})).qualificationPolicyVersion).toBe('research-source-packet-v2');expect(packetCalls).toBe(2);
      query("UPDATE research_runs SET status='completed' WHERE id='normal-packet-v2-run'");
      query("INSERT INTO research_runs(id,team_id,mode,status,days,created_at,icp) VALUES('normal-packet-v3-run','normal-packet','scan','ranking',7,?,?)",[now,icp]);
      const v3Run=query("SELECT * FROM research_runs WHERE id='normal-packet-v3-run'")[0];
      expect((await cachedResearchSourcePackets(v3Run,packets)).qualificationPolicyVersion).toBe('research-source-packet-v2');expect(packetCalls).toBe(3);
      const frozenV3=JSON.parse(query("SELECT value FROM research_cache WHERE id='research-packet-policy:normal-packet-v3-run'")[0].value);expect(frozenV3.reviewVersion).toBe('reader-decision-synthesis-v3');expect(frozenV3.contractHash).not.toBe(frozenV2.contractHash);
      query("UPDATE research_runs SET status='completed' WHERE id='normal-packet-v3-run'");
      process.env.RESEARCH_PACKET_POLICY='whole-reader-story-v4';
      query("INSERT INTO research_runs(id,team_id,mode,status,days,created_at,icp) VALUES('normal-packet-v4-run','normal-packet','scan','ranking',7,?,?)",[now,icp]);
      const v4Run=query("SELECT * FROM research_runs WHERE id='normal-packet-v4-run'")[0];
      expect((await cachedResearchSourcePackets(v4Run,packets)).qualificationPolicyVersion).toBe('research-source-packet-v2');expect(packetCalls).toBe(4);
      const frozenV4=JSON.parse(query("SELECT value FROM research_cache WHERE id='research-packet-policy:normal-packet-v4-run'")[0].value);expect(frozenV4.reviewVersion).toBe('whole-reader-story-v4');expect(frozenV4.contractHash).not.toBe(frozenV3.contractHash);
      delete process.env.RESEARCH_PACKET_POLICY;
      expect((await cachedResearchSourcePackets(v4Run,packets,{remaining:0})).qualificationPolicyVersion).toBe('research-source-packet-v2');expect(packetCalls).toBe(4);
      query("UPDATE research_runs SET status='completed' WHERE id='normal-packet-v4-run'");
      process.env.RESEARCH_PACKET_POLICY='empty-claim-placeholders-v5';
      query("INSERT INTO research_runs(id,team_id,mode,status,days,created_at,icp) VALUES('normal-packet-v5-run','normal-packet','scan','ranking',7,?,?)",[now,icp]);
      const v5Run=query("SELECT * FROM research_runs WHERE id='normal-packet-v5-run'")[0];
      expect((await cachedResearchSourcePackets(v5Run,packets,{remaining:0})).qualificationPolicyVersion).toBe('research-source-packet-v2');expect(packetCalls).toBe(4);
      expect(JSON.parse(query("SELECT value FROM research_cache WHERE id='research-packet-policy:normal-packet-v5-run'")[0].value).reviewVersion).toBe('empty-claim-placeholders-v5');
      delete process.env.RESEARCH_PACKET_POLICY;
      expect((await cachedResearchSourcePackets(v3Run,packets,{remaining:0})).qualificationPolicyVersion).toBe('research-source-packet-v2');expect(packetCalls).toBe(4);
    }finally{
      vi.stubGlobal('fetch',originalFetch);if(previousPacketPolicy===undefined)delete process.env.RESEARCH_PACKET_POLICY;else process.env.RESEARCH_PACKET_POLICY=previousPacketPolicy;RESEARCH_SOURCE_SEEDS.splice(RESEARCH_SOURCE_SEEDS.indexOf(primarySeed),2);
      for(const table of['research_findings','research_cache','research_items','research_runs','research_sources','teams'])query(`DELETE FROM ${table} WHERE ${table==='teams'?'id':'team_id'}='normal-packet'`);
    }
  },60000);
  it('routes an opt-in artifact cohort through the same final policy with four new calls and leaves other caches unchanged',async()=>{
    const baselineId='a4000000-0000-4000-8000-000000000001',artifactId='a4000000-0000-4000-8000-000000000002',repeatId='a4000000-0000-4000-8000-000000000003',invalidId='a4000000-0000-4000-8000-000000000004';
    const sources=['public-card','public-options','public-invitation','public-welcome','ordinary-reference'].map(id=>item('artifact-'+id));
    const routed=sources.slice(0,4).map(source=>source.id),originalFetch=globalThis.fetch;
    const calls:Array<{id:string;artifact:boolean;model:string}>=[];
    vi.stubGlobal('fetch',vi.fn(async(_url:string,init:RequestInit)=>{
      const request=JSON.parse(String(init.body)),payload=JSON.parse(request.messages[0].content),source=payload.items[0],artifact=source.artifact?.version===RESEARCH_SOURCE_ARTIFACT_VERSION;
      calls.push({id:source.id,artifact,model:request.model});
      if(Array.isArray(source.passages)){
        const value=rejectedSourceReview(payload);
        if(artifact){
          expect(source.artifact.format).toBe('inspectable_public_artifact');expect(source.reviewOutputTokens).toBe(16384);expect(request.model).toBe('claude-sonnet-5-5');
          if(routed.slice(0,2).includes(source.id)){
            const frame=value.findings[source.id].wholeSource;
            frame.claimBasis='described_method';frame.familyKey='observed-entry-route';
            frame.profileChecks=payload.publishingProfiles.map((profile:any)=>({profileId:profile.id,fits:profile.id==='personal',relevance:profile.id==='personal'?22:0,reason:'A bounded inspectable entry-route decision.'}));
            frame.claim={summary:'The publisher describes checking user entry routes before adding an onboarding requirement.',evidencePassageIds:[0],contentAngle:'Proposed inspection: compare the entry routes before changing a requirement.',whyItMatters:'The captured workflow supports a bounded product inspection.',limitations:'Publisher-described behavior; no measured outcome is supplied.'};
            frame.qualityComponents={sourceSupport:'supported_bounded_claim',usefulDecision:'concrete_decision',scopeHonesty:'accurately_bounded'};
          }
          return Response.json({id:'artifact-message',model:request.model,stop_reason:'tool_use',content:[{type:'tool_use',name:'submit_research',input:value}],usage:{input_tokens:10,output_tokens:10}});
        }
        return modelResponse(value,'ordinary-review');
      }
      const frame={claimBasis:'no_useful_core',profileChecks:payload.publishingProfiles.map((profile:any)=>({profileId:profile.id,fits:false,relevance:0,reason:'No independently useful core is selected in this baseline fixture.'})),
        claim:{summary:'No selected core in this baseline fixture.',evidence:'',contentAngle:'',whyItMatters:'',limitations:'No supported useful distinction is selected.'},familyKey:'',qualityComponents:{sourceSupport:'unsupported',usefulDecision:'none',scopeHonesty:'accurately_bounded'},additionalIdeas:[]};
      return modelResponse({findings:Object.fromEntries(payload.items.map((source:any)=>[source.id,frame]))},'artifact-base');
    }));
    try{
      for(const [runId,opted]of[[baselineId,false],[artifactId,true],[repeatId,true]]as const){
        const before=calls.length,prepared=await researchReplayAction('team',{...prepare(runId,sources.length),...(opted?{artifactSourceIds:routed}:{})});
        if(opted)expect(prepared).toMatchObject({artifactReviewVersion:RESEARCH_SOURCE_ARTIFACT_VERSION,artifactSourceCount:4,sourceReviewVersion:'research-source-review-v1+consistency-v1+depth-artifact-routed-v1'});
        await researchReplayAction('team',{operation:'upload',runId,chunkIndex:0,items:sources});await researchReplayAction('team',{operation:'start',runId});
        let steps=0;while(await rankPending(runId))if(++steps>35)throw Error('Artifact replay did not finish');
        const status=await researchReplayStatus('team',runId);
        if(runId===artifactId){expect(calls.slice(before)).toHaveLength(4);expect(calls.slice(before).every(call=>call.artifact)).toBe(true);expect(new Set(calls.slice(before).map(call=>call.id))).toEqual(new Set(routed));}
        if(runId===repeatId)expect(calls.slice(before)).toEqual([]);
        expect(status.run.findings_count).toBe(opted?2:0);
        if(opted){const accepted=status.records.flatMap(row=>row.value.acceptedIdeas??[]);expect(accepted.map((idea:any)=>idea.itemId).sort()).toEqual(routed.slice(0,2).sort());expect(accepted.every((idea:any)=>idea.score===92)).toBe(true);}
      }
      const configId=`research-replay:${artifactId}:config`,saved=JSON.parse(query('SELECT value FROM research_cache WHERE id=?',[configId])[0].value);
      query('UPDATE research_cache SET value=? WHERE id=?',[JSON.stringify({...saved,artifactSourceIds:routed.slice(0,3)}),configId]);query("UPDATE research_runs SET status='ranking' WHERE id=?",[artifactId]);
      await expect(rankPending(artifactId)).rejects.toThrow('contract changed');query('UPDATE research_cache SET value=? WHERE id=?',[JSON.stringify(saved),configId]);query("UPDATE research_runs SET status='completed' WHERE id=?",[artifactId]);
      await researchReplayAction('team',{...prepare(invalidId,sources.length),artifactSourceIds:['missing-item']});await researchReplayAction('team',{operation:'upload',runId:invalidId,chunkIndex:0,items:sources});
      const before=calls.length;await expect(researchReplayAction('team',{operation:'start',runId:invalidId})).rejects.toThrow('eligible captured readable');expect(calls.length).toBe(before);
      expect(query('SELECT COUNT(*) n FROM research_findings')[0].n).toBe(0);expect(query('SELECT COUNT(*) n FROM research_drafts')[0].n).toBe(0);
    }finally{vi.stubGlobal('fetch',originalFetch);}
  },60000);
  it('freezes mixed artifact formats, reuses earlier parents and rejects route changes before inference', async () => {
    const ids = ['a4100000-0000-4000-8000-000000000001', 'a4100000-0000-4000-8000-000000000002', 'a4100000-0000-4000-8000-000000000003'];
    const sources = ['mixed-form', 'mixed-public-card', 'mixed-ordinary'].map(id => item(id)), artifactSourceIds = sources.slice(0, 2).map(source => source.id);
    const artifactSourceFormats = { [sources[0].id]: RESEARCH_SOURCE_FORM_FORMAT }, calls: Array<{ id: string; format?: string }> = [], originalFetch = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      const request = JSON.parse(String(init.body)), payload = JSON.parse(request.messages[0].content), source = payload.items[0];
      calls.push({ id: source.id, format: source.artifact?.format });
      if (!source.artifact) return originalFetch(_url, init);
      if (source.artifact.format === RESEARCH_SOURCE_FORM_FORMAT) {
        expect(source.artifact.version).toBe(RESEARCH_SOURCE_FORM_VERSION); expect(source).not.toHaveProperty('groups'); expect(source).not.toHaveProperty('depth');
        expect(request.tools[0].input_schema.$defs.sourceAssessment.properties).not.toHaveProperty('wholeSource');
      } else expect(source).toHaveProperty('depth');
      return Response.json({ id: 'mixed-format-message', model: request.model, stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'submit_research', input: rejectedSourceReview(payload) }], usage: { input_tokens: 10, output_tokens: 10 } });
    }));
    try {
      for (const [index, runId] of ids.entries()) {
        const before = calls.length, pin = index ? { artifactSourceIds, artifactSourceFormats } : {};
        const prepared = await researchReplayAction('team', { ...prepare(runId, sources.length), ...pin });
        if (index) expect(prepared).toMatchObject({ artifactReviewVersion: RESEARCH_SOURCE_ARTIFACT_VERSION, artifactSourceFormats });
        else expect(prepared).not.toHaveProperty('artifactSourceFormats');
        await researchReplayAction('team', { operation: 'upload', runId, chunkIndex: 0, items: sources }); await researchReplayAction('team', { operation: 'start', runId });
        let steps = 0; while (await rankPending(runId)) if (++steps > 25) throw Error('Mixed-format replay did not finish');
        if (index === 1) expect(calls.slice(before)).toEqual([{ id: sources[0].id, format: RESEARCH_SOURCE_FORM_FORMAT }, { id: sources[1].id, format: 'inspectable_public_artifact' }]);
        if (index === 2) expect(calls.slice(before)).toEqual([]);
        const configId = `research-replay:${runId}:config`, frozen = JSON.parse(query('SELECT value FROM research_cache WHERE id=?', [configId])[0].value);
        if (index === 0) {
          const coldRunId = 'a4100000-0000-4000-8000-000000000004', beforeCold = calls.length;
          const beforeClaims = query("SELECT COUNT(*) n FROM research_cache WHERE id LIKE 'research-source-review-attempt:%'")[0].n;
          await researchReplayAction('team', { ...prepare(coldRunId, sources.length), cacheOnly: true, artifactSourceIds, artifactSourceFormats });
          await researchReplayAction('team', { operation: 'upload', runId: coldRunId, chunkIndex: 0, items: sources });
          await researchReplayAction('team', { operation: 'start', runId: coldRunId });
          let coldSteps = 0; while (await rankPending(coldRunId)) if (++coldSteps > 8) throw Error('Warm-parent form cache-only route did not terminate');
          expect((await researchReplayStatus('team', coldRunId)).run.error).toContain('cached-only-miss');
          expect(calls).toHaveLength(beforeCold);
          expect(query("SELECT COUNT(*) n FROM research_cache WHERE id LIKE 'research-source-review-attempt:%'")[0].n).toBe(beforeClaims);
          expect(query('SELECT COUNT(*) n FROM research_usage WHERE run_id=?', [coldRunId])[0].n).toBe(0);
        }
        if (index === 1) {
          for (const changed of [undefined, { missing: RESEARCH_SOURCE_FORM_FORMAT }, { [sources[0].id]: 'unknown' }, { [sources[1].id]: RESEARCH_SOURCE_FORM_FORMAT }]) {
            query('UPDATE research_cache SET value=? WHERE id=?', [JSON.stringify({ ...frozen, artifactSourceFormats: changed }), configId]);
            const beforeInvalid = calls.length;
            await expect(researchReplayAction('team', { operation: 'start', runId })).rejects.toThrow('contract changed'); expect(calls).toHaveLength(beforeInvalid);
          }
          query('UPDATE research_cache SET value=? WHERE id=?', [JSON.stringify(frozen), configId]);
        }
      }
    } finally { vi.stubGlobal('fetch', originalFetch); }
  }, 60000);
  it('rejects an unuploaded form override and fails a cold cached-only form route without an inference claim', async () => {
    const missingId = 'a4200000-0000-4000-8000-000000000001', coldId = 'a4200000-0000-4000-8000-000000000002', source = item('cold-form-route');
    const beforeCalls = paidCalls + reviewCalls, beforeAttempts = query("SELECT COUNT(*) n FROM research_cache WHERE id LIKE 'research-%-attempt:%'")[0].n;
    await researchReplayAction('team', { ...prepare(missingId), artifactSourceIds: ['not-uploaded'], artifactSourceFormats: { 'not-uploaded': RESEARCH_SOURCE_FORM_FORMAT } });
    await researchReplayAction('team', { operation: 'upload', runId: missingId, chunkIndex: 0, items: [source] });
    await expect(researchReplayAction('team', { operation: 'start', runId: missingId })).rejects.toThrow('eligible captured readable');
    await researchReplayAction('team', { ...prepare(coldId), cacheOnly: true, artifactSourceIds: [source.id], artifactSourceFormats: { [source.id]: RESEARCH_SOURCE_FORM_FORMAT } });
    await researchReplayAction('team', { operation: 'upload', runId: coldId, chunkIndex: 0, items: [source] }); await researchReplayAction('team', { operation: 'start', runId: coldId });
    let steps = 0; while (await rankPending(coldId)) if (++steps > 5) throw Error('Cold form cache-only route did not terminate');
    expect((await researchReplayStatus('team', coldId)).run.error).toContain('cached-only-miss');
    expect(paidCalls + reviewCalls).toBe(beforeCalls);
    expect(query("SELECT COUNT(*) n FROM research_cache WHERE id LIKE 'research-%-attempt:%'")[0].n).toBe(beforeAttempts);
    expect(query('SELECT COUNT(*) n FROM research_usage WHERE run_id=?', [coldId])[0].n).toBe(0);
  });
  it.each(['inspectable_public_artifact', 'research_intake_form'] as const)('freezes a trailing-slash %s watch by actual item ID without rewriting its query or archive identity',async format=>{
    const seed={id:'test-artifact-watch',name:'Public artifact',url:'https://publisher.example/artifact?view=public',kind:'web' as const,category:'practitioner' as const,enabled:true,priority:1 as const,notes:'Public artifact reference',pageMode:'article' as const,artifactReview:{enabled:true,format}};
    const storedUrl='https://publisher.example/artifact/?view=public',archiveId='saastr-practitioner-cases';
    RESEARCH_SOURCE_SEEDS.push(seed);const now=Date.now(),icp=query("SELECT icp FROM research_runs WHERE id='saved-audience'")[0].icp;
    query("INSERT INTO teams(id,name,slug,created_at,updated_at) VALUES('normal-artifact','Normal artifact','normal-artifact',?,?)",[now,now]);
    query("INSERT INTO research_runs(id,team_id,mode,status,days,created_at,icp,source_count,source_ids) VALUES('normal-artifact-run','normal-artifact','scan','ranking',7,?,?,1,?)",[now,icp,JSON.stringify([seed.id])]);
    for(const id of[seed.id])query("INSERT INTO research_run_sources(id,run_id,source_id,status) VALUES(?,'normal-artifact-run',?,'completed')",['normal-artifact-step-'+id,id]);
    query("INSERT INTO research_items(id,team_id,source_id,canonical_url,title,excerpt,published_at,collected_at,content,content_provenance) VALUES('normal-artifact-item','normal-artifact',?,?,'Inspectable artifact',?,?,?,?,'public_feed')",[archiveId,storedUrl,body.slice(0,300),now-2000,now-1000,body]);
    const originalFetch=globalThis.fetch;let artifactCalls=0;
    vi.stubGlobal('fetch',vi.fn(async(_url:string,init:RequestInit)=>{
      const request=JSON.parse(String(init.body)),payload=JSON.parse(request.messages[0].content),source=payload.items[0];
      if(!source.artifact)return originalFetch(_url,init);artifactCalls++;expect(request.model).toBe('claude-sonnet-5-5');expect(source.artifact.format).toBe(format);
      return Response.json({id:'normal-artifact-message',model:request.model,stop_reason:'tool_use',content:[{type:'tool_use',name:'submit_research',input:rejectedSourceReview(payload)}],usage:{input_tokens:10,output_tokens:10}});
    }));
    try{
      let steps=0;while(await rankPending('normal-artifact-run'))if(++steps>15)throw Error('Normal artifact routing did not finish');
      expect(artifactCalls).toBe(1);expect(JSON.parse(query("SELECT source_ids FROM research_runs WHERE id='normal-artifact-run'")[0].source_ids)).toEqual([seed.id]);
      const policy=JSON.parse(query("SELECT value FROM research_cache WHERE id='research-depth-policy:normal-artifact-run'")[0].value);
      expect(policy.artifactSourceIds).toEqual(['normal-artifact-item']);expect(policy.artifactContractHash).toMatch(/^[a-f0-9]{64}$/);expect(policy.model).toBeUndefined();
      const formats = format === 'research_intake_form' ? { 'normal-artifact-item': 'research_intake_form' as const } : undefined;
      expect(policy.artifactSourceFormats).toEqual(formats);
      expect(policy.artifactContractHash).toBe(await researchHash(JSON.stringify(researchSourceArtifactRoutingContract(16384, formats))));
      expect(query("SELECT source_id,canonical_url FROM research_items WHERE id='normal-artifact-item'")[0]).toEqual({source_id:archiveId,canonical_url:storedUrl});
      expect(query("SELECT COUNT(*) n FROM research_drafts WHERE team_id='normal-artifact'")[0].n).toBe(0);
    }finally{vi.stubGlobal('fetch',originalFetch);RESEARCH_SOURCE_SEEDS.splice(RESEARCH_SOURCE_SEEDS.indexOf(seed),1);for(const table of['research_findings','research_cache','research_items','research_runs','research_sources','teams'])query(`DELETE FROM ${table} WHERE ${table==='teams'?'id':'team_id'}='normal-artifact'`);}
  },60000);
  it('screens only incomplete bodies in packed batches and never scores short evidence',async()=>{
    const id=runIds[3],items=Array.from({length:20},(_,n)=>({...item('mixed-'+n),content:n%2?'Short partial text.':body}));
    await researchReplayAction('team',prepare(id,items.length));await researchReplayAction('team',{operation:'upload',runId:id,chunkIndex:0,items});await researchReplayAction('team',{operation:'start',runId:id});
    let steps=0;while(await rankPending(id)){if(++steps>45)throw Error('Incomplete replay');}
    const result=await researchReplayStatus('team',id);expect(result.run.collected_count).toBe(20);expect(result.run.findings_count).toBe(10);
    const operations=query('SELECT operation,COUNT(*) n FROM research_usage WHERE run_id=? GROUP BY operation',[id]);
    expect(operations.find((r:any)=>r.operation==='replay_screen')?.n).toBe(2);
    expect(operations.find((r:any)=>r.operation==='replay_evidence')?.n).toBe(10);
    const outcomes=result.records.filter(r=>r.id.includes(':evidence:')&&!r.id.includes(':request:'));
    expect(outcomes.flatMap(r=>r.value.unavailableIds)).toHaveLength(10);
    expect(outcomes.flatMap(r=>r.value.input).every((r:any)=>r.content.length>=500)).toBe(true);
  },60000);
  it.each(['screen', 'base'] as const)('terminates a cached-only %s miss without provider usage or paid attempt claims', async stage => {
    const runId = stage === 'screen' ? 'd5000000-0000-4000-8000-000000000001' : 'd5000000-0000-4000-8000-000000000002';
    const source = { ...item('cache-only-cold-' + stage), ...(stage === 'screen' ? { content: null } : {}) };
    const beforeCalls = paidCalls + reviewCalls, beforeAttempts = query("SELECT COUNT(*) n FROM research_cache WHERE id LIKE 'research-%-attempt:%'")[0].n;
    expect(await researchReplayAction('team', { ...prepare(runId), cacheOnly: true })).toMatchObject({ cacheOnly: true });
    await researchReplayAction('team', { operation: 'upload', runId, chunkIndex: 0, items: [source] });
    await researchReplayAction('team', { operation: 'start', runId });
    expect(await rankPending(runId)).toBe(true); expect(await rankPending(runId)).toBe(false);
    const status = await researchReplayStatus('team', runId);
    expect(status.run).toMatchObject({ status: 'failed', input_tokens: 0, output_tokens: 0 });
    expect(status.run.error).toContain('cached-only-miss'); expect(status.records.some(row => row.id.endsWith(':cached-only-miss'))).toBe(true);
    expect(paidCalls + reviewCalls).toBe(beforeCalls); expect(query('SELECT COUNT(*) n FROM research_usage WHERE run_id=?', [runId])[0].n).toBe(0);
    expect(query("SELECT COUNT(*) n FROM research_cache WHERE id LIKE 'research-%-attempt:%'")[0].n).toBe(beforeAttempts);
    expect(await rankPending(runId)).toBe(false);
    const configId = `research-replay:${runId}:config`, frozen = JSON.parse(query('SELECT value FROM research_cache WHERE id=?', [configId])[0].value);
    query('UPDATE research_cache SET value=? WHERE id=?', [JSON.stringify({ ...frozen, cacheOnly: undefined }), configId]);
    await expect(researchReplayAction('team', { operation: 'upload', runId, chunkIndex: 0, items: [source] })).rejects.toThrow('contract changed');
    query('UPDATE research_cache SET value=? WHERE id=?', [JSON.stringify(frozen), configId]);
  });
  it('sets shared review budgets to zero before a cached-only current-depth miss can claim inference', async () => {
    const firstId = 'd5000000-0000-4000-8000-000000000003', zeroId = 'd5000000-0000-4000-8000-000000000004', source = item('cache-only-warm-parents');
    for (const [runId, pin] of [[firstId, {}], [zeroId, { cacheOnly: true, depthModel: 'claude-sonnet-5-5' }]] as const) {
      await researchReplayAction('team', { ...prepare(runId), ...pin });
      await researchReplayAction('team', { operation: 'upload', runId, chunkIndex: 0, items: [source] }); await researchReplayAction('team', { operation: 'start', runId });
      const beforeCalls = paidCalls + reviewCalls, beforeAttempts = query("SELECT COUNT(*) n FROM research_cache WHERE id LIKE 'research-source-review-attempt:%'")[0].n;
      let steps = 0; while (await rankPending(runId)) if (++steps > 12) throw Error('Cached-only replay failed to terminate');
      if (runId === zeroId) {
        expect((await researchReplayStatus('team', runId)).run.error).toContain('cached-only-miss');
        expect(paidCalls + reviewCalls).toBe(beforeCalls);
        expect(query("SELECT COUNT(*) n FROM research_cache WHERE id LIKE 'research-source-review-attempt:%'")[0].n).toBe(beforeAttempts);
        expect(query('SELECT COUNT(*) n FROM research_usage WHERE run_id=?', [runId])[0].n).toBe(0);
      }
    }
  });
  it('routes every item beyond300 over durable batches with no total quota and records absent bodies explicitly',async()=>{
    const id=runIds[2],items=Array.from({length:305},(_,n)=>item('many-'+n));await researchReplayAction('team',prepare(id,items.length));
    for(let n=0;n<items.length;n+=20)await researchReplayAction('team',{operation:'upload',runId:id,chunkIndex:n/20,items:items.slice(n,n+20)});
    await researchReplayAction('team',{operation:'start',runId:id});let calls=0;while(await rankPending(id)){calls++;if(calls>items.length*4)throw Error('Did not complete');}
    const result=await researchReplayStatus('team',id);expect(result.run.findings_count).toBe(305);expect(result.run.collected_count).toBe(305);
    expect(query('SELECT operation,COUNT(*) n FROM research_usage WHERE run_id=? GROUP BY operation ORDER BY operation',[id])).toEqual([{operation:'replay_evidence',n:305},{operation:'replay_review_evidence',n:915}]);
    expect(query('SELECT COUNT(*) n FROM research_findings')[0].n).toBe(0);
  },300000);
});
