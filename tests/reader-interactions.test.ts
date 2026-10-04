import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium,expect,type Browser,type Page} from '@playwright/test';
import {assessmentFixture} from './assessment-fixture.js';

async function readerFixture(){
  const f=await assessmentFixture();
  try{
    const owner=await f.owner('阅读合成作者'),source=f.rows({prompts:2,verified:1});
    const rows=source.rows as any[];
    rows.find(row=>row.payload?.role==='user').payload.content[0].text='核查合成接口的可访问性 elements=3';
    const assistant=rows.find(row=>row.payload?.role==='assistant');
    rows.splice(rows.indexOf(assistant)+1,0,{type:'event_msg',timestamp:assistant.timestamp,payload:{type:'item_completed',
      item:{type:'AgentMessage',id:assistant.payload.id},thread_id:source.sessionId,turn_id:source.sessionId+'/0',
      started_at_ms:Date.parse(assistant.timestamp)-20,completed_at_ms:Date.parse(assistant.timestamp)}});
    const uploaded=await f.upload(owner,rows,source.sessionId,{sourceVersion:'0.160.0'});await f.analyze(owner,uploaded.snapshotId);
    return {...f,owner,uploaded};
  }catch(error){await f.close();throw error;}
}
async function ready(page:Page,origin:string,snapshot:string,credential:string){
  await page.goto(`${origin}/#${snapshot}`);await page.getByLabel('个人读取凭据').fill(credential);
  await page.getByRole('button',{name:'进入存档',exact:true}).click();
  await expect(page.getByRole('heading',{level:1,name:'核查合成接口的可访问性 elements=3',exact:true})).toBeVisible();
}
async function stable(page:Page){
  await page.evaluate(()=>Promise.allSettled(document.getAnimations().map(animation=>animation.finished)));
  await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
}
async function targets(page:Page){
  return page.locator('.session-detail a,.session-detail button,.session-detail summary,.conversation-tool-switch,.platform-rail a,.platform-rail button,.platform-topbar a,.platform-topbar button,.platform-skip:focus').evaluateAll(elements=>elements
    .filter(element=>element.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})&&!element.closest('[inert]')&&!(element as HTMLButtonElement).disabled)
    .map(element=>{const box=element.getBoundingClientRect();return {label:element.getAttribute('aria-label')??element.textContent?.trim(),width:box.width,height:box.height};}));
}
async function checkLayout(page:Page){
  assert.deepEqual(await page.evaluate(()=>({x:document.documentElement.scrollWidth>innerWidth,y:document.documentElement.scrollHeight>innerHeight})),{x:false,y:false});
  const observed=await targets(page);assert.ok(observed.length>=10);
  assert.deepEqual(observed.filter(target=>target.width<43.9||target.height<43.9),[],'Every operable reading and navigation target is at least 44 × 44 CSS pixels');
}

