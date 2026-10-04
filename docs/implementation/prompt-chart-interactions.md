# Prompt chart interactions (AC31 subset)

The five prompt charts now keep literal report values and complete detail text usable through touch, mouse, and keyboard. This slice only changes `PromptReport.tsx`, its scoped CSS, and public browser coverage. It does not change report computation, fixed versions, sources, denominators, inference or unknown-value rules.

## Behavior and evidence

- The original count-bar public RED lost its tooltip after the first touch. Pointer handlers now ignore touch-generated hover exits, and explicit activation is separate from focus preview.
- The heat RED showed Escape followed by Enter could not reopen the focused cell. Cells now use employee ID plus element identity; task composition uses employee ID, so identical names and values do not expand two employees. All activators remain native buttons with `aria-expanded`.
- The task-composition RED lost its detail after first touch. Two touches toggle, Escape dismisses, focus previews, and Enter activates. A later matrix captured Space keydown, compatibility mouseleave, and Space keyup without the browser's native click; explicit Space keyup activation prevents this cancellation. Native Space default is suppressed on keydown to avoid double activation. The diagnostic also retained a 60ms held-Space failure, so this was not dismissed as a zero-delay harness artifact.
- A local layout hook positions the detail above or below its actual expanded activator, intersecting viewport and scroll/clip ancestors. Only open details listen to resize and capture-scroll, with symmetric cleanup. Details do not cover their activator; long text has a bounded internal scrollbar. Mouse movement from the button into the detail remains reachable.
- The dark 100% heat cell had rendered text contrast 3.7798. A scoped dark-theme mix limit of 50% raises the observed minimum to 5.005 without changing values or light colors. The heat uses numeric text as well as shading, retaining `0%` versus `—`.

Public tests use real synthetic upload, a deterministic recorded Analysis result, fixed report HTTP, and real Chromium. There are no provider calls or production writes. The existing model journey uses the pinned real Claude executable against its controlled loopback Analysis fixture, not a paid provider.

## Validation

`npm run build` passed. `tests/prompt-chart-interactions.test.ts` passed 5/5, 89.998 seconds. The matrix covers five charts at 320, 390, 768, 1280 and 1920 pixels in light/dark themes (50 chart states), true tap twice, focus, Enter/Space/Escape, mouse-to-detail reachability, at least 44×44 targets, exact clipping ratio 1, activator non-overlap, reduced-motion styles, and no outer page scrolling. All counts and fractions are compared with the fixed public report and table view. Known `0 / 2` and unknown `0 / 0` remain distinct. A separate same-name/180-character employee-label case verifies unique expansion and actual detail wheel scrolling.

Measured synthetic text minima: light 4.6766, dark 5.0050; visible mark minima: light 3.3310, dark 4.4513; focus minima: light 17.3561, dark 13.8789. This pure-color sample check is not a whole-site WCAG claim. Fifty-five final screenshots and complete observations are preserved.

The existing `tests/prompt-report-model.test.ts` passed 1/1 (19.226 seconds overall), including controlled CLI, HTTP, OAuth MCP, fixed full export, real downloaded bytes, filtering, chart/table switches, and prior viewport checks.

External evidence root: `E:/GenCode/Skynet-evidence/v2-2026-10-04`. `54-prompt-chart-author-verification.json` contains source identity, evidence hashes and retained RED history. `54-prompt-charts/final-01/appearance.json` has the fifty observations. The original failure logs were not overwritten: early count placement exposed clipping; its next test mistakenly expected no tooltip after tabbing to the next bar and was corrected to assert that next bar's exact zero value before leaving the chart. The first extended-test build had an untyped tuple error and is preserved as a harness build failure, not a product RED.

Reproduction (Windows PowerShell, isolated fixture):

```powershell
$env:SKYNET_TEST_POSTGRES_BIN='E:/GenCode/Skynet-tools/postgresql-18.6/bin'
$env:SKYNET_OPENSSL='D:/DevEnv/Git/usr/bin/openssl.exe'
$env:SKYNET_GIT_BASH='D:/DevEnv/Git/bin/bash.exe'
$env:SKYNET_CLAUDE_RUNTIME='E:/GenCode/Skynet-evidence/v2-2026-10-04/runtime/package/claude.exe'
npm run build
node --import tsx --test --test-concurrency=1 tests/prompt-chart-interactions.test.ts tests/prompt-report-model.test.ts
```

This is a bounded AC31 improvement. It does not sign off all AC31, AC32, V1 gates, CI, or the pilot. Independent acceptance and integration remain separate from author validation.
