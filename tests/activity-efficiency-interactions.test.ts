import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium,expect,type Browser,type Locator} from '@playwright/test';
import {assessmentFixture} from './assessment-fixture.js';
import {beijingDate} from '../packages/contracts/reports.js';

// Rendered pure-color samples, including SVG fill and stroke; not an audit of
// image backgrounds, antialiasing, other browsers or every possible data level.
async function appearance(root:Locator,marks:string):Promise<{text:{value:string;ratio:number;minimum:number}[];graphics:{tag:string;color:string;ratio:number;minimum:number}[];focus:{width:number;ratio:number}|null;motion:unknown[];reduced:boolean}>{return root.evaluate((element,args)=>(0,eval)(args.script)(element,args.marks),{script:`(element,selector)=>{
  const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d');
  const rgba=(color)=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=color;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data];};
  const blend=(fg,bg)=>fg.slice(0,3).map((v,i)=>v*fg[3]/255+bg[i]*(1-fg[3]/255)).concat(255);
  const bg=(el)=>{let color=[255,255,255,255];const parents=[];for(let p=el;p;p=p.parentElement)parents.unshift(p);for(const p of parents)color=blend(rgba(getComputedStyle(p).backgroundColor),color);return color;};
  const lum=(rgb)=>{const c=rgb.slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});return .2126*c[0]+.7152*c[1]+.0722*c[2];};
  const ratio=(color,background)=>{const a=lum(blend(rgba(color),background)),b=lum(background);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);};
  const text=[element,...element.querySelectorAll('*')].flatMap(el=>{const r=el.getBoundingClientRect(),css=getComputedStyle(el),value=[...el.childNodes].filter(n=>n.nodeType===Node.TEXT_NODE).map(n=>n.textContent).join('').trim();if(!value||!r.width||!r.height||css.visibility==='hidden')return[];return[{value:value.slice(0,70),ratio:ratio(el instanceof SVGElement?css.fill:css.color,bg(el)),minimum:parseFloat(css.fontSize)>=24||parseFloat(css.fontSize)>=18.66&&Number(css.fontWeight)>=700?3:4.5}];});
  const graphics=[...element.querySelectorAll(selector)].map(el=>{const css=getComputedStyle(el),color=el.matches('line,[data-rework]')?css.stroke:css.fill;return{tag:el.tagName,color,ratio:ratio(color,bg(el)),minimum:3};});
  const focused=element.querySelector(':focus-visible'),focus=focused?{width:parseFloat(getComputedStyle(focused).outlineWidth),ratio:ratio(getComputedStyle(focused).outlineColor,bg(focused.parentElement))}:null;
  const motion=[element,...element.querySelectorAll('*')].flatMap(el=>{const css=getComputedStyle(el);return css.transitionDuration.split(',').some(v=>parseFloat(v)>0)||css.animationName!=='none'||css.scrollBehavior==='smooth'?[{tag:el.tagName,transition:css.transitionDuration,animation:css.animationName,scroll:css.scrollBehavior}]:[];});
  return{text,graphics,focus,motion,reduced:matchMedia('(prefers-reduced-motion:reduce)').matches};
}`,marks});}

