import { createHash } from 'node:crypto';
import type { Manifest, Source } from './contracts/archive.js';
import { sourceTimestamp } from './contracts/archive.js';

export const statisticsExtractorVersion = 'native-recorded-statistics-2';
export type TokenComponents = { input: number | null; cachedInput: number | null; cacheWriteInput: number | null;
  output: number | null; reasoningOutput: number | null; total: number | null };
export type NativeUsage = { key: string; line: number; timestamp: string | null; value: TokenComponents | null };
export type NativeFile = { line: number; block: number; paths: string[]; supported: boolean };
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const number = (value: unknown): number | null => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
const empty = (): TokenComponents => ({ input: null, cachedInput: null, cacheWriteInput: null, output: null, reasoningOutput: null, total: null });
const path = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 1024 && !/[\x00-\x1f]/.test(value);

// Auxiliary rows do not become business EvidenceLine events. Invalid UTF-8 is
// rejected rather than inventing replacement characters as verbatim evidence.
export function codexInitialBaseline(bytes: Buffer, manifest: Manifest): boolean {
  if (manifest.source !== 'codex-cli' || manifest.sourceVersion !== '0.160.0' || !manifest.enrolledAt || manifest.restoredFrom) return false;
  const capture = manifest.capture;
  if (capture && (capture.gaps.length || capture.lineage.length || capture.compacted || capture.partialLine || ['rewrite', 'truncate'].includes(capture.change))) return false;
  try {
    const lines = new TextDecoder('utf-8', { fatal: true }).decode(bytes).split('\n');
    if (lines.pop() !== '') return false;
    const rows = lines.filter(line => line.trim()).map(line => JSON.parse(line));
    const meta = rows[0]?.payload;
    return rows[0]?.type === 'session_meta' && rows.filter(row => row.type === 'session_meta').length === 1
      && meta?.id === manifest.sourceSessionId && meta?.cli_version === manifest.sourceVersion
      && sourceTimestamp(meta.timestamp) !== null && Date.parse(meta.timestamp) >= Date.parse(manifest.enrolledAt)
      && !['forked_from_id', 'forked_from_ordinal_exclusive', 'parent_thread_id', 'history_base', 'subagent_history_start_ordinal'].some(key => meta[key] != null)
      && rows.every(row => row.type !== 'compacted' && !(row.type === 'event_msg' && ['context_compacted', 'thread_rolled_back'].includes(row.payload?.type)));
  } catch { return false; }
}

