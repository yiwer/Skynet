import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, writeFile, unlink, symlink } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { recordHook } from '../apps/collector/hook.js';
import { collectorRuntimeFixture } from './collector-runtime-fixture.js';

const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
async function captured(f:Awaited<ReturnType<typeof collectorRuntimeFixture>>,ids:string[],observations:unknown[]){
  const start=Date.now();
  do{f.assertRunning();const value=await(await f.api('/api/sessions')).json(),status=await f.status();
    observations.push({elapsedMs:Date.now()-start,sessions:value.sessions.map((session:any)=>session.source_session_id),heartbeatFresh:status.server?.fresh??false,pending:status.codexUnclassifiedEvents,routing:status.runtime?.codexRouting});
    if(status.server?.fresh&&ids.every(id=>value.sessions.some((session:any)=>session.source_session_id===id)))return value.sessions;
    await setTimeout(200);
  }while(Date.now()-start<20_000);
  assert.fail('expected original sessions and a fresh heartbeat within 20 seconds');
}
test('an unclassified Codex hook backlog cannot starve new CLI capture or the installed heartbeat', {timeout:150_000}, async()=>{
  const f=await collectorRuntimeFixture(), observations:unknown[]=[];
  try{
    console.log('Routing fairness fixture:',f.directory);
    const unknown=await f.native('unverified-app'), mismatch=await f.native(), good=await f.native();
    const padding=Buffer.from(JSON.stringify({type:'response_item',timestamp:new Date().toISOString(),payload:{type:'message',role:'assistant',content:[{type:'output_text',text:'x'.repeat(1024*1024)}]}})+'\n');
    for(const value of [unknown,mismatch])await writeFile(value.transcriptPath,Buffer.concat([value.bytes,padding]));
    const originals=await Promise.all([unknown,mismatch].map(async value=>({path:value.transcriptPath,hash:hash(await readFile(value.transcriptPath))})));
    const backlog=16384, before=Date.now();
    for(let i=0;i<backlog;i++)await recordHook(f.inbox,i%2?{...mismatch.event,session_id:randomUUID()}:unknown.event);
    observations.push({stage:'seeded',backlog,elapsedMs:Date.now()-before});
    const spool=join(f.inbox,'spool'), retained=new Map<string,string>();
    for(const name of (await readdir(spool)).filter(name=>name.endsWith('.json')))retained.set(name,hash(await readFile(join(spool,name))));
    const started=Date.now();await f.start();
    await setTimeout(500);
    await f.run('hook',f.inbox,JSON.stringify(good.event));
    const deadline=started+20_000;let observed=false;
    do{
      f.assertRunning();const status=await f.status(), sessions=await(await f.api('/api/sessions')).json();
      observations.push({stage:'poll',elapsedMs:Date.now()-started,lastSweepCompletedAt:status.lastSweepCompletedAt,
        healthCheckedAt:status.server?.checkedAt??null,healthFresh:status.server?.fresh??false,inbox:status.codexUnclassifiedEvents,
        sessions:sessions.sessions.length,errors:status.runtime?.errors?.length??0});
      observed=status.server?.fresh&&sessions.sessions.some((session:any)=>session.source_session_id===good.sessionId);
      if(observed)break;await setTimeout(200);
    }while(Date.now()<deadline);
    assert.equal(observed,true,'a normal CLI hook and a fresh heartbeat remain available within the existing 20-second health window despite unrelated retained events');
    assert.equal((await readdir(spool)).filter(name=>name.endsWith('.json')).length,backlog);
    for(const [name,expected]of retained)assert.equal(hash(await readFile(join(spool,name))),expected,'unclassified hook bytes remain available for retry');
    for(const original of originals)assert.equal(hash(await readFile(original.path)),original.hash);
    const sessions=(await(await f.api('/api/sessions')).json()).sessions;
    assert.equal(sessions.length,1);const raw=await f.api('/api/snapshots/'+sessions[0].id+'/raw');assert.equal(raw.status,200);assert.deepEqual(Buffer.from(await raw.arrayBuffer()),good.bytes);
  }finally{
    try{await writeFile(join(f.directory,'routing-fairness-observations.json'),JSON.stringify(observations,null,2));}
    finally{await f.close();}
  }
});

