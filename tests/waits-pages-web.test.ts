import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium,expect} from '@playwright/test';
import {assessmentFixture} from './assessment-fixture.js';

test('waiting facets and cursors stay fixed without automatic complete downloads',{timeout:180000},async()=>{
  const f=await assessmentFixture();const browser=await chromium.launch();
  const directory=process.env.SKYNET_WAITS_READING_EVIDENCE??join(f.directory,'wait-reading');await mkdir(directory,{recursive:true});
  let release=()=>{};
  try{
    const a=await f.owner('甲等待员工'),b=await f.owner('乙等待员工');
    const native=f.rows({prompts:27,verified:0,claimed:0});await f.upload(a,native.rows,native.sessionId);
    const peer=f.rows({prompts:2,verified:0,claimed:0});await f.upload(b,peer.rows,peer.sessionId);
    const context=await browser.newContext({viewport:{width:1280,height:900},ignoreHTTPSErrors:true,hasTouch:true}),page=await context.newPage();
    const errors:string[]=[],exports:string[]=[],sections:string[]=[];page.on('pageerror',error=>errors.push(error.message));
    page.on('request',request=>{const url=new URL(request.url());if(url.pathname==='/api/waits/export')exports.push(url.search);if(url.pathname==='/api/waits'&&url.searchParams.has('section'))sections.push(url.search);});
    await page.goto(f.origin+'/#waits?period=since-enrollment');await page.getByLabel('个人读取凭据').fill(a.readerCredential);await page.getByRole('button',{name:'进入存档',exact:true}).click();
    await expect(page.getByRole('heading',{name:'响应与等待',exact:true})).toBeVisible();
    await expect(page.getByRole('combobox',{name:/^员工/}).locator('option')).toHaveCount(3);
    assert.deepEqual(exports,[],'filter facets must use bounded fixed sections, not complete export');
    let held=false;const pending=new Promise<void>(resolve=>{release=resolve;});
    await page.route('**/api/waits?**',async route=>{
      const url=new URL(route.request().url());
      if(!held&&url.searchParams.get('section')==='employees'&&url.searchParams.get('employeeId')===a.employeeId){held=true;const response=await route.fetch();await pending;await route.fulfill({response});}
      else await route.continue();
    });
    await page.getByRole('combobox',{name:/^员工/}).selectOption(a.employeeId);await expect.poll(()=>held).toBe(true);
    await page.evaluate(id=>{location.hash='#waits?period=since-enrollment&employeeId='+id;},b.employeeId);
    await expect(page.getByRole('table',{name:'等待记录',exact:true}).locator('tbody tr')).toHaveCount(1);
    release();await expect(page.getByRole('combobox',{name:/^员工/}).locator('option')).toHaveCount(2);await expect(page.getByRole('combobox',{name:/^员工/})).toHaveValue(b.employeeId);
    assert.equal(await page.getByRole('combobox',{name:/^员工/}).locator('option').filter({hasText:'甲等待员工'}).count(),0);
    await page.evaluate(id=>{location.hash='#waits?period=since-enrollment&employeeId='+id;},a.employeeId);
    await expect(page.getByRole('table',{name:'等待记录',exact:true}).locator('tbody tr')).toHaveCount(25);
    await page.getByRole('button',{name:'下一页等待',exact:true}).click();await expect(page.getByRole('table',{name:'等待记录',exact:true}).locator('tbody tr')).toHaveCount(1);
    await page.getByRole('button',{name:'上一页等待',exact:true}).focus();await page.keyboard.press('Enter');await expect(page.getByRole('table',{name:'等待记录',exact:true}).locator('tbody tr')).toHaveCount(25);
    for(const width of [320,390,768,1280,1920])for(const theme of ['light','dark']){
      await page.setViewportSize({width,height:900});await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;document.querySelector('.waiting-report .workspace-scroll')?.scrollTo(0,0);},theme);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight),true);
      const sizes=await page.locator('.waiting-report button,.waiting-report summary,.waiting-report select,.waiting-report input,.waiting-report a').evaluateAll(elements=>elements.filter(e=>(e as HTMLElement).offsetParent!==null).map(e=>({text:e.textContent?.slice(0,30),width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height})));
      assert.ok(sizes.every(size=>size.width>=44&&size.height>=44),JSON.stringify(sizes.filter(size=>size.width<44||size.height<44)));
      await page.screenshot({path:join(directory,`wait-pages-${width}-${theme}.png`),animations:'disabled'});
    }
    assert.deepEqual(exports,[]);assert.ok(sections.length);assert.ok(sections.every(query=>new URLSearchParams(query).has('version')));
    await page.setViewportSize({width:1280,height:900});const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'导出当前版本',exact:true}).tap();
    const download=await downloading;assert.equal(await download.failure(),null);const downloaded=JSON.parse(await readFile((await download.path())!,'utf8'));assert.equal(downloaded.total,26);assert.equal(downloaded.intervals.length,26);
    assert.equal(exports.length,1);assert.equal(downloaded.version,new URLSearchParams(exports[0]).get('version'));assert.deepEqual(errors,[]);
    await writeFile(join(directory,'web.json'),JSON.stringify({errors,automaticExports:0,explicitExports:exports.length,sections:sections.length,lateFacetsIsolated:true,tailIntervals:1},null,2));
  }finally{release();await browser.close();await f.close();}
});
