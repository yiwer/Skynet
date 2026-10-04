import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium,expect,type Browser} from '@playwright/test';
import {assessmentFixture} from './assessment-fixture.js';

test('efficiency charts and selected segments use fixed pages while complete export is an explicit action', {timeout:120000}, async()=>{
  const f=await assessmentFixture();let browser:Browser|undefined;
  try{
    const owner=await f.owner('分页产效员工');await f.session(owner,{prompts:3,tokens:1000});await f.session(owner,{prompts:4,tokens:2000,rework:true});
    for(let i=0;i<19;i++){const native=f.rows({prompts:3,tokens:3000+i});await f.upload(owner,native.rows,native.sessionId);}
    browser=await chromium.launch({headless:true});const context=await browser.newContext();const page=await context.newPage();
    const requests:string[]=[],errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
    await context.route('**/*',async route=>{const url=new URL(route.request().url());if(url.origin!==f.origin)return route.abort();requests.push(url.pathname+url.search);
      const response=await f.fetchTls(url.toString(),{method:route.request().method(),headers:await route.request().allHeaders(),body:route.request().postData()});
      const headers:Record<string,string>={};response.headers.forEach((value,key)=>{headers[key]=value;});await route.fulfill({status:response.status,headers,body:Buffer.from(await response.arrayBuffer())});});
    await page.goto(f.origin+'/#efficiency');await page.getByLabel('个人读取凭据').fill(owner.readerCredential);await page.getByRole('button',{name:'进入存档',exact:true}).click();
    const panel=page.getByRole('region',{name:'会话产效',exact:true});await panel.getByRole('button',{name:'接入至今',exact:true}).click();
    await expect(panel.getByRole('region',{name:'值得复盘的会话',exact:true})).toContainText('返工');
    await expect(panel).toHaveAttribute('aria-busy','false');
    assert.equal(requests.filter(path=>path.startsWith('/api/session-efficiency/export')).length,0,'ordinary charts must not download all timing evidence');
    assert.ok(requests.some(path=>path.includes('section=summaries')&&path.includes('version=')));
    await panel.getByRole('region',{name:'值得复盘的会话',exact:true}).getByRole('button').first().click();
    const detail=panel.getByRole('region',{name:'选中会话',exact:true});await expect(detail.locator('.eff-segments > li')).toHaveCount(7);
    await panel.getByRole('button',{name:'关闭会话分段',exact:true}).click();
    const first=await panel.getByRole('table',{name:'会话明细',exact:true}).locator('tbody tr').count();
    const tokens:number[]=[];
    for(let number=0;;number++){
      assert.ok(number<21);tokens.push(...(await panel.getByRole('table',{name:'会话明细',exact:true}).locator('tbody tr td:nth-child(3)').allTextContents()).map(text=>Number(text.replaceAll(',',''))));
      const next=panel.getByRole('button',{name:'下一页会话',exact:true});if(await next.isDisabled())break;
      const loaded=page.waitForResponse(response=>{const url=new URL(response.url());return url.pathname==='/api/session-efficiency'&&!url.searchParams.has('section');});
      await next.click();await loaded;await expect(panel).toHaveAttribute('aria-busy','false');
    }
    assert.deepEqual(tokens.sort((a,b)=>a-b),[1000,2000,...Array.from({length:19},(_,i)=>3000+i)]);
    while(!await panel.getByRole('button',{name:'上一页会话',exact:true}).isDisabled()){
      const loaded=page.waitForResponse(response=>{const url=new URL(response.url());return url.pathname==='/api/session-efficiency'&&!url.searchParams.has('section');});
      await panel.getByRole('button',{name:'上一页会话',exact:true}).click();await loaded;await expect(panel).toHaveAttribute('aria-busy','false');
    }
    await expect(panel.getByRole('table',{name:'会话明细',exact:true}).locator('tbody tr')).toHaveCount(first);
    await panel.getByRole('button',{name:'下一页会话',exact:true}).click();await expect(panel.getByRole('navigation',{name:'产效会话分页'})).toContainText('第 2 页');
    await expect(panel).toHaveAttribute('aria-busy','false');await panel.getByLabel('仅复盘会话').check();
    await expect(panel).toHaveAttribute('aria-busy','false');await expect(panel.getByRole('navigation',{name:'产效会话分页'})).toContainText('第 1 页');
    assert.equal(requests.filter(path=>path.startsWith('/api/session-efficiency/export')).length,0);
    const downloaded=page.waitForEvent('download');await panel.getByRole('button',{name:'导出当前版本',exact:true}).click();const download=await downloaded;
    const {readFile}=await import('node:fs/promises');const output=JSON.parse(await readFile((await download.path())!,'utf8'));assert.equal(output.sessions.length,21);assert.ok(output.sessions.every((row:any)=>row.timing.segments.length===row.timing.segmentTotal));
    assert.equal(requests.filter(path=>path.startsWith('/api/session-efficiency/export')).length,1);assert.deepEqual(errors,[]);
  }finally{await browser?.close();await f.close();}
});
