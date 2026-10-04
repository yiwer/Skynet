import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {writeFile,unlink,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium,expect,type Browser} from '@playwright/test';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {assessmentFixture} from './assessment-fixture.js';
import {beijingDate} from '../packages/contracts/reports.js';

test('Web identifies unavailable originals and OAuth MCP preserves the same unknown source views as HTTP and export',{timeout:180000},async()=>{
 const f=await assessmentFixture();let browser:Browser|undefined,client:Client|undefined,restore:{path:string;bytes:Buffer}|undefined;
 try{
  const evidence=process.env.SKYNET_SOURCE_ISOLATION_EVIDENCE_DIR??join(f.directory,'source-isolation-web');await mkdir(evidence,{recursive:true});
  const owner=await f.owner('Public source failure'),record=await f.session(owner,{prompts:3});
  browser=await chromium.launch();const page=await browser.newPage({ignoreHTTPSErrors:true,viewport:{width:1280,height:900}});
  await page.goto(f.origin+'/#'+record.snapshotId);await page.getByLabel('个人读取凭据').fill(owner.readerCredential);await page.getByRole('button',{name:'进入存档',exact:true}).click();
  const insight=page.getByRole('region',{name:'会话洞察',exact:true});await expect(insight.locator('.insight-status')).toContainText('已完成');
  restore={path:join(f.directory,'raw',owner.deviceId,createHash('sha256').update(record.bytes).digest('hex')),bytes:record.bytes};await unlink(restore.path);
  await insight.getByRole('button',{name:'刷新会话洞察',exact:true}).click();await expect(insight.locator('.insight-status')).toHaveText('原件不可读取');await expect(insight.locator('.insight-counts')).toContainText('未知');await expect(insight.locator('.insight-status')).not.toContainText('尚未分析');
  await insight.screenshot({path:join(evidence,'unavailable-insights.png')});
  await page.getByRole('button',{name:'下载原件',exact:true}).click();await expect(page.getByRole('alert').filter({hasText:'原件不可读取'})).toBeVisible();
  const api=(path:string,init:RequestInit={})=>f.nativeApi(path,owner.readerCredential,init),json=(body:unknown)=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const registration=await(await api('/oauth/register',json({client_name:'Unavailable source reader',redirect_uris:['http://127.0.0.1:47131/callback'],token_endpoint_auth_method:'none'}))).json();
  const verifier=randomBytes(48).toString('base64url'),resource=f.origin+'/mcp';
  const callback=new URL(await f.authorizationPage(f.origin+'/oauth/authorize?'+new URLSearchParams({response_type:'code',client_id:registration.client_id,redirect_uri:registration.redirect_uris[0],scope:'archive:read',resource,state:randomUUID(),code_challenge_method:'S256',code_challenge:createHash('sha256').update(verifier).digest('base64url')}),owner.readerCredential));
  const token=await(await api('/oauth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:registration.client_id,code:callback.searchParams.get('code')!,redirect_uri:registration.redirect_uris[0],code_verifier:verifier,resource}).toString()})).json();
  client=new Client({name:'source-isolation-public',version:'1'});await client.connect(new StreamableHTTPClientTransport(new URL(resource),{fetch:f.fetchTls,requestInit:{headers:{Authorization:'Bearer '+token.access_token}}}));
  for(const [name,args]of [['read_export',{snapshotId:record.snapshotId,format:'raw',offset:0}],['read_conversation',{snapshotId:record.snapshotId}],['read_conversation_trace',{snapshotId:record.snapshotId}]] as const){const rawFailure=await client.callTool({name,arguments:args});assert.equal(rawFailure.isError,true);assert.equal((rawFailure.content as {text:string}[])[0]!.text,'原件不可读取');}
  const cases:[string,Record<string,string>,string,string?][]=[['read_session_insights',{snapshotId:record.snapshotId},'/api/snapshots/'+record.snapshotId+'/insights'],['read_waits',{period:'since-enrollment',employeeId:owner.employeeId},'/api/waits','/api/waits/export'],['list_activity',{date:beijingDate(f.base),employeeId:owner.employeeId},'/api/activity','/api/activity/export']];
  for(const [name,args,path,exportPath]of cases){const query=new URLSearchParams(Object.entries(args).filter(([key])=>key!=='snapshotId'));const http=await(await api(path+'?'+query)).json();const reply=await client.callTool({name,arguments:args});assert.notEqual(reply.isError,true,JSON.stringify(reply));assert.deepEqual(JSON.parse((reply.content as {text:string}[])[0]!.text),http);if(exportPath)assert.deepEqual(await(await api(exportPath+'?'+query)).json(),http);}
  await page.goto(f.origin+'/#waits?period=since-enrollment&employeeId='+owner.employeeId);const waits=page.getByRole('region',{name:'响应与等待',exact:true});
  await expect(waits.getByText('原件不可读取，等待记录未知',{exact:true})).toBeVisible();await expect(waits.getByTestId('wait-reply-total')).toHaveText('未知');await expect(waits.locator('.wait-report-stats')).toContainText('区间总数未知');await expect(waits.getByRole('region',{name:'按人等待分布',exact:true})).toContainText('原件不可读取，等待分布未知');await page.screenshot({path:join(evidence,'unavailable-waits.png')});
  await page.goto(f.origin+'/#'+record.snapshotId);await expect(page.getByRole('alert').filter({hasText:'原件不可读取'})).toBeVisible();
  await writeFile(restore.path,restore.bytes);await page.getByRole('button',{name:'重试读取会话',exact:true}).click();await expect(insight.locator('.insight-status')).toContainText('已完成');
 }finally{if(restore)await writeFile(restore.path,restore.bytes);await client?.close();await browser?.close();await f.close();}
});
