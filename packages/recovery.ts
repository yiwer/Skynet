import { createHash } from 'node:crypto';
import { z } from 'zod';
import { manifestSchema, MAX_ARTIFACT_BYTES, hashSchema, type Manifest } from './contracts/archive.js';
import { claudeIdentity } from './native/claude.js';

export const MAX_RECOVERY_BYTES = Math.ceil(MAX_ARTIFACT_BYTES / 3) * 4 + 64 * 1024;
export const measuredDesktop = { version: '26.924.2738.0', runtime: '0.158.0-alpha.2.1', os: 'win32', arch: 'x64' } as const;
export const measuredCodexCli = { version: '0.157.1', runtime: '0.157.1', os: 'win32', arch: 'x64' } as const;
export const measuredClaude = { version: '2.1.281', runtime: '2.1.281', os: 'win32', arch: 'x64' } as const;
const checksum = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const packageContentSchema = z.object({
  format: z.enum(['skynet-codex-recovery', 'skynet-claude-recovery']), packageVersion: z.literal(1),
  snapshot: z.object({ id: z.uuid(), employee: z.string().min(1).max(256), committedAt: z.iso.datetime() }).strict(),
  manifest: manifestSchema,
  scope: z.enum(['single-rollout; associated materials not verified', 'single-transcript; associated materials not verified']),
  artifact: z.object({ encoding: z.literal('base64'), data: z.string().min(1).max(Math.ceil(MAX_ARTIFACT_BYTES / 3) * 4) }).strict(),
}).strict();
const packageSchema = packageContentSchema.extend({ packageSha256: hashSchema }).strict();
const nativeMetadataSchema = z.object({ timestamp: z.iso.datetime({ offset: true }), type: z.literal('session_meta'),
  payload: z.object({ id: z.uuid(), cli_version: z.string().min(1).max(256) }) });

export function nativeMetadata(bytes: Buffer) {
  try { return nativeMetadataSchema.parse(JSON.parse(bytes.toString('utf8').split('\n')[0]!)); }
  catch { return null; }
}

export function recoveryInfo(manifest: Manifest, bytes: Buffer) {
  if (manifest.source === 'claude-code-cli') {
    let version: string | null = null;
    try { version = claudeIdentity(bytes, manifest.sourceSessionId).version; } catch { /* Unknown identity is visible, not a support claim. */ }
    const matchingBaseline = manifest.sourceVersion === measuredClaude.version && version === measuredClaude.runtime && manifest.sourceOs === measuredClaude.os;
    return {
      packageVersion: 1, scope: 'single-transcript', sourceCompleteness: 'unverified',
      sourceVersion: manifest.sourceVersion, sourceOs: manifest.sourceOs, nativeRuntimeVersion: version,
      artifacts: [{ role: 'native-transcript', byteLength: manifest.byteLength, sha256: manifest.hash }],
      desktopUi: 'not-applicable', nativeBackend: matchingBaseline ? 'fixture-tested' : 'unverified',
      preparation: matchingBaseline && bytes.at(-1) === 10 ? 'candidate' : 'unsupported', measuredTarget: measuredClaude,
      limitation: '仅包含当前收到的 Claude 原生会话原件；相同版本的隔离 CLI 与合成模型续聊已测，关联附件、子会话与真实模型续聊仍未验证。',
    } as const;
  }
  const metadata = nativeMetadata(bytes);
  const baseline = manifest.source === 'codex-cli' ? measuredCodexCli : measuredDesktop;
  const matchingBaseline = manifest.sourceVersion === baseline.version && manifest.sourceOs === baseline.os
    && metadata?.payload.cli_version === baseline.runtime && metadata.payload.id === manifest.sourceSessionId;
  return {
    packageVersion: 1, scope: 'single-rollout', sourceCompleteness: 'unverified',
    sourceVersion: manifest.sourceVersion, sourceOs: manifest.sourceOs, nativeRuntimeVersion: metadata?.payload.cli_version ?? null,
    artifacts: [{ role: 'native-rollout', byteLength: manifest.byteLength, sha256: manifest.hash }],
    desktopUi: manifest.source === 'codex-cli' ? 'not-applicable' : 'unverified', nativeBackend: matchingBaseline ? 'fixture-tested' : 'unverified',
    preparation: matchingBaseline && bytes.at(-1) === 10 ? 'candidate' : 'unsupported',
    measuredTarget: baseline,
    limitation: manifest.source === 'codex-cli'
      ? '仅包含当前收到的单个原件；已测版本的 CLI 合成恢复不覆盖附件、外部工具溢出文件或子会话，其他版本/OS 待验证。'
      : '仅包含当前收到的单个原件；关联材料完整性与 Desktop UI 续聊未验证。后端合成测试不代表 Desktop 支持。',
  } as const;
}

export function createRecoveryPackage(snapshot: { id: string; employee: string; committedAt: string }, manifest: Manifest, bytes: Buffer) {
  if (bytes.length !== manifest.byteLength || checksum(bytes) !== manifest.hash) throw new Error('Archive integrity check failed');
  const claude = manifest.source === 'claude-code-cli';
  const content = packageContentSchema.parse({ format: claude ? 'skynet-claude-recovery' : 'skynet-codex-recovery', packageVersion: 1, snapshot, manifest,
    scope: claude ? 'single-transcript; associated materials not verified' : 'single-rollout; associated materials not verified', artifact: { encoding: 'base64', data: bytes.toString('base64') } });
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
    || content.scope !== (claude ? 'single-transcript; associated materials not verified' : 'single-rollout; associated materials not verified')) {
    throw new Error('Recovery package source, format and scope do not match');
  }
  if (checksum(JSON.stringify(content)) !== packageSha256) throw new Error('Recovery package metadata checksum mismatch');
  const bytes = Buffer.from(content.artifact.data, 'base64');
  if (bytes.toString('base64') !== content.artifact.data || bytes.length !== content.manifest.byteLength || checksum(bytes) !== content.manifest.hash) {
    throw new Error('Recovery artifact length or SHA-256 mismatch');
  }
  return { ...content, bytes };
}