test('public conversation, source and trace controls support touch and keyboard within fixed reading panels',{timeout:180_000},async()=>{
  const f=await readerFixture(),evidence=process.env.SKYNET_READER_EVIDENCE??f.directory;
  let browser:Browser|undefined;const sizes:unknown[]=[];
  try{
    await mkdir(evidence,{recursive:true});browser=await chromium.launch();
    const page=await browser.newPage({ignoreHTTPSErrors:true,hasTouch:true,viewport:{width:320,height:900}}),errors:string[]=[];
    page.on('pageerror',error=>errors.push(error.message));await ready(page,f.origin,f.uploaded.snapshotId,f.owner.readerCredential);
    await page.getByRole('link',{name:'跳到主要内容',exact:true}).focus();
    sizes.push({width:320,targets:await targets(page)});
    await writeFile(join(evidence,'touch-observations.json'),JSON.stringify(sizes,null,2));
    await checkLayout(page);
    await page.keyboard.press('Enter');await expect(page.locator('#platform-main')).toBeFocused();
    for(const width of [320,390,768,1280,1920])for(const theme of ['light','dark'] as const){
      await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:theme});await stable(page);
      await checkLayout(page);sizes.push({width,theme,targets:await targets(page)});
      await page.screenshot({path:join(evidence,`reader-${width}-${theme}.png`),animations:'disabled'});
    }
    await page.setViewportSize({width:320,height:900});await stable(page);
    await page.getByRole('button',{name:'打开导航',exact:true}).tap();await stable(page);await checkLayout(page);
    await page.getByRole('button',{name:'切换至浅色主题',exact:true}).tap();
    assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),'light');
    await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'打开导航',exact:true})).toBeFocused();
    const trace=page.locator('.conversation-session-trace>summary');await trace.focus();await page.keyboard.press('Enter');
    await expect(page.locator('.conversation-trace-list>li').first()).toBeVisible();
    const traceItem=page.locator('.conversation-trace-list summary').first();await traceItem.focus();await page.keyboard.press('Enter');
    await expect(page.locator('.conversation-trace-list .conversation-trace-facts').first()).toBeVisible();await checkLayout(page);
    await trace.tap();await expect(page.locator('.conversation-session-trace')).not.toHaveAttribute('open');
    await page.getByLabel('显示工具调用与结果').check();await expect(page.locator('.conversation-tool-card').first()).toBeVisible();
    const tool=page.locator('.conversation-tool-card>summary').first();await stable(page);await tool.tap();
    await expect(page.locator('.conversation-tool-content').first()).toBeVisible();await checkLayout(page);
    const peer=page.locator('.conversation-tool-peer').first();await peer.scrollIntoViewIfNeeded();await peer.tap();
    const result=page.locator('[data-conversation-focused="true"]');await expect(result).toBeFocused();
    await expect(result.locator('.conversation-tool-card')).toHaveAttribute('open');
    await expect(result).toContainText('# pass 1');await expect(result).toBeInViewport();await checkLayout(page);
    await page.screenshot({path:join(evidence,'reader-touch-tool-result.png'),animations:'disabled'});
    await page.emulateMedia({reducedMotion:'reduce'});await page.getByRole('button',{name:'打开导航',exact:true}).tap();await stable(page);
    assert.equal(await page.locator('.platform-rail').evaluate(element=>getComputedStyle(element).transform),'none');
    await page.keyboard.press('Escape');assert.deepEqual(errors,[]);
    assert.deepEqual(Buffer.from(await (await f.api(f.owner,`/api/snapshots/${f.uploaded.snapshotId}/raw`)).arrayBuffer()),f.uploaded.bytes);
  }finally{await writeFile(join(evidence,'touch-observations.json'),JSON.stringify(sizes,null,2));await browser?.close();await f.close();}
});

