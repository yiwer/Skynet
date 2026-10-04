import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,resolve,basename} from 'node:path';
import {request as httpRequest} from 'node:http';
import {setTimeout} from 'node:timers/promises';
import {restoreBundle,seedBundle,disposeOwned,appendLate} from './ac32-fixture.js';
import {mcpSandbox} from './mcp-support.js';

test('the complete fixed wait download retains all 19,000 intervals beyond the old transport ceiling', {timeout:600000}, async t=>{
  const directory=process.env.SKYNET_CAPACITY_SOURCE??await mkdtemp(join(tmpdir(),'skynet-waits-capacity-'));
  const source=process.env.SKYNET_CAPACITY_SOURCE??join(directory,'source');
  if(!process.env.SKYNET_CAPACITY_SOURCE)await seedBundle(source,'waits-download-functional',false,true);
  const {sandbox,owner,bundle}=await restoreBundle(source);
  const f=await mcpSandbox({sandbox,reportClock:()=>new Date(bundle.clock)}).catch(async error=>{await disposeOwned(sandbox,owner);throw error;});
  const api=(path:string,body?:object)=>f.api(path,bundle.people[0]!.readerCredential,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});
  const read=async(path:string,body?:object)=>{const response=await api(path,body),text=await response.text();assert.equal(response.status,200,path+': '+text.slice(0,1000));return JSON.parse(text);};
  try{
    assert.deepEqual([bundle.dataset.sessions,bundle.dataset.businessEvents,bundle.dataset.waits],[1000,80000,19000]);
    const query='period=since-enrollment',first=await read('/api/waits?'+query);
    assert.equal(first.total,19000);assert.equal(first.intervals.length,25);
    const response=await api('/api/waits/export?'+query+'&version='+first.version);
    assert.equal(response.status,200,await response.clone().text());
    const bytes=Buffer.from(await response.arrayBuffer()),complete=JSON.parse(bytes.toString('utf8'));
    assert.ok(bytes.length>16*1024*1024,'the unchanged full fixture exceeds the previous export ceiling');
    assert.equal(Number(response.headers.get('content-length')),bytes.length);
    assert.equal(response.headers.get('x-skynet-content-sha256'),createHash('sha256').update(bytes).digest('hex'));
    assert.equal(response.headers.get('etag'),'"'+first.version+'"');
    assert.match(response.headers.get('content-disposition')??'',new RegExp(first.version+'\\.json'));
    assert.equal(complete.version,first.version);assert.equal(complete.intervals.length,19000);
    assert.equal(new Set(complete.intervals.map((item:any)=>item.id)).size,19000);
    assert.deepEqual(complete.summary,first.summary);assert.equal(complete.summary.knownReplyWaitMs,684000000);
    assert.equal(complete.summary.permissionWaitMs,null);assert.equal(complete.summary.permissionWaitCount,null);
    assert.ok(complete.intervals.every((item:any)=>item.durationMs===36000&&item.start?.snapshotId&&item.start.webPath&&item.end.snapshotId&&item.end.conversationPath));
    assert.deepEqual(complete.intervals.slice(0,25),first.intervals);
    const tail=await read('/api/waits?'+query+'&version='+first.version+'&offset=18975');
    assert.deepEqual(complete.intervals.slice(-25),tail.intervals);assert.equal(tail.nextOffset,null);
    for(const section of ['intervals','daily','unavailableSources']){
      const values:unknown[]=[];let offset=0;
      do{
        const result=await api('/api/waits?'+query+'&version='+first.version+'&section='+section+'&offset='+offset),text=await result.text();
        assert.equal(result.status,200,text.slice(0,1000));assert.ok(Buffer.byteLength(text)<=32*1024);
        const page=JSON.parse(text);assert.equal(page.version,first.version);assert.equal(page.pages[section].offset,offset);values.push(...page[section]);
        if(page.pages[section].nextOffset===null)break;
        assert.ok(page.pages[section].nextOffset>offset);offset=page.pages[section].nextOffset;
      }while(true);
      assert.deepEqual(values,complete[section]);
    }
    for(const extra of ['employeeId='+bundle.people[0]!.employeeId,'source=claude-code-cli','project=/different','week=2026-01-05'])
      assert.equal((await api('/api/waits/export?'+query+'&version='+first.version+'&'+extra)).status,400);
    // Corrupt only this owned fixture's derived revision header, never raw
    // originals. All observations stay at the authenticated download boundary.
    await f.testDatabase.query("UPDATE wait_revisions SET payload=jsonb_set(payload,'{total}','19001') WHERE version=$1",[first.version]);
    try{
      const broken=await api('/api/waits/export?'+query+'&version='+first.version);assert.equal(broken.status,503);
      assert.match((await broken.json()).error,/等待记录版本不完整/);assert.equal(broken.headers.get('content-disposition'),null);
    }finally{await f.testDatabase.query("UPDATE wait_revisions SET payload=jsonb_set(payload,'{total}','19000') WHERE version=$1",[first.version]);}
    const server=await f.startServer(),download=server+'/api/waits/export?'+query+'&version='+first.version;
    try{
      for(let index=0;index<10;index++)await new Promise<void>((resolve,reject)=>{
        const request=httpRequest(download,{headers:{Authorization:'Bearer '+bundle.people[0]!.readerCredential}},response=>{
          response.on('error',()=>{});
          try{assert.equal(response.statusCode,200);assert.equal(Number(response.headers['content-length']),bytes.length);response.pause();request.destroy();resolve();}catch(error){request.destroy();reject(error);}
        });request.setTimeout(30000,()=>request.destroy(new Error('wait download deadline')));request.on('error',reject);request.end();
      });
      const afterAbort=await fetch(download,{headers:{Authorization:'Bearer '+bundle.people[0]!.readerCredential},signal:AbortSignal.timeout(60000)});
      assert.equal(afterAbort.status,200);const reader=afterAbort.body!.getReader(),parts:Buffer[]=[];let slow=true;
      while(true){const part=await reader.read();if(part.done)break;parts.push(Buffer.from(part.value));if(slow){await setTimeout(50);slow=false;}}
      assert.deepEqual(Buffer.concat(parts),bytes);
    }finally{await f.stopServer();}
    await appendLate(f.api,source,bundle);
    const next=await read('/api/waits?'+query);assert.equal(next.total,19001);assert.notEqual(next.version,first.version);
    assert.deepEqual(await read('/api/waits/recompute',{period:'since-enrollment'}),next);
    await f.restart();
    assert.deepEqual(Buffer.from(await(await api('/api/waits/export?'+query+'&version='+first.version)).arrayBuffer()),bytes);
    t.diagnostic(JSON.stringify({kind:'waits-download-capacity-not-ac32',sourceBundleHash:bundle.bundleHash,intervals:19000,bytes:bytes.length,fixedVersion:first.version}));
  }finally{await disposeOwned(f,owner);if(!process.env.SKYNET_CAPACITY_SOURCE){assert.equal(dirname(resolve(directory)),resolve(tmpdir()));assert.match(basename(directory),/^skynet-waits-capacity-/);await rm(directory,{recursive:true,force:true});}}
});
