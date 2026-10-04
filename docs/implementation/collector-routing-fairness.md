# Codex inbox fairness

An installed worker previously inspected every retained Codex hook and reread up
to one MiB of its transcript before collecting any source or refreshing shared
device health. Unknown origins and mismatched session IDs were retained, then
retried in full on the next sweep. A large unrelated backlog could delay normal
new CLI work even while the supervisor reported `running`.

The isolated public reproduction queued 16,384 hooks through `recordHook`, then
submitted a normal hook through the actual CLI. It used two synthetic rejected
transcripts with short valid metadata and more than one MiB of native message
content. At the existing 20-second health window, the baseline had zero archived
sessions and all 16,385 hooks pending. Its first heartbeat was fresh: this run
proves capture starvation, not an expired heartbeat. The separate real-device
aggregate observation of a 450.2-second-old heartbeat is not a replay or a
benchmark, and no real event contents were read for this change.

## Scheduling and source boundaries

- A worker attempts at most 256 shared Codex hooks per sweep. New arrivals and old
  retries each receive up to half of that budget; unused quota is reused.
- Old hooks form a FIFO rotation. Rejected new hooks join its tail, so continued
  arrivals cannot insert themselves ahead of an unattempted old hook. New-hook
  selection preserves first-observed queue order across sweeps; filenames first
  observed within the same sweep are sorted, not ordered by event `observedAt`.
- `inbox/codex/routing.json` stores only a version and last old-attempt filename.
  Restart resumes the sorted retained set after that position, wrapping at the
  end. Deleted names do not invalidate it. Malformed JSON resets this derived
  scheduling position. Other storage errors remain visible. Saved names never
  become paths: both queues contain only names enumerated from the owned spool.
- Hooks are reread and native root, exact session identity and the existing CLI
  origin allowlist are checked on every attempt. No source verdict is cached.
  Rejected hooks stay byte-for-byte in their original spool. A later legitimate
  native metadata correction can therefore make the same hook eligible.
- Metadata reads begin at 4 KiB and grow only until the first newline, retaining
  the original one MiB ceiling. Actual upload still uses the existing fresh full
  original read and alias/path/identity checks. No original byte is rewritten.
- `runtime.errorsScope` identifies the last sweep. `runtime.codexRouting` records
  last-batch observed, attempted, deferred, new/retry attempts, routed and failed
  counts. No-errors in a batch makes no claim about unattempted hooks.
  `status.codexUnclassifiedEvents` remains a fresh total directory count.

The queues retain filename scheduling metadata only. This does not bound the
entire native collector's other work, certify Desktop support, or establish an
across-hardware 20-second throughput guarantee.

## Public verification

Tests use an isolated synthetic enrollment, real installed CLI supervisor/worker,
public hook writer/CLI, HTTP session and raw endpoints, and authenticated CLI
status/stop. No model, Windows login task, production write or real installation
upgrade is involved.

1. Same 16,384-hook RED became GREEN with batching alone, before prefix reading
   changed: normal raw archive plus fresh health at 3,283 ms. Every rejected hook
   and native original retained its SHA-256; the accepted raw matched exactly.
2. Corrupt scheduling JSON produced a public restart RED, then GREEN without
   discarding any source hook.
3. A normal event already beyond the first four startup batches progresses.
   After restart, an old rejected native source is corrected while new unknown
   hooks continue arriving. The old source and new CLI source both archive, the
   heartbeat refreshes, and retained original hook bytes remain unchanged.
4. Metadata newline offsets 4,095, 4,096 and 1,048,575 are accepted with exact raw
   bytes. Offset 1,048,576, an unterminated first line, wrong identity and an
   outside-root path remain unclassified. An alias is retained by downstream
   native path checks and never archived. This passed before and after prefix
   optimization.
5. The existing runtime test retains standalone, exec and daemon TUI behavior,
   while extension, Desktop and unknown source forms remain unclassified.

External logs and sanitized observations are in
`E:/GenCode/Skynet-evidence/v2-2026-10-04/54-collector-fairness/`.
The evidence includes the original RED and two explicitly classified test-fixture
failures: an unbounded 8,192-file hash read exhausted Windows file handles, then
was made serial with guaranteed cleanup; a prefix fixture counted an alias in
the inbox although it was retained in the source spool. Neither is a product RED.
Successful 4,096/8,192 diagnostics are retained and are not labeled failures.

Run after `npm run build`, with the four documented PostgreSQL/OpenSSL/Git Bash/
Claude runtime environment variables set:

```powershell
npx tsx --test --test-concurrency=1 tests/collector-routing-fairness.test.ts tests/codex-runtime-routing.test.ts
```

After merging accepted `8048ecb4c37e9764f03a4f973168249b13beca7f`, the build and
all five public tests passed (141.061 seconds for the whole serial suite). The
final 16,384-hook run observed its new archive and fresh heartbeat at 2,200 ms;
the 65.529-second test also includes seed creation and all retained-byte checks.
These are individual regression observations, not P95 measurements. The raw
report is `17-final-public.txt`, with per-fixture sanitized observation files.

Real 0.2.6 installation upgrade, live heartbeat freshness and a new normal native
CLI archive remain a separate operator acceptance step after independent merge.
