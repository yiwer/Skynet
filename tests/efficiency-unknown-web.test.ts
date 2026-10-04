import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium,expect,type Browser} from '@playwright/test';
import {assessmentFixture} from './assessment-fixture.js';

test('unknown efficiency keeps a compact state and evidence while known zero remains a chart point',{timeout:120000},async()=>{
  const f=await assessmentFixture();let browser:Browser|undefined;
  const directory=process.env.SKYNET_EFFICIENCY_UNKNOWN_EVIDENCE??join(f.directory,'efficiency-unknown');await mkdir(directory,{recursive:true});
  try{
    const owner=await f.owner('产效未知员工'),native=f.rows({prompts:3,tokens:1000,active:true});await f.upload(owner,native.rows,native.sessionId);
    const unknown=await(await f.api(owner,'/api/session-efficiency?period=since-enrollment')).json();assert.equal(unknown.total,1);assert.equal(unknown.sessions[0].efficiency.value,null);
    browser=await chromium.launch();const context=await browser.newContext({ignoreHTTPSErrors:true,reducedMotion:'reduce',viewport:{width:1280,height:900}}),page=await context.newPage();
    const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(f.origin+'/#efficiency');await page.getByLabel('个人读取凭据').fill(owner.readerCredential);await page.getByRole('button',{name:'进入存档',exact:true}).click();
    const panel=page.getByRole('region',{name:'会话产效',exact:true});await panel.getByRole('button',{name:'接入至今',exact:true}).click();await expect(panel).toHaveAttribute('aria-busy','false');
    const status=panel.getByRole('status',{name:'产效数据状态'});await expect(status).toHaveText('产效暂未知1 个会话');
    await expect(panel.getByRole('group',{name:'按任务类型产效分布图',exact:true})).toHaveCount(0);
    const screenshots:string[]=[];
    for(const width of [320,390,768,1280,1920])for(const theme of ['light','dark']){
      await page.setViewportSize({width,height:900});await page.evaluate(value=>document.documentElement.dataset.theme=value,theme);await status.scrollIntoViewIfNeeded();
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth||document.documentElement.scrollHeight>innerHeight),false);
      const bounds=await status.boundingBox();assert.ok(bounds&&bounds.height<=140&&bounds.x>=0&&bounds.x+bounds.width<=width);
      const name=`unknown-${width}-${theme}.png`;await page.screenshot({path:join(directory,name),animations:'disabled'});screenshots.push(name);
    }
    await panel.getByRole('button',{name:'产效分布表格',exact:true}).click();const table=panel.getByRole('table',{name:'任务类型产效',exact:true});
    const cells=await table.locator('tbody tr').all();assert.equal(cells.length,unknown.distributions.length);
    for(let i=0;i<cells.length;i++){const values=cells[i]!.getByRole('cell'),expected=unknown.distributions[i];await expect(values.nth(0)).toHaveText(String(expected.count));await expect(values.nth(1)).toHaveText(String(expected.unknownCount));await expect(values.nth(2)).toHaveText('未知');}
    await panel.getByRole('button',{name:'查看会话分段',exact:true}).click();await expect(panel.getByRole('link',{name:'阅读原始对话',exact:true})).toHaveAttribute('href',unknown.sessions[0].webPath);
    const selected=panel.getByRole('region',{name:'选中会话',exact:true});
    await selected.getByRole('button',{name:'会话分段表格',exact:true}).focus();await page.keyboard.press('Space');
    const segments=selected.getByRole('table',{name:'会话分段明细',exact:true});await expect(segments).toBeVisible();
    await expect(segments.locator('tbody tr')).toHaveCount(unknown.sessions[0].timing.segmentTotal);
    assert.ok(unknown.sessions[0].timing.segments.some((segment:any)=>segment.durationMs===null));
    for(let index=0;index<unknown.sessions[0].timing.segments.length;index++){
      const expected=unknown.sessions[0].timing.segments[index],row=segments.locator('tbody tr').nth(index);
      if(expected.durationMs===null)await expect(row.getByRole('cell').nth(2)).toHaveText('未知');
      const timestamps=await row.locator('time').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('datetime')));assert.deepEqual(timestamps,[expected.startedAt,expected.endedAt].filter(Boolean));
    }
    const tableLinks=await segments.getByRole('link').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('href')));
    assert.deepEqual(tableLinks,unknown.sessions[0].timing.segments.flatMap((segment:any)=>segment.evidence.map((item:any)=>item.conversationPath??item.webPath)));
    await page.setViewportSize({width:320,height:900});await segments.scrollIntoViewIfNeeded();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth||document.documentElement.scrollHeight>innerHeight),false);
    const scrolling=segments.locator('..');assert.equal(await scrolling.evaluate(node=>node.scrollWidth>node.clientWidth),true,'The table must overflow its own scroll container');
    await scrolling.hover({position:{x:40,y:40}});await page.mouse.wheel(1200,0);await expect.poll(()=>scrolling.evaluate(node=>node.scrollLeft)).toBeGreaterThan(0);
    const rightColumn=await segments.locator('thead th').last().boundingBox();assert.ok(rightColumn&&rightColumn.x>=0&&rightColumn.x+rightColumn.width<=320,'The rightmost column is reachable within the viewport');
    await page.screenshot({path:join(directory,'segment-table-320-dark.png'),animations:'disabled'});screenshots.push('segment-table-320-dark.png');
    await selected.getByRole('button',{name:'会话分段图表',exact:true}).click();await expect(segments).toHaveCount(0);await expect(selected.getByRole('img',{name:/已确认分段/})).toBeVisible();
    const knownOwner=await f.owner('产效零值员工');await f.session(knownOwner,{prompts:3,tokens:1000,verified:0,claimed:0});
    const mixed=await(await f.api(owner,'/api/session-efficiency?period=since-enrollment')).json();assert.equal(mixed.total,2);assert.equal(mixed.sessions.find((item:any)=>item.employees.some((person:any)=>person.employeeId===knownOwner.employeeId)).efficiency.value,0);
    await panel.getByRole('button',{name:'接入至今',exact:true}).click();await expect(panel).toHaveAttribute('aria-busy','false');await panel.getByRole('button',{name:'产效分布图表',exact:true}).click();
    const graph=panel.getByRole('group',{name:'按任务类型产效分布图',exact:true});await expect(graph).toBeVisible();await expect(status).toHaveCount(0);
    const point=graph.getByRole('button',{name:/ · 0 · 0 \/ 1,000 Token/});await expect(point).toHaveCount(1);await point.focus();await expect(panel.getByRole('tooltip')).toBeVisible();
    await panel.getByLabel('员工',{exact:true}).selectOption(owner.employeeId);await expect(panel).toHaveAttribute('aria-busy','false');await expect(status).toHaveText('产效暂未知1 个会话');await expect(panel.getByRole('tooltip')).toHaveCount(0);assert.deepEqual(errors,[]);
    await writeFile(join(directory,'verification.json'),JSON.stringify({unknownVersion:unknown.version,mixedVersion:mixed.version,screenshots,unknownCount:1,knownZeroPoint:true,evidencePreserved:true,errors},null,2));
  }finally{await browser?.close();await f.close();}
});