test('dense recorded activity remains touch reachable with its exact original destination',{timeout:120000},async()=>{
  const f=await assessmentFixture();let browser:Browser|undefined;
  const directory=process.env.SKYNET_ACTIVITY_EFFICIENCY_EVIDENCE??join(f.directory,'activity-efficiency');await mkdir(directory,{recursive:true});
  try{
    const owner=await f.owner('活动触屏合成员工');
    for(const [index,offset] of [0,5000].entries()){
      const source=f.rows({prompts:1,verified:0,claimed:0});
      const rows=source.rows.map((value:any)=>({...value,...(value.timestamp?{timestamp:new Date(Date.parse(value.timestamp)+offset).toISOString()}:{}),
        ...(value.payload?.role==='user'?{payload:{...value.payload,content:value.payload.content.map((part:any)=>({...part,text:`会话${index+1} ${part.text}`}))}}:{})}));
      await f.upload(owner,rows,source.sessionId);
    }
    const date=beijingDate(f.base),response=await f.api(owner,'/api/activity?date='+date);assert.equal(response.status,200,await response.clone().text());
    const report=await response.json(),lane=report.lanes.find((item:any)=>item.employeeId===owner.employeeId);assert.ok(lane);assert.equal(lane.points.length,2);
    const first=lane.points.find((point:any)=>point.timestamp===f.base.toISOString());assert.ok(first);
    browser=await chromium.launch();const page=await browser.newPage({ignoreHTTPSErrors:true,hasTouch:true,viewport:{width:390,height:900},reducedMotion:'reduce'});
    const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(f.origin+'/#activity?date='+date+'&version='+report.version);await page.getByLabel('个人读取凭据').fill(owner.readerCredential);await page.getByRole('button',{name:'进入存档',exact:true}).click();
    const rhythm=page.getByRole('region',{name:'对话节奏',exact:true});await expect(rhythm.getByRole('img',{name:'对话节奏',exact:true})).toBeVisible();
    const target=rhythm.getByRole('button',{name:'活动触屏合成员工 · 4 条活动',exact:true});await expect(target).toBeVisible();
    await target.tap();const details=rhythm.getByRole('dialog',{name:'活动详情',exact:true});await expect(details).toBeInViewport({ratio:1});
    await expect(details.getByRole('link')).toHaveCount(4);
    const point=details.getByRole('link',{name:/^活动触屏合成员工 · 提问 · 10:00:00 ·/});
    const bounds=await point.boundingBox();assert.ok(bounds);assert.ok(bounds.width>=44&&bounds.height>=44);const href=await point.getAttribute('href');assert.equal(href,first.evidence.conversationPath??first.evidence.webPath);
    await page.screenshot({path:join(directory,'activity-dense-before-touch.png'),animations:'disabled'});
    await point.tap();await expect(page.getByRole('region',{name:'对话阅读',exact:true})).toBeVisible();
    await writeFile(join(directory,'activity-dense-touch.json'),JSON.stringify({version:report.version,expected:href,actual:new URL(page.url()).hash,point:bounds,errors},null,2));
    assert.equal(new URL(page.url()).hash,new URL(href!,f.origin).hash,'touching the requested activity must open that original, not a neighboring record');
    await expect(page.getByRole('region',{name:'对话阅读',exact:true}).getByText('会话1 请求 0 elements=3',{exact:true})).toBeVisible();assert.deepEqual(errors,[]);
  }finally{await browser?.close();await f.close();}
});

