import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { lstat, stat, open, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { type Installation, plainDirectory } from './install-state.js';
import { syncDirectory } from '../../packages/filesystem.js';
import { setupLock } from './enrollment.js';

const execute = promisify(execFile);
const events = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'Stop', 'SessionEnd'];
const quoteShell = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
const quotePowershell = (value: string) => `'${value.replaceAll("'", "''")}'`;
async function executable(name: string) {
  const candidates = (process.env.PATH ?? '').split(delimiter).flatMap(path => process.platform === 'win32'
    ? [join(path, `${name}.exe`), join(path, `${name}.cmd`)] : [join(path, name)]);
  if (name === 'claude') candidates.push(join(homedir(), '.local', 'bin', process.platform === 'win32' ? 'claude.exe' : 'claude'));
  for (const path of candidates) try {
    if ((await stat(path)).isFile()) return await realpath(path);
  } catch { /* An absent PATH entry is not a detected client. */ }
  return null;
}
async function version(path: string | null, client: 'codex' | 'claude') {
  if (!path) return null;
  try {
    // npm's Windows shim is not an executable. Resolve the official package's JS
    // launcher directly rather than passing a shell command through PATH.
    const isShim = path.endsWith('.cmd');
    const packageEntry = client === 'codex' ? ['@openai', 'codex', 'bin', 'codex.js'] : ['@anthropic-ai', 'claude-code', 'cli.js'];
    const output = await execute(isShim ? process.execPath : path, isShim
      ? [join(path, '..', 'node_modules', ...packageEntry), '--version'] : ['--version'],
    { windowsHide: true, timeout: 10_000, env: { ...process.env, SKYNET_KEY: undefined } });
    return (client === 'codex' ? /^codex-cli (\S+)/ : /^(\S+) \(Claude Code\)/).exec(output.stdout.trim())?.[1] ?? null;
  } catch { return null; }
}
export async function detectClients(): Promise<Installation['clients']> {
  const codexRoot = resolve(process.env.CODEX_HOME ?? join(homedir(), '.codex'));
  const claudeRoot = resolve(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'));
  const codex = await executable('codex'); const claude = await executable('claude');
  const codexVersion = await version(codex, 'codex'); const claudeVersion = await version(claude, 'claude');
  let desktopVersion: string | null = null; let desktopExecutable: string | null = null;
  if (process.platform === 'win32') try {
    const result = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      "Get-AppxPackage -Name OpenAI.Codex | Select-Object -First 1 Version,InstallLocation | ConvertTo-Json -Compress"], { windowsHide: true, timeout: 10_000, env: { ...process.env, SKYNET_KEY: undefined } });
    if (result.stdout.trim()) { const desktop = JSON.parse(result.stdout); desktopVersion = String(desktop.Version); desktopExecutable = join(desktop.InstallLocation, 'app', 'ChatGPT.exe'); }
  } catch { /* Package detection is optional and never establishes native UI support. */ }
  return [
    { source: 'codex-cli', detected: !!codexVersion, version: codexVersion, executable: codex, nativeRoot: join(codexRoot, 'sessions'), configPath: join(codexRoot, 'hooks.json'), configured: false, capability: 'unverified', notice: '在 Codex 的 /hooks 审查并信任确切命令；版本兼容与采集单独验证。' },
    { source: 'codex-desktop', detected: !!desktopVersion, version: desktopVersion, executable: desktopExecutable, nativeRoot: join(codexRoot, 'sessions'), configPath: join(codexRoot, 'hooks.json'), configured: false, capability: 'unverified', notice: '共享 Codex hooks 已准备；Desktop 原生信任、来源识别及图标启动采集待验证。' },
    { source: 'claude-code-cli', detected: !!claudeVersion, version: claudeVersion, executable: claude, nativeRoot: join(claudeRoot, 'projects'), configPath: join(claudeRoot, 'settings.json'), configured: false, capability: 'unverified', notice: '按 Claude 正常流程信任工作目录，已有会话可能需要重新启动。' },
  ];
}
export function hookEntries(node: string, launcher: string, state: string, codex: boolean) {
  const args = [launcher, 'hook', '--state', codex ? join(state, 'inbox', 'codex') : join(state, 'sources', 'claude-code-cli')];
  const hook = codex ? { type: 'command', command: [node, ...args].map(quoteShell).join(' '),
    commandWindows: `& ${[node, ...args].map(quotePowershell).join(' ')}`, timeout: 3 }
    : { type: 'command', command: node, args, timeout: 3 };
  return Object.fromEntries(events.map(event => [event, { hooks: [hook] }]));
}
type Plan = { path: string; before: string | null; after: string; entries: Record<string, unknown> };
export async function planConfiguration(path: string, entries: Record<string, unknown>, owned?: Record<string, unknown>): Promise<Plan> {
  await plainDirectory(resolve(path, '..'));
  let before: string | null = null;
  try { if ((await lstat(path)).isSymbolicLink()) throw new Error('Host configuration must not be a symlink'); before = await readFile(path, 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  let value: any; try { value = before ? JSON.parse(before) : {}; } catch { throw new Error('Host configuration is invalid JSON; no settings were replaced'); }
  if (!value || typeof value !== 'object' || Array.isArray(value) || (value.hooks && (typeof value.hooks !== 'object' || Array.isArray(value.hooks)))) throw new Error('Host hooks configuration has an unsupported shape');
  value.hooks ??= {};
  for (const event of new Set([...Object.keys(entries), ...Object.keys(owned ?? {})])) {
    const entry = entries[event];
    const original = value.hooks[event] ?? [];
    if (!Array.isArray(original)) throw new Error('Host hook event has an unsupported shape');
    const previous = owned?.[event];
    const matches = previous ? original.filter(item => JSON.stringify(item) === JSON.stringify(previous)) : [];
    if (previous && matches.length !== 1) throw new Error('Skynet hook ownership conflict; existing configuration was retained');
    if (!previous && original.some(item => JSON.stringify(item).includes('skynet-launcher.mjs'))) throw new Error('An unregistered Skynet hook exists; resolve its ownership before setup');
    value.hooks[event] = [...original.filter(item => item !== matches[0]), ...(entry === undefined ? [] : [entry])];
  }
  return { path, before, after: JSON.stringify(value, null, 2) + '\n', entries };
}
export async function applyConfiguration(plan: Plan) {
  const canonical = await realpath(resolve(plan.path, '..'));
  const tag = createHash('sha256').update(resolve(plan.path).toLowerCase()).digest('hex').slice(0, 24);
  const release = await setupLock(canonical, `configuration-${tag}`);
  const temporary = `${plan.path}.${randomUUID()}.tmp`;
  try {
    const current = await readFile(plan.path, 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (current !== plan.before) throw new Error('Host settings changed during setup; retry without overwriting them');
    if (current === plan.after) return;
    if (current !== null) await writeFile(`${plan.path}.skynet-backup-${randomUUID()}`, current, { flag: 'wx', mode: 0o600 });
    const file = await open(temporary, 'wx', 0o600);
    try { await file.writeFile(plan.after); await file.sync(); } finally { await file.close(); }
    // Compare again before publishing; lock coordinates Skynet installers. Hosts
    // that ignore this lock cannot supply an atomic compare-and-swap filesystem API.
    const checked = await readFile(plan.path, 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (checked !== current) throw new Error('Host settings changed during setup; original retained');
    await rename(temporary, plan.path); await syncDirectory(resolve(plan.path, '..'));
  } finally { await release(); await unlink(temporary).catch(() => undefined); }
}
