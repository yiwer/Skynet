import { open, readdir, realpath, unlink, mkdir } from 'node:fs/promises';
import { join, relative, isAbsolute, sep } from 'node:path';
import { atomicJson } from '../../packages/filesystem.js';
import { hostEventSchema } from '../../packages/contracts/archive.js';
import { jsonFile, optionalJson, type Installation } from './install-state.js';

async function nativeMetadata(path: string) {
  const handle = await open(path, 'r');
  try {
    // Most first lines fit in one page. Grow only for a long metadata line,
    // retaining the original one MiB ceiling and rereading on every attempt.
    let buffer = Buffer.alloc(4096), length = 0;
    while (length < 1024 * 1024) {
      const before = length;
      length += (await handle.read(buffer, length, buffer.length - length, length)).bytesRead;
      const end = buffer.indexOf(10, before);
      if (end >= 0 && end < length) return JSON.parse(buffer.subarray(0, end).toString('utf8'));
      if (length === before) break;
      if (length === buffer.length && length < 1024 * 1024) {
        const expanded = Buffer.alloc(Math.min(buffer.length * 2, 1024 * 1024));
        buffer.copy(expanded, 0, 0, length); buffer = expanded;
      }
    }
    throw new Error('Native metadata is incomplete or exceeds the routing limit');
  } finally { await handle.close(); }
}

/** Scheduling state contains names only. Every attempt rereads the hook and
 * source metadata; an unknown source is never a cached routing decision. */
export function codexRouting(state: string) {
  const directory = join(state, 'inbox', 'codex'), spool = join(directory, 'spool'), checkpoint = join(directory, 'routing.json');
  let seen: Set<string> | undefined, cursor: string | undefined;
  let older: string[] = [];
  const fresh = new Set<string>();
  return async (installation: Installation) => {
    if (!installation.clients.some(client => client.source !== 'claude-code-cli' && client.configured)) return null;
    await mkdir(spool, { recursive: true, mode: 0o700 });
    const files = (await readdir(spool)).filter(file => file.endsWith('.json')).sort(), present = new Set(files);
    if (seen) for (const file of files) { if (!seen.has(file)) fresh.add(file); }
    else {
      // A torn derived checkpoint must not strand the retained source events.
      // Keep real I/O failures visible; only malformed JSON can be reset here.
      let saved;
      try { saved = await optionalJson(checkpoint); }
      catch (error) { if (!(error instanceof SyntaxError)) throw error; }
      if (saved?.version === 1 && typeof saved.cursor === 'string') cursor = saved.cursor;
      // A checkpoint is a position, never a path to open. Only names from this
      // enumeration enter either queue, including when a saved file was deleted.
      const start = cursor === undefined ? 0 : files.findIndex(file => file > cursor!);
      older = start > 0 ? [...files.slice(start), ...files.slice(0, start)] : files;
    }
    seen = present;
    for (const file of fresh) if (!present.has(file)) fresh.delete(file);
    older = older.filter(file => present.has(file));
    const incoming = [...fresh].slice(0, 256 - Math.min(128, older.length));
    const retry = older.splice(0, 256 - incoming.length), errors: string[] = [];
    let routed = 0;
    for (const file of [...incoming, ...retry]) {
      try {
        const queued = await jsonFile(join(spool, file)); const event = hostEventSchema.parse(queued.event);
        const root = installation.clients.find(client => client.source === 'codex-cli')!.nativeRoot;
        const actual = await realpath(event.transcript_path); const remainder = relative(await realpath(root), actual);
        if (!remainder || remainder === '..' || remainder.startsWith(`..${sep}`) || isAbsolute(remainder) || !actual.endsWith('.jsonl')) throw new Error('Codex activity points outside its native root');
        const metadata = await nativeMetadata(actual);
        if (metadata.type !== 'session_meta' || metadata.payload?.id !== event.session_id) throw new Error('Native session identity mismatch');
        // Only the measured Codex CLI pairs are accepted, including daemon TUI.
        const source = (metadata.payload.source === 'exec' && metadata.payload.originator === 'codex_exec')
          || (['cli', 'vscode'].includes(metadata.payload.source) && metadata.payload.originator === 'codex-tui') ? 'codex-cli' : null;
        if (!source) throw new Error('Codex origin is not yet verified; activity is queued without guessing CLI or Desktop');
        if (!installation.clients.some(client => client.source === source && client.configured)) throw new Error('The observed Codex source has not been configured');
        await atomicJson(join(state, 'sources', source, 'spool', file), queued); await unlink(join(spool, file));
        routed++;
      } catch (error) {
        errors.push((error as Error).message);
        // Rejected new arrivals join the tail, never jump ahead of an old hook.
        older.push(file);
      }
      fresh.delete(file);
    }
    if (retry.length) {
      cursor = retry.at(-1)!;
      await atomicJson(checkpoint, { version: 1, cursor });
    }
    return { errors, status: { scope: 'last-batch' as const, observed: files.length,
      attempted: incoming.length + retry.length, deferred: files.length - incoming.length - retry.length,
      newAttempts: incoming.length, retryAttempts: retry.length, routed, failed: errors.length } };
  };
}
