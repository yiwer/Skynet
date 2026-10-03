# Windows runtime-control diagnosis

The Windows control timeout remains open. On 2026-09-30, an opt-in probe of
the actual `8a99707` package, with temporary tokenless instrumentation,
reproduced two initial-install failures in eight concurrent isolated public
`setup` calls. It used one cached synthetic package/server, Node 24.12.0,
private homes and no user configuration or paid provider calls.

Evidence is retained outside the repository at
`%TEMP%/skynet-test-ySaGHQ/control-probe-summary.json`. Failed rounds 2 and 6
returned the existing `Local runtime is unresponsive; no replacement writer
was started` error after 37.06 and 37.12 seconds. Both retained registrations
were subsequently stopped through their authenticated owned controller.
The six other rounds completed their owned cleanup. The aggregate 543
failed probe observations include assertions and are **not** 543 timeouts.

The two failed states recorded synchronous supervisor child creation taking
2164.11 and 2011.15 ms after the supervisor listener was established. Recorded
event-loop maxima were 4466.93 and 2384.46 ms. The asynchronous diagnostic
writer did not preserve the final client timeout records. Retained client
and server records nevertheless identify the same supervisor connections.
In round 2, client PID 191780 connected in 1.63 ms using local port 51148;
server PID 17972 received that connection 2086 ms after client start,
3 ms after child creation returned. In round 6, client PID 187504 connected
in 1.55 ms using local port 51286; server PID 71800 received it 1966 ms
after client start, again 3 ms after child creation. Both replies finished
with HTTP 200 within 1 ms. Synchronous worker creation blocked the already
listening supervisor event loop beyond the unchanged 1500 ms socket
timeout. This explains the captured two failures; other earlier failures
without these timings remain separate observations.

Earlier public probes with 0, 8 and 24 status callers all passed. Four
concurrent fresh installs also passed. The original installation/plugin
pair passed 2/2 in 107.74 seconds under instrumentation. These passing
conditions do not resolve the actual full-suite failures.

## Ranked predictions before intervention

1. Synchronous Windows child creation blocks the supervisor listener. A
   failing supervisor request should connect quickly, then its arrival
   should follow `child-spawn-end`, with an overlapping event-loop stall.
2. Client scheduling or diagnostic I/O delays the request. Client timer and
   socket callbacks should stall while the matching server can respond;
   the supervisor child-spawn interval should not explain the request.
3. Worker initialization blocks its listener. Failures should identify the
   worker role and its loop stall, independently of supervisor creation.
4. Task/listener startup timing delays TCP connection. Failures should occur
   before `connect`, with registration/listener timing explaining the gap.

A bounded synchronous terminal-only diagnostic record was prepared outside
the final product source so an uncaught CLI failure retains its timing.
No control timeout, ownership, port registration or capture fence was changed.

## Silent launch preparation

After the user reported console windows, all installation/pressure loops
were paused. Static review found `windowsHide: true` on the probe's Node,
Docker and CLI children and on the guardian/supervisor/worker chain. Task
registration helpers additionally use PowerShell `-WindowStyle Hidden`.
The persistent Task action still invoked Node with PowerShell's call
operator, without explicitly preventing the child console.

`apps/collector/autostart.ts` now starts that exact registered Node through
`System.Diagnostics.ProcessStartInfo` with `UseShellExecute=false`,
`CreateNoWindow=true` and `WindowStyle=Hidden`. It waits on the actual
created Process, reads its ExitCode and disposes it. Normal authenticated
stop still exits on code zero; failure retains the existing bounded
restart delay. Arguments preserve Windows quoting, including trailing
backslashes. Existing Task ownership checks, current-user privilege,
maintenance fences and hidden outer PowerShell arguments are unchanged.

Task operations receive structured registration JSON without overwriting
`autostart.json` before OS ownership validation. An exact previously shipped
action is migrated only after the existing Task independently matches its
action, description, current-user SID and Limited privilege. Changed tasks
or unknown old actions retain their metadata. A new Task left by a crash
before metadata commit is recognized on repair, and a metadata write error
is surfaced. Five pure orchestration regressions cover owned migration,
foreign edits, unknown prior actions and interrupted metadata commits.

`npm run typecheck`, `npm run build` and `git diff --check` pass. No Task was
started after this change. The outer Task Scheduler process creation still
needs one explicitly controlled window observation; real Task installation
loops remain paused. This preparation does not close the 1500 ms fault or
Windows login/reboot acceptance.

