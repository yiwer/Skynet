# Wait recompute reading-page regression

The verified failing baseline is the saved `ci-298a743-shard2/tests.txt`
artifact and its source commit
`298a743fcc89fb1163943d89bb34b599fb3f8fe6`.

The restored-carrier source-isolation test compared the JSON returned by
`POST /api/waits/recompute` with a complete export. Since waiting pagination,
recompute returns the same bounded reading-page contract as `GET /api/waits`:
it additionally has `readingVersion`, per-section page metadata and an employee
section. A complete export intentionally has neither the reading wrapper nor
that additional transport section.

The unmodified public test failed at line 101 in both the CI artifact and the
local `54-wait-integrity-public.txt` run (9/10 passed). Its source is identical
at that local candidate and the CI baseline. The diff preserves the same version,
summary and original intervals; only the reading wrapper differs. The existing
public RED is reused instead of repeating that identical test.

The corrected test retains both checks through public HTTP boundaries:

- The recomputed version equals the pre-outage version, and the complete export
  of that exact version is deeply equal to the original complete export.
- The complete recompute response is deeply equal to the fixed reading page for
  the same employee, period and version.

All existing source corruption, restoration, original-owner attribution,
same-session loss versus parallel unknown, and mismatched employee assertions
remain. No product implementation, retry, budget, timeout or data limit changes.
Other ordinary waiting recompute assertions were inspected: they compare
reading pages with reading pages or explicitly compare complete summaries and
exports. No other assertion was changed without a matching contract mismatch.

Validation and exact candidate identity are recorded in the external
`54-wait-recompute-test-author-verification.json` receipt. This test repair is
not a claim that the complete CI suite or V2 acceptance has passed.

After synchronizing accepted integration `62ab4e3`, `npm run build` passed and
the unchanged restored-carrier scenario with the corrected contract assertions
passed 1/1, no skips, in 13.638 seconds:

```
node --import tsx --test --test-concurrency=1 --test-name-pattern="unavailable restored carriers" tests/source-isolation.test.ts
```

It used isolated PostgreSQL 18.6 and the existing deterministic Analysis fixture;
no external model provider or production data was accessed.
