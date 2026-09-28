import { createHash } from 'node:crypto';
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ARTIFACT_BYTES, COLLECTION_BYTES, materialNameSchema, type Material, type Gap, type Lineage } from '../../packages/contracts/materials.js';
import type { Source } from '../../packages/contracts/archive.js';

const digest = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const forbidden = (name: string) => /^\.?(?:auth|credentials?|settings|config)(?:\.|$)|^\.env(?:\.|$)|^(?:session-env|shell-snapshots|\.npmrc|\.netrc|\.git-credentials)$/i.test(name);
export async function safeNativePath(root: string, candidate: string) {
  const base = await realpath(root);
  const path = resolve(candidate);
  const suffix = relative(base, path);
  if (!suffix || suffix === '..' || suffix.startsWith(`..${sep}`) || isAbsolute(suffix)) throw new Error('unsafe-path');
  let part = base;
  for (const name of suffix.split(sep)) {
    if (forbidden(name)) throw new Error('unsafe-path');
    part = join(part, name);
    if ((await lstat(part)).isSymbolicLink()) throw new Error('unsafe-path');
  }
  if (await realpath(path) !== path) throw new Error('unsafe-path');
  return path;
}
export async function readNativeFile(root: string, candidate: string) {
  const path = await safeNativePath(root, candidate);
  const handle = await open(path, 'r');
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.nlink > 1) throw new Error('unsafe-path');
    if (before.size > ARTIFACT_BYTES) throw new Error('size-limit');
    const bytes = await handle.readFile();
    if (bytes.length > ARTIFACT_BYTES) throw new Error('size-limit');
    await safeNativePath(root, candidate);
    const after = await lstat(path);
    if (after.ino !== before.ino || after.dev !== before.dev) throw new Error('unreadable');
    return bytes;
  } finally { await handle.close(); }
}

