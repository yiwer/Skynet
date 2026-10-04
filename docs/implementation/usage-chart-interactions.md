# Usage chart interactions — AC31 slice

Base: accepted `726e32efc40c988d9a23817c5b2faf5b6f3569a5`. Scope is the employee Token stack, session Token/verified scatter and employee daily Token graphs. Statistics, backend contracts, report versions and source ownership are unchanged.

Real public upload → HTTP → Chromium touch journeys reproduced the following problems before the corresponding fixes:

- Employee and daily details disappeared after the first tap. Employee segments were16px high; a daily date target was about30px wide. Native buttons now provide at least44px targets with focus/hover preview independent from click activation. First tap opens and second tap closes; Escape, Enter and Space remain usable.
- The scatter's first tap navigated before values could be read. It now opens a nonmodal detail with explicit links to the same fixed source. Adjacent44px targets initially intercepted one another; disjoint44px hit cells now list every session in a crowded cell. All circles remain at their original numeric coordinates; only interaction is grouped. Details are built for the active cell, not for every cell on every render.
- An employee tooltip was clipped at320px (intersection ratio0.938). Shared Usage detail positioning follows its trigger, measures the reading area's clipping ancestors and chooses space above or below. It does not increase page height or cover the trigger. Long details scroll locally; moving the pointer into the detail does not dismiss it.
- The daily SVG omitted its existing theme class, leaving black bars in dark mode (contrast1.411). The existing series color now applies. Gray reference scatter points retained their muted fill but had insufficient contrast (1.860 light /2.083 dark); a theme-muted outline now makes the mark distinguishable.

Daily date slots use44px and retain horizontal scrolling; zero, unknown and no-session dates remain separate. Agent stack proportions, session coordinates, totals, table values and fixed source links are unchanged. Native semantics replace the former tiny focusable SVG segments; the two existing public journeys use their equivalent accessible controls.

## Verification

The author evidence index is external `E:/GenCode/Skynet-evidence/v2-2026-10-04/54-usage-chart-author-verification.json`; diagnostic chronology and retained failed attempts are in `54-usage-chart-author-log.md`. The public test is `tests/usage-chart-interactions.test.ts`.

The final matrix covers320/390/768/1280/1920 in both themes: actual tap/open/tap/close, keyboard activation and Escape, complete tooltip intersection,44px geometry, actual rendered graph/text/focus contrast, outer-page bounds and reduced-motion computed styles. It also checks exact Agent/daily/session table values against synthetic public records, known zero versus unknown, overlapping-session fixed links, gray references, real horizontal wheel scrolling, last-date keyboard reachability and pointer movement into details. Browser page errors and automatic full exports must remain empty.

Inputs are isolated synthetic native originals. Analysis uses the previously approved deterministic boundary; no real provider or production writes are used. Results are functional evidence on Chromium, not performance/P95, a physical mobile-device claim or acceptance of all AC31/AC32. Final acceptance and ROOT integration belong to an independent reviewer.
