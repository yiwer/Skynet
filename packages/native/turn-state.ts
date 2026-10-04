import { sourceTimestamp, type Source } from '../contracts/archive.js';
import { completeOriginalLines } from './raw-lines.js';

export interface NativeTurnState {
  state: 'in-progress' | 'waiting-input' | 'interrupted' | 'unknown';
  turnId?: string; line?: number; timestamp?: string;
}

/** Codex 0.160.0 EventMsg: task_* are wire names for TurnStarted/TurnComplete.
 * This is the observed turn state at this immutable snapshot, never session closure. */
export function readNativeTurnState(bytes: Buffer, source: Source): NativeTurnState {
  if (source === 'claude-code-cli') return { state: 'unknown' };
  const active = new Map<string, NativeTurnState>();
  let latest: NativeTurnState = { state: 'unknown' };
  for (const { line, text } of completeOriginalLines(bytes)) {
    if (!text?.trim()) continue;
    let row: any;
    try { row = JSON.parse(text); } catch { continue; }
    if (row?.type !== 'event_msg' || !row.payload || typeof row.payload !== 'object') continue;
    const event = row.payload;
    if (!['task_started', 'turn_started', 'task_complete', 'turn_complete', 'turn_aborted'].includes(event.type)) continue;
    const turnId = typeof event.turn_id === 'string' && event.turn_id.length > 0 && event.turn_id.length <= 256 ? event.turn_id : undefined;
    const timestamp = typeof row.timestamp === 'string' && row.timestamp.length <= 64 ? sourceTimestamp(row.timestamp) : null;
    if (!turnId) { active.clear(); latest = { state: 'unknown', line, ...(timestamp ? { timestamp } : {}) }; continue; }
    const state = event.type.endsWith('started') ? 'in-progress' : event.type === 'turn_aborted' ? 'interrupted' : 'waiting-input';
    latest = { state, turnId, line, ...(timestamp ? { timestamp } : {}) };
    if (state === 'in-progress') active.set(turnId, latest); else active.delete(turnId);
  }
  return [...active.values()].at(-1) ?? latest;
}
