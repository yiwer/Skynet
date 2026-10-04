import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {chromium,expect,type Browser} from '@playwright/test';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {assessmentFixture} from './assessment-fixture.js';

test('profile coaching charts, original sentence links, weekly table, export and OAuth MCP share a frozen result',{timeout:180000},async()=>{
  const f=await assessmentFixture(),directory=process.env.SKYNET_COACHING_EVIDENCE_DIR??join(f.directory,'coaching-browser');let browser:Browser|undefined,client:Client|undefined;await mkdir(directory,{recursive:true});
  try{
    const owner=await f.owner('辅导核查');await f.session(owner,{prompts:3,verified:2,tokens:500});await f.session(owner,{prompts:3,rework:true,verified:0});
    const record=f.rows({prompts:3});for(const row of record.rows as any[])if(row.timestamp)row.timestamp=new Date(Date.parse(row.timestamp)+7*86400000).toISOString();const uploaded=await f.upload(owner,record.rows,record.sessionId);await f.analyze(owner,uploaded.snapshotId);f.now.setTime(f.base.getTime()+9*86400000);
    const profile=await(await f.api(owner,'/api/capability-profiles/'+owner.employeeId)).json();
    browser=await chromium.launch();const page=await browser.newPage({ignoreHTTPSErrors:true,viewport:{width:1280,height:900},reducedMotion:'reduce',hasTouch:true}),errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(f.origin+'/#profile?employeeId='+owner.employeeId+'&profileVersion='+profile.version);await page.getByLabel('个人读取凭据').fill(owner.readerCredential);await page.getByRole('button',{name:'进入存档',exact:true}).click();
    const nav=page.getByRole('navigation',{name:'画像目录'});await expect(nav.getByRole('button',{name:'协作方式',exact:true})).toBeVisible();
    const dimension=profile.assessment.strengths[0]??profile.assessment.priorities[0];assert.ok(dimension);await page.getByRole('region',{name:'评估结论',exact:true}).getByRole('button',{name:new RegExp(profile.assessment.dims[dimension].label)}).click();await expect(page.locator('#profile-dimension-'+dimension)).toHaveAttribute('open','');
    await nav.getByRole('button',{name:'协作方式',exact:true}).click();
    const collaboration=page.getByRole('region',{name:'协作方式',exact:true}),elements=collaboration.getByRole('region',{name:'首条提示词要素',exact:true});
    await elements.getByRole('button',{name:/目标明确/}).focus();await expect(elements.getByRole('tooltip')).toContainText('本人');await page.keyboard.press('Escape');await expect(elements.getByRole('tooltip')).toHaveCount(0);
    await elements.getByRole('button',{name:'首条提示词要素表格',exact:true}).click();await expect(elements.getByRole('table')).toContainText('100%');await expect(elements.getByRole('table')).toContainText('0%');
    const waiting=collaboration.getByRole('region',{name:'各时段等待',exact:true});await waiting.getByRole('button',{name:'各时段等待表格',exact:true}).click();await expect(waiting.getByRole('table').locator('tbody tr')).toHaveCount(24);
    await expect(collaboration).toContainText('权限等待中位数');await expect(collaboration).toContainText('未知');
    await nav.getByRole('button',{name:'趋势',exact:true}).click();const trend=page.getByRole('region',{name:'周趋势',exact:true});await trend.getByRole('button',{name:'周趋势表格',exact:true}).click();await expect(trend.getByRole('table').locator('tbody tr')).toHaveCount(7);
    await expect(trend.getByRole('table').locator('tbody tr').first()).toContainText(String(profile.coaching.trend.previous.index));await expect(trend.getByRole('table').locator('tbody tr').first()).toContainText(String(profile.coaching.trend.current.index));
    await trend.getByRole('button',{name:'周趋势表格',exact:true}).click();await elements.getByRole('button',{name:'首条提示词要素表格',exact:true}).click();await waiting.getByRole('button',{name:'各时段等待表格',exact:true}).click();
    for(const width of [1280,390,320])for(const theme of ['light','dark']){await page.setViewportSize({width,height:900});await page.evaluate(value=>document.documentElement.dataset.theme=value,theme);
      for(const [label,id] of [['协作方式','collaboration'],['趋势','trend']] as const){await nav.getByRole('button',{name:label,exact:true}).click();await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight));
        const small=await page.locator('#profile-'+id+' button,#profile-'+id+' a,#profile-'+id+' summary').evaluateAll(nodes=>nodes.filter(node=>{const box=node.getBoundingClientRect();return box.width>0&&box.height>0&&(box.width<44||box.height<44);}).map(node=>({text:node.textContent,box:node.getBoundingClientRect().toJSON()})));assert.deepEqual(small,[]);await page.screenshot({path:join(directory,`${id}-${width}-${theme}.png`),animations:'disabled'});}}
    await nav.getByRole('button',{name:'协作方式',exact:true}).click();const touchPoint=elements.getByRole('button',{name:/目标明确/});await touchPoint.tap();await expect(elements.getByRole('tooltip')).toBeVisible();await touchPoint.tap();await expect(elements.getByRole('tooltip')).toHaveCount(0);await touchPoint.tap();await page.keyboard.press('Escape');await expect(elements.getByRole('tooltip')).toHaveCount(0);
    await nav.getByRole('button',{name:'趋势',exact:true}).click();const trendPoint=trend.getByRole('button',{name:/综合指数/});await trendPoint.tap();await expect(trend.getByRole('tooltip')).toBeVisible();await trendPoint.tap();await expect(trend.getByRole('tooltip')).toHaveCount(0);
    const fixedUrl=page.url();await nav.getByRole('button',{name:'协作方式',exact:true}).click();await collaboration.getByRole('link',{name:'查看代表原句',exact:true}).click();await expect(page.getByRole('region',{name:'命中证据',exact:true})).toContainText(profile.coaching.representatives.best.citation.quote);assert.ok(page.url().endsWith(profile.coaching.representatives.best.citation.webPath));await page.goto(fixedUrl);
    const download=page.waitForEvent('download');await page.getByRole('button',{name:'导出画像',exact:true}).click();const exported=JSON.parse(await readFile((await(await download).path())!,'utf8'));assert.deepEqual(exported.coaching,profile.coaching);
    const resource=f.origin+'/mcp',registration=await(await f.api(owner,'/oauth/register',{client_name:'Coaching review',redirect_uris:['http://127.0.0.1:47129/callback'],token_endpoint_auth_method:'none'})).json(),verifier=randomBytes(48).toString('base64url');
    const callback=new URL(await f.authorizationPage(f.origin+'/oauth/authorize?'+new URLSearchParams({response_type:'code',client_id:registration.client_id,redirect_uri:registration.redirect_uris[0],scope:'archive:read',resource,state:randomUUID(),code_challenge_method:'S256',code_challenge:createHash('sha256').update(verifier).digest('base64url')}),owner.readerCredential));
    const token=await(await f.nativeApi('/oauth/token',owner.readerCredential,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:registration.client_id,code:callback.searchParams.get('code')!,redirect_uri:registration.redirect_uris[0],code_verifier:verifier,resource}).toString()})).json();
    client=new Client({name:'coaching-public',version:'1'});await client.connect(new StreamableHTTPClientTransport(new URL(resource),{fetch:f.fetchTls,requestInit:{headers:{Authorization:'Bearer '+token.access_token}}}));
    const result=await client.callTool({name:'get_capability_profile',arguments:{employeeId:owner.employeeId,version:profile.version}});assert.notEqual(result.isError,true,JSON.stringify(result));assert.deepEqual(JSON.parse((result.content as {text:string}[])[0]!.text),profile);assert.ok(Buffer.byteLength(JSON.stringify(result))<=48*1024);assert.deepEqual(errors,[]);
    await writeFile(join(directory,'manifest.json'),JSON.stringify({profile:profile.version,usage:profile.usage.version,previous:profile.coaching.trend.previous.assessmentVersion,current:profile.coaching.trend.current.assessmentVersion,mcpBytes:Buffer.byteLength(JSON.stringify(result)),errors},null,2));
  }finally{await client?.close();await browser?.close();await f.close();}
});
