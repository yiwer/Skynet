import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {assessmentFixture} from './assessment-fixture.js';
import {digest} from '../apps/server/database.js';

// Explicit public capacity journey. This is a reuse-budget boundary check,
// not an AC32 latency sample or a reduced production report limit.
assert.ok(process.env.SKYNET_PERIODS_EVIDENCE);
const f=await assessmentFixture(),evidence:Record<string,unknown>={kind:'assessment-input-reuse-budget',
  revision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),startedAt:new Date().toISOString(),sessions:2001};
try{
  const owner=await f.owner('Reuse budget boundary');
  for(let index=0;index<2001;index++){
    const original=f.rows({prompts:1,tokens:10,verified:0,claimed:0});
    const saved=await f.upload(owner,original.rows,original.sessionId);
    if(index===0)await f.analyze(owner,saved.snapshotId);
  }
  const path='/api/capability-profiles/'+owner.employeeId;
  async function read(url:string,body?:object){const response=await f.api(owner,url,body);assert.equal(response.status,200,await response.clone().text());return response.json();}
  const complete=await read(path+'/export');
  assert.equal(complete.kpis.sessions,2001);assert.equal(complete.kpis.userTurns,2001);assert.equal(complete.kpis.inputTokens,20010);
  assert.equal(complete.sessions.length,2001);assert.equal(complete.assessment.inputs.insightVersions.length,2001);
  assert.equal(complete.coaching.communication.firstPrompts.person.count,2001);
  assert.deepEqual(complete.coaching.communication.firstPrompts.person.elements.goal,{numerator:1,denominator:1,unknown:2000,value:1});
  const page=await read(path);assert.equal(page.pages.sessions.total,2001);assert.equal(page.assessment.inputPage.insightCount,2001);
  assert.deepEqual(await read(path+'/recompute',{}),page,'declining reuse keeps the complete old full path result');
  assert.deepEqual(await read(path+'/export?version='+complete.version),complete);
  await f.restart();assert.deepEqual(await read(path+'/export?version='+complete.version),complete);
  evidence.status='passed';evidence.version=complete.version;evidence.payloadHash=digest(JSON.stringify(complete));
  evidence.bytes=Buffer.byteLength(JSON.stringify(complete));
}catch(error){evidence.status='failed';evidence.error=String(error);throw error;}
finally{await f.close();evidence.finishedAt=new Date().toISOString();await writeFile(process.env.SKYNET_PERIODS_EVIDENCE,JSON.stringify(evidence,null,2));}
