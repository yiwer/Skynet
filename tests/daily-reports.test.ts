import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { dueReportDate, beijingDate, reportDate } from '../packages/contracts/reports.js';
import { dailyItems, reportRunCoverage } from '../apps/server/reports.js';
import { validateAnalysis, type AnalysisInput } from '../apps/server/analysis.js';
import type { AnalysisRun } from '../packages/contracts/analysis.js';
import { createSandbox } from './support.js';

test('Beijing midnight/09:00 scheduling and cited day provenance keep independent themes uncertain', () => {
  assert.equal(beijingDate(new Date('2026-09-29T15:59:59Z')), '2026-09-29');
  assert.equal(beijingDate(new Date('2026-09-29T16:00:00Z')), '2026-09-30');
  assert.equal(dueReportDate(new Date('2026-09-30T00:59:59Z')), null);
  assert.equal(dueReportDate(new Date('2026-09-30T01:00:00Z')), '2026-09-29');
  assert.equal(dueReportDate(new Date('2026-01-01T01:00:00Z')), '2025-12-31');
  assert.throws(() => reportDate.parse('2026-02-30'));
  const employeeId = randomUUID(); const snapshotId = randomUUID();
  const input: AnalysisInput = { snapshotId, hash: 'a'.repeat(64), source: 'codex-cli', sourceVersion: '0.157.1', parserVersion: 'codex-jsonl-3', eventCount: 4,
    events: ['前日背景', '主题一', '主题二', '翌日活动'].map((text, index) => ({ line: index + 1, role: 'user', text, timestamp: null,
      origin: { eventId: `e${index}`, snapshotId, line: index + 1, block: 0, employeeId, employee: '合成员工', deviceId: randomUUID(), project: '/p',
        context: 'after-enrollment', sourceDate: index === 0 ? '2026-09-29' : index === 3 ? '2026-10-01' : '2026-09-30' } })),
    coverage: { unrecognizedLines: 0, partialLine: false, excludedMaterials: 0, captureGaps: [], scope: 'synthetic' } };
  const citation = (event: number) => ({ event, textOffset: 0, quote: input.events[event]!.text });
  input.events[0]!.origin!.context = 'historical';
  input.events[0]!.origin!.materialId = 'original-parent';
  input.events[0]!.origin!.location = { kind: 'material', materialId: 'original-parent', textOffset: 123 };
  const result = validateAnalysis(input, { items: [
    { category: 'topic', assessment: 'inferred', text: '主题一', citations: [citation(1)] },
    { category: 'topic', assessment: 'inferred', text: '主题二', citations: [citation(2)] },
    { category: 'goal', assessment: 'claimed', text: '背景目标', citations: [citation(0)] },
    { category: 'activity', assessment: 'inferred', text: '当前与背景共同说明', citations: [citation(1), citation(0)] },
    { category: 'next', assessment: 'claimed', text: '未来事实不回填本日', citations: [citation(3)] },
  ] });
  const run = { id: randomUUID(), state: 'succeeded', result: { items: result, fixture: true } } as AnalysisRun;
  run.input = input;
  assert.equal(reportRunCoverage(run).incomplete, false);
  const longRun = { ...run, result: { ...run.result!, processing: { version: 'original-utf16-1', complete: false, aggregation: 'limited',
    omittedFindings: 3, ranges: [{ state: 'extracted' }, { state: 'failed' }, { state: 'skipped' }] } } } as AnalysisRun;
  assert.equal(reportRunCoverage(longRun).incomplete, true);
  assert.equal(reportRunCoverage(longRun).processingScope!.failedRanges, 1);
  assert.equal(reportRunCoverage(longRun).processingScope!.omittedFindings, 3);
  const items = dailyItems([run], employeeId, '2026-09-30', new Set(['e1', 'e2']));
  assert.equal(items.length, 3); const mixed = items.find(item => item.category === 'activity')!;
  assert.equal(mixed.themeAssociation, 'unassigned'); assert.equal(mixed.backgroundCitations.length, 1);
  assert.deepEqual(mixed.backgroundCitations[0]!.location, { kind: 'material', materialId: 'original-parent', textOffset: 123 });
  assert.deepEqual(mixed.activityEventIds, ['e1']);
  assert.equal(dailyItems([run], randomUUID(), '2026-09-30', new Set(['e1'])).length, 0);
  input.events[1]!.origin!.context = 'historical';
  const contextRun = { ...run, result: { ...run.result!, items: validateAnalysis(input, { items: [{ category: 'activity', assessment: 'claimed', text: '保存材料不是活动', citations: [citation(1)] }] }) } };
  assert.equal(dailyItems([contextRun], employeeId, '2026-09-30', new Set(['e1'])).length, 0);
});

