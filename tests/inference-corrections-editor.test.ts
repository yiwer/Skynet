import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium,expect,type Browser} from '@playwright/test';
import {assessmentFixture} from './assessment-fixture.js';

test('unchanged insight refresh preserves an open correction draft; save and snapshot navigation clear it',{timeout:120000},async()=>{
  const f=await assessmentFixture();let browser:Browser|undefined,release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});
  try{
    const owner=await f.owner('更正草稿'),first=await f.session(owner,{prompts:3}),second=await f.session(owner,{prompts:3});
    const initial=await(await f.api(owner,'/api/snapshots/'+first.snapshotId+'/insights')).json();
    browser=await chromium.launch();const page=await browser.newPage({ignoreHTTPSErrors:true,viewport:{width:1280,height:900}});
    await page.route('**/api/snapshots/'+first.snapshotId+'/analysis?*',async route=>{await held;await route.continue();});
    await page.goto(f.origin+'/#'+first.snapshotId);await page.getByLabel('个人读取凭据').fill(owner.readerCredential);await page.getByRole('button',{name:'进入存档',exact:true}).click();
    const inspector=page.getByRole('region',{name:'会话洞察',exact:true}),editor=inspector.getByText('更正推断',{exact:true}),reason=inspector.getByLabel('更正原因');
    await editor.click();await inspector.getByLabel('新任务类型').selectOption('investigation');await reason.fill('仍在编辑的原句核查原因');
    await editor.click();await expect(reason).toBeHidden();await editor.click();await expect(reason).toHaveValue('仍在编辑的原句核查原因');
    const ready=page.waitForResponse(response=>response.url().includes('/analysis?'));release();await ready;await expect(page.getByRole('region',{name:'会话分析',exact:true})).toContainText('分析已完成');
    await expect(reason).toBeVisible();await expect(reason).toHaveValue('仍在编辑的原句核查原因');await expect(inspector.getByLabel('新任务类型')).toHaveValue('investigation');
    await inspector.getByRole('button',{name:'保存更正',exact:true}).click();await expect(inspector.locator('.insight-status')).toContainText('排查');
    await editor.click();await expect(reason).toHaveValue('');await reason.fill('历史查看前的草稿');
    await page.goto(f.origin+'/#'+first.snapshotId+'?insightVersion='+initial.version);await expect(editor).toHaveCount(0);await inspector.getByRole('link',{name:'查看当前洞察',exact:true}).click();await editor.click();await expect(reason).toHaveValue('');await reason.fill('不能带到其他会话的草稿');
    await page.goto(f.origin+'/#'+second.snapshotId);await expect(inspector.locator('.insight-status')).toContainText('实现');await editor.click();await expect(reason).toHaveValue('');await expect(inspector.getByLabel('新任务类型')).toHaveValue('implementation');
    const audit=await(await f.api(owner,'/api/snapshots/'+first.snapshotId+'/inference-corrections')).json();assert.equal(audit.corrections.length,1);assert.equal(audit.corrections[0].reason,'仍在编辑的原句核查原因');
  }finally{release();await browser?.close();await f.close();}
});