test('session identity survives reading modes, analysis-original links and direct anchors without leaking into another snapshot',{timeout:180_000},async()=>{
  const f=await readerFixture(),evidence=process.env.SKYNET_READER_EVIDENCE??f.directory;
  let browser:Browser|undefined;
  const title='核查合成接口的可访问性 elements=3';
  try{
    await mkdir(evidence,{recursive:true});browser=await chromium.launch();
    const page=await browser.newPage({ignoreHTTPSErrors:true,viewport:{width:1280,height:900}});
    await ready(page,f.origin,f.uploaded.snapshotId,f.owner.readerCredential);
    await page.getByRole('link',{name:'时间线',exact:true}).click();
    await expect(page.getByRole('link',{name:'时间线',exact:true})).toHaveAttribute('aria-current','page');
    await expect(page.getByRole('region',{name:'对话阅读',exact:true})).toHaveCount(0);
    await expect(page.locator('.session-reading>.message').first()).toContainText(title);
    await page.screenshot({path:join(evidence,'identity-timeline.png'),animations:'disabled'});
    await expect(page.getByRole('heading',{level:1,name:title,exact:true})).toBeVisible();
    await page.getByRole('link',{name:'原件 JSONL',exact:true}).click();
    await expect(page.getByRole('region',{name:'命中证据',exact:true})).toContainText('session_meta');
    await expect(page.getByRole('heading',{level:1,name:title,exact:true})).toBeVisible();
    await page.getByRole('link',{name:'对话视图',exact:true}).click();
    await expect(page.getByRole('region',{name:'对话阅读',exact:true})).toBeVisible();
    const citation=page.getByRole('region',{name:'会话分析',exact:true}).locator('.analysis-result details').first();
    await citation.locator('summary').focus();await page.keyboard.press('Enter');
    const original=citation.locator('a').first();const anchor=await original.getAttribute('href');assert.ok(anchor);
    await original.focus();await page.keyboard.press('Enter');
    await expect(page.getByRole('region',{name:'命中证据',exact:true})).toBeFocused();
    await expect(page.getByRole('region',{name:'命中证据',exact:true})).toContainText(title);
    await expect(page.getByRole('heading',{level:1,name:title,exact:true})).toBeVisible();
    await page.screenshot({path:join(evidence,'identity-analysis-anchor.png'),animations:'disabled'});
    await page.goBack();await expect(page.getByRole('region',{name:'对话阅读',exact:true})).toBeVisible();
    await expect(page.getByRole('heading',{level:1,name:title,exact:true})).toBeVisible();
    const direct=await browser.newPage({ignoreHTTPSErrors:true,viewport:{width:320,height:900}});
    await ready(direct,f.origin,anchor.replace(/^#/,''),f.owner.readerCredential);
    await expect(direct.getByRole('region',{name:'命中证据',exact:true})).toContainText(title);
    await checkLayout(direct);await direct.close();
    const second=f.rows({prompts:1,verified:0});(second.rows as any[]).find(row=>row.payload?.role==='user').payload.content[0].text='另一会话的独立问题';
    const next=await f.upload(f.owner,second.rows,second.sessionId);
    await page.goto(`${f.origin}/#${next.snapshotId}`);
    await expect(page.getByRole('heading',{level:1,name:'另一会话的独立问题',exact:true})).toBeVisible();
    await page.getByRole('link',{name:'时间线',exact:true}).click();
    await expect(page.getByRole('heading',{level:1,name:'另一会话的独立问题',exact:true})).toBeVisible();
    assert.deepEqual(Buffer.from(await (await f.api(f.owner,`/api/snapshots/${f.uploaded.snapshotId}/raw`)).arrayBuffer()),f.uploaded.bytes);
  }finally{await browser?.close();await f.close();}
});

test('a delayed conversation response cannot undo the reading mode chosen while it was loading',{timeout:120_000},async()=>{
  const f=await readerFixture();let browser:Browser|undefined;
  let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
  let delivered!:()=>void;const settled=new Promise<void>(resolve=>{delivered=resolve;});
  try{
    browser=await chromium.launch();const page=await browser.newPage({ignoreHTTPSErrors:true,viewport:{width:320,height:900}});
    let intercepted=false,held=false;
    await page.route(`**/api/snapshots/${f.uploaded.snapshotId}/conversation?*`,async route=>{
      if(intercepted){await route.continue();return;}intercepted=true;
      const response=await route.fetch();assert.equal(response.status(),200);held=true;
      await gate;
      try{await route.fulfill({response});}finally{delivered();}
    });
    await page.goto(`${f.origin}/#${f.uploaded.snapshotId}`);await page.getByLabel('个人读取凭据').fill(f.owner.readerCredential);
    await page.getByRole('button',{name:'进入存档',exact:true}).click();
    await expect.poll(()=>held).toBe(true);
    await page.getByRole('link',{name:'时间线',exact:true}).click();
    await expect(page.getByRole('link',{name:'时间线',exact:true})).toHaveAttribute('aria-current','page');
    await expect(page.locator('.session-reading>.message').first()).toContainText('核查合成接口的可访问性 elements=3');
    release();await settled;await stable(page);
    await expect(page.getByRole('link',{name:'时间线',exact:true})).toHaveAttribute('aria-current','page');
    await expect(page.getByRole('region',{name:'对话阅读',exact:true})).toHaveCount(0);
    await expect(page.getByRole('heading',{level:1,name:'核查合成接口的可访问性 elements=3',exact:true})).toBeVisible();
    await checkLayout(page);
  }finally{release();await browser?.close();await f.close();}
});
