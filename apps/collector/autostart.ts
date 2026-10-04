import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { atomicJson } from '../../packages/filesystem.js';
import { optionalJson, type Installation } from './install-state.js';
import { registerTask, type TaskRegistration } from './autostart-registration.js';

const execute = promisify(execFile);
const lifecycle = { login: 'not-verified', reboot: 'not-verified', sleepResume: 'not-verified', desktopIcon: 'not-verified' };
type Registration = TaskRegistration;
function powershell() { return join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'); }
function windowsArgument(value: string) { return `"${value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1')}"`; }
function supervisorAction(installation: Installation, canonical: string) {
  const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
  // .NET Framework ProcessStartInfo has Arguments, not ArgumentList. Preserve
  // each Windows argv element, including trailing backslashes, as one argument.
  const argumentsText = [installation.launcher, 'background', '--state', canonical].map(windowsArgument).join(' ');
  // Keep the task action alive across a supervisor crash. An authenticated
  // normal stop ends the action; no PID recovered from a file is authority.
  // The task's Hidden setting does not hide a console child. Start the exact
  // registered executable without a shell or a new console and wait on the
  // Process object we created. The outer PowerShell still requests Hidden;
  // its initial Task Scheduler window behavior needs separate observation.
  const script = `$ErrorActionPreference='Stop'; Remove-Item Env:SKYNET_KEY -ErrorAction SilentlyContinue; $delay=1; while($true){$started=[DateTime]::UtcNow; $startInfo=New-Object System.Diagnostics.ProcessStartInfo; $startInfo.FileName=${quote(installation.node)}; $startInfo.Arguments=${quote(argumentsText)}; $startInfo.UseShellExecute=$false; $startInfo.CreateNoWindow=$true; $startInfo.WindowStyle=[System.Diagnostics.ProcessWindowStyle]::Hidden; $ownedChild=New-Object System.Diagnostics.Process; $ownedChild.StartInfo=$startInfo; try{if(-not $ownedChild.Start()){throw 'Registered supervisor could not start'}; $ownedChild.WaitForExit(); $exitCode=$ownedChild.ExitCode}finally{$ownedChild.Dispose()}; if($exitCode -eq 0){exit 0}; if(([DateTime]::UtcNow-$started).TotalSeconds -ge 30){$delay=1}; Start-Sleep -Seconds $delay; $delay=[Math]::Min(30,$delay*2)}`;
  return { command: powershell(), arguments: `-NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand ${Buffer.from(script, 'utf16le').toString('base64')}` };
}
function legacySupervisorArguments(installation: Installation, canonical: string) {
  const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
  // Recognize only the previously shipped owned action; this is never started.
  const script = `$ErrorActionPreference='Stop'; Remove-Item Env:SKYNET_KEY -ErrorAction SilentlyContinue; $delay=1; while($true){$started=[DateTime]::UtcNow; & ${quote(installation.node)} ${quote(installation.launcher)} 'background' '--state' ${quote(canonical)}; if($LASTEXITCODE -eq 0){exit 0}; if(([DateTime]::UtcNow-$started).TotalSeconds -ge 30){$delay=1}; Start-Sleep -Seconds $delay; $delay=[Math]::Min(30,$delay*2)}`;
  return `-NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand ${Buffer.from(script, 'utf16le').toString('base64')}`;
}
export async function launchCurrentSession(state: string, installation: Installation) {
  if (process.platform === 'win32') {
    // PowerShell callers can leave inheritable pipe handles in a detached Node
    // descendant even with stdio:'ignore'. ShellExecute isolates the hidden
    // guardian from those handles; it still owns and retries its actual child.
    const launch = { file: installation.node, arguments: [installation.launcher, 'background-guardian', '--state', state].map(windowsArgument).join(' ') };
    const script = `$ErrorActionPreference='Stop'; $r=$env:SKYNET_CURRENT_SESSION_LAUNCH | ConvertFrom-Json; Remove-Item Env:SKYNET_CURRENT_SESSION_LAUNCH; $i=New-Object System.Diagnostics.ProcessStartInfo; $i.FileName=$r.file; $i.Arguments=$r.arguments; $i.UseShellExecute=$true; $i.WindowStyle=[System.Diagnostics.ProcessWindowStyle]::Hidden; $p=[System.Diagnostics.Process]::Start($i); if($null -eq $p){throw 'Current-session guardian could not start'}; $p.Dispose()`;
    await execute(powershell(), ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      { windowsHide: true, timeout: 15_000, maxBuffer: 8192, env: { ...process.env, SKYNET_KEY: undefined, SKYNET_CURRENT_SESSION_LAUNCH: JSON.stringify(launch) } });
    return;
  }
  const child = spawn(installation.node, [installation.launcher, 'background', '--state', state],
    { detached: true, windowsHide: true, stdio: 'ignore', env: { ...process.env, SKYNET_KEY: undefined } });
  child.on('error', () => undefined); child.unref();
}
async function windowsTask(state: string, mode: 'register' | 'start' | 'inspect' | 'remove', registration: Registration) {
  // All task fields are JSON data. No path or identifier is interpolated into shell code.
  const script = `$ErrorActionPreference='Stop'; $r=$env:SKYNET_AUTOSTART_REGISTRATION | ConvertFrom-Json; $sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value;
$t=Get-ScheduledTask -TaskName $r.taskName -ErrorAction SilentlyContinue;
if($t){if($t.Principal.UserId -like 'S-1-*'){$taskSid=$t.Principal.UserId}else{$taskSid=(New-Object System.Security.Principal.NTAccount($t.Principal.UserId)).Translate([System.Security.Principal.SecurityIdentifier]).Value}; if($t.Description -ne $r.description -or @($t.Actions).Count -ne 1 -or $t.Actions[0].Execute -ne $r.command -or $t.Actions[0].Arguments -ne $r.arguments -or $taskSid -ne $sid -or [string]$t.Principal.RunLevel -ne 'Limited' -or [string]$t.Principal.LogonType -ne 'Interactive'){throw 'Existing task ownership or privilege conflict; retained unchanged'}};
switch($env:SKYNET_AUTOSTART_ACTION){
'register' {if(-not $t){$a=New-ScheduledTaskAction -Execute $r.command -Argument $r.arguments; $p=New-ScheduledTaskPrincipal -UserId $sid -LogonType Interactive -RunLevel Limited; $g=New-ScheduledTaskTrigger -AtLogOn -User $sid; $s=New-ScheduledTaskSettingsSet -Hidden -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero); Register-ScheduledTask -TaskName $r.taskName -Description $r.description -Action $a -Principal $p -Trigger $g -Settings $s | Out-Null}; 'registered'}
'start' {if(-not $t){throw 'Registered task is missing; rerun setup'}; if(-not $t.Settings.Enabled -or [string]$t.State -eq 'Disabled'){throw 'Registered task is disabled; inspect Windows Task Scheduler policy'}; Start-ScheduledTask -TaskName $r.taskName; 'started'}
'inspect' {if(-not $t){'missing'}elseif(-not $t.Settings.Enabled){'Disabled'}else{[string]$t.State}}
'remove' {if($t){Unregister-ScheduledTask -TaskName $r.taskName -Confirm:$false}; 'removed'}
}`;
  const result = await execute(powershell(), ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    { windowsHide: true, timeout: 15_000, maxBuffer: 8192, env: { ...process.env, SKYNET_KEY: undefined, SKYNET_AUTOSTART_ACTION: mode, SKYNET_AUTOSTART_REGISTRATION: JSON.stringify(registration) } });
  return result.stdout.trim();
}
export async function installAutostart(state: string, installation: Installation) {
  const previous = await optionalJson(join(state, 'autostart.json')) as Registration | null;
  if (process.platform !== 'win32') {
    const value: Registration = { state: 'degraded', adapter: 'current-session-only', checkedAt: new Date().toISOString(), lifecycle,
      error: 'Login integration is not yet implemented or measured on this OS. Run skynet start after login; keep Node at its registered absolute path.' };
    await atomicJson(join(state, 'autostart.json'), value); return value;
  }
  const canonical = await realpath(state); const tag = createHash('sha256').update(canonical.toLowerCase()).digest('hex').slice(0, 24);
  const action = supervisorAction(installation, canonical);
  const value: Registration = { state: 'registering', adapter: 'windows-user-task', taskName: `Skynet-${tag}`, command: powershell(),
    arguments: action.arguments,
    description: `Skynet current-user collector ${tag}`, checkedAt: new Date().toISOString(), lifecycle };
  if (previous && previous.taskName === value.taskName && previous.command === value.command && previous.arguments === value.arguments) value.fallback = previous.fallback;
  return registerTask(previous, value, legacySupervisorArguments(installation, canonical), {
    task: (mode, registration) => windowsTask(state, mode, registration),
    save: registration => atomicJson(join(state, 'autostart.json'), registration),
  });
}
export async function startAutostart(state: string) {
  const value = await optionalJson(join(state, 'autostart.json')) as Registration | null;
  if (value?.adapter !== 'windows-user-task' || value.state !== 'registered') return false;
  try { await windowsTask(state, 'start', value); return true; }
  catch { await atomicJson(join(state, 'autostart.json'), { ...value, state: 'degraded', error: 'The registered user task could not start. Current-session fallback is active; inspect Task Scheduler and rerun setup.',
    fallback: { observedAt: new Date().toISOString(), notice: 'Current-session launch was used after the registered task failed; this is an observation, not login/reboot validation.' } }); return false; }
}
export async function markAutostartDelayed(state: string) {
  const value = await optionalJson(join(state, 'autostart.json'));
  if (value) await atomicJson(join(state, 'autostart.json'), { ...value, state: 'degraded',
    error: 'The user task did not establish runtime ownership. A current-session background was started; inspect Task Scheduler and run setup again.',
    fallback: { observedAt: new Date().toISOString(), notice: 'Current-session launch was used after delayed task ownership; this does not prove login/reboot operation.' } });
}
export async function autostartStatus(state: string) {
  const value = await optionalJson(join(state, 'autostart.json')) as Registration | null;
  if (value?.adapter !== 'windows-user-task' || value.state === 'removed') return value;
  try {
    const taskState = await windowsTask(state, 'inspect', value);
    return { ...value, taskState, state: taskState === 'missing' || taskState === 'Disabled' ? 'degraded' : value.state,
      ...(taskState === 'missing' || taskState === 'Disabled' ? { error: 'Autostart task is missing or disabled. Rerun setup or inspect user task policy.' } : {}) };
  } catch { return { ...value, state: 'degraded', error: 'Autostart registration cannot be verified or was changed. Existing task was not modified; inspect Task Scheduler.' }; }
}
export async function removeAutostart(state: string) {
  const value = await optionalJson(join(state, 'autostart.json')) as Registration | null;
  if (value?.adapter === 'windows-user-task') await windowsTask(state, 'remove', value);
  await atomicJson(join(state, 'autostart.json'), { ...value, state: 'removed', checkedAt: new Date().toISOString(), lifecycle });
  return { autostart: 'removed', notice: 'Existing capture and pending evidence remain. Use skynet stop to stop this login session.' };
}
