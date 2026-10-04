import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium, expect, type Browser } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { assessmentFixture } from './assessment-fixture.js';

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
