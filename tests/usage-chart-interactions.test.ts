import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {chromium,expect,type Browser,type Locator} from '@playwright/test';
import {assessmentFixture} from './assessment-fixture.js';
import type {UsageOutputPage} from '../packages/contracts/usage-output.js';

const evidence=process.env.SKYNET_USAGE_CHART_EVIDENCE;
const contrast=(a:number[],b:number[])=>{const light=(c:number[])=>c.slice(0,3).map(x=>x/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4).reduce((sum,x,i)=>sum+x*[.2126,.7152,.0722][i]!,0),x=light(a),y=light(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
const renderedColors=(locator:Locator)=>locator.evaluate(element=>{
  const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d')!;canvas.width=canvas.height=1;
  const s=getComputedStyle(element),figure=getComputedStyle(element.closest('.usage-figure')!);
  const values=[s.color,s.backgroundColor,s.outlineColor,figure.backgroundColor,s.fill,s.stroke].map(value=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=value;ctx.fillRect(0,0,1,1);return Array.from(ctx.getImageData(0,0,1,1).data);});
  return {text:values[0]!,background:values[1]!,focus:values[2]!,figureBackground:values[3]!,fill:values[4]!,stroke:values[5]!,width:parseFloat(s.outlineWidth),visible:element.matches(':focus-visible')};
});
test('employee token chart opens and dismisses exact agent values on touch and keyboard',{timeout:90000},async()=>{
  const f=await assessmentFixture();let browser:Browser|undefined;
  try{
    const owner=await f.owner('堆叠员工'),input=f.rows({prompts:2,tokens:1250,verified:0,claimed:0});
    await f.upload(owner,input.rows,input.sessionId);
    const response=await f.api(owner,'/api/usage-output?period=since-enrollment');assert.equal(response.status,200,await response.clone().text());const report=await response.json();assert.equal(report.totals.inputTokens,1250);
    browser=await chromium.launch();const page=await browser.newPage({hasTouch:true,ignoreHTTPSErrors:true,viewport:{width:320,height:900},reducedMotion:'reduce'});
    await page.goto(f.origin+'/#usage?'+new URLSearchParams({period:'since-enrollment',version:report.version}));
    await page.getByLabel('个人读取凭据').fill(owner.readerCredential);await page.getByRole('button',{name:'进入存档',exact:true}).click();
    const chart=page.getByRole('region',{name:'员工用量',exact:true}),target=chart.getByLabel(/堆叠员工.*Codex CLI.*1,250/),tip=chart.getByRole('tooltip');
    await target.tap();await expect(tip).toContainText('1,250');
    const targetBox=await target.boundingBox(),openTips=await tip.count();
    const geometry={target:targetBox,openTips,tip:openTips?await tip.boundingBox():null};
    if(evidence){await mkdir(evidence,{recursive:true});await writeFile(join(evidence,'employee-touch.json'),JSON.stringify(geometry,null,2));await page.screenshot({path:join(evidence,'employee-touch.png')});}
    assert.equal(openTips,1,'The first touch leaves the detail visible');
    await target.tap();await expect(tip).toHaveCount(0);
    assert.ok(geometry.target&&geometry.target.width>=44&&geometry.target.height>=44,'The chart detail target is at least 44 CSS pixels');
    await target.press('Tab');await page.keyboard.press('Shift+Tab');await expect(target).toBeFocused();await expect(tip).toContainText('1,250');
    await page.keyboard.press('Escape');await expect(tip).toHaveCount(0);await page.keyboard.press('Enter');await expect(tip).toContainText('1,250');
    await page.keyboard.press('Space');await expect(tip).toHaveCount(0);
    await chart.getByRole('button',{name:'员工用量切换为表格',exact:true}).click();
    assert.deepEqual(await chart.getByRole('table').locator('tbody tr').first().locator('th,td').allTextContents(),['堆叠员工','1,250','1,250','0']);
  }finally{await browser?.close();await f.close();}
});

test('scatter touch reads a session value before explicitly opening its fixed source',{timeout:90000},async()=>{
  const f=await assessmentFixture();let browser:Browser|undefined;
  try{
    const owner=await f.owner('散点员工');await f.session(owner,{prompts:1,tokens:1250,verified:1,claimed:0});
    const response=await f.api(owner,'/api/usage-output?period=since-enrollment');assert.equal(response.status,200);const report=await response.json();assert.equal(report.outputs.verified.value,1);
    browser=await chromium.launch();const page=await browser.newPage({hasTouch:true,ignoreHTTPSErrors:true,viewport:{width:320,height:900},reducedMotion:'reduce'});
    await page.goto(f.origin+'/#usage?'+new URLSearchParams({period:'since-enrollment',version:report.version}));
    await page.getByLabel('个人读取凭据').fill(owner.readerCredential);await page.getByRole('button',{name:'进入存档',exact:true}).click();
    const chart=page.getByRole('region',{name:'会话散点',exact:true}),target=chart.getByRole('button',{name:/散点员工.*1,250.*已验证 1/});
    await target.tap();
    if(evidence){await mkdir(evidence,{recursive:true});await page.screenshot({path:join(evidence,'scatter-touch.png')});await writeFile(join(evidence,'scatter-touch.json'),JSON.stringify({url:page.url(),tips:await chart.getByRole('dialog',{name:'会话点详情'}).allTextContents()},null,2));}
    await expect(page).toHaveURL(/#usage\?/);await expect(chart.getByRole('dialog',{name:'会话点详情'})).toContainText('1,250');
    await chart.getByRole('link',{name:'查看会话',exact:true}).click();await expect(page).toHaveURL(new RegExp(report.sessions[0].webPath.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$'));
  }finally{await browser?.close();await f.close();}
});

test('daily token values remain readable after a real touch and can be dismissed',{timeout:90000},async()=>{
  const f=await assessmentFixture();let browser:Browser|undefined;
  try{
    const owner=await f.owner('每日员工'),input=f.rows({prompts:1,tokens:1250,verified:0,claimed:0});
    await f.upload(owner,input.rows,input.sessionId);
    const response=await f.api(owner,'/api/usage-output?period=since-enrollment');assert.equal(response.status,200);const report=await response.json();
    browser=await chromium.launch();const page=await browser.newPage({hasTouch:true,ignoreHTTPSErrors:true,viewport:{width:390,height:900},reducedMotion:'reduce'});
    await page.goto(f.origin+'/#usage?'+new URLSearchParams({period:'since-enrollment',version:report.version}));
    await page.getByLabel('个人读取凭据').fill(owner.readerCredential);await page.getByRole('button',{name:'进入存档',exact:true}).click();
    const chart=page.getByRole('region',{name:'每日用量',exact:true}),target=chart.getByRole('button',{name:/每日员工.*1,250/}),tip=chart.getByRole('tooltip');
    await target.tap();
    if(evidence){await mkdir(evidence,{recursive:true});await page.screenshot({path:join(evidence,'daily-touch.png')});await writeFile(join(evidence,'daily-touch.json'),JSON.stringify({target:await target.boundingBox(),tips:await tip.count(),text:await tip.allTextContents()},null,2));}
    await expect(tip).toContainText('1,250');
    await target.tap();await expect(tip).toHaveCount(0);
  }finally{await browser?.close();await f.close();}
});

test('usage chart values, touch, clipping, contrast and reduced motion agree across five widths',{timeout:180000},async()=>{
  const f=await assessmentFixture();let browser:Browser|undefined;const observations:unknown[]=[],failures:string[]=[],errors:string[]=[],exports:string[]=[];
  try{
    const owner=await f.owner('甲·已知'),zero=await f.owner('乙·零值'),unknown=await f.owner('丙·未知'),near=await f.owner('丁·相邻');
    await f.session(owner,{prompts:1,tokens:1250,verified:1,claimed:0});await f.session(near,{prompts:1,tokens:1255,verified:1,claimed:0});
    const rawUnknown=f.rows({prompts:1,tokens:800,verified:1,claimed:0}),savedUnknown=await f.upload(unknown,rawUnknown.rows,rawUnknown.sessionId,{sourceVersion:'unsupported-synthetic'});await f.analyze(unknown,savedUnknown.snapshotId);
    async function claude(person:typeof owner,tokens:number){const id=randomUUID(),stamp=f.base.toISOString();return f.upload(person,[{type:'user',uuid:randomUUID(),sessionId:id,version:'2.1.281',timestamp:stamp,message:{role:'user',content:'合成 Claude 输入'}},{type:'assistant',uuid:randomUUID(),sessionId:id,version:'2.1.281',timestamp:stamp,message:{id:randomUUID(),role:'assistant',content:[{type:'text',text:'合成回答'}],usage:{input_tokens:tokens,output_tokens:0,cache_read_input_tokens:0,cache_creation_input_tokens:0}}}],id,{source:'claude-code-cli',sourceVersion:'2.1.281'});}
    await claude(owner,750);const zeroSource=await claude(zero,0);await f.analyze(zero,zeroSource.snapshotId);
    async function get(path:string){const response=await f.api(owner,path);assert.equal(response.status,200,await response.clone().text());return response.json();}
    const head=await get('/api/usage-output?period=since-enrollment'),report:UsageOutputPage=await get('/api/usage-output/export?period=since-enrollment&version='+head.version);
    assert.deepEqual(report.employees.map(row=>[row.employee,row.inputTokens]).sort(),[['丁·相邻',1255],['丙·未知',null],['乙·零值',0],['甲·已知',2000]].sort());
    browser=await chromium.launch();const page=await browser.newPage({hasTouch:true,ignoreHTTPSErrors:true,viewport:{width:320,height:900},reducedMotion:'reduce'});
    page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(new URL(request.url()).pathname==='/api/usage-output/export')exports.push(request.url());});
    await page.goto(f.origin+'/#usage?'+new URLSearchParams({period:'since-enrollment',version:report.version}));await page.getByLabel('个人读取凭据').fill(owner.readerCredential);await page.getByRole('button',{name:'进入存档',exact:true}).click();
    const employee=page.getByRole('region',{name:'员工用量',exact:true}),daily=page.getByRole('region',{name:'每日用量',exact:true}),scatter=page.getByRole('region',{name:'会话散点',exact:true});
    async function exercise(button:Locator,tip:Locator,text:string,key:string){
      await button.tap();await expect(tip).toContainText(text);
      const target=await button.boundingBox(),box=await tip.boundingBox(),ratio=await tip.evaluate(element=>new Promise<number>(resolve=>{const observer=new IntersectionObserver(entries=>{observer.disconnect();resolve(entries[0]!.intersectionRatio);});observer.observe(element);}));
      observations.push({key,target,tip:box,ratio});if(!target||target.width<43.99||target.height<43.99)failures.push(key+' target below 44px');if(ratio<.999)failures.push(key+' detail clipped');
      if(await tip.evaluate(element=>element.scrollWidth>element.clientWidth+1))failures.push(key+' text horizontally clipped');
      const textColors=await renderedColors(tip);
      const textRatio=contrast(textColors.text,textColors.background);observations.push({key,textColors,textRatio});if(textRatio<4.5)failures.push(key+' text contrast');
      if(evidence){await mkdir(evidence,{recursive:true});await page.screenshot({path:join(evidence,key+'.png')});}
      await button.tap();await expect(tip).toHaveCount(0);await button.press('Tab');await page.keyboard.press('Shift+Tab');await expect(button).toBeFocused();await expect(tip).toContainText(text);await page.keyboard.press('Escape');await expect(tip).toHaveCount(0);await page.keyboard.press('Enter');await expect(tip).toHaveCount(1);await page.keyboard.press('Space');await expect(tip).toHaveCount(0);
      const focus=await renderedColors(button);
      observations.push({key,focus,focusRatio:contrast(focus.focus,focus.figureBackground)});if(!focus.visible||focus.width<2||contrast(focus.focus,focus.figureBackground)<3)failures.push(key+' focus contrast');
      if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth||document.documentElement.scrollHeight>innerHeight))failures.push(key+' outer overflow');
    }
    for(const width of [320,390,768,1280,1920])for(const theme of ['light','dark']){
      await page.setViewportSize({width,height:900});await page.evaluate(value=>document.documentElement.dataset.theme=value,theme);
      await exercise(employee.getByRole('button',{name:/甲·已知.*Claude Code CLI/}),employee.getByRole('tooltip'),'750','employee-'+width+'-'+theme);
      await exercise(scatter.getByRole('button',{name:'2 个邻近会话',exact:true}),scatter.getByRole('dialog',{name:'会话点详情'}),'1,250','scatter-'+width+'-'+theme);
      await exercise(daily.getByRole('button',{name:/甲·已知.*2,000/}),daily.getByRole('tooltip'),'2,000','daily-'+width+'-'+theme);
      const colors=await page.evaluate<{foreground:number[];background:number[]}[]>(`(()=>{const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');canvas.width=canvas.height=1;function color(v){ctx.clearRect(0,0,1,1);ctx.fillStyle=v;ctx.fillRect(0,0,1,1);return Array.from(ctx.getImageData(0,0,1,1).data);}return [...document.querySelectorAll('.usage-bar-segment,.usage-scatter circle,.usage-small rect[data-series]')].filter(e=>e.getBoundingClientRect().height>0).map(e=>{const s=getComputedStyle(e),bg=getComputedStyle(e.closest('.usage-figure'));return {name:e.className.baseVal??e.className,series:e.getAttribute('data-series'),foreground:color(e.matches('.usage-bar-segment')?s.backgroundColor:s.fill),background:color(bg.backgroundColor)};});})()`);
      const ratios=colors.map((item:any)=>({...item,ratio:contrast(item.foreground,item.background)}));observations.push({width,theme,ratios});if(ratios.some((item:any)=>item.ratio<3))failures.push(`${width}-${theme} graphical contrast`);
      const motion=await page.locator('.usage-metrics').evaluate(element=>Array.from(element.querySelectorAll('*')).flatMap(node=>{const s=getComputedStyle(node);return s.transitionDuration.split(',').some((value,index)=>parseFloat(value)>0&&(s.transitionProperty.split(',')[index]?.trim()!=='opacity'||parseFloat(value)>.15))||s.animationName!=='none'&&s.animationDuration.split(',').some(value=>parseFloat(value)>0)?[{tag:node.tagName,classes:node.getAttribute('class'),transition:s.transitionProperty+' '+s.transitionDuration,animation:s.animationName+' '+s.animationDuration}]:[];}));
      observations.push({width,theme,motion});if(motion.length)failures.push(`${width}-${theme} reduced motion`);
    }
    // Known zero and unknown remain distinct in every graph and table.
    for(const [name,value]of [['乙·零值','0'],['丙·未知','未知']] as const){
      await exercise(employee.getByRole('button',{name:new RegExp(name+'.*(Codex CLI|Claude Code CLI).*'+value)}),employee.getByRole('tooltip'),value,'employee-state-'+name);
      await exercise(daily.getByRole('button',{name:new RegExp(name+'.* · '+value+'(?: ·|$)')}).first(),daily.getByRole('tooltip'),value,'daily-state-'+name);
    }
    // Mouse preview remains readable while the pointer enters the detail.
    const hoverTarget=scatter.getByRole('button',{name:'2 个邻近会话',exact:true}),dialog=scatter.getByRole('dialog',{name:'会话点详情'});
    await hoverTarget.press('Tab');await page.keyboard.press('Escape');await hoverTarget.hover();await expect(dialog).toContainText('1,255');await dialog.hover();await expect(dialog).toContainText('1,250');
    const links=await dialog.getByRole('link',{name:'查看会话'}).evaluateAll(elements=>elements.map(element=>element.getAttribute('href')));
    assert.deepEqual(links.slice().sort(),report.sessions.filter(row=>row.inputTokens===1250||row.inputTokens===1255).map(row=>row.webPath).sort());await page.keyboard.press('Escape');
    const dailyScroll=daily.locator('.usage-daily-scroll').filter({has:page.getByRole('group',{name:'甲·已知 每日 Token',exact:true})});await dailyScroll.scrollIntoViewIfNeeded();await dailyScroll.hover();const oldLeft=await dailyScroll.evaluate(element=>element.scrollLeft);await page.mouse.wheel(1100,0);await expect.poll(()=>dailyScroll.evaluate(element=>element.scrollLeft)).toBeGreaterThan(oldLeft);
    const lastDay=daily.getByRole('button',{name:new RegExp('甲·已知 · '+report.scope.to+' · 无会话')});await lastDay.focus();await expect(lastDay).toBeInViewport();await expect(daily.getByRole('tooltip')).toContainText('无会话');await page.keyboard.press('Escape');
    await employee.getByRole('button',{name:'员工用量切换为表格',exact:true}).click();
    for(const [name,expected]of Object.entries({'甲·已知':['750','1,250','2,000','0'],'乙·零值':['0','0','0','0'],'丙·未知':['0','未知','未知','1'],'丁·相邻':['0','1,255','1,255','0']})){const cells=await employee.getByRole('table').locator('tbody tr').filter({hasText:name}).locator('td').allTextContents();assert.deepEqual(cells,expected);}
    await daily.getByRole('button',{name:'每日用量切换为表格',exact:true}).click();
    const dates=await daily.getByRole('table').locator('thead th').allTextContents();
    for(const person of report.employees){const cells=await daily.getByRole('table').locator('tbody tr').filter({hasText:person.employee}).locator('td').allTextContents();for(let i=0;i<cells.length;i++){const day=person.daily.find(day=>day.date.slice(5)===dates[i+1]);assert.equal(cells[i],!day?'—':(day.inputTokens===null?'未知':day.inputTokens.toLocaleString('zh-CN'))+(day.excludedSessions?day.excludedSessions+' 会话未知':''));}}
    await scatter.getByRole('button',{name:'会话散点切换为表格',exact:true}).click();
    for(const session of report.sessions){const row=scatter.getByRole('table').locator('tbody tr').filter({has:page.locator('a[href="'+session.webPath+'"]')});assert.equal(await row.locator('td').nth(1).textContent(),session.inputTokens===null?'未知':session.knownInputTokens.toLocaleString('zh-CN'));assert.equal(await row.locator('td').nth(2).textContent(),session.outputs.verified.value===null?'未知':String(session.outputs.verified.value));}
    // Filtering changes emphasis only; reference circles retain their values.
    const filtered=await get('/api/usage-output?period=since-enrollment&employeeId='+owner.employeeId);
    await page.goto(f.origin+'/#usage?'+new URLSearchParams({period:'since-enrollment',employeeId:owner.employeeId,version:filtered.version}));await expect(scatter.locator('[data-reference="true"]')).toHaveCount(3);
    for(const theme of ['light','dark']){await page.evaluate(value=>document.documentElement.dataset.theme=value,theme);await exercise(scatter.getByRole('button',{name:'2 个邻近会话',exact:true}),scatter.getByRole('dialog',{name:'会话点详情'}),'参照','reference-'+theme);
      const grey=await renderedColors(scatter.locator('circle[data-reference="true"]').first());observations.push({theme,grey,fillRatio:contrast(grey.fill,grey.figureBackground),strokeRatio:contrast(grey.stroke,grey.figureBackground)});if(Math.max(contrast(grey.fill,grey.figureBackground),contrast(grey.stroke,grey.figureBackground))<3)failures.push(theme+' reference contrast');}
    assert.deepEqual(errors,[]);assert.deepEqual(exports,[]);assert.deepEqual(failures,[]);
  }finally{if(evidence){await mkdir(evidence,{recursive:true});await writeFile(join(evidence,'matrix.json'),JSON.stringify({observations,failures,errors,exports},null,2));}await browser?.close();await f.close();}
});
