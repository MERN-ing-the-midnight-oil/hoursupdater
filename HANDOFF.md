# Handoff — go-live for Rachel

Short checklist for the **Windows portable package** (no Node install) with data on OneDrive.

Also read:

- **[SETUP-ONEDRIVE.md](./SETUP-ONEDRIVE.md)** — create the data folder and set `DATA_DIR`
- **[TROUBLESHOOTING.md](./TROUBLESHOOTING.md)** — SmartScreen, AV, IT blocks, browser errors

## What you send her

1. Build on a Mac/dev machine (needs network once to download Node win-x64):

   ```bash
   npm run build:portable-win
   ```

   Output:

   - `dist/TeamsterTracker-win/` — folder
   - `dist/TeamsterTracker-win.zip` — same contents, zipped

2. Share the **zip via OneDrive/Teams** (prefer not email — many districts block `.exe` / large zips).

3. Tell her to unzip somewhere **not OneDrive-synced** (local Documents if Desktop syncs to OneDrive), then follow `README.txt` + `SETUP-ONEDRIVE.md`.

Layout after unzip:

```
TeamsterTracker-win\          ← local on her PC
  Start.bat
  .env                        ← she sets DATA_DIR
  SETUP-ONEDRIVE.md
  TROUBLESHOOTING.md
  runtime\node.exe            ← bundled Node (not an install)
  app\                        ← application files

OneDrive\…\RouteChangeTracker\   ← DATA_DIR only
  RouteChangeTracker.xlsx
  _app_data\
```

## Go-live steps (Rachel)

1. **Create the OneDrive folder** — see SETUP-ONEDRIVE.md  
   Shared folder root, e.g. `OneDrive - District\RouteChangeTracker`.

2. **Edit `.env`** next to `Start.bat`:

   ```env
   DATA_DIR=C:\Users\her.name\OneDrive - District\RouteChangeTracker
   PORT=3847
   ```

3. **Double-click `Start.bat`**  
   Leave the black window open. Open Edge to `http://localhost:3847` if the browser does not open itself.

4. **Staff names** — Admin settings.

5. **School calendar** — load/generate the real district calendars when ready.

6. **Bulk-import roster** — Admin → Archive Year & Import New Roster when September production data is ready.

7. **Smoke-check** — Routing autocomplete, Admin queue, workbook under the OneDrive root.

## Day-to-day

Double-click `Start.bat`, leave the window open, work in Edge. Close the window to stop.

## If IT blocks it

Do not keep trying workarounds. Use the exact question in TROUBLESHOOTING.md (“This app has been blocked by your administrator”).
