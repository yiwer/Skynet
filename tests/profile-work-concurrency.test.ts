import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {randomUUID} from 'node:crypto';
import {assessmentFixture} from './assessment-fixture.js';
import {beijingDate} from '../packages/contracts/reports.js';
import {monday,addDays} from '../packages/contracts/work-views.js';

// Schedule real public mutations immediately after the work-date SELECT has
// established its database snapshot. No query or service result is replaced.
function workReadGate(action:()=>Promise<void>){
  const original=pg.Client.prototype.query;
  pg.Client.prototype.query=function(this:pg.Client,...args:any[]){
    const sql=typeof args[0]==='string'?args[0]:args[0]?.text;
    if(sql!=='SELECT date FROM daily_report_periods WHERE employee_id=$1 AND date BETWEEN $2 AND $3 ORDER BY date')return (original as any).apply(this,args);
    const callback=args.at(-1);
    if(typeof callback==='function'){
      args[args.length-1]=(error:unknown,result:unknown)=>{if(error)callback(error);else void action().then(()=>callback(null,result),callback);};
      return (original as any).apply(this,args);
    }
    return (original as any).apply(this,args).then(async(result:unknown)=>{await action();return result;});
  } as any;
  return ()=>{pg.Client.prototype.query=original;};
}

test('profile work freezes one daily and weekly snapshot while same-original refreshes remain pending',{timeout:120000},async()=>{
  const f=await assessmentFixture(),held=await f.testDatabase.connect();let restore=()=>{};
  try{
    f.now.setTime(Date.now()+60000);
    const owner=await f.owner('同源刷新画像'),date=beijingDate(f.now),week=monday(date);
    const daily='/api/daily-reports/'+owner.employeeId+'/'+date,weekly='/api/work-view?'+new URLSearchParams({kind:'weekly',subject:owner.employeeId,from:week,to:addDays(week,6)});
    for(const path of [daily,weekly]){const r=await f.api(owner,path,{});assert.equal(r.status,202,await r.clone().text());}
    const path='/api/capability-profiles/'+owner.employeeId;
    const firstResponse=await f.api(owner,path);assert.equal(firstResponse.status,200,await firstResponse.clone().text());const first=await firstResponse.json();
    assert.ok(first.work.reports.some((row:any)=>row.kind==='daily'));assert.ok(first.work.reports.some((row:any)=>row.kind==='weekly'));
    assert.ok(first.work.reports.every((row:any)=>row.refreshPending===false));
    await held.query('SELECT pg_advisory_lock(7402128),pg_advisory_lock(7402131),pg_advisory_lock(7402129)');
    let reached=false;
    restore=workReadGate(async()=>{reached=true;for(const p of [daily,weekly]){const r=await f.api(owner,p,{});assert.equal(r.status,202,await r.clone().text());}});
    const response=await f.api(owner,path);restore();assert.equal(reached,true);
    assert.equal(response.status,200,await response.clone().text());const during=await response.json();
    assert.deepEqual(during,first,'both work views retain the snapshot taken before the pending refresh');
    const afterResponse=await f.api(owner,path);assert.equal(afterResponse.status,200,await afterResponse.clone().text());const after=await afterResponse.json();
    assert.ok(after.work.reports.every((row:any)=>row.refreshPending===true));assert.notEqual(after.version,first.version);
    assert.equal(after.frontierVersion,first.frontierVersion,'derived preparation is not an original change');
    assert.deepEqual(after.kpis,first.kpis);assert.deepEqual(after.assessment,first.assessment);
    assert.deepEqual(await(await f.api(owner,path+'?version='+first.version)).json(),first);
    assert.deepEqual(await(await f.api(owner,path+'/recompute',{})).json(),after);
  }finally{restore();await held.query('SELECT pg_advisory_unlock_all()');held.release();await f.close();}
});

test('a profile still refuses continuously changing originals and keeps its fixed history',{timeout:120000},async()=>{
  const f=await assessmentFixture();let restore=()=>{};
  try{
    f.now.setTime(Date.now()+60000);f.base.setTime(f.now.getTime()-10000);
    const owner=await f.owner('原件交错画像'),path='/api/capability-profiles/'+owner.employeeId;
    const firstResponse=await f.api(owner,path);assert.equal(firstResponse.status,200,await firstResponse.clone().text());const first=await firstResponse.json();
    let uploads=0;
    restore=workReadGate(async()=>{const original=f.rows({prompts:1});await f.upload(owner,original.rows,original.sessionId);uploads++;});
    const response=await f.api(owner,path);restore();assert.ok(uploads>0);
    assert.equal(response.status,409);assert.match((await response.json()).error,/报告来源正在更新/);
    assert.deepEqual(await(await f.api(owner,path+'?version='+first.version)).json(),first);
    const currentResponse=await f.api(owner,path);assert.equal(currentResponse.status,200,await currentResponse.clone().text());const current=await currentResponse.json();
    assert.equal(current.kpis.sessions,uploads);assert.notEqual(current.frontierVersion,first.frontierVersion);
  }finally{restore();await f.close();}
});

test('real report corrections invalidate a work snapshot without rewriting older profile reports',{timeout:120000},async()=>{
  const f=await assessmentFixture(),held=await f.testDatabase.connect();let restore=()=>{};
  try{
    f.now.setTime(Date.now()+60000);
    const owner=await f.owner('更正交错画像'),date=beijingDate(f.now),daily='/api/daily-reports/'+owner.employeeId+'/'+date;
    const ready=await f.api(owner,daily,{});assert.equal(ready.status,202,await ready.clone().text());
    await held.query('SELECT pg_advisory_lock(7402129),pg_advisory_lock(7402131)');
    const path='/api/capability-profiles/'+owner.employeeId,firstResponse=await f.api(owner,path);
    assert.equal(firstResponse.status,200,await firstResponse.clone().text());const first=await firstResponse.json();
    let corrected=false,latestRevision=(await ready.json()).revision;
    restore=workReadGate(async()=>{
      if(corrected)return;
      corrected=true;
      const current=await(await f.api(owner,daily)).json();
      const response=await f.api(owner,daily+'/corrections',{requestId:randomUUID(),expectedRevision:current.revision,kind:'note',reason:'核对同一原件后补记',note:'受控并发复核说明'});
      assert.equal(response.status,202,await response.clone().text());latestRevision=(await response.json()).revision;
    });
    const response=await f.api(owner,path);restore();assert.equal(corrected,true);assert.equal(response.status,200,await response.clone().text());const after=await response.json();
    assert.notEqual(after.frontierVersion,first.frontierVersion,'an actual correction remains part of the source guard');
    assert.ok(latestRevision>first.work.reports.find((row:any)=>row.kind==='daily').revision);
    assert.equal(after.work.reports.find((row:any)=>row.kind==='daily').revision,latestRevision,'a correction committed during the snapshot triggers a new coherent read');
    assert.deepEqual(after.kpis,first.kpis);
    assert.deepEqual(await(await f.api(owner,path+'?version='+first.version)).json(),first);
  }finally{restore();await held.query('SELECT pg_advisory_unlock_all()');held.release();await f.close();}
});
