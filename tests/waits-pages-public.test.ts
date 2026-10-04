import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {writeFile,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {assessmentFixture} from './assessment-fixture.js';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {chromium,expect,type Browser} from '@playwright/test';

test('wait sections retain complete daily and unavailable counts while each fixed response stays bounded', {timeout:240000},async()=>{
  const f=await assessmentFixture(),restore:{path:string;bytes:Buffer}[]=[];let client:Client|undefined,browser:Browser|undefined;
  try{
    const healthy=await f.owner('完整等待员工'),missing=await f.owner('原件缺失员工');
    const id=randomUUID(),rows:object[]=[{type:'session_meta',payload:{id}}];
    const time=(day:number,second:number)=>new Date(f.base.getTime()+day*86400000+second*1000).toISOString();
    for(let day=0;day<130;day++)rows.push(
      {type:'response_item',timestamp:time(day,0),payload:{type:'message',role:'user',content:[{type:'input_text',text:'开始 '+day}]}},
      {type:'event_msg',timestamp:time(day,0),payload:{type:'task_started',turn_id:id+'/'+day}},
      {type:'response_item',timestamp:time(day,1),payload:{type:'message',role:'assistant',content:[{type:'output_text',text:'完成 '+day}]}},
      {type:'event_msg',timestamp:time(day,2),payload:{type:'task_complete',turn_id:id+'/'+day}},
      {type:'response_item',timestamp:time(day,3),payload:{type:'message',role:'user',content:[{type:'input_text',text:'下一步 '+day}]}});
    f.now.setTime(f.base.getTime()+131*86400000);
    const good=await f.upload(healthy,rows,id);
    for(let index=0;index<40;index++){
      const source=f.rows({prompts:1,verified:0,claimed:0}),record=await f.upload(missing,source.rows,source.sessionId,{project:'/synthetic/'+String(index)+'/'+'项目'.repeat(470)});
      const path=join(f.directory,'raw',missing.deviceId,createHash('sha256').update(record.bytes).digest('hex'));restore.push({path,bytes:record.bytes});await unlink(path);
    }
    const query='period=since-enrollment';
    const get=async(extra='')=>{const response=await f.api(healthy,'/api/waits?'+query+extra),bytes=Buffer.from(await response.arrayBuffer());assert.equal(response.status,200,bytes.toString().slice(0,1000));assert.ok(bytes.length<=32*1024);return JSON.parse(bytes.toString());};
    const first=await get();assert.equal(first.total,130);assert.equal(first.summary.knownReplyWaitMs,130000);assert.equal(first.summary.replyWaitMs,null);
    assert.deepEqual(Object.fromEntries(Object.entries(first.pages).map(([key,value]:[string,any])=>[key,value.total])),{intervals:130,daily:130,unavailableSources:40,employees:2});
    const all:any={...first};
    for(const section of ['intervals','daily','unavailableSources','employees']){
      const values:any[]=[];let offset=0;
      do{
        const page=await get('&version='+first.version+'&section='+section+'&offset='+offset);
        assert.equal(page.version,first.version);assert.equal(page.pages[section].offset,offset);values.push(...page[section]);
        if(page.pages[section].nextOffset===null)break;
        assert.ok(page.pages[section].nextOffset>offset);offset=page.pages[section].nextOffset;
      }while(true);
      assert.equal(values.length,first.pages[section].total);all[section]=values;
    }
    assert.deepEqual(all.employees.map((value:any)=>value.employeeId).sort(),[healthy.employeeId,missing.employeeId].sort());
    assert.ok(all.daily.every((day:any)=>day.knownReplyWaitMs===1000&&day.unknownReplyWaitCount===0));
    assert.ok(all.unavailableSources.every((value:any)=>value.employeeId===missing.employeeId&&value.reason==='missing'&&value.evidence.webPath));
    const exported=await f.api(healthy,'/api/waits/export?'+query+'&version='+first.version);assert.equal(exported.status,200);
    const complete=await exported.json();for(const section of ['intervals','daily','unavailableSources'])assert.deepEqual(all[section],complete[section]);
    const resource=f.origin+'/mcp',body=(value:unknown)=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});
    const registration=await(await f.nativeApi('/oauth/register',healthy.readerCredential,body({client_name:'Fixed waits reader',redirect_uris:['http://127.0.0.1:47125/callback'],token_endpoint_auth_method:'none'}))).json();
    const verifier=randomBytes(48).toString('base64url');
    const callback=new URL(await f.authorizationPage(f.origin+'/oauth/authorize?'+new URLSearchParams({response_type:'code',client_id:registration.client_id,redirect_uri:registration.redirect_uris[0],scope:'archive:read',resource,state:randomUUID(),code_challenge_method:'S256',code_challenge:createHash('sha256').update(verifier).digest('base64url')}),healthy.readerCredential));
    const token=await(await f.nativeApi('/oauth/token',undefined,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:registration.client_id,code:callback.searchParams.get('code')!,redirect_uri:registration.redirect_uris[0],code_verifier:verifier,resource}).toString()})).json();
    client=new Client({name:'waits-fixed-pages-public',version:'1'});await client.connect(new StreamableHTTPClientTransport(new URL(resource),{fetch:f.fetchTls,requestInit:{headers:{Authorization:'Bearer '+token.access_token}}}));
    for(const section of ['intervals','daily','unavailableSources','employees']){
      let offset=0;const values:unknown[]=[];
      do{
        const result=await client.callTool({name:'read_waits',arguments:{period:'since-enrollment',version:first.version,section,offset}});
        assert.notEqual(result.isError,true,JSON.stringify(result));assert.ok(Buffer.byteLength(JSON.stringify(result))<=48*1024);
        const page=JSON.parse((result.content as {text:string}[])[0]!.text);
        assert.deepEqual(page,await get('&version='+first.version+'&section='+section+'&offset='+offset));values.push(...page[section]);
        if(page.pages[section].nextOffset===null)break;assert.ok(page.pages[section].nextOffset>offset);offset=page.pages[section].nextOffset;
      }while(true);
      assert.deepEqual(values,all[section]);
    }
    await client.close();client=undefined;
    for(const suffix of ['&section=daily&offset=0','&section=employees&offset=0','&version='+first.version+'&section=daily&offset=131','&version='+first.version+'&section=daily&contextSnapshotId='+good.snapshotId+'&lines=1'])
      assert.equal((await f.api(healthy,'/api/waits?'+query+suffix)).status,400);
    assert.equal((await f.api(healthy,'/api/waits/recompute',{period:'since-enrollment',section:'daily'})).status,400);
    assert.equal((await f.api(healthy,'/api/waits/export?'+query+'&version='+first.version+'&section=daily')).status,400);
    browser=await chromium.launch();const page=await browser.newPage({ignoreHTTPSErrors:true,viewport:{width:390,height:844}});const downloads:string[]=[],readingErrors:string[]=[],readingResponses:unknown[]=[];
    page.on('pageerror',error=>readingErrors.push(error.message));page.on('response',response=>{if(new URL(response.url()).pathname==='/api/waits')readingResponses.push({query:new URL(response.url()).search,status:response.status()});});
    page.on('request',request=>{if(new URL(request.url()).pathname==='/api/waits/export')downloads.push(request.url());});
    await page.goto(f.origin+'/#waits?'+query+'&version='+first.version);await page.getByLabel('个人读取凭据').fill(healthy.readerCredential);await page.getByRole('button',{name:'进入存档',exact:true}).click();
    await expect(page.getByText('区间总数未知',{exact:false})).toBeVisible();
    await page.locator('.waiting-report summary').filter({hasText:'按日查看 · 130 天'}).click();
    while(await page.getByRole('button',{name:'更多日期',exact:true}).count()){
      const button=page.getByRole('button',{name:'更多日期',exact:true}),table=page.getByRole('table',{name:'按日等待',exact:true}).locator('tbody tr'),before=await table.count();
      await expect(button).toBeEnabled();await button.click();await expect.poll(()=>table.count()).toBeGreaterThan(before).catch(async error=>{throw new Error(String(error)+' '+JSON.stringify({readingErrors,readingResponses,alerts:await page.getByRole('alert').allTextContents(),rows:await table.count()}));});
    }
    await expect(page.getByRole('table',{name:'按日等待',exact:true}).locator('tbody tr')).toHaveCount(130);
    await page.locator('.waiting-report summary').filter({hasText:'不可读取来源 · 40 项'}).click();
    while(await page.getByRole('button',{name:'更多来源',exact:true}).count()){
      const button=page.getByRole('button',{name:'更多来源',exact:true}),table=page.getByRole('table',{name:'不可读取来源',exact:true}).locator('tbody tr'),before=await table.count();
      await expect(button).toBeEnabled();await button.click();await expect.poll(()=>table.count()).toBeGreaterThan(before);
    }
    await expect(page.getByRole('table',{name:'不可读取来源',exact:true}).locator('tbody tr')).toHaveCount(40);
    assert.deepEqual(downloads,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight),true);
    await browser.close();browser=undefined;
    for(const source of restore)await writeFile(source.path,source.bytes);
    const recovered=await get();assert.equal(recovered.pages.unavailableSources.total,0);assert.notEqual(recovered.version,first.version);
    assert.deepEqual(await get('&version='+first.version),first);
  }finally{await browser?.close();await client?.close();for(const source of restore)await writeFile(source.path,source.bytes);await f.close();}
});
