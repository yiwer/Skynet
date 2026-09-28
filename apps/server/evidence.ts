import type { EvidenceLine } from '../../packages/contracts/archive.js';

export function readEvidence(bytes: Buffer) {
  const lines = bytes.toString('utf8').split('\n');
  const partialLine = lines.pop()!;
  const events: EvidenceLine[] = [];
  let unrecognizedLines = 0;
  for (const [index, line] of lines.entries()) {
    if (!line.trim()) continue;
    try {
      const item = JSON.parse(line);
      const payload = item.payload;
      let role: string | undefined;
      let text: string | undefined;
      if (item.type === 'response_item' && payload?.type === 'message') {
        role = String(payload.role);
        text = (Array.isArray(payload.content) ? payload.content : [])
          .filter((part: { text?: unknown }) => typeof part.text === 'string')
          .map((part: { text: string }) => part.text).join('\n');
      } else if (item.type === 'response_item' && payload?.type === 'function_call') {
        role = 'tool request'; text = `${payload.name}\n${payload.arguments}`;
      } else if (item.type === 'response_item' && payload?.type === 'function_call_output') {
        role = 'tool result'; text = typeof payload.output === 'string' ? payload.output : JSON.stringify(payload.output);
      } else if (item.type !== 'session_meta') unrecognizedLines++;
      if (role && text) events.push({ line: index + 1, role, text, timestamp: typeof item.timestamp === 'string' ? item.timestamp : null });
    } catch { unrecognizedLines++; }
  }
  return { parserVersion: 'codex-jsonl-1', events, unrecognizedLines, partialLine: partialLine.length > 0 };
}
