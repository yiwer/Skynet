import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,resolve,basename} from 'node:path';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {request as httpRequest} from 'node:http';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {restoreBundle,seedBundle,disposeOwned,appendLate} from './ac32-fixture.js';
import {mcpSandbox} from './mcp-support.js';

test('a thousand-session efficiency report preserves complete timing behind bounded public pages', {timeout:600000}, async()=>{
  const directory=process.env.SKYNET_CAPACITY_SOURCE??await mkdtemp(join(tmpdir(),'skynet-eff-capacity-'));
  const source=process.env.SKYNET_CAPACITY_SOURCE??join(directory,'source');
  if(!process.env.SKYNET_CAPACITY_SOURCE)await seedBundle(source,'efficiency-capacity',false,true);
  const {sandbox,owner,bundle}=await restoreBundle(source);
  const f=await mcpSandbox({sandbox,reportClock:()=>new Date(bundle.clock)}).catch(async error=>{await disposeOwned(sandbox,owner);throw error;});
  try{
    assert.deepEqual([bundle.dataset.sessions,bundle.dataset.businessEvents,bundle.dataset.waits],[1000,80000,19000]);
    const response=await f.api('/api/session-efficiency?period=since-enrollment',bundle.people[0]!.readerCredential);
    const bytes=await response.text();assert.equal(response.status,200,bytes);
    const page=JSON.parse(bytes);assert.equal(page.total,1000);assert.equal(page.tokenP75,2500);
    assert.ok(page.sessions.length>0&&page.sessions.length<=20);assert.ok(Buffer.byteLength(bytes)<=80*1024);
    assert.ok(page.sessions.every((row:any)=>row.userTurns===20&&row.tokens===2500&&row.timing.segmentTotal===39));
    assert.ok(page.sessions.every((row:any)=>row.timing.segments.length<=5&&row.timing.nextSegmentOffset===row.timing.segments.length));
    const resource=f.origin+'/mcp',credential=bundle.people[0]!.readerCredential;
    const post=(path:string,payload:unknown)=>f.api(path,credential,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    const registration=await(await post('/oauth/register',{client_name:'Efficiency complete reader',redirect_uris:['http://127.0.0.1:47215/callback'],token_endpoint_auth_method:'none'})).json();
    const verifier=randomBytes(48).toString('base64url');
    const callback=new URL(await f.authorizationPage(f.origin+'/oauth/authorize?'+new URLSearchParams({response_type:'code',client_id:registration.client_id,redirect_uri:registration.redirect_uris[0],scope:'archive:read',resource,state:randomUUID(),code_challenge_method:'S256',code_challenge:createHash('sha256').update(verifier).digest('base64url')}),credential));
    const token=await(await f.api('/oauth/token',undefined,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:registration.client_id,code:callback.searchParams.get('code')!,redirect_uri:registration.redirect_uris[0],code_verifier:verifier,resource}).toString()})).json();
    const client=new Client({name:'efficiency-capacity',version:'1'});
    try{
      await client.connect(new StreamableHTTPClientTransport(new URL(resource),{fetch:f.fetchTls,requestInit:{headers:{Authorization:'Bearer '+token.access_token}}}));
      const result=await client.callTool({name:'read_session_efficiency',arguments:{period:'since-enrollment',version:page.version}});
      assert.notEqual(result.isError,true,JSON.stringify(result));
      assert.deepEqual(JSON.parse((result.content as {text:string}[])[0]!.text),page);
      assert.ok(Buffer.byteLength(JSON.stringify(result))<=48*1024,'actual MCP envelope must fit 48 KiB');
    }finally{await client.close();}
    const fixed='period=since-enrollment&version='+page.version,downloadPath='/api/session-efficiency/export?'+fixed;
    const exported=await f.api(downloadPath,credential),downloadBytes=Buffer.from(await exported.arrayBuffer());
    assert.equal(exported.status,200,downloadBytes.toString('utf8').slice(0,300));
    assert.ok(downloadBytes.length>16*1024*1024,'complete evidence must exercise the former export boundary');
    assert.equal(Number(exported.headers.get('content-length')),downloadBytes.length);
    assert.equal(exported.headers.get('x-skynet-content-sha256'),createHash('sha256').update(downloadBytes).digest('hex'));
    const complete=JSON.parse(downloadBytes.toString('utf8'));assert.equal(complete.sessions.length,1000);
    assert.equal(complete.sessions.reduce((n:number,row:any)=>n+row.timing.segments.length,0),39000);
    assert.equal(complete.sessions.filter((row:any)=>row.taskType==='implementation').length,20);
    assert.equal(complete.sessions.filter((row:any)=>row.taskType==='unknown').length,980);
    const summaries:any[]=[];let cursor:number|null=0;
    while(cursor!==null){const response=await f.api('/api/session-efficiency?'+fixed+'&section=summaries&offset='+cursor,credential);
      const text=await response.text();assert.equal(response.status,200,text);assert.ok(Buffer.byteLength(text)<=80*1024);
      const value=JSON.parse(text);summaries.push(...value.sessions);assert.ok(value.nextOffset===null||value.nextOffset>cursor);cursor=value.nextOffset;}
    assert.equal(new Set(summaries.map(row=>row.sessionId)).size,1000);
    for(const row of summaries){assert.equal(row.timing.segments.length,0);const original=complete.sessions.find((item:any)=>item.sessionId===row.sessionId);
      assert.deepEqual(row,{...original,timing:{...original.timing,segments:[],nextSegmentOffset:0}});}
    const recomputed=await f.api('/api/session-efficiency/recompute',credential,{method:'POST',headers:{'Content-Type':'application/json'},body:'{"period":"since-enrollment"}'});
    assert.equal(recomputed.status,200,await recomputed.clone().text());assert.deepEqual(await recomputed.json(),page);
    // A separate actual HTTP process exercises disconnect/backpressure directly;
    // the TLS fixture proxy deliberately buffers responses and cannot prove it.
    const server=await f.startServer();
    try{
      for(let index=0;index<10;index++)await new Promise<void>((resolve,reject)=>{
        const request=httpRequest(server+downloadPath,{headers:{Authorization:'Bearer '+credential}},response=>{
          try{assert.equal(response.statusCode,200);assert.equal(Number(response.headers['content-length']),downloadBytes.length);response.pause();request.destroy();resolve();}catch(error){request.destroy();reject(error);}
        });request.setTimeout(30000,()=>request.destroy(new Error('aborted download deadline')));request.on('error',reject);request.end();
      });
      const afterAbort=await fetch(server+downloadPath,{headers:{Authorization:'Bearer '+credential},signal:AbortSignal.timeout(30000)});
      assert.equal(afterAbort.status,200);assert.deepEqual(Buffer.from(await afterAbort.arrayBuffer()),downloadBytes);
    }finally{await f.stopServer();}
    await appendLate(f.api,f.directory,bundle);
    const next=await f.api('/api/session-efficiency?period=since-enrollment',credential);assert.equal(next.status,200,await next.clone().text());assert.notEqual((await next.json()).version,page.version);
    await f.restart();const historical=await f.api(downloadPath,credential);assert.equal(historical.status,200);assert.deepEqual(Buffer.from(await historical.arrayBuffer()),downloadBytes);
    assert.equal((await f.api('/api/session-efficiency?'+fixed+'&source=claude-code-cli',credential)).status,409);
  }finally{await disposeOwned(f,owner);if(!process.env.SKYNET_CAPACITY_SOURCE){assert.equal(dirname(resolve(directory)),resolve(tmpdir()));assert.match(basename(directory),/^skynet-eff-capacity-/);await rm(directory,{recursive:true,force:true});}}
});
