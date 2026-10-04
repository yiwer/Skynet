# Profile preparation fixture clock

CI run `37215757060` on integration `32c5b79` failed the late-input assertion in
`profile-preparation.test.ts`: two selected sessions were returned instead of
three. An unchanged public rerun on accepted `3f003839` reproduced exactly that
failure; the second correction/history test passed.

The isolated date probe kept the original source uploads and assertions. Its
actual report clock was `2026-11-01T16:33:09.546Z`, Beijing date November 2, a
Monday. The new record was deliberately assigned November 3, Tuesday. The public
profile response had range October 5 through November 2 and two sessions; its
version had changed. This excludes stale fixed-result reuse and shows that the
product correctly excluded a later source date from the current date range.

The test now fixes its existing mutable `reportClock` value to Friday 18:00 in
the same selected week before creating the records. It retains the current
Monday, previous Monday and late Tuesday sources, both employees, all three
period selections, full recomputation, independent usage/efficiency identity and
fixed history assertions. An added public range assertion verifies that the
observed cutoff is Friday. The shared fixture and product code are unchanged;
future-date filtering and retry behavior are not weakened.

The diagnosis copies and RED/GREEN logs are external under
`E:/GenCode/Skynet-evidence/v2-2026-10-04/54-profile-clock-*`. Tagged diagnostic
output exists only in those external copies, not in repository tests. This
repairs a time-dependent test precondition, not a product report calculation.

The first fixed-clock run encountered a separate 409 at the same late-read step:
`报告来源正在更新，请重新读取；未保存混合输入的报告`. Its log
`54-profile-clock-green.txt` is retained as a failed run despite the intended
filename. An external probe preserving the first-response assertion then passed
without entering its diagnostic retry branch, and an unchanged formal two-test
rerun passed. No test retry, delay, product guard change or increased attempt
count was introduced. This intermittent 409 remains an investigation item.

Static inspection identifies possible in-process refresh interaction, not a
proven cause of that individual response. `consistentReportingInputs` compares
the original/proof identity, latest Analysis jobs and targets, input integrity,
coverage gaps and corrections before and after composition, for at most three
attempts. The profile additionally compares delivery receipts, device state,
daily and weekly immutable revisions, and their generation/pending/proof fields.
Its app has a report scheduler on readiness and every five seconds; this can
refresh daily/weekly state while a profile is composing. Read-side materialization
can also establish previously missing input proofs. The isolated test database
is not shared with other agents' fixtures, so unrelated test processes cannot
directly change those fields; shared host load could affect scheduling timing but
has not been established as the cause. No changed field was captured for the
single failing response, so this change does not claim to repair the 409 or to
pass a new complete CI run.
