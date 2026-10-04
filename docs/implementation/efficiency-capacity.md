# Complete efficiency revisions and bounded reading

The 1,000-session / 80,000-business-event / 19,000-wait source originally returned
HTTP 413 from the session-efficiency first page because complete timing was
serialized behind the old 16-MiB export gate before paging. This change preserves
the calculation and semantic revision identity while separating storage, reading
and explicit complete download. Original-input guards, including the 128-MiB
computation bound, remain unchanged.

## Storage and compatibility

`efficiency-revisions.ts` retains the original `session_efficiency_revisions`
JSONB reader. New revisions use an atomic manifest plus immutable chunks of at
most 64 KiB. Session summaries, each session's timing evidence, and distribution
points are independent chunk collections. Format 2 keeps only bounded metadata
in the root JSON: chunk counts, byte lengths and SHA-256 descriptors are columns
on the chunk rows, and growing distribution points live in their own collection.
The earlier development format 1 remains readable. A missing, malformed or
hash-mismatching chunk is unavailable, never an empty successful result.

One transaction and a per-version advisory lock publish the root and all chunks
together. Chunk boundaries and storage format are excluded from the canonical
semantic report hash. The calculation's algorithm version is unchanged. Fixed
scope validation, unknown values and source evidence remain part of the result.

The migration is additive and called by `migrateSessionEfficiency`; it does not
alter `database.ts`, original data, Analysis credentials or worker configuration.
An older binary can still read its existing JSONB revisions. It cannot read new
chunk-only revisions. Rollback must preserve the additive tables and cannot
promise availability of newer fixed links until the upgraded reader is restored.
Deployment must review this database boundary and the existing worker guard; no
guard bypass is part of this change.

## Public interfaces

The existing endpoint returns adaptive session and evidence pages under both the
80-KiB HTTP ceiling and the actual 48-KiB MCP envelope. Cursors advance by the
number actually returned. A single item that cannot fit yields an explicit 413
with fixed version/section/index identity; it does not truncate source references.

`section=summaries` returns session summaries with empty segment arrays and their
real segment totals. `section=distributionPoints` pages the complete distribution
point collection. Any explicit section, including offset zero, requires a fixed
version and cannot mix a session or segment selection. Current/recompute still
use the original complete calculation; full recomputation rejects fixed or page
selectors. Small complete results retain their previous shape.

Fixed-session `segmentOffset` accepts safe nonnegative integers: the original
100,000-message calculation bound is not a bound on the number of resulting
agent/reply/gap segments. The cursor only addresses the already materialized
collection; it never allocates or loops in proportion to the supplied number.
Each response still reads at most 20 segments, with the same byte ceilings.
The public 100,001 cursor was first rejected (RED), then returned an empty tail
with the same fixed version and segment total; a missing fixed version and an
unsafe integer remain invalid. This checks addressing and bounds, not a dynamic
claim that a 200,000-segment fixture has been exercised.

Web charts and review entries load fixed summary pages, selected conversations
load their fixed segment pages, and table navigation stores actual preceding
offsets. Chart rendering does not request a complete export. The explicit export
action downloads complete evidence through `report-download.ts`; see
`report-downloads.md` for its read-only transaction, preflight integrity and abort
lifecycle.

## Evidence and remaining acceptance

External evidence lives under `E:/GenCode/Skynet-evidence/v2-2026-10-04/` with the
`54-efficiency-` prefix. The original first-page 413 and MCP-envelope failure are
retained. Early public GREEN includes the unchanged 1,000-session source and
seven existing efficiency semantics, fixed summary/point reads, and an explicit
Web export journey across adaptive pages. One initial Web assertion assumed
exactly two pages; its failed log is retained as a fixture assumption, then the
corrected journey traversed actual cursors and verified all 21 distinct sessions.

The first download RED lacked ETag. The small download GREEN checks byte length,
SHA-256, all 25 segments, scope conflict, late input and restart preserving old
bytes. The complete 1,000-session regression passed in 194.096 seconds, including
the actual MCP envelope, a download above 16 MiB with all 39,000 segments, all
1,000 fixed summaries, full recomputation matching the initial page, ten actual
HTTP disconnects followed by a complete download, and late input plus restart
preserving old download bytes. This is a capacity/correctness check, not a timing
threshold or P95 measurement.

An independent accepted legacy binary (complete-inputs candidate `d42ee4`, whose
reporting implementation is the accepted `8048ecb` baseline) created old JSONB
revisions in an isolated public fixture. The upgraded HTTP fixed/current/full
views preserved its exact version and payload; complete exports matched all 30
segments, old revisions survived late input and restart, and the old reader still
read its previous version. No handcrafted legacy row or private result assertion
was used. The external upgrade test passed in 14.207 seconds.

Adaptive table navigation also had a public RED where enabling the review filter
from page two reset the data offset but retained its page-number stack. The
filter now resets both together; the complete Web journey passes. Final
integration and visual evidence are recorded with the author receipt. None of
these functional runs is full AC32 P95 acceptance.
