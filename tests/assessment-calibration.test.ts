import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {assessmentFixture} from './assessment-fixture.js';

const run=(input:string,output:string,env:NodeJS.ProcessEnv)=>new Promise<{code:number|null;stdout:string;stderr:string}>(resolve=>{
  const child=spawn(process.execPath,['--import','tsx','apps/operations/calibration.ts',input,output],{env,stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';child.stdout.on('data',part=>stdout+=part);child.stderr.on('data',part=>stderr+=part);child.on('exit',code=>resolve({code,stdout,stderr}));
});
test('an offline calibration packet freezes an explicit synthetic cohort and records distributions, provenance and pending review',{timeout:180000},async()=>{
  const f=await assessmentFixture();try{
    const a=await f.owner('甲合成样本'),empty=await f.owner('乙无样本'),excluded=await f.owner('丙不在本次样本');
    for(let n=0;n<5;n++)await f.session(a,{prompts:5});await f.session(excluded,{prompts:5});
    const people=await(await f.api(a,'/api/capability-people/export?period=since-enrollment')).json();assert.ok(people.version);
    const input=join(f.directory,'cohort.json'),out=join(f.directory,'packet'),again=join(f.directory,'packet-repeat');
    const manifest={origin:f.origin,peopleVersion:people.version,employeeIds:[empty.employeeId,a.employeeId],sample:{kind:'synthetic',label:'五会话与无样本边界',authorizationReference:null,knownBiases:['合成会话，不代表实际试点']}};
    await writeFile(input,JSON.stringify(manifest));
    const env={...process.env,NODE_EXTRA_CA_CERTS:f.ca,SKYNET_READER_CREDENTIAL:a.readerCredential};
    const trafficStart=f.traffic.length,result=await run(input,out,env);assert.equal(result.code,0,result.stderr);
    const report=JSON.parse(await readFile(join(out,'calibration.json'),'utf8'));
    assert.equal(report.sample.kind,'synthetic');assert.equal(report.review.state,'pending-real-pilot');assert.equal(report.review.parameterDecision,null);assert.equal(report.review.releaseApproval,null);
    assert.deepEqual(report.cohort,{employees:2,sessions:5,prompts:25});
    assert.deepEqual(report.distributions.confidence,{高:0,中:1,低:1});assert.deepEqual(report.distributions.pending,{numerator:1,denominator:2,value:.5});
    assert.equal(report.distributions.index.known,1);assert.equal(report.distributions.index.unknown,1);assert.equal(report.distributions.dimensions.prompt.known,1);assert.equal(report.distributions.dimensions.prompt.unknown,1);assert.equal(report.distributions.dimensions.prompt.median,100);
    assert.deepEqual(report.employees.map((person:any)=>person.employee),['甲合成样本','乙无样本']);
    assert.deepEqual(report.coverage.map((source:any)=>[source.source,source.employees,source.sessions]),[['codex-cli',1,5]]);
    assert.equal(report.models.length,1);assert.equal(report.models[0].version,people.modelVersion);assert.equal(report.models[0].parameters.status,'initial-parameters');
    assert.ok(report.employees.find((person:any)=>person.employeeId===empty.employeeId).issues.includes('暂无会话'));
    for(const person of report.employees){const fixed=await(await f.api(a,'/api/assessments/'+person.employeeId+'/export?version='+person.assessment.version)).json();assert.equal(person.assessment.index,fixed.index);assert.ok(person.profileUrl.includes(person.assessment.version));}
    assert.ok(f.traffic.slice(trafficStart).every(request=>request.method==='GET'));
    const serialized=await readFile(join(out,'calibration.json'),'utf8'),review=await readFile(join(out,'review.md'),'utf8');
    assert.ok(!serialized.includes(excluded.employeeId));assert.ok(!serialized.includes(a.readerCredential));assert.ok(!review.includes(a.readerCredential));assert.match(review,/尚未完成真实试点/);assert.match(review,/参数建议：待填写/);
    await f.session(a,{prompts:5});assert.notEqual((await(await f.api(a,'/api/capability-people')).json()).version,people.version);
    const repeated=await run(input,again,env);assert.equal(repeated.code,0,repeated.stderr);assert.equal(await readFile(join(again,'calibration.json'),'utf8'),serialized);assert.equal(await readFile(join(again,'review.md'),'utf8'),review);
    assert.deepEqual((await readdir(out)).sort(),['calibration.json','manifest.json','review.md']);
    const evidence=process.env.SKYNET_CALIBRATION_EVIDENCE_DIR;if(evidence){await writeFile(join(evidence,'synthetic-calibration.json'),serialized);await writeFile(join(evidence,'synthetic-review.md'),review);}
  }finally{await f.close();}
});
