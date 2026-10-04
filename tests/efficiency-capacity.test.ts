import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,resolve,basename} from 'node:path';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {restoreBundle,seedBundle,disposeOwned} from './ac32-fixture.js';
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
  }finally{await disposeOwned(f,owner);if(!process.env.SKYNET_CAPACITY_SOURCE){assert.equal(dirname(resolve(directory)),resolve(tmpdir()));assert.match(basename(directory),/^skynet-eff-capacity-/);await rm(directory,{recursive:true,force:true});}}
});
