# Persist only missing insight views

This partial AC32 slice reduces repeated derived-view writes. It does not cache originals, change analysis applicability or the fact-cache strategy, or satisfy the final performance acceptance by itself.

`readInsightBatchOnce` still performs fresh raw reads and the same current fact, history, analysis and correction projection. After computing view versions, one version-key query on the existing repeatable-read client identifies views already stored. Only missing versions enter the existing batches of at most 100 INSERT rows. `ON CONFLICT DO NOTHING` and the existing bounded transaction retry remain necessary for concurrent first readers. An unavailable observation keeps its distinct version; recovery can return to the normal version. Fixed historical payloads are never rewritten.

The INSERT envelope now contains only the recordset fields plus the complete payload. Previously `{...view,payload:view}` serialized the entire view twice. The returned current result is still the computed view, not a substituted stored payload. Full mode still recomputes facts from raw bytes. Existing fact persistence is unchanged.

## Baseline and public verification

The preserved public profile probe at accepted `1d2d926` returned the same complete reading page twice, but took 34,752.7 ms initially and 25,660.1 ms subsequently for the unchanged 10-person / four-week / 1,000-session / 80,000-event / 19,000-wait source bundle. Those readings exceed the unchanged 3s/1s targets. They are instrumented shared-host diagnostic samples, not P95.

Its session-view INSERT statement ran 47 times, taking 5,693.7 / 5,378.3 ms. The old observer's `rows` means returned rows, not inserted rows; zero must not be reported as zero writes. Fact INSERT occurred only on the first read. No repeated `full=true` cause is claimed for a normal profile GET.

`tests/insight-persistence.test.ts` uses the approved public upload, deterministic Analysis and HTTP seams. Two concurrent first reads publish identical unknown views; completed Analysis publishes a new complete view; a correction changes it; full recomputation retains it; a real owned-file fault produces a distinct unavailable view; recovery and restart preserve all published fixed views. It passed on the baseline before implementation and on the candidate. The performance baseline supplies the optimization RED; this functional regression guards semantics.

`tests/insight-persistence-upgrade.ts` is an explicit same-database old/new differential script. It compares complete public insight pages and complete Usage exports through pre-analysis, complete Analysis, correction, outage and recovery, then checks fixed versions after restart. Run with `SKYNET_INSIGHT_PREVIOUS_SOURCE` pointing to a fixed accepted checkout and `SKYNET_INSIGHT_PERSISTENCE_EVIDENCE` pointing outside the repository.

The external `54-insight-persistence-cost-probe.mjs` accepts a worktree and evidence prefix. It records returned rows separately from affected rows and measures supplied parameter byte lengths without recording values. It preserves the strict 3,000ms/1,000ms single-sample assertions after functional evidence and cleanup. A successful single sample still cannot sign off P95. The old observer and outputs are preserved.

## Measured candidate and limits

The v2 observer compared clean accepted `1d2d926` with clean candidate `d6ea0da`, each using its own restored copy of the same public-upload source bundle. Both public profile reads returned HTTP 200 with 32,542 bytes; repeated and fixed reading pages were equal, with 100 selected employee sessions, 2,000 prompts and 1,900 known waits. The diagnostic completed and cleaned up before its unchanged timing assertions failed.

| Measurement | Accepted first / subsequent | Candidate first / subsequent |
| --- | --- | --- |
| Complete profile elapsed time | 33,514 / 25,410 ms | 27,065 / 18,135 ms |
| Session-view INSERT calls | 47 / 47 | 10 / 0 |
| Session-view INSERT parameter bytes | 304,265,321 / 304,265,321 | 34,045,893 / 0 |
| Session-view INSERT affected rows | 1,000 / 0 | 1,000 / 0 |
| Session-view INSERT returned rows | 0 / 0 | 0 / 0 |
| Fresh raw reads | 12,705 / 12,705 | 12,705 / 12,705 |

The candidate's seven version-key queries supplied 301,842 parameter bytes per read. Fact INSERT remained ten calls and 1,000 affected rows on the first read, with none subsequently. Parameter byte totals describe supplied values, not PostgreSQL wire traffic. The measurements demonstrate that subsequent view persistence sends no full payload while new views still persist. They do not isolate all causes of total elapsed-time variation.

The 3s/1s performance gates remain **failed**. These are instrumented single samples on a shared host, not the required independent first-read and subsequent-read P95 distribution. This slice is a partial optimization only.

Candidate build and the three selected public regressions passed. The same-database old/new script passed all five stages (before Analysis, complete Analysis, correction, raw outage, recovery), full recomputation and historical reads after restart. The new semantic regression also passed on the accepted baseline; it is not mislabeled as a functional RED. Source data, fact strategy, public limits, and transaction retry budgets remain unchanged.

Final candidate, exact public results, differential hashes and measured costs are recorded in the external `54-insight-persistence-author-verification.json` receipt. Independent review and deployment are separate steps.
