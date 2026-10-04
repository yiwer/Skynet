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

Final candidate, exact public results, differential hashes and measured costs are recorded in the external `54-insight-persistence-author-verification.json` receipt. Independent review and deployment are separate steps.