export async function discoverMaterials(input: { source: Source; nativeRoot: string; nativeTempRoot?: string; transcriptPath: string;
  sessionId: string; project: string; bytes: Buffer; previous?: Material[] }) {
  const artifacts: { material: Material; bytes?: Buffer }[] = [];
  const gaps: Gap[] = []; const lineage: Lineage[] = [];
  let total = input.bytes.length; let compacted = false;
  const partialLine = input.bytes.length > 0 && input.bytes.at(-1) !== 10;
  if (partialLine) gaps.push({ code: 'partial-line', reference: '当前原件末行尚未闭合；未计为完整事件' });
  const gap = (code: Gap['code'], reference: string) => { if (gaps.length < 255) gaps.push({ code, reference: reference.slice(0, 1024) }); };
  const add = (role: Material['role'], placement: Material['placement'], name: string, bytes: Buffer, sessionId?: string) => {
    if (!materialNameSchema.safeParse(name).success) { gap('unsafe-path', name); return; }
    if (artifacts.length >= 128 || total + bytes.length > COLLECTION_BYTES || bytes.length > ARTIFACT_BYTES) { gap('size-limit', name); return; }
    const id = digest(`${placement}/${name}`);
    if (artifacts.some(item => item.material.id === id)) return id;
    total += bytes.length;
    const mediaType = name.endsWith('.jsonl') ? 'jsonl' : name.endsWith('.json') ? 'json' : /\.(?:txt|md|log|patch)$/.test(name) ? 'text' : 'binary';
    artifacts.push({ material: { id, role, placement, name, sourceSessionId: sessionId, hash: digest(bytes), byteLength: bytes.length, mediaType }, bytes });
    return id;
  };
  const read = async (root: string, path: string, role: Material['role'], placement: Material['placement'], name: string, sessionId?: string) => {
    try { return add(role, placement, name, await readNativeFile(root, path), sessionId); }
    catch (error) { const code = (error as NodeJS.ErrnoException).code; gap(code === 'ENOENT' ? 'missing' : (error as Error).message === 'unsafe-path' ? 'unsafe-path' : (error as Error).message === 'size-limit' ? 'size-limit' : 'unreadable', name); }
  };
  const directory = async (root: string, path: string, role: Material['role'], placement: Material['placement'], prefix: string, optional = true, depth = 0) => {
    if (depth > 8) { gap('size-limit', prefix); return; }
    try {
      await safeNativePath(root, path);
      const entries = await readdir(path, { withFileTypes: true });
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (artifacts.length >= 128) { gap('size-limit', prefix); break; }
        const name = `${prefix}/${entry.name}`;
        if (entry.isSymbolicLink() || forbidden(entry.name)) { gap('unsafe-path', name); continue; }
        if (entry.isDirectory()) await directory(root, join(path, entry.name), role, placement, name, false, depth + 1);
        else if (entry.isFile()) await read(root, join(path, entry.name), role, placement, name, role === 'subagent' ? entry.name.replace(/^agent-/, '').replace(/\.jsonl$/, '') : undefined);
      }
    } catch (error) { if (!(optional && (error as NodeJS.ErrnoException).code === 'ENOENT')) gap((error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : (error as Error).message === 'unsafe-path' ? 'unsafe-path' : 'unreadable', prefix); }
  };
  const records: any[] = [];
  for (const [index, line] of input.bytes.toString('utf8').split('\n').slice(0, -1).entries()) {
    if (!line.trim()) continue;
    try { const item = JSON.parse(line); if (item && typeof item === 'object') records.push(item); else gap('unknown-format', `原件第 ${index + 1} 行`); }
    catch { gap('unknown-format', `原件第 ${index + 1} 行`); }
  }
  if (input.source === 'claude-code-cli') {
    if (/^[a-f0-9-]{36}$/i.test(input.sessionId)) {
      const session = join(dirname(input.transcriptPath), input.sessionId);
      await directory(input.nativeRoot, join(session, 'subagents'), 'subagent', 'claude-session', 'subagents');
      await directory(input.nativeRoot, join(session, 'tool-results'), 'tool-result', 'claude-session', 'tool-results');
      const configRoot = dirname(input.nativeRoot);
      if (basename(input.nativeRoot) === 'projects') {
        for (const name of ['image-cache', 'uploads']) await directory(configRoot, join(configRoot, name, input.sessionId), 'attachment', 'claude-config', `${name}/${input.sessionId}`);
      }
      if (input.nativeTempRoot) {
        const projectName = input.project.replace(/[^a-zA-Z0-9]/g, '-');
        await directory(input.nativeTempRoot, join(input.nativeTempRoot, projectName, input.sessionId, 'images'), 'attachment', 'claude-temp', 'images');
      }
      // Only sibling filenames belonging to this exact registered session qualify.
      for (const name of await readdir(dirname(input.transcriptPath))) {
        if (name.startsWith(`${input.sessionId}.orphaned-`) || name.startsWith(`${input.sessionId}.jsonl.superseded-`)) {
          await read(input.nativeRoot, join(dirname(input.transcriptPath), name), 'previous-transcript', 'portable', name, input.sessionId);
        }
      }
      for (const record of records) {
        if (record.type === 'system' && record.subtype === 'compact_boundary') compacted = true;
        if (record.type === 'file-history-snapshot') {
          const backups = record.snapshot?.trackedFileBackups;
          if (!backups || typeof backups !== 'object') { gap('unknown-format', 'file-history-snapshot'); continue; }
          for (const [originalPath, backup] of Object.entries(backups)) {
            const file = (backup as any)?.backupFileName;
            if (originalPath.split(/[\\/]/).some(forbidden)) { gap('unsafe-path', '敏感配置快照已排除'); continue; }
            if (typeof file !== 'string' || !materialNameSchema.safeParse(file).success || file.includes('/')) { gap('unknown-format', 'file-history backup reference'); continue; }
            await read(configRoot, join(configRoot, 'file-history', input.sessionId, file), 'checkpoint', 'claude-config', `file-history/${input.sessionId}/${file}`);
          }
        }
      }
    } else gap('unknown-format', 'Claude session identity cannot select associated directories');
    for (const item of artifacts.filter(item => item.material.role === 'subagent')) lineage.push({ relation: 'child', sessionId: item.material.sourceSessionId!, materialId: item.material.id });
  } else {
    const metadata = records.find(record => record.type === 'session_meta')?.payload;
    const needed = new Map<string, Lineage['relation']>();
    if (typeof metadata?.forked_from_id === 'string') needed.set(metadata.forked_from_id, 'fork-parent');
    if (typeof metadata?.history_base?.thread_id === 'string') needed.set(metadata.history_base.thread_id, 'history-base');
    const parent = metadata?.source?.subagent?.thread_spawn?.parent_thread_id;
    if (typeof parent === 'string') needed.set(parent, 'parent');
    const calls = new Map<string, string>();
    for (const record of records) {
      if (record.type === 'compacted') compacted = true;
      const payload = record.payload;
      if (record.type === 'response_item' && payload?.type === 'function_call') calls.set(payload.call_id, payload.name);
      if (record.type === 'response_item' && payload?.type === 'function_call_output' && calls.get(payload.call_id) === 'spawn_agent') {
        try { const result = JSON.parse(payload.output); if (typeof result.agent_id === 'string') needed.set(result.agent_id, 'child'); } catch { gap('unknown-format', 'spawn_agent result'); }
      }
    }
    const nativeHome = dirname(input.nativeRoot);
    const databases = (await readdir(nativeHome)).filter(name => /^state_\d+\.sqlite$/.test(name)).sort();
    const visited = new Set([input.sessionId]);
    if (databases.length > 1) gap('unknown-format', 'Multiple native state database versions; selected highest numeric version');
    const database = databases.sort((a, b) => Number(b.match(/\d+/)![0]) - Number(a.match(/\d+/)![0]))[0];
    if (database) {
      let db: DatabaseSync | undefined;
      try {
        const path = await safeNativePath(nativeHome, join(nativeHome, database));
        if ((await lstat(path)).nlink > 1) throw new Error('unsafe-path');
        db = new DatabaseSync(path, { readOnly: true });
        // Only exact native IDs referenced by the qualified transcript are queried.
        const queue = [...needed.entries()];
        for (let index = 0; index < queue.length && index < 32; index++) {
          const [id, relation] = queue[index]!;
          if (visited.has(id)) continue; visited.add(id);
          const row = db.prepare('SELECT rollout_path FROM threads WHERE id=?').get(id) as { rollout_path: string } | undefined;
          if (!row) { lineage.push({ relation, sessionId: id }); gap('missing', `关联会话 ${id}`); continue; }
          const bytes = await readNativeFile(input.nativeRoot, row.rollout_path).catch(() => null);
          let parentMetadata: any;
          try { parentMetadata = JSON.parse(bytes!.toString('utf8').split('\n')[0]!).payload; } catch { /* handled below */ }
          if (!bytes || parentMetadata?.id !== id) { gap('unreadable', `关联会话 ${id}`); lineage.push({ relation, sessionId: id }); continue; }
          const materialId = add(relation === 'child' ? 'child-transcript' : 'parent-transcript', 'codex-rollout', `${id}.jsonl`, bytes, id);
          lineage.push({ relation, sessionId: id, materialId });
          const ancestor = parentMetadata.history_base?.thread_id ?? parentMetadata.forked_from_id;
          if (typeof ancestor === 'string' && !visited.has(ancestor)) queue.push([ancestor, 'history-base']);
        }
        if (queue.length > 32) gap('size-limit', '关联会话递归超过 32 项');
        const hasAttachments = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='thread_attachments'").get();
        if (hasAttachments) {
          for (const id of visited) {
            const rows = db.prepare('SELECT id,thread_id,attachment_type,identity_key,payload,created_at FROM thread_attachments WHERE thread_id=? ORDER BY id LIMIT 129').all(id);
            if (rows.length > 128) { gap('size-limit', `附件索引 ${id}`); continue; }
            if (rows.length) {
              add('attachment', 'codex-attachments', `${id}.json`, Buffer.from(JSON.stringify(rows)), id);
              gap('native-mapping-unverified', `独立附件 ${id} 已存档；原生数据库重建仍未验证`);
            }
          }
        }
      } catch (error) { gap((error as Error).message === 'unsafe-path' ? 'unsafe-path' : 'unreadable', 'native thread index'); }
      finally { db?.close(); }
    } else for (const [id, relation] of needed) { lineage.push({ relation, sessionId: id }); gap('missing', `关联会话 ${id}：无可用原生索引`); }
  }
  // Inline binary payloads are already part of immutable originals; expose exact bytes too.
  const inline = (value: unknown, location: string) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach((item, i) => inline(item, `${location}-${i}`)); return; }
    const item = value as any;
    if (item.type === 'input_image' && typeof item.image_url === 'string' && item.image_url.startsWith('data:')) {
      const match = /^data:image\/(?:png|jpeg|webp|gif);base64,([A-Za-z0-9+/]*={0,2})$/.exec(item.image_url);
      if (match) { const bytes = Buffer.from(match[1]!, 'base64'); if (bytes.toString('base64') === match[1]) add('attachment', 'portable', `inline-${location}.bin`, bytes); else gap('unknown-format', `inline image ${location}`); }
      else gap('unknown-format', `inline image ${location}`);
    }
    if (item.type === 'image' && item.source?.type === 'base64' && typeof item.source.data === 'string') {
      const bytes = Buffer.from(item.source.data, 'base64');
      if (bytes.toString('base64') === item.source.data) add('attachment', 'portable', `inline-${location}.bin`, bytes); else gap('unknown-format', `inline image ${location}`);
    }
    for (const [key, child] of Object.entries(item)) if (child && typeof child === 'object') inline(child, `${location}-${key}`.slice(-200));
  };
  records.forEach((record, index) => inline(record, String(index + 1)));
  for (const previous of input.previous ?? []) {
    if (artifacts.some(item => item.material.id === previous.id)) continue;
    if (artifacts.length >= 128 || total + previous.byteLength > COLLECTION_BYTES) { gap('size-limit', previous.name); continue; }
    // A later deletion cannot discard already archived evidence. Keep its old hash and flag the loss.
    artifacts.push({ material: previous }); total += previous.byteLength; gap('missing', `源头已不可取得；保留已存档版本：${previous.name}`);
  }
  artifacts.sort((a, b) => a.material.id.localeCompare(b.material.id));
  gaps.sort((a, b) => `${a.code}/${a.reference}`.localeCompare(`${b.code}/${b.reference}`));
  lineage.sort((a, b) => `${a.relation}/${a.sessionId}`.localeCompare(`${b.relation}/${b.sessionId}`));
  return { artifacts, gaps, lineage, compacted, partialLine };
}
