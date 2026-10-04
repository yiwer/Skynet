import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium,expect,type Browser,type Locator} from '@playwright/test';
import {assessmentFixture} from './assessment-fixture.js';
import {beijingDate} from '../packages/contracts/reports.js';
import {randomUUID} from 'node:crypto';

async function waitingFixture(){
  const f=await assessmentFixture();
  try{
    const owner=await f.owner('等待图交互合成员工'),id=randomUUID(),time=(ms:number)=>new Date(f.base.getTime()+ms).toISOString();let cursor=0;
    const message=(role:string,text:string,ms:number)=>({type:'response_item',timestamp:time(ms),payload:{type:'message',role,content:[{type:role==='user'?'input_text':'output_text',text}]}});
    const rows:object[]=[{type:'session_meta',payload:{id}},message('user','核查等待来源',0)];
    for(const [index,seconds] of [60,120,600,1200].entries()){
      rows.push({type:'event_msg',timestamp:time(cursor+1),payload:{type:'task_started',turn_id:'turn-'+index}},message('assistant','本轮结果',cursor+5),
        {type:'event_msg',timestamp:time(cursor+10),payload:{type:'task_complete',turn_id:'turn-'+index}});
      cursor+=10+seconds*1000;rows.push(message('user','继续核查',cursor));
    }
    rows.push({type:'event_msg',timestamp:time(cursor+1),payload:{type:'task_started',turn_id:'unknown'}},message('assistant','无结束边界',cursor+2),message('user','继续未知等待',cursor+100));
    await f.upload(owner,rows,id,{sourceVersion:'0.160.0'});
    const response=await f.api(owner,'/api/wait-report?period=since-enrollment');assert.equal(response.status,200,await response.clone().text());
    const report=await response.json();assert.equal(report.summary.medianMs,360000);assert.equal(report.summary.knownCount,4);assert.equal(report.summary.unknownCount,1);
    assert.deepEqual(report.summary.longFraction,{numerator:2,denominator:4,value:0.5});
    return {f,owner,report};
  }catch(error){await f.close();throw error;}
}

// Measure rendered colors on this synthetic page. This is a bounded pure-color
// check, not a claim about image backgrounds, browser antialiasing or all AC31.
async function chartAppearance(root:Locator,marks:string){
  return root.evaluate((element,args)=>(0,eval)(args.script)(element,args.marks),{script:`(element,selector)=>{
    const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d');
    const rgba=(color)=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=color;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data];};
    const blend=(fg,bg)=>fg.slice(0,3).map((v,i)=>v*fg[3]/255+bg[i]*(1-fg[3]/255)).concat(255);
    const background=(el)=>{let bg=[255,255,255,255];const parents=[];for(let p=el;p;p=p.parentElement)parents.unshift(p);for(const p of parents)bg=blend(rgba(getComputedStyle(p).backgroundColor),bg);return bg;};
    const luminance=(rgb)=>{const c=rgb.slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});return .2126*c[0]+.7152*c[1]+.0722*c[2];};
    const contrast=(color,bg)=>{const a=luminance(blend(rgba(color),bg)),b=luminance(bg);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);};
    const texts=[],graphics=[],motion=[];
    for(const el of [element,...element.querySelectorAll('*')]){
      const r=el.getBoundingClientRect(),css=getComputedStyle(el);if(!r.width||!r.height||css.visibility==='hidden'||el.closest('[disabled]'))continue;
      const text=[...el.childNodes].filter(n=>n.nodeType===Node.TEXT_NODE).map(n=>n.textContent).join('').trim();
      if(text){const font=parseFloat(css.fontSize);texts.push({text:text.slice(0,70),foreground:css.color,background:background(el),ratio:contrast(css.color,background(el)),minimum:font>=24||font>=18.66&&Number(css.fontWeight)>=700?3:4.5});}
      motion.push({tag:el.tagName,transition:css.transitionProperty,duration:css.transitionDuration,animation:css.animationName,scroll:css.scrollBehavior});
    }
    for(const el of element.querySelectorAll(selector)){
      const css=getComputedStyle(el),r=el.getBoundingClientRect();if(!r.width&&!r.height)continue;
      const color=el instanceof SVGElement?(css.stroke==='none'?css.fill:css.stroke):css.backgroundColor;
      const bg=background(el instanceof SVGElement?el:el.parentElement);
      graphics.push({tag:el.tagName,color,background:bg,ratio:contrast(color,bg),minimum:3});
    }
    const focused=element.querySelector(':focus-visible');
    const focus=focused?{color:getComputedStyle(focused).outlineColor,width:getComputedStyle(focused).outlineWidth,ratio:contrast(getComputedStyle(focused).outlineColor,background(focused.parentElement)),minimum:3}:null;
    return {texts,graphics,focus,motion,reduced:matchMedia('(prefers-reduced-motion:reduce)').matches,activeAnimations:element.getAnimations({subtree:true}).filter(a=>a.playState==='running').map(a=>({duration:a.effect.getTiming().duration,frames:a.effect.getKeyframes()}))};
  }`,marks});
}

