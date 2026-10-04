import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium,expect,type Browser} from '@playwright/test';
import {assessmentFixture} from './assessment-fixture.js';
import {beijingDate} from '../packages/contracts/reports.js';

test('dense recorded activity remains touch reachable with its exact original destination',{timeout:120000},async()=>{
  const f=await assessmentFixture();let browser:Browser|undefined;
  const directory=process.env.SKYNET_ACTIVITY_EFFICIENCY_EVIDENCE??join(f.directory,'activity-efficiency');await mkdir(directory,{recursive:true});
  try{
    const owner=await f.owner('活动触屏合成员工');
    for(const [index,offset] of [0,5000].entries()){
      const source=f.rows({prompts:1,verified:0,claimed:0});
      const rows=source.rows.map((value:any)=>({...value,...(value.timestamp?{timestamp:new Date(Date.parse(value.timestamp)+offset).toISOString()}:{}),
        ...(value.payload?.role==='user'?{payload:{...value.payload,content:value.payload.content.map((part:any)=>({...part,text:`会话${index+1} ${part.text}`}))}}:{})}));
      await f.upload(owner,rows,source.sessionId);
    }
    const date=beijingDate(f.base),response=await f.api(owner,'/api/activity?date='+date);assert.equal(response.status,200,await response.clone().text());
    const report=await response.json(),lane=report.lanes.find((item:any)=>item.employeeId===owner.employeeId);assert.ok(lane);assert.equal(lane.points.length,2);
    const first=lane.points.find((point:any)=>point.timestamp===f.base.toISOString());assert.ok(first);
    browser=await chromium.launch();const page=await browser.newPage({ignoreHTTPSErrors:true,hasTouch:true,viewport:{width:390,height:900},reducedMotion:'reduce'});
    const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(f.origin+'/#activity?date='+date+'&version='+report.version);await page.getByLabel('个人读取凭据').fill(owner.readerCredential);await page.getByRole('button',{name:'进入存档',exact:true}).click();
    const rhythm=page.getByRole('region',{name:'对话节奏',exact:true});await expect(rhythm.getByRole('img',{name:'对话节奏',exact:true})).toBeVisible();
    const target=rhythm.getByRole('button',{name:'活动触屏合成员工 · 4 条活动',exact:true});await expect(target).toBeVisible();
    await target.tap();const details=rhythm.getByRole('dialog',{name:'活动详情',exact:true});await expect(details).toBeInViewport({ratio:1});
    await expect(details.getByRole('link')).toHaveCount(4);
    const point=details.getByRole('link',{name:'活动触屏合成员工 · 提问 · 10:00:00',exact:true});
    const bounds=await point.boundingBox();assert.ok(bounds);assert.ok(bounds.width>=44&&bounds.height>=44);const href=await point.getAttribute('href');assert.equal(href,first.evidence.conversationPath??first.evidence.webPath);
    await page.screenshot({path:join(directory,'activity-dense-before-touch.png'),animations:'disabled'});
    await point.tap();await expect(page.getByRole('region',{name:'对话阅读',exact:true})).toBeVisible();
    await writeFile(join(directory,'activity-dense-touch.json'),JSON.stringify({version:report.version,expected:href,actual:new URL(page.url()).hash,point:bounds,errors},null,2));
    assert.equal(new URL(page.url()).hash,new URL(href!,f.origin).hash,'touching the requested activity must open that original, not a neighboring record');
    await expect(page.getByRole('region',{name:'对话阅读',exact:true}).getByText('会话1 请求 0 elements=3',{exact:true})).toBeVisible();assert.deepEqual(errors,[]);
  }finally{await browser?.close();await f.close();}
});

test('coincident known efficiency points select the intended fixed session by touch',{timeout:120000},async()=>{
  const f=await assessmentFixture();let browser:Browser|undefined;
  const directory=process.env.SKYNET_ACTIVITY_EFFICIENCY_EVIDENCE??join(f.directory,'activity-efficiency');await mkdir(directory,{recursive:true});
  try{
    f.now.setTime(f.base.getTime()+3600000);const owner=await f.owner('产效触屏合成员工');
    await f.session(owner,{prompts:1,tokens:100,verified:1,claimed:0});await f.session(owner,{prompts:1,tokens:100,verified:1,claimed:0});
    const response=await f.api(owner,'/api/session-efficiency?period=this-week');assert.equal(response.status,200,await response.clone().text());const report=await response.json();
    const sessions=report.sessions.filter((row:any)=>row.taskType==='implementation'&&row.efficiency.value!==null);assert.equal(sessions.length,2);assert.deepEqual(sessions.map((row:any)=>row.efficiency),[{value:10000,numerator:1,denominator:100},{value:10000,numerator:1,denominator:100}]);
    browser=await chromium.launch();const page=await browser.newPage({ignoreHTTPSErrors:true,hasTouch:true,viewport:{width:390,height:900},reducedMotion:'reduce'});
    await page.goto(f.origin+'/#efficiency');await page.getByLabel('个人读取凭据').fill(owner.readerCredential);await page.getByRole('button',{name:'进入存档',exact:true}).click();
    const distribution=page.getByRole('region',{name:'任务类型分布',exact:true}),target=distribution.getByRole('button',{name:'实现 · 2 个会话',exact:true});
    await target.tap();const details=distribution.getByRole('dialog',{name:'产效会话详情',exact:true});await expect(details).toBeInViewport({ratio:1});
    await expect(details.getByRole('button')).toHaveCount(2);const point=details.getByRole('button').first();await expect(point).toContainText('1 / 100 Token');
    const bounds=await target.boundingBox();assert.ok(bounds);assert.ok(bounds.width>=44&&bounds.height>=44);await page.screenshot({path:join(directory,'efficiency-dense-before-touch.png'),animations:'disabled'});
    await point.tap();const selected=page.getByRole('region',{name:'选中会话',exact:true});await expect(selected).toBeVisible();
    const actual=await selected.locator('.eff-id').innerText();await writeFile(join(directory,'efficiency-dense-touch.json'),JSON.stringify({version:report.version,point:bounds,expected:sessions[0].sourceSessionId,actual},null,2));
    assert.equal(actual,sessions[0].sourceSessionId,'a coincident point must not silently select its neighbor');
    await expect(selected.getByRole('link',{name:'阅读原始对话',exact:true})).toHaveAttribute('href',sessions[0].webPath);
  }finally{await browser?.close();await f.close();}
});
