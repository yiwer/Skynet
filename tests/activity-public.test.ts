import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createApp } from '../apps/server/app.js';
import { connect, digest } from '../apps/server/database.js';
import { createSandbox } from './support.js';

test('activity reads source-day original messages once across snapshots, filters and preserves exact conversation anchors', { timeout: 120000 }, async () => {
  const sandbox = await createSandbox(), db = connect(sandbox.env.DATABASE_URL!);
  let app: Awaited<ReturnType<typeof createApp>> | undefined;
  try {
    const employee = await sandbox.provision('活动甲');
    const base = new Date(); base.setUTCDate(base.getUTCDate() + 1); base.setUTCHours(2, 0, 0, 0);
    const time = (seconds: number) => new Date(+base + seconds * 1000).toISOString(), date = time(0).slice(0, 10);
    app = await createApp({ db, rawDirectory: sandbox.env.RAW_DIRECTORY!, reportClock: () => new Date(+base + 3600000) });
    const api = (url: string, payload?: object | Buffer, credential = employee.readerCredential, method: 'GET'|'POST'|'PUT' = 'GET') => app!.inject({ method, url,
      headers: { Authorization: `Bearer ${credential}`, ...(Buffer.isBuffer(payload) ? { 'Content-Type': 'application/octet-stream' } : {}) }, ...(payload === undefined ? {} : { payload }) });
    const device = (await api('/api/devices/enroll', { installationId: randomUUID(), name: '活动合成设备' }, employee.enrollmentCredential, 'POST')).json();
    const sessionId = randomUUID();
    const message = (role: string, text: string, seconds: number) => ({ type: 'response_item', timestamp: time(seconds), payload: { type: 'message', id: randomUUID(), role, content: [{ type: role === 'user' ? 'input_text' : 'output_text', text }] } });
    const prompt = '请核对😀原文锚点。' + '约束须完整保留。'.repeat(45);
    const rows = [{ type: 'session_meta', timestamp: time(0), payload: { id: sessionId } }, message('user', '<environment_context>machine</environment_context>', 0),
      message('user', prompt, 1), message('assistant', '已读取原始材料。', 2)];
    const upload = async (records: unknown[]) => {
      const raw = Buffer.from(records.map(row => JSON.stringify(row)).join('\n') + '\n');
      assert.ok([200,201].includes((await api('/api/chunks/' + digest(raw), raw, device.deviceCredential, 'PUT')).statusCode));
      const saved = await api('/api/snapshots', { protocolVersion: 1, sourceSessionId: sessionId, source: 'codex-cli', sourceVersion: '0.160.0', sourceOs: process.platform,
        project: '/activity/known', hash: digest(raw), byteLength: raw.length, qualifiedAt: time(0), capability: 'unverified' }, device.deviceCredential, 'POST');
      assert.equal(saved.statusCode, 200, saved.body); return saved.json().snapshotId as string;
    };
    const snapshotId = await upload(rows);
    assert.equal((await api('/api/activity?date=' + date, undefined, device.deviceCredential)).statusCode, 401);
    const response = await api('/api/activity?date=' + date); assert.equal(response.statusCode, 200, response.body);
    const first = response.json();
    assert.deepEqual(first.events.filter((e:any) => ['prompt','reply'].includes(e.type)).map((e:any) => [e.type,e.timestamp,e.employee,e.project]), [
      ['prompt',time(1),'活动甲','/activity/known'],['reply',time(2),'活动甲','/activity/known']]);
    const original = first.events.find((e:any) => e.type === 'prompt');
    assert.equal(original.excerpt.endsWith('…'),true); assert.equal(original.truncated,true); assert.equal(original.evidence.line,3);
    assert.equal(original.evidence.snapshotId,snapshotId); assert.equal(original.backfill,'unknown');
    const conversation = await api(`/api/snapshots/${snapshotId}/conversation?line=3&block=0&textOffset=0`);
    assert.equal(conversation.statusCode,200,conversation.body); assert.equal(conversation.json().messages.find((e:any)=>e.line===3).text,prompt);
    await upload([...rows,message('user','新一轮请求',60)]);
    const latest = (await api('/api/activity?date=' + date)).json(); assert.notEqual(latest.version,first.version);
    assert.equal(latest.events.filter((e:any)=>e.type==='prompt').length,2); assert.equal(latest.events.filter((e:any)=>e.type==='reply').length,1);
    assert.deepEqual((await api(`/api/activity?date=${date}&version=${first.version}`)).json(),first);
    const filtered = (await api(`/api/activity?date=${date}&employeeId=${employee.employeeId}&source=codex-cli&project=%2Factivity%2Fknown&type=reply`)).json();
    assert.equal(filtered.total,1); assert.equal(filtered.events[0].excerpt,'已读取原始材料。');
    const empty = (await api(`/api/activity?date=${date}&project=missing`)).json(); assert.equal(empty.total,0);
    assert.equal((await api(`/api/activity?date=${date}&offset=25`)).statusCode,400);
    assert.deepEqual((await api('/api/activity/recompute', { date }, employee.readerCredential,'POST')).json(),latest);
  } finally { await app?.close(); await db.end(); await sandbox.close(); }
});