After pausing Task loops, one public current-session `start/status/stop`
probe reused the authenticated-stopped synthetic round-2 state with its
Task already removed. All three CLI actions and 40 authenticated queries
passed without additional pressure or timeout. Evidence is
`%TEMP%/skynet-test-ySaGHQ/hidden-current-session-control-probe.json`.
This is a different workload from eight concurrent fresh Task installs.

## Control worker process isolation

`worker-process.ts` and `worker-process-thread.ts` now move actual child
creation, IPC, stderr and the owned ChildProcess into one Worker thread.
The supervisor retains its authenticated OS lease, instance, selected
runtime and capture fences. During child creation it can answer status and
accept stop. A stop queued before the child exists is applied after its
normal handshake; the existing 10-second fallback kills only the actual
ChildProcess created in that thread. Normal thread completion follows actual
child exit. An unexpected thread fault reports `fault=launch-thread`; thread
exit alone does not prove the native child's asynchronous drain has finished.
Before restart or final stop, the supervisor authenticates the worker,
requires its own supervisor instance, requests stop and waits for the actual
worker endpoint to release. A different instance or ambiguous control result
fails closed. Crash exit, selected payload restart and bounded backoff retain
their previous behavior.

The maintained regression uses a trusted private `NODE_OPTIONS --require`
shim to wrap the actual `child_process.spawn` call for `background-worker`.
It synchronously blocks that call for 2200 ms, longer than the unchanged
1500 ms control timeout. It does not delay child bootstrap and introduces
no production environment switch, HTTP privilege or worker-entry override.
The pre-fix main-thread implementation was **RED** in 2.61 seconds with the
same `Local runtime is unresponsive` error. After isolation, real HTTP
status and stop must both finish before the shim's spawn-return marker,
and the actual pending-stop child must exit zero without a restart.

Final focused verification:

```powershell
npm run typecheck
npm run build
node --test dist/tests/control-spawn.test.js dist/tests/runtime-control.test.js dist/tests/autostart-registration.test.js
git diff --check
```

The initial **12/12 pass**, 4.15 seconds. Fixture
`%TEMP%/skynet-control-spawn-9eULd3/control-spawn-evidence.json` records status
**6.82 ms**, stop **1.93 ms**, both acknowledged during the 2200 ms synchronous
spawn block. The control registration remains byte-identical; actual child
exit is zero and both role listeners release. Fixture
`%TEMP%/skynet-control-spawn-MNCe0A/spawn-events.jsonl` records synthetic exit
17 followed by the actual selected CLI worker, two owned child exits and
normal final exit zero. Existing timeout/500/503/non-HTTP fail-closed
regressions and all five Task migration orchestration cases pass.

Review identified the thread-fault drain interval as a separate boundary.
A regression throws in the launch thread only after the real native worker
is ready, then delays that worker's actual `Server.close` by 2500 ms while
its authenticated lease remains live. Before reconciliation,
`%TEMP%/skynet-control-spawn-DrNWY9` was **RED**: three child launches instead
of two because restart raced the old native lease. After reconciliation,
the focused suite is **14/14 pass**, 11.32 seconds. Fixture
`%TEMP%/skynet-control-spawn-3EHayK/spawn-events.jsonl` records one replacement
strictly after the old lease releases. Fixture
`%TEMP%/skynet-control-spawn-pgqdYS/spawn-events.jsonl` verifies status/stop
remain available during that drain, no replacement is launched, and the
supervisor exits zero only after native lease release. The retained actual
`a4ca34c` compiled `runtime.js` has IPC-disconnect abort at line 84 and
finally releases its lease at lines 173–177; that is static compatibility
evidence, not a new old-payload execution claim.

Integrated commit `6089062` also passed Linux CI typecheck, build and
**45/45 tests**, zero failures or cancellations, in 107.94 seconds:
[CI job](https://github.com/yiwer/Skynet/actions/runs/36687101484/job/109795360132).
This includes the launch-thread and Task-registration orchestration regressions;
it does not execute a real Windows Task.

Temporary diagnostic sources and compiled artifacts are retained only in
`%TEMP%/skynet-v1-implementation/runtime-control-temporary-instrumentation`;
the final product contains no DEBUG hooks. No real Task installation or
full Windows suite was run after the silent action change. Next: observe
one controlled Windows Task launch for window behavior before rerunning
the original full-suite workload; keep previous failure records until that
condition passes.
