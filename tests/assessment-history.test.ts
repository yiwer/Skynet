import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { assessmentFixture } from './assessment-fixture.js';
import { digest } from '../apps/server/database.js';

test('an assessment cannot treat a truncated prefix or its later append as a known first prompt', { timeout: 180_000 }, async () => {
  const fixture = await assessmentFixture();
  try {
    const owner = await fixture.owner('前缀缺失评估');
    for (let i = 0; i < 2; i++) await fixture.session(owner, { prompts: 3 });
    const native = fixture.rows({ prompts: 3 }), generation = digest(Buffer.from('assessment-truncated-prefix'));
    const capture = { generation, revision: 2, change: 'truncate', materials: [], lineage: [], gaps: [], compacted: false, partialLine: false };
    const truncated = await fixture.upload(owner, native.rows, native.sessionId, { capture });
    await fixture.analyze(owner, truncated.snapshotId);
    const path = '/api/assessments/' + owner.employeeId, response = await fixture.api(owner, path);
    assert.equal(response.status, 200, await response.clone().text());
    const value = await response.json();
    assert.equal(value.sample.sessions, 3); assert.equal(value.sample.prompts, 9);
    for (const key of ['elem', 'rework', 'clean']) {
      const metric = Object.values(value.dims).flatMap((dim: any) => dim.metrics).find((metric: any) => metric.key === key) as any;
      assert.equal(metric.state, 'unknown', `${key} cannot use an invented first-prompt boundary`);
      assert.equal(metric.value, null); assert.equal(metric.score, null);
    }
    assert.equal(value.dims.prompt.metrics.find((metric: any) => metric.key === 'elem').samples, 2, 'only proven first prompts count as known samples');
    const at = new Date(fixture.base.getTime() + 6000).toISOString();
    const appended = [...native.rows,
      { type: 'response_item', timestamp: at, payload: { type: 'message', id: randomUUID(), role: 'user', content: [{ type: 'input_text', text: '继续剩余任务 elements=3' }] } },
      { type: 'event_msg', timestamp: at, payload: { type: 'task_started', turn_id: 'continued-turn' } },
      { type: 'response_item', timestamp: at, payload: { type: 'message', id: randomUUID(), role: 'assistant', content: [{ type: 'output_text', text: '继续完成' }] } },
      { type: 'event_msg', timestamp: at, payload: { type: 'task_complete', turn_id: 'continued-turn' } }];
    const continuation = await fixture.upload(owner, appended, native.sessionId, { capture: { ...capture, revision: 3, change: 'append', previousSnapshotId: truncated.snapshotId } });
    await fixture.analyze(owner, continuation.snapshotId);
    const current = await (await fixture.api(owner, path)).json();
    assert.equal(current.sample.sessions, 3); assert.equal(current.sample.prompts, 10);
    for (const key of ['elem', 'rework', 'clean']) assert.equal(Object.values(current.dims).flatMap((dim: any) => dim.metrics).find((metric: any) => metric.key === key).state, 'unknown');
    assert.deepEqual(await (await fixture.api(owner, path + '?version=' + value.version)).json(), value);
    assert.deepEqual(await (await fixture.api(owner, path + '/recompute', {})).json(), current);
  } finally { await fixture.close(); }
});
