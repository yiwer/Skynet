# Team report startup consistency

CI at `a5b50e3` returned HTTP 409 in both the four-week team coverage and historical weekly team scenarios. The initial local reproduction passed because initial scheduling ran before device enrollment. Holding the real database scheduler lock until public enrollment completed reproduced both failures without changing their inputs or retry count.

The diagnostic frontier trace showed unchanged originals, qualifications, input integrity, analysis jobs/targets, corrections, employees, devices and capture observations. Only the coverage guard's global daily-report periods and revisions changed. Initial report/work-view scheduling prepared several empty daily reports in succession, invalidating all three composite attempts even though no source had changed.

`coverageFrontier` now guards source inputs only. The coverage matrix already reads daily state and `refresh_pending` together in one SQL statement. That observed derived state is preserved in the complete team payload and therefore in its immutable version. A later visible state change produces a different team version; it is not a new original and does not force the whole current composite to retry. Genuine source/analysis changes remain protected by the unchanged `consistentReportingInputs` boundary.

Public evidence uses the existing HTTP seams and an isolated database scheduling gate. It retains both original scenarios with the future report clock pinned to Beijing noon, so the initial scheduler is due regardless of the test's wall-clock hour. It then verifies daily preparation changes the visible coverage version while usage and old fixed coverage remain unchanged. Existing public concurrent-upload and concurrent-analysis-completion cases still verify that incompatible source inputs cannot be combined.

Evidence is under `E:/GenCode/Skynet-evidence/v2-2026-10-04`: `54-team-startup-gate.txt` and `54-team-startup-frontier-trace.txt` retain RED; `54-team-startup-green.txt` is 2/2, `54-team-consistency-semantic-green.txt` is 4/4, and `54-team-consistency-final-build.txt` records the build. Temporary instrumentation was removed. The first attempt in the new worktree lacked built provision output; its `MODULE_NOT_FOUND` is a setup failure, not the product RED.

This does not resolve the separate 1,000-session capacity failures or complete AC32. The fixed full-size diagnostic and its shared-host boundary are recorded separately in `54-ac32-1000-diagnostic-verification.json`.

## Profile public test contracts

The two CI profile failures were separately reproduced unchanged on the local baseline (`54-profile-contract-baseline-red.txt`, 0/2). The existing tests incorrectly compared a complete download with the bounded first page, and expected one “more sessions” click to consume all remaining sessions. No profile product change was needed.

The browser tests now compare the download with the complete immutable export, assert all six collection totals and first-page prefixes, and explicitly exercise activity beyond the first page. Session pagination follows the actual version-bound cursor, checks progress and every resulting table length, then compares all 25 exact links in order with the frozen export. A session uploaded after the first page stays excluded. These two public browser cases passed in `54-profile-contract-green.txt` (2/2, 41.15 s), retaining responsive/touch/keyboard/source-navigation checks and downloaded evidence.
