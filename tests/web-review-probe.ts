import test from 'node:test';
import { chromium,expect } from '@playwright/test';
import { ownedCommand as command,cleanupOwned } from './owned-command.js';
import { mcpSandbox } from './mcp-support.js';
import { readAnalysisConfig,publicConfig } from '../apps/analysis/config.js';
import { analysisQueue } from '../apps/analysis/queue.js';
import { executeAnalysis } from '../apps/analysis/execute.js';
import { beijingDate } from '../packages/contracts/reports.js';
import { monday,addDays } from '../packages/contracts/work-views.js';
import { pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

test('public authenticated Web states remain readable at320–1920 in both palettes', {timeout:600000}, async()=>{
const repo=resolve('.');const profile=process.env.SKYNET_WEB_PROFILE;const smoke=profile==='smoke',controlsOnly=profile==='controls';
const evidence=resolve(process.env.SKYNET_WEB_EVIDENCE??`../Skynet-evidence/v1-2026-09-30/web-review-${randomUUID()}`);
const execute=(file:string,args:string[],options:{cwd:string;windowsHide?:boolean})=>command(file,args,process.env,'',{cwd:options.cwd,timeoutMs:10000});
const {stdout:sourceHead}=await execute('git',['rev-parse','HEAD'],{cwd:repo});
const {stdout:sourceDiff}=await execute('git',['diff','HEAD'],{cwd:repo});
const assetPaths=['dist/web/index.html','dist/apps/server/app.js'];
const html=await readFile(join(repo,'dist/web/index.html'),'utf8');
for(const match of html.matchAll(/(?:src|href)="\/([^"?#]+)"/g))assetPaths.push(`dist/web/${match[1]}`);
const assetHash=async()=>Promise.all(assetPaths.map(async path=>({path,hash:createHash('sha256').update(await readFile(join(repo,path))).digest('hex')})));
const startedCompiledHashes=await assetHash();
const day = beijingDate(); const week = monday(day); const sunday = addDays(week, 6);
// Only the owned fixture reporting calendar advances. Original device enrollment,
// source timestamps and bytes remain actual public data. Not real elapsed days.
const reportNow = new Date(`${addDays(week, 7)}T09:00:00+08:00`);
const s = await mcpSandbox({ reportClock: () => reportNow });
const exportsChecked:{sha256:string;bytes:number;filename:string}[]=[];
let browser: any; const records: any[] = []; const phases: any[] = []; const errors: any[] = [];
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const json = (value: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
await mkdir(evidence, { recursive: true });
console.log(`Owned Web audit fixture: ${s.directory}; durable evidence: ${evidence}; head: ${sourceHead.trim()}`);

async function measurements(page: any) {
  return page.evaluate(() => {
    function rgba(value: string) { const numbers = value.match(/[\d.]+/g)?.map(Number) ?? []; return [numbers[0] ?? 0, numbers[1] ?? 0, numbers[2] ?? 0, numbers[3] ?? 1]; }
    function blend(fg: number[], bg: number[]) { const a = fg[3] ?? 1; return [0, 1, 2].map(i => fg[i]! * a + bg[i]! * (1 - a)).concat(1); }
    function background(el: Element) { const ancestors: Element[] = []; for (let p: Element | null = el; p; p = p.parentElement) ancestors.unshift(p);
      let color = [255, 255, 255, 1]; for (const p of ancestors) color = blend(rgba(getComputedStyle(p).backgroundColor), color); return color; }
    function luminance(color: number[]) { const linear = color.slice(0, 3).map(x => { const c = x / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; }); return linear[0]! * .2126 + linear[1]! * .7152 + linear[2]! * .0722; }
    function selector(el: Element) { return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${Array.from(el.classList).slice(0, 3).map(c => `.${c}`).join('')}`; }
    const texts: any[] = []; const overflow: any[] = []; const names: any[] = [];
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      const css = getComputedStyle(el); const rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height || css.visibility === 'hidden' || css.display === 'none') continue;
      if (rect.right > innerWidth + 1 || rect.left < -1) overflow.push({ selector: selector(el), left: rect.left, right: rect.right, width: rect.width, text: el.textContent?.slice(0, 100) });
      const text = Array.from(el.childNodes).filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent).join('').trim();
      if (text) { const bg = background(el); const fg = blend(rgba(css.color), bg); const a = luminance(fg), b = luminance(bg); const ratio = (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
        const size = parseFloat(css.fontSize); const large = size >= 24 || size >= 18.66 && Number(css.fontWeight) >= 700;
        const disabled = (el as HTMLButtonElement).disabled || !!el.closest('[disabled]');
        texts.push({ selector: selector(el), text: text.slice(0, 120), foreground: css.color, background: bg, fontSize: size, fontWeight: css.fontWeight,
          ratio, minimum: large ? 3 : 4.5, disabled, simplified: css.opacity !== '1' || css.backgroundImage !== 'none' }); }
      if (['SELECT', 'INPUT', 'BUTTON', 'TEXTAREA'].includes(el.tagName) && !(el as HTMLInputElement).hidden) {
        const bg=background(el),fg=blend(rgba(css.color),bg),a=luminance(fg),b=luminance(bg);
        names.push({ selector: selector(el), tag: el.tagName, label: (el as HTMLInputElement).labels ? Array.from((el as HTMLInputElement).labels!).map(label => label.innerText.slice(0, 120)).join(' / ') : el.getAttribute('aria-label'), text: el.textContent?.slice(0, 100),
          value:el.tagName==='INPUT'&&(el as HTMLInputElement).type==='password'?'[synthetic password glyphs]':(el as HTMLInputElement).value?.slice(0,120),
          foreground:css.color,background:bg,colorScheme:css.colorScheme,disabled:!!(el as HTMLButtonElement).disabled,focused:document.activeElement===el,
          ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05),minimum:4.5,geometry:{left:rect.left,right:rect.right,width:rect.width,height:rect.height} });
      }
    }
    const root = getComputedStyle(document.documentElement); const body = getComputedStyle(document.body);
    return { viewport: { width: innerWidth, height: innerHeight }, content: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth, offenders: overflow.slice(0, 30),
      preferenceDark: matchMedia('(prefers-color-scheme: dark)').matches, theme: { rootBackground: root.backgroundColor, bodyBackground: body.backgroundColor, foreground: body.color, colorScheme: root.colorScheme },
      textCount: texts.length, contrastFailures: texts.filter(x => !x.disabled && !x.simplified && x.ratio + .01 < x.minimum).slice(0, 50),
      minimumContrast: Math.min(...texts.filter(x => !x.disabled && !x.simplified).map(x => x.ratio)), controls: names.slice(0, 50),
      headings: Array.from(document.querySelectorAll('h1,h2,h3')).map(el => el.textContent), alerts: Array.from(document.querySelectorAll('[role=alert]')).map(el => el.textContent) };
  });
}

try {
  browser = await chromium.launch({ headless: true });
  const longEmployee = `SyntheticEmployee_${'UnbrokenIdentifier'.repeat(10)}`;
  const manager = await s.provision(longEmployee, true);
  const project = `/synthetic/${'UnbrokenProjectIdentifier'.repeat(22)}`;
  const api = (path: string, token = manager.readerCredential, init: RequestInit = {}) => s.api(path, token, init);
  const device = await (await api('/api/devices/enroll', manager.enrollmentCredential, json({ installationId: randomUUID(), name: `SyntheticDevice_${'NoBreak'.repeat(25)}` }))).json();
  let snapshotId = ''; let dailyRevision = 0;
  const pages = () => [
    { id: 'archive', nav: '会话存档', hash: snapshotId ? `#${snapshotId}` : '', ready: '会话原件', failure: '/api/sessions' },
    { id: 'coverage', nav: '团队覆盖', hash: '', ready: '团队覆盖', failure: '/api/team-coverage' },
    { id: 'delivery', nav: '设备同步', hash: '', ready: '设备同步', failure: '/api/devices/status' },
    { id: 'analysis', nav: '分析队列', hash: '', ready: '分析队列与资源', failure: '/api/analysis/operations' },
    { id: 'daily', nav: '日工作', hash: `#daily?${new URLSearchParams({ employeeId: manager.employeeId, date: day, ...(dailyRevision ? { revision: String(dailyRevision) } : {}) })}`, ready: '日工作', failure: '/api/daily-reports/' },
    { id: 'weekly', nav: '周工作与项目', hash: `#work?${new URLSearchParams({ kind: 'weekly', subject: manager.employeeId, from: week, to: sunday })}`, ready: '周工作与项目', failure: '/api/work-view' },
    { id: 'project', nav: '周工作与项目', hash: `#work?${new URLSearchParams({ kind: 'project', subject: project, from: day, to: day })}`, ready: '周工作与项目', failure: '/api/work-view' },
    { id: 'server', nav: '运行与备份', hash: '', ready: '服务器运行与备份', failure: '/api/server/operations' },
    { id: 'corrections', nav: '日工作', hash: `#daily?${new URLSearchParams({employeeId:manager.employeeId,date:day})}`,ready:'日工作',failure:'/corrections' },
    { id: 'identities', nav: '接入与设备', hash: '', ready: '接入与设备', failure: '/api/identities' },
  ];
  async function capture(phase: string, entry: any, width: number, color: string, outage = false) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: color, ignoreHTTPSErrors: true });
    // Explicit local failure injection only, normal TLS API remains the source.
    if (outage) await context.route('**/api/**', async (route: any) => {
      if (new URL(route.request().url()).pathname.includes(entry.failure)) await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: '合成故障：此读取暂不可用' }) }); else await route.continue();
    });
    const page = await context.newPage(); const pageErrors: string[] = [];
    // tsx/esbuild preserves local function names using __name; the serialized
    // measurement function runs in the browser, where that harmless helper is
    // otherwise absent. This only supplies the transform helper to the fixture.
    await page.addInitScript('globalThis.__name = (target) => target;');
    page.on('pageerror', (error: Error) => pageErrors.push(error.message));
    try {
      await page.goto(s.origin + '/' + entry.hash);
      await page.getByLabel('个人读取凭据').fill(manager.readerCredential); await page.getByRole('button', { name: '进入存档', exact: true }).click();
      await page.getByRole('button', { name: entry.nav, exact: true }).click();
      await page.getByRole('heading', { name: entry.ready, exact: true, level: 1 }).waitFor();
      if (phase === 'populated' && entry.id === 'archive') await page.getByRole('heading', { name: project, exact: true }).waitFor();
      if(phase==='populated'&&entry.id==='archive'){
        const original=page.locator('.message pre').filter({hasText:'SYNTHETIC_OUTPUT_'});
        await expect(original).toHaveText(output,{timeout:10000});
        const geometry=await original.evaluate((el:HTMLElement)=>({client:el.clientWidth,scroll:el.scrollWidth,characters:el.textContent!.length}));
        assert.equal(geometry.characters,output.length);assert.ok(geometry.scroll<=geometry.client+1,'Complete long original must wrap within its reading surface');
        if(!exportsChecked.length){const downloaded=page.waitForEvent('download');await page.getByRole('button',{name:'下载原件',exact:true}).click();
          const download=await downloaded;const filename='public-original-export.jsonl';await download.saveAs(join(evidence,filename));const bytes=await readFile(join(evidence,filename));
          assert.deepEqual(bytes,raw,'Web binary original export must preserve every source byte');exportsChecked.push({sha256:digest(bytes),bytes:bytes.length,filename});}
      }
      if(entry.id==='corrections'){await page.getByText('全部更正历史（当前记录，不改写本版）',{exact:true}).click();await page.getByRole('button',{name:'读取更多更正历史'}).click();}
      if(controlsOnly&&entry.id==='corrections'){
        await page.getByLabel('更正原因',{exact:true}).fill('合成控件对比度读取');await page.getByLabel('追加说明',{exact:true}).fill('合成输入与textarea文本；没有提交更正。');
        await page.getByLabel('追加说明',{exact:true}).focus();
      }
      if (outage){await page.getByRole('alert').first().waitFor();if(entry.id==='analysis')await expect(page.getByText('读取状态…',{exact:true})).toHaveCount(0);}
      else await page.waitForTimeout(250);
      if (entry.id === 'archive') await page.getByText('接入设备 · npm / 插件安装说明', { exact: true }).click();
      const measurement = await measurements(page);
      const filename = `${phase}-${entry.id}-${width}-${color}${outage ? '-failure' : ''}.png`;
      await page.screenshot({ path: join(evidence, filename), fullPage: true, animations: 'disabled' });
      records.push({ phase, page: entry.id, width, color, outage, screenshot: filename, pageErrors, ...measurement });
      await writeFile(join(evidence, 'progress.json'), JSON.stringify({ sourceHead: sourceHead.trim(), records, phases, errors }, null, 2));
      console.log(`${phase}/${entry.id}/${width}/${color}: overflow=${measurement.horizontalOverflow}, contrastFailures=${measurement.contrastFailures.length}, screenshot=${filename}`);
    } catch (error) { errors.push({ phase, page: entry.id, width, color, outage, error: String(error) }); console.log(`CAPTURE FAILED ${phase}/${entry.id}: ${String(error)}`); }
    finally { await context.close(); }
  }
  if(!smoke&&profile!=='race')for(const phase of controlsOnly?['empty','populated']:['empty','populated','error'])for(const width of controlsOnly?[320]:[320,375,760,1280,1920])for(const color of ['light','dark']){
    const context=await browser.newContext({viewport:{width,height:900},colorScheme:color,ignoreHTTPSErrors:true});const page=await context.newPage();
    await page.addInitScript('globalThis.__name = (target) => target;');
    try{await page.goto(s.origin);if(phase!=='empty')await page.getByLabel('个人读取凭据').fill('explicit-synthetic-invalid-credential-'.repeat(20));
      if(controlsOnly)await page.getByLabel('个人读取凭据').focus();
      if(phase==='error'){await page.getByRole('button',{name:'进入存档',exact:true}).click();await page.getByRole('alert').waitFor();}
      const measurement=await measurements(page);const filename=`${phase}-login-${width}-${color}.png`;await page.screenshot({path:join(evidence,filename),fullPage:true});
      records.push({phase,page:'login',width,color,outage:phase==='error',screenshot:filename,pageErrors:[],...measurement});
    }finally{await context.close();}
  }
  // Empty-state screenshots are real public reads with a bound but idle device.
  if(!smoke&&profile!=='race'&&!controlsOnly)for(const entry of pages())for(const width of [320,375,760,1280,1920])for(const color of ['light','dark'])await capture('empty',entry,width,color);
  phases.push({ phase: 'empty', boundary: 'Public authentication, managed synthetic employee/device, no archived activity or reports yet.' });
  const timestamp = new Date(Date.now() + 60000).toISOString(); const sessionId = randomUUID();
  const output = `SYNTHETIC_OUTPUT_${'NoWhitespaceText'.repeat(20000)}`;
  const raw = Buffer.from([
    { type: 'session_meta', timestamp, payload: { id: sessionId, cwd: project, source: 'cli', cli_version: '0.157.1' } },
    { type: 'response_item', timestamp, payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '合成主题：全页阅读检查，目标是核查布局，阻塞是合成未知状态，不是实际员工结论。' }] } },
    { type: 'response_item', timestamp, payload: { type: 'function_call', call_id: 'large-fixture', name: 'shell', arguments: '{"command":"synthetic-test"}' } },
    { type: 'response_item', timestamp, payload: { type: 'function_call_output', call_id: 'large-fixture', output } },
  ].map(row => JSON.stringify(row)).join('\n') + '\n');
  assert.equal((await api(`/api/chunks/${digest(raw)}`, device.deviceCredential, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: new Uint8Array(raw) })).status, 201);
  const commit = await api('/api/snapshots', device.deviceCredential, json({ protocolVersion: 1, sourceSessionId: sessionId, source: 'codex-cli', sourceVersion: '0.157.1', sourceOs: process.platform,
    project, hash: digest(raw), byteLength: raw.length, qualifiedAt: timestamp, capability: 'unverified' }));
  assert.equal(commit.status, 200, await commit.clone().text()); snapshotId = (await commit.json()).snapshotId;
  const now = new Date().toISOString();
  assert.equal((await api('/api/devices/health', device.deviceCredential, json({ nonce: randomUUID(), source: 'codex-cli', installation: { clients: [{ source: 'codex-cli', configured: true, hostEvent: 'observed' }] },
    delivery: { pendingSnapshots: 1, pendingBytes: raw.length, oldestPendingAt: now, lastSuccessAt: now, attempts: 1, nextAttemptAt: now, lastFailure: { at: now, kind: 'server-unavailable', status: 503 }, lastRejection: null, quotaBytes: 10000000, quotaSnapshots: 100, quotaBlocked: false },
    capture: { checkedAt: now, observation: 'host-event-observed', locallyPersisted: true, faults: [{ id: randomUUID(), code: 'source-missing', scope: 'source', firstObservedAt: now, lastObservedAt: now, recoveredAt: null, coverage: 'unverified-range' }] } }))).status, 200);
  const configPath = join(s.directory, 'explicit-zero-cost-synthetic-runner.json');
  await writeFile(configPath, JSON.stringify({ mode: 'fixture', executable: process.execPath, runtimeVersion: '2.1.281', model: 'synthetic-web-audit', workDirectory: join(s.directory, 'jobs'), fixtureOrigin: 'http://127.0.0.1:9',
    budgetId: 'web-audit-fixture', budgetCny: 0, inputCnyPerMillion: 0, outputCnyPerMillion: 0, maxSessionBytes: 1048576, maxInputBytes: 131072, maxRequests: 3, maxAttempts: 1, autoAnalyzeUpdates: false, timeoutSeconds: 30 }));
  const config = await readAnalysisConfig(configPath); const queue = analysisQueue(s.testDatabase, config, 'web-audit-synthetic');
  await s.testDatabase.query('INSERT INTO analysis_workers(id,config) VALUES($1,$2)', ['web-audit-synthetic', publicConfig(config)]);
  assert.equal((await api(`/api/daily-reports/${manager.employeeId}/${day}`, manager.readerCredential, json({}))).status, 202);
  const selections = [{ kind: 'weekly', subject: manager.employeeId, from: week, to: sunday }, { kind: 'project', subject: project, from: day, to: day }];
  for (const selection of selections) assert.equal((await api(`/api/work-view?${new URLSearchParams(selection)}`, manager.readerCredential, json({}))).status, 202);
  for (let attempt = 0; attempt < 80; attempt++) {
    await s.testDatabase.query("UPDATE analysis_workers SET updated_at=now() WHERE id='web-audit-synthetic'");
    for (let i = 0; i < 10; i++) { const job = await queue.claim(); if (!job) break;
      const result = await executeAnalysis(config, job.input, new AbortController().signal, () => queue.allowForward(job), async (_config: any, input: any, _signal: any, beforeForward: any) => {
        assert.equal(await beforeForward(), true); const event = input.events.findIndex((item: any) => item.role === 'user');
        return { output: { items: event < 0 ? [] : ['topic', 'goal', 'blocker'].map(category => ({ category, assessment: 'claimed', text: `合成 ${category}：${input.events[event].text}`, citations: [{ event, textOffset: 0, quote: input.events[event].text }] })) },
          usage: { inputTokens: 100, outputTokens: 20, runtimeCostUsd: null, providerBilledCny: null, requests: 1 } };
      }); assert.equal(await queue.finish(job, result), true); }
    const daily = await (await api(`/api/daily-reports/${manager.employeeId}/${day}`)).json();
    const views = await Promise.all(selections.map(selection => api(`/api/work-view?${new URLSearchParams(selection)}`).then((response: Response) => response.json())));
    if (daily.items.length && !daily.refreshPending && views.every(view => view.items.length && !view.refreshPending)) { dailyRevision = daily.revision; break; }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.ok(dailyRevision, 'Owned synthetic reports did not become readable; no provider fallback allowed');
  phases.push({ phase: 'populated', sourceBytes: raw.length, outputCharacters: output.length, employeeNameLength: longEmployee.length, projectLength: project.length,
    snapshotId, dailyRevision, syntheticReportClock: reportNow.toISOString(), boundary: 'Public uploads and requests, trusted zero-cost synthetic runner seam; no real CLI/provider/Task/user configuration.' });
  if(process.env.SKYNET_WEB_PROFILE==='race'){
    const context=await browser.newContext({ignoreHTTPSErrors:true});const page=await context.newPage();
    let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);let paging!:()=>void;const entered=new Promise<void>(resolve=>paging=resolve);
    await context.route('**/api/daily-reports/**',async(route:any)=>{
      const url=new URL(route.request().url());if(!url.pathname.endsWith('/'+day)||url.pathname.endsWith('/corrections'))return route.continue();
      const response=await route.fetch();const value=await response.json();
      if(url.searchParams.has('offset')){paging();await gate;return route.fulfill({response,json:{...value,nextOffset:null}});}
      return route.fulfill({response,json:{...value,nextOffset:20}});
    });
    try{
      await page.goto(s.origin+`/#daily?${new URLSearchParams({employeeId:manager.employeeId,date:day,revision:String(dailyRevision)})}`);
      await page.getByLabel('个人读取凭据').fill(manager.readerCredential);await page.getByRole('button',{name:'进入存档',exact:true}).click();
      await page.getByRole('button',{name:'读取本版更多主题'}).waitFor();await page.getByRole('button',{name:'读取本版更多主题'}).click();await entered;
      const other=addDays(day,-1);await page.getByLabel('来源日期',{exact:true}).fill(other);
      await expect(page.getByRole('region',{name:'日工作'}).getByRole('heading',{level:2})).toContainText(other);
      release();await page.waitForTimeout(250);
      await expect(page.getByRole('region',{name:'日工作'}).getByRole('heading',{level:2})).toContainText(other);
      await writeFile(join(evidence,'race-result.json'),JSON.stringify({sourceHead:sourceHead.trim(),sourceDiffHash:digest(sourceDiff),pagingRevision:dailyRevision,selectedDate:other,retainsSelectedScope:true,boundary:'Controlled delayed pagination transport over real authenticated report; no paid provider.'},null,2));
    }finally{release();await context.close();}
    return;
  }
  for(const entry of pages().filter(entry=>controlsOnly?['corrections','daily','server'].includes(entry.id):!smoke||['daily','archive'].includes(entry.id)))for(const width of smoke||controlsOnly?[320]:[320,375,760,1280,1920])for(const color of smoke?['dark']:['light','dark'])await capture('populated',entry,width,color);
  if(controlsOnly)for(const width of [320,375,760,1280,1920])for(const color of ['light','dark'])await capture('error',pages().find(entry=>entry.id==='analysis'),width,color,true);
  if(!smoke&&profile!=='race'&&!controlsOnly)for(const entry of pages())for(const width of [320,375,760,1280,1920])for(const color of ['light','dark'])await capture('error',entry,width,color,true);
  const { stdout: finalHead } = await execute('git', ['rev-parse', 'HEAD'], { cwd: repo, windowsHide: true });
  const compiledHashes = await assetHash();
  await writeFile(join(evidence, 'result.json'), JSON.stringify({ startedSourceHead: sourceHead.trim(), finishedSourceHead: finalHead.trim(), compiledHashes,
    startedCompiledHashes,
    sourceDiffHash:digest(sourceDiff),profile:profile??'all-widths-all-states',checkedAt: new Date().toISOString(), records, phases, errors,exportsChecked, boundary: 'Public UI fixture includes synthetic correction history and operations; simulated reading failures only, no paid model/Task,  G4 second operator/performance/5-day trial remain open. Native control CSS text contrast includes values and selected labels, backgrounds and focus; OS-painted glyphs, popups, disabled opacity and full accessibility conformance remain outside this simplified calculation.' }, null, 2));
  console.log(`FINISHED: ${records.length} captures; ${records.filter(record => record.horizontalOverflow).length} horizontal overflows; ${errors.length} capture errors.`);
  assert.equal(errors.length, 0, 'Capture errors are probe failures; see durable result.json');
  assert.equal(records.filter(record=>record.horizontalOverflow).length,0,'Horizontal reading overflow; see screenshots');
  assert.equal(records.filter(record=>record.color==='dark'&&record.theme.colorScheme!=='dark').length,0,'Dark mode must change real surfaces/native controls');
  assert.equal(records.reduce((count,record)=>count+record.contrastFailures.length,0),0,'Computed visible text contrast below threshold');
  assert.equal(records.flatMap(record=>record.controls).filter(control=>!control.disabled&&control.ratio+.01<control.minimum).length,0,'Native control computed text contrast below4.5');
  assert.deepEqual(compiledHashes, startedCompiledHashes, 'Compiled assets changed during the probe; repeat on a stable checkout');
} finally { await cleanupOwned([()=>browser?.close()??Promise.resolve(),()=>s.close()]); }
});
