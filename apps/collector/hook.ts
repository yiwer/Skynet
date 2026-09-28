import { mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { atomicJson } from '../../packages/filesystem.js';

// Deliberately independent from enrollment, network, recovery, and schema-library startup.
// Keep these bounds equivalent to hostEventSchema; unknown host fields are retained as data.
export async function recordHook(state: string, value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid host event');
  const event = value as Record<string, unknown>;
  const bounded = (item: unknown, min: number, max: number) => typeof item === 'string' && item.length >= min && item.length <= max;
  if (!['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'Stop', 'SessionEnd'].includes(event.hook_event_name as string)
    || !bounded(event.session_id, 1, 256) || !bounded(event.transcript_path, 1, 4096)
    || (event.cwd !== undefined && !bounded(event.cwd, 0, 4096))) throw new Error('Invalid host event');
  await mkdir(join(state, 'spool'), { recursive: true, mode: 0o700 });
  await atomicJson(join(state, 'spool', `${randomUUID()}.json`), { event, observedAt: new Date().toISOString() });
}

export async function recordHookGap(state: string) {
  await mkdir(state, { recursive: true, mode: 0o700 });
  await atomicJson(join(state, 'hook-gap.json'), { at: new Date().toISOString(), error: 'Host activity could not be queued; check hook input and local storage' });
}
