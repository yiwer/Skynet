import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout } from 'node:timers/promises';
import { assessmentFixture } from './assessment-fixture.js';

test('an assessment never freezes usage and waits from opposite sides of a concurrent public upload', { timeout: 180_000 }, async () => {
  const fixture = await assessmentFixture(), held = await fixture.testDatabase.connect();
  let locked = false;
  try {
    const owner = await fixture.owner('交错评估员工');
    for (let i = 0; i < 2; i++) await fixture.session(owner, { prompts: 3 });
    // Schedule the real database at its publication boundary. Product behavior
    // is asserted only through HTTP and its frozen documents, never table rows.
    await held.query('SELECT pg_advisory_lock(7402140)'); locked = true;
    const pid = (await held.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    const pending = fixture.api(owner, '/api/assessments/' + owner.employeeId);
    let reached = false;
    for (let tick = 0; tick < 500; tick++) {
      reached = (await fixture.testDatabase.query('SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) AS reached', [pid])).rows[0].reached;
      if (reached) break;
      await setTimeout(20);
    }
    assert.equal(reached, true, 'the isolated database gate must be reached before the concurrent upload');
    const late = await fixture.session(owner, { prompts: 3, long: true });
    await held.query('SELECT pg_advisory_unlock(7402140)'); locked = false;
    const response = await pending; assert.equal(response.status, 200, await response.clone().text());
    const result = await response.json();
    const usage = await (await fixture.api(owner, '/api/usage-output/export?period=since-enrollment&version=' + result.inputs.usageVersion)).json();
    const waits = await (await fixture.api(owner, '/api/waits/export?period=since-enrollment&version=' + result.inputs.waitsVersion)).json();
    const sourceIds = new Set(usage.sessions.flatMap((row: any) => row.insightVersions.map((input: any) => input.snapshotId)));
    assert.ok(waits.intervals.every((interval: any) => sourceIds.has(interval.end.snapshotId) && (!interval.start || sourceIds.has(interval.start.snapshotId))),
      'a frozen wait cannot borrow a source absent from the usage input');
    assert.equal(result.sample.sessions, 3, 'a changed source frontier retries all assessment inputs');
    assert.ok(sourceIds.has(late.snapshotId));
    assert.deepEqual(await (await fixture.api(owner, '/api/assessments/' + owner.employeeId + '/recompute', {})).json(), result);
    assert.deepEqual(await (await fixture.api(owner, '/api/assessments/' + owner.employeeId + '?version=' + result.version)).json(), result);
  } finally { if (locked) await held.query('SELECT pg_advisory_unlock(7402140)'); held.release(); await fixture.close(); }
});

test('an assessment includes an analysis completed during its read even when the original set is unchanged', { timeout: 180_000 }, async () => {
  const fixture = await assessmentFixture(), held = await fixture.testDatabase.connect();
  let locked = false;
  try {
    const owner = await fixture.owner('分析交错员工');
    for (let i = 0; i < 2; i++) await fixture.session(owner, { prompts: 3 });
    const original = fixture.rows({ prompts: 3 });
    const pendingAnalysis = await fixture.upload(owner, original.rows, original.sessionId);
    await held.query('SELECT pg_advisory_lock(7402140)'); locked = true;
    const pid = (await held.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    const pending = fixture.api(owner, '/api/assessments/' + owner.employeeId);
    let reached = false;
    for (let tick = 0; tick < 500; tick++) {
      reached = (await fixture.testDatabase.query('SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) AS reached', [pid])).rows[0].reached;
      if (reached) break;
      await setTimeout(20);
    }
    assert.equal(reached, true, 'the isolated database gate must be reached before completing analysis');
    const analysisId = await fixture.analyze(owner, pendingAnalysis.snapshotId);
    await held.query('SELECT pg_advisory_unlock(7402140)'); locked = false;
    const response = await pending; assert.equal(response.status, 200, await response.clone().text());
    const result = await response.json();
    assert.equal(result.sample.sessions, 3);
    assert.ok(result.inputs.analysisVersions.includes(analysisId), 'the completed analysis must belong to the same fixed assessment input');
    assert.equal(result.dims.prompt.metrics.find((metric: any) => metric.key === 'elem').samples, 3);
    assert.deepEqual(await (await fixture.api(owner, '/api/assessments/' + owner.employeeId + '/recompute', {})).json(), result);
    assert.deepEqual(await (await fixture.api(owner, '/api/assessments/' + owner.employeeId + '?version=' + result.version)).json(), result);
  } finally { if (locked) await held.query('SELECT pg_advisory_unlock(7402140)'); held.release(); await fixture.close(); }
});
