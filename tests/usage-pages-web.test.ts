import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium,expect,type Browser} from '@playwright/test';
import {assessmentFixture} from './assessment-fixture.js';

test('usage charts finish bounded sections, keep late pages isolated, and expose the final session page', {timeout:180000},async()=>{
  const f=await assessmentFixture();let browser:Browser|undefined;
  try{
    const a=await f.owner('甲分页员工'),b=await f.owner('乙参照员工');
    for(let index=0;index<27;index++){const record=f.rows({prompts:1});await f.upload(index<22?a:b,record.rows,record.sessionId,{project:'/synthetic/page-'+String(index).padStart(2,'0')});}
    browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1280,height:900}}),page=await context.newPage();
    const errors:string[]=[],requests:URL[]=[];page.on('pageerror',error=>errors.push(error.message));
    let release:()=>void=()=>{},held:()=>void=()=>{},shouldHold=true;
    const gate=new Promise<void>(resolve=>{release=resolve;}),observed=new Promise<void>(resolve=>{held=resolve;});
    await context.route('**/*',async route=>{
      const url=new URL(route.request().url());if(url.origin!==f.origin)return route.abort();
      if(url.pathname==='/api/usage-output')requests.push(url);
      const response=await f.fetchTls(route.request().url(),{method:route.request().method(),headers:await route.request().allHeaders(),body:route.request().postData()});
      const bytes=Buffer.from(await response.arrayBuffer());
      if(shouldHold&&url.pathname==='/api/usage-output'&&url.searchParams.get('section')==='sessions'&&!url.searchParams.has('employeeId')){shouldHold=false;held();await gate;}
      const headers:Record<string,string>={};response.headers.forEach((value,key)=>{headers[key]=value;});
      await route.fulfill({status:response.status,headers,body:bytes}).catch(()=>{});
    });
    const exports:string[]=[];page.on('request',request=>{if(new URL(request.url()).pathname==='/api/usage-output/export')exports.push(request.url());});
    await page.goto(f.origin+'/#usage?period=since-enrollment');await page.getByLabel('个人读取凭据').fill(a.readerCredential);await page.getByRole('button',{name:'进入存档',exact:true}).click();
    const panel=page.getByRole('region',{name:'用量指标',exact:true});await observed;
    await expect(panel.getByText('27',{exact:true})).toBeVisible();
    await panel.getByRole('combobox',{name:/^员工/}).selectOption(b.employeeId);
    await expect(panel.getByRole('region',{name:'会话用量',exact:true}).getByRole('link')).toHaveCount(5);
    release();
    await expect(panel.getByRole('region',{name:'每人产出',exact:true}).getByRole('row')).toHaveCount(2);
    await expect(panel.getByRole('region',{name:'会话散点',exact:true}).locator('[data-reference="true"]')).toHaveCount(22);
    await panel.getByRole('combobox',{name:/^员工/}).selectOption(a.employeeId);
    const sessions=panel.getByRole('region',{name:'会话用量',exact:true});
    await expect(sessions.getByText(/共 22 个会话/)).toBeVisible();await expect(sessions.getByRole('link')).toHaveCount(20);
    await sessions.getByRole('button',{name:'下一页会话'}).click();await expect(sessions.getByRole('link')).toHaveCount(2);await expect(sessions.getByRole('button',{name:'下一页会话'})).toBeDisabled();
    await sessions.getByRole('button',{name:'上一页会话'}).focus();await page.keyboard.press('Enter');await expect(sessions.getByRole('link')).toHaveCount(20);
    await panel.getByRole('button',{name:'会话散点切换为表格'}).click();await expect(panel.getByRole('region',{name:'会话散点',exact:true}).getByRole('row')).toHaveCount(28);
    const destination=process.env.SKYNET_USAGE_WEB_EVIDENCE??f.directory;await mkdir(destination,{recursive:true});
    for(const width of [320,390,768,1280,1920])for(const theme of ['light','dark']){
      await page.setViewportSize({width,height:900});await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
      await panel.getByRole('heading',{name:'用量与产出'}).scrollIntoViewIfNeeded();await panel.locator('.workspace-scroll').evaluate(el=>el.scrollTop=0);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth||document.documentElement.scrollHeight>innerHeight),false,`${width} ${theme} outer scroll`);
      const targets=await panel.locator('button,select,summary').evaluateAll(elements=>elements.filter(el=>el.getClientRects().length).map(el=>({text:el.textContent?.slice(0,40),height:el.getBoundingClientRect().height,width:el.getBoundingClientRect().width})));
      assert.deepEqual(targets.filter(target=>target.height<44||target.width<44),[],`${width} ${theme} touch targets`);
      await page.screenshot({path:join(destination,`usage-pages-${width}-${theme}.png`),animations:'disabled'});
    }
    assert.deepEqual(exports,[]);assert.deepEqual(errors,[]);
    assert.ok(requests.some(url=>url.searchParams.has('section')));assert.ok(requests.filter(url=>url.searchParams.has('section')).every(url=>/^[a-f0-9]{64}$/.test(url.searchParams.get('version')??'')));
    await writeFile(join(destination,'usage-pages-web.json'),JSON.stringify({errors,automaticExports:exports,sectionRequests:requests.filter(url=>url.searchParams.has('section')).length,latePageIsolated:true,tailSessions:2},null,2));
  }finally{await browser?.close();await f.close();}
});
