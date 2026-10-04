import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ownedCommand,OwnedCommandError} from './owned-command.js';
import {setTimeout} from 'node:timers/promises';

test('publicly uploaded source bundles restore isolated first reads after another clone has appended and recomputed',{timeout:180000},async()=>{
  const directory=await mkdtemp(join(tmpdir(),'skynet-ac32-public-'));
  const invoke=(...args:string[])=>ownedCommand(process.execPath,['--import','tsx','tests/ac32-performance.ts',...args],process.env,'',{timeoutMs:120000});
  try{
    const source=join(directory,'source');await invoke('seed',source,'--mini');
    const before=JSON.parse(await readFile(join(source,'bundle.json'),'utf8'));assert.equal(before.dataset.sessions,10);assert.equal(before.diagnostic,true);
    assert.equal(before.preparation.reportRequests,0);assert.equal(before.preparation.analysisJobsVerified,2);
    const first=join(directory,'first.json'),second=join(directory,'second.json');
    await invoke('sample',source,'metrics',first,'--checks');await invoke('sample',source,'metrics',second);
    const a=JSON.parse(await readFile(first,'utf8')),b=JSON.parse(await readFile(second,'utf8'));
    assert.equal(a.observation.correctness,'passed');assert.equal(b.observation.correctness,'passed');
    assert.notEqual(a.observation.environmentId,b.observation.environmentId);assert.notEqual(a.pid,b.pid);
    assert.equal(a.sourceBundleHash,b.sourceBundleHash);assert.equal(a.observation.version,b.observation.version);
    assert.deepEqual(a.checks,{coldAndWarm:'passed',fixed:'passed',full:'passed',export:{status:200,bytes:a.checks.export.bytes},late:'passed',history:'passed',lateFull:'passed'});
    assert.deepEqual(JSON.parse(await readFile(join(source,'bundle.json'),'utf8')),before,'the baseline artifact is untouched by either clone');
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('an interrupted measurement retains a failed result and removes only its exact abandoned database fixture',{timeout:150000},async()=>{
  const directory=await mkdtemp(join(tmpdir(),'skynet-ac32-interrupt-')),destination=join(directory,'run');
  const operation=ownedCommand(process.execPath,['--import','tsx','tests/ac32-performance.ts','run',destination,'--mini','--entry','metrics','--samples','1'],process.env,'',{timeoutMs:120000})
    .then(value=>({value,error:undefined}),error=>({value:undefined,error}));
  try{
    let record:any;const deadline=Date.now()+90000;
    while(!record&&Date.now()<deadline){try{record=JSON.parse(await readFile(join(destination,'metrics-000.json.owner.json'),'utf8'));}
      catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT'&&!(error instanceof SyntaxError))throw error;await setTimeout(100);}}
    assert.ok(record,'The owned measurement child must announce its isolated fixture');assert.notEqual(record.pid,process.pid);
    assert.equal(await readFile(join(record.directory,'ac32-owner'),'utf8'),record.owner);
    process.kill(record.pid,'SIGTERM');
    const result=await operation;assert.ok(result.error instanceof OwnedCommandError);assert.equal(result.error.code,1);
    const summary=JSON.parse(await readFile(join(destination,'summary.json'),'utf8'));assert.equal(summary.status,'failed');assert.ok(summary.errors.length>0);
    await assert.rejects(access(record.directory),{code:'ENOENT'});await assert.rejects(access(join(destination,'metrics-000.json.owner.json')),{code:'ENOENT'});
    await access(join(destination,'source','bundle.json'));
  }finally{await operation;await rm(directory,{recursive:true,force:true});}
});
