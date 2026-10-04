import { sourceTimestamp, type Source } from '../contracts/archive.js';
import { completeOriginalLines } from './raw-lines.js';

export interface TurnBoundary { line: number; kind: 'started' | 'completed' | 'interrupted'; turnId: string | null; timestamp: string | null }
const time = (value: unknown) => typeof value === 'string' && value.length <= 64 ? sourceTimestamp(value) : null;
/** Codex v0.160.0 rollout policy persists these turn events. Permission decisions
 * are deliberately absent: a protocol type alone does not establish raw support. */
export function nativeTurnBoundaries(bytes: Buffer, source: Source): TurnBoundary[] {
  if (source === 'claude-code-cli') return [];
  const boundaries: TurnBoundary[] = [];
  for (const { line, text } of completeOriginalLines(bytes)) {
    if (!text?.trim()) continue;
    let row: any; try { row = JSON.parse(text); } catch { continue; }
    if (row?.type !== 'event_msg' || !row.payload || typeof row.payload !== 'object') continue;
    const event = row.payload;
    const kind = ['task_started', 'turn_started'].includes(event.type) ? 'started'
      : ['task_complete', 'turn_complete'].includes(event.type) ? 'completed' : event.type === 'turn_aborted' ? 'interrupted' : null;
    if (!kind) continue;
    const turnId = typeof event.turn_id === 'string' && event.turn_id.length > 0 && event.turn_id.length <= 256 ? event.turn_id : null;
    const recorded = event.completed_at;
    const completionTime = kind === 'completed' && typeof recorded === 'number' && Number.isFinite(recorded) && Math.abs(recorded * 1000) <= 8.64e15
      ? new Date(recorded * 1000).toISOString() : kind === 'completed' ? time(recorded) : null;
    boundaries.push({ line, kind, turnId, timestamp: completionTime ?? time(row.timestamp) });
  }
  return boundaries;
}
