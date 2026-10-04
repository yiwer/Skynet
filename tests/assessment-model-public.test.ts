import test from 'node:test';
import assert from 'node:assert/strict';
import { assessmentFixture } from './assessment-fixture.js';

test('fixed analysis and native records score all supported dimensions with task baseline, unknown permissions and evidence', { timeout: 180_000 }, async () => {
  const fixture = await assessmentFixture();
  try {
    const owner = await fixture.owner('模型公开合成员工');
    const first = await fixture.session(owner, { prompts: 3 });
    for (let i = 0; i < 2; i++) await fixture.session(owner, { prompts: 3 });
    const response = await fixture.api(owner, '/api/assessments/' + owner.employeeId); assert.equal(response.status, 200, await response.clone().text());
    const result = await response.json();
    const metric = (key: string) => Object.values(result.dims).flatMap((dim: any) => dim.metrics).find((item: any) => item.key === key) as any;
    assert.equal(metric('elem').value, .75); assert.equal(metric('elem').score, 100); assert.equal(metric('elem').samples, 3);
    assert.equal(metric('clarify').value, 0); assert.equal(metric('clarify').score, 100);
    assert.equal(metric('rework').value, 0); assert.equal(metric('rework').score, 100); assert.equal(metric('rework').samples, 6);
    assert.equal(metric('clean').value, 1); assert.equal(metric('turnsPerVer').value, 3);
    assert.equal(metric('verShare').value, .5); assert.equal(metric('verShare').score, 0);
    assert.equal(metric('testShare').value, 1); assert.equal(metric('testShare').score, 100);
    assert.equal(metric('outIdx').value, 1); assert.equal(metric('effIdx').value, 1); assert.equal(metric('effIdx').score, 50);
    assert.equal(metric('permMed').state, 'unknown'); assert.equal(metric('permMed').value, null);
    assert.equal(metric('longShare').value, 0); assert.equal(metric('longShare').score, 100); assert.equal(metric('longShare').samples, 6);
    assert.deepEqual([result.index, result.confidence, result.level, result.margin], [73, '低', '待定', 15]);
    assert.equal(result.dims.verify.score, 50); assert.equal(result.dims.flow.score, 100);
    assert.equal(result.dims.prompt.teamMedian, 100); assert.equal(result.inputs.analysisVersions.length, 3);
    assert.ok(result.representatives.best); assert.ok(metric('elem').evidence.length); assert.match(result.inputs.waitsVersion, /^[a-f0-9]{64}$/);
    const raw = await fixture.api(owner, '/api/snapshots/' + metric('elem').evidence[0].snapshotId + '/raw'); assert.equal(raw.status, 200);
    assert.ok((await raw.text()).includes(metric('elem').evidence[0].quote));
    const tokenOnlyDay = { type: 'event_msg', timestamp: new Date(fixture.base.getTime() + 86400000).toISOString(), payload: { type: 'token_count', info: { total_token_usage: {
      input_tokens: 2000, cached_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0, total_tokens: 2000 } } } };
    await fixture.upload(owner, [...first.rows, tokenOnlyDay], first.sessionId);
    const tokenUpdate = await (await fixture.api(owner, '/api/assessments/' + owner.employeeId)).json();
    assert.equal(tokenUpdate.sample.activeDays, 1, 'a day containing only Token metadata is not a business activity day');
    assert.deepEqual(tokenUpdate.dims.adopt.metrics.map((m: any) => m.value), result.dims.adopt.metrics.map((m: any) => m.value));
    assert.deepEqual(await (await fixture.api(owner, '/api/assessments/' + owner.employeeId + '?version=' + result.version)).json(), result);
  } finally { await fixture.close(); }
});

