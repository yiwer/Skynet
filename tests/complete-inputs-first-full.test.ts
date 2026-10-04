import test from 'node:test';
import assert from 'node:assert/strict';
import {assessmentFixture} from './assessment-fixture.js';

test('first full prompt computation equals subsequent current and full reads before any usage page exists', {timeout:120000}, async()=>{
  const f=await assessmentFixture();
  try{
    const owner=await f.owner('直接重算员工');await f.session(owner,{prompts:3});
    assert.ok(!f.traffic.some(request=>/^\/api\/(usage-output|metrics|prompt-report)(?:\/|$)/.test(request.path)));
    for(const selection of [{period:'since-enrollment'}, {period:'since-enrollment',employeeId:owner.employeeId,source:'codex-cli',project:'/synthetic/assessment-model'}]){
      const first=await f.api(owner,'/api/prompt-report/recompute',selection);assert.equal(first.status,200,await first.clone().text());
      const value=await first.json();assert.deepEqual([value.kpis.sessions,value.kpis.prompts,value.kpis.context.denominator,value.kpis.context.unknown],[1,3,3,0]);
      const query=new URLSearchParams(selection as Record<string,string>);
      const current=await f.api(owner,'/api/prompt-report?'+query);assert.equal(current.status,200,await current.clone().text());assert.deepEqual(await current.json(),value);
      const full=await f.api(owner,'/api/prompt-report/recompute',selection);assert.equal(full.status,200,await full.clone().text());assert.deepEqual(await full.json(),value);
      const fixed=await f.api(owner,'/api/prompt-report?'+query+'&version='+value.version);assert.equal(fixed.status,200);assert.deepEqual(await fixed.json(),value);
    }
  }finally{await f.close();}
});
