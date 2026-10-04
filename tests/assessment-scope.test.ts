import test from 'node:test';
import assert from 'node:assert/strict';
import { assessmentFixture } from './assessment-fixture.js';

test('fixed assessment presets change only the weighted result and preserve every dimension and historical input', { timeout: 180_000 }, async () => {
  const fixture = await assessmentFixture();
  try {
    const owner = await fixture.owner('固定方案员工');
    for (let i = 0; i < 3; i++) await fixture.session(owner, { prompts: 3 });
    const path = '/api/assessments/' + owner.employeeId;
    const standard = await (await fixture.api(owner, path)).json();
    const outputResponse = await fixture.api(owner, path + '?period=since-enrollment&preset=' + encodeURIComponent('重产出'));
    assert.equal(outputResponse.status, 200, await outputResponse.clone().text());
    const output = await outputResponse.json(), quality = await (await fixture.api(owner, path + '?preset=' + encodeURIComponent('重质量'))).json();
    assert.deepEqual([standard.index, output.index, quality.index], [73, 68, 75]);
    assert.deepEqual([output.preset, quality.preset], ['重产出', '重质量']);
    assert.equal(quality.dims.flow.weight, 0); assert.equal(quality.dims.flow.effectiveWeight, 0); assert.equal(quality.dims.flow.score, 100);
    for (const other of [output, quality]) {
      assert.deepEqual(other.inputs, standard.inputs); assert.deepEqual(other.sample, standard.sample); assert.equal(other.modelVersion, standard.modelVersion);
      for (const key of Object.keys(standard.dims)) {
        assert.equal(other.dims[key].score, standard.dims[key].score); assert.deepEqual(other.dims[key].metrics, standard.dims[key].metrics);
        assert.equal(other.dims[key].teamMedian, standard.dims[key].teamMedian);
      }
      assert.notEqual(other.version, standard.version);
    }
    assert.deepEqual(await (await fixture.api(owner, path + '?version=' + standard.version)).json(), standard);
    assert.deepEqual(await (await fixture.api(owner, path + '/export?version=' + quality.version)).json(), quality);
    assert.equal((await fixture.api(owner, path + '?preset=custom&weights=100')).status, 400);
    assert.equal((await fixture.api(owner, path + '?version=' + quality.version + '&preset=' + encodeURIComponent('默认'))).status, 409);
  } finally { await fixture.close(); }
});

test('zero-weight dimensions and unavailable inferences retain known values without scoring a pre-enrollment period', { timeout: 180_000 }, async () => {
  const fixture = await assessmentFixture();
  try {
    const owner = await fixture.owner('缺维度与空周期'), path = '/api/assessments/' + owner.employeeId;
    for (let i = 0; i < 3; i++) { const native = fixture.rows({ prompts: 3 }); await fixture.upload(owner, native.rows, native.sessionId); }
    const standard = await (await fixture.api(owner, path)).json(), quality = await (await fixture.api(owner, path + '?preset=' + encodeURIComponent('重质量'))).json();
    assert.equal(standard.dims.prompt.score, null); assert.equal(quality.dims.prompt.effectiveWeight, 0);
    assert.equal(standard.dims.flow.score, 100); assert.equal(quality.dims.flow.score, 100); assert.equal(quality.dims.flow.effectiveWeight, 0);
    assert.equal(standard.index, 60); assert.equal(quality.index, 50); assert.equal(quality.dims.adopt.effectiveWeight, 100);
    fixture.now.setTime(Date.now());
    const empty = await (await fixture.api(owner, path + '?period=last-week&preset=' + encodeURIComponent('重质量'))).json();
    assert.deepEqual([empty.sample.sessions, empty.sample.workdays, empty.index, empty.margin, empty.level], [0, 0, null, null, '待定']);
    assert.equal(empty.range.from, null); assert.equal(empty.range.empty, true);
    assert.ok(Object.values(empty.dims).every((dim: any) => dim.score === null && dim.effectiveWeight === 0));
  } finally { await fixture.close(); }
});

