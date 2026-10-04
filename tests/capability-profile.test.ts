import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { assessmentFixture } from './assessment-fixture.js';

test('an employee profile binds real device sync metadata and usage to its exact assessment across restart', { timeout: 120000 }, async () => {
  const fixture = await assessmentFixture();
  try {
    const owner = await fixture.owner('Same name'), other = await fixture.owner('Same name');
    const before = Date.now(); await fixture.session(owner, { prompts: 3, verified: 2 }); const after = Date.now();
    const path = '/api/capability-profiles/' + owner.employeeId;
    assert.equal((await fixture.nativeApi(path)).status, 401);
    assert.equal((await fixture.nativeApi(path, owner.deviceCredential)).status, 401);
    const response = await fixture.api(owner, path); assert.equal(response.status, 200, await response.clone().text());
    const profile = await response.json();
    assert.equal(profile.employeeId, owner.employeeId);
    assert.equal(profile.header.deviceCount, 1); assert.equal(profile.header.devices[0].id, owner.deviceId);
    assert.ok(Date.parse(profile.header.lastSyncedAt) >= before && Date.parse(profile.header.lastSyncedAt) <= after);
    assert.ok(profile.header.enrolledAt); assert.equal(profile.header.devices[0].active, true);
    const assessment = await (await fixture.api(owner, '/api/assessments/' + owner.employeeId + '/export?version=' + profile.assessment.version)).json();
    assert.deepEqual(profile.assessment, assessment);
    const usage = await (await fixture.api(owner, '/api/usage-output/export?period=since-enrollment&version=' + profile.usage.version)).json();
    const mine = usage.employees.find((p: any) => p.employeeId === owner.employeeId);
    assert.equal(profile.usage.version, assessment.inputs.usageVersion);
    assert.equal(profile.kpis.sessions, 1); assert.equal(profile.kpis.userTurns, 3);
    assert.deepEqual(profile.kpis.outputs, mine.outputs); assert.equal(profile.kpis.outputs.verified.value, 2);
    assert.deepEqual(profile.range, assessment.range);
    const empty = await (await fixture.api(owner, '/api/capability-profiles/' + other.employeeId)).json();
    assert.equal(empty.kpis.sessions, 0); assert.equal(empty.header.lastSyncedAt, null); assert.equal(empty.header.deviceCount, 1);
    assert.equal((await fixture.api(owner, '/api/capability-profiles/' + randomUUID())).status, 404);
    await fixture.session(owner, { prompts: 3 });
    const latest = await (await fixture.api(owner, path)).json(); assert.notEqual(latest.version, profile.version); assert.equal(latest.kpis.sessions, 2);
    await fixture.restart();
    assert.deepEqual(await (await fixture.api(owner, path + '?version=' + profile.version)).json(), profile);
    assert.deepEqual(await (await fixture.api(owner, path + '/export?version=' + profile.version)).json(), profile);
  } finally { await fixture.close(); }
});
