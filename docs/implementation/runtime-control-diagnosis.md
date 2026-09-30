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
writer did not preserve the final client timeout records, so these values
do not yet correlate the failed role/request with that stall.

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

The next diagnostic change is a bounded synchronous terminal-only record
so an uncaught CLI failure retains its request timing. No control timeout,
ownership, port registration or capture fence has been changed.

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

`npm run typecheck`, `npm run build` and `git diff --check` pass. No Task was
started after this change. The outer Task Scheduler process creation still
needs one explicitly controlled window observation; real Task installation
loops remain paused. This preparation does not close the 1500 ms fault or
Windows login/reboot acceptance.
