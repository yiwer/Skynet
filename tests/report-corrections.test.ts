import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createSandbox } from './support.js';
import { beijingDate } from '../packages/contracts/reports.js';
import {digest} from '../apps/server/database.js';
import {monday,addDays} from '../packages/contracts/work-views.js';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';

test('authenticated day explanation records actor/reason and preserves fixed report across conflicting edits/restart', { timeout: 60000 }, async () => {
  const sandbox=await createSandbox();
  try {
    let origin=await sandbox.startServer();const employee=await sandbox.provision('合成更正员工');const reviewer=await sandbox.provision('合成更正者');
    const api=(path:string,body?:unknown,token=reviewer.readerCredential)=>fetch(origin+path,{headers:{Authorization:`Bearer ${token}`,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{method:'POST',body:JSON.stringify(body)})});
    await api('/api/devices/enroll',{installationId:randomUUID(),name:'correction synthetic'},employee.enrollmentCredential);
    const path=`/api/daily-reports/${employee.employeeId}/${beijingDate()}`;
    const before=await(await api(path,{})).json();assert.ok(before.revision>0);const fixed=await(await api(path+`?revision=${before.revision}`)).text();
    const body={requestId:randomUUID(),kind:'note',expectedRevision:before.revision,reason:'补充自动分析无法看到的说明',note:'本日没有原件活动；此说明不作为活动或交付证明。'};
    const response=await api(path+'/corrections',body);assert.equal(response.status,202,await response.clone().text());
    assert.equal((await fetch(origin+path+'/corrections',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})).status,401);
    const current=await response.json();assert.ok(current.revision>before.revision);assert.equal(current.statistics.records,0);
    assert.equal(current.corrections[0].actorId,reviewer.employeeId);assert.equal(current.corrections[0].reason,body.reason);assert.equal(current.corrections[0].note,body.note);assert.ok(current.corrections[0].createdAt);
    assert.equal((await api(path+'/corrections',{...body,requestId:randomUUID(),note:'冲突的过期更正'})).status,409);
    assert.equal((await api(path+'/corrections',body)).status,202,'same operation replay retains one immutable correction');
    assert.equal(await(await api(path+`?revision=${before.revision}`)).text(),fixed);
    const history=await(await api(path+'/corrections')).json();assert.equal(history.corrections.length,1);assert.equal(history.corrections[0].actorId,reviewer.employeeId);
    await sandbox.stopServer();origin=await sandbox.startServer();assert.equal((await(await api(path)).json()).corrections[0].note,body.note);
    assert.equal(await(await api(path+`?revision=${before.revision}`)).text(),fixed);
    await writeFile(join(sandbox.directory,'correction-history-evidence.json'),JSON.stringify({before,current,history,fixedOldTextUnchanged:true,provider:'synthetic; no model call'},null,2));console.log(`Correction history evidence: ${sandbox.directory}`);
  } finally {await sandbox.close();}
});

test('late original activity automatically revises existing day/week/project without importing pre-enrollment dates',{timeout:65000},async()=>{
  const sandbox=await createSandbox();
  try{
    const origin=await sandbox.startServer();const employee=await sandbox.provision('合成迟到员工');
    const api=(path:string,token=employee.readerCredential,body?:unknown)=>fetch(origin+path,{headers:{Authorization:`Bearer ${token}`,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{method:'POST',body:JSON.stringify(body)})});
    const device=await(await api('/api/devices/enroll',employee.enrollmentCredential,{installationId:randomUUID(),name:'late synthetic'})).json();const date=beijingDate();const path=`/api/daily-reports/${employee.employeeId}/${date}`;
    const before=await(await api(path,employee.readerCredential,{})).json();assert.equal(before.statistics.records,0);const fixed=await(await api(path+`?revision=${before.revision}`)).text();
    const projectPath='/api/work-view?'+new URLSearchParams({kind:'project',subject:'/late/source',from:date,to:date});const week=monday(date);
    const weekPath='/api/work-view?'+new URLSearchParams({kind:'weekly',subject:employee.employeeId,from:week,to:addDays(week,6)});
    const beforeProject=await(await api(projectPath,employee.readerCredential,{})).json();const beforeWeek=await(await api(weekPath,employee.readerCredential,{})).json();
    const fixedProject=await(await api(projectPath+`&revision=${beforeProject.revision}`)).text();const fixedWeek=await(await api(weekPath+`&revision=${beforeWeek.revision}`)).text();
    const sessionId=randomUUID();const timestamp=new Date(Date.now()+10).toISOString();const bytes=Buffer.from([
      {type:'session_meta',payload:{id:sessionId,cli_version:'0.157.1',cwd:'/late/source'}},
      {timestamp:'2020-01-01T00:00:00Z',type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:'原旧背景'}]}},
      {timestamp,type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:'接入后迟到原活动'}]}}
    ].map(row=>JSON.stringify(row)).join('\n')+'\n');const hash=digest(bytes);
    assert.equal((await fetch(origin+'/api/chunks/'+hash,{method:'PUT',headers:{Authorization:`Bearer ${device.deviceCredential}`,'Content-Type':'application/octet-stream'},body:bytes})).status,201);
    const commit=await api('/api/snapshots',device.deviceCredential,{protocolVersion:1,source:'codex-cli',sourceVersion:'0.157.1',sourceOs:'win32',sourceSessionId:sessionId,project:'/late/source',hash,byteLength:bytes.length,qualifiedAt:timestamp,capability:'unverified'});assert.equal(commit.status,200);const committed=await commit.json();
    let current=before;const deadline=Date.now()+16000;
    while(current.statistics.records!==1&&Date.now()<deadline){await new Promise(resolve=>setTimeout(resolve,200));current=await(await api(path)).json();}
    assert.equal(current.statistics.records,1,'late arrival automatically invalidates already-ready daily input');assert.ok(current.revision>before.revision);
    const views=[];for(const viewPath of [projectPath,weekPath]){let view=await(await api(viewPath)).json();const end=Date.now()+16000;while(view.statistics?.records!==1&&Date.now()<end){await new Promise(resolve=>setTimeout(resolve,200));view=await(await api(viewPath)).json();}assert.equal(view.statistics?.records,1,'late arrival discovers new eligible project/day inputs without another POST: '+viewPath);views.push(view);}
    assert.equal(await(await api(path+`?revision=${before.revision}`)).text(),fixed);
    assert.equal(await(await api(projectPath+`&revision=${beforeProject.revision}`)).text(),fixedProject);assert.equal(await(await api(weekPath+`&revision=${beforeWeek.revision}`)).text(),fixedWeek);
    const periods=await(await api('/api/daily-reports')).json();assert.ok(periods.reports.every((period:any)=>period.date!=='2020-01-01'));
    assert.deepEqual(Buffer.from(await(await api(`/api/snapshots/${committed.snapshotId}/raw`)).arrayBuffer()),bytes);
    await writeFile(join(sandbox.directory,'late-input-evidence.json'),JSON.stringify({before,beforeProject,beforeWeek,current,views,periods,sourceHash:hash,rawUnchanged:true,fixedOldResponsesUnchanged:true,provider:'synthetic; no model call'},null,2));console.log(`Late input evidence: ${sandbox.directory}`);
  }finally{await sandbox.close();}
});
