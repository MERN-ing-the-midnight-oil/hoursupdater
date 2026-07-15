# Handoff — go-live for Rachel (production)

Short checklist for moving from local practice to the real shared folder. Practice and production are **not** toggles of the same data store.

## Hard rule (one-way door)

**Practice data and production data must never share a `DATA_DIR`, under any circumstance.**

| Mode | Env file | Command | Folder |
|------|----------|---------|--------|
| Local sandbox | `.env.practice` | `npm run start:practice` | `./practice-data/` (gitignored) |
| Real records | `.env` | `npm start` | OneDrive shared root (Rachel’s machine / team folder) |

Do **not** copy files from `practice-data/` into OneDrive. Do **not** point `.env` at `./practice-data`. Do **not** point `.env.practice` at OneDrive. Starting over in practice is `npm run reset:practice`; starting production is a **fresh** folder + real imports.

## Go-live steps

1. **Create the real OneDrive folder**  
   Shared folder root the team will open in Explorer/Finder (e.g. `…/OneDrive - District/RouteChangeTracker`). Layout will be created by the app:
   ```
   DATA_DIR/
     RouteChangeTracker.xlsx
     _app_data/
   ```

2. **Set production `.env`** (not `.env.practice`):
   ```env
   DATA_DIR=/path/to/OneDrive/RouteChangeTracker
   PORT=3847
   ```
   Leave `PRACTICE_MODE` unset/false. Confirm this path is **not** `practice-data`.

3. **Run in normal mode**
   ```bash
   npm start
   ```
   Open http://localhost:3847 — there must be **no** practice banner. If you see “PRACTICE MODE”, you are still on `.env.practice`; stop and use `npm start` with `.env`.

4. **Staff names**  
   In Admin settings, add the real Entered by / Adjusted by names the office will use.

5. **School calendar**  
   Load the real district calendars (2025-26 and 2026-27 are already available to import / generate-commit as appropriate). Do **not** reuse the practice sandbox calendar.

6. **Bulk-import real roster**  
   Use Admin **Bulk import** with real drivers, hire dates, emails, and route times. Attribution should be a real staff name and a real note — never “Practice Setup”.

7. **Smoke-check**  
   Log a harmless test change only if the office agrees; otherwise verify Routing autocomplete, Admin queue empty/stable, and workbook generation under the OneDrive root.

## After go-live

- Day-to-day: `npm start` + production `.env` only.
- Keep practice on a **separate** machine or continue using `npm run start:practice` against `./practice-data` only — still never the production `DATA_DIR`.
- See [README.md](./README.md) for practice commands (`seed:practice`, `reset:practice`, `start:practice`).