test('assessment history pages stay fixed while new results arrive and every item remains directly readable', { timeout: 180_000 }, async () => {
  const fixture = await assessmentFixture();
  try {
    const owner = await fixture.owner('历史评估员工'), path = '/api/assessments/' + owner.employeeId;
    const initial = await (await fixture.api(owner, path)).json();
    const response = await fixture.api(owner, path + '/history?period=since-enrollment');
    assert.equal(response.status, 200, await response.clone().text());
    assert.deepEqual((await response.json()).items.map((item: any) => item.version), [initial.version]);
    for (let i = 0; i < 24; i++) { fixture.now.setUTCDate(fixture.now.getUTCDate() + 1); assert.equal((await fixture.api(owner, path)).status, 200); }
    const first = await (await fixture.api(owner, path + '/history?period=since-enrollment')).json();
    assert.equal(first.items.length, 20); assert.equal(first.total, 25); assert.ok(first.nextCursor);
    fixture.now.setUTCDate(fixture.now.getUTCDate() + 1);
    const late = await (await fixture.api(owner, path)).json();
    const tail = await (await fixture.api(owner, path + '/history?period=since-enrollment&cursor=' + first.nextCursor)).json();
    assert.equal(tail.total, 25); assert.equal(tail.items.length, 5); assert.equal(tail.nextCursor, null);
    const ids = [...first.items, ...tail.items].map((item: any) => item.version);
    assert.equal(new Set(ids).size, 25); assert.equal(ids.includes(late.version), false);
    const current = await (await fixture.api(owner, path + '/history?period=since-enrollment')).json(); assert.equal(current.items[0].version, late.version); assert.equal(current.total, 26);
    assert.equal((await fixture.api(owner, path + '/history?preset=' + encodeURIComponent('重质量'))).status, 200);
    assert.deepEqual((await (await fixture.api(owner, path + '/history?preset=' + encodeURIComponent('重质量'))).json()).items, []);
    assert.equal((await fixture.api(owner, path + '/history?period=last-week&cursor=' + first.nextCursor)).status, 400);
    assert.equal((await fixture.nativeApi(path + '/history', owner.deviceCredential)).status, 401);
    assert.deepEqual(await (await fixture.api(owner, path + '?version=' + initial.version)).json(), initial);
    await fixture.restart(); assert.deepEqual(await (await fixture.api(owner, path + '?version=' + initial.version)).json(), initial);
  } finally { await fixture.close(); }
});

test('assessment periods cross the Beijing Sunday boundary and retain the since-enrollment task baseline', { timeout: 180_000 }, async () => {
  const fixture = await assessmentFixture();
  try {
    const owner = await fixture.owner('北京时间周界员工'), path = '/api/assessments/' + owner.employeeId;
    fixture.base.setTime(Date.parse('2030-01-06T15:59:58Z'));
    await fixture.session(owner, { prompts: 1, verified: 1 });
    fixture.now.setTime(Date.parse('2030-01-06T15:59:59Z'));
    const sundayResponse = await fixture.api(owner, path + '?period=this-week');
    assert.equal(sundayResponse.status, 200, await sundayResponse.clone().text());
    const sunday = await sundayResponse.json();
    assert.equal(sunday.period, '2030-W01'); assert.equal(sunday.sample.sessions, 1);
    assert.deepEqual(sunday.range, { from: '2029-12-31', to: '2030-01-06', timeZone: 'Asia/Shanghai' });
    assert.equal(sunday.sample.workdays, 5);
    fixture.base.setTime(Date.parse('2030-01-06T16:00:00Z'));
    await fixture.session(owner, { prompts: 1, verified: 2 });
    fixture.now.setTime(Date.parse('2030-01-06T16:00:01Z'));
    const current = await (await fixture.api(owner, path + '?period=this-week')).json();
    const previous = await (await fixture.api(owner, path + '?period=last-week')).json();
    const all = await (await fixture.api(owner, path + '?period=since-enrollment')).json();
    assert.equal(current.period, '2030-W02'); assert.equal(previous.period, '2030-W01');
    assert.deepEqual(current.range, { from: '2030-01-07', to: '2030-01-13', timeZone: 'Asia/Shanghai' });
    assert.equal(current.sample.sessions, 1); assert.equal(current.sample.prompts, 1); assert.equal(current.sample.workdays, 1, 'current week counts elapsed workdays');
    assert.equal(previous.sample.sessions, 1); assert.equal(previous.sample.workdays, 5); assert.equal(all.sample.sessions, 2);
    assert.equal(previous.inputs.baselineVersion, current.inputs.baselineVersion); assert.equal(all.inputs.baselineVersion, current.inputs.baselineVersion);
    const baseline = await (await fixture.api(owner, '/api/assessment-baselines/' + current.inputs.baselineVersion)).json();
    assert.equal(baseline.tasks.implementation.sessions, 2); assert.equal(baseline.tasks.implementation.verifiedMean, 1.5);
    assert.deepEqual(await (await fixture.api(owner, path + '?version=' + sunday.version)).json(), sunday);
    assert.deepEqual(await (await fixture.api(owner, path + '/recompute', { period: 'last-week' })).json(), previous);
    assert.equal((await fixture.api(owner, path + '?period=custom&from=2030-01-01&to=2030-01-31')).status, 400);
  } finally { await fixture.close(); }
});
