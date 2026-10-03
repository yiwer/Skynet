import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { DatabaseSync } from 'node:sqlite';
import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { Material } from '../../packages/contracts/materials.js';

const rowSchema = z.object({ id: z.uuid(), thread_id: z.uuid(), attachment_type: z.string().min(1).max(256),
  identity_key: z.string().min(1).max(1024), payload: z.string().max(1024 * 1024),
  created_at: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) }).strict();
export type AttachmentRow = z.infer<typeof rowSchema>;

// Row reconstruction preserves opaque JSON only. It never follows a payload's
// external paths/URLs or promises that Desktop understands custom record types.
export function attachmentRows(materials: { material: Material; bytes: Buffer }[], owners: Set<string>) {
  const rows: AttachmentRow[] = []; const ids = new Set<string>(); const keys = new Set<string>();
  for (const { material, bytes } of materials.filter(item => item.material.placement === 'codex-attachments')) {
    if (material.role !== 'attachment' || !material.sourceSessionId || !owners.has(material.sourceSessionId)) throw new Error('Attachment owner rollout is missing; no files were changed');
    let parsed: AttachmentRow[];
    try { parsed = z.array(rowSchema).max(128).parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))); }
    catch { throw new Error('Malformed native attachment rows; no files were changed'); }
    for (const row of parsed) {
      if (row.thread_id !== material.sourceSessionId || !owners.has(row.thread_id)) throw new Error('Attachment row owner does not match its archived material');
      try { JSON.parse(row.payload); } catch { throw new Error('Attachment payload is not JSON; native reconstruction is unsupported'); }
      const key = JSON.stringify([row.thread_id, row.attachment_type, row.identity_key]);
      if (ids.has(row.id) || keys.has(key)) throw new Error('Conflicting native attachment identities');
      ids.add(row.id); keys.add(key); rows.push(row);
      if (rows.length > 128) throw new Error('Native attachment reconstruction exceeds 128 records');
    }
  }
  return rows;
}

async function nativeIndex(target: string, runtime: string, owners: Set<string>) {
  // No inherited model keys, provider config, user profile, hooks or workspace.
  const env: NodeJS.ProcessEnv = Object.fromEntries(['SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT', 'PATH', 'ProgramFiles',
    'ProgramFiles(x86)', 'ProgramData'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
  Object.assign(env, { CODEX_HOME: target, USERPROFILE: target, HOME: target, APPDATA: target, LOCALAPPDATA: target, TEMP: target, TMP: target });
  const child = spawn(runtime, ['-c', 'analytics.enabled=false', '-c', 'feedback.enabled=false', '-c', 'model_provider="skynet-restore"', '-c', 'model="skynet-offline-restore"', '-c', 'model_providers.skynet-restore={name="Offline restore only",base_url="http://127.0.0.1:1",wire_api="responses",requires_openai_auth=false}', 'app-server', '--stdio'], { env, cwd: target, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const pending = new Map<number, { resolve: (item: any) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  let id = 0; let outputBytes = 0; let failed: Error | undefined;
  const fail = (error: Error) => { failed = error; for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error); } pending.clear(); };
  child.stderr.resume();
  createInterface({ input: child.stdout }).on('line', line => {
    outputBytes += Buffer.byteLength(line);
    if (outputBytes > 8 * 1024 * 1024) { fail(new Error('Native reconstruction exceeded its response bound')); child.kill(); return; }
    try {
      const message = JSON.parse(line); const item = pending.get(message.id);
      if (!message.method && item) { clearTimeout(item.timer); pending.delete(message.id); message.error ? item.reject(new Error(`Native runtime rejected archived thread indexing (code ${message.error.code})`)) : item.resolve(message.result); }
    } catch { fail(new Error('Invalid native reconstruction response')); child.kill(); }
  });
  child.on('error', () => fail(new Error('Native reconstruction process could not start')));
  child.on('exit', () => fail(new Error('Native reconstruction process exited')));
  const rpc = (method: string, params: unknown) => new Promise<any>((resolve, reject) => {
    if (failed) { reject(failed); return; }
    const requestId = ++id;
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error('Native reconstruction request timed out')); }, 20_000);
    pending.set(requestId, { resolve, reject, timer }); child.stdin.write(JSON.stringify({ id: requestId, method, params }) + '\n');
  });
  try {
    await rpc('initialize', { clientInfo: { name: 'skynet_attachment_restore', version: '1' }, capabilities: { experimentalApi: true } });
    child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
    await rpc('thread/list', { modelProviders: [], sourceKinds: ['cli', 'vscode', 'exec', 'appServer', 'unknown'], limit: 100 });
    // Only explicitly archived owners are indexed; no turn/start or provider call.
    for (const threadId of owners) {
      const result = await rpc('thread/read', { threadId, includeTurns: false });
      if (result.thread?.id !== threadId) throw new Error('Native reconstructed owner identity mismatch');
    }
  } finally {
    if (child.pid !== undefined && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit'); child.stdin.end(); const timer = setTimeout(() => child.kill(), 3000);
      try { await exited; } finally { clearTimeout(timer); }
    }
  }
}

