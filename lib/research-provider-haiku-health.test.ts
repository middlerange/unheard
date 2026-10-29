import {afterAll,afterEach,beforeAll,beforeEach,expect,it,vi} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {drizzle} from 'drizzle-orm/d1';
import * as schema from './schema';
import {createSyncResearchSqlite} from './research-test-sqlite';
import {probeResearchHaikuGenerationHealth,RESEARCH_HAIKU_HEALTH_MODEL} from './research-provider-haiku-health';
import {researchProvidersHttp} from './research-providers';
import {anthropicResearchRequest} from './research-anthropic';
const state=vi.hoisted(()=>({db:null as unknown,team:'team-a',authorized:true}));
vi.mock('./db/client',()=>({getDb:async()=>state.db}));
vi.mock('./auth',()=>({getRequestTeamId:vi.fn(async()=>state.authorized?state.team:new Response('Unauthorized',{status:401}))}));
const folder=mkdtempSync(join(tmpdir(),'research-haiku-health-')),sqlite=createSyncResearchSqlite(join(folder,'test.sqlite'));
let failClaim=false,failTerminal=false;
const query=(sql:string,params:unknown[]=[])=>sqlite.execute({queries:[{sql,params}]})[0].results;
class Statement{constructor(public sql:string,public params:unknown[]=[]){ }bind(...params:unknown[]){return new Statement(this.sql,params);}async all(){if(failClaim&&/^insert into \"research_cache\"/i.test(this.sql)||failTerminal&&/^update \"research_cache\"/i.test(this.sql))throw Error('Fixture health storage unavailable');return sqlite.execute({queries:[this]})[0];}async raw(){return(await this.all()).results.map((row:object)=>Object.values(row));}async run(){return this.all();}}
const operationId='b1000000-0000-4000-8000-000000000001',secret='sk-ant-private-never-retain';
const response=()=>Response.json({model:RESEARCH_HAIKU_HEALTH_MODEL,stop_reason:'end_turn',content:[{type:'text',text:'{\"ok\":true}'}],usage:{input_tokens:100,output_tokens:10}});
beforeAll(()=>{sqlite.execute({script:"CREATE TABLE teams(id TEXT PRIMARY KEY);INSERT INTO teams VALUES('team-a'),('team-b');CREATE TABLE research_cache(id TEXT PRIMARY KEY,team_id TEXT NOT NULL REFERENCES teams(id),value TEXT NOT NULL,created_at INTEGER NOT NULL);CREATE TABLE research_usage(id TEXT PRIMARY KEY);CREATE TABLE research_runs(id TEXT PRIMARY KEY,input_tokens INTEGER,output_tokens INTEGER);INSERT INTO research_runs VALUES('benchmark',11,22);CREATE TABLE research_drafts(id TEXT PRIMARY KEY);CREATE TABLE research_draft_revisions(id TEXT PRIMARY KEY);"});state.db=drizzle({prepare:(sql:string)=>new Statement(sql)} as never,{schema});});
beforeEach(()=>{failClaim=false;failTerminal=false;query('DELETE FROM research_cache');state.team='team-a';state.authorized=true;vi.stubEnv('ANTHROPIC_API_KEY',secret);});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});afterAll(()=>{sqlite.close();rmSync(folder,{recursive:true,force:true});});
it('uses one fixed same-Haiku schema request and separate cost ledger without mutating runs or writers',async()=>{
 const fetcher=vi.fn(async(_url:unknown,options?:RequestInit)=>{expect(query('SELECT value FROM research_cache')).toHaveLength(1);expect(JSON.parse(query('SELECT value FROM research_cache')[0].value).state).toBe('pending');expect(options?.redirect).toBe('manual');return response();});
 const result=await probeResearchHaikuGenerationHealth('team-a',operationId,fetcher as typeof fetch);expect(result.status).toBe('completed');expect(fetcher).toHaveBeenCalledTimes(1);
 const [url,init]=fetcher.mock.calls[0];expect(url).toBe('https://api.anthropic.com/v1/messages');expect(init?.headers).toEqual({'x-api-key':secret,'anthropic-version':'2026-10-21','Content-Type':'application/json'});
 const body=JSON.parse(String(init?.body));expect(body).toEqual(anthropicResearchRequest(RESEARCH_HAIKU_HEALTH_MODEL,body.system,{health:true},{type:'object',properties:{ok:{type:'boolean',const:true}},required:['ok'],additionalProperties:false},64,'schema'));expect(body).toMatchObject({model:'claude-haiku-5-5',max_tokens:64,thinking:{type:'disabled'},output_config:{format:{type:'json_schema'}}});expect(body).not.toHaveProperty('tools');
 expect(result.usage).toMatchObject({input:100,output:10,costStatus:'calculated'});expect(result).toMatchObject({usageScope:'separate_provider_health_receipt',includedInBenchmarkUsage:false,providerRequestsMadeNow:1,automaticRetry:false});
 expect(query('SELECT * FROM research_usage')).toEqual([]);expect(query('SELECT * FROM research_runs')).toEqual([{id:'benchmark',input_tokens:11,output_tokens:22}]);expect(query('SELECT * FROM research_drafts')).toEqual([]);expect(query('SELECT * FROM research_draft_revisions')).toEqual([]);expect(JSON.stringify(query('SELECT * FROM research_cache'))+JSON.stringify(result)).not.toContain(secret);
});
it('atomically runs once, never duplicates a pending request, and replays terminal receipts without inference',async()=>{
 let resolve!:(response:Response)=>void,entered!:()=>void;const started=new Promise<void>(done=>{entered=done;});const fetcher=vi.fn(async()=>{entered();return new Promise<Response>(done=>{resolve=done;});});const first=probeResearchHaikuGenerationHealth('team-a',operationId,fetcher);await started;const pending=await probeResearchHaikuGenerationHealth('team-a',operationId,fetcher);expect(pending).toMatchObject({status:'pending',replayed:true,providerRequestsMadeNow:0,requestMayHaveBeenSent:true,automaticRetry:false});expect(fetcher).toHaveBeenCalledTimes(1);resolve(response());const completed=await first;const replayed=await probeResearchHaikuGenerationHealth('team-a',operationId,fetcher);expect(replayed).toEqual({...completed,replayed:true,providerRequestsMadeNow:0});expect(fetcher).toHaveBeenCalledTimes(1);
});
it('isolates the same operation ID by authenticated team and checks auth before any persistence or provider call',async()=>{
 const fetcher=vi.fn(async()=>response());vi.stubGlobal('fetch',fetcher);const body=JSON.stringify({operation:'haiku_generation_health',operationId});state.authorized=false;expect((await researchProvidersHttp(new Request('https://app.test/api/research/providers',{method:'POST',body}))).status).toBe(401);expect(query('SELECT * FROM research_cache')).toEqual([]);expect(fetcher).not.toHaveBeenCalled();
 state.authorized=true;for(const team of ['team-a','team-b']){state.team=team;const result=await researchProvidersHttp(new Request('https://app.test/api/research/providers',{method:'POST',body}));expect(result.status).toBe(200);expect((await result.json()).generationHealth.status).toBe('completed');}expect(fetcher).toHaveBeenCalledTimes(2);expect(query('SELECT team_id FROM research_cache ORDER BY team_id')).toEqual([{team_id:'team-a'},{team_id:'team-b'}]);
});
it('persists nonstandard JSON403 shape without guessing billing, retaining raw strings or retrying',async()=>{
 const fetcher=vi.fn(async()=>Response.json({error:secret,message:secret,prompt:secret},{status:403,headers:{'request-id':'req_valid_identifier','x-private':secret}}));const result=await probeResearchHaikuGenerationHealth('team-a',operationId,fetcher);expect(result).toMatchObject({status:'rejected',generationAccess:'rejected',diagnostic:{httpStatus:403,reasonClassification:'unclassified_json_rejection',shape:{topLevel:'object',error:'string',codePresent:false,typePresent:false,messagePresent:false}}});const saved=JSON.stringify(query('SELECT * FROM research_cache'))+JSON.stringify(result);for(const value of [secret,'req_valid_identifier','x-private'])expect(saved).not.toContain(value);expect(result.usage.costStatus).toBe('unknown');expect((await probeResearchHaikuGenerationHealth('team-a',operationId,fetcher)).replayed).toBe(true);expect(fetcher).toHaveBeenCalledTimes(1);
});
it('keeps missing-key and ambiguous transport outcomes terminal without exposing exceptions or repeating the request',async()=>{
 vi.stubEnv('ANTHROPIC_API_KEY','');const missing=vi.fn();expect((await probeResearchHaikuGenerationHealth('team-a',operationId,missing)).status).toBe('unconfigured');expect(missing).not.toHaveBeenCalled();vi.stubEnv('ANTHROPIC_API_KEY',secret);expect((await probeResearchHaikuGenerationHealth('team-a',operationId,missing)).replayed).toBe(true);expect(missing).not.toHaveBeenCalled();
 const failed=vi.fn(async()=>{throw Error(secret);});const id='b1000000-0000-4000-8000-000000000002',result=await probeResearchHaikuGenerationHealth('team-a',id,failed);expect(result).toMatchObject({status:'transport_error',diagnostic:{reasonClassification:'transport_unknown',billingOutcome:'unknown'}});expect(JSON.stringify(result)).not.toContain(secret);await probeResearchHaikuGenerationHealth('team-a',id,failed);expect(failed).toHaveBeenCalledTimes(1);
});
it('rejects wrong-model, text-only and malformed successful replies without retaining output',async()=>{
 for(const [index,change]of [{model:'claude-sonnet-5-5'},{stop_reason:'max_tokens'},{stop_reason:'end_turn',content:[{type:'text',text:secret}]},{content:[{type:'text',text:'{\"ok\":true,\"private\":true}'}]},{content:{private:secret}}].entries()){
  const good=await response().json(),fetcher=vi.fn(async()=>Response.json({...good,...change}));const result=await probeResearchHaikuGenerationHealth('team-a',`b1000000-0000-4000-8000-${String(index+3).padStart(12,'0')}`,fetcher);expect(result.status).toBe('unexpected_response');expect(JSON.stringify(result)+JSON.stringify(query('SELECT * FROM research_cache'))).not.toContain(secret);expect(fetcher).toHaveBeenCalledTimes(1);
 }
});

it('fails closed on a changed contract for the same team+operation identity without a second call',async()=>{
 const fetcher=vi.fn(async()=>response()),first=await probeResearchHaikuGenerationHealth('team-a',operationId,fetcher);const row=query('SELECT value FROM research_cache WHERE id=?',[first.receiptId])[0],saved=JSON.parse(row.value);saved.contractHash='0'.repeat(64);query('UPDATE research_cache SET value=? WHERE id=?',[JSON.stringify(saved),first.receiptId]);await expect(probeResearchHaikuGenerationHealth('team-a',operationId,fetcher)).rejects.toThrow('receipt is missing or changed');expect(fetcher).toHaveBeenCalledTimes(1);expect(query('SELECT id FROM research_cache')).toHaveLength(1);
});
it('requires durable claim before generation and never retries a generated request whose terminal receipt could not be saved',async()=>{
 const fetcher=vi.fn(async()=>response());failClaim=true;await expect(probeResearchHaikuGenerationHealth('team-a',operationId,fetcher)).rejects.toThrow('storage unavailable');expect(fetcher).not.toHaveBeenCalled();expect(query('SELECT id FROM research_cache')).toEqual([]);failClaim=false;
 const completedButUnsaved=vi.fn(async()=>{failTerminal=true;return response();});await expect(probeResearchHaikuGenerationHealth('team-a',operationId,completedButUnsaved)).rejects.toThrow('storage unavailable');failTerminal=false;const replay=await probeResearchHaikuGenerationHealth('team-a',operationId,completedButUnsaved);expect(replay).toMatchObject({status:'pending',replayed:true,providerRequestsMadeNow:0,requestMayHaveBeenSent:true});expect(completedButUnsaved).toHaveBeenCalledTimes(1);
});
it('keeps Sonnet and Haiku receipt identities and transport contracts separate even for the same operation ID',async()=>{
 const {probeResearchGenerationHealth}=await import('./research-provider-health');
 const sonnet=vi.fn(async()=>Response.json({model:'claude-sonnet-5-5',stop_reason:'tool_use',content:[{type:'tool_use',name:'submit_research',input:{ok:true}}],usage:{input_tokens:10,output_tokens:2}}));
 const haiku=vi.fn(async()=>response());
 const [a,b]=await Promise.all([probeResearchGenerationHealth('team-a',operationId,sonnet),probeResearchHaikuGenerationHealth('team-a',operationId,haiku)]);
 expect(a.status).toBe('completed');expect(b.status).toBe('completed');expect(a.receiptId).not.toBe(b.receiptId);expect(a.contractHash).not.toBe(b.contractHash);expect(query('SELECT id FROM research_cache')).toHaveLength(2);
 await probeResearchGenerationHealth('team-a',operationId,sonnet);await probeResearchHaikuGenerationHealth('team-a',operationId,haiku);expect(sonnet).toHaveBeenCalledTimes(1);expect(haiku).toHaveBeenCalledTimes(1);
});
