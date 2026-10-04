import type { EvidenceLine } from '../contracts/archive.js';

/** Codex rust-v0.160.0 protocol + rollout policy. This recognizes metadata,
 * never unsupported business/tool formats. Legacy message echoes require an
 * already parsed, identical response message and consume it once. */
export function codexAuxiliaryReader(events: EvidenceLine[]) {
  const messages = new Map<string, number>();
  for (const event of events) if (['user','assistant'].includes(event.role)) {
    const key = JSON.stringify([event.role,event.text]); messages.set(key,(messages.get(key)??0)+1);
  }
  return (row: any): boolean => {
    const p = row?.payload;
    if (!p || typeof p !== 'object' || Array.isArray(p)) return false;
    if (row.type === 'turn_context') return typeof p.cwd === 'string' && typeof p.model === 'string';
    if (row.type === 'response_item' && p.type === 'reasoning') return Array.isArray(p.summary)
      && p.summary.every((part:any) => part?.type === 'summary_text' && typeof part.text === 'string')
      && (p.encrypted_content == null || typeof p.encrypted_content === 'string');
    if (row.type !== 'event_msg') return false;
    if (p.type === 'token_count') return p.info === null || p.info && typeof p.info === 'object' && !Array.isArray(p.info)
      && p.info.total_token_usage && typeof p.info.total_token_usage === 'object' && !Array.isArray(p.info.total_token_usage);
    if (['task_started','turn_started','task_complete','turn_complete','turn_aborted'].includes(p.type)) return typeof p.turn_id === 'string' && p.turn_id.length > 0;
    if (['agent_reasoning','agent_reasoning_raw_content'].includes(p.type)) return typeof p.text === 'string';
    if (['user_message','agent_message'].includes(p.type) && typeof p.message === 'string') {
      if (p.type === 'user_message' && (Array.isArray(p.images) && p.images.length || Array.isArray(p.local_images) && p.local_images.length)) return false;
      const key = JSON.stringify([p.type === 'user_message' ? 'user' : 'assistant',p.message]), count=messages.get(key)??0;
      if (count > 0) { messages.set(key,count-1); return true; }
    }
    return false;
  };
}
