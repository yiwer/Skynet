import { createHash } from 'node:crypto';
import { z } from 'zod';
import { manifestSchema, MAX_ARTIFACT_BYTES, hashSchema, type Manifest } from './contracts/archive.js';
import { claudeIdentity } from './native/claude.js';
import { COLLECTION_BYTES } from './contracts/materials.js';

export const MAX_RECOVERY_BYTES = Math.ceil(COLLECTION_BYTES / 3) * 4 + 1024 * 1024;
export const measuredDesktop = { version: '26.924.2738.0', runtime: '0.158.0-alpha.2.1', os: 'win32', arch: 'x64' } as const;
export const measuredCodexCli = { version: '0.157.1', runtime: '0.157.1', os: 'win32', arch: 'x64' } as const;
export const measuredClaude = { version: '2.1.281', runtime: '2.1.281', os: 'win32', arch: 'x64' } as const;
const checksum = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const packageContentSchema = z.object({
  format: z.enum(['skynet-codex-recovery', 'skynet-claude-recovery']), packageVersion: z.literal(1),
  snapshot: z.object({ id: z.uuid(), employee: z.string().min(1).max(256), committedAt: z.iso.datetime() }).strict(),
  manifest: manifestSchema,
  scope: z.enum(['single-rollout; associated materials not verified', 'single-transcript; associated materials not verified']),
  artifact: z.object({ encoding: z.literal('base64'), data: z.string().max(Math.ceil(MAX_ARTIFACT_BYTES / 3) * 4) }).strict(),
}).strict();
const collectionContentSchema = packageContentSchema.extend({ packageVersion: z.literal(2), scope: z.literal('captured-material-collection; completeness unverified'),
  materials: z.array(z.object({ id: hashSchema, encoding: z.literal('base64'), data: z.string().max(Math.ceil(MAX_ARTIFACT_BYTES / 3) * 4) }).strict()).max(128),
}).strict();
const packageSchema = z.discriminatedUnion('packageVersion', [packageContentSchema.extend({ packageSha256: hashSchema }), collectionContentSchema.extend({ packageSha256: hashSchema })]);
const nativeMetadataSchema = z.object({ timestamp: z.iso.datetime({ offset: true }), type: z.literal('session_meta'),
  payload: z.object({ id: z.uuid(), cli_version: z.string().min(1).max(256) }) });

export function nativeMetadata(bytes: Buffer) {
  try { return nativeMetadataSchema.parse(JSON.parse(bytes.toString('utf8').split('\n')[0]!)); }
  catch { return null; }
}

export function recoveryInfo(manifest: Manifest, bytes: Buffer) {
  const associated = { packageVersion: manifest.capture ? 2 : 1, scope: manifest.capture ? 'captured-material-collection' : 'single-native-artifact',
    artifacts: [{ role: 'native-transcript', byteLength: manifest.byteLength, sha256: manifest.hash },
      ...(manifest.capture?.materials.map(item => ({ role: item.role, byteLength: item.byteLength, sha256: item.hash })) ?? [])],
    gaps: manifest.capture?.gaps ?? [], lineage: manifest.capture?.lineage ?? [] };
  if (manifest.source === 'claude-code-cli') {
    let version: string | null = null;
    try { version = claudeIdentity(bytes, manifest.sourceSessionId).version; } catch { /* Unknown identity is visible, not a support claim. */ }
    const matchingBaseline = manifest.sourceVersion === measuredClaude.version && version === measuredClaude.runtime && manifest.sourceOs === measuredClaude.os;
    return {
      ...associated, sourceCompleteness: 'unverified',
      sourceVersion: manifest.sourceVersion, sourceOs: manifest.sourceOs, nativeRuntimeVersion: version,
      desktopUi: 'not-applicable', nativeBackend: matchingBaseline ? 'fixture-tested' : 'unverified',
      preparation: matchingBaseline && bytes.at(-1) === 10 ? 'candidate' : 'unsupported', measuredTarget: measuredClaude,
      limitation: '包含本快照已收到的原件与关联材料，缺口见材料列表。相同版本的隔离 CLI 合成续聊已测；附件映射、子会话和真实模型续聊以具体验证记录为准。',
    } as const;
  }
  const metadata = nativeMetadata(bytes);
  let requiredParentReady = true;
  if (metadata) {
    const header = JSON.parse(bytes.toString('utf8').split('\n')[0]!).payload;
    const parent = header.history_base?.thread_id ?? header.forked_from_id;
    if (typeof parent === 'string') {
      const material = manifest.capture?.materials.find(item => item.placement === 'codex-rollout' && item.sourceSessionId === parent);
      requiredParentReady = !!material && (header.history_base?.end_byte_offset === undefined || header.history_base.end_byte_offset <= material.byteLength);
    }
  }
  const baseline = manifest.source === 'codex-cli' ? measuredCodexCli : measuredDesktop;
  const matchingBaseline = manifest.sourceVersion === baseline.version && manifest.sourceOs === baseline.os
    && metadata?.payload.cli_version === baseline.runtime && metadata.payload.id === manifest.sourceSessionId;
  return {
    ...associated, sourceCompleteness: 'unverified',
    sourceVersion: manifest.sourceVersion, sourceOs: manifest.sourceOs, nativeRuntimeVersion: metadata?.payload.cli_version ?? null,
    desktopUi: manifest.source === 'codex-cli' ? 'not-applicable' : 'unverified', nativeBackend: matchingBaseline ? 'fixture-tested' : 'unverified',
    preparation: matchingBaseline && bytes.at(-1) === 10 && requiredParentReady ? 'candidate' : 'unsupported',
    measuredTarget: baseline,
    limitation: manifest.source === 'codex-cli'
      ? '包含本快照已收到的原件与关联材料；附件索引会保存在恢复目录，原生数据库映射仍待验证。其他版本/OS 待验证。'
      : '包含本快照已收到的原件与关联材料；缺口和未验证映射会保留。Desktop UI 续聊未验证，后端合成测试不代表 Desktop 支持。',
  } as const;
}