test('routing metadata keeps its one MiB boundary, exact identity and native path safeguards', {timeout:90_000}, async()=>{
  const f=await collectorRuntimeFixture(),observations:unknown[]=[],accepted:Awaited<ReturnType<typeof f.native>>[]=[],rejected:Awaited<ReturnType<typeof f.native>>[]=[];
  try{
    console.log('Routing metadata fixture:',f.directory);
    for(const lineBytes of [4095,4096,1024*1024-1,1024*1024]){
      const value=await f.native(),lines=value.bytes.toString().split('\n'),meta=JSON.parse(lines[0]!);
      meta.payload.padding='';const base=Buffer.byteLength(JSON.stringify(meta));meta.payload.padding='x'.repeat(lineBytes-base);
      lines[0]=JSON.stringify(meta);value.bytes=Buffer.from(lines.join('\n'));assert.equal(value.bytes.indexOf(10),lineBytes);
      await writeFile(value.transcriptPath,value.bytes);await recordHook(f.inbox,value.event);
      (lineBytes<1024*1024?accepted:rejected).push(value);
    }
    const partial=await f.native();partial.bytes=Buffer.from(partial.bytes.toString().split('\n')[0]!);await writeFile(partial.transcriptPath,partial.bytes);await recordHook(f.inbox,partial.event);rejected.push(partial);
    const wrong=await f.native();await recordHook(f.inbox,{...wrong.event,session_id:randomUUID()});rejected.push(wrong);
    const outside=await f.native(),outsidePath=join(f.directory,'outside-native.jsonl');await writeFile(outsidePath,outside.bytes);await recordHook(f.inbox,{...outside.event,transcript_path:outsidePath});rejected.push(outside);
    const aliased=await f.native(),alias=join(f.nativeRoot,'alias');await symlink(dirname(aliased.transcriptPath),alias,process.platform==='win32'?'junction':'dir');
    await recordHook(f.inbox,{...aliased.event,transcript_path:join(alias,basename(aliased.transcriptPath))});rejected.push(aliased);
    const originalHooks=new Map<string,string>();for(const name of await readdir(join(f.inbox,'spool')))originalHooks.set(name,hash(await readFile(join(f.inbox,'spool',name))));
    await f.start();const sessions=await captured(f,accepted.map(value=>value.sessionId),observations);assert.equal(sessions.length,accepted.length);
    for(const value of accepted){const session=sessions.find((session:any)=>session.source_session_id===value.sessionId);
      assert.deepEqual(Buffer.from(await(await f.api('/api/snapshots/'+session.id+'/raw')).arrayBuffer()),value.bytes);}
    for(const value of rejected)assert.equal(sessions.some((session:any)=>session.source_session_id===value.sessionId),false);
    const retained=new Map<string,string>();for(const directory of [join(f.inbox,'spool'),join(f.state,'sources/codex-cli/spool')]){
      for(const name of await readdir(directory))retained.set(name,hash(await readFile(join(directory,name))));
    }
    assert.equal(retained.size,rejected.length);for(const [name,digest]of retained)assert.equal(digest,originalHooks.get(name));
    for(const value of [...accepted,...rejected])assert.deepEqual(await readFile(value.transcriptPath),value.bytes);
    const status=await f.status();assert.equal(status.codexUnclassifiedEvents,4);
    assert.ok(status.runtime.errors.some((error:string)=>error.includes('routing limit')));assert.ok(status.runtime.errors.some((error:string)=>error.includes('identity mismatch')));
    assert.ok(status.runtime.errors.some((error:string)=>error.includes('outside its native root')));
    observations.push({metadataNewlineOffsets:accepted.map(value=>value.bytes.indexOf(10)),unclassified:status.codexUnclassifiedEvents,aliasRetained:true,rawBytes:true});
  }finally{try{await writeFile(join(f.directory,'routing-metadata-observations.json'),JSON.stringify(observations,null,2));}finally{await f.close();}}
});

