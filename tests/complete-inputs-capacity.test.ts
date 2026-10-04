import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {restoreBundle,seedBundle,disposeOwned} from './ac32-fixture.js';
import {mcpSandbox} from './mcp-support.js';

// Reuse only the verified, stopped source bundle; each test gets its own DB/raw
// copy. Without an explicit bundle, prepare the same full public-upload fixture.
test('complete reports retain 1,000 sessions and 19,000 waits independently of bounded transport pages', {timeout:600000}, async()=>{
  const directory=process.env.SKYNET_CAPACITY_SOURCE??await mkdtemp(join(tmpdir(),'skynet-capacity-'));
  const source=process.env.SKYNET_CAPACITY_SOURCE??join(directory,'source');
  if(!process.env.SKYNET_CAPACITY_SOURCE)await seedBundle(source,'capacity-functional',false,true);
  const {sandbox,owner,bundle}=await restoreBundle(source);
  const f=await mcpSandbox({sandbox,reportClock:()=>new Date(bundle.clock)}).catch(async error=>{await disposeOwned(sandbox,owner);throw error;});
  const api=(path:string,body?:object)=>f.api(path,bundle.people[0]!.readerCredential,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});
  const read=async(path:string,body?:object)=>{const response=await api(path,body),text=await response.text();assert.equal(response.status,200,path+': '+text);return JSON.parse(text);};
  try{
    assert.deepEqual([bundle.dataset.sessions,bundle.dataset.businessEvents,bundle.dataset.waits,bundle.dataset.analyzedSessions],[1000,80000,19000,20]);
    assert.equal(bundle.preparation.reportRequests,0);
    const query='period=since-enrollment';
    const waits=await read('/api/waits?'+query);
    assert.equal(waits.total,19000);assert.equal(waits.intervals.length,25);
    const report=await read('/api/wait-report?'+query+'&waitVersion='+waits.version);
    assert.equal(report.waitVersion,waits.version);
    assert.deepEqual([report.summary.knownCount,report.summary.unknownCount,report.summary.medianMs,report.summary.p90Ms],[19000,0,36000,36000]);
    assert.equal(report.summary.permissionMedianMs,null);
    assert.equal(report.people.length,10);assert.ok(report.people.every((person:any)=>person.count===1900));
    assert.equal(report.heatmap.reduce((sum:number,cell:any)=>sum+cell.count,0),19000);
    assert.deepEqual(await read('/api/wait-report?'+query+'&version='+report.version),report);
    assert.deepEqual(await read('/api/waits/recompute',{period:'since-enrollment'}),waits);
    assert.deepEqual(await read('/api/wait-report?'+query),report);
    const prompts=await read('/api/prompt-report?'+query);
    assert.deepEqual([prompts.kpis.sessions,prompts.kpis.prompts,prompts.kpis.context.denominator,prompts.kpis.context.unknown],[1000,20000,400,19600]);
    assert.deepEqual(await read('/api/prompt-report/recompute',{period:'since-enrollment'}),prompts);
  }finally{await disposeOwned(f,owner);if(!process.env.SKYNET_CAPACITY_SOURCE)await rm(directory,{recursive:true,force:true});}
});
