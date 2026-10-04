# Complete wait downloads and bounded reading

This AC32 capacity slice keeps the recorded-wait algorithm, original input bounds,
ownership, unknown values and immutable revision identity unchanged. It is a
functional result, not cold/warm latency acceptance.

## Boundary

The authenticated `/api/waits/export` endpoint resolves a current selection once,
or validates the supplied fixed version, then streams the complete JSON report.
The legacy `wait_revisions` JSONB rows remain in place: no migration, history
rewrite or new storage format is needed. `wait-reading.ts` reads bounded header
metadata, validates the interval count and walks the ordered arrays through an
SQL cursor. It preserves optional absent legacy `unavailableSources` and emits
bounded UTF-8 buffers. JSON object property order can differ from the former
single-object serializer; semantic values and the stored report version do not.

The exact shared `report-download.ts` from efficiency commit `2c98816` owns a
read-only repeatable-read transaction, complete preflight and the streaming pass.
The response includes its fixed ETag, filename, exact Content-Length and SHA-256.
Late uploads cannot enter that snapshot. The first public RED was the unchanged
19,000-interval fixture's 16 MiB export rejection. It now downloads all 21,931,524
bytes. This replaces a whole-response transport restriction with bounded
streaming; the 20,000-source, 128 MiB original, 100,000-event and date-range
calculation guards remain. `complete`/`forScope` still supply complete internal
inputs and never consume a public page or download.

## Fixed page contract

`/api/waits`, recompute and `read_waits` return `readingVersion: wait-page-1`.
`summary`, `total` and unknown flags describe the whole fixed report. `pages`
contains `{ total, offset, nextOffset }` for four collections:

- `intervals`: ordered original waiting intervals, at most 25 per page.
- `daily`: ordered Beijing dates, at most 100 per page.
- `unavailableSources`: complete owner-specific unavailable source records.
- `employees`: fixed employee facets from intervals and unavailable sources.

Every explicit section requires `version`, even at offset zero. A first page can
contain only part of another collection, including zero items with nextOffset
zero; this never changes that collection's total. Nonselected section responses
carry empty arrays plus truthful descriptors. The actual JSON is capped at
32 KiB, and its escaped MCP content envelope at 48 KiB. Trimming reduces item
counts, never an item's evidence. An individually oversized requested item fails
explicitly with version, section and offset; complete download stays available.
No global MCP budget was raised. Existing snapshot/employee/source/project/week
checks remain, and fixed dates remain valid when the wall clock changes weeks.

Conversation `lines`/`contextSnapshotId` retain their separate label selection;
they cannot mix with report sections. A line selection returns every matching
label or a bounded error, and its list offset does not change those matches.

## Browser

WaitingReport loads employee facets through fixed bounded pages, instead of
automatically exporting the report. Each scope/version clears the prior facets
and aborts their requests. Daily/source details continue from their fixed cursor;
their total controls visibility and unknown-state presentation even when the
first array is empty. Interval navigation remembers actual cursors rather than
subtracting 25 from an adaptive page. Explicit export remains a user action.

New controls and existing controls on this page have 44 px targets. The 24-hour
heatmap scrolls inside its own region when needed. Screenshots and browser
checks cover 320, 390, 768, 1280 and 1920 in both themes; the outside page does
not scroll. The conversation wait-marker styles outside this page are unchanged.

## Evidence

External evidence is under `E:/GenCode/Skynet-evidence/v2-2026-10-04`:

- `54-waits-download-01-red.txt`: original full-scale export 413.
- `54-waits-download-03-green.txt`: first complete 19,000-interval download,
  length/hash/known 684,000,000 ms/permission nulls, late/full/restart invariance.
- `54-waits-download-04-pages-red.txt` / `06-pages-green.txt`: 130 dates and
  40 missing originals, original first-page 413 and bounded reconstruction.
- `54-waits-download-08-web-red.txt`: automatic full export used for facets.
- `54-waits-download-11-web-green.txt`: retained target-size RED after the
  functional browser path passed. `13-web-green.txt` passes the full browser
  path, stale-facet isolation, tail page, keyboard, explicit download and 10
  viewport/theme states. Screenshots are in `54-waits-download/web`.
- `54-waits-download-14-http-mcp-web.txt` retains a detail-button polling timeout;
  unchanged product with extra HTTP/DOM diagnostics passed in `15-detail-diagnostic.txt`.
  The final test waits for visible rows to advance rather than racing button
  disappearance/enablement. No unproven product root cause is claimed.
- `54-waits-download-16-integrated.txt`: 7/7 public regressions, including the
  full-scale download and all fixed interval/daily/source pages, actual OAuth
  MCP reconstruction, long detail lists, original wait/report/conversation
  journeys and unavailable-source UI. The full-scale case also corrupts only
  its derived revision header, verifies preflight 503 without download headers,
  restores it, then performs 10 actual HTTP disconnects followed by a complete
  paused-consumer download. No private cache/call-count assertions.
- `54-waits-download-18-legacy.txt`: actual pre-upgrade server source at
  `2714486` creates the immutable report; after stopping that process, the new
  server reads/downloads the same semantic value and evidence with its original
  version from the same self-owned database. The external probe's first run
  (`17-legacy.txt`) failed before setup because Windows ESM needed file URLs;
  that harness error is retained.
- `54-waits-download-19-lines-red.txt` / `20-lines-green.txt`: a conversation
  line request carrying a prior list offset remains a complete label selection;
  the old offset-independent behavior is preserved after the new page projector.

The original full-scale synthetic bundle hash is
`28ceeb76fce762ea6ee21f5564427caaedb3f42b3b9741b0d04302fca53243e1`.
Its 10 employees, four weeks, 1,000 sessions, 80,000 business events and 19,000
waits are unchanged. Fixture databases/raw files are isolated and owned.
There is no claim of a bounded slow-consumer duration, immediate cancellation
during preflight, or a separately injected second-pass database failure. Abort
recovery and preflight corruption were tested at the actual HTTP boundary.
