# Scoped wait-source selection

Selecting one employee previously placed a correlated `EXISTS` beside the
registered-owner condition. On the unchanged public 1,000-session fixture this
joined 8,000 matching employee events against each of 900 other snapshots:
about 576 million rejected event pairs. The recursive ancestry step itself
took less than a millisecond. The exact query plan and an ANALYZE control rule
out a missing basic index or stale statistics as a sufficient explanation.

`waitDataset` now selects registered-owner snapshot IDs UNION effective-event
carrier IDs once, then runs the existing recursive UNION. It preserves null
(all employees), an empty selection, zero-event/unavailable owner sources,
cross-employee restored carriers, effective-origin proofs/overrides, and all
verified ancestors. No date, project, Agent or after-enrollment filter was
added to this preparation. The final ordering, 20,001-row sentinel, 128 MiB
original-byte limit, event limit and fresh-original checks are unchanged.
No result identity or stored historical report is rewritten.

The explicit public probe is:

```
node --import tsx tests/wait-selection-performance.ts
```

It requires `SKYNET_CAPACITY_SOURCE` (the unchanged publicly uploaded synthetic
source bundle) and `SKYNET_WAIT_SELECTION_EVIDENCE` (the output JSON path), plus
the normal isolated test runtime variables. It makes one first HTTP wait read,
checks the unchanged 3,000 ms target, then checks current/full/fixed agreement
and late input without changing the old version. It is not part of the default
unit suite and is not a repeated-cold AC32 P95 claim.

Evidence is outside the repository in
`E:/GenCode/Skynet-evidence/v2-2026-10-04`:

- `54-wait-selection-explain.json` captures exact SQL/hash, parameters, indexes,
  statistics and plans: all-owner 6.396 ms versus one-owner 75,980.864 ms server
  execution. This is an instrumented shared-host diagnostic.
- `54-wait-selection-candidate.json` compares every ordered result row and its
  complete metadata for null, empty, one and all-ten employee selections.
  All match. One-owner wall time is 147.8 ms versus 56,304.1 ms old; an explicit
  all-ten array costs 287.8 ms versus 12.9 ms old, retained as a tradeoff.
  ANALYZE leaves the old one-owner query at 73,223.5 ms.
- `54-wait-selection-public-red-02.{txt,json}` is the public performance RED:
  correct 1,900 intervals and 68,400,000 ms, but first read 60,322.8 ms. The
  previous run without `-02` retains a harness field-name error and is not
  labelled the intended RED.
- `54-wait-selection-public-green.json` records 980.48 ms and complete
  current/full/fixed/late agreement on the original 10-employee, four-week,
  1,000-session/80,000-event/19,000-wait source bundle. It is a single sample,
  not a whole-profile or full-product performance acceptance.

The public wait-preparation regressions explicitly retain another registered
owner's restored carrier in the original employee's missing-source result, and
retain a missing zero-event source for its own employee without contaminating
another employee. Existing material, native lifecycle, activity and efficiency
journeys cover the other consumers of the same preparation.

`54-wait-selection-public-regressions.txt` retains the broad run: 14 of 16
checks passed, including material A→B→C, proven-primary ownership, activity
inference, native/unfinished/truncated session timing, waiting lifecycle,
midnight scope and late cross-project activity. Two added assertions initially
used incorrect premises: the old legacy arrangement explicitly removed valid
event proofs, so its foreign carrier was no longer in either old or new
effective-owner seed; a zero-event source without native completion is unknown,
not a known zero. The final test instead removes a foreign carrier's raw file
while its original proof stays valid, and explicitly checks null/known-zero
separately. No product or existing business assertion was relaxed to repair
these premises. The focused `54-wait-selection-scopes.txt` passes 3/3 (41.86 s),
including the original legacy/fault/recovery test and both added ownership
boundaries.
