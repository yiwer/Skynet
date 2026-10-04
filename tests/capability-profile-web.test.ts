import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium, expect, type Browser } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { assessmentFixture } from './assessment-fixture.js';
import { beijingDate } from '../packages/contracts/reports.js';
import { monday, addDays } from '../packages/contracts/work-views.js';
import { setTimeout } from 'node:timers/promises';

test('full employee profile presents frozen device metadata, usage and keyboard-accessible daily charts', {timeout:180000}, async()=>{
  const s=await assessmentFixture();let browser:Browser|undefined;
  const evidence=process.env.SKYNET_PROFILE_WEB_EVIDENCE_DIR??join(s.directory,'profile-web');await mkdir(evidence,{recursive:true});
  try{
    const person=await s.owner('Profile Alpha');for(let n=0;n<2;n++)await s.session(person,{prompts:3,tokens:2000,verified:2,claimed:0});
    const profile=await(await s.api(person,'/api/capability-profiles/'+person.employeeId)).json();assert.equal(profile.kpis.sessions,2);assert.equal(profile.kpis.userTurns,6);assert.equal(profile.kpis.outputs.verified.value,4);
    browser=await chromium.launch();const page=await browser.newPage({ignoreHTTPSErrors:true,viewport:{width:1280,height:900}}),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(s.origin+'/#profile?'+new URLSearchParams({employeeId:person.employeeId,profileVersion:profile.version}));await page.getByLabel('个人读取凭据').fill(person.readerCredential);await page.getByRole('button',{name:'进入存档',exact:true}).click();
    const nav=page.getByRole('navigation',{name:'画像目录',exact:true});await expect(nav).toBeVisible();
    await expect(page.getByRole('region',{name:'接入信息',exact:true})).toContainText('1 台设备');await expect(page.getByRole('region',{name:'接入信息',exact:true})).toContainText('最近同步');await expect(page.getByTestId('assessment-index')).toHaveText(String(profile.assessment.index));
    await nav.getByRole('button',{name:'使用数据',exact:true}).focus();await page.keyboard.press('Enter');await expect(page.locator('#profile-usage')).toBeFocused();
    const usage=page.getByRole('region',{name:'使用数据',exact:true});await expect(usage.getByLabel('会话与提示词', {exact:true})).toContainText('2');await expect(usage.getByLabel('会话与提示词',{exact:true})).toContainText('6 条提示词');
    await expect(usage.getByRole('group',{name:'每日趋势',exact:true})).toBeVisible();await usage.getByRole('button',{name:'每日趋势表格',exact:true}).click();const table=usage.getByRole('table',{name:'每日使用数据',exact:true});await expect(table).toContainText('4000');await expect(table).toContainText('4');
    await usage.getByRole('button',{name:'Agent 分布表格',exact:true}).click();await expect(usage.getByRole('table',{name:'Agent 分布',exact:true})).toContainText('Codex CLI');await usage.getByRole('button',{name:'任务类型表格',exact:true}).click();await expect(usage.getByRole('table',{name:'任务类型',exact:true})).toContainText('实现');
    const downloaded=page.waitForEvent('download');await page.getByRole('button',{name:'导出画像',exact:true}).click();const download=await downloaded;await download.saveAs(join(evidence,'profile-download.json'));const {pages:_pages,...full}=profile;assert.deepEqual(JSON.parse(await(await import('node:fs/promises')).readFile(join(evidence,'profile-download.json'),'utf8')),full);
    assert.equal(new URLSearchParams(new URL(page.url()).hash.split('?')[1]).get('profileVersion'),profile.version);assert.deepEqual(errors,[]);await writeFile(join(evidence,'profile.json'),JSON.stringify(profile,null,2));
  }finally{await browser?.close();await s.close();}
});

test('profile work sources, paginated sessions and activity stay bound while new sessions arrive', {timeout:180000}, async()=>{
  const s=await assessmentFixture();let browser:Browser|undefined;
  try{
    const person=await s.owner('Work profile');await s.session(person,{prompts:3,verified:1});
    for(let n=0;n<24;n++){const row=s.rows({prompts:1});await s.upload(person,row.rows,row.sessionId);}
    const date=beijingDate(s.base),from=monday(date),to=addDays(from,6),daily='/api/daily-reports/'+person.employeeId+'/'+date,weekly='/api/work-view?'+new URLSearchParams({kind:'weekly',subject:person.employeeId,from,to});
    await s.api(person,daily,{});await s.api(person,weekly,{});let day:any,week:any;for(let i=0;i<80;i++){day=await(await s.api(person,daily)).json();week=await(await s.api(person,weekly)).json();if(day.items.length&&week.items.length)break;await setTimeout(200);}assert.ok(day.items.length&&week.items.length);
    const profile=await(await s.api(person,'/api/capability-profiles/'+person.employeeId)).json();assert.equal(profile.pages.sessions.total,25);
    browser=await chromium.launch();const page=await browser.newPage({ignoreHTTPSErrors:true,viewport:{width:1280,height:900}});await page.goto(s.origin+'/#profile?'+new URLSearchParams({employeeId:person.employeeId,profileVersion:profile.version}));await page.getByLabel('个人读取凭据').fill(person.readerCredential);await page.getByRole('button',{name:'进入存档',exact:true}).click();
    const nav=page.getByRole('navigation',{name:'画像目录',exact:true});await nav.getByRole('button',{name:'工作内容',exact:true}).click();const work=page.getByRole('region',{name:'工作内容',exact:true});await expect(work).toContainText('合成测试实现');
    for(const kind of ['daily','weekly']){const source=profile.work.reports.find((r:any)=>r.kind===kind&&r.version),link=work.getByRole('link',{name:(kind==='daily'?'日报 ':'周报 ')+source.from,exact:true});await expect(link).toHaveAttribute('href',new RegExp('revision='+source.revision));await link.click();await expect(page.getByRole('link',{name:'返回员工画像',exact:true})).toBeVisible();assert.equal(new URLSearchParams(new URL(page.url()).hash.split('?')[1]).get('revision'),String(source.revision));await page.getByRole('link',{name:'返回员工画像',exact:true}).click();await expect(nav).toBeVisible();assert.equal(new URLSearchParams(new URL(page.url()).hash.split('?')[1]).get('profileVersion'),profile.version);}
    await nav.getByRole('button',{name:'会话',exact:true}).click();const sessions=page.getByRole('table',{name:'画像会话',exact:true});await expect(sessions.getByRole('row')).toHaveCount(21);const added=s.rows({prompts:1});await s.upload(person,added.rows,added.sessionId);await page.getByRole('button',{name:'更多会话',exact:true}).click();await expect(sessions.getByRole('row')).toHaveCount(26);await expect(page.getByRole('button',{name:'更多会话',exact:true})).toHaveCount(0);await expect(sessions).toContainText('未知');
    await nav.getByRole('button',{name:'最近活动',exact:true}).click();const activity=page.getByRole('region',{name:'最近活动',exact:true}),reference=profile.recentActivity.references[0];await activity.getByRole('link',{name:'查看 '+reference.date+' 的活动',exact:true}).click();await expect(page.getByRole('heading',{name:'活动记录',exact:true})).toBeVisible();const selected=new URLSearchParams(new URL(page.url()).hash.split('?')[1]);assert.equal(selected.get('employeeId'),person.employeeId);assert.equal(selected.get('version'),reference.version);await page.goBack();await expect(nav).toBeVisible();assert.equal(new URLSearchParams(new URL(page.url()).hash.split('?')[1]).get('profileVersion'),profile.version);
  }finally{await browser?.close();await s.close();}
});
