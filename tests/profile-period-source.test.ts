import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout} from 'node:timers/promises';
import {unlink,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {digest} from '../apps/server/database.js';
import {assessmentFixture} from './assessment-fixture.js';
import {monday,addDays} from '../packages/contracts/work-views.js';
import {beijingDate} from '../packages/contracts/reports.js';

test('a profile does not freeze a readable team baseline after its original disappears during final composition',{timeout:180000},async()=>{
  const f=await assessmentFixture(),held=await f.testDatabase.connect();let locked=false,restore:{path:string;bytes:Buffer}|undefined;
  let pending:Promise<Response>|undefined;
  try{
    const owner=await f.owner('Period source owner'),peer=await f.owner('Period baseline peer'),week=monday(beijingDate(f.now));
    f.now.setTime(Date.parse(addDays(week,4)+'T18:00:00+08:00'));
    async function recorded(person:typeof owner,date:string){
      const input=f.rows({prompts:3,tokens:1200}),shift=Date.parse(date+'T12:00:00+08:00')-f.base.getTime();
      for(const row of input.rows.slice(2) as {timestamp?:string}[])if(row.timestamp)row.timestamp=new Date(Date.parse(row.timestamp)+shift).toISOString();
      const saved=await f.upload(person,input.rows,input.sessionId);await f.analyze(person,saved.snapshotId);return saved;
    }
    await recorded(owner,week);const baseline=await recorded(peer,addDays(week,-14));
    const path='/api/capability-profiles/'+owner.employeeId+'?period=this-week';
    async function get(query:string){const response=await f.api(owner,query);assert.equal(response.status,200,await response.clone().text());return response.json();}
    const before=await get(path);assert.equal(before.kpis.sessions,1);assert.equal(before.assessment.sample.prompts,3);
    // Hold only the real final work-content read. No product result is mocked;
    // the failure and every frozen result are observed through public HTTP.
    await held.query('BEGIN; LOCK TABLE daily_report_periods IN ACCESS EXCLUSIVE MODE');locked=true;
    const pid=(await held.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    pending=f.api(owner,path);
    let reached=false;
    for(let tick=0;tick<500;tick++){
      reached=(await f.testDatabase.query("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid)) AND query LIKE 'SELECT date FROM daily_report_periods%') AS reached",[pid])).rows[0].reached;
      if(reached)break;await setTimeout(20);
    }
    assert.equal(reached,true,'the isolated final-composition gate must be reached');
    restore={path:join(f.directory,'raw',peer.deviceId,digest(baseline.bytes)),bytes:baseline.bytes};await unlink(restore.path);
    await held.query('COMMIT');locked=false;
    const response=await pending;pending=undefined;
    assert.ok([200,409].includes(response.status),await response.clone().text());
    const fresh=await get(path);assert.notEqual(fresh.assessment.inputs.baselineVersion,before.assessment.inputs.baselineVersion);
    if(response.status===200)assert.deepEqual(await response.json(),fresh,'a successful result must reflect the changed baseline source observation');
    assert.deepEqual(await get('/api/capability-profiles/'+owner.employeeId+'?version='+before.version),before);
    await writeFile(restore.path,restore.bytes);const recovered=await get(path);
    assert.deepEqual(recovered,before,'recovery returns to the original fixed profile');
  }finally{
    if(locked)await held.query('ROLLBACK');held.release();if(pending)await pending.catch(()=>undefined);
    if(restore)await writeFile(restore.path,restore.bytes);await f.close();
  }
});
