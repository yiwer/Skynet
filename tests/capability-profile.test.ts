import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { assessmentFixture } from './assessment-fixture.js';
import { beijingDate } from '../packages/contracts/reports.js';
import { monday, addDays } from '../packages/contracts/work-views.js';
import { setTimeout } from 'node:timers/promises';

test('recent profile activity shows each undated capture gap once across a multi-day session', { timeout: 120000 }, async () => {
  const fixture = await assessmentFixture();
  try {
    const owner = await fixture.owner('Multi-day gaps'), record = fixture.rows({ prompts: 3 });
    for (const row of record.rows as any[]) if (row.timestamp) {
      const delta = Date.parse(row.timestamp) - fixture.base.getTime();
      if (delta >= 0) row.timestamp = new Date(Date.parse(row.timestamp) + Math.min(2, Math.floor(delta / 1100)) * 86400000).toISOString();
    }
    await fixture.upload(owner, record.rows, record.sessionId, { capture: { generation: createHash('sha256').update('profile-gap').digest('hex'), revision: 1, change: 'initial', materials: [],
      gaps: [{ code: 'missing', reference: '缺失的原生附件' }], lineage: [], compacted: false, partialLine: false } });
    const response = await fixture.api(owner, '/api/capability-profiles/' + owner.employeeId); assert.equal(response.status, 200, await response.clone().text());
    const profile = await response.json(), events = profile.recentActivity.events;
    assert.equal(new Set(events.map((event: any) => event.id)).size, events.length);
    const gaps = events.filter((event: any) => event.type === 'gap' && event.excerpt === '缺失的原生附件'); assert.equal(gaps.length, 1); assert.equal(gaps[0].sourceDate, null);
    assert.equal(profile.kpis.sessions, 1); assert.equal(profile.kpis.userTurns, 3);
  } finally { await fixture.close(); }
});

test('late delivery observations update the profile source identity without changing its original usage or fixed history', { timeout: 120000 }, async () => {
  const fixture = await assessmentFixture();
  try {
    const owner = await fixture.owner('Delivery profile'), session = await fixture.session(owner, { prompts: 2 });
    const uploadId = randomUUID(), hash = createHash('sha256').update(session.bytes).digest('hex');
    const registered = await fixture.nativeApi('/api/snapshots', owner.deviceCredential, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': uploadId }, body: JSON.stringify({
      protocolVersion: 1, sourceSessionId: session.sessionId, source: 'codex-cli', sourceVersion: '0.157.1', sourceOs: process.platform,
      project: '/synthetic/assessment-model', hash, byteLength: session.bytes.length, qualifiedAt: fixture.base.toISOString(), capability: 'unverified' }) });
    assert.equal(registered.status, 200, await registered.clone().text());
    const path = '/api/capability-profiles/' + owner.employeeId, before = await (await fixture.api(owner, path)).json();
    const time = (ms: number) => new Date(fixture.base.getTime() + ms).toISOString();
    const receipt = await fixture.nativeApi('/api/delivery/receipts', owner.deviceCredential, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      uploadId, snapshotId: session.snapshotId, capturedAt: time(0), acknowledgedAt: time(86460000), disconnectedAttempts: 1, firstDisconnectedAt: time(1000), lastDisconnectedAt: time(1000) }) });
    assert.equal(receipt.status, 200, await receipt.clone().text());
    const after = await (await fixture.api(owner, path)).json();
    assert.notEqual(after.version, before.version); assert.notEqual(after.frontierVersion, before.frontierVersion, 'delivery changes are part of the frozen source identity');
    assert.deepEqual(after.kpis, before.kpis); assert.equal(after.assessment.version, before.assessment.version);
    const backfill = after.recentActivity.events.find((event: any) => event.type === 'backfill');
    assert.ok(backfill, 'a recorded reconnection remains visible on a day without new prompts');
    assert.equal(backfill.timestamp, time(86460000));
    assert.deepEqual(await (await fixture.api(owner, path + '?version=' + before.version)).json(), before);
  } finally { await fixture.close(); }
});

