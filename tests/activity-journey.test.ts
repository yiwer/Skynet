import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID,randomBytes,createHash } from 'node:crypto';
import { mkdir,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { chromium,expect,type Browser } from '@playwright/test';
import { mcpSandbox } from './mcp-support.js';
import { digest } from '../apps/server/database.js';
const params=(value:object)=>new URLSearchParams(Object.entries(value).filter(([,v])=>v!==undefined).map(([k,v])=>[k,String(v)]));
test('activity Web, OAuth MCP, source links, lane table and export preserve one version across pagination and late uploads',{timeout:180000},async()=>{
  const base=new Date();base.setUTCDate(base.getUTCDate()+1);base.setUTCHours(2,0,0,0);const date=base.toISOString().slice(0,10),time=(n:number)=>new Date(+base+n*60000).toISOString();
  const sandbox=await mcpSandbox({reportClock:()=>new Date(+base+3600000)});let browser:Browser|undefined,client:Client|undefined;
  const directory=process.env.SKYNET_ACTIVITY_EVIDENCE_DIR??join(sandbox.directory,'activity-evidence');await mkdir(directory,{recursive:true});
  try{
    const person=await sandbox.provision('张活动'),other=await sandbox.provision('安活动'),json=(body:object)=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const api=(path:string,init:RequestInit={})=>sandbox.api(path,person.readerCredential,init);
    const enroll=async(employee:any)=>(await(await sandbox.api('/api/devices/enroll',employee.enrollmentCredential,json({installationId:randomUUID(),name:'活动旅程设备'}))).json());
    const device=await enroll(person),otherDevice=await enroll(other),id=randomUUID();
    const msg=(text:string,n:number)=>({type:'response_item',timestamp:time(n),payload:{type:'message',id:randomUUID(),role:'user',content:[{type:'input_text',text}]}});
    const rows=[{type:'session_meta',timestamp:time(0),payload:{id}},...Array.from({length:30},(_,i)=>msg('逐条检查活动 '+String(i+1).padStart(2,'0'),i))];
    const upload=async(device:any,items:unknown[],sessionId:string)=>{const raw=Buffer.from(items.map(item=>JSON.stringify(item)).join('\n')+'\n');assert.ok([200,201].includes((await sandbox.api('/api/chunks/'+digest(raw),device.deviceCredential,{method:'PUT',headers:{'Content-Type':'application/octet-stream'},body:raw})).status));const result=await sandbox.api('/api/snapshots',device.deviceCredential,json({protocolVersion:1,sourceSessionId:sessionId,source:'codex-cli',sourceVersion:'0.160.0',sourceOs:process.platform,project:'/activity/journey',hash:digest(raw),byteLength:raw.length,qualifiedAt:time(0),capability:'unverified'}));assert.equal(result.status,200);return(await result.json()).snapshotId;};
    const snapshotId=await upload(device,rows,id);await upload(otherDevice,[msg('安活动唯一请求',45)],randomUUID());
    const firstResponse=await api('/api/activity?date='+date);assert.equal(firstResponse.status,200);const first=await firstResponse.json();assert.equal(first.events.length,25);assert.equal(first.total,32);assert.deepEqual(first.lanes.map((lane:any)=>lane.employee),['安活动','张活动']);assert.equal(first.nextLaneOffset,25);
    const query={date,version:first.version},second=await(await api('/api/activity?'+params({...query,offset:25}))).json();
    const exported=await(await api('/api/activity/export?'+params(query))).json();assert.deepEqual(exported.events,[...first.events,...second.events]);
    const remainingLanes=await(await api('/api/activity?'+params({...query,section:'lanes',offset:first.nextLaneOffset}))).json();assert.equal(remainingLanes.nextOffset,null);assert.equal(remainingLanes.events.length,0);assert.equal(remainingLanes.lanes[0].points.length,8);
    const resource=sandbox.origin+'/mcp',registration=await(await api('/oauth/register',json({client_name:'Activity reader',redirect_uris:['http://127.0.0.1:47125/callback'],token_endpoint_auth_method:'none'}))).json();
    const verifier=randomBytes(48).toString('base64url');const callback=new URL(await sandbox.authorizationPage(sandbox.origin+'/oauth/authorize?'+params({response_type:'code',client_id:registration.client_id,redirect_uri:registration.redirect_uris[0],scope:'archive:read',resource,state:randomUUID(),code_challenge_method:'S256',code_challenge:createHash('sha256').update(verifier).digest('base64url')}),person.readerCredential));
    const token=await(await api('/oauth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:params({grant_type:'authorization_code',client_id:registration.client_id,code:callback.searchParams.get('code'),redirect_uri:registration.redirect_uris[0],code_verifier:verifier,resource}).toString()})).json();
    client=new Client({name:'activity-reader',version:'1'});await client.connect(new StreamableHTTPClientTransport(new URL(resource),{fetch:sandbox.fetchTls,requestInit:{headers:{Authorization:`Bearer ${token.access_token}`}}}));
    const result=await client.callTool({name:'list_activity',arguments:query});assert.notEqual(result.isError,true,JSON.stringify(result));assert.deepEqual(JSON.parse((result.content as {text:string}[])[0]!.text),first);
    const mcpSecond=await client.callTool({name:'list_activity',arguments:{...query,offset:25}});assert.notEqual(mcpSecond.isError,true);assert.deepEqual(JSON.parse((mcpSecond.content as {text:string}[])[0]!.text),second);
    const late=msg('晚到一条原日期记录',35);await upload(device,[...rows,late],id);assert.equal((await(await api('/api/activity?date='+date)).json()).total,33);assert.deepEqual(await(await api('/api/activity?'+params(query))).json(),first);
    await client.close();client=undefined;await sandbox.restart();assert.deepEqual(await(await api('/api/activity?'+params(query))).json(),first);
    browser=await chromium.launch();const page=await browser.newPage({ignoreHTTPSErrors:true,viewport:{width:1280,height:900}});const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(sandbox.origin+'/#activity?'+params(query));await page.getByLabel('个人读取凭据').fill(person.readerCredential);await page.getByRole('button',{name:'进入存档',exact:true}).click();
    await expect(page.getByRole('heading',{name:'活动记录',exact:true})).toBeVisible();await expect(page.getByRole('table',{name:'活动记录'}).locator('tbody tr')).toHaveCount(25);
    await expect(page.getByRole('img',{name:'对话节奏'})).toBeVisible();await page.getByRole('button',{name:'节奏表格',exact:true}).click();await expect(page.getByRole('table',{name:'对话节奏表格'}).locator('tbody tr')).toHaveCount(33);
    await page.getByRole('button',{name:'节奏图表',exact:true}).click();const point=page.getByRole('link',{name:'张活动 · 提问 · 10:00:00',exact:true});await point.focus();await expect(page.getByRole('tooltip')).toContainText('10:00:00');await page.keyboard.press('Escape');await expect(page.getByRole('tooltip')).toHaveCount(0);await page.keyboard.press('Enter');await expect(page.getByLabel('对话阅读')).toBeVisible();await expect(page.getByRole('heading',{name:'逐条检查活动 01',exact:true})).toBeVisible();await expect(page.getByRole('region',{name:'对话阅读',exact:true}).getByText('逐条检查活动 01',{exact:true})).toBeVisible();
    await page.goto(sandbox.origin+'/#activity?'+params(query));await expect(page.getByRole('heading',{name:'活动记录',exact:true})).toBeVisible();await page.getByRole('button',{name:'下一页活动',exact:true}).click();await expect(page.getByRole('table',{name:'活动记录'}).locator('tbody tr')).toHaveCount(7);
    await page.getByRole('button',{name:'上一页活动',exact:true}).click();
    const screenshots:string[]=[],contrastEvidence:unknown[]=[];
    for(const width of [320,768,1280,1920])for(const theme of ['light','dark']){
      await page.setViewportSize({width,height:900});await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
      await expect.poll(()=>page.locator('.activity-chart svg').evaluate(svg=>{const parent=svg.parentElement!,style=getComputedStyle(parent);return Math.abs((svg as SVGSVGElement).viewBox.baseVal.width-(parent.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight)));})).toBeLessThan(2);
      assert.ok(await page.locator('.activity-person').first().evaluate(label=>label.getBoundingClientRect().height)>=10,'chart names remain readable at narrow widths');
      await page.screenshot({path:join(directory,`activity-${width}-${theme}.png`),animations:'disabled'});screenshots.push(`activity-${width}-${theme}.png`);
      const contrasts:{text:string;ratio:number;minimum:number}[]=await page.evaluate(`(()=>{
        const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d');
        const rgba=(color)=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=color;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data];};
        const blend=(fg,bg)=>fg.slice(0,3).map((v,i)=>v*fg[3]/255+bg[i]*(1-fg[3]/255)).concat(255);
        const lum=(rgb)=>{const c=rgb.slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});return .2126*c[0]+.7152*c[1]+.0722*c[2];};
        const rows=[];
        for(const el of Array.from(document.querySelectorAll('.activity-records *'))){
          const bounds=el.getBoundingClientRect(),css=getComputedStyle(el);if(!bounds.width||!bounds.height||css.visibility==='hidden'||el.closest('[disabled]'))continue;
          const text=el instanceof HTMLInputElement||el instanceof HTMLSelectElement?el.value:Array.from(el.childNodes).filter(n=>n.nodeType===Node.TEXT_NODE).map(n=>n.textContent).join('').trim();if(!text)continue;
          let bg=[255,255,255,255];const ancestors=[];for(let p=el;p;p=p.parentElement)ancestors.unshift(p);for(const p of ancestors)bg=blend(rgba(getComputedStyle(p).backgroundColor),bg);
          const fg=blend(rgba(el instanceof SVGTextElement?css.fill:css.color),bg),a=lum(fg),b=lum(bg),size=parseFloat(css.fontSize);rows.push({text:text.slice(0,40),ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05),minimum:size>=24||size>=18.66&&Number(css.fontWeight)>=700?3:4.5});
        }return rows;
      })()`);contrastEvidence.push({width,theme,textCount:contrasts.length,minimum:Math.min(...contrasts.map(item=>item.ratio))});assert.deepEqual(contrasts.filter(item=>item.ratio+.01<item.minimum),[],`${width} ${theme} visible text contrast`);

      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight),true,`${width} ${theme} shell overflow`);
      const rail=await page.locator('.platform-rail').boundingBox();assert.ok(rail);assert.ok(width>=960?rail.x>=-1:rail.x+rail.width<=1,'rail is at its settled responsive boundary');
    }
    await page.goto(sandbox.origin+'/#activity?date='+date+'&offset=0');await expect(page.locator('.activity-scope')).toContainText('33 条');
    await upload(device,[...rows,late,msg('刷新后可见的活动',36)],id);
    await page.getByRole('button',{name:'刷新',exact:true}).click();await expect(page.locator('.activity-scope')).toContainText('34 条');
    await page.getByLabel('活动日期').fill('2020-01-01');await expect(page.getByText('暂无活动记录',{exact:true})).toBeVisible();assert.deepEqual(errors,[]);
    await writeFile(join(directory,'evidence.json'),JSON.stringify({snapshotId,version:first.version,screenshots,publicTotal:32,lateTotal:33,refreshedTotal:34,contrastEvidence,errors},null,2));
  }finally{await client?.close();await browser?.close();await sandbox.close();}
});
