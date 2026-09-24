# Teamster Tracker

Local web app for school district transportation teams to log bus route time changes and track cumulative drift against contract thresholds.

See **[KNOWN_OPEN_QUESTIONS.md](./KNOWN_OPEN_QUESTIONS.md)** for deliberately unresolved items. Check that file at the start of each phase. For moving to Rachel’s real environment, see **[HANDOFF.md](./HANDOFF.md)**.

## Current status

| Phase | Status |
|-------|--------|
| 1. Data layer | Done |
| 2. Business logic + tests | Done |
| 3. Routing view | Done |
| 4. Admin view | Not started |
| 5. Letter generation | Not started |
| 6. Polish / overrides | Not started |

## Setup

```bash
npm install
cp .env.example .env
npm run seed          # copies sample-data into ./data/_app_data (skips files that already exist)
npm start             # http://localhost:3847
```

Open **http://localhost:3847/routing** for the Routing desk.

A separate employee app, **My Teamster Contract Date Calculator**, uses the same contract math with the built-in BPS 2026–2027 calendar. Each person is stored independently in their own browser.

```bash
npm run start:employee   # http://localhost:3848
```

See **[employee-tracker/README.md](./employee-tracker/README.md)**. The published GitHub Pages site is built into `docs/`.

Point `DATA_DIR` in `.env` at your OneDrive-synced **shared folder root** when you go live:

```env
DATA_DIR=/path/to/OneDrive/RouteChangeTracker
PORT=3847
```

Layout inside that folder:

```
DATA_DIR/
  RouteChangeTracker.xlsx   # auto-generated read-facing workbook (do not hand-edit)
  _app_data/                # internal JSON source of truth
    change-log.json
    route-state.json
    …
```

### Windows portable package (no Node install)

For Rachel’s district PC, build a zip that includes a bundled Node runtime and `Start.bat`:

```bash
npm run build:portable-win
# → dist/TeamsterTracker-win.zip
```

Share the zip via OneDrive/Teams. She unzips to Desktop/Documents, sets `DATA_DIR` per **[SETUP-ONEDRIVE.md](./SETUP-ONEDRIVE.md)**, and double-clicks `Start.bat`. See **[TROUBLESHOOTING.md](./TROUBLESHOOTING.md)** and **[HANDOFF.md](./HANDOFF.md)**.

## Run tests

```bash
npm test
```

## Routing view (phase 3)

- Pick route via searchable autocomplete from `route-state.json` (existing routes only), or an explicit **Create new route** action for brand-new routes
- Current schedule auto-fills from `route-state.json` for existing routes (editable when creating new / no prior segment schedule)
- **Start Date** (UI label) — the date the change was logged/identified; stored as `effective_date` in `change-log.json` for now. Reserve the words “Effective Date” for Admin’s locked-in window outcome (phase 4).
- New schedule → exact unrounded computed delta
- Optional delta override with required reason from `adjustment-reasons.json`
- **Entered by** (required staff-names dropdown) on every submit, including Create new route; **Note** is optional
- Submit appends to `change-log.json` and rebuilds `route-state.json`
- Recent list shows status (and a “Held · under review” badge when the route is in `NEEDS_REVIEW`)

## Data files

| File | Writer | Purpose |
|------|--------|---------|
| `_app_data/change-log.json` | Routing (changes) + Admin (ADJUSTMENT entries) | Append-only log (source of truth) |
| `_app_data/route-state.json` | Rebuilt after writes | Computed per-route state (source of truth) |
| `_app_data/school-calendar.json` | Manual import | Valid school days for 15-day windows |
| `_app_data/adjustment-reasons.json` | Admin settings | User-managed delta-override reasons |
| `_app_data/staff-names.json` | Admin settings | User-managed Entered by / Adjusted by names |
| `_app_data/drivers.json` | Routing / Admin | Driver directory |
| `_app_data/letters/` | Admin app | Generated driver notification letters |
| `RouteChangeTracker.xlsx` | Auto-regenerated | Read-facing workbook (sibling of `_app_data/`) |

## Business logic (summary)

- Deltas and cumulative drift stay **exact / unrounded**; the 30-minute threshold uses exact drift.
- Window close dates follow Art. 3.08: before October 1, under-30 changes lock in on October 1; after October 1, increases and decreases are cumulative over 15 school days. A total under 30 minutes becomes official the next school day. A total of 30 minutes or more goes to bid (increase) or bump (decrease). 30-minute increases post for bid in the last five school days of October–April.
- Payroll contracted hours: at window finalization only, sum **this route’s** exact AM+MIDDAY+PM durations and round that total via `roundToQuarterHourForPayroll()` (stored as `payroll_rounded_total_minutes`). Never round a delta, never round per-segment.
- Single bid threshold: `abs(exact cumulative) < 30` → lock in; `>= 30` → `BID_PENDING`.
- Admin ADJUSTMENTs are append-only; finalized status flips become `NEEDS_REVIEW` (see open questions #1 and #3).

## Project structure

```
src/
  server.js             # Local Express server
  routes/api.js         # JSON API
  services/rebuild.js   # Rebuild + persist route-state
  data/storage.js
  logic/                # Pure business logic
public/
  routing/              # Routing desk UI
  admin/                # Admin queue + settings
  help/                 # Glossary / help
sample-data/            # Starter files for local/OneDrive seed
HANDOFF.md              # Go-live steps for Rachel’s environment
KNOWN_OPEN_QUESTIONS.md
```
