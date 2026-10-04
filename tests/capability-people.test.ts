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

test('parallel employee overview reads and later membership changes keep a complete stable paged list', { timeout: 180000 }, async () => {
  const sandbox = await assessmentFixture();
  try {
    const owner = await sandbox.owner('Member 00');
    for (let i = 1; i <= 21; i++) await sandbox.owner('Member ' + String(i).padStart(2, '0'));
    await sandbox.session(owner, { prompts: 3 });
    const simultaneous = await Promise.all(Array.from({ length: 6 }, async () => {
      const response = await sandbox.api(owner, '/api/capability-people');
      const value = await response.json(); assert.equal(response.status, 200, JSON.stringify(value)); return value;
    }));
    assert.equal(new Set(simultaneous.map(value => value.version)).size, 1);
    const first = simultaneous[0]; assert.equal(first.total, 22); assert.equal(first.employees.length, 20); assert.equal(first.nextOffset, 20);
    await sandbox.owner('Member 22');
    const second = await (await sandbox.api(owner, '/api/capability-people?version=' + first.version + '&offset=20')).json();
    assert.deepEqual(second.employees.map((p: any) => p.employee), ['Member 20', 'Member 21']); assert.equal(second.nextOffset, null);
    const whole = await (await sandbox.api(owner, '/api/capability-people/export?version=' + first.version)).json();
    assert.equal(whole.employees.length, 22); assert.deepEqual(whole.employees, [...first.employees, ...second.employees]);
    assert.equal((await sandbox.api(owner, '/api/capability-people?version=' + first.version + '&period=last-week')).status, 409);
    const latest = await (await sandbox.api(owner, '/api/capability-people')).json(); assert.equal(latest.total, 23); assert.notEqual(latest.version, first.version);
  } finally { await sandbox.close(); }
});