export function nativeStatistics(bytes: Buffer, source: Source, version: string, options: { codexInitialBaseline?: boolean } = {}) {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const lines = text.split('\n'); const complete = !lines.pop();
  const usage: NativeUsage[] = []; const files: NativeFile[] = [];
  const supported = source === 'claude-code-cli' ? version === '2.1.281' : source === 'codex-cli' && ['0.157.1', '0.160.0'].includes(version);
  let prior: TokenComponents | null = null;
  let observed = false;
  const messages = new Map<string, NativeUsage>();
  for (const [index, raw] of lines.entries()) {
    if (!raw.trim()) continue;
    let row: any; try { row = JSON.parse(raw); } catch { continue; }
    const timestamp = sourceTimestamp(row.timestamp); const line = index + 1;
    if (source !== 'claude-code-cli' && row.type === 'event_msg' && row.payload?.type === 'token_count') {
      const value = row.payload.info?.total_token_usage;
      const current: TokenComponents = { input: number(value?.input_tokens), cachedInput: number(value?.cached_input_tokens),
        cacheWriteInput: number(value?.cache_write_input_tokens), output: number(value?.output_tokens),
        reasoningOutput: number(value?.reasoning_output_tokens), total: number(value?.total_tokens) };
      const required: (keyof TokenComponents)[] = ['input', 'cachedInput', 'output', 'reasoningOutput', 'total'];
      const valid = supported && required.every(key => current[key] !== null)
        && current.cachedInput! <= current.input! && current.reasoningOutput! <= current.output!
        && current.input! + current.output! === current.total!;
      // Only a complete, newly-created, post-enrollment native history may
      // establish the protocol's default zero. A reset never reuses this proof.
      if (!observed && valid && options.codexInitialBaseline) prior = { input: 0, cachedInput: 0, cacheWriteInput: 0, output: 0, reasoningOutput: 0, total: 0 };
      observed = true;
      // Repeated cumulative observations are not new usage. A reset, inconsistent
      // counters or missing predecessor has no fabricated zero baseline.
      if (valid && prior && required.every(key => current[key] === prior![key])) continue;
      let delta: TokenComponents | null = null;
      if (valid && prior && required.every(key => prior![key] !== null && current[key]! >= prior![key]!)) {
        delta = empty();
        for (const key of Object.keys(delta) as (keyof TokenComponents)[]) {
          delta[key] = current[key] !== null && prior[key] !== null && current[key]! >= prior[key]! ? current[key]! - prior[key]! : null;
        }
      }
      usage.push({ key: hash(raw), line, timestamp, value: delta });
      prior = valid ? current : null;
    }
    if (source === 'claude-code-cli' && row.type === 'assistant' && row.message?.usage) {
      const id = row.message.id; const value = row.message.usage;
      const input = number(value.input_tokens); const output = number(value.output_tokens);
      const cachedInput = number(value.cache_read_input_tokens); const cacheWriteInput = number(value.cache_creation_input_tokens);
      const processedInput = input !== null && cachedInput !== null && cacheWriteInput !== null ? input + cachedInput + cacheWriteInput : null;
      const valid = supported && typeof id === 'string' && id.length <= 256 && input !== null && output !== null;
      const item: NativeUsage = { key: valid ? `message:${id}` : hash(raw), line, timestamp,
        value: valid ? { input: processedInput, cachedInput, cacheWriteInput, output, reasoningOutput: null,
          total: processedInput !== null ? processedInput + output! : null } : null };
      const previous = messages.get(item.key);
      if (previous && (previous.timestamp !== item.timestamp || !previous.value || !item.value
        || Object.keys(item.value).some(key => {
          const field = key as keyof TokenComponents;
          return previous.value![field] !== null && item.value![field] !== null && item.value![field]! < previous.value![field]!;
        }))) item.value = null;
      messages.set(item.key, item);
    }
    if (source === 'claude-code-cli' && row.type === 'assistant' && Array.isArray(row.message?.content)) {
      for (const [block, item] of row.message.content.entries()) if (item.type === 'tool_use') {
        const recognized = supported && ['Read', 'Write', 'Edit'].includes(item.name) && path(item.input?.file_path);
        files.push({ line, block, paths: recognized ? [item.input.file_path] : [], supported: recognized });
      }
    }
    if (source !== 'claude-code-cli' && row.type === 'response_item' && ['function_call', 'custom_tool_call'].includes(row.payload?.type)) {
      const call = row.payload; let paths: string[] = []; let recognized = false;
      if (supported && call.type === 'custom_tool_call' && call.name === 'apply_patch' && typeof call.input === 'string'
        && call.input.length <= 512 * 1024 && call.input.startsWith('*** Begin Patch\n') && /\n\*\*\* End Patch\n?$/.test(call.input)) {
        const headers = call.input.split('\n').filter((value: string) => /^\*\*\* (Add|Update|Delete) File: /.test(value));
        paths = headers.map((value: string) => value.replace(/^\*\*\* (Add|Update|Delete) File: /, ''));
        const moves = call.input.split('\n').filter((value: string) => value.startsWith('*** Move to: ')).map((value: string) => value.slice(13));
        paths.push(...moves); recognized = paths.length > 0 && paths.length <= 128 && paths.every(path);
      }
      files.push({ line, block: 0, paths: recognized ? paths : [], supported: recognized });
    }
  }
  usage.push(...messages.values());
  return { usage, files, complete, supported, lineCount: lines.length };
}
