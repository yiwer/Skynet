import { createHash } from 'node:crypto';
import { z } from 'zod';
import { manifestSchema, MAX_ARTIFACT_BYTES, hashSchema, type Manifest } from './contracts/archive.js';

export const MAX_RECOVERY_BYTES = Math.ceil(MAX_ARTIFACT_BYTES / 3) * 4 + 64 * 1024;
export const measuredDesktop = { version: '26.924.2738.0', runtime: '0.158.0-alpha.2.1', os: 'win32', arch: 'x64' } as const;
const checksum = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const packageContentSchema = z.object({
  format: z.literal('skynet-codex-recovery'), packageVersion: z.literal(1),
  snapshot: z.object({ id: z.uuid(), employee: z.string().min(1).max(256), committedAt: z.iso.datetime() }).strict(),
  manifest: manifestSchema,
  scope: z.literal('single-rollout; associated materials not verified'),
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
  const metadata = nativeMetadata(bytes);
  const matchingBaseline = manifest.sourceVersion === measuredDesktop.version && manifest.sourceOs === measuredDesktop.os
    && metadata?.payload.cli_version === measuredDesktop.runtime && metadata.payload.id === manifest.sourceSessionId;
  return {
    packageVersion: 1, scope: 'single-rollout', sourceCompleteness: 'unverified',
    sourceVersion: manifest.sourceVersion, sourceOs: manifest.sourceOs, nativeRuntimeVersion: metadata?.payload.cli_version ?? null,
    artifacts: [{ role: 'native-rollout', byteLength: manifest.byteLength, sha256: manifest.hash }],
    desktopUi: 'unverified', nativeBackend: matchingBaseline ? 'fixture-tested' : 'unverified',
    preparation: matchingBaseline && bytes.at(-1) === 10 ? 'candidate' : 'unsupported',
    measuredTarget: measuredDesktop,
    limitation: '仅包含当前收到的单个原件；关联材料完整性与 Desktop UI 续聊未验证。后端合成测试不代表 Desktop 支持。',
  } as const;
}

export function createRecoveryPackage(snapshot: { id: string; employee: string; committedAt: string }, manifest: Manifest, bytes: Buffer) {
  if (bytes.length !== manifest.byteLength || checksum(bytes) !== manifest.hash) throw new Error('Archive integrity check failed');
  const content = packageContentSchema.parse({ format: 'skynet-codex-recovery', packageVersion: 1, snapshot, manifest,
    scope: 'single-rollout; associated materials not verified', artifact: { encoding: 'base64', data: bytes.toString('base64') } });
  return { ...content, packageSha256: checksum(JSON.stringify(content)) };
}

export function readRecoveryPackage(input: Buffer) {
  if (input.length > MAX_RECOVERY_BYTES) throw new Error('Recovery package exceeds the size limit');
  let parsed: z.infer<typeof packageSchema>;
  try { parsed = packageSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(input))); }
  catch { throw new Error('Malformed or unsupported recovery package'); }
  const { packageSha256, ...content } = parsed;
  if (checksum(JSON.stringify(content)) !== packageSha256) throw new Error('Recovery package metadata checksum mismatch');
  const bytes = Buffer.from(content.artifact.data, 'base64');
  if (bytes.toString('base64') !== content.artifact.data || bytes.length !== content.manifest.byteLength || checksum(bytes) !== content.manifest.hash) {
    throw new Error('Recovery artifact length or SHA-256 mismatch');
  }
  return { ...content, bytes };
}