test('team daily trend details open on the first touch and preserve known and unknown values',{timeout:120000},async()=>{
  const f=await assessmentFixture();let browser:Browser|undefined;
  const directory=process.env.SKYNET_CHART_INTERACTIONS_EVIDENCE??join(f.directory,'chart-interactions');await mkdir(directory,{recursive:true});
  try{
    const owner=await f.owner('趋势交互合成员工'),source=f.rows({prompts:3,tokens:1000,verified:0,claimed:0});
    await f.upload(owner,source.rows,source.sessionId);
    const response=await f.api(owner,'/api/team-report?period=since-enrollment');assert.equal(response.status,200,await response.clone().text());
    const report=await response.json(),date=beijingDate(f.base),day=report.daily.find((row:any)=>row.date===date);
    assert.equal(day.inputTokens,1000);assert.equal(day.outputs.verified.value,null,'no model result is still unknown');assert.equal(day.outputs.codeChanges.value,0);
    browser=await chromium.launch();const page=await browser.newPage({ignoreHTTPSErrors:true,hasTouch:true,viewport:{width:390,height:900},reducedMotion:'reduce'});
    const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(f.origin+'/#coverage?period=since-enrollment&version='+report.version);
    await page.getByLabel('个人读取凭据').fill(owner.readerCredential);await page.getByRole('button',{name:'进入存档',exact:true}).click();
    const panel=page.getByRole('region',{name:'期间使用概况',exact:true}),detail=panel.getByRole('button',{name:'每日 Token 输入详情',exact:true});
    await expect(detail).toBeVisible();await detail.tap();
    await writeFile(join(directory,'team-first-touch.json'),JSON.stringify({version:report.version,date,inputTokens:day.inputTokens,verified:day.outputs.verified.value,tooltipCount:await panel.getByRole('tooltip').count()},null,2));
    await page.screenshot({path:join(directory,'team-first-touch.png'),animations:'disabled'});
    await expect(panel.getByRole('tooltip')).toHaveCount(1);await expect(panel.getByRole('tooltip')).toContainText(date+'：1000');
    await detail.tap();await expect(panel.getByRole('tooltip')).toHaveCount(0);
    await detail.tap();await expect(panel.getByRole('tooltip')).toHaveCount(1);await page.keyboard.press('Escape');await expect(panel.getByRole('tooltip')).toHaveCount(0);
    await detail.press('Tab');await detail.focus();await expect(panel.getByRole('tooltip')).toContainText(date+'：1000');
    await page.keyboard.press('Escape');await expect(panel.getByRole('tooltip')).toHaveCount(0);
    await page.keyboard.press('Enter');await expect(panel.getByRole('tooltip')).toHaveCount(1);await page.keyboard.press('Space');await expect(panel.getByRole('tooltip')).toHaveCount(0);
    const verified=panel.getByRole('button',{name:'每日已验证结果详情',exact:true});await verified.tap();await expect(panel.getByRole('tooltip')).toContainText(date+'：未知');
    await page.keyboard.press('Escape');await panel.getByRole('button',{name:'每日代码变更详情',exact:true}).tap();await expect(panel.getByRole('tooltip')).toContainText(date+'：0');
    await page.keyboard.press('Escape');await detail.hover();await expect(panel.getByRole('tooltip')).toHaveCount(1);await panel.getByRole('tooltip').hover();await expect(panel.getByRole('tooltip')).toBeVisible();await page.mouse.wheel(0,1000);await expect(panel.getByRole('tooltip').locator('span').last()).toBeInViewport();await page.mouse.move(0,0);await expect(panel.getByRole('tooltip')).toHaveCount(0);
    await page.keyboard.press('Escape');await panel.getByRole('button',{name:'每日趋势切换为表格',exact:true}).tap();
    const row=panel.getByRole('row').filter({has:page.getByRole('rowheader',{name:date,exact:true})});await expect(row).toContainText('1000');await expect(row).toContainText('未知');
    await page.screenshot({path:join(directory,'team-table-390.png'),animations:'disabled'});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth||document.documentElement.scrollHeight>innerHeight),false);
    assert.deepEqual(errors,[]);
  }finally{await browser?.close();await f.close();}
});

