import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createApp } from '../apps/server/app.js';
import { connect, digest } from '../apps/server/database.js';
import { createSandbox } from './support.js';

test('response report aggregates all source waits with explicit denominators and retains old versions after late parallel activity', { timeout: 120000 }, async () => {
  const sandbox = await createSandbox(), db = connect(sandbox.env.DATABASE_URL!);
  let app: Awaited<ReturnType<typeof createApp>> | undefined;
  try {
    const owner = await sandbox.provision('A 等待报表员工'), other = await sandbox.provision('Z 等待报表员工');
    const base = Date.now() + 86400000, time = (ms: number) => new Date(base + ms).toISOString();
    app = await createApp({ db, rawDirectory: sandbox.env.RAW_DIRECTORY!, reportClock: () => new Date(base + 7200000) });
    const api = (url: string, payload?: object | Buffer, credential = owner.readerCredential, method: 'GET'|'POST'|'PUT' = 'GET') => app!.inject({ method, url,
      headers: { Authorization: `Bearer ${credential}`, ...(Buffer.isBuffer(payload) ? { 'Content-Type':'application/octet-stream' } : {}) }, ...(payload === undefined ? {} : { payload }) });
    const enroll = async (employee: typeof owner) => (await api('/api/devices/enroll', {installationId: randomUUID(),name:'报表合成设备'},employee.enrollmentCredential,'POST')).json();
    const device = await enroll(owner), secondDevice = await enroll(other);
    const upload = async (target: any, durations: number[], project: string, unknown = false) => {
      const id=randomUUID(); let cursor=0;
      const message = (role:string,text:string,ms:number) => ({type:'response_item',timestamp:time(ms),payload:{type:'message',role,content:[{type:role==='user'?'input_text':'output_text',text}]}});
      const rows:unknown[]=[{type:'session_meta',payload:{id}},message('user','开始核查',cursor)];
      for(const [index,seconds] of durations.entries()) {
        rows.push({type:'event_msg',timestamp:time(cursor+1),payload:{type:'task_started',turn_id:`turn-${index}`}},message('assistant','本轮检查结果',cursor+5),
          {type:'event_msg',timestamp:time(cursor+10),payload:{type:'task_complete',turn_id:`turn-${index}`}});
        cursor+=10+seconds*1000; rows.push(message('user','继续核查',cursor));
      }
      if(unknown) rows.push({type:'event_msg',timestamp:time(cursor+1),payload:{type:'task_started',turn_id:'unknown'}},message('assistant','无可核验结束边界',cursor+2),message('user','未知等待',cursor+100));
      const bytes=Buffer.from(rows.map(row=>JSON.stringify(row)).join('\n')+'\n');
      assert.ok([200,201].includes((await api('/api/chunks/'+digest(bytes),bytes,target.deviceCredential,'PUT')).statusCode));
      const response=await api('/api/snapshots',{protocolVersion:1,sourceSessionId:id,source:'codex-cli',sourceVersion:'0.160.0',sourceOs:process.platform,project,hash:digest(bytes),byteLength:bytes.length,qualifiedAt:time(0),capability:'unverified'},target.deviceCredential,'POST');
      assert.equal(response.statusCode,200,response.body); return response.json().snapshotId;
    };
    await upload(device,[60,120,600,1200],'/synthetic/wait-report',true);
    await upload(secondDevice,[30],'/synthetic/other-employee');
    const query=new URLSearchParams({period:'since-enrollment',employeeId:owner.employeeId,source:'codex-cli',project:'/synthetic/wait-report'});
    assert.equal((await api('/api/wait-report?'+query,undefined,device.deviceCredential)).statusCode,401);
    const response=await api('/api/wait-report?'+query); assert.equal(response.statusCode,200,response.body);
    const first=response.json();
    assert.equal(first.summary.medianMs,360000); assert.equal(first.summary.p90Ms,1200000);
    assert.deepEqual(first.summary.longFraction,{numerator:2,denominator:4,value:0.5});
    assert.deepEqual(first.summary.parallelFraction,{numerator:0,denominator:4,value:0});
    assert.equal(first.summary.knownCount,4); assert.equal(first.summary.unknownCount,1);
    assert.equal(first.summary.permissionMedianMs,null); assert.equal(first.permissions.state,'unknown'); assert.deepEqual(first.permissions.requests,[]);
    assert.deepEqual(first.people.map((row:any)=>row.employee),['A 等待报表员工']);
    assert.equal(first.heatmap.reduce((n:number,cell:any)=>n+cell.count,0),4);
    assert.ok(first.heatmap.filter((cell:any)=>cell.count===0).every((cell:any)=>cell.medianMs===null));
    const frozen=new URLSearchParams({...Object.fromEntries(query),version:first.version});
    assert.deepEqual((await api('/api/wait-report/export?'+frozen)).json(),first);
    // A later uploaded, different-project source event overlaps the first wait.
    await upload(device,[1],'/synthetic/parallel-project');
    const current=(await api('/api/wait-report?'+query)).json();
    assert.notEqual(current.version,first.version);assert.equal(current.summary.parallelFraction.numerator,1);
    assert.deepEqual((await api('/api/wait-report?'+frozen)).json(),first);
    const all=(await api('/api/wait-report?period=since-enrollment')).json();
    assert.deepEqual(all.people.map((row:any)=>row.employee),['A 等待报表员工','Z 等待报表员工']);
    assert.equal((await api('/api/wait-report?period=this-week&version='+first.version)).statusCode,400);
  } finally {await app?.close();await db.end();await sandbox.close();}
});