export function createRecoveryPackage(snapshot: { id: string; employee: string; committedAt: string }, manifest: Manifest, bytes: Buffer, materials: { id: string; bytes: Buffer }[] = []) {
  if (bytes.length !== manifest.byteLength || checksum(bytes) !== manifest.hash) throw new Error('Archive integrity check failed');
  const claude = manifest.source === 'claude-code-cli';
  const declared = manifest.capture?.materials ?? [];
  if (materials.length !== declared.length || new Set(materials.map(item => item.id)).size !== declared.length) throw new Error('Recovery material set is incomplete');
  for (const material of declared) {
    const artifact = materials.find(item => item.id === material.id);
    if (!artifact || artifact.bytes.length !== material.byteLength || checksum(artifact.bytes) !== material.hash) throw new Error('Associated artifact integrity check failed');
  }
  const base = { format: claude ? 'skynet-claude-recovery' : 'skynet-codex-recovery', snapshot, manifest, artifact: { encoding: 'base64', data: bytes.toString('base64') } };
  const content = manifest.capture ? collectionContentSchema.parse({ ...base, packageVersion: 2, scope: 'captured-material-collection; completeness unverified',
    materials: declared.map(material => ({ id: material.id, encoding: 'base64', data: materials.find(item => item.id === material.id)!.bytes.toString('base64') })) })
    : packageContentSchema.parse({ ...base, packageVersion: 1, scope: claude ? 'single-transcript; associated materials not verified' : 'single-rollout; associated materials not verified' });
  return { ...content, packageSha256: checksum(JSON.stringify(content)) };
}

export function readRecoveryPackage(input: Buffer) {
  if (input.length > MAX_RECOVERY_BYTES) throw new Error('Recovery package exceeds the size limit');
  let parsed: z.infer<typeof packageSchema>;
  try { parsed = packageSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(input))); }
  catch { throw new Error('Malformed or unsupported recovery package'); }
  const { packageSha256, ...content } = parsed;
  const claude = content.manifest.source === 'claude-code-cli';
  if (content.format !== (claude ? 'skynet-claude-recovery' : 'skynet-codex-recovery')
    || (content.packageVersion === 1 && content.scope !== (claude ? 'single-transcript; associated materials not verified' : 'single-rollout; associated materials not verified'))) {
    throw new Error('Recovery package source, format and scope do not match');
  }
  if (checksum(JSON.stringify(content)) !== packageSha256) throw new Error('Recovery package metadata checksum mismatch');
  const bytes = Buffer.from(content.artifact.data, 'base64');
  if (bytes.toString('base64') !== content.artifact.data || bytes.length !== content.manifest.byteLength || checksum(bytes) !== content.manifest.hash) {
    throw new Error('Recovery artifact length or SHA-256 mismatch');
  }
  const declared = content.manifest.capture?.materials ?? [];
  const encoded = content.packageVersion === 2 ? content.materials : [];
  if (declared.length !== encoded.length || new Set(encoded.map(item => item.id)).size !== encoded.length) throw new Error('Recovery material set is incomplete');
  const materials = declared.map(material => {
    const input = encoded.find(item => item.id === material.id); const data = Buffer.from(input?.data ?? '', 'base64');
    if (!input || data.toString('base64') !== input.data || data.length !== material.byteLength || checksum(data) !== material.hash) throw new Error('Associated artifact length or SHA-256 mismatch');
    return { material, bytes: data };
  });
  return { ...content, bytes, materials };
}