test('a changed insight preserves a draft and requires explicit review before submitting against the new version',{timeout:120000},async()=>{
  const f=await assessmentFixture();let browser:Browser|undefined;
  try{
    const owner=await f.owner('版本冲突'),record=await f.session(owner,{prompts:3}),path='/api/snapshots/'+record.snapshotId;
    browser=await chromium.launch();const page=await browser.newPage({ignoreHTTPSErrors:true,viewport:{width:320,height:900}});
    await page.goto(f.origin+'/#'+record.snapshotId);await page.getByLabel('个人读取凭据').fill(owner.readerCredential);await page.getByRole('button',{name:'进入存档',exact:true}).click();
    await page.evaluate(()=>document.documentElement.dataset.theme='dark');
    await expect(page.getByRole('region',{name:'会话分析',exact:true})).toContainText('分析已完成');
    const inspector=page.getByRole('region',{name:'会话洞察',exact:true}),editor=inspector.getByText('更正推断',{exact:true}),reason=inspector.getByLabel('更正原因');
    const before=await(await f.api(owner,path+'/insights')).json();
    for(const [index,selection,label,value] of [[0,'task-type','新任务类型','investigation'],[1,'prompt-elements:'+before.inferences.prompts[0].event,'目标判定','false'],[2,'rework:'+before.inferences.prompts[1].event,'返工判定','true']] as const){
      await editor.click();await inspector.getByLabel('更正字段').selectOption(selection);await inspector.getByLabel(label).selectOption(value);await reason.fill('保留此更正草稿 '+index);
      const original=await(await f.api(owner,path+'/insights')).json();
      assert.equal((await f.api(owner,path+'/inference-corrections',{requestId:randomUUID(),expectedVersion:original.version,kind:'task-type',value:index%2?'documentation':'fix',reason:'另一次公开更正 '+index})).status,201);
      await inspector.getByRole('button',{name:'刷新会话洞察',exact:true}).click();
      await expect(inspector.getByRole('alert')).toContainText('洞察已更新，草稿已保留');await expect(reason).toBeVisible();await expect(reason).toHaveValue('保留此更正草稿 '+index);await expect(inspector.getByLabel(label)).toHaveValue(value);await expect(inspector.getByRole('button',{name:'保存更正',exact:true})).toBeDisabled();
      const targets=await inspector.locator('.inference-conflict button').evaluateAll(nodes=>nodes.map(node=>{const box=node.getBoundingClientRect();return {width:box.width,height:box.height};}));assert.ok(targets.every(box=>box.width>=44&&box.height>=44));
      if(index===0&&process.env.SKYNET_CORRECTIONS_EVIDENCE_DIR){await mkdir(process.env.SKYNET_CORRECTIONS_EVIDENCE_DIR,{recursive:true});await inspector.locator('.inference-conflict').scrollIntoViewIfNeeded();await page.screenshot({path:join(process.env.SKYNET_CORRECTIONS_EVIDENCE_DIR,'draft-conflict-320-dark.png'),animations:'disabled'});}
      assert.equal((await(await f.api(owner,path+'/inference-corrections')).json()).corrections.length,index*2+1);
      await inspector.getByRole('button',{name:'核对新版后继续',exact:true}).click();await expect(reason).toHaveValue('保留此更正草稿 '+index);await expect(inspector.getByRole('button',{name:'保存更正',exact:true})).toBeEnabled();
      await inspector.getByRole('button',{name:'保存更正',exact:true}).click();await expect(reason).toBeHidden();
      await expect.poll(async()=> (await(await f.api(owner,path+'/inference-corrections')).json()).corrections.length).toBe(index*2+2);
    }
    const audit=await(await f.api(owner,path+'/inference-corrections')).json();assert.equal(audit.corrections.find((row:any)=>row.reason==='保留此更正草稿 0').previous,'fix');
    await editor.click();await expect(reason).toHaveValue('');await inspector.getByLabel('新任务类型').selectOption('operations');await reason.fill('未刷新页面时仍保留的草稿');
    const previous=await(await f.api(owner,path+'/insights')).json();assert.equal((await f.api(owner,path+'/inference-corrections',{requestId:randomUUID(),expectedVersion:previous.version,kind:'task-type',value:'test',reason:'保存前另一次更正'})).status,201);
    const rejected=page.waitForResponse(response=>response.url().endsWith('/inference-corrections')&&response.request().method()==='POST');await inspector.getByRole('button',{name:'保存更正',exact:true}).click();assert.equal((await rejected).status(),409);
    await expect(inspector.getByText('洞察已更新，草稿已保留。',{exact:true})).toBeVisible();await expect(reason).toHaveValue('未刷新页面时仍保留的草稿');await expect(inspector.getByLabel('新任务类型')).toHaveValue('operations');await expect(inspector.getByRole('button',{name:'保存更正',exact:true})).toBeDisabled();
    assert.equal((await(await f.api(owner,path+'/inference-corrections')).json()).corrections.length,7);
    await inspector.getByRole('button',{name:'核对新版后继续',exact:true}).click();await inspector.getByRole('button',{name:'保存更正',exact:true}).click();await expect(reason).toBeHidden();
    await expect.poll(async()=> (await(await f.api(owner,path+'/inference-corrections')).json()).corrections.length).toBe(8);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight));
  }finally{await browser?.close();await f.close();}
});