function schemaMatches(db: DatabaseSync) {
  const expected = [ ['id', 'TEXT', 0, 1], ['thread_id', 'TEXT', 1, 0], ['attachment_type', 'TEXT', 1, 0],
    ['identity_key', 'TEXT', 1, 0], ['payload', 'TEXT', 1, 0], ['created_at', 'INTEGER', 1, 0] ];
  const columns = db.prepare('PRAGMA table_info(thread_attachments)').all().map(row => [row.name, row.type, row.notnull, row.pk]);
  if (JSON.stringify(columns) !== JSON.stringify(expected)) throw new Error('Unsupported native attachment database schema');
  const foreign = db.prepare('PRAGMA foreign_key_list(thread_attachments)').all();
  if (foreign.length !== 1 || foreign[0]!.table !== 'threads' || foreign[0]!.from !== 'thread_id'
    || foreign[0]!.to !== 'id' || foreign[0]!.on_delete !== 'CASCADE') throw new Error('Unsupported native attachment owner constraint');
  const unique = db.prepare('PRAGMA index_list(thread_attachments)').all().filter(row => row.unique === 1 && row.partial === 0);
  const hasKey = unique.some(index => {
    if (typeof index.name !== 'string' || !/^[a-zA-Z0-9_]+$/.test(index.name)) return false;
    return JSON.stringify(db.prepare(`PRAGMA index_info("${index.name}")`).all().map(row => row.name)) === JSON.stringify(['thread_id', 'attachment_type', 'identity_key']);
  });
  if (!hasKey) throw new Error('Unsupported native attachment uniqueness constraint');
  if (db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='thread_attachments'").all().length) throw new Error('Unsupported native attachment database triggers');
}

export async function reconstructAttachments(target: string, runtime: string, rows: AttachmentRow[], owners: Set<string>) {
  if (!rows.length) return;
  // restorePackage exclusively created this target and its durable incomplete marker.
  // A crash/error leaves that marker and no success receipt, never a reusable live home.
  const marker = await lstat(join(target, '.skynet-restore-incomplete'));
  if (!marker.isFile() || marker.isSymbolicLink()) throw new Error('New restore target ownership marker is missing');
  await nativeIndex(target, runtime, owners); // Must fully exit before SQLite mutation.
  const files = (await readdir(target)).filter(name => /^state_\d+\.sqlite$/.test(name));
  if (files.length !== 1 || files[0] !== 'state_5.sqlite') throw new Error('Unsupported native state database version');
  const path = join(target, files[0]); const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('Unsafe native state database');
  const db = new DatabaseSync(path, { timeout: 1000 });
  try {
    db.exec('PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; BEGIN IMMEDIATE');
    schemaMatches(db);
    if (db.prepare('SELECT count(*) AS count FROM thread_attachments').get()!.count !== 0) throw new Error('New native database contains unexpected attachments');
    for (const row of rows) {
      if (!db.prepare('SELECT id FROM threads WHERE id=?').get(row.thread_id)) throw new Error('Native attachment owner was not reconstructed');
      db.prepare('INSERT INTO thread_attachments(id,thread_id,attachment_type,identity_key,payload,created_at) VALUES(?,?,?,?,?,?)')
        .run(row.id, row.thread_id, row.attachment_type, row.identity_key, row.payload, row.created_at);
      const saved = db.prepare('SELECT id,thread_id,attachment_type,identity_key,payload,created_at FROM thread_attachments WHERE id=?').get(row.id);
      if (JSON.stringify(saved) !== JSON.stringify(row)) throw new Error('Native attachment row readback mismatch');
    }
    if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Native attachment owner integrity failed');
    db.exec('COMMIT; PRAGMA wal_checkpoint(TRUNCATE)');
  } catch (error) { if (db.isTransaction) db.exec('ROLLBACK'); throw error; }
  finally { db.close(); }
  // sqlite FULL synchronous + checkpoint closes its own writes; archive bytes remain portable.
}