test('zero outcomes, sample thresholds and a reopened restored leaf preserve evidence and earlier assessments', { timeout: 240_000 }, async () => {
  const fixture = await assessmentFixture();
  try {
    const owner = await fixture.owner('样本门槛员工'), zero = await fixture.owner('零产出员工');
    const path = '/api/assessments/' + owner.employeeId, metric = (assessment: any, key: string) => Object.values(assessment.dims).flatMap((dim: any) => dim.metrics).find((m: any) => m.key === key) as any;
    for (let i = 0; i < 3; i++) await fixture.session(zero, { prompts: 15, verified: 0, claimed: 0, elements: 0, rework: true, long: true });
    const zeroBaseline = await (await fixture.api(zero, '/api/assessments/' + zero.employeeId)).json();
    assert.equal(metric(zeroBaseline, 'effIdx').value, null); assert.equal(metric(zeroBaseline, 'effIdx').state, 'unknown');
    const floor = await (await fixture.api(zero, '/api/assessment-baselines/' + zeroBaseline.inputs.baselineVersion)).json();
    assert.equal(floor.tasks.implementation.verifiedMean, .5); assert.equal(floor.tasks.implementation.efficiencyMedian, null);
    const first = await fixture.session(owner, { prompts: 3, elements: 1, verified: 2, claimed: 0 });
    await fixture.session(owner, { prompts: 3, elements: 1, verified: 2, claimed: 0 });
    const small = await (await fixture.api(owner, path)).json();
    assert.equal(metric(small, 'elem').samples, 2); assert.equal(metric(small, 'elem').state, 'insufficient'); assert.equal(metric(small, 'elem').score, null);
    assert.equal(metric(small, 'outIdx').state, 'insufficient');
    await fixture.session(owner, { prompts: 3, elements: 1, verified: 2, claimed: 0 });
    const scored = await (await fixture.api(owner, path)).json();
    assert.equal(metric(scored, 'elem').score, 0); assert.equal(metric(scored, 'elem').value, .25); assert.equal(metric(scored, 'verShare').score, 100);
    assert.equal(metric(scored, 'outIdx').score, 100); assert.equal(metric(scored, 'effIdx').score, 100);
    assert.equal(scored.tips.find((tip: any) => tip.dim === 'prompt').text, '写明不能改动的文件、接口或环境');
    const afterRestore = await fixture.enroll(owner), activeRows = [...first.rows, { type: 'event_msg', timestamp: new Date(fixture.base.getTime() + 4001).toISOString(), payload: { type: 'task_started', turn_id: 'new-active-turn' } }];
    const restored = await fixture.upload(afterRestore, activeRows, first.sessionId, { restoredFrom: { snapshotId: first.snapshotId, hash: (await import('../apps/server/database.js')).digest(first.bytes), byteLength: first.bytes.length } });
    const reopened = await (await fixture.api(owner, path)).json();
    assert.equal(reopened.sample.sessions, 3); assert.equal(reopened.sample.prompts, 9);
    assert.equal(metric(reopened, 'outIdx').samples, 2); assert.equal(metric(reopened, 'outIdx').state, 'insufficient');
    assert.deepEqual(await (await fixture.api(owner, path + '?version=' + scored.version)).json(), scored);
    const finished = await fixture.upload(afterRestore, [...activeRows, { type: 'event_msg', timestamp: new Date(fixture.base.getTime() + 4101).toISOString(), payload: { type: 'task_complete', turn_id: 'new-active-turn' } }], first.sessionId);
    await fixture.analyze(owner, finished.snapshotId);
    const resumed = await (await fixture.api(owner, path)).json();
    assert.equal(resumed.sample.sessions, 3); assert.equal(resumed.sample.prompts, 9); assert.equal(metric(resumed, 'outIdx').samples, 3);
    assert.equal(resumed.dims.prompt.score, scored.dims.prompt.score);
    assert.deepEqual(await (await fixture.api(owner, path + '/recompute', {})).json(), resumed);
    assert.deepEqual(await (await fixture.api(zero, '/api/assessment-baselines/' + zeroBaseline.inputs.baselineVersion)).json(), floor);
    const zeroView = await (await fixture.api(zero, '/api/assessments/' + zero.employeeId)).json();
    assert.equal(metric(zeroView, 'turnsPerVer').value, 90); assert.equal(metric(zeroView, 'turnsPerVer').score, 0); assert.equal(metric(zeroView, 'verShare').state, 'insufficient');
    assert.equal(metric(zeroView, 'rework').value, 1); assert.equal(metric(zeroView, 'rework').score, 0);
    assert.equal(metric(zeroView, 'clean').value, 0); assert.equal(metric(zeroView, 'clean').score, 0);
    assert.equal(metric(zeroView, 'longShare').value, 1); assert.equal(metric(zeroView, 'longShare').score, 0);
    assert.equal(metric(zeroView, 'testShare').value, 0); assert.equal(metric(zeroView, 'testShare').score, 0);
    assert.equal(metric(zeroView, 'outIdx').value, 0); assert.equal(metric(zeroView, 'outIdx').score, 0);
    const afterPeer = await (await fixture.api(owner, path)).json();
    assert.equal(afterPeer.dims.prompt.score, resumed.dims.prompt.score, 'team median never enters fixed-anchor prompt scoring');
    assert.deepEqual(Buffer.from(await (await fixture.api(owner, '/api/snapshots/' + restored.snapshotId + '/raw')).arrayBuffer()), Buffer.from(activeRows.map(row => JSON.stringify(row)).join('\n') + '\n'));
    const unknown = await fixture.owner('轮次来源未知'), native = fixture.rows({ prompts: 3 });
    const missingState = native.rows.filter((row: any) => !['task_started','task_complete'].includes(row.payload?.type));
    const noBoundary = await fixture.upload(unknown, missingState, native.sessionId); await fixture.analyze(unknown, noBoundary.snapshotId);
    const unknownAssessment = await (await fixture.api(unknown, '/api/assessments/' + unknown.employeeId)).json();
    assert.equal(metric(unknownAssessment, 'outIdx').state, 'unknown'); assert.equal(metric(unknownAssessment, 'outIdx').value, null);
    assert.equal(metric(unknownAssessment, 'longShare').state, 'unknown');
  } finally { await fixture.close(); }
});

