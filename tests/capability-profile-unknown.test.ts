import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {assessmentFixture} from './assessment-fixture.js';

test('profiles preserve unknown undated originals rather than equating them with a genuinely empty employee',{timeout:180000},async()=>{
  const f=await assessmentFixture();try{
    const empty=await f.owner('独立边界-无上传'),broken=await f.owner('独立边界-不可解析'),valid=await f.owner('独立边界-已知消息未知Token');
    const bytes=Buffer.from('not a jsonl native record\n'),hash=createHash('sha256').update(bytes).digest('hex');
    const staged=await f.nativeApi('/api/chunks/'+hash,broken.deviceCredential,{method:'PUT',headers:{'Content-Type':'application/octet-stream'},body:bytes});assert.ok([200,201].includes(staged.status));
    const upload=await f.nativeApi('/api/snapshots',broken.deviceCredential,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      protocolVersion:1,sourceSessionId:randomUUID(),source:'codex-cli',sourceVersion:'0.160.0',sourceOs:process.platform,project:'/synthetic/unknown-profile',hash,byteLength:bytes.length,qualifiedAt:f.base.toISOString(),capability:'unverified'})});
    assert.equal(upload.status,200,await upload.clone().text());const snapshotId=(await upload.json()).snapshotId;
    await f.upload(valid,[{type:'response_item',timestamp:f.base.toISOString(),payload:{type:'message',role:'user',content:[{type:'input_text',text:'只有真实消息，来源没有Token计数'}]}}],randomUUID());
    const read=async(person:typeof empty)=>{const response=await f.api(person,'/api/capability-profiles/'+person.employeeId);assert.equal(response.status,200,await response.clone().text());return response.json();};
    const pEmpty=await read(empty),pBroken=await read(broken),pValid=await read(valid);
    const usage=await(await f.api(broken,'/api/usage-output/export?period=since-enrollment&version='+pBroken.usage.version)).json();
    const insight=await(await f.api(broken,'/api/snapshots/'+snapshotId+'/insights')).json();
    assert.equal(pEmpty.kpis.sessions,0);assert.equal(pEmpty.kpis.inputTokens,0);assert.equal(pEmpty.header.lastSyncedAt,null);
    assert.equal(pValid.kpis.sessions,1);assert.equal(pValid.kpis.userTurns,1);assert.equal(pValid.kpis.inputTokens,null);assert.equal(pValid.kpis.unknownTokenSessions,1);
    assert.equal(usage.sourceInputsComplete,false);assert.ok(usage.unknownReasons.length);assert.ok(pBroken.header.lastSyncedAt);
    assert.equal(pBroken.kpis.inputTokens,null,'unreadable undated uploaded material cannot establish known zero Token in the profile');
    assert.equal(pBroken.kpis.outputTokens,null); assert.equal(pBroken.usage.sourceInputsComplete,false); assert.equal(pBroken.usage.unscopedSources,1);
    assert.ok(pBroken.usage.unknownReasons.length); assert.ok(pBroken.assessment.coverageIssues.length);
    assert.ok(Object.values(pBroken.kpis.outputs).every((value:any)=>value.value===null));
    const frozenOwner=usage.employees.find((person:any)=>person.employeeId===broken.employeeId);
    assert.deepEqual(pBroken.kpis.outputs,frozenOwner.outputs); assert.equal(frozenOwner.inputTokens,null);
    assert.equal(pEmpty.usage.sourceInputsComplete,true); assert.equal(pEmpty.usage.unscopedSources,0);
    assert.ok(Object.values(pEmpty.kpis.outputs).every((value:any)=>value.value===0));
    const scoped=await(await f.api(broken,'/api/usage-output/export?period=since-enrollment&employeeId='+broken.employeeId)).json();
    assert.equal(scoped.totals.inputTokens,null); assert.equal(scoped.outputs.verified.value,null);
    const emptyScope=await(await f.api(empty,'/api/usage-output/export?period=since-enrollment&employeeId='+empty.employeeId)).json();
    assert.equal(emptyScope.totals.inputTokens,0); assert.equal(emptyScope.sourceInputsComplete,true);
  }finally{await f.close();}
});
