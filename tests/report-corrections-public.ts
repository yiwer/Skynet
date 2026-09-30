import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {expect} from '@playwright/test';
import {type WorkViewsExtension,findings,workViewsPublic} from './work-views-public.js';
import {executeAnalysis} from '../apps/analysis/execute.js';
import {addDays} from '../packages/contracts/work-views.js';

const correctionTrace:WorkViewsExtension=async({sandbox,alpha,beta,original,sunday,nextMonday,tuesday,week,project,previous,client,page,drain,queue,config,native})=>{
  const json=(value:unknown)=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});
  const api=(path:string,body?:unknown)=>sandbox.api(path,beta.readerCredential,body===undefined?undefined:json(body));
  const dayPath=`/api/daily-reports/${alpha.employeeId}/${sunday}`;let day=await(await api(dayPath)).json();
  const fixedDay=await(await api(dayPath+`?revision=${day.revision}`)).text();
  const weeklyPath='/api/work-view?'+new URLSearchParams({kind:'weekly',subject:alpha.employeeId,from:week,to:addDays(week,6)});
  const fixedWeek=await(await api(weeklyPath+`&revision=${previous.revision}`)).text();
  const projectPath='/api/work-view?'+new URLSearchParams({kind:'project',subject:'/synthetic/shared-weekly',from:sunday,to:tuesday});
  const fixedProject=await(await api(projectPath+`&revision=${project.revision}`)).text();
  const eventIds=[...new Set<string>(day.items.filter((item:any)=>item.project==='/synthetic/shared-weekly').flatMap((item:any)=>item.activityEventIds))];
  const themeBody={requestId:randomUUID(),kind:'theme',expectedRevision:day.revision,reason:'更正跨日主题误归类',theme:'人工确认工作主题',eventIds};
  assert.equal((await api(dayPath+'/corrections',{...themeBody,eventIds:['forged-event-id']})).status,422);
  assert.equal((await api(dayPath+'/corrections',{...themeBody,actorId:alpha.employeeId})).status,400);
  const response=await api(dayPath+'/corrections',themeBody);assert.equal(response.status,202,await response.clone().text());
  day=await response.json();
  const waitDay=async(path:string,predicate:(value:any)=>boolean)=>{for(let i=0;i<100;i++){await drain();const value=await(await api(path)).json();if(predicate(value))return value;await new Promise(resolve=>setTimeout(resolve,300));}throw new Error('Correction propagation timeout: '+path+' '+JSON.stringify(await(await api(path)).json()));};
  day=await waitDay(dayPath,value=>value.items.some((item:any)=>item.theme==='人工确认工作主题')&&!value.refreshPending);
  assert.ok(day.items.filter((item:any)=>item.theme==='人工确认工作主题').every((item:any)=>item.themeAssociation==='manual-correction'&&item.originalTheme==='共同主题跨日延续'));
  assert.equal(day.statistics.records,2);
  await page.goto(sandbox.origin+`/#daily?employeeId=${alpha.employeeId}&date=${sunday}`);
  const corrections=page.getByRole('region',{name:'分析更正',exact:true});await expect(corrections).toContainText('更正跨日主题误归类');
  await corrections.getByLabel('更正原因').fill('追加需单列的人工作说明');await corrections.getByLabel('追加说明').fill('人工说明不代表新活动或核验交付');await corrections.getByRole('button',{name:'保存说明并生成新版',exact:true}).click();
  await expect(corrections).toContainText('人工说明不代表新活动或核验交付');
  day=await waitDay(dayPath,value=>value.corrections?.some((item:any)=>item.kind==='note')&&!value.refreshPending);
  assert.equal(day.corrections[0].actorId,beta.employeeId);
  const updatedWeek=await waitDay(weeklyPath,value=>value.items?.some((item:any)=>item.theme==='人工确认工作主题')&&!value.refreshPending);
  const updatedProject=await waitDay(projectPath,value=>value.coverage?.days.some((ref:any)=>ref.employeeId===alpha.employeeId&&ref.date===sunday&&ref.revision>=day.revision)&&!value.refreshPending);
  const projectItems=[...updatedProject.items];let offset=updatedProject.nextOffset;
  while(offset!==null){const more=await(await api(projectPath+`&revision=${updatedProject.revision}&offset=${offset}`)).json();projectItems.push(...more.items);offset=more.nextOffset;}
  assert.ok(projectItems.some((item:any)=>item.theme==='人工确认工作主题'),'correction remains visible after following fixed-version pagination');
  assert.equal(updatedWeek.statistics.records,2);assert.equal(updatedProject.statistics.records,5);
  assert.ok(updatedWeek.corrections.some((item:any)=>item.kind==='note'));
  const history=await client.callTool({name:'read_report_corrections',arguments:{employeeId:alpha.employeeId,date:sunday}});assert.notEqual(history.isError,true);
  assert.equal(JSON.parse((history.content as {text:string}[])[0]!.text).corrections.length,2);
  // Reclassify a genuinely unclassified project's known activity for display only.
  const unclassifiedDayPath=`/api/daily-reports/${alpha.employeeId}/${nextMonday}`;let emptyDay=await(await api(unclassifiedDayPath)).json();const fixedEmptyDay=await(await api(unclassifiedDayPath+`?revision=${emptyDay.revision}`)).text();
  const emptyPath='/api/work-view?'+new URLSearchParams({kind:'project',subject:'',from:nextMonday,to:tuesday});const emptyBefore=await(await api(emptyPath)).json();const fixedEmptyProject=await(await api(emptyPath+`&revision=${emptyBefore.revision}`)).text();
  const ids=[...new Set<string>(emptyDay.items.filter((item:any)=>item.project==='').flatMap((item:any)=>item.activityEventIds))];assert.equal(ids.length,1);
  const displayProject='/human/confirmed-project';const newPath='/api/work-view?'+new URLSearchParams({kind:'project',subject:displayProject,from:nextMonday,to:tuesday});await api(newPath,{});
  const projectBody={requestId:randomUUID(),kind:'project',expectedRevision:emptyDay.revision,reason:'原件没有项目字段，人工确认显示项目',project:displayProject,eventIds:ids};
  assert.equal((await api(unclassifiedDayPath+'/corrections',projectBody)).status,202);
  emptyDay=await waitDay(unclassifiedDayPath,value=>value.items.some((item:any)=>item.project===displayProject)&&!value.refreshPending);
  assert.equal(emptyDay.statistics.records,2);assert.equal(emptyDay.coverage.projectStatistics.find((entry:any)=>entry.project===displayProject).records,1);
  assert.ok(emptyDay.items.filter((item:any)=>item.project===displayProject).every((item:any)=>item.originalProject===''&&item.citations.every((citation:any)=>citation.origin.project==='')));
  const reclassifiedProject=await waitDay(newPath,value=>value.statistics?.records===1&&value.items.length&&!value.refreshPending);
  const emptied=await waitDay(emptyPath,value=>value.items.length===0&&!value.refreshPending);
  assert.equal(emptied.statistics.records,null,'no eligible input remains in unclassified display project');
  const secondWeekPath='/api/work-view?'+new URLSearchParams({kind:'weekly',subject:alpha.employeeId,from:nextMonday,to:addDays(nextMonday,6)});
  const reclassifiedWeek=await waitDay(secondWeekPath,value=>value.items?.some((item:any)=>item.project===displayProject)&&!value.refreshPending);assert.equal(reclassifiedWeek.statistics.records,3);
  assert.ok((await(await api('/api/work-projects')).json()).projects.some((entry:any)=>entry.project===displayProject));
  const correctedMcp=await client.callTool({name:'read_work_view',arguments:{kind:'project',subject:displayProject,from:nextMonday,to:tuesday,revision:reclassifiedProject.revision}});assert.notEqual(correctedMcp.isError,true);
  assert.deepEqual(JSON.parse((correctedMcp.content as {text:string}[])[0]!.text),{...reclassifiedProject,refreshPending:false});
  await page.goto(sandbox.origin+'/#work?'+new URLSearchParams({kind:'project',subject:displayProject,from:nextMonday,to:tuesday,revision:String(reclassifiedProject.revision)}));
  const workPanel=page.getByRole('region',{name:'周工作与项目',exact:true});await expect(workPanel).toContainText('来源项目：未归类项目');await workPanel.getByRole('link',{name:/核查原句/}).first().click();await expect(page.getByRole('region',{name:'命中证据',exact:true})).toContainText('未归类项目');
  // Force one new analysis generation; a claimed predecessor is retained, never current.
  day=await(await api(dayPath)).json();const oldRuns=await(await api(`/api/snapshots/${original.snapshotId}/analysis`)).json();
  const reanalyze={requestId:randomUUID(),kind:'reanalyze',expectedRevision:day.revision,reason:'以最新适用原件重新分析'};assert.equal((await api(dayPath+'/corrections',reanalyze)).status,202);
  let predecessor;
  if(!native){for(let i=0;i<30&&!predecessor;i++){const claimed=await queue.claim();if(claimed?.input.snapshotId===original.snapshotId)predecessor=claimed;else if(claimed){const result=await executeAnalysis(config,claimed.input,new AbortController().signal,()=>queue.allowForward(claimed),async(_config,input)=>({output:findings(input),usage:{inputTokens:100,outputTokens:20,requests:1,runtimeCostUsd:null,providerBilledCny:null}}));await queue.finish(claimed,result);}else await new Promise(resolve=>setTimeout(resolve,200));}assert.ok(predecessor);
    const result=await executeAnalysis(config,predecessor.input,new AbortController().signal,()=>queue.allowForward(predecessor!),async(_config,input)=>({output:findings(input),usage:{inputTokens:100,outputTokens:20,requests:1,runtimeCostUsd:null,providerBilledCny:null}}));
    for(let i=0;i<40;i++){day=await(await api(dayPath)).json();if(day.corrections?.some((value:any)=>value.id===reanalyze.requestId))break;await queue.renew(predecessor);await new Promise(resolve=>setTimeout(resolve,200));}
    assert.ok(day.corrections.some((value:any)=>value.id===reanalyze.requestId),'first recomputation publishes its waiting version before another edit');
    assert.equal((await api(dayPath+'/corrections',{...reanalyze,requestId:randomUUID(),expectedRevision:day.revision,reason:'并发第二次重算使前一次过期'})).status,202);
    assert.equal(await queue.allowForward(predecessor),false);
    await queue.finish(predecessor,result);
  }
  const recomputed=await waitDay(dayPath,value=>value.items.length&&!value.refreshPending&&!['waiting-analysis','queued'].includes(value.state));assert.ok(recomputed.corrections.some((entry:any)=>entry.kind==='reanalyze'));
  const currentRuns=await(await api(`/api/snapshots/${original.snapshotId}/analysis`)).json();assert.ok(currentRuns.runs.length>oldRuns.runs.length);
  if(predecessor){const late=currentRuns.runs.find((run:any)=>run.id===predecessor.id);assert.equal(late.applicable,false);assert.ok(recomputed.coverage.inputs.every((input:any)=>input.analysisId!==predecessor.id));}
  assert.equal(await(await api(dayPath+`?revision=${JSON.parse(fixedDay).revision}`)).text(),fixedDay);assert.equal(await(await api(weeklyPath+`&revision=${previous.revision}`)).text(),fixedWeek);assert.equal(await(await api(projectPath+`&revision=${project.revision}`)).text(),fixedProject);
  assert.equal(await(await api(unclassifiedDayPath+`?revision=${JSON.parse(fixedEmptyDay).revision}`)).text(),fixedEmptyDay);assert.equal(await(await api(emptyPath+`&revision=${emptyBefore.revision}`)).text(),fixedEmptyProject);
  assert.deepEqual(Buffer.from(await(await api(`/api/snapshots/${original.snapshotId}/raw`)).arrayBuffer()),original.bytes);
  await sandbox.restart();assert.equal(await(await api(dayPath+`?revision=${JSON.parse(fixedDay).revision}`)).text(),fixedDay);
  return {updatedWeek,updatedProject,reclassifiedProject,reclassifiedWeek,emptied,recomputed,currentRuns,oldVersionsByteIdentical:true,rawBytesIdentical:true,provider:'synthetic only'};
};
export const reportCorrectionsPublic=(native:boolean)=>workViewsPublic(native,correctionTrace);
