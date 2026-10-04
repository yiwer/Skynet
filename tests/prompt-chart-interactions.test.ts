import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium,expect,type Browser,type Locator} from '@playwright/test';
import {assessmentFixture} from './assessment-fixture.js';

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
      const css=getComputedStyle(el),r=el.getBoundingClientRect();if(!r.width||!r.height)continue;
      const color=el instanceof SVGElement?(css.stroke==='none'?css.fill:css.stroke):css.backgroundColor;
      const bg=background(el instanceof SVGElement?el:el.parentElement);
      graphics.push({tag:el.tagName,color,background:bg,ratio:contrast(color,bg),minimum:3});
    }
    const focused=element.querySelector(':focus-visible');
    const focus=focused?{color:getComputedStyle(focused).outlineColor,width:getComputedStyle(focused).outlineWidth,ratio:contrast(getComputedStyle(focused).outlineColor,background(focused.parentElement)),minimum:3}:null;
    return {texts,graphics,focus,motion,reduced:matchMedia('(prefers-reduced-motion:reduce)').matches,activeAnimations:element.getAnimations({subtree:true}).filter(a=>a.playState==='running').map(a=>({duration:a.effect.getTiming().duration,frames:a.effect.getKeyframes()}))};
  }`,marks});
}

// Agreed public seams: upload + recorded Analysis result -> fixed report HTTP -> real Web.
async function promptPage(includeUnknown=false,duplicate=false,employee='提示词交互合成员工'){
  const f=await assessmentFixture();let browser:Browser|undefined;
  try{
    const owner=await f.owner(employee);await f.session(owner,{prompts:3,elements:3,rework:false});
    if(duplicate){const twin=await f.owner(employee);await f.session(twin,{prompts:3,elements:3,rework:false});}
    if(includeUnknown){const peer=await f.owner('未分析员工'),raw=f.rows({prompts:2,elements:0});await f.upload(peer,raw.rows,raw.sessionId);}
    const response=await f.api(owner,'/api/prompt-report?period=since-enrollment');assert.equal(response.status,200,await response.clone().text());
    const report=await response.json();assert.equal(report.kpis.prompts,3+(includeUnknown?2:0)+(duplicate?3:0));
    browser=await chromium.launch();const page=await browser.newPage({ignoreHTTPSErrors:true,hasTouch:true,viewport:{width:390,height:900},reducedMotion:'reduce'});
    const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(f.origin+'/#prompts?period=since-enrollment&version='+report.version);
    await page.getByLabel('个人读取凭据').fill(owner.readerCredential);await page.getByRole('button',{name:'进入存档',exact:true}).click();
    const panel=page.getByRole('region',{name:'提示词分析',exact:true});await expect(panel.getByRole('heading',{name:'提示词要素覆盖',exact:true})).toBeVisible();
    const directory=process.env.SKYNET_PROMPT_CHART_EVIDENCE??join(f.directory,'prompt-charts');await mkdir(directory,{recursive:true});
    return {f,page,panel,owner,report,directory,errors,close:async()=>{await browser?.close();await f.close();}};
  }catch(error){await browser?.close();await f.close();throw error;}
}

test('prompt count bars support repeat touch and keyboard disclosure without losing literal counts',{timeout:120000},async()=>{
  const fixture=await promptPage();const {page,panel,directory,errors}=fixture;
  try{
    const chart=panel.getByRole('region',{name:'长度数量',exact:true}),bar=chart.getByRole('button',{name:/≤15 字/}),tip=chart.getByRole('tooltip');
    await bar.tap();await expect(tip).toContainText('3 条提示词');await expect(tip).toBeInViewport({ratio:1});
    await bar.tap();
    await writeFile(join(directory,'count-second-tap.json'),JSON.stringify({version:fixture.report.version,count:3,remainingTooltips:await tip.count()},null,2));
    await page.screenshot({path:join(directory,'count-second-tap.png'),animations:'disabled'});
    await expect(tip).toHaveCount(0);
    await bar.tap();await expect(tip).toContainText('3 条提示词');await page.keyboard.press('Escape');await expect(tip).toHaveCount(0);
    await page.keyboard.press('Enter');await expect(tip).toContainText('3 条提示词');await page.keyboard.press('Space');await expect(tip).toHaveCount(0);
    await bar.press('Tab');await bar.focus();await expect(tip).toContainText('3 条提示词');await bar.press('Tab');await expect(tip).toContainText('16–30 字 · 0 条提示词');
    await chart.getByRole('button',{name:'长度数量切换为表格',exact:true}).focus();await expect(tip).toHaveCount(0);
    await chart.getByRole('button',{name:'长度数量切换为表格',exact:true}).tap();
    await expect(chart.getByRole('row').filter({has:page.getByRole('rowheader',{name:'≤15 字',exact:true})}).getByRole('cell')).toHaveText('3');
    assert.deepEqual(errors,[]);
  }finally{await fixture.close();}
});


test('prompt element heat details retain known zero and unknown denominators through touch and focus',{timeout:120000},async()=>{
  const fixture=await promptPage(true);const {page,panel,directory,errors}=fixture;
  try{
    const chart=panel.getByRole('region',{name:'提示词要素覆盖',exact:true}),tip=chart.getByRole('tooltip');
    const known=chart.getByRole('button',{name:'提示词交互合成员工 · 目标 · 3 / 3 · 100%',exact:true});
    await known.tap();await expect(tip).toHaveText('提示词交互合成员工 · 目标 · 3 / 3');await expect(tip).toBeInViewport({ratio:1});
    await known.tap();await expect(tip).toHaveCount(0);
    const zero=chart.getByRole('button',{name:'提示词交互合成员工 · 验收标准 · 0 / 3 · 0%',exact:true});
    await zero.tap();await expect(tip).toHaveText('提示词交互合成员工 · 验收标准 · 0 / 3');await page.keyboard.press('Escape');await expect(tip).toHaveCount(0);
    await page.keyboard.press('Enter');await expect(tip).toContainText('0 / 3');await page.keyboard.press('Space');await expect(tip).toHaveCount(0);
    const unknown=chart.getByRole('button',{name:'未分析员工 · 目标 · 0 / 0 · 2 未知 · —',exact:true});
    await unknown.tap();await expect(tip).toHaveText('未分析员工 · 目标 · 0 / 0 · 2 未知');await expect(tip).toBeInViewport({ratio:1});
    await page.screenshot({path:join(directory,'heat-unknown.png'),animations:'disabled'});
    await chart.getByRole('button',{name:'提示词要素覆盖切换为表格',exact:true}).tap();
    await expect(chart.getByRole('row').filter({has:page.getByRole('rowheader',{name:'未分析员工',exact:true})}).getByRole('cell').first()).toHaveText('—0 / 0 · 2 未知');
    assert.deepEqual(errors,[]);
  }finally{await fixture.close();}
});


test('prompt task mix toggles complete composition details without changing known or unknown totals',{timeout:120000},async()=>{
  const fixture=await promptPage(true);const {page,panel,directory,errors}=fixture;
  try{
    const chart=panel.getByRole('region',{name:'任务类型构成',exact:true}),tip=chart.getByRole('tooltip'),known=chart.getByRole('button',{name:'提示词交互合成员工 · 实现与修复 · 3 / 3 条',exact:true});
    await known.tap();await expect(tip).toHaveText('提示词交互合成员工 · 实现与修复 · 3 / 3 条');await expect(tip).toBeInViewport({ratio:1});
    await known.tap();await expect(tip).toHaveCount(0);
    await known.tap();await page.keyboard.press('Escape');await expect(tip).toHaveCount(0);
    await page.keyboard.press('Enter');await expect(tip).toContainText('3 / 3 条');await page.keyboard.press('Space');await expect(tip).toHaveCount(0);
    const unknown=chart.getByRole('button',{name:'未分析员工 · 未知 · 2 / 2 条',exact:true});
    await unknown.tap();await expect(tip).toHaveText('未分析员工 · 未知 · 2 / 2 条');await expect(tip).toBeInViewport({ratio:1});
    await page.screenshot({path:join(directory,'task-unknown.png'),animations:'disabled'});
    await chart.getByRole('button',{name:'任务类型构成切换为表格',exact:true}).tap();
    assert.deepEqual(await chart.getByRole('row').filter({has:page.getByRole('rowheader',{name:'未分析员工',exact:true})}).getByRole('cell').allTextContents(),['0','0','0','0','2','2']);
    assert.deepEqual(errors,[]);
  }finally{await fixture.close();}
});


test('all five prompt charts retain values and complete interactive details across five widths and both themes',{timeout:240000},async()=>{
  const fixture=await promptPage(true);const {page,panel,directory,errors,report}=fixture,observations:any[]=[];
  try{
    assert.deepEqual(report.contextComparison.withContext,{numerator:0,denominator:2,unknown:0,value:0});
    assert.deepEqual(report.contextComparison.withoutContext,{numerator:0,denominator:0,unknown:0,value:null});
    assert.deepEqual(report.lengths[0].rework,{numerator:0,denominator:2,unknown:1,value:0});
    const charts=[
      {label:'提示词要素覆盖',button:'提示词交互合成员工 · 目标 · 3 / 3 · 100%',detail:'提示词交互合成员工 · 目标 · 3 / 3',marks:'.no-graphic'},
      {label:'上下文与返工',button:'上一条有上下文：0%，0 / 2',detail:'0 / 2',marks:'.prompt-bar-fill'},
      {label:'长度数量',button:'≤15 字：5，≤15 字 · 5 条提示词',detail:'≤15 字 · 5 条提示词',marks:'.prompt-bar-fill'},
      {label:'长度返工率',button:'≤15 字：0%，≤15 字 · 0 / 2 · 1 未知',detail:'≤15 字 · 0 / 2 · 1 未知',marks:'.prompt-bar-fill'},
      {label:'任务类型构成',button:'提示词交互合成员工 · 实现与修复 · 3 / 3 条',detail:'提示词交互合成员工 · 实现与修复 · 3 / 3 条',marks:'.prompt-stack>span'}
    ];
    for(const width of [320,390,768,1280,1920])for(const theme of ['light','dark']){
      await page.setViewportSize({width,height:900});await page.evaluate(value=>document.documentElement.dataset.theme=value,theme);
      for(const [index,item] of charts.entries()){
        const chart=panel.getByRole('region',{name:item.label,exact:true}),button=chart.getByRole('button',{name:item.button,exact:true}),tip=chart.getByRole('tooltip');
        await page.mouse.move(0,0);await page.keyboard.press('Escape');await button.tap();
        await expect(tip).toHaveText(item.detail);await expect(tip).toBeInViewport({ratio:1});
        const target=(await button.boundingBox())!,popup=(await tip.boundingBox())!;
        assert.ok(target.width>=44&&target.height>=44,`${item.label} ${width} ${theme} touch target`);
        assert.ok(popup.y+popup.height<=target.y||popup.y>=target.y+target.height,`${item.label} tooltip does not cover its activator`);
        await page.screenshot({path:join(directory,`chart-${index}-${width}-${theme}.png`),animations:'disabled'});
        await button.tap();await expect(tip).toHaveCount(0);
        await button.tap();await page.keyboard.press('Escape');await expect(tip).toHaveCount(0);
        await page.keyboard.press('Enter');await expect(tip).toHaveText(item.detail);await page.keyboard.press('Space');await expect(tip).toHaveCount(0);
        await button.press('Tab');await button.focus();await expect(tip).toHaveText(item.detail);
        const appearance=await chartAppearance(chart,item.marks);observations.push({label:item.label,width,theme,target,popup,...appearance});
        await page.keyboard.press('Escape');await chart.getByRole('button',{name:item.label+'切换为表格',exact:true}).focus();
        await button.hover();await expect(tip).toHaveText(item.detail);await tip.hover();await expect(tip).toBeInViewport({ratio:1});
        await page.mouse.move(0,0);await expect(tip).toHaveCount(0);
      }
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth||document.documentElement.scrollHeight>innerHeight),false,`${width} ${theme} outer scrolling`);
    }
    for(const label of ['上下文与返工','长度返工率']){
      const chart=panel.getByRole('region',{name:label,exact:true});await chart.getByRole('button',{name:label+'切换为表格',exact:true}).tap();
      if(label==='上下文与返工'){
        assert.deepEqual(await chart.getByRole('row').filter({has:page.getByRole('rowheader',{name:'提供了上下文',exact:true})}).getByRole('cell').allTextContents(),['0%','0 / 2','0']);
        assert.deepEqual(await chart.getByRole('row').filter({has:page.getByRole('rowheader',{name:'没有上下文',exact:true})}).getByRole('cell').allTextContents(),['—','0 / 0','0']);
      }else{
        assert.deepEqual(await chart.getByRole('row').filter({has:page.getByRole('rowheader',{name:'≤15 字',exact:true})}).getByRole('cell').allTextContents(),['0%','0 / 2','1']);
        assert.deepEqual(await chart.getByRole('row').filter({has:page.getByRole('rowheader',{name:'16–30 字',exact:true})}).getByRole('cell').allTextContents(),['—','0 / 0','0']);
      }
    }
    assert.deepEqual(errors,[]);
    for(const row of observations){
      assert.equal(row.reduced,true);assert.deepEqual(row.activeAnimations.filter((a:any)=>a.duration>150||a.frames.some((frame:any)=>Object.keys(frame).some(key=>!['opacity','offset','computedOffset','easing','composite'].includes(key)))),[],row.label+' running reduce animation');
      assert.deepEqual(row.motion.filter((m:any)=>!['none','opacity'].includes(m.transition)||m.duration.split(',').some((v:string)=>parseFloat(v)>.15)||m.animation!=='none'||m.scroll!=='auto'),[],row.label+' reduced motion');
      assert.ok(row.texts.length>0);assert.ok(row.focus&&parseFloat(row.focus.width)>=2&&row.focus.ratio+.01>=3,row.label+' focus contrast');
      assert.deepEqual([...row.texts,...row.graphics].filter((color:any)=>color.ratio+.01<color.minimum),[],`${row.label} ${row.width} ${row.theme} contrast`);
    }
  }finally{await writeFile(join(directory,'appearance.json'),JSON.stringify({version:report.version,observations,errors,scope:'Five prompt charts, five widths, two themes; visible pure colors and computed reduced-motion styles only'},null,2));await fixture.close();}
});


test('prompt details identify same-name employees separately and allow long tooltip text to scroll',{timeout:120000},async()=>{
  const name='合成同名员工'.repeat(30),fixture=await promptPage(false,true,name),{page,panel,directory}=fixture;
  try{
    await page.setViewportSize({width:320,height:900});
    for(const [label,selector,detail] of [
      ['提示词要素覆盖','.prompt-heat button',name+' · 目标 · 3 / 3'],
      ['任务类型构成','.prompt-task-detail',name+' · 实现与修复 · 3 / 3 条']] as const){
      const chart=panel.getByRole('region',{name:label,exact:true}),button=chart.getByRole('button',{name:label==='提示词要素覆盖'?detail+' · 100%':detail,exact:true}).nth(1),tip=chart.getByRole('tooltip');
      await button.tap();await expect(tip).toHaveText(detail);await expect(tip).toBeInViewport({ratio:1});
      await expect(chart.locator(selector+'[aria-expanded="true"]')).toHaveCount(1);await expect(button).toHaveAttribute('aria-expanded','true');
      const target=(await button.boundingBox())!,popup=(await tip.boundingBox())!;
      assert.ok(popup.y+popup.height<=target.y||popup.y>=target.y+target.height);
      assert.equal(await tip.evaluate(el=>el.scrollHeight>el.clientHeight),true);
      await tip.hover();await page.mouse.wheel(0,1000);await expect.poll(()=>tip.evaluate(el=>el.scrollTop)).toBeGreaterThan(0);
      await page.screenshot({path:join(directory,label==='提示词要素覆盖'?'same-name-heat.png':'same-name-task.png'),animations:'disabled'});
      await button.tap();await expect(tip).toHaveCount(0);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth||document.documentElement.scrollHeight>innerHeight),false);
    }
  }finally{await fixture.close();}
});
