import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { connect, digest } from '../apps/server/database.js';
import { analysisQueue } from '../apps/analysis/queue.js';
import { readAnalysisConfig, publicConfig } from '../apps/analysis/config.js';
import { analysisService } from '../apps/server/analysis.js';
import { archiveQuery } from '../apps/server/archive-query.js';
import { RawStore } from '../apps/server/raw-store.js';
import { createSandbox } from './support.js';

test('public durable queue fences duplicate leases, late writes, new inputs, retries and unknown billing', {timeout: 90000}, async () => {
  const sandbox = await createSandbox(); const db = connect(sandbox.env.DATABASE_URL!);
  try {
    const employee = await sandbox.provision('队列合成员工'); const origin = await sandbox.startServer();
    const api = (path: string, token = employee.readerCredential, body?: unknown, method = 'POST') => fetch(origin + path,
      {headers: {Authorization: `Bearer ${token}`, ...(body !== undefined ? {'Content-Type': 'application/json'} : {})},
        ...(body !== undefined ? {method, body: JSON.stringify(body)} : {})});
    const enrollment = await (await api('/api/devices/enroll', employee.enrollmentCredential, {installationId:randomUUID(),name:'queue'})).json();
    const path = join(sandbox.directory, 'config.json');
    await writeFile(path, JSON.stringify({mode:'fixture',executable:process.execPath, runtimeVersion:'2.1.281',model:'synthetic',
      workDirectory:join(sandbox.directory,'jobs'),fixtureOrigin:'http://127.0.0.1:12345',budgetId:'synthetic',budgetCny:0,
      inputCnyPerMillion:0,outputCnyPerMillion:0,maxAttempts:2,maxRequests:1,retryDelaySeconds:1,autoAnalyzeUpdates:false}));
    const config = await readAnalysisConfig(path);
    const heartbeat = (id: string, hash = config.configurationHash) => db.query('INSERT INTO analysis_workers(id,config) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET config=EXCLUDED.config,updated_at=now()',
      [id,{...publicConfig(config),configurationHash:hash}]);
    await heartbeat('a'); await heartbeat('b');
    async function upload(sessionId = randomUUID(), text = '原始合成输入', bad = false) {
      let bytes = Buffer.from(JSON.stringify({type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text}]}})+'\n');
      if (bad) bytes = Buffer.concat([bytes.subarray(0,bytes.indexOf(Buffer.from(text))),Buffer.from([255]),bytes.subarray(bytes.indexOf(Buffer.from(text))+Buffer.byteLength(text))]);
      const hash = digest(bytes);
      const stored = await fetch(origin+`/api/chunks/${hash}`,{method:'PUT',headers:{Authorization:`Bearer ${enrollment.deviceCredential}`,'Content-Type':'application/octet-stream'},body:bytes});
      assert.equal(stored.status,201);
      const committed = await api('/api/snapshots',enrollment.deviceCredential,{protocolVersion:1,sourceSessionId:sessionId,source:'codex-cli',sourceVersion:'0.157.1',sourceOs:'win32',
        project:'/synthetic',hash,byteLength:bytes.length,qualifiedAt:new Date().toISOString(),capability:'unverified'});
      assert.equal(committed.status,200); return {...await committed.json(),bytes,sessionId};
    }
    const first = await upload(); const requestPath = `/api/snapshots/${first.snapshotId}/analysis`;
    const [left,right] = await Promise.all([api(requestPath,undefined,{}),api(requestPath,undefined,{})]);
    assert.equal(left.status,202); const initial = await left.json(); assert.equal((await right.json()).id,initial.id);
    const qa = analysisQueue(db,config,'a'); const qb = analysisQueue(db,config,'b');
    const claims = await Promise.all([qa.claim(),qb.claim()]); assert.equal(claims.filter(Boolean).length,1);
    const old = claims.find(Boolean)!; const owner = claims[0] ? qa : qb;
    assert.equal(await owner.allowForward(old),true); assert.equal(await owner.allowForward(old),false);
    await db.query("UPDATE analysis_jobs SET lease_until=now()-interval '1 second' WHERE id=$1",[old.id]);
    let run = await (await api(`/api/analysis/${old.id}`)).json();
    assert.equal(run.state,'retry-wait'); assert.equal(run.attemptHistory[0].state,'lost'); assert.equal(run.attemptHistory[0].usage,null);
    assert.equal(await owner.allowForward(old),false);
    assert.equal((await api(`/api/analysis/${old.id}/retry`,undefined,{unexpected:true})).status,400);
    assert.equal((await api(`/api/analysis/${old.id}/retry`,undefined,{})).status,200);
    await sandbox.stopServer(); const restarted = await sandbox.startServer(new URL(origin).port ? Number(new URL(origin).port) : 0); assert.equal(restarted,origin);
    const current = await qb.claim(); assert.ok(current); assert.equal(current.attempts,2);
    assert.equal(await owner.finish(old,{items:[],fixture:true,usage:{inputTokens:null,outputTokens:null,runtimeCostUsd:null,providerBilledCny:null,requests:1}}),false);
    assert.equal(await qb.finish(current,null,'synthetic provider fault'),true);
    run = await (await api(`/api/analysis/${old.id}`)).json(); assert.equal(run.state,'failed'); assert.equal(run.attempts,2);
    assert.equal((await api(`/api/analysis/${old.id}/retry`,undefined,{})).status,409);
    assert.equal((await (await api(requestPath,undefined,{})).json()).id,old.id,'duplicate never resets durable attempts');
    const second = await upload(); const queued = await (await api(`/api/snapshots/${second.snapshotId}/analysis`,undefined,{})).json();
    const newer = await upload(second.sessionId,'新的合成输入');
    assert.equal((await (await api(`/api/analysis/${queued.id}`)).json()).state,'superseded');
    assert.equal((await (await api(`/api/analysis/${queued.id}`)).json()).attempts,0);
    const next = await (await api(`/api/snapshots/${newer.snapshotId}/analysis`,undefined,{})).json();
    const active = await qa.claim(); assert.equal(active!.id,next.id);
    const latest = await upload(second.sessionId,'最终合成输入');
    await api(`/api/analysis/${active!.id}`); // reconcile generation, while old running may finish as history
    assert.equal(await qa.finish(active!,{items:[],fixture:true,usage:{inputTokens:null,outputTokens:null,runtimeCostUsd:null,providerBilledCny:null,requests:0}}),true);
    const oldSuccess = await (await api(`/api/analysis/${active!.id}`)).json(); assert.equal(oldSuccess.state,'succeeded'); assert.equal(oldSuccess.applicable,false);
    const service = analysisService(db,archiveQuery(db,new RawStore(sandbox.env.RAW_DIRECTORY!)));
    const scheduled = await service.request(latest.snapshotId,null,{trigger:'scheduled'}); assert.equal(scheduled.actorKind,'system'); assert.equal(scheduled.actorId,null);
    await heartbeat('mixed','different'); assert.equal(await qa.claim(),null); await db.query("DELETE FROM analysis_workers WHERE id='mixed'");
    const owned = await qa.claim(); assert.equal(owned!.id,scheduled.id); await qa.finish(owned!,{items:[],fixture:true,usage:{inputTokens:null,outputTokens:null,runtimeCostUsd:null,providerBilledCny:null,requests:0}});
    assert.equal((await (await api(`/api/analysis/${owned!.id}`)).json()).applicable,true);
    const corrupt = await upload(undefined,'x',true);
    const rejected = await api(`/api/snapshots/${corrupt.snapshotId}/analysis`,undefined,{}); assert.equal(rejected.status,422); assert.match((await rejected.json()).error,/UTF-8/);
    assert.equal((await db.query('SELECT count(*)::int AS count FROM analysis_jobs WHERE snapshot_id=$1',[corrupt.snapshotId])).rows[0].count,0);
    assert.deepEqual(Buffer.from(await (await api(`/api/snapshots/${corrupt.snapshotId}/raw`)).arrayBuffer()),corrupt.bytes);
    assert.deepEqual(Buffer.from(await (await api(`/api/snapshots/${first.snapshotId}/raw`)).arrayBuffer()),first.bytes);
    assert.equal((await api('/api/sessions')).status,200);
    const ops = await (await api('/api/analysis/operations')).json(); assert.equal(ops.providerBilledCny,null); assert.equal(ops.budgets[0].reservedCny,'0');
    assert.ok(ops.runs.every((entry: any) => entry.result === null)); assert.ok(ops.runs.some((entry: any)=>entry.resultAvailable));
    await writeFile(join(sandbox.directory,'analysis-queue-evidence.json'),JSON.stringify({ops,oldSuccess,corruptBytesPreserved:true},null,2));
    console.log(`Queue evidence: ${sandbox.directory}`);
  } finally { await db.end(); await sandbox.close(); }
});
