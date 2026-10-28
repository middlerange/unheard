import {readFileSync,readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {expect,it} from 'vitest';

it('preserves pending reviews, revisions, identities and foreign keys while permitting distinct ideas per source',()=>{
  const before=readdirSync('drizzle-d1').filter(n=>n.endsWith('.sql')&&n<'0034').sort().map(n=>readFileSync('drizzle-d1/'+n,'utf8')).join('\n');
  const migration=readFileSync('drizzle-d1/0034_research_distinct_ideas.sql','utf8');
  const python=`import sqlite3,json,sys
p=json.load(sys.stdin)
c=sqlite3.connect(':memory:')
c.row_factory=sqlite3.Row
c.execute('PRAGMA foreign_keys=ON')
c.executescript(p['before'])
c.execute("INSERT INTO teams(id,name,slug,created_at,updated_at) VALUES('t','Team','team',1,1)")
c.execute("INSERT INTO research_runs(id,team_id,mode,status,days,created_at,icp) VALUES('r','t','scan','completed',1,1,'Product leaders')")
c.execute("INSERT INTO research_items(id,team_id,source_id,canonical_url,title,excerpt,published_at,collected_at) VALUES('i','t','source','https://example.org/report','Report','Public evidence',1,1)")
c.execute("INSERT INTO ideas(id,team_id,text,created_at,updated_at) VALUES('saved-idea','t','Exact saved idea',1,2)")
c.execute("INSERT INTO posts(id,team_id,state,idea_id,created_at,updated_at) VALUES('linked-post','t','awaiting_approval','saved-idea',1,2)")
c.execute("INSERT INTO research_findings(id,team_id,run_id,item_id,source_id,title,url,published_at,score,summary,why_it_matters,content_angle,evidence,limitations,created_at,family_key,source_published_at,source_discovered_at,signal_kind) VALUES('f','t','r','i','source','Report','https://example.org/report',1,85,'Original claim','Decision','Angle','Exact supplied evidence','Scope',1,'first-idea',1,1,'fresh')")
c.execute("UPDATE research_findings SET status='saved',idea_id='saved-idea' WHERE id='f'")
c.execute("INSERT INTO research_drafts(id,team_id,run_id,finding_id,content,status,slack_channel_id,slack_thread_ts,slack_message_ts,snapshot_hash,created_at,updated_at,is_test) VALUES('d','t','r','f','exact review copy','pending','channel','thread','message','snapshot',1,2,1)")
c.execute("UPDATE research_drafts SET post_id='linked-post',input_tokens=321,output_tokens=123,revision=4,error='Preserve prior diagnostic' WHERE id='d'")
c.execute("INSERT INTO research_draft_revisions(id,team_id,draft_id,revision,content,instruction,slack_user_id,created_at) VALUES('v','t','d',1,'original revision','preserve this','reviewer',1)")
tables=['research_findings','research_drafts','research_draft_revisions','ideas','posts']
snapshot=lambda:{t:[dict(r) for r in c.execute('SELECT * FROM '+t+' ORDER BY id')] for t in tables}
original=snapshot()
original_schema=list(c.execute("SELECT type,name,sql FROM sqlite_master ORDER BY type,name"))
c.commit()
try:
 c.executescript('BEGIN;'+p['migration']+'SELECT * FROM deliberate_migration_failure;COMMIT;')
 raise AssertionError('Injected migration failure did not fail')
except sqlite3.OperationalError: c.rollback()
assert snapshot()==original,'Failed transaction changed existing data'
assert list(c.execute("SELECT type,name,sql FROM sqlite_master ORDER BY type,name"))==original_schema,'Failed transaction changed existing schema'
c.executescript('BEGIN;'+p['migration']+'COMMIT;')
assert snapshot()==original,'Existing review data changed or cascaded away'
c.execute("INSERT INTO research_findings SELECT 'f2',team_id,run_id,item_id,source_id,title,url,published_at,score,'Second supported claim',why_it_matters,content_angle,evidence,limitations,status,idea_id,created_at,'second-idea',content_type,transcript_status,source_published_at,source_discovered_at,signal_kind FROM research_findings WHERE id='f'")
assert c.execute('SELECT COUNT(*) FROM research_findings').fetchone()[0]==2
try:
 c.execute("INSERT INTO research_findings SELECT 'f3',team_id,run_id,item_id,source_id,title,url,published_at,score,summary,why_it_matters,content_angle,evidence,limitations,status,idea_id,created_at,family_key,content_type,transcript_status,source_published_at,source_discovered_at,signal_kind FROM research_findings WHERE id='f2'")
 raise AssertionError('Duplicate family accepted')
except sqlite3.IntegrityError: pass
try:
 c.execute("UPDATE research_drafts SET is_test=0 WHERE id='d'")
 raise AssertionError('Immutable review marker changed')
except sqlite3.IntegrityError: pass
assert list(c.execute('PRAGMA foreign_key_check'))==[]
c.execute("DELETE FROM posts WHERE id='linked-post'")
assert c.execute("SELECT post_id FROM research_drafts WHERE id='d'").fetchone()[0] is None
assert c.execute("SELECT COUNT(*) FROM research_drafts WHERE id='d'").fetchone()[0]==1
c.execute("DELETE FROM research_items WHERE id='i'")
assert all(c.execute('SELECT COUNT(*) FROM '+t).fetchone()[0]==0 for t in tables[:3]),'Original cascade behavior changed'
assert c.execute("SELECT text FROM ideas WHERE id='saved-idea'").fetchone()[0]=='Exact saved idea'
assert list(c.execute('PRAGMA foreign_key_check'))==[]
print(json.dumps({'preserved':True,'distinctIdeas':2,'foreignKeysValid':True,'testMarkerPreserved':True}))`;
  const result=spawnSync('python3',['-c',python],{input:JSON.stringify({before,migration}),encoding:'utf8',timeout:10_000,maxBuffer:2_000_000});
  expect(result.status,result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({preserved:true,distinctIdeas:2,foreignKeysValid:true,testMarkerPreserved:true});
});
