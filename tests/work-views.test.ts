import test from 'node:test';
import assert from 'node:assert/strict';
import { addDays, dueWeek, monday, weekDate } from '../packages/contracts/work-views.js';
import { workViewsPublic } from './work-views-public.js';
test('weekly Beijing Monday 09:00 and year boundary use the previous Monday–Sunday', () => {
  assert.equal(monday('2026-09-30'), '2026-09-28');
  assert.equal(dueWeek(new Date('2026-10-05T00:59:59Z')), '2026-09-21');
  assert.equal(dueWeek(new Date('2026-10-05T01:00:00Z')), '2026-09-28');
  assert.equal(dueWeek(new Date('2026-10-06T01:00:00Z')), '2026-09-28');
  assert.equal(dueWeek(new Date('2027-01-04T01:00:00Z')), '2026-12-28');
  assert.equal(addDays('2026-12-28', 6), '2027-01-03');
  assert.throws(() => weekDate.parse('2026-10-04'));
});
test('public cross-week and multi-employee project views freeze daily evidence through Web/MCP/restart', { timeout: 120000 }, () => workViewsPublic(false));
