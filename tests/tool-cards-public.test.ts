import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium,expect,type Browser} from '@playwright/test';
import {mcpSandbox} from './mcp-support.js';
import type {ConversationPage} from '../packages/contracts/conversation.js';

const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
const json=(body:unknown):RequestInit=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});

test('tool cards distinguish parameters and results in timeline, exact evidence and conversation without inventing timing',{timeout:120_000},async()=>{
  const s=await mcpSandbox();let browser:Browser|undefined;
  const evidence=process.env.SKYNET_TOOL_CARD_EVIDENCE??s.directory;
  try{
    await mkdir(evidence,{recursive:true});const owner=await s.provision('工具格式合成作者');
    const device=await(await s.api('/api/devices/enroll',owner.enrollmentCredential,json({installationId:randomUUID(),name:'tool card fixture'}))).json();
    const id=randomUUID(),turn=randomUUID(),timestamp=new Date(Date.now()+1000).toISOString(),start=Date.parse(timestamp);
    const response=(payload:unknown)=>({type:'response_item',timestamp,payload});
    const parameters='{"cmd":"synthetic check","cwd":"/synthetic/tools"}',output='Synthetic result\n<script>window.toolInjected=true</script>';
    const rows=[
      {type:'session_meta',timestamp,payload:{id,source:'cli',cli_version:'0.160.0'}},
      {type:'event_msg',timestamp,payload:{type:'task_started',turn_id:turn}},
      response({type:'message',role:'user',content:[{type:'input_text',text:'检查工具的原始参数和结果'}]}),
      response({type:'function_call',id:'command-native',name:'exec_command',call_id:'paired-call',arguments:parameters}),
      {type:'event_msg',timestamp,payload:{type:'item_completed',thread_id:id,turn_id:turn,started_at_ms:start,completed_at_ms:start+15,
        item:{type:'CommandExecution',id:'command-native',status:'completed',exit_code:0,duration:{secs:0,nanos:12_000_000}}}},
      response({type:'message',role:'assistant',content:[{type:'output_text',text:'这是调用与结果之间的原始 Agent 消息。'}]}),
      response({type:'function_call_output',call_id:'paired-call',output}),
      response({type:'function_call',name:'Read',call_id:'unmatched-call',arguments:'{"path":"unknown-timing.txt"}'}),
    ];
    const bytes=Buffer.from(rows.map(row=>JSON.stringify(row)).join('\n')+'\n');
    assert.equal((await s.api('/api/chunks/'+hash(bytes),device.deviceCredential,{method:'PUT',headers:{'Content-Type':'application/octet-stream'},body:bytes})).status,201);
    const uploaded=await s.api('/api/snapshots',device.deviceCredential,json({protocolVersion:1,source:'codex-cli',sourceVersion:'0.160.0',sourceOs:process.platform,
      sourceSessionId:id,project:'/synthetic/tools',hash:hash(bytes),byteLength:bytes.length,qualifiedAt:timestamp,capability:'unverified'}));
    assert.equal(uploaded.status,200);const snapshot=(await uploaded.json()).snapshotId;
    const api=(path:string)=>s.api(path,owner.readerCredential);
    const conversationResponse=await api(`/api/snapshots/${snapshot}/conversation?includeTools=true`);assert.equal(conversationResponse.status,200);
    const conversation=await conversationResponse.json() as ConversationPage;
    const sourceOrder=conversation.messages.map(message=>message.role);
    assert.deepEqual(sourceOrder,['user','tool request','assistant','tool result','tool request'],'Request and result retain their source positions around the intervening assistant');
    const call=conversation.messages.find(message=>message.tool?.callId==='paired-call'&&message.tool.kind==='request')!;
    assert.equal(call.trace?.executionDurationMs,12);assert.equal(call.trace?.durationMs,15);assert.equal(call.trace?.status,'completed');
    const locationQuery=call.evidencePath.split('?')[1]!;
    const located=await api(`/api/snapshots/${snapshot}/location?${locationQuery}`);
    assert.equal(located.status,200,'The public conversation tool original link must resolve, including its zero block');
    const locatedBody=await located.json();assert.ok(locatedBody.events[0].text.includes(parameters));
    const defaultBlock=new URLSearchParams(locationQuery);defaultBlock.delete('block');
    const defaultLocated=await api(`/api/snapshots/${snapshot}/location?${defaultBlock}`);
    assert.equal(defaultLocated.status,200);assert.deepEqual(await defaultLocated.json(),locatedBody,'An omitted block and explicit block zero select the same original event');
    const wrongBlock=new URLSearchParams(locationQuery);wrongBlock.set('block','1');
    assert.equal((await api(`/api/snapshots/${snapshot}/location?${wrongBlock}`)).status,400,'A nonexistent nonzero block must not resolve to block zero');
    browser=await chromium.launch();const page=await browser.newPage({ignoreHTTPSErrors:true,hasTouch:true,viewport:{width:1280,height:900}});
    await page.goto(`${s.origin}/#${snapshot}?view=timeline`);await page.getByLabel('个人读取凭据').fill(owner.readerCredential);
    await page.getByRole('button',{name:'进入存档',exact:true}).click();
    const timeline=page.getByRole('region',{name:'会话内容',exact:true});
    const timelineCall=timeline.getByRole('group',{name:'工具调用',exact:true}).first();
    await expect(timelineCall).toBeVisible();await expect(timelineCall.getByRole('region',{name:'调用参数',exact:true})).toBeVisible();
    await timelineCall.locator('summary').focus();await page.keyboard.press('Enter');
    await expect(timelineCall.getByRole('region',{name:'调用参数',exact:true})).toBeHidden();await page.keyboard.press('Enter');
    await expect(timelineCall.getByRole('region',{name:'调用参数',exact:true})).toContainText(parameters);
    await expect(timelineCall.getByText('已完成',{exact:true})).toHaveCount(0);
    const timelineResult=timeline.getByRole('group',{name:'工具结果',exact:true});
    await expect(timelineResult.getByRole('region',{name:'调用结果',exact:true})).toContainText(output);
    await expect(timeline.getByText('这是调用与结果之间的原始 Agent 消息。',{exact:true})).toBeVisible();
    await expect(page.getByRole('heading',{level:1,name:'检查工具的原始参数和结果',exact:true})).toBeVisible();
    await page.screenshot({path:join(evidence,'tool-timeline.png'),animations:'disabled'});
    await page.goto(s.origin+'/'+call.evidencePath);
    const hit=page.getByRole('region',{name:'命中证据',exact:true});await expect(hit).toBeFocused();
    const evidenceCall=hit.getByRole('group',{name:'工具调用',exact:true}).first();await expect(evidenceCall).toHaveAttribute('open');
    await expect(evidenceCall.getByRole('region',{name:'调用参数',exact:true})).toContainText(parameters);
    await page.goto(s.origin+'/'+call.conversationPath);
    const card=page.getByRole('group',{name:'工具调用 exec_command',exact:true});await expect(card).toHaveAttribute('open');
    await expect(card.locator('summary')).toContainText('已完成');await expect(card.locator('summary')).toContainText('执行 12 ms');
    await expect(card.locator('summary')).toContainText('来源时间差 15 ms');await expect(card.locator('summary')).toContainText('退出 0');
    await expect(card.getByRole('region',{name:'调用参数',exact:true})).toContainText(parameters);
    await expect(card.getByRole('link',{name:'原件',exact:true})).toHaveAttribute('href',call.evidencePath);
    await expect(card.getByRole('link',{name:'Trace 原件',exact:true})).toHaveAttribute('href',new RegExp('line=5'));
    const unknown=page.getByRole('group',{name:'工具调用 Read',exact:true});
    await expect(unknown).not.toHaveAttribute('open');
    await expect(unknown.locator('summary')).not.toContainText(/已完成|成功|执行|来源时间差|0 ms/);
    await expect(unknown.getByRole('link',{name:'Trace 原件',exact:true})).toHaveCount(0);
    const layouts:unknown[]=[];
    for(const mode of ['conversation','timeline']){
      await page.goto(mode==='conversation'?s.origin+'/'+call.conversationPath:`${s.origin}/#${snapshot}?view=timeline`);
      const shown=mode==='conversation'?page.getByRole('group',{name:'工具调用 exec_command',exact:true}):page.getByRole('region',{name:'会话内容',exact:true}).getByRole('group',{name:'工具调用',exact:true}).first();
      await expect(shown).toHaveAttribute('open');
      await expect(page.getByRole('heading',{level:1,name:'检查工具的原始参数和结果',exact:true})).toBeVisible();
      for(const width of [320,390,768,1280,1920])for(const colorScheme of ['light','dark'] as const){
        await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme});
        await page.evaluate(()=>Promise.allSettled(document.getAnimations().map(animation=>animation.finished)));
        await shown.scrollIntoViewIfNeeded();
        const layout=await page.evaluate(()=>({x:document.documentElement.scrollWidth>innerWidth,y:document.documentElement.scrollHeight>innerHeight}));
        assert.deepEqual(layout,{x:false,y:false});
        const targets=await shown.locator('summary,a').evaluateAll(elements=>elements.filter(element=>element.checkVisibility()).map(element=>{const box=element.getBoundingClientRect();return {label:element.textContent,width:box.width,height:box.height};}));
        assert.ok(targets.length>=2);assert.deepEqual(targets.filter(target=>target.width<43.9||target.height<43.9),[]);
        assert.match(await shown.locator('pre').evaluate(element=>getComputedStyle(element).fontFamily),/mono/i);
        layouts.push({mode,width,colorScheme,layout,targets});
        await page.screenshot({path:join(evidence,`tool-${mode}-${width}-${colorScheme}.png`),animations:'disabled'});
      }
    }
    await page.goto(s.origin+'/'+call.conversationPath);await expect(card).toHaveAttribute('open');
    await page.setViewportSize({width:320,height:900});await page.emulateMedia({reducedMotion:'reduce'});
    await card.locator('summary').focus();await page.keyboard.press('Space');await expect(card).not.toHaveAttribute('open');
    await page.keyboard.press('Space');await expect(card).toHaveAttribute('open');
    assert.equal(await page.evaluate(()=>matchMedia('(prefers-reduced-motion: reduce)').matches),true);
    assert.doesNotMatch(await card.locator('summary').evaluate(element=>getComputedStyle(element,'::before').transitionProperty),/transform|all/,'Reduced motion may fade opacity but must not animate the expanding arrow');
    await card.getByRole('link',{name:'查看调用结果',exact:true}).click();
    const paired=page.getByRole('group',{name:'工具结果 exec_command',exact:true});await expect(paired).toHaveAttribute('open');
    await expect(paired.getByRole('region',{name:'调用结果',exact:true})).toContainText(output);
    await expect(paired.getByRole('link',{name:'查看调用参数',exact:true})).toBeVisible();
    await expect(page.locator('[data-conversation-focused="true"]')).toBeFocused();
    await page.screenshot({path:join(evidence,'tool-touch-result.png'),animations:'disabled'});
    assert.equal(await page.evaluate(()=>(window as any).toolInjected),undefined);
    assert.deepEqual(Buffer.from(await(await api(`/api/snapshots/${snapshot}/raw`)).arrayBuffer()),bytes);
    const blockBytes=Buffer.from(JSON.stringify({type:'assistant',timestamp,message:{role:'assistant',content:[
      {type:'tool_use',id:'block-zero',name:'Read',input:{path:'zero.txt'}},
      {type:'tool_use',id:'block-one',name:'Read',input:{path:'one.txt'}},
    ]}})+'\n');
    assert.equal((await s.api('/api/chunks/'+hash(blockBytes),device.deviceCredential,{method:'PUT',headers:{'Content-Type':'application/octet-stream'},body:blockBytes})).status,201);
    const blockUpload=await s.api('/api/snapshots',device.deviceCredential,json({protocolVersion:1,source:'claude-code-cli',sourceVersion:'2.1.281',sourceOs:process.platform,
      sourceSessionId:randomUUID(),project:'/synthetic/blocks',hash:hash(blockBytes),byteLength:blockBytes.length,qualifiedAt:timestamp,capability:'unverified'}));
    assert.equal(blockUpload.status,200);const blockSnapshot=(await blockUpload.json()).snapshotId;
    const blockPage=async(block?:number)=>{const response=await api(`/api/snapshots/${blockSnapshot}/location?kind=event&offset=0&line=1${block===undefined?'':'&block='+block}`);assert.equal(response.status,200);return response.json();};
    const zero=await blockPage(0),one=await blockPage(1);
    assert.deepEqual(await blockPage(),zero);assert.equal(zero.events[0].block,0);assert.equal(one.events[0].block,1);
    assert.match(zero.events[0].text,/zero\.txt/);assert.match(one.events[0].text,/one\.txt/);
    assert.doesNotMatch(one.events[0].text,/zero\.txt/,'A real nonzero block must retain its own source event');
    assert.deepEqual(Buffer.from(await(await api(`/api/snapshots/${blockSnapshot}/raw`)).arrayBuffer()),blockBytes);
    await writeFile(join(evidence,'tool-public.json'),JSON.stringify({snapshot,hash:hash(bytes),call,layouts,sourceOrder,noModelCalls:true},null,2));
  }finally{await browser?.close();await s.close();}
});