test('waiting heat cells support touch dismissal, keyboard escape and equivalent known-sample values',{timeout:120000},async()=>{
  const {f,owner,report}=await waitingFixture();let browser:Browser|undefined;
  const directory=process.env.SKYNET_CHART_INTERACTIONS_EVIDENCE??join(f.directory,'chart-interactions');await mkdir(directory,{recursive:true});
  try{
    browser=await chromium.launch();const page=await browser.newPage({ignoreHTTPSErrors:true,hasTouch:true,viewport:{width:390,height:900},reducedMotion:'reduce'});
    await page.goto(f.origin+'/#waits?period=since-enrollment&version='+report.waitVersion);await page.getByLabel('个人读取凭据').fill(owner.readerCredential);await page.getByRole('button',{name:'进入存档',exact:true}).click();
    const heat=page.getByRole('region',{name:'星期与小时',exact:true}),cell=heat.getByRole('button',{name:/4 条等待/});
    await cell.tap();await expect(heat.getByRole('status')).toContainText('4 条等待 · 中位数 6 分 0 秒');await expect(heat.getByRole('status')).toBeInViewport({ratio:1});
    await page.keyboard.press('Escape');
    await writeFile(join(directory,'heat-escape.json'),JSON.stringify({version:report.version,known:4,unknown:1,statusCount:await heat.getByRole('status').count()},null,2));
    await page.screenshot({path:join(directory,'heat-escape.png'),animations:'disabled'});
    await expect(heat.getByRole('status')).toHaveCount(0);
    await cell.tap();await expect(heat.getByRole('status')).toHaveCount(1);await cell.tap();await expect(heat.getByRole('status')).toHaveCount(0);
    await cell.press('Tab');await cell.focus();await expect(heat.getByRole('status')).toContainText('6 分 0 秒');
    await page.keyboard.press('Escape');await expect(heat.getByRole('status')).toHaveCount(0);
    await page.keyboard.press('Enter');await expect(heat.getByRole('status')).toHaveCount(1);await page.keyboard.press('Space');await expect(heat.getByRole('status')).toHaveCount(0);
    await cell.press('Tab');await expect(heat.getByRole('status')).toHaveCount(0);
    await heat.getByRole('button',{name:'热力图表格',exact:true}).tap();
    const table=heat.getByRole('table',{name:'星期与小时等待中位数',exact:true});await expect(table.locator('tbody tr')).toHaveCount(168);
    await expect(table.getByRole('row').filter({hasText:'6 分 0 秒'})).toContainText('4');await expect(table.getByText('无记录',{exact:true})).toHaveCount(167);
    await expect(page.getByTestId('wait-report-long')).toHaveText('50%');await expect(page.getByTestId('wait-report-long').locator('..')).toContainText('2 / 4 段');
    await page.screenshot({path:join(directory,'heat-table-390.png'),animations:'disabled'});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth||document.documentElement.scrollHeight>innerHeight),false);
  }finally{await browser?.close();await f.close();}
});

