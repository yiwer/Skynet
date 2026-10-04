# Prompt membership preparation

The full 1,000-session source fixture exposed repeated whole-message scans in
`promptFactors`. Each logical session filtered both the selected messages and
all-context messages, testing each message against that session's rows and
original snapshot IDs. A captured CPU profile attributed 22.204 seconds
inclusive to this function; that includes callers' overlapping samples and is
not an additional 22 seconds on top of assessment time.

The implementation constructs two request-local membership indexes, then
distributes each input array in its original order. Selected membership uses
employee, project, source, native session ID and original snapshot ID. Context
membership deliberately uses only source, native session ID and original
snapshot ID. Every original `snapshotIds` member participates. A set removes
duplicate row membership, never duplicate message occurrences or legitimate
membership in different logical sessions. The original session iteration,
model voting, complete/unknown checks, corrections, first-prompt handling,
representative examples and citation order are unchanged.

Preparation is now proportional to row/snapshot memberships, the two message
arrays and their actual matching edges, instead of rescanning both arrays for
every logical session. Indexes and reference arrays live only for that call;
there is no shared cache, raw-byte retention, freshness bypass or resource-limit
change. Caller-side filtering and unrelated SQL remain outside this slice.

## Public evidence

Evidence is under `E:/GenCode/Skynet-evidence/v2-2026-10-04`.

- `54-prompt-membership-diagnosis.md` maps the sampled generated-code columns to
  the two repeated scans and records the semantic constraints.
- `54-prompt-membership-red.json` / `green.json` use the unchanged public source
  bundle: 10 employees, four weeks, 1,000 sessions, 80,000 business events,
  19,000 waits and 20 analyzed sessions. HTTP Usage preparation precedes the
  separately measured first prompt construction. RED was 5,530.5 ms; GREEN was
  670.1 ms. This is a shared-host, fixed-dependency diagnostic, **not** a cold
  end-to-end AC32 sample or a P95 result. Usage preparation is separately
  recorded and is not hidden inside that claim.
- The full response preserves 20,000 prompts and all independent known/unknown
  denominators. Current, full recompute and fixed reads agree exactly. Separate
  fresh clones differ only in creation time and its dependent report version;
  all other payload fields and ordered citations agree.
- `tests/prompt-membership-upgrade.ts` compares old and new HTTP routes against
  the same isolated database, retaining creation metadata too. It uses an
  explicit fixed old checkout, then verifies complete fixed/current/full
  equality and preservation of the old payload after a late upload.
- `54-prompt-membership-public.txt`: 10 existing public cases passed, including
  controlled native analysis, OAuth MCP, browser rendering, restored ownership,
  multi-block native messages, truncated history, corrections and weekly history.
- `tests/prompt-membership-public.test.ts` adds an unrelated device reusing the
  native ID, restored cross-owner/project membership, correction and fixed
  history, and a selected week whose predecessor is in the previous week.

The cross-owner/project scope first expected a known predecessor; running the
same case on the accepted old code confirmed it was already unknown because
the selected row excludes that original snapshot membership. Both observations
are retained in `54-prompt-membership-scope.txt` and `scope-before.txt`. The
final regression preserves that unknown boundary and verifies known context
in the complete logical session; it does not expand attribution during a
performance change.

The build and exact final source/evidence hashes are recorded in
`54-prompt-membership-author-verification.json`. This slice does not close
ticket #54 or replace the complete AC32 latency/entrypoint matrix.
