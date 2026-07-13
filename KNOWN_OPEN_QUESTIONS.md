# Known Open Questions

This file tracks things we've deliberately decided **not** to fully resolve before continuing
development — either because they don't block the current phase, or because they require
input from Rachel / the Transportation office that we don't have yet.

**Rule for Cursor: check this file at the start of each new phase.** If work in that phase
touches on one of these items (especially the UI phases, where some of these become
user-facing for the first time), flag it in your response rather than silently picking a
default behavior. Do not resolve any item on this list unilaterally — surface it back to
Rhys instead.

---

## 2. The ~13% of historical entries that don't fit the rounding model

**Status:** Open. Accepted as a known gap, not actively being chased right now.

When we validated the delta-calculation logic against ~230 real historical rows from Rachel's
`Time Changes` spreadsheet, applying "round old and new duration to the nearest quarter hour,
then diff" explained about 87% of recorded values. The remaining ~13% didn't fit that model
either. A few examples that still don't resolve:

- Trapp, Tammy — S 11: 6:40–9:20 → 6:40–9:10, recorded `0`, rounding-model computes `-15`
- Banuelos, Juan — MD 53: 11:20–1:30 → 11:15–1:30, recorded `+30`, rounding-model computes `0`
- Garcia, Eduardo — S 14: 1:55–4:55 → 1:55–5:55, recorded `+75`, rounding-model computes `+60`

**Possible explanations, none confirmed:**
- Some of these may be cumulative entries (recording a running window total, not that row's
  own single-step delta)
- Some may reflect a different rule for midday (`MD`) routes specifically
- Some may just be manual entry inconsistencies in a hand-maintained 300+ row spreadsheet

**Why this doesn't block current work:** We deliberately chose to *not* auto-compute deltas
at all — Routing/Admin can override the computed value with a required reason (see the
`routing_adjustment` / `ADJUSTMENT` event design). So the app doesn't depend on the formula
being 100% correct; it depends on humans being able to correct it when it's wrong, which is
already built.

**Next step:** No action needed now. Worth revisiting once the app is in real use — if a
pattern emerges in which kinds of changes get overridden most often, that's a clue toward
whatever rule we're still missing.

---

## 3. `letter_or_action_exists` — approximated, not precisely checked

**Status:** Resolved as a deliberate design choice, documented here so it doesn't get
"fixed" into something less safe later.

When deciding whether a retroactive status flip should go to `NEEDS_REVIEW`, the current
implementation triggers review on **any** finalized-status flip (window already closed),
regardless of whether an actual letter file exists in `letters/` for that change. This is
intentionally the more conservative behavior — it's possible for a window to have closed
(and thus for real-world consequences to plausibly exist) even if a letter generation step
was skipped or delayed.

**Do not narrow this to a strict letter-file lookup** without explicit sign-off — the current
"finalized = review-worthy" behavior is the safer default and was chosen deliberately, not
as a placeholder.

---

## 4. Summer months and the 15-school-day countdown

**Status:** Open. Needs confirmation against the real district calendar / Rachel.

Does the 15-school-day accumulation window need special handling for summer (pause /
exclude summer months entirely), or does summer simply have **zero school days** in
`school-calendar.json`, making the question moot because `addSchoolDays()` only walks
listed days?

**Current behavior:** The countdown is pure school-day math over whatever dates are marked
`is_school_day: true` in `school-calendar.json`. There is no separate "summer pause" rule
and no month hardcoding in `addSchoolDays()`. Real district calendars for 2025-26 and
2026-27 are now loaded (2025-07-01 → 2027-06-30): 2025-26 has **zero** July/August school
days, while 2026-27 starts with **2026-08-31** as a school day before Labor Day — exactly
the year-to-year variation that would break a hardcoded summer assumption.

**Where this lives:** `addSchoolDays()` / `getSchoolDays()` in `src/logic/calendar.js`
(reads `is_school_day` only); Admin Settings can toggle days inside coverage.

**Next step:** Confirm with Rachel whether anything beyond “trust the calendar file” is
needed. Do not invent a summer exclusion rule in code until that answer lands.

---

## 5. Generated-calendar summer / coverage boundary

**Status:** Open. Default chosen for v1; confirm with Rachel if the window should differ.

When Admin uses **Generate a school year**, dates before the first day / after the last day
are marked `Outside school year (summer)`, but only inside a finite coverage window — not
indefinitely.

**Current default:** July 1 on or before the first day of school through June 30 on or after
the last day of school (same shape as the district year files: e.g. 2026-08-31…2027-06-11 →
coverage 2026-07-01…2027-06-30).

**Where this lives:** `defaultCoverageWindow()` in `src/logic/schoolCalendarGenerate.js`.

**Next step:** If Transportation wants a different pad (full calendar years, ±N months,
etc.), change that helper — do not scatter alternate boundaries elsewhere.

---

## Resolved

### 1. Interim pay during `BID_PENDING`

**Status:** Resolved as a scope decision (2026-07-12), not a factual answer about what
Payroll/HR pays during the interim.

The app does not assert or compute a driver's contracted-hours status between `BID_PENDING`
and bid resolution. Its responsibility ends at generating an accurate Change Report the
moment the window closes, and offering a "Notify Payroll" action so Payroll/HR are
proactively made aware. What happens administratively during the interim period is
Payroll/HR's process, not something the app needs to model.

**Do not** reintroduce interim-pay claims in drafts, Change Reports, or queue UI without an
explicit decision to expand scope.

---

## How to use this file going forward

- Add new entries here any time a design conversation ends in "we'll decide that later"
  rather than an actual answer.
- When an item gets resolved, don't delete it — move it to a `## Resolved` section at the
  bottom with the date and the answer, so there's a record of what was once open and how it
  got settled.
- Cursor: if you're about to make an assumption that touches on anything in this file,
  stop and ask instead of guessing.