test('preexisting CLI work and corrected old hooks progress through restart while new hooks keep arriving', {timeout:120_000}, async()=>{
  const f=await collectorRuntimeFixture(),observations:unknown[]=[],spool=join(f.inbox,'spool');
  let producing=false,producer:Promise<void>|undefined,produced=0;
  try{
    console.log('Routing rotation fixture:',f.directory);
    const unknown=await f.native('unverified-app'),corrected=await f.native('unverified-app');
    for(let i=0;i<1280;i++)await recordHook(f.inbox,unknown.event);
    const retained=new Map<string,string>();for(const name of await readdir(spool))retained.set(name,hash(await readFile(join(spool,name))));
    await recordHook(f.inbox,corrected.event);
    // Public hook filenames are random. Choose an actual late enumerated hook,
    // without renaming it or injecting a private scheduler ordering fixture.
    let ready:Awaited<ReturnType<typeof f.native>>|undefined,readyBytes:Buffer|undefined;
    for(let i=0;i<40&&!ready;i++){
      const candidate=await f.native('unverified-app'),before=new Set(await readdir(spool));await recordHook(f.inbox,candidate.event);
      const names=(await readdir(spool)).sort(),name=names.find(name=>!before.has(name))!;
      if(names.indexOf(name)>=1024){ready=candidate;readyBytes=Buffer.from(candidate.bytes.toString().replace('unverified-app','codex-tui'));await writeFile(candidate.transcriptPath,readyBytes);}
    }
    assert.ok(ready,'a normal preexisting hook is selected beyond the first four batches');
    await f.start();const first=await captured(f,[ready.sessionId],observations);assert.equal(first.length,1);
    let status=await f.status();assert.equal(status.runtime.errorsScope,'last-sweep');assert.equal(status.runtime.codexRouting.scope,'last-batch');
    assert.ok(status.runtime.codexRouting.attempted<=256);assert.ok(status.runtime.codexRouting.deferred>0);
    assert.ok(status.codexUnclassifiedEvents>=1281);const priorHeartbeat=status.server.checkedAt;
    assert.deepEqual(Buffer.from(await(await f.api('/api/snapshots/'+first[0].id+'/raw')).arrayBuffer()),readyBytes);
    await f.stopRuntime();
    // Deleting one owned pending hook cannot invalidate the lexicographic
    // cursor. Native metadata can legitimately change; no cached rejection may
    // prevent this exact old hook from being inspected again after restart.
    const deleted=retained.keys().next().value!;await unlink(join(spool,deleted));retained.delete(deleted);
    const correctedBytes=Buffer.from(corrected.bytes.toString().replace('unverified-app','codex-tui'));await writeFile(corrected.transcriptPath,correctedBytes);
    await f.start();await setTimeout(500);const newest=await f.native();await f.run('hook',f.inbox,JSON.stringify(newest.event));
    producing=true;producer=(async()=>{while(producing){for(let i=0;i<160&&producing;i++){await recordHook(f.inbox,unknown.event);produced++;}await setTimeout(250);}})();
    const sessions=await captured(f,[ready.sessionId,corrected.sessionId,newest.sessionId],observations);
    assert.equal(sessions.length,3);assert.ok(produced>=160,'new arrivals overlap the old retry');
    for(const [id,bytes]of [[corrected.sessionId,correctedBytes],[newest.sessionId,newest.bytes]] as const){
      const session=sessions.find((session:any)=>session.source_session_id===id);assert.deepEqual(Buffer.from(await(await f.api('/api/snapshots/'+session.id+'/raw')).arrayBuffer()),bytes);
    }
    const deadline=Date.now()+20_000;
    do{status=await f.status();if(status.server.checkedAt!==priorHeartbeat&&status.server.fresh)break;await setTimeout(200);}while(Date.now()<deadline);
    assert.notEqual(status.server.checkedAt,priorHeartbeat,'health refreshes while retained and new hooks still exist');assert.equal(status.server.fresh,true);
    producing=false;await producer;
    for(const [name,expected]of retained)assert.equal(hash(await readFile(join(spool,name))),expected,'unclassified original hook remains unchanged');
    assert.deepEqual(await readFile(unknown.transcriptPath),unknown.bytes);
    observations.push({produced,retained:retained.size,priorHeartbeat,heartbeat:status.server.checkedAt});
  }finally{producing=false;try{await producer;await writeFile(join(f.directory,'routing-rotation-observations.json'),JSON.stringify(observations,null,2));}finally{await f.close();}}
});

test('a damaged routing cursor cannot strand a valid preexisting hook after restart', {timeout:90_000}, async()=>{
  const f=await collectorRuntimeFixture(),observations:unknown[]=[];
  try{
    console.log('Routing cursor fixture:',f.directory);
    const old=await f.native('unverified-app');await recordHook(f.inbox,old.event);await f.start();
    const start=Date.now();let checked=false;
    while(Date.now()-start<20_000){const status=await f.status();if(status.lastSweepCompletedAt){checked=true;break;}await setTimeout(100);}
    assert.equal(checked,true);await f.stopRuntime();
    const before=new Map<string,string>(),spool=join(f.inbox,'spool');for(const name of await readdir(spool))before.set(name,hash(await readFile(join(spool,name))));
    await writeFile(join(f.inbox,'routing.json'),'{ interrupted scheduling metadata');
    const ready=await f.native();await f.run('hook',f.inbox,JSON.stringify(ready.event));await f.start();
    const sessions=await captured(f,[ready.sessionId],observations);assert.equal(sessions.length,1);
    for(const [name,expected]of before)assert.equal(hash(await readFile(join(spool,name))),expected);
    assert.deepEqual(Buffer.from(await(await f.api('/api/snapshots/'+sessions[0].id+'/raw')).arrayBuffer()),ready.bytes);
  }finally{try{await writeFile(join(f.directory,'routing-cursor-observations.json'),JSON.stringify(observations,null,2));}finally{await f.close();}}
});
