import test from 'node:test';
import assert from 'node:assert/strict';
import { assessmentFixture } from './assessment-fixture.js';

test('employee groups preserve names and exact individual assessment versions across uploads and restart', { timeout: 180000 }, async () => {
  const sandbox = await assessmentFixture();
  try {
    const zeta = await sandbox.owner('Zeta'), alpha = await sandbox.owner('Alpha'), empty = await sandbox.owner('Beta');
    assert.equal((await sandbox.nativeApi('/api/capability-people')).status, 401);
    assert.equal((await sandbox.nativeApi('/api/capability-people', zeta.deviceCredential)).status, 401);
    await sandbox.session(zeta, { prompts: 3, verified: 1 });
    await sandbox.session(alpha, { prompts: 3, verified: 2, rework: true });
    const response = await sandbox.api(zeta, '/api/capability-people');
    assert.equal(response.status, 200, await response.clone().text());
    const report = await response.json();
    assert.equal(report.total, 3); assert.equal(report.nextOffset, null);
    assert.deepEqual(report.groups.map((g: any) => [g.level, g.count]), [['较好', 0], ['一般', 0], ['需提升', 0], ['待定', 3]]);
    assert.deepEqual(report.employees.map((p: any) => p.employee), ['Alpha', 'Beta', 'Zeta']);
    for (const card of report.employees) {
      const detail = await (await sandbox.api(zeta, '/api/assessments/' + card.employeeId + '?version=' + card.assessmentVersion)).json();
      assert.equal(card.reason, detail.reason); assert.equal(card.index, detail.index); assert.equal(card.level, detail.level);
      assert.equal(card.confidence, detail.confidence); assert.equal(card.margin, detail.margin); assert.deepEqual(card.sample, detail.sample);
      assert.deepEqual(card.coverageIssues, detail.coverageIssues);
      for (const [key, dim] of Object.entries(card.dims) as [string, any][]) assert.equal(dim.score, detail.dims[key].score);
      assert.equal(detail.inputs.frontierVersion, report.frontierVersion);
      assert.ok(card.profilePath.includes('version=' + detail.version));
    }
    assert.equal(report.employees.find((p: any) => p.employeeId === empty.employeeId).index, null);
    assert.equal(report.employees.find((p: any) => p.employeeId === alpha.employeeId).verified.value, 2);
    assert.equal((await sandbox.api(zeta, '/api/capability-people?sort=index')).status, 400);
    assert.equal((await sandbox.api(zeta, '/api/capability-people?offset=1')).status, 400);
    const again = await (await sandbox.api(zeta, '/api/capability-people')).json(); assert.equal(again.version, report.version);
    await sandbox.session(zeta, { prompts: 3 });
    const newer = await (await sandbox.api(zeta, '/api/capability-people')).json(); assert.notEqual(newer.version, report.version);
    await sandbox.restart();
    assert.deepEqual(await (await sandbox.api(zeta, '/api/capability-people?version=' + report.version)).json(), report);
    assert.deepEqual(await (await sandbox.api(zeta, '/api/capability-people/export?version=' + report.version)).json(), report);
  } finally { await sandbox.close(); }
});
