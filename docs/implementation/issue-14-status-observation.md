# Unknown Codex origin: completed-sweep regression

Main `9b90e7a` Linux CI passed typecheck/build but failed **27/28**, 106.542s: the installation test saw one retained live inbox event before `runtime.json` contained the next completed routing sweep. [Failed CI](https://github.com/yiwer/Skynet/actions/runs/36677460451/job/109765422033). This is separate from the unresolved Windows 1500ms runtime-control response failure.

`installedStatus` reads cached `runtime.json` and independently counts the live inbox. `routeCodex` retains unknown-origin events and emits its unverified-origin error on each sweep. A fixed 1400ms sleep does not establish that routing completed under concurrent suite load.

The public test now waits at most 30 × 200ms polls for a completed sweep after enqueue and the unverified-origin diagnostic. It still requires exactly one retained unclassified event. It additionally verifies no source tracking, no routed source queue entry, and no server archive for that native session. The control timeout and installed runtime behavior are unchanged.

Windows targeted command: `node --import tsx --test tests/installation.test.ts`, **1/1 PASS**, 90.705s test / 91.233s process, isolated `skynet-test-P28vYV`. This run includes all additional no-classification assertions. Earlier intermediate polling/server/tracking edition: `skynet-test-XwzGBl`, 1/1 PASS, 95.001s. Typecheck/build succeeded before the initial target; subsequent unrelated #23 test-fixture TypeScript missing timestamp was corrected separately. Source is identical to main for collector behavior; independent analysis queue checkpoint was present in this implementer tree but was not used by this installed collector test.

Linux regression remains pending a new CI result; the failed run above is retained. No paid calls, existing Agent configuration, or user sessions were used. Real login/reboot/Desktop and runtime-control failure gates remain open.
