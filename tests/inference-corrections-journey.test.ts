import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium,expect,type Browser} from '@playwright/test';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {assessmentFixture} from './assessment-fixture.js';
const params=(object:object)=>new URLSearchParams(Object.entries(object).map(([key,value])=>[key,String(value)]));

test('Web corrections expose the same audit, frozen insights and recalculated assessment through OAuth MCP and export', {timeout:180_000},async()=>{
  const f=await assessmentFixture(),directory=process.env.SKYNET_CORRECTIONS_EVIDENCE_DIR??join(f.directory,'corrections-browser');let browser:Browser|undefined,client:Client|undefined;
  await mkdir(directory,{recursive:true});
  try{
    const owner=await f.owner('更正旅程'),record=await f.session(owner,{prompts:3});for(let n=0;n<2;n++)await f.session(owner,{prompts:3});
    const path=`/api/snapshots/${record.snapshotId}`,before=await(await f.api(owner,path+'/insights')).json();
    browser=await chromium.launch();const page=await browser.newPage({ignoreHTTPSErrors:true,viewport:{width:1280,height:900}}),errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(f.origin+'/#'+record.snapshotId);await page.getByLabel('个人读取凭据').fill(owner.readerCredential);await page.getByRole('button',{name:'进入存档',exact:true}).click();
    const inspector=page.getByRole('region',{name:'会话洞察',exact:true});await expect(inspector).toBeVisible();
    await inspector.getByText('更正推断',{exact:true}).click({timeout:5000});
    await inspector.getByLabel('新任务类型').selectOption('investigation');await inspector.getByLabel('更正原因').fill('经原句核对，属于排查');
    await inspector.getByRole('button',{name:'保存更正',exact:true}).click();await expect(inspector.locator('.insight-status')).toContainText('排查');
    await inspector.getByText('更正推断',{exact:true}).click();await inspector.getByLabel('更正字段').selectOption('prompt-elements:'+before.inferences.prompts[0].event);
    for(const label of ['目标','约束','上下文','验收标准'])await inspector.getByLabel(label+'判定',{exact:true}).selectOption('false');
    await inspector.getByLabel('更正原因').fill('首条四要素不成立');await inspector.getByRole('button',{name:'保存更正',exact:true}).click();
    await expect.poll(async()=> (await(await f.api(owner,path+'/insights')).json()).corrections.appliedIds.length).toBe(2);
    await inspector.getByText('更正推断',{exact:true}).click();await inspector.getByLabel('更正字段').selectOption('rework:'+before.inferences.prompts[1].event);
    await inspector.getByLabel('返工判定',{exact:true}).selectOption('true');await inspector.getByLabel('更正原因').fill('第二条纠正前次错误');await inspector.getByRole('button',{name:'保存更正',exact:true}).click();
    await expect.poll(async()=> (await(await f.api(owner,path+'/insights')).json()).metrics.rework).toBe(1);
    await inspector.getByText('更正历史',{exact:true}).click();await expect(inspector.getByLabel('推断更正历史')).toContainText('更正旅程');await expect(inspector.getByLabel('推断更正历史')).toContainText('实现 → 排查');
    const shots:string[]=[];for(const width of [1280,390,320]){await page.setViewportSize({width,height:900});for(const theme of ['light','dark']){
      await page.evaluate(value=>document.documentElement.dataset.theme=value,theme);await inspector.getByText('更正历史',{exact:true}).scrollIntoViewIfNeeded();
      const filename=join(directory,`corrections-${width}-${theme}.png`);await page.screenshot({path:filename,animations:'disabled'});shots.push(filename);
      const targets=await inspector.locator('.inference-corrections summary,.inference-audit-links a').evaluateAll(nodes=>nodes.map(node=>{const box=node.getBoundingClientRect();return {text:node.textContent,width:box.width,height:box.height};}));assert.ok(targets.every(box=>box.width>=44&&box.height>=44),JSON.stringify({width,theme,targets}));
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight));
    }}
    const current=await(await f.api(owner,path+'/insights')).json(),audit=await(await f.api(owner,path+'/inference-corrections?version='+current.version)).json();
    await inspector.getByText('更正推断',{exact:true}).click();await inspector.getByLabel('更正字段').selectOption('prompt-elements:'+before.inferences.prompts[0].event);
    await inspector.getByRole('form',{name:'更正推断表单'}).scrollIntoViewIfNeeded();await page.screenshot({path:join(directory,'correction-form-320-dark.png'),animations:'disabled'});
    const formTargets=await inspector.locator('form select,form button').evaluateAll(nodes=>nodes.map(node=>{const box=node.getBoundingClientRect();return {width:box.width,height:box.height};}));assert.ok(formTargets.every(box=>box.width>=44&&box.height>=44));
    const resource=f.origin+'/mcp',registration=await(await f.api(owner,'/oauth/register',{client_name:'Correction review',redirect_uris:['http://127.0.0.1:47130/callback'],token_endpoint_auth_method:'none'})).json(),verifier=randomBytes(48).toString('base64url');
    const callback=new URL(await f.authorizationPage(f.origin+'/oauth/authorize?'+params({response_type:'code',client_id:registration.client_id,redirect_uri:registration.redirect_uris[0],scope:'archive:read',resource,state:randomUUID(),code_challenge_method:'S256',code_challenge:createHash('sha256').update(verifier).digest('base64url')}),owner.readerCredential));
    const token=await(await f.nativeApi('/oauth/token',owner.readerCredential,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:params({grant_type:'authorization_code',client_id:registration.client_id,code:callback.searchParams.get('code'),redirect_uri:registration.redirect_uris[0],code_verifier:verifier,resource}).toString()})).json();
    client=new Client({name:'correction-public',version:'1'});await client.connect(new StreamableHTTPClientTransport(new URL(resource),{fetch:f.fetchTls,requestInit:{headers:{Authorization:`Bearer ${token.access_token}`}}}));
    const call=async(name:string,args:Record<string,unknown>)=>{const result=await client!.callTool({name,arguments:args});assert.notEqual(result.isError,true,JSON.stringify(result));return JSON.parse((result.content as {text:string}[])[0]!.text);};
    assert.deepEqual(await call('read_session_insights',{snapshotId:record.snapshotId}),current);assert.deepEqual(await call('read_inference_corrections',{snapshotId:record.snapshotId,version:current.version}),audit);
    await page.goto(f.origin+'/#'+record.snapshotId+'?insightVersion='+before.version);await expect(inspector.locator('.insight-status')).toContainText('实现');await expect(inspector.getByText('更正推断',{exact:true})).toHaveCount(0);await inspector.getByRole('link',{name:'查看当前洞察',exact:true}).click();await expect(inspector.locator('.insight-status')).toContainText('排查');
    const assessment=await(await f.api(owner,'/api/assessments/'+owner.employeeId)).json();assert.equal(assessment.dims.prompt.metrics.find((m:any)=>m.key==='elem').value,.5);
    assert.deepEqual(await call('read_assessment',{employeeId:owner.employeeId}),assessment);
    await page.goto(f.origin+'/#profile?employeeId='+owner.employeeId);await expect(page.getByTestId('assessment-index')).toHaveText(String(assessment.index));
    const download=page.waitForEvent('download');await page.getByRole('button',{name:'导出评估',exact:true}).click();assert.deepEqual(JSON.parse(await readFile((await(await download).path())!,'utf8')),assessment);
    assert.deepEqual(errors,[]);await writeFile(join(directory,'manifest.json'),JSON.stringify({before:before.version,current:current.version,audit:current.corrections.version,assessment:assessment.version,shots,errors},null,2));
  }finally{await client?.close();await browser?.close();await f.close();}
});