test('activity and known efficiency preserve fixed values and readable touch details across themes and widths',{timeout:180000},async()=>{
  const f=await assessmentFixture();let browser:Browser|undefined;
  const directory=process.env.SKYNET_ACTIVITY_EFFICIENCY_EVIDENCE??join(f.directory,'activity-efficiency');await mkdir(directory,{recursive:true});
  const observations:unknown[]=[];
  try{
    f.now.setTime(f.base.getTime()+3600000);const owner=await f.owner('图表矩阵合成员工');
    await f.session(owner,{prompts:2,tokens:100,verified:1,claimed:0,long:true,rework:true});await f.session(owner,{prompts:2,tokens:100,verified:0,claimed:0});
    const unknown=f.rows({prompts:1,tokens:100,verified:0,claimed:0});await f.upload(owner,unknown.rows,unknown.sessionId);
    const date=beijingDate(f.base),get=async(path:string)=>{const response=await f.api(owner,path);assert.equal(response.status,200,await response.clone().text());return response.json();};
    const activity=await get('/api/activity?date='+date),efficiency=await get('/api/session-efficiency?period=this-week');
    const known=efficiency.distributions.find((row:any)=>row.taskType==='implementation');assert.deepEqual([known.count,known.unknownCount,known.minimum,known.median,known.maximum],[2,0,0,5000,10000]);assert.equal(efficiency.distributions.find((row:any)=>row.taskType==='unknown').unknownCount,1);
    const lane=activity.lanes[0];assert.ok(lane.points.some((point:any)=>point.type==='rework'));assert.ok(lane.segments.length>0);
    browser=await chromium.launch();const page=await browser.newPage({ignoreHTTPSErrors:true,hasTouch:true,viewport:{width:390,height:900},reducedMotion:'reduce'});const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(f.origin+'/#activity?date='+date+'&version='+activity.version);await page.getByLabel('个人读取凭据').fill(owner.readerCredential);await page.getByRole('button',{name:'进入存档',exact:true}).click();
    for(const kind of ['activity','efficiency']){
      if(kind==='efficiency')await page.goto(f.origin+'/#efficiency');
      const panel=page.getByRole('region',{name:kind==='activity'?'对话节奏':'任务类型分布',exact:true});await expect(panel).toBeVisible();
      for(const width of [320,390,768,1280,1920])for(const theme of ['light','dark']){
        await page.setViewportSize({width,height:900});await page.evaluate(value=>document.documentElement.dataset.theme=value,theme);
        if(kind==='activity')await expect.poll(()=>panel.getByRole('img',{name:'对话节奏'}).evaluate(svg=>Math.abs((svg as SVGSVGElement).viewBox.baseVal.width-svg.getBoundingClientRect().width))).toBeLessThan(1);
        const target=panel.getByRole('button',{name:kind==='activity'?/^图表矩阵合成员工 · \d+ 条活动$/:'实现 · 1 个会话',exact:kind!=='activity'}).first();
        await target.scrollIntoViewIfNeeded();await target.tap();const details=panel.getByRole('dialog',{name:kind==='activity'?'活动详情':'产效会话详情',exact:true});
        try{await expect(details).toBeInViewport({ratio:1});}catch(error){await page.screenshot({path:join(directory,`${kind}-${width}-${theme}-clip.png`),animations:'disabled'});await writeFile(join(directory,'clipping.json'),JSON.stringify({kind,width,theme,target:await target.boundingBox(),popup:await details.boundingBox(),ancestors:await details.evaluate(el=>{const rows=[];for(let p:Element|null=el;p;p=p.parentElement){const s=getComputedStyle(p),r=p.getBoundingClientRect();rows.push({tag:p.tagName,classes:p.className,top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:p.clientWidth,height:p.clientHeight,overflow:s.overflow,border:s.borderRadius,padding:s.padding});}return rows;})},null,2));throw error;}
        const bounds=await target.boundingBox();assert.ok(bounds&&bounds.width>=44&&bounds.height>=44,kind+' touch target');
        await page.screenshot({path:join(directory,`${kind}-${width}-${theme}.png`),animations:'disabled'});
        await target.tap();await expect(details).toHaveCount(0);await target.tap();await expect(details).toBeVisible();await page.keyboard.press('Escape');await expect(details).toHaveCount(0);
        await target.press('Tab');await target.focus();await expect(details).toBeVisible();await page.keyboard.press('Escape');await expect(details).toHaveCount(0);await page.keyboard.press('Enter');await expect(details).toBeVisible();await page.keyboard.press('Space');await expect(details).toHaveCount(0);
        const colors=await appearance(panel,kind==='activity'?'.activity-session,.activity-wait,.activity-point':'.eff-distribution circle,.eff-median');observations.push({kind,width,theme,bounds,...colors});await writeFile(join(directory,'matrix.json'),JSON.stringify(observations,null,2));
        assert.deepEqual([...colors.text,...colors.graphics].filter(item=>item.ratio+.01<item.minimum),[],kind+' '+width+' '+theme+' contrast');assert.ok(colors.focus&&colors.focus.width>=2&&colors.focus.ratio>=3);assert.equal(colors.reduced,true);assert.deepEqual(colors.motion,[],'reduced-motion has no nonzero transition or smooth scroll');
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth||document.documentElement.scrollHeight>innerHeight),false);
      }
      await panel.getByRole('button',{name:kind==='activity'?'节奏表格':'产效分布表格',exact:true}).click();
      const table=panel.getByRole('table',{name:kind==='activity'?'对话节奏表格':'任务类型产效',exact:true});
      if(kind==='activity')assert.deepEqual((await table.getByRole('link').evaluateAll(links=>links.map(link=>link.getAttribute('href')))).sort(),[...lane.sessions,...lane.points,...lane.segments].map((item:any)=>item.evidence.conversationPath??item.evidence.webPath).sort());
      else{await expect(table.getByRole('row').filter({has:page.getByRole('rowheader',{name:'实现',exact:true})})).toHaveText('实现205,0000 — 10,000');await expect(table.getByRole('row').filter({has:page.getByRole('rowheader',{name:'未知',exact:true})})).toContainText('未知');}
    }
    assert.deepEqual(errors,[]);
  }finally{await browser?.close();await f.close();}
});