test('the displayed grade rounds the worked 71.4 and 71.5 indices and freezes a changed team baseline', { timeout: 240_000 }, async () => {
  const fixture = await assessmentFixture();
  try {
    const owner = await fixture.owner('甲边界样本'), peer = await fixture.owner('乙基线样本');
    for (let i = 0; i < 8; i++) await fixture.session(owner, { tokens: 194021 });
    const peers = []; for (let i = 0; i < 8; i++) peers.push(await fixture.session(peer, { tokens: 178879 }));
    const path = '/api/assessments/' + owner.employeeId, firstResponse = await fixture.api(owner, path); assert.equal(firstResponse.status, 200, await firstResponse.clone().text());
    const first = await firstResponse.json();
    // PRD worked values: dimensions 50,100,93.9393939394,50,50.7474747475,100;
    // 20/20/20/20/15/5 weights yield exactly 71.4. Token baseline ratios are
    // 1583/1650, then 107/110; fixed integer token inputs avoid invented scores.
    assert.deepEqual([first.index, first.confidence, first.level], [71, '高', '一般']);
    assert.ok(Math.abs(first.dims.output.score - 50.7474747475) < .000001);
    for (const old of peers) {
      const next = [...old.rows, { type: 'event_msg', timestamp: new Date(fixture.base.getTime() + 5501).toISOString(), payload: { type: 'token_count', info: { total_token_usage: {
        input_tokens: 183719, cached_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0, total_tokens: 183719 } } } }];
      const replacement = await fixture.upload(peer, next, old.sessionId); await fixture.analyze(peer, replacement.snapshotId);
    }
    const second = await (await fixture.api(owner, path)).json();
    assert.ok(Math.abs(second.dims.output.score - 51.4141414141) < .000001);
    assert.deepEqual([second.index, second.confidence, second.level], [72, '高', '较好']);
    assert.notEqual(second.inputs.baselineVersion, first.inputs.baselineVersion); assert.notEqual(second.version, first.version);
    for (const key of ['adopt','prompt','iter','verify','flow']) assert.equal(second.dims[key].score, first.dims[key].score, key);
    assert.deepEqual(await (await fixture.api(owner, path + '?version=' + first.version)).json(), first);
    assert.deepEqual(await (await fixture.api(owner, path + '/recompute', {})).json(), second);
    const baseline = await (await fixture.api(owner, '/api/assessment-baselines/' + second.inputs.baselineVersion)).json();
    assert.equal(baseline.tasks.implementation.sessions, 16); assert.equal(baseline.tasks.implementation.verifiedMean, 1);
  } finally { await fixture.close(); }
});
