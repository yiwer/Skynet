import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium,expect,type Browser} from '@playwright/test';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {insightPagingFixture,pageRows} from './insights-paging-fixture.js';

test('same-version insight and analysis refreshes preserve loaded pages and a last-page correction draft', {timeout:120000},async()=>{
  const f=await insightPagingFixture();let browser:Browser|undefined;
  try{
    const before=await(await f.api(f.owner,f.path)).json();
    browser=await chromium.launch();const page=await browser.newPage({ignoreHTTPSErrors:true,viewport:{width:1280,height:900}});
    await page.goto(f.origin+'/#'+f.record.snapshotId);await page.getByLabel('个人读取凭据').fill(f.owner.readerCredential);await page.getByRole('button',{name:'进入存档',exact:true}).click();
    const panel=page.getByRole('region',{name:'会话洞察',exact:true}),analysis=page.getByRole('region',{name:'会话分析',exact:true});
    await expect(analysis).toContainText('分析已完成');await expect(panel.locator('.insight-status')).toContainText('已完成');
    await panel.getByText('更正推断',{exact:true}).click();
    const more=panel.getByRole('button',{name:'更多可更正提示词',exact:true}),target=panel.getByLabel('更正字段');
    while(await more.count()){const count=await target.locator('optgroup').count();await more.click();await expect.poll(()=>target.locator('optgroup').count()).toBeGreaterThan(count);}
    await target.selectOption({label:'提示词 20 · 返工'});const selected=await target.inputValue();
    await panel.getByLabel('返工判定',{exact:true}).selectOption('true');await panel.getByLabel('更正原因').fill('保留末页提示词草稿');
    for(const trigger of [panel.getByRole('button',{name:'刷新会话洞察',exact:true}),analysis.getByRole('button',{name:'刷新',exact:true})]){
      const refreshed=page.waitForResponse(response=>new URL(response.url()).pathname===f.path&&!new URL(response.url()).search);
      await trigger.click();const response=await refreshed;assert.equal(response.status(),200);assert.equal((await response.json()).version,before.version);await response.finished();
      await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
      await expect(target).toHaveValue(selected);await expect(target.locator('optgroup')).toHaveCount(20);
      await expect(panel.getByLabel('返工判定',{exact:true})).toHaveValue('true');await expect(panel.getByLabel('更正原因')).toHaveValue('保留末页提示词草稿');
      await expect(more).toHaveCount(0);await expect(panel.getByRole('button',{name:'保存更正',exact:true})).toBeEnabled();
    }
    // A different immutable version must still require review, while its own
    // pages can be loaded to locate the same last-page original event.
    assert.equal((await f.api(f.owner,`/api/snapshots/${f.record.snapshotId}/inference-corrections`,{requestId:randomUUID(),expectedVersion:before.version,kind:'task-type',value:'investigation',reason:'另一次已发布更正'})).status,201);
    await panel.getByRole('button',{name:'刷新会话洞察',exact:true}).click();await expect(panel.getByRole('alert')).toContainText('洞察已更新，草稿已保留');
    await expect(target).toHaveValue(selected);await expect(target.locator('optgroup')).toHaveCount(20);await expect(panel.getByLabel('更正原因')).toHaveValue('保留末页提示词草稿');
    await expect(panel.getByRole('button',{name:'保存更正',exact:true})).toBeDisabled();await expect(panel.getByRole('button',{name:'核对新版后继续',exact:true})).toBeDisabled();
    while(await more.count()){
      const loaded=page.waitForResponse(response=>{const url=new URL(response.url());return url.pathname===f.path&&url.searchParams.get('section')==='prompts';});
      await more.click();const response=await loaded,value=await response.json();await response.finished();
      if(value.pages.prompts.nextOffset===null)await expect(more).toHaveCount(0);else await expect(more).toBeEnabled();
    }
    await expect(panel.getByRole('button',{name:'核对新版后继续',exact:true})).toBeEnabled();await expect(target).toHaveValue(selected);
    await panel.getByRole('button',{name:'核对新版后继续',exact:true}).click();await expect(panel.getByLabel('返工判定',{exact:true})).toHaveValue('true');
    await panel.getByRole('button',{name:'保存更正',exact:true}).click();await expect(panel.locator('.insight-counts>div').filter({has:page.getByText('返工',{exact:true})}).locator('dd')).toHaveText('1');
    const current=await(await f.api(f.owner,f.path)).json();assert.equal(current.metrics.rework,1);assert.notEqual(current.version,before.version);assert.equal(current.inferences.taskType.value,'investigation');
  }finally{await browser?.close();await f.close();}
});

