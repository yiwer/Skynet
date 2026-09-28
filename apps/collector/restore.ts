import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { lstat, mkdir, open, readFile, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, parse, resolve } from 'node:path';
import { measuredDesktop, measuredCodexCli, nativeMetadata, readRecoveryPackage, MAX_RECOVERY_BYTES } from '../../packages/recovery.js';
import { syncDirectory } from '../../packages/filesystem.js';

const execute = promisify(execFile);

async function newTarget(path: string) {
  if (!isAbsolute(path)) throw new Error('Restore target must be an absolute NEW private directory');
  const target = resolve(path);
  try { await lstat(target); throw new Error('Restore target already exists; no files were changed'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  // Reject symlinks and Windows junctions in every ancestor, including the direct parent.
  for (let parent = dirname(target); ; parent = dirname(parent)) {
    const info = await lstat(parent);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Restore parent must be an existing directory without symlinks or junctions');
    if (parent === parse(parent).root) break;
  }
  return target;
}

async function durableFile(path: string, bytes: Buffer | string) {
  const handle = await open(path, 'wx', 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
}

export async function restorePackage(options: { packagePath: string; target: string; sourceVersion: string; runtime: string }) {
  const target = await newTarget(options.target);
  const info = await lstat(options.packagePath);
  if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_RECOVERY_BYTES) throw new Error('Expected a bounded regular recovery package file');
  const bundle = readRecoveryPackage(await readFile(options.packagePath));
  const metadata = nativeMetadata(bundle.bytes);
  if (!metadata || metadata.payload.id !== bundle.manifest.sourceSessionId) throw new Error('Native session identity or metadata is invalid');
  // Never rebuild, normalize, or silently drop a partial source line during restoration.
  if (bundle.bytes.at(-1) !== 10) throw new Error('Native rollout has an incomplete last line; wait for a complete snapshot');
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bundle.bytes);
    for (const line of text.split('\n')) if (line.trim()) {
      const record = JSON.parse(line);
      if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('Invalid record');
    }
  } catch { throw new Error('Native rollout contains invalid UTF-8 or JSON records'); }
  const cli = bundle.manifest.source === 'codex-cli';
  const baseline = cli ? measuredCodexCli : measuredDesktop;
  if (bundle.manifest.sourceVersion !== options.sourceVersion || bundle.manifest.sourceOs !== process.platform
    || options.sourceVersion !== baseline.version || process.platform !== baseline.os || process.arch !== baseline.arch
    || metadata.payload.cli_version !== baseline.runtime) {
    throw new Error('Unsupported source/target Agent, runtime, OS or architecture combination; no files were changed');
  }
  if (!isAbsolute(options.runtime)) throw new Error('Runtime must be the absolute path to the installed native executable');
  const { stdout } = await execute(options.runtime, ['--version'], { windowsHide: true, timeout: 10_000, maxBuffer: 4096 });
  if (stdout.trim() !== `codex-cli ${metadata.payload.cli_version}`) throw new Error('Target native runtime version does not match the archived source');

  // The bundle has no path entries: this adapter alone chooses all output names.
  const date = new Date(metadata.timestamp).toISOString();
  const parts = [date.slice(0, 4), date.slice(5, 7), date.slice(8, 10)];
  await mkdir(target, { mode: 0o700 }); // Non-recursive and exclusive: an existing target is never used.
  await durableFile(join(target, '.skynet-restore-incomplete'), 'Do not open until restore-receipt.json exists.\n');
  let directory = target;
  for (const part of ['sessions', ...parts]) {
    directory = join(directory, part); await mkdir(directory, { mode: 0o700 }); await syncDirectory(dirname(directory));
  }
  const rolloutPath = join(directory, `rollout-${date.slice(0, 19).replaceAll(':', '-')}-${metadata.payload.id}.jsonl`);
  await durableFile(rolloutPath, bundle.bytes); await syncDirectory(directory);
  const result = { state: cli ? 'prepared-cli' : 'prepared-desktop-unverified', snapshotId: bundle.snapshot.id, sourceEmployee: bundle.snapshot.employee,
    sourceSessionId: bundle.manifest.sourceSessionId, nativeHome: target, rolloutPath,
    sha256: bundle.manifest.hash, byteLength: bundle.manifest.byteLength,
    sourceVersion: bundle.manifest.sourceVersion, runtimeVersion: metadata.payload.cli_version, os: process.platform,
    desktopUi: cli ? 'not-applicable' : 'unverified', nativeBackend: 'fixture-tested', source: bundle.manifest.source,
    limitation: 'Only this archived rollout was restored. Associated materials, workspace and credentials are not restored. Desktop UI continuation remains unverified.' };
  await durableFile(join(target, 'restore-receipt.json'), JSON.stringify(result, null, 2));
  await unlink(join(target, '.skynet-restore-incomplete'));
  await syncDirectory(target); await syncDirectory(dirname(target));
  return result;
}