test('waiting box plots expose all quartiles on touch and keyboard and dismiss without changing the sample denominator',{timeout:120000},async()=>{
  const {f,owner,report}=await waitingFixture();let browser:Browser|undefined;
  const directory=process.env.SKYNET_CHART_INTERACTIONS_EVIDENCE??join(f.directory,'chart-interactions');await mkdir(directory,{recursive:true});
  try{
    browser=await chromium.launch();const page=await browser.newPage({ignoreHTTPSErrors:true,hasTouch:true,viewport:{width:390,height:900},reducedMotion:'reduce'});
    await page.goto(f.origin+'/#waits?period=since-enrollment&version='+report.waitVersion);await page.getByLabel('个人读取凭据').fill(owner.readerCredential);await page.getByRole('button',{name:'进入存档',exact:true}).click();
    const people=page.getByRole('region',{name:'按人等待分布',exact:true}),plot=people.getByLabel(/等待图交互合成员工 · 4 段已知，1 段未知/);
    await plot.tap();const tip=people.getByRole('status');await expect(tip).toBeInViewport({ratio:1});await expect(tip).toContainText('最短 1 分 0 秒 · Q1 1 分 45 秒 · 中位数 6 分 0 秒 · Q3 12 分 30 秒 · 最长 20 分 0 秒 · P90 20 分 0 秒');
    await page.keyboard.press('Escape');
    await writeFile(join(directory,'box-escape.json'),JSON.stringify({version:report.version,known:4,unknown:1,statusCount:await tip.count()},null,2));
    await page.screenshot({path:join(directory,'box-escape.png'),animations:'disabled'});
    await expect(tip).toHaveCount(0);
    await plot.tap();await expect(tip).toHaveCount(1);await plot.tap();await expect(tip).toHaveCount(0);
    await plot.press('Tab');await plot.focus();await expect(tip).toContainText('4 段已知，1 段未知');
    await page.keyboard.press('Escape');await expect(tip).toHaveCount(0);
    await page.keyboard.press('Enter');await expect(tip).toHaveCount(1);await page.keyboard.press('Space');await expect(tip).toHaveCount(0);
    await plot.press('Tab');await expect(tip).toHaveCount(0);
    await people.getByRole('button',{name:'人员分布表格',exact:true}).tap();
    const table=people.getByRole('table',{name:'按人等待分布',exact:true});
    assert.deepEqual(await table.locator('tbody tr').first().locator('th,td').allTextContents(),['等待图交互合成员工','4 / 1','1 分 0 秒','1 分 45 秒','6 分 0 秒','12 分 30 秒','20 分 0 秒','20 分 0 秒','0% · 0/4']);
    await page.screenshot({path:join(directory,'box-table-390.png'),animations:'disabled'});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth||document.documentElement.scrollHeight>innerHeight),false);
  }finally{await browser?.close();await f.close();}
});

