# Team and waiting chart interactions

This AC31 slice checks three existing charts through synthetic public uploads,
HTTP reports and the real Web application. It does not invoke Analysis or a
model provider, change statistics, or write to production.

The 390px touch regressions reproduced three concrete failures:

- Team daily trends opened on focus, then immediately closed on the same first
  tap's click. The click toggle now has independent state; focus and mouse
  previews no longer consume the first activation. All three daily instances
  retain their values: known Token input, unknown model results and known zero
  code changes.
- Waiting heat cells showed the correct sample and median but Escape did not
  dismiss the status. Escape, leaving focus, mouse exit, second tap and changing
  to the table now dismiss it. Enter and Space use the same native button.
- Waiting box plots likewise did not dismiss. The existing focusable image is
  now a native button with the same label and SVG, preserving mouse/focus
  previews and supporting tap, Enter, Space, Escape and focus exit. Its scoped
  button styling preserves the existing plot layout.

Separate public rendered-color checks found that light-theme team trend marks
used the decorative accent at 2.2277:1 against their card. Only that chart now
uses the existing `--viz-1` token: 3.4219:1 in light and 4.4513:1 in dark. Theme
tokens and unrelated charts are unchanged.

`tests/chart-interactions.test.ts` checks exact source values and denominators,
not just target dimensions: waits of 60/120/600/1200 seconds produce a 360-second
median, Q1 105 seconds, Q3 750 seconds, P90 1200 seconds, 4 known/1 unknown, and
2/4 long waits. The heat table retains 167 no-record cells and the box table
preserves all quantiles. The chart sample has no invented permission events.

The bounded visual check covers these three charts at 320/390/1280px in both
themes, including keyboard focus, tooltips, 44px waiting targets, actual wheel
scrolling of long trend details, keyboard horizontal scrolling, and no outer
document overflow. It records computed transitions and running animations under
reduced motion; the existing permitted opacity transitions up to 150ms remain
allowed. Screenshot animation disabling is only for stable evidence and is not
the motion assertion. Rendered pure-color text, focus and mark contrast is
measured; image backgrounds, antialiasing, all heat intensity levels, other
browsers, screen readers and whole-product AC31/AC32 are not claimed.

Evidence is under `E:/GenCode/Skynet-evidence/v2-2026-10-04/54-chart-interactions`.
The team/heat/box logs each preserve the actual public RED and GREEN. Appearance
logs before `appearance-red-05` retain harness corrections (focus movement,
tsx browser function serialization, and the existing allowance for short opacity
motion); they are not called product failures. `appearance-red-05` is the actual
light-theme mark contrast RED, followed by `appearance-green`.

Run after `npm run build` using the normal isolated PostgreSQL and OpenSSL test
environment:

```
node --import tsx --test --test-concurrency=1 tests/chart-interactions.test.ts tests/wait-report-journey.test.ts
```

The evidence directory can be retained with `SKYNET_CHART_INTERACTIONS_EVIDENCE`.
The final author receipt records the exact tested commit, integration base,
logs and image hashes. No deployment or issue closure is part of this slice.