test('OAuth MCP reconstructs the same bounded fixed insight sections as HTTP', {timeout:120000},async()=>{
  const f=await insightPagingFixture();let client:Client|undefined;
  try{
    const resource=f.origin+'/mcp',registration=await(await f.api(f.owner,'/oauth/register',{client_name:'Insight pages',redirect_uris:['http://127.0.0.1:47130/callback'],token_endpoint_auth_method:'none'})).json(),verifier=randomBytes(48).toString('base64url');
    const callback=new URL(await f.authorizationPage(f.origin+'/oauth/authorize?'+new URLSearchParams({response_type:'code',client_id:registration.client_id,redirect_uri:registration.redirect_uris[0],scope:'archive:read',resource,state:randomUUID(),code_challenge_method:'S256',code_challenge:createHash('sha256').update(verifier).digest('base64url')}),f.owner.readerCredential));
    const token=await(await f.nativeApi('/oauth/token',f.owner.readerCredential,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:registration.client_id,code:callback.searchParams.get('code')!,redirect_uri:registration.redirect_uris[0],code_verifier:verifier,resource}).toString()})).json();
    client=new Client({name:'insight-pages-public',version:'1'});await client.connect(new StreamableHTTPClientTransport(new URL(resource),{fetch:f.fetchTls,requestInit:{headers:{Authorization:'Bearer '+token.access_token}}}));
    async function read(args:Record<string,string|number>={}){
      const value=await client!.callTool({name:'read_session_insights',arguments:{snapshotId:f.record.snapshotId,...args}});assert.notEqual(value.isError,true,JSON.stringify(value));
      assert.ok(Buffer.byteLength(JSON.stringify(value))<=48*1024,'actual MCP response stays bounded');
      const text=(value.content as {text:string}[])[0]!.text;assert.ok(Buffer.byteLength(text)<=32*1024);
      const response=await f.api(f.owner,f.path+'?'+new URLSearchParams(Object.entries(args).map(([key,v])=>[key,String(v)])));assert.equal(response.status,200);const http=await response.json();assert.deepEqual(JSON.parse(text),http);return http;
    }
    const first=await read();assert.equal(first.pages.prompts.total,20);
    for(const section of Object.keys(first.pages)){
      let page=first,count=pageRows(first,section).length;
      while(page.pages[section].nextOffset!==null){page=await read({version:first.version,section,offset:page.pages[section].nextOffset});count+=pageRows(page,section).length;}
      assert.equal(count,first.pages[section].total);
    }
    assert.deepEqual(await read({version:first.version}),first);assert.deepEqual(await read({analysisId:f.analysisId}),first);
    const bad=await client.callTool({name:'read_session_insights',arguments:{snapshotId:f.record.snapshotId,section:'prompts',offset:1}});assert.equal(bad.isError,true);
    const zero=await client.callTool({name:'read_session_insights',arguments:{snapshotId:f.record.snapshotId,section:'prompts',offset:0}});assert.equal(zero.isError,true);
  }finally{await client?.close();await f.close();}
});

