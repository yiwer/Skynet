# Usage carrier membership preparation

This AC32 slice keeps the Usage result and version contract intact while avoiding
the row-by-all-views scan in `usage-output.ts`. The public read still obtains the
same complete metric and current carrier insights, including current raw checks.

The request-local index maps the existing `(original snapshot, source, native
session)` key to **all** matching row indices. Separate employee/project rows
must remain separate. Views are then visited in their original order; a set of
matched indices prevents multiple origins from adding one occurrence twice to a
row. Separate occurrences in the input views remain separate. Completeness,
native leaves, output attribution, unknowns and fixed-version persistence retain
their previous rules.

The pre-change public HTTP diagnostic at `f3e7507` retained the original source
bundle (10 employees, four weeks, 1,000 sessions, 80,000 business events, 19,000
waits and 20 analyzed sessions). First read was 9,458.3 ms and the subsequent
read was 3,250.9 ms. Complete current/full/fixed payload equality and known totals
passed before the unchanged 3,000 / 1,000 ms gate failed. This is a shared-host
single pair, not P95.

Author build and the 10 existing public cases in `usage-output.test.ts`,
`source-isolation.test.ts` and `profile-preparation.test.ts` pass (132,798.7 ms).
They cover restored ownership, parent/child material, unknown inputs, source
loss/recovery, correction, periods, full recalculation and frozen history. The
first attempt lacked this new worktree's compiled provision CLI and all ten
cases failed with `MODULE_NOT_FOUND`; that infrastructure log is retained as
`54-usage-membership-public-unbuilt.txt`. After building the candidate, the same
ten unchanged cases passed. This initial failure is not a product RED.

The explicit diagnostic `tests/usage-membership-performance.ts` is intentionally
outside ordinary discovery. It verifies full results before applying the
unchanged latency gates. Candidate measurement, same-database upgrade comparison
and independent acceptance are recorded in the external evidence directory;
this narrow change does not establish complete AC32 or V2 acceptance.
