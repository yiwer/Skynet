import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID,randomBytes,createHash } from 'node:crypto';
import { mkdir,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium,expect,type Browser } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { assessmentFixture } from './assessment-fixture.js';

test('team capability and employee cards open the pinned profile and return to the same filtered version',{timeout:180000},async()=>{
  const s=await assessmentFixture();let browser:Browser|undefined,client:Client|undefined;
  const evidence=process.env.SKYNET_NAVIGATION_EVIDENCE_DIR??join(s.directory,'navigation-evidence');await mkdir(evidence,{recursive:true});
  try{
    const employee=await s.owner('Alpha'),empty=await s.owner('Beta');for(let n=0;n<5;n++)await s.session(employee,{prompts:5,verified:1,claimed:0,elements:4});
    const api=(path:string,init:RequestInit={})=>s.nativeApi(path,employee.readerCredential,init),json=(body:object)=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const selection={period:'this-week',employeeId:employee.employeeId,source:'codex-cli',project:'/synthetic/assessment-model'},query=new URLSearchParams(selection),team=await(await api('/api/team-report?'+query)).json();assert.equal(team.totals.sessions,0);
    const ability=team.people[0].capability,assessment=await(await api('/api/assessments/'+employee.employeeId+'?version='+ability.assessmentVersion)).json();assert.equal(assessment.sample.sessions,5);
    const registration=await(await api('/oauth/register',json({client_name:'Team profile navigation',redirect_uris:['http://127.0.0.1:47131/callback'],token_endpoint_auth_method:'none'}))).json(),verifier=randomBytes(48).toString('base64url'),resource=s.origin+'/mcp';
    const callback=new URL(await s.authorizationPage(s.origin+'/oauth/authorize?'+new URLSearchParams({response_type:'code',client_id:registration.client_id,redirect_uri:registration.redirect_uris[0],scope:'archive:read',resource,state:randomUUID(),code_challenge_method:'S256',code_challenge:createHash('sha256').update(verifier).digest('base64url')}),employee.readerCredential));
    const token=await(await api('/oauth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:registration.client_id,code:callback.searchParams.get('code')!,redirect_uri:registration.redirect_uris[0],code_verifier:verifier,resource}).toString()})).json();
    client=new Client({name:'navigation-public',version:'1'});await client.connect(new StreamableHTTPClientTransport(new URL(resource),{fetch:s.fetchTls,requestInit:{headers:{Authorization:`Bearer ${token.access_token}`}}}));
    async function call(name:string,args:Record<string,unknown>){const value=await client!.callTool({name,arguments:args});assert.notEqual(value.isError,true);return JSON.parse((value.content as {text:string}[])[0]!.text);}
    assert.deepEqual(await call('read_team_report',{...selection,version:team.version}),team);assert.deepEqual(await call('read_assessment',{employeeId:employee.employeeId,version:ability.assessmentVersion}),assessment);
    browser=await chromium.launch();const page=await browser.newPage({ignoreHTTPSErrors:true,viewport:{width:1280,height:900}}),errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(s.origin+'/#coverage?'+query);await page.getByLabel('个人读取凭据').fill(employee.readerCredential);await page.getByRole('button',{name:'进入存档',exact:true}).click();
    const teamPanel=page.getByRole('region',{name:'团队覆盖矩阵',exact:true}),people=teamPanel.getByRole('region',{name:'期间人员汇总',exact:true});
    await expect(people.getByRole('columnheader',{name:/使用能力.*接入至今/})).toBeVisible();await expect(teamPanel.getByRole('combobox',{name:'项目',exact:true})).toHaveValue('project:'+selection.project);
    const link=people.getByRole('link',{name:'Alpha 使用能力画像',exact:true});await expect(link).toContainText(ability.level);await expect(link).toContainText(String(ability.index));
    for(const width of [320,768,1280,1920])for(const theme of ['light','dark']){await page.setViewportSize({width,height:900});await page.evaluate(value=>document.documentElement.dataset.theme=value,theme);await link.scrollIntoViewIfNeeded();const box=(await link.boundingBox())!;assert.ok(box.width>=44&&box.height>=44);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth||document.documentElement.scrollHeight>innerHeight),false);await page.screenshot({path:join(evidence,`navigation-${width}-${theme}.png`),animations:'disabled'});}
    await link.focus();await page.keyboard.press('Enter');await expect(page.getByTestId('assessment-index')).toHaveText(String(ability.index));
    for(const width of [320,1280]){await page.setViewportSize({width,height:900});const back=page.getByRole('link',{name:'返回团队概览',exact:true}),box=(await back.boundingBox())!;assert.ok(box.width>=44&&box.height>=44);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth||document.documentElement.scrollHeight>innerHeight),false);await page.screenshot({path:join(evidence,`profile-return-${width}.png`),animations:'disabled'});}
    const profile=new URLSearchParams(new URL(page.url()).hash.split('?')[1]);assert.equal(profile.get('period'),'since-enrollment');assert.equal(profile.get('preset'),'默认');assert.equal(profile.get('version'),ability.assessmentVersion);assert.equal(profile.has('profileVersion'),false);
    const target=new URLSearchParams(profile.get('returnTo')!.split('?')[1]);for(const [key,value] of Object.entries(selection))assert.equal(target.get(key),value);assert.equal(target.get('version'),team.version);
    await s.session(employee,{prompts:5,verified:1});await page.getByRole('link',{name:'返回团队概览',exact:true}).click();await expect(link).toBeVisible();assert.equal(new URLSearchParams(new URL(page.url()).hash.split('?')[1]).get('version'),team.version);await expect(link).toContainText(String(ability.index));
    await link.click();await expect(page.getByTestId('assessment-index')).toBeVisible();await page.goBack();await expect(link).toBeVisible();assert.equal(new URLSearchParams(new URL(page.url()).hash.split('?')[1]).get('version'),team.version);
    const directory=await(await api('/api/capability-people?period=last-week&preset='+encodeURIComponent('重质量'))).json();assert.ok(directory.employees.every((row:any)=>row.index===null));
    await page.goto(s.origin+'/#people?'+new URLSearchParams({period:'last-week',preset:'重质量',version:directory.version}));const card=page.getByRole('link',{name:'Beta：打开员工画像',exact:true});await expect(card).toBeVisible();await card.focus();await page.keyboard.press('Enter');await expect(page.getByRole('heading',{name:'Beta',exact:true})).toBeVisible();
    const beta=directory.employees.find((row:any)=>row.employeeId===empty.employeeId);assert.equal(new URLSearchParams(new URL(page.url()).hash.split('?')[1]).get('version'),beta.assessmentVersion);await page.getByRole('group',{name:'权重方案',exact:true}).getByRole('button',{name:'重产出',exact:true}).click();await expect(page.getByRole('group',{name:'权重方案',exact:true}).getByRole('button',{name:'重产出',exact:true})).toHaveAttribute('aria-pressed','true');await page.getByRole('link',{name:'返回员工一览',exact:true}).click();await expect(card).toBeVisible();const returned=new URLSearchParams(new URL(page.url()).hash.split('?')[1]);assert.equal(returned.get('version'),directory.version);assert.equal(returned.get('period'),'last-week');assert.equal(returned.get('preset'),'重质量');
    const allSelection={...selection,period:'since-enrollment'},all=await(await api('/api/team-report?'+new URLSearchParams(allSelection))).json();assert.ok(all.coverage.nextDateOffset>0);
    const windowQuery=new URLSearchParams({...allSelection,version:all.version,coverageOffset:'7'}),window=await(await api('/api/team-report?'+windowQuery)).json();
    await page.goto(s.origin+'/#coverage?'+windowQuery);await expect(link).toBeVisible();await link.click();await expect(page.getByTestId('assessment-index')).toBeVisible();await page.getByRole('link',{name:'返回团队概览',exact:true}).click();await expect(link).toBeVisible();
    const windowReturn=new URLSearchParams(new URL(page.url()).hash.split('?')[1]);assert.equal(windowReturn.get('coverageOffset'),'7');assert.equal(windowReturn.get('version'),all.version);await expect(teamPanel.getByRole('button',{name:'查看日期 '+window.coverage.dates[0],exact:true})).toBeVisible();
    for(const invalid of ['https://example.invalid/', 'javascript:alert(1)', '#people?version='+directory.version+'&version='+directory.version,'#people?version='+directory.version+'&returnTo=%23coverage','#coverage?period=custom&version='+team.version]){
      await page.goto(s.origin+'/'+beta.profilePath+'&returnTo='+encodeURIComponent(invalid));await expect(page.getByRole('heading',{name:'Beta',exact:true})).toBeVisible();await expect(page.getByRole('link',{name:/返回团队概览|返回员工一览/})).toHaveCount(0);
    }
    assert.deepEqual(await call('list_capability',{version:directory.version}),directory);assert.deepEqual(await call('read_team_report',{...selection,version:team.version}),team);assert.deepEqual(errors,[]);
    await writeFile(join(evidence,'navigation.json'),JSON.stringify({team,assessment,directory},null,2));console.log('Navigation evidence: '+evidence);
  }finally{await client?.close();await browser?.close();await s.close();}
});
