import test from 'node:test';
import assert from 'node:assert/strict';
import { registerTask, type TaskRegistration } from '../apps/collector/autostart-registration.js';

const previous: TaskRegistration = { state: 'registered', adapter: 'windows-user-task', taskName: 'Skynet-owned',
  command: 'powershell.exe', arguments: 'known-legacy-hidden-action', description: 'owned fixture',
  checkedAt: '2026-09-30T00:00:00.000Z', lifecycle: { login: 'not-verified' } };
const next = { ...previous, state: 'registering', arguments: 'new-no-console-action' };
function fixture(initial: TaskRegistration | null) {
  let os = initial && { ...initial }; let persisted = structuredClone(previous);
  const saved: TaskRegistration[] = []; const events: string[] = [];
  return {
    get os() { return os; }, get persisted() { return persisted; }, saved, events,
    actions: {
      async task(mode: 'register' | 'remove', registration: TaskRegistration) {
        events.push(`${mode}:${registration.arguments}`);
        if (os && ['taskName', 'command', 'arguments', 'description'].some(key =>
          os![key as keyof TaskRegistration] !== registration[key as keyof TaskRegistration])) throw new Error('OS ownership conflict');
        if (mode === 'remove') os = null;
        else if (!os) os = { ...registration };
      },
      async save(value: TaskRegistration) { saved.push(value); persisted = structuredClone(value); },
    },
  };
}

test('exact old owned task becomes hidden action after OS ownership validation', async () => {
  const f = fixture(previous);
  const result = await registerTask(previous, next, previous.arguments!, f.actions);
  assert.equal(result.state, 'registered'); assert.equal(f.os?.arguments, next.arguments);
  assert.equal(f.persisted.arguments, next.arguments);
  assert.deepEqual(f.events, [`register:${next.arguments}`, `remove:${previous.arguments}`, `register:${next.arguments}`]);
  assert.equal(f.saved.length, 1);
});

test('changed task cannot be removed and leaves original metadata intact', async () => {
  const changed = { ...previous, arguments: 'user-edited-action' }; const f = fixture(changed);
  const result = await registerTask(previous, next, previous.arguments!, f.actions);
  assert.equal(result.state, 'degraded'); assert.deepEqual(f.os, changed);
  assert.deepEqual(f.persisted, previous); assert.equal(f.saved.length, 0);
});

test('unknown previous metadata is retained without invoking OS mutation', async () => {
  const unknown = { ...previous, arguments: 'unrecognized-action' }; const f = fixture(unknown);
  const result = await registerTask(unknown, next, previous.arguments!, f.actions);
  assert.equal(result.state, 'degraded'); assert.deepEqual(f.os, unknown);
  assert.equal(f.saved.length, 0); assert.equal(f.events.length, 0);
});

test('repair accepts exact new task after interrupted metadata commit', async () => {
  const f = fixture(next);
  const result = await registerTask(previous, next, previous.arguments!, f.actions);
  assert.equal(result.state, 'registered'); assert.equal(f.persisted.arguments, next.arguments);
  assert.deepEqual(f.events, [`register:${next.arguments}`]);
});

test('metadata commit failure is surfaced and exact new task remains repairable', async () => {
  const f = fixture(previous);
  await assert.rejects(registerTask(previous, next, previous.arguments!, { ...f.actions,
    save: async () => { throw new Error('metadata write interrupted'); } }), /metadata write interrupted/);
  assert.equal(f.os?.arguments, next.arguments); assert.deepEqual(f.persisted, previous);
  const repaired = await registerTask(previous, next, previous.arguments!, f.actions);
  assert.equal(repaired.state, 'registered'); assert.equal(f.persisted.arguments, next.arguments);
});