test('public report reads authenticate and reject invalid/future/pre-enrollment dates without fabricated empty reports', { timeout: 60000 }, async () => {
  const sandbox = await createSandbox();
  try {
    const employee = await sandbox.provision('合成日报读者'); const origin = await sandbox.startServer();
    const path = `/api/daily-reports/${employee.employeeId}/${beijingDate()}`;
    assert.equal((await fetch(origin + path)).status, 401);
    const headers = { Authorization: `Bearer ${employee.readerCredential}`, 'Content-Type': 'application/json' };
    const empty = await (await fetch(origin + path, { headers })).json();
    assert.equal(empty.state, 'not-scheduled'); assert.equal(empty.statistics, null);
    assert.equal((await fetch(origin + path, { method: 'POST', headers, body: '{}' })).status, 422);
    assert.equal((await fetch(origin + path.replace(beijingDate(), '2099-01-01'), { method: 'POST', headers, body: '{}' })).status, 422);
    assert.equal((await fetch(origin + path, { method: 'POST', headers, body: '{"trigger":"scheduled"}' })).status, 400);
    assert.equal((await fetch(origin + path + '?revision=99', { headers })).status, 404);
    assert.equal((await fetch(origin + path.replace(beijingDate(), '2026-02-30'), { headers })).status, 400);
    assert.equal((await fetch(origin + '/health')).status, 200);
  } finally { await sandbox.close(); }
});

test('eight simultaneous employee report requests queue durably without exhausting the shared analysis connection pool', { timeout: 60000 }, async () => {
  const sandbox = await createSandbox();
  try {
    const origin = await sandbox.startServer(); const employees = [];
    for (let index = 0; index < 8; index++) {
      const employee = await sandbox.provision(`并发日报${index}`); employees.push(employee);
      assert.equal((await fetch(`${origin}/api/devices/enroll`, { method: 'POST', headers: { Authorization: `Bearer ${employee.enrollmentCredential}`,
        'Content-Type': 'application/json' }, body: JSON.stringify({ installationId: randomUUID(), name: 'synthetic concurrent' }) })).status, 200);
    }
    const headers = { Authorization: `Bearer ${employees[0].readerCredential}`, 'Content-Type': 'application/json' };
    const responses = await Promise.all(employees.map(employee => fetch(`${origin}/api/daily-reports/${employee.employeeId}/${beijingDate()}`,
      { method: 'POST', headers, body: '{}', signal: AbortSignal.timeout(15000) })));
    assert.ok(responses.every(response => response.status === 202));
    const first = await Promise.all(responses.map(response => response.json()));
    assert.ok(first.every(report => ['queued', 'ready'].includes(report.state)));
    for (let attempt = 0; attempt < 40; attempt++) {
      const reports = await Promise.all(employees.map(employee => fetch(`${origin}/api/daily-reports/${employee.employeeId}/${beijingDate()}`, { headers }).then(response => response.json())));
      if (reports.every(report => report.state === 'ready' && !report.refreshPending)) {
        assert.ok(reports.every(report => report.statistics.records === 0 && report.coverage.dailyDeviceCoverage === 'unknown'
          && report.coverage.messages.some((message: string) => message.includes('不代表无活动')))); return;
      }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert.fail('durable queued employee periods did not drain');
  } finally { await sandbox.close(); }
});
