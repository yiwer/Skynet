import { chmod, lstat, mkdir, readFile, readdir } from 'node:fs/promises';
import { dirname, join, parse, resolve } from 'node:path';
import { homedir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';

const execute = promisify(execFile);
export const sources = ['codex-cli', 'codex-desktop', 'claude-code-cli'] as const;
export const channels = ['npm', 'codex-plugin', 'claude-plugin'] as const;
export const entrySchema = z.object({ channel: z.enum(channels), packageVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  registeredAt: z.iso.datetime(), sources: z.array(z.enum(sources)) });
export const installationSchema = z.object({ version: z.literal(1), deploymentId: z.string(), node: z.string(), launcher: z.string(),
  entries: z.array(entrySchema).optional(),
  lifecycle: z.enum(['active', 'uninstalled']).optional(),
  maintenanceRuntime: z.string().optional(),
  runtime: z.string(), installedAt: z.iso.datetime(), clients: z.array(z.object({ source: z.enum(sources), detected: z.boolean(),
    version: z.string().nullable(), executable: z.string().nullable(), nativeRoot: z.string(), configPath: z.string(),
    configured: z.boolean(), capability: z.literal('unverified'), notice: z.string() })),
  configurations: z.array(z.object({ path: z.string(), entries: z.record(z.string(), z.unknown()) })),
});
export type Installation = z.infer<typeof installationSchema>;
export const identitySchema = z.object({ server: z.url(), installationId: z.uuid(), deviceId: z.uuid(),
  deviceCredential: z.string().min(32), enrolledAt: z.iso.datetime() });
export async function installedState(state: string, resumeSetup = false) {
  let registration: string;
  try { registration = await readFile(join(state, 'installation.json'), 'utf8'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    if (!resumeSetup) return false;
    // The shared installer persists identity before its installation record;
    // legacy per-source setup never writes this file.
    let identity: string;
    try { identity = await readFile(join(state, 'identity.json'), 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
    try { identitySchema.parse(JSON.parse(identity)); }
    catch { throw new Error(`Invalid setup recovery state in ${state}; inspect the retained state`); }
    return true;
  }
  // A malformed installation must never become a new identity or a legacy
  // source by accident. Do not include credential-bearing input in errors.
  try {
    installationSchema.parse(JSON.parse(registration));
    identitySchema.parse(await jsonFile(join(state, 'identity.json')));
  } catch { throw new Error(`Invalid installation or identity in ${state}; inspect and repair the retained state`); }
  return true;
}
export async function windowsState(stable: string, legacy: string, resumeSetup = false) {
  for (const candidate of [stable, legacy]) {
    try { await lstat(candidate); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
    if (await installedState(candidate)) return candidate;
    if (resumeSetup) {
      try {
        const identity = await optionalJson(join(candidate, 'identity.json'));
        const enrollment = await optionalJson(join(candidate, 'enrollment.json'));
        if (identity !== null) identitySchema.parse(identity);
        if (enrollment !== null) z.object({ installationId: z.uuid(), server: z.string(), name: z.string(),
          enrollmentHash: z.string(), deviceCredential: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict().parse(enrollment);
        // Setup may have stopped before enrollment, after persisting its retry
        // proof, or after receiving identity. Resume only this same directory;
        // never fall back to another installation or discard its recovery proof.
        if (identity !== null || enrollment !== null) return candidate;
        // An empty preferred directory has no identity. Check the legacy
        // location before selecting it, so setup cannot create a second device.
        if ((await readdir(candidate)).length === 0) continue;
      } catch { throw new Error(`Invalid setup recovery state in ${candidate}; inspect the retained state`); }
    }
    throw new Error(`Incomplete installation in ${candidate}; inspect the retained state before setup`);
  }
  return stable;
}
export async function defaultState(resumeSetup = false) {
  if (process.platform === 'win32') return windowsState(resolve(homedir(), '.skynet', 'state'),
    resolve(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'Skynet'), resumeSetup);
  const base = process.platform === 'darwin' ? join(homedir(), 'Library', 'Application Support')
    : (process.env.XDG_STATE_HOME ?? join(homedir(), '.local', 'state'));
  return resolve(base, 'Skynet');
}
export async function jsonFile(path: string) { return JSON.parse(await readFile(path, 'utf8')); }
export async function optionalJson(path: string) {
  try { return await jsonFile(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}
export function serverOrigin(value: string) {
  const url = new URL(value);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))
    || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Deployment must specify a trusted HTTPS origin (HTTP only for loopback tests)');
  return url.origin;
}
export async function plainDirectory(path: string) {
  for (let part = resolve(path); ; part = dirname(part)) {
    try { const info = await lstat(part); if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Installation paths must not traverse symlinks or junctions'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (part === parse(part).root) break;
  }
  await mkdir(path, { recursive: true, mode: 0o700 });
}
export async function protectState(state: string) {
  await plainDirectory(state);
  if (process.platform !== 'win32') { await chmod(state, 0o700); return; }
  // Do not rely on Node's Unix mode argument on Windows. Replace inherited and
  // explicit ACEs with the current user's SID before writing any credential.
  const script = `$ErrorActionPreference='Stop'; $p=$env:SKYNET_PRIVATE_DIRECTORY; $sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User; $acl=New-Object System.Security.AccessControl.DirectorySecurity; $acl.SetOwner($sid); $acl.SetAccessRuleProtection($true,$false); $rule=New-Object System.Security.AccessControl.FileSystemAccessRule($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow'); $acl.AddAccessRule($rule); [System.IO.Directory]::SetAccessControl($p,$acl); $check=[System.IO.Directory]::GetAccessControl($p); if(-not $check.AreAccessRulesProtected){throw 'Private DACL was not applied'}`;
  // Script is fixed; the path is data, never interpolated as code.
  await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    { windowsHide: true, env: { ...process.env, SKYNET_KEY: undefined, SKYNET_PRIVATE_DIRECTORY: state } });
}