test('fixed assessment links resolve the same profile without mixing a historical assessment with current sources', { timeout: 120000 }, async () => {
  const fixture = await assessmentFixture();
  try {
    const owner = await fixture.owner('Linked profile'); await fixture.session(owner);
    const path = '/api/capability-profiles/' + owner.employeeId;
    const assessment = await (await fixture.api(owner, '/api/assessments/' + owner.employeeId)).json();
    const response = await fixture.api(owner, path + '?assessmentVersion=' + assessment.version); assert.equal(response.status, 200, await response.clone().text());
    const first = await response.json(); assert.equal(first.assessment.version, assessment.version);
    const quality = await (await fixture.api(owner, '/api/assessments/' + owner.employeeId + '?preset=' + encodeURIComponent('重质量'))).json();
    await fixture.session(owner);
    assert.deepEqual(await (await fixture.api(owner, path + '?assessmentVersion=' + assessment.version)).json(), first);
    const missing = await fixture.api(owner, path + '?assessmentVersion=' + quality.version);
    assert.equal(missing.status, 409, 'an unfrozen historical profile must not be reconstructed from live sources');
    assert.equal((await fixture.api(owner, path + '?assessmentVersion=' + assessment.version + '&preset=' + encodeURIComponent('重质量'))).status, 409);
    assert.equal((await fixture.api(owner, path + '?version=' + first.version + '&assessmentVersion=' + quality.version)).status, 409);
  } finally { await fixture.close(); }
});

test('large profiles page sessions at one frozen version while export retains every row', { timeout: 180000 }, async () => {
  const fixture = await assessmentFixture();
  try {
    const owner = await fixture.owner('Paged profile');
    for (let i = 0; i < 25; i++) { const item = fixture.rows({ prompts: 1 }); await fixture.upload(owner, item.rows, item.sessionId); }
    const path = '/api/capability-profiles/' + owner.employeeId;
    const response = await fixture.api(owner, path); assert.equal(response.status, 200, await response.clone().text());
    const profile = await response.json();
    assert.equal(profile.sessions.length, 20); assert.equal(profile.pages.sessions.total, 25); assert.equal(profile.pages.sessions.nextOffset, 20);
    assert.ok(Buffer.byteLength(JSON.stringify(profile)) <= 80 * 1024);
    const fixed = await (await fixture.api(owner, path + '/export?version=' + profile.version)).json(); assert.equal(fixed.sessions.length, 25);
    const item = fixture.rows(); await fixture.upload(owner, item.rows, item.sessionId);
    const page = await (await fixture.api(owner, path + '?version=' + profile.version + '&section=sessions&offset=20')).json();
    assert.equal(page.sessions.length, 5); assert.equal(page.pages.sessions.nextOffset, null); assert.equal(page.version, profile.version);
    assert.deepEqual([...profile.sessions, ...page.sessions], fixed.sessions);
    assert.equal((await fixture.api(owner, path + '?section=sessions&offset=20')).status, 400);
    assert.equal((await fixture.api(owner, path + '?version=' + profile.version + '&offset=20')).status, 400, 'a cursor must identify the paged section');
    assert.equal((await fixture.api(owner, path + '/export?version=' + profile.version + '&section=sessions')).status, 400, 'full export does not silently accept section pagination');
    assert.equal((await fixture.api(owner, path + '?version=' + profile.version + '&section=sessions&offset=26')).status, 400);
  } finally { await fixture.close(); }
});

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
    const { pages: _pages, ...exported } = profile; assert.deepEqual(await (await fixture.api(owner, path + '/export?version=' + profile.version)).json(), exported);
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
    const { pages: _pages, ...exported } = profile; assert.deepEqual(await (await fixture.api(owner, path + '/export?version=' + profile.version)).json(), exported);
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