test('team and waiting charts retain legible text and marks, focus and local scrolling with reduced motion',{timeout:180000},async()=>{
  const {f,owner,report}=await waitingFixture();let browser:Browser|undefined;
  const directory=process.env.SKYNET_CHART_INTERACTIONS_EVIDENCE??join(f.directory,'chart-interactions');await mkdir(directory,{recursive:true});
  const observations:any[]=[];
  try{
    const trendOwner=await f.owner('趋势视觉合成员工'),source=f.rows({prompts:3,tokens:1000,verified:0,claimed:0});await f.upload(trendOwner,source.rows,source.sessionId);
    const response=await f.api(owner,'/api/team-report?period=since-enrollment&employeeId='+trendOwner.employeeId);assert.equal(response.status,200,await response.clone().text());const team=await response.json();
    browser=await chromium.launch();const page=await browser.newPage({ignoreHTTPSErrors:true,hasTouch:true,viewport:{width:390,height:900},reducedMotion:'reduce'});const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(f.origin+'/#coverage?period=since-enrollment&employeeId='+trendOwner.employeeId+'&version='+team.version);await page.getByLabel('个人读取凭据').fill(owner.readerCredential);await page.getByRole('button',{name:'进入存档',exact:true}).click();
    for(const view of ['team','waits']){
      if(view==='waits')await page.goto(f.origin+'/#waits?period=since-enrollment&version='+report.waitVersion);
      for(const width of [320,390,1280])for(const theme of ['light','dark']){
        await page.setViewportSize({width,height:900});await page.evaluate(value=>document.documentElement.dataset.theme=value,theme);
        if(view==='team'){
          const panel=page.getByRole('region',{name:'期间使用概况',exact:true}),button=panel.getByRole('button',{name:'每日 Token 输入详情',exact:true});
          await page.keyboard.press('Tab');await button.focus();await expect(panel.getByRole('tooltip')).toBeVisible();
          const appearance=await chartAppearance(panel,'.team-spark circle,.team-spark polyline');observations.push({view,width,theme,...appearance});
          const tip=panel.getByRole('tooltip');assert.equal(await tip.evaluate(el=>el.scrollHeight>el.clientHeight),true);
          await page.screenshot({path:join(directory,`team-first-${width}-${theme}.png`),animations:'disabled'});
          await tip.hover();await page.mouse.wheel(0,1000);await expect(tip.locator('span').last()).toBeInViewport();
          await page.screenshot({path:join(directory,`team-${width}-${theme}.png`),animations:'disabled'});await page.keyboard.press('Escape');
        }else{
          for(const [name,selector] of [['星期与小时','.wait-heat-cell[data-level]'],['按人等待分布','.wait-person-plot line,.wait-person-plot rect']] as const){
            const panel=page.getByRole('region',{name,exact:true}),button=name==='星期与小时'?panel.getByRole('button',{name:/4 条等待/}):panel.getByLabel(/等待图交互合成员工 · 4 段已知/);
            await page.keyboard.press('Tab');await button.focus();await expect(panel.getByRole('status')).toBeVisible();
            observations.push({view:name,width,theme,...await chartAppearance(panel,selector)});
            const target=await button.boundingBox();assert.ok(target&&target.width>=44&&target.height>=44);
            await page.screenshot({path:join(directory,`${name==='星期与小时'?'heat':'box'}-${width}-${theme}.png`),animations:'disabled'});await page.keyboard.press('Escape');
          }
          const scroll=page.getByLabel('小时热力图横向滚动区');await scroll.focus();await scroll.evaluate(el=>{el.scrollLeft=0;});await page.keyboard.press('ArrowRight');await expect.poll(()=>scroll.evaluate(el=>el.scrollLeft)).toBeGreaterThan(0);
          await scroll.evaluate(el=>{el.scrollLeft=el.scrollWidth;});assert.equal(await scroll.evaluate(el=>el.scrollLeft+el.clientWidth>=el.scrollWidth-1),true);
        }
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth||document.documentElement.scrollHeight>innerHeight),false);
      }
    }
    await writeFile(join(directory,'appearance.json'),JSON.stringify({observations,errors,scope:'Synthetic three-chart check; pure colors and computed styles; not whole-site WCAG or AC31'},null,2));
    assert.deepEqual(errors,[]);
    for(const row of observations){
      assert.equal(row.reduced,true);assert.deepEqual(row.activeAnimations.filter((a:any)=>a.duration>150||a.frames.some((frame:any)=>Object.keys(frame).some(key=>!['opacity','offset','computedOffset','easing','composite'].includes(key)))),[],row.view+' running reduce animation');
      assert.deepEqual(row.motion.filter((m:any)=>!['none','opacity'].includes(m.transition)||m.duration.split(',').some((v:string)=>parseFloat(v)>.15)||m.animation!=='none'||m.scroll!=='auto'),[],row.view+' reduced motion');
      assert.ok(row.texts.length>0&&row.graphics.length>0);assert.ok(row.focus&&parseFloat(row.focus.width)>=2&&row.focus.ratio+.01>=3,row.view+' focus contrast');
      assert.deepEqual([...row.texts,...row.graphics].filter((color:any)=>color.ratio+.01<color.minimum),[],`${row.view} ${row.width} ${row.theme} contrast`);
    }
  }finally{await browser?.close();await f.close();}
});