test('activity and lanes share native turn boundaries and long waits; session ends and offline backfill require actual source evidence', {timeout:120000},async()=>{
  const sandbox=await createSandbox(),db=connect(sandbox.env.DATABASE_URL!);let app:Awaited<ReturnType<typeof createApp>>|undefined;
  try{
    const employee=await sandbox.provision('活动乙'),base=new Date();base.setUTCDate(base.getUTCDate()+1);base.setUTCHours(15,59,0,0);
    const time=(ms:number)=>new Date(+base+ms).toISOString(),date=time(0).slice(0,10);
    app=await createApp({db,rawDirectory:sandbox.env.RAW_DIRECTORY!,reportClock:()=>new Date(+base+3600000)});
    const api=(url:string,payload?:object|Buffer,credential=employee.readerCredential,method:'GET'|'POST'|'PUT'='GET')=>app!.inject({method,url,headers:{Authorization:`Bearer ${credential}`,...(Buffer.isBuffer(payload)?{'Content-Type':'application/octet-stream'}:{})},...(payload===undefined?{}:{payload})});
    const device=(await api('/api/devices/enroll',{installationId:randomUUID(),name:'边界设备'},employee.enrollmentCredential,'POST')).json(),sessionId=randomUUID();
    const msg=(role:string,text:string,ms:number)=>({type:'response_item',timestamp:time(ms),payload:{type:'message',id:randomUUID(),role,content:[{type:role==='user'?'input_text':'output_text',text}]}});
    const native=(type:string,ms:number)=>({type:'event_msg',timestamp:time(ms),payload:{type,turn_id:'one'}});
    const rows=[{type:'session_meta',timestamp:time(-1000),payload:{id:sessionId,timestamp:time(-1000)}},msg('user','开始一个会话',0),native('task_started',1),
      msg('assistant','本轮已结束，之后继续',999),native('task_complete',1000),msg('user','十分钟后继续',601000),{type:'compacted',timestamp:time(602000),payload:{message:'压缩完成'}}];
    const uploadId=randomUUID(),raw=Buffer.from(rows.map(row=>JSON.stringify(row)).join('\n')+'\n');
    await api('/api/chunks/'+digest(raw),raw,device.deviceCredential,'PUT');
    const response=await app.inject({method:'POST',url:'/api/snapshots',headers:{Authorization:`Bearer ${device.deviceCredential}`,'Idempotency-Key':uploadId},payload:{protocolVersion:1,sourceSessionId:sessionId,source:'codex-cli',sourceVersion:'0.160.0',sourceOs:process.platform,project:'/activity/boundaries',hash:digest(raw),byteLength:raw.length,qualifiedAt:time(0),capability:'unverified'}});
    assert.equal(response.statusCode,200,response.body);const snapshotId=response.json().snapshotId;
    const firstResponse=await api('/api/activity?date='+date);assert.equal(firstResponse.statusCode,200,firstResponse.body);const first=firstResponse.json();
    assert.deepEqual(first.events.map((e:any)=>e.type),['session-start','prompt','turn-start','reply','turn-end','long-wait']);
    const wait=first.events.find((e:any)=>e.type==='long-wait');assert.equal(wait.durationMs,600000);assert.equal(wait.evidence.line,5);assert.equal(wait.endEvidence.line,6);
    assert.equal(first.lanes[0].segments.find((e:any)=>e.kind==='wait').durationInScopeMs,59000);
    assert.equal(first.lanes[0].sessions[0].endBoundary,'unknown');assert.equal(first.lanes[0].sessions[0].state,'waiting-input');
    assert.equal(first.coverage.permission,'unknown');assert.equal(first.events.some((e:any)=>e.type==='session-end'||e.type==='offline'||e.type==='backfill'),false);
    const following=new Date(Date.parse(date+'T00:00:00Z')+86400000).toISOString().slice(0,10);
    const next=(await api('/api/activity?date='+following)).json();
    assert.deepEqual(next.events.map((e:any)=>e.type),['long-wait','prompt','compaction']);
    assert.equal(next.lanes[0].segments.find((e:any)=>e.kind==='wait').durationInScopeMs,541000);
    assert.equal(next.events.find((e:any)=>e.type==='prompt').backfill,'unknown');
    const receipt=await api('/api/delivery/receipts',{uploadId,snapshotId,capturedAt:time(0),acknowledgedAt:time(700000),disconnectedAttempts:2,firstDisconnectedAt:time(2000),lastDisconnectedAt:time(5000)},device.deviceCredential,'POST');
    assert.equal(receipt.statusCode,200,receipt.body);
    const observed=(await api('/api/activity?date='+date)).json();assert.notEqual(observed.version,first.version);
    assert.equal(observed.events.find((e:any)=>e.type==='prompt').backfill,'observed');assert.equal(observed.events.filter((e:any)=>e.type==='offline').length,1);
    assert.deepEqual((await api(`/api/activity?date=${date}&version=${first.version}`)).json(),first);
    const exported=(await api(`/api/activity/export?date=${date}&version=${observed.version}`)).json();assert.deepEqual(exported,observed);
  }finally{await app?.close();await db.end();await sandbox.close();}
});