test('a long insight sidebar keeps full totals and lets touch and keyboard users correct a last-page prompt', {timeout:150000},async()=>{
  const f=await insightPagingFixture();let browser:Browser|undefined;
  const directory=process.env.SKYNET_INSIGHTS_PAGING_EVIDENCE_DIR??join(f.directory,'insights-paging');await mkdir(directory,{recursive:true});
  try{
    const before=await(await f.api(f.owner,f.path)).json();assert.ok(before.pages);
    browser=await chromium.launch();const page=await browser.newPage({ignoreHTTPSErrors:true,viewport:{width:1280,height:900},hasTouch:true}),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(f.origin+'/#'+f.record.snapshotId);await page.getByLabel('个人读取凭据').fill(f.owner.readerCredential);await page.getByRole('button',{name:'进入存档',exact:true}).click();
    const panel=page.getByRole('region',{name:'会话洞察',exact:true});await expect(panel.locator('.insight-status')).toContainText('已完成');await expect(panel.getByText('提示词 · 20',{exact:true})).toBeVisible();
    await panel.getByText('更正推断',{exact:true}).click();const more=panel.getByRole('button',{name:'更多可更正提示词',exact:true});await expect(more).toBeVisible();
    while(await more.count()){
      const previous=await panel.getByLabel('更正字段').locator('optgroup').count();await more.focus();await page.keyboard.press('Enter');
      try{await expect.poll(()=>panel.getByLabel('更正字段').locator('optgroup').count()).toBeGreaterThan(previous);}
      catch(error){console.log(JSON.stringify({panel:await panel.innerText(),traffic:f.traffic.filter(row=>row.path.includes('insight')),errors},null,2));throw error;}
    }
    const target=panel.getByLabel('更正字段');await expect(target.locator('option').filter({hasText:'提示词 20 · 返工'})).toHaveCount(1);
    await target.selectOption({label:'提示词 20 · 返工'});await panel.getByLabel('返工判定',{exact:true}).selectOption('true');await panel.getByLabel('更正原因').fill('最后一轮要求改正前次结果');
    await panel.getByRole('button',{name:'保存更正',exact:true}).click();await expect(panel.locator('.insight-status')).toContainText('已更正');
    const current=await(await f.api(f.owner,f.path)).json();assert.equal(current.metrics.rework,1);assert.notEqual(current.version,before.version);
    // A delayed real page response must not append into a newly corrected view.
    let release!:()=>void,reached=false;const gate=new Promise<void>(resolve=>release=resolve);
    await page.route('**/api/snapshots/'+f.record.snapshotId+'/insights?*',async route=>{
      const q=new URL(route.request().url()).searchParams;if(q.get('version')!==current.version||q.get('section')!=='prompts')return route.continue();
      const response=await route.fetch();reached=true;await gate;await route.fulfill({response});
    });
    try{
      await panel.getByText('提示词 · 20',{exact:true}).click();await panel.getByRole('button',{name:'更多提示词',exact:true}).click();await expect.poll(()=>reached).toBe(true);
      const tail=await(await f.api(f.owner,f.path+'?'+new URLSearchParams({version:current.version,section:'prompts',offset:'19'}))).json();
      const update=await f.api(f.owner,`/api/snapshots/${f.record.snapshotId}/inference-corrections`,{requestId:randomUUID(),expectedVersion:current.version,kind:'rework',promptEvent:tail.inferences.prompts[0].event,value:false,reason:'刷新期间复核最后一轮'});assert.equal(update.status,201);
      await panel.getByRole('button',{name:'刷新会话洞察',exact:true}).click();await expect(panel.locator('.insight-counts>div').filter({has:page.getByText('返工',{exact:true})}).locator('dd')).toHaveText('0');
    }finally{release();}
    await page.unrouteAll({behavior:'wait'});await expect(panel.locator('.insight-items>article')).toHaveCount(before.inferences.prompts.length);await expect(panel.getByRole('button',{name:'更多提示词',exact:true})).toBeEnabled();
    await page.goto(f.origin+'/#'+f.record.snapshotId+'?insightVersion='+before.version);await expect(panel.getByText('查看当前洞察',{exact:true})).toBeVisible();
    const prompts=panel.getByText('提示词 · 20',{exact:true});if(!await prompts.locator('..').evaluate(node=>(node as HTMLDetailsElement).open))await prompts.click();const next=panel.getByRole('button',{name:'更多提示词',exact:true});
    while(await next.count()){const previous=await panel.locator('.insight-items>article').count();await next.tap();await expect.poll(()=>panel.locator('.insight-items>article').count()).toBeGreaterThan(previous);}
    await expect(panel.getByRole('heading',{name:'提示词 20',exact:true})).toBeVisible();const finalPrompt=panel.getByRole('heading',{name:'提示词 20',exact:true}).locator('..');await expect(finalPrompt.getByText('返工',{exact:true})).toHaveCount(0);
    await finalPrompt.getByText('原文 · 1',{exact:true}).click();await expect(finalPrompt.locator('q')).toHaveText('请求 19 elements=3：核查合成接口');await expect(finalPrompt.getByRole('link')).toHaveAttribute('href',new RegExp(f.record.snapshotId));
    await panel.getByText('原件产出',{exact:true}).click();
    await expect(panel.getByText('测试运行',{exact:false}).first()).toContainText('60');
    await panel.getByText('原文 · 24',{exact:true}).click();
    const evidenceButton=panel.getByRole('button',{name:'更多测试运行原文',exact:true});while(await evidenceButton.count()){const previous=await panel.locator('.insight-evidence q').count();await evidenceButton.click();await expect.poll(()=>panel.locator('.insight-evidence q').count()).toBeGreaterThan(previous);}
    await page.emulateMedia({reducedMotion:'reduce'});
    for(const width of [320,1280])for(const theme of ['light','dark']){
      await page.setViewportSize({width,height:900});await page.evaluate(value=>document.documentElement.dataset.theme=value,theme);await finalPrompt.scrollIntoViewIfNeeded();
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth||document.documentElement.scrollHeight>innerHeight),false);
      const small=await panel.locator('button,a,summary').evaluateAll(nodes=>nodes.filter(node=>{const r=node.getBoundingClientRect();return r.width>0&&r.height>0&&(r.width<44||r.height<44);}).map(node=>({text:node.textContent,rect:node.getBoundingClientRect().toJSON()})));assert.deepEqual(small,[]);
      await page.screenshot({path:join(directory,`insights-${width}-${theme}.png`),animations:'disabled'});
    }
    await page.reload();await page.getByLabel('个人读取凭据').fill(f.owner.readerCredential);await page.getByRole('button',{name:'进入存档',exact:true}).click();await expect(panel.getByText('提示词 · 20',{exact:true})).toBeVisible();assert.equal(new URLSearchParams(new URL(page.url()).hash.split('?')[1]).get('insightVersion'),before.version);
    assert.deepEqual(errors,[]);await writeFile(join(directory,'manifest.json'),JSON.stringify({before:before.version,current:current.version,errors},null,2));
  }finally{await browser?.close();await f.close();}
});
