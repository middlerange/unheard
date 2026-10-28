import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { closeSync, mkdtempSync, openSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from './schema';
import { researchReplayAction, researchReplayStatus, researchReplayRequestSchema, researchReplayItemSchema, researchReplayEligibility, researchReplayRoute, readResearchReplayRequest, researchReplaySignalKind } from './research-replay';
import { processResearchJob, createResearchRun } from './research';
const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('./db/client', () => ({ getDb: async () => state.db }));
const body = 'A practitioner describes checking each user entry route before adding an onboarding requirement. '.repeat(8);
const item = (id: string) => ({ id, sourceId: 'linear-product-craft', url: `https://linear.app/now/${id}`, title: 'An observed workflow', excerpt: body.slice(0, 300), publishedAt: 1500, discoveredAt: 2200,
  content: body, contentProvenance: 'public_feed', contentType: 'article' as const, transcriptStatus: 'not_applicable' as const });
const prepare = (runId: string, count = 1) => ({ operation: 'prepare', runId, audienceRunId: 'saved-audience', windowStart: 1000, windowEnd: 2000, inventorySha256: 'a'.repeat(64), inventoryCount: count, sourceIds: ['linear-product-craft'] });
async function rankPending(runId: string) { const result = await processResearchJob({ operation: 'rank', runId }); return 'pending' in result && result.pending; }
const runIds = ['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444'];
it('rejects labels, expected outcomes, private URLs and unsupported inventory sizes before preparation', () => {
  expect(researchReplayRequestSchema.safeParse({ ...prepare(runIds[0]), expectedGrade: 90 }).success).toBe(false);
  expect(researchReplayItemSchema.safeParse({ ...item('x'), impressions: 12000 }).success).toBe(false);
  expect(researchReplayItemSchema.safeParse({ ...item('x'), url: 'https://127.0.0.1/private' }).success).toBe(false);
  expect(researchReplayRequestSchema.safeParse({ ...prepare(runIds[0]), inventoryCount: Number.MAX_SAFE_INTEGER }).success).toBe(false);
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
  const python = `import json,sqlite3,sys\np=json.load(sys.stdin)\nc=sqlite3.connect(p['path']);c.row_factory=sqlite3.Row;c.execute('PRAGMA foreign_keys=ON')\nif 'script' in p:\n c.executescript(p['script']);c.commit();print('[]')\nelse:\n out=[]\n for q in p['queries']:\n  cur=c.execute(q['sql'],q.get('params',[]));out.append({'results':[dict(r) for r in cur.fetchall()],'success':True,'meta':{'changes':cur.rowcount}})\n c.commit();print(json.dumps(out))`;
  let fault: ((queries: Array<{sql:string;params:unknown[]}>, phase:string) => void) | undefined;
  function execute(payload: object) {
    const inputPath = join(folder, 'query.json'); writeFileSync(inputPath, JSON.stringify({ path, ...payload })); const input = openSync(inputPath, 'r');
    try { const r = spawnSync('python3', ['-c', python], { stdio:[input,'pipe','pipe'], encoding:'utf8', timeout:30000,maxBuffer:32*1024*1024 }); if(r.status!==0)throw r.error||new Error(r.stderr);return JSON.parse(r.stdout); } finally {closeSync(input);}
  }
  function query(sql:string,params:unknown[]=[]) { return execute({queries:[{sql,params}]})[0].results; }
  function storage(queries:Array<{sql:string;params:unknown[]}>) {
    for (const query of queries) if (/\blike\b/i.test(query.sql) && query.params.some(value => typeof value === 'string' && value.length > 50)) throw Error('LIKE or GLOB pattern too complex: SQLITE_ERROR');
    fault?.(queries,'before');const out=execute({queries});
    if (out.some((result:any) => Buffer.byteLength(JSON.stringify(result.results)) > 1_000_000)) throw Error('D1 simulated aggregate query result limit exceeded');
    fault?.(queries,'after');return out;
  }
  class Statement { constructor(public sql:string,public params:unknown[]=[]){ } bind(...params:unknown[]){return new Statement(this.sql,params);}async all(){return storage([this])[0];}async raw(){return(await this.all()).results.map((r:object)=>Object.values(r));}async run(){return this.all();}}
  let paidCalls = 0;
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
      paidCalls++;const request=JSON.parse(String(init.body)),payload=JSON.parse(request.messages[0].content);requests.push(payload);
      const findings=Object.fromEntries(payload.items.map((row:any)=>[row.id,{chosenProfileId:row.id.endsWith('reject')?null:'personal',profileFit:row.id.endsWith('reject')?'No supported audience decision.':'Personal product delivery remit includes this action.',summary:'A bounded method for inspecting onboarding.',evidence:row.id.endsWith('reject')?'':body.slice(0,100),contentAngle:row.id.endsWith('reject')?'':'Check the route before changing the requirement.',whyItMatters:'A concrete practitioner decision.',limitations:'One account; no measured improvement.',familyKey:row.id.endsWith('reject')?'':'route-check',score:row.id.endsWith('reject')?0:80}]));
      const value=request.system.startsWith('Screen for potential editorial usefulness')?{assessments:Object.fromEntries(payload.items.map((row:any)=>[row.id,{reason:'A concrete method warrants evidence inspection.',selected:true}]))}:{findings};
      return Response.json({id:'msg_'+paidCalls,model:'claude-haiku-5-5',stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify(value)}],usage:{input_tokens:100,output_tokens:100}});
    }));
  });
  afterAll(()=>{fault=undefined;vi.unstubAllGlobals();globalThis.__contentHubResearchWorkflow__=undefined;rmSync(folder,{recursive:true,force:true});});
  it('continues replay after a verified terminal quote failure and reuses failed and valid source caches', async () => {
    const id='66666666-6666-4666-8666-666666666666',later='77777777-7777-4777-8777-777777777777';
    const inputs=[item('grounding-failed'),item('grounding-valid')];
    let grades=0,repairs=0;
    const fetcher=vi.spyOn(globalThis,'fetch').mockImplementation(async(_url,init)=>{
      const request=JSON.parse(String(init?.body)),payload=JSON.parse(request.messages[0].content);
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
        let steps=0;while(await rankPending(runId))if(++steps>8)throw Error('Replay failed to advance');
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
      expect(grades).toBe(2);expect(repairs).toBe(1);
      const replay=await run(later);expect(replay.run.findings_count).toBe(1);
      expect(grades).toBe(2);expect(repairs).toBe(1);
      expect(query('SELECT COUNT(*) count FROM research_usage WHERE run_id=?',[later])[0].count).toBe(0);
    }finally{fetcher.mockRestore();}
  },60000);
  it('checkpoints excerpt coverage after cached parents and reuses the complete derived result', async () => {
    const id='88888888-8888-4888-8888-888888888888',later='99999999-9999-4999-8999-999999999999';
    const source={...item('windowed-source'),content:Array.from({length:20},(_,n)=>`Workflow case ${n}: ${body}`).join('\n\n').slice(0,14000)};
    let baseCalls=0,windowCalls=0;
    const fetcher=vi.spyOn(globalThis,'fetch').mockImplementation(async(_url,init)=>{
      const request=JSON.parse(String(init?.body)),payload=JSON.parse(request.messages[0].content),input=payload.items[0];
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
      const calls={baseCalls,windowCalls};await start(later);steps=0;while(await rankPending(later))if(++steps>5)throw Error('Cached coverage failed to complete');
      expect({baseCalls,windowCalls}).toEqual(calls);
      expect(query('SELECT COUNT(*) n FROM research_usage WHERE run_id=?',[later])[0].n).toBe(0);
      expect((await researchReplayStatus('team',later)).run.findings_count).toBe(first.run.findings_count);
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
    await expect(processResearchJob({operation:'rank',runId:id})).rejects.toThrow('Permanent checkpoint');fault=undefined;
    expect(paidCalls).toBe(before+2);
    expect(query('SELECT COUNT(*) n FROM research_usage WHERE run_id=?',[id])[0].n).toBe(2);
    await processResearchJob({operation:'rank',runId:id});await processResearchJob({operation:'rank',runId:id});
    expect(paidCalls).toBe(before+2);
    const result=await researchReplayStatus('team',id);expect(result.run.status).toBe('completed');expect(result.run.findings_count).toBe(1);
    expect(query('SELECT operation FROM research_usage WHERE run_id=?',[id])).toEqual([{operation:'replay_evidence'},{operation:'replay_evidence'}]);
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
    for(let n=0;n<3;n++)await processResearchJob({operation:'rank',runId:id});
    expect(query("SELECT status FROM research_runs WHERE id='normal-active'")[0].status).toBe('drafting');
    expect((await researchReplayStatus('team',id)).run.status).toBe('completed');
    query("UPDATE research_runs SET status='completed' WHERE id='normal-active'");
  },60000);
  it('screens only incomplete bodies in packed batches and never scores short evidence',async()=>{
    const id=runIds[3],items=Array.from({length:20},(_,n)=>({...item('mixed-'+n),content:n%2?'Short partial text.':body}));
    await researchReplayAction('team',prepare(id,items.length));await researchReplayAction('team',{operation:'upload',runId:id,chunkIndex:0,items});await researchReplayAction('team',{operation:'start',runId:id});
    let steps=0;while(await rankPending(id)){if(++steps>20)throw Error('Incomplete replay');}
    const result=await researchReplayStatus('team',id);expect(result.run.collected_count).toBe(20);expect(result.run.findings_count).toBe(10);
    const operations=query('SELECT operation,COUNT(*) n FROM research_usage WHERE run_id=? GROUP BY operation',[id]);
    expect(operations.find((r:any)=>r.operation==='replay_screen')?.n).toBe(2);
    expect(operations.find((r:any)=>r.operation==='replay_evidence')?.n).toBe(10);
    const outcomes=result.records.filter(r=>r.id.includes(':evidence:')&&!r.id.includes(':request:'));
    expect(outcomes.flatMap(r=>r.value.unavailableIds)).toHaveLength(10);
    expect(outcomes.flatMap(r=>r.value.input).every((r:any)=>r.content.length>=500)).toBe(true);
  },60000);
  it('routes every item beyond300 over durable batches with no total quota and records absent bodies explicitly',async()=>{
    const id=runIds[2],items=Array.from({length:305},(_,n)=>item('many-'+n));await researchReplayAction('team',prepare(id,items.length));
    for(let n=0;n<items.length;n+=20)await researchReplayAction('team',{operation:'upload',runId:id,chunkIndex:n/20,items:items.slice(n,n+20)});
    await researchReplayAction('team',{operation:'start',runId:id});let calls=0;while(await rankPending(id)){calls++;if(calls>100)throw Error('Did not complete');}
    const result=await researchReplayStatus('team',id);expect(result.run.findings_count).toBe(305);expect(result.run.collected_count).toBe(305);
    expect(query('SELECT COUNT(*) n FROM research_usage WHERE run_id=?',[id])[0].n).toBe(305);
    expect(query('SELECT COUNT(*) n FROM research_findings')[0].n).toBe(0);
  },300000);
});
