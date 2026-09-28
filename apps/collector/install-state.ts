import { chmod, lstat, mkdir, readFile } from 'node:fs/promises';
import { dirname, join, parse, resolve } from 'node:path';
import { homedir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';

const execute = promisify(execFile);
export const sources = ['codex-cli', 'codex-desktop', 'claude-code-cli'] as const;
export const installationSchema = z.object({ version: z.literal(1), deploymentId: z.string(), node: z.string(), launcher: z.string(),
  runtime: z.string(), installedAt: z.iso.datetime(), clients: z.array(z.object({ source: z.enum(sources), detected: z.boolean(),
    version: z.string().nullable(), executable: z.string().nullable(), nativeRoot: z.string(), configPath: z.string(),
    configured: z.boolean(), capability: z.literal('unverified'), notice: z.string() })),
  configurations: z.array(z.object({ path: z.string(), entries: z.record(z.string(), z.unknown()) })),
});
export type Installation = z.infer<typeof installationSchema>;
export const identitySchema = z.object({ server: z.url(), installationId: z.uuid(), deviceId: z.uuid(),
  deviceCredential: z.string().min(32), enrolledAt: z.iso.datetime() });
export function defaultState() {
  const base = process.platform === 'win32' ? (process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'))
    : process.platform === 'darwin' ? join(homedir(), 'Library', 'Application Support')
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
  const script = `$ErrorActionPreference='Stop'; $p=$env:SKYNET_PRIVATE_DIRECTORY; $sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User; $acl=New-Object System.Security.AccessControl.DirectorySecurity; $acl.SetOwner($sid); $acl.SetAccessRuleProtection($true,$false); $rule=New-Object System.Security.AccessControl.FileSystemAccessRule($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow'); $acl.AddAccessRule($rule); Set-Acl -LiteralPath $p -AclObject $acl; $check=Get-Acl -LiteralPath $p; if(-not $check.AreAccessRulesProtected){throw 'Private DACL was not applied'}`;
  // Script is fixed; the path is data, never interpolated as code.
  await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    { windowsHide: true, env: { ...process.env, SKYNET_KEY: undefined, SKYNET_PRIVATE_DIRECTORY: state } });
}
