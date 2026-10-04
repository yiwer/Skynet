import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium,expect,type Browser} from '@playwright/test';
import {assessmentFixture} from './assessment-fixture.js';

test('capability dimension chart has a keyboard-accessible table with the same frozen scores and team medians',{timeout:120000},async()=>{
  const f=await assessmentFixture();let browser:Browser|undefined;
  const directory=process.env.SKYNET_DIMENSION_TABLE_EVIDENCE??join(f.directory,'dimension-table');await mkdir(directory,{recursive:true});
  try{
    const owner=await f.owner('维度对照员工');for(let i=0;i<3;i++)await f.session(owner,{prompts:3});
    const response=await f.api(owner,'/api/assessments/'+owner.employeeId);assert.equal(response.status,200);
    const assessment=await response.json();assert.equal(assessment.index,73);
    browser=await chromium.launch();const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1280,height:900},reducedMotion:'reduce'}),page=await context.newPage();
    const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(f.origin+'/#profile?employeeId='+owner.employeeId+'&version='+assessment.version);
    await page.getByLabel('个人读取凭据').fill(owner.readerCredential);await page.getByRole('button',{name:'进入存档',exact:true}).click();
    await expect(page.getByTestId('assessment-index')).toHaveText('73');
    const toggle=page.getByRole('button',{name:'能力维度表格',exact:true});await toggle.focus();await page.keyboard.press('Enter');
    const table=page.getByRole('table',{name:'能力维度对照',exact:true});await expect(table).toBeVisible();await expect(table.locator('tbody tr')).toHaveCount(6);
    for(const dim of Object.values(assessment.dims) as {label:string;score:number|null;teamMedian:number|null}[]){
      const cells=table.getByRole('row').filter({has:page.getByRole('rowheader',{name:dim.label,exact:true})}).getByRole('cell');
      await expect(cells.nth(0)).toHaveText(dim.score===null?'未知':String(Math.round(dim.score)));
      await expect(cells.nth(1)).toHaveText(dim.teamMedian===null?'未知':String(Math.round(dim.teamMedian)));
    }
    const screenshots:string[]=[];
    for(const width of [320,390,768,1280,1920])for(const theme of ['light','dark']){
      await page.setViewportSize({width,height:900});await page.evaluate(value=>document.documentElement.dataset.theme=value,theme);
      await table.scrollIntoViewIfNeeded();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth||document.documentElement.scrollHeight>innerHeight),false);
      const box=await table.boundingBox();assert.ok(box&&box.x>=0&&box.x+box.width<=width);
      const target=await toggle.boundingBox();assert.ok(target&&target.width>=44&&target.height>=44);
      const name=`dimensions-${width}-${theme}.png`;await page.screenshot({path:join(directory,name),animations:'disabled'});screenshots.push(name);
    }
    await page.getByRole('button',{name:'能力维度图表',exact:true}).focus();await page.keyboard.press('Enter');
    await expect(table).toHaveCount(0);await expect(page.getByRole('img',{name:/使用深度 .*团队中位数/})).toBeVisible();
    await expect(page.getByTestId('assessment-index')).toHaveText('73');assert.deepEqual(errors,[]);
    await writeFile(join(directory,'verification.json'),JSON.stringify({version:assessment.version,screenshots,errors,keyboard:true,rows:6},null,2));
  }finally{await browser?.close();await f.close();}
});
