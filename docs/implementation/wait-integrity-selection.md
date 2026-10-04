# Selected waits: missing original proof preparation

This is a partial AC32 optimization. It does not satisfy the 3s/1s P95 target.

`verifySnapshotsIntegrity` now selects only carrier/event pairs whose exact original integrity generation is absent before passing IDs to the existing 1,000-event verifier. The predicate is the same as the existing batch-insight reader. All selected carriers of each missing event remain in the failure map. The verifier rechecks proof existence before reading or appending proofs.

Invalid proofs still reach the existing repair pass; filtering tests existence, not validity. Normal raw size/SHA verification, unavailable-source attribution, selected-source limits, transaction boundaries and fixed history are unchanged. There is no cache or new schema.

The prior instrumented 1,000-session profile executed 256 empty proof queries across five valid wait scopes (256,000 carrier/event pairs). They took 11.36–13.70 seconds in a shared-host diagnostic. The change removes this redundant work when the proof queue is empty; no SQL execution-plan cause is asserted.

Public verification uses the existing complete public-upload/Analysis source fixture: 10 employees, four weeks, 1,000 sessions, 80,000 business events and 19,000 waits. `tests/wait-integrity-performance.ts` preserves the 3,000ms first-read assertion and is an explicit diagnostic, outside ordinary test discovery. Original code failed at 8,156.4ms. Candidate reads were 3,697.9ms and 3,635.8ms; **both still failed**. Shared-host samples are neither P95 nor a controlled speedup comparison. The last run completed current/full/fixed equality, late input (19,001 waits) and unchanged fixed history before reporting the remaining latency failure.

Initial targeted public regression: 9/10 passed, including corrupt originals, legacy proofs/repair, missing material/current sources, original-owner attribution and uppercase IDs. The remaining test compared the new recompute reading page to a complete export. It also fails on deployed baseline `298a743` in Linux CI, with identical business values and differing pagination metadata. Its separate correction must be integrated and verified before this candidate is accepted; this record does not count 9/10 as success.

Evidence directory: `E:/GenCode/Skynet-evidence/v2-2026-10-04/`. Original failure, candidate first sample, complete semantics sample and targeted regression are retained as `54-wait-integrity-red.*`, `-green.*` (filename chosen before execution; actual status is failed), `-complete.*`, and `-public.txt`. Build passed. Independent acceptance is pending.
