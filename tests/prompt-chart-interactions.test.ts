import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium,expect,type Browser,type Locator} from '@playwright/test';
import {assessmentFixture} from './assessment-fixture.js';

// Agreed public seams: upload + recorded Analysis result -> fixed report HTTP -> real Web.
async function promptPage(){
  const f=await assessmentFixture();let browser:Browser|undefined;
  try{
    const owner=await f.owner('提示词交互合成员工');await f.session(owner,{prompts:3,elements:3,rework:false});
    const response=await f.api(owner,'/api/prompt-report?period=since-enrollment');assert.equal(response.status,200,await response.clone().text());
    const report=await response.json();assert.equal(report.kpis.prompts,3);
    browser=await chromium.launch();const page=await browser.newPage({ignoreHTTPSErrors:true,hasTouch:true,viewport:{width:390,height:900},reducedMotion:'reduce'});
    const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(f.origin+'/#prompts?period=since-enrollment&version='+report.version);
    await page.getByLabel('个人读取凭据').fill(owner.readerCredential);await page.getByRole('button',{name:'进入存档',exact:true}).click();
    const panel=page.getByRole('region',{name:'提示词分析',exact:true});await expect(panel.getByRole('heading',{name:'提示词要素覆盖',exact:true})).toBeVisible();
    const directory=process.env.SKYNET_PROMPT_CHART_EVIDENCE??join(f.directory,'prompt-charts');await mkdir(directory,{recursive:true});
    return {f,page,panel,owner,report,directory,errors,close:async()=>{await browser?.close();await f.close();}};
  }catch(error){await browser?.close();await f.close();throw error;}
}

test('prompt count bars support repeat touch and keyboard disclosure without losing literal counts',{timeout:120000},async()=>{
  const fixture=await promptPage();const {page,panel,directory,errors}=fixture;
  try{
    const chart=panel.getByRole('region',{name:'长度数量',exact:true}),bar=chart.getByRole('button',{name:/≤15 字/}),tip=chart.getByRole('tooltip');
    await bar.tap();await expect(tip).toContainText('3 条提示词');await expect(tip).toBeInViewport({ratio:1});
    await bar.tap();
    await writeFile(join(directory,'count-second-tap.json'),JSON.stringify({version:fixture.report.version,count:3,remainingTooltips:await tip.count()},null,2));
    await page.screenshot({path:join(directory,'count-second-tap.png'),animations:'disabled'});
    await expect(tip).toHaveCount(0);
    await bar.tap();await expect(tip).toContainText('3 条提示词');await page.keyboard.press('Escape');await expect(tip).toHaveCount(0);
    await page.keyboard.press('Enter');await expect(tip).toContainText('3 条提示词');await page.keyboard.press('Space');await expect(tip).toHaveCount(0);
    await bar.press('Tab');await bar.focus();await expect(tip).toContainText('3 条提示词');await bar.press('Tab');await expect(tip).toContainText('16–30 字 · 0 条提示词');
    await chart.getByRole('button',{name:'长度数量切换为表格',exact:true}).focus();await expect(tip).toHaveCount(0);
    await chart.getByRole('button',{name:'长度数量切换为表格',exact:true}).tap();
    await expect(chart.getByRole('row').filter({has:page.getByRole('rowheader',{name:'≤15 字',exact:true})}).getByRole('cell')).toHaveText('3');
    assert.deepEqual(errors,[]);
  }finally{await fixture.close();}
});