test('simultaneous activity identifies each project and session before original navigation',{timeout:120000},async()=>{
  const f=await assessmentFixture();let browser:Browser|undefined;
  const directory=process.env.SKYNET_ACTIVITY_EFFICIENCY_EVIDENCE??join(f.directory,'activity-efficiency');await mkdir(directory,{recursive:true});
  try{
    const owner=await f.owner('同秒活动合成员工');
    for(const project of ['/activity/alpha','/activity/beta']){const source=f.rows({prompts:1,verified:0,claimed:0});await f.upload(owner,source.rows,source.sessionId,{project});}
    const date=beijingDate(f.base),response=await f.api(owner,'/api/activity?date='+date);assert.equal(response.status,200);const report=await response.json();
    const expected=report.events.filter((event:any)=>event.type==='prompt');assert.equal(expected.length,2);
    browser=await chromium.launch();const page=await browser.newPage({ignoreHTTPSErrors:true,hasTouch:true,viewport:{width:320,height:900},reducedMotion:'reduce'});
    await page.goto(f.origin+'/#activity?date='+date+'&version='+report.version);await page.getByLabel('个人读取凭据').fill(owner.readerCredential);await page.getByRole('button',{name:'进入存档',exact:true}).click();
    const rhythm=page.getByRole('region',{name:'对话节奏',exact:true}),target=rhythm.getByRole('button',{name:'同秒活动合成员工 · 4 条活动',exact:true});await target.tap();
    const details=rhythm.getByRole('dialog',{name:'活动详情',exact:true}),links=details.getByRole('link'),labels=await links.allTextContents();
    await writeFile(join(directory,'activity-same-time-labels.json'),JSON.stringify({version:report.version,labels},null,2));
    assert.equal(new Set(labels).size,4,'same-second records must have distinguishable visible identities');
    for(const event of expected){const link=details.getByRole('link').filter({hasText:'提问'}).filter({hasText:event.project});await expect(link).toHaveCount(1);await expect(link).toHaveAttribute('href',event.evidence.conversationPath??event.evidence.webPath);}
    await page.setViewportSize({width:1280,height:900});await expect(details).toHaveCount(0);
    for(const event of expected){await target.tap();const original=details.getByRole('link').filter({hasText:'提问'}).filter({hasText:event.project});await original.tap();await expect(page.getByRole('region',{name:'对话阅读',exact:true})).toBeVisible();assert.equal(new URL(page.url()).hash,new URL(event.evidence.conversationPath??event.evidence.webPath,f.origin).hash);await page.goBack();await expect(target).toBeVisible();}
  }finally{await browser?.close();await f.close();}
});

test('coincident known efficiency points select the intended fixed session by touch',{timeout:120000},async()=>{
  const f=await assessmentFixture();let browser:Browser|undefined;
  const directory=process.env.SKYNET_ACTIVITY_EFFICIENCY_EVIDENCE??join(f.directory,'activity-efficiency');await mkdir(directory,{recursive:true});
  try{
    f.now.setTime(f.base.getTime()+3600000);const owner=await f.owner('产效触屏合成员工');
    await f.session(owner,{prompts:1,tokens:100,verified:1,claimed:0});await f.session(owner,{prompts:1,tokens:100,verified:1,claimed:0});
    const response=await f.api(owner,'/api/session-efficiency?period=this-week');assert.equal(response.status,200,await response.clone().text());const report=await response.json();
    const sessions=report.sessions.filter((row:any)=>row.taskType==='implementation'&&row.efficiency.value!==null);assert.equal(sessions.length,2);assert.deepEqual(sessions.map((row:any)=>row.efficiency),[{value:10000,numerator:1,denominator:100},{value:10000,numerator:1,denominator:100}]);
    browser=await chromium.launch();const page=await browser.newPage({ignoreHTTPSErrors:true,hasTouch:true,viewport:{width:390,height:900},reducedMotion:'reduce'});
    await page.goto(f.origin+'/#efficiency');await page.getByLabel('个人读取凭据').fill(owner.readerCredential);await page.getByRole('button',{name:'进入存档',exact:true}).click();
    const distribution=page.getByRole('region',{name:'任务类型分布',exact:true}),target=distribution.getByRole('button',{name:'实现 · 2 个会话',exact:true});
    await target.tap();const details=distribution.getByRole('dialog',{name:'产效会话详情',exact:true});await expect(details).toBeInViewport({ratio:1});
    await expect(details.getByRole('button')).toHaveCount(2);const point=details.getByRole('button').first();await expect(point).toContainText('1 / 100 Token');
    const bounds=await target.boundingBox();assert.ok(bounds);assert.ok(bounds.width>=44&&bounds.height>=44);await page.screenshot({path:join(directory,'efficiency-dense-before-touch.png'),animations:'disabled'});
    await point.tap();const selected=page.getByRole('region',{name:'选中会话',exact:true});await expect(selected).toBeVisible();
    const actual=await selected.locator('.eff-id').innerText();await writeFile(join(directory,'efficiency-dense-touch.json'),JSON.stringify({version:report.version,point:bounds,expected:sessions[0].sourceSessionId,actual},null,2));
    assert.equal(actual,sessions[0].sourceSessionId,'a coincident point must not silently select its neighbor');
    await expect(selected.getByRole('link',{name:'阅读原始对话',exact:true})).toHaveAttribute('href',sessions[0].webPath);
  }finally{await browser?.close();await f.close();}
});
