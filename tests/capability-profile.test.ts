import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { assessmentFixture } from './assessment-fixture.js';
import { beijingDate } from '../packages/contracts/reports.js';
import { monday, addDays } from '../packages/contracts/work-views.js';
import { setTimeout } from 'node:timers/promises';

test('profile work content binds daily and weekly report revisions without generating reports on read', { timeout: 120000 }, async () => {
  const fixture = await assessmentFixture();
  try {
    const owner = await fixture.owner('Work owner'); await fixture.session(owner);
    const date = beijingDate(fixture.base), from = monday(date), to = addDays(from, 6), path = '/api/capability-profiles/' + owner.employeeId;
    const first = await (await fixture.api(owner, path)).json();
    assert.equal(first.work.items.length, 0);
    assert.equal(first.work.reports.find((r: any) => r.kind === 'daily' && r.from === date).state, 'not-scheduled');
    const dailyPath = '/api/daily-reports/' + owner.employeeId + '/' + date;
    assert.equal((await fixture.api(owner, dailyPath, {})).status, 202);
    const weeklyPath = '/api/work-view?' + new URLSearchParams({ kind: 'weekly', subject: owner.employeeId, from, to });
    assert.equal((await fixture.api(owner, weeklyPath, {})).status, 202);
    let day: any, week: any; const deadline = Date.now() + 45000;
    do { day = await (await fixture.api(owner, dailyPath)).json(); week = await (await fixture.api(owner, weeklyPath)).json(); if (day.items.length && week.items.length) break; await setTimeout(200); } while (Date.now() < deadline);
    assert.ok(day.items.length && week.items.length);
    const profile = await (await fixture.api(owner, path)).json();
    const daily = profile.work.reports.find((r: any) => r.kind === 'daily' && r.from === date), weekly = profile.work.reports.find((r: any) => r.kind === 'weekly' && r.from === from);
    assert.equal(daily.version, day.version); assert.equal(daily.revision, day.revision);
    assert.equal(weekly.version, week.version); assert.equal(weekly.revision, week.revision);
    assert.equal(profile.work.items.length, 1, 'identical daily and weekly findings retain references without duplicate work');
    assert.deepEqual(profile.work.items[0].item, day.items[0]);
    assert.deepEqual(profile.work.items[0].reportIds.sort(), [daily.id, weekly.id].sort());
    assert.equal(profile.work.items[0].date, date);
    assert.notEqual(profile.version, first.version);
    assert.deepEqual(await (await fixture.api(owner, path + '?version=' + first.version)).json(), first);
    assert.deepEqual(await (await fixture.api(owner, path + '/export?version=' + profile.version)).json(), profile);
  } finally { await fixture.close(); }
});

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

test('profile session details and recent activity preserve employee scope and original report versions', { timeout: 120000 }, async () => {
  const fixture = await assessmentFixture();
  try {
    const owner = await fixture.owner('Profile owner'), other = await fixture.owner('Other owner');
    await fixture.session(owner, { prompts: 3, verified: 2 }); await fixture.session(other, { prompts: 5, verified: 1 });
    const response = await fixture.api(owner, '/api/capability-profiles/' + owner.employeeId); assert.equal(response.status, 200);
    const profile = await response.json();
    assert.equal(profile.sessions.length, 1); assert.equal(profile.sessions[0].userTurns, 3); assert.equal(profile.sessions[0].verified, 2);
    const efficiency = await (await fixture.api(owner, '/api/session-efficiency/export?period=since-enrollment&employeeId=' + owner.employeeId + '&version=' + profile.references.efficiency.version)).json();
    assert.equal(profile.references.efficiency.metricVersion, profile.assessment.inputs.metricsVersion);
    const row = efficiency.sessions[0], shown = profile.sessions[0];
    for (const key of ['sessionId','snapshotId','tokens','userTurns','verified','rework','taskType','webPath']) assert.equal(shown[key], row[key]);
    assert.deepEqual(shown.efficiency, row.efficiency); assert.deepEqual(shown.waitFraction, row.timing.waitFraction);
    assert.deepEqual(profile.taskDistribution, [{ taskType: 'implementation', sessions: 1 }]);
    assert.ok(profile.recentActivity.events.length > 0);
    for (const item of profile.recentActivity.events) assert.equal(item.employeeId, owner.employeeId);
    for (const reference of profile.recentActivity.references) {
      assert.ok(reference.path.includes('employeeId=' + owner.employeeId)); assert.ok(reference.path.includes('date=' + reference.date));
      const activity = await (await fixture.api(owner, '/api/activity/export?employeeId=' + owner.employeeId + '&date=' + reference.date + '&version=' + reference.version)).json();
      for (const event of profile.recentActivity.events.filter((event: any) => event.sourceDate === reference.date)) assert.deepEqual(event, activity.events.find((other: any) => other.id === event.id));
    }
  } finally { await fixture.close(); }
});

test('daily verified output follows the original result date within one continuing session', { timeout: 120000 }, async () => {
  const fixture = await assessmentFixture();
  try {
    const owner = await fixture.owner('Two day owner'), record = fixture.rows({ prompts: 2, verified: 1 });
    const second = record.rows.findIndex((row: any) => row.payload?.role === 'user' && row.payload.content[0].text.startsWith('请求 1'));
    for (const row of record.rows.slice(second) as any[]) if (row.timestamp) row.timestamp = new Date(Date.parse(row.timestamp) + 86400000).toISOString();
    const secondStart = Date.parse((record.rows[second] as any).timestamp);
    const extra = [0, 1].flatMap(index => [
      { type: 'response_item', timestamp: new Date(secondStart + 10 + index).toISOString(), payload: { type: 'function_call', name: 'exec_command', call_id: 'day2/' + index, arguments: JSON.stringify({ cmd: 'node --test day2-' + index + '.js' }) } },
      { type: 'response_item', timestamp: new Date(secondStart + 30 + index).toISOString(), payload: { type: 'function_call_output', call_id: 'day2/' + index, output: '# tests 1\n# pass 1\n# fail 0\nday2-' + index } },
    ]);
    record.rows.splice(second + 2, 0, ...extra);
    const uploaded = await fixture.upload(owner, record.rows, record.sessionId); await fixture.analyze(owner, uploaded.snapshotId);
    const response = await fixture.api(owner, '/api/capability-profiles/' + owner.employeeId); assert.equal(response.status, 200);
    const profile = await response.json();
    const date = (time: number) => new Date(time + 8 * 3600000).toISOString().slice(0, 10);
    const day1 = date(fixture.base.getTime()), day2 = date(fixture.base.getTime() + 86400000);
    assert.equal(profile.kpis.sessions, 1); assert.equal(profile.kpis.outputs.verified.value, 3);
    assert.equal(profile.usage.daily.find((day: any) => day.date === day1).outputs.verified.value, 1);
    assert.equal(profile.usage.daily.find((day: any) => day.date === day2).outputs.verified.value, 2);
    const usage = await (await fixture.api(owner, '/api/usage-output/export?period=since-enrollment&version=' + profile.usage.version)).json();
    assert.deepEqual(profile.usage.daily, usage.employees.find((person: any) => person.employeeId === owner.employeeId).daily);
    const repeated = await fixture.upload(owner, record.rows, record.sessionId);
    assert.equal(repeated.snapshotId, uploaded.snapshotId);
    const again = await (await fixture.api(owner, '/api/capability-profiles/' + owner.employeeId)).json(); assert.equal(again.version, profile.version);
  } finally { await fixture.close(); }
});
