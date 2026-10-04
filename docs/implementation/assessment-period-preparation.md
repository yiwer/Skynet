# Profile assessment period preparation

The current profile composes its selected assessment with last-week and this-week assessments. One composite attempt now prepares their Usage reports, one since-enrollment baseline and a pool of fixed insight/message inputs. Each period reconstructs its original reference order and keeps range-external prompt/reply context. Baseline scoring consumes the baseline report's own session/version identities. Scores, models, public limits and fixed historical readers are unchanged.

`assessmentService.withProfile` owns this preparation. It sequences preparation against standalone assessment readers without sharing a computed Promise between requests. `assessmentPeriods` keeps immutable inputs inside that attempt; no raw bytes or completed cross-request results are cached. The full-recompute route retains its previous preparation path. Pools over 2,000 fixed references or 96 MiB decline reuse and execute the previous complete path.

The same `RawStore` instance used by the application records actual reads throughout preparation **and the complete composition callback**, including proof/ancestor reads, sources with no business events, and typed source failures. An instance-local async scope retains only identities and observed availability/hash outcomes. Repeated conflicting observations invalidate the attempt. After the callback, up to four fresh reads verify the captured sources. An availability or integrity change uses the existing outer three-attempt reporting budget; it does not add another retry loop. Stable unavailable sources remain unknown. Unexpected read errors drain already-started verification work and propagate unchanged.

Observation metadata exceeding 20,000 identities or 4 MiB declines reuse without throwing from an ordinary raw read. The incomplete shared result is discarded and the old path runs. The public report's original capacity limits remain in force. Fixed data are frozen before sharing; per-period Map ordering still keeps the first position and last value for repeated message identities.

## Validation

The public source-disappearance regression fails on accepted `726e32e` and passes with whole-callback revalidation. It includes a baseline-only team source and a zero-event source. Continuous real source changes return the existing bounded 409 and preserve fixed history; restoration yields the earlier complete result. Independent simultaneous employee profiles, native multi-block messages, restored ownership, truncated history and concurrent source upload are covered through existing public seams.

`tests/assessment-periods-upgrade.ts` uses the same database with the accepted old binary and candidate. It compares complete current profiles, bounded pages, full recomputation, referenced assessments and fixed history across three periods and presets, nullable inference correction, unavailable original, recovery, late input and future-week context. It pins unrelated report refresh scheduling while retaining all work-content assertions, then checks fixed history after restart.

`tests/assessment-periods-budget.ts` is an explicit 2,001-session public-upload capacity journey proving that the optimization boundary falls back to the complete result, including unknown inferences. External evidence under `54-assessment-periods-*` records exact commits, failures and timings. Performance diagnostics retain the unchanged 3 s / 1 s gates and are not P95 acceptance.

## Fixed candidate evidence

Candidate `e810304` passed all 24 same-database comparison groups, including a Wednesday as-of date with a future Friday append carrier and independent source. The 2,001-reference fallback retained all 2,001 sessions, 20,010 input Tokens, one known and 2,000 unknown first-prompt element observations; its 1,633,676-byte complete result matched full recomputation and fixed history after restart. A separate same-database 1,000-session old/new run compared the entire 134,021-byte employee export, including its work revisions, strictly equal.

One serial instrumented first/subsequent read on each binary used the same original public-upload source bundle (10 employees, four weeks, 1,000 logical sessions, 80,000 events and 19,000 waits):

| Measurement | Accepted 726e32e | Candidate e810304 |
| --- | ---: | ---: |
| First profile | 29,867 ms | 21,935 ms |
| Subsequent profile | 19,361 ms | 12,986 ms |
| Raw reads per request | 12,705 | 9,705 |
| Subsequent cached fact rows | 4,505 | 2,505 |
| Subsequent insight-view INSERTs | 0 | 0 |

The candidate's raw reads include the final 1,000-source fresh verification. This is removal of repeated preparation, not a raw cache. Both 3,000/1,000 ms assertions still fail; the sample is not P95 or AC32 acceptance. The independent restored databases produced different profile versions, with no complete cross-clone payload retained to establish a cause. Consequently those runs establish cost and within-run current/fixed consistency only. Semantic equivalence is established separately by the same-database differential evidence; the cross-clone hash difference is not silently normalized or called equal.

Earlier fixture scheduling failures and the same-employee activity-lock observation remain in `54-assessment-periods-fixture-triage.md`. The pre-freeze `upgrade-final.json` recorded HEAD `8cfb674` with uncommitted whole-callback changes; the clean `upgrade-e810304.json` supersedes it for final code provenance. No old failure log is overwritten.
