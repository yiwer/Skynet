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
