# Troubleshooting (Windows portable package)

You do **not** need to install Node.js or put anything in Program Files.  
If something fails, read the **black command window** that `Start.bat` opens — it usually explains the problem in plain language. Keep that window open; do not close it while using the app.

Related setup steps: **[SETUP-ONEDRIVE.md](./SETUP-ONEDRIVE.md)**.

---

## “Windows protected your PC” (SmartScreen)

**What you see:** A blue or yellow SmartScreen dialog — “Windows protected your PC” / “unrecognized app.”

**What it means:** Windows has not seen this program enough times to trust it automatically. That is common for a small internal tool that is not signed by a big software company. **It is not proof of a virus.**

**What to do:**

1. Click **More info**.
2. Click **Run anyway**.
3. If `Start.bat` is still open, continue; otherwise double-click `Start.bat` again.

If there is no “Run anyway” and only “Don’t run,” your PC may be under stricter IT policy — see **“This app has been blocked by your administrator”** below.

---

## Nothing happens when double-clicking Start.bat (or it flashes and closes)

**What it means:** Something is blocking the launcher **before** the app can print a message, or the window closes so fast you never see the error.

**Try these in order:**

### 1. Unblock the downloaded files

Files from email/zip often get a “downloaded from the internet” flag.

1. Right-click **`Start.bat`** → **Properties**.
2. At the bottom, if you see **Unblock**, check it → **Apply** → **OK**.
3. Also unblock **`runtime\node.exe`** the same way (Properties → Unblock).
4. Try `Start.bat` again.

Tip: open the folder in File Explorer, select all files, Properties, Unblock (when shown).

### 2. Run from a normal folder

Move/unzip the whole `TeamsterTracker` folder to your **Desktop** or **Documents** (not deep inside a temp email folder). Then double-click `Start.bat` there.

### 3. Run it in a way that keeps the window open

1. In the Teamster Tracker folder, click the address bar, type `cmd`, press Enter.
2. In the black window type:

   ```bat
   Start.bat
   ```

3. Press Enter. Now any error text will stay visible.

### 4. Check antivirus quarantine

Open your antivirus / Windows Security → Protection history / Quarantine.  
If **`node.exe`** was blocked, **restore** it, then try again.

### 5. If it is still blocked with no useful message

Stop trying random workarounds. Treat it as IT application control (next section) and ask IT using the question there.

---

## “This app has been blocked by your administrator”

**What it means:** District policy (AppLocker, WDAC, or similar) is **actively preventing** the portable app from running. This is not something you can safely bypass with clicks or settings on your own account.

**What to do:** **Stop.** Do not keep trying alternate launchers, renamed files, or “run as administrator” tricks.

**Ask IT this (copy/paste):**

> Can I run a portable local web server from a folder on my Desktop (not installed to Program Files), that only writes to my OneDrive `RouteChangeTracker` folder and is used in Edge at http://localhost:3847?

That question is intentionally narrow: no cloud hosting request, no admin install of Node.js, no Program Files install — just permission to run the portable folder.

---

## Browser opens but shows an error / “can’t reach this page”

**What it means:** Edge opened the address, but the local server did **not** finish starting (or already stopped).

**What to do:**

1. Look at the **black command window** that stayed open (or should have).
2. Read the error text there — common ones:
   - **DATA_DIR / OneDrive folder not found** → follow [SETUP-ONEDRIVE.md](./SETUP-ONEDRIVE.md); fix the path in `.env`.
   - **Port already in use** → another copy may already be running; try `http://localhost:3847` again, or close the other Teamster Tracker window, or change `PORT=` in `.env`.
   - **Bundled Node was not found / cannot run** → antivirus or IT blocked `runtime\node.exe` (sections above).
3. After fixing, double-click `Start.bat` again.
4. If the browser did not open at all, paste this into Edge manually:

   `http://localhost:3847`

---

## Start.bat says the OneDrive folder was not found

Follow **[SETUP-ONEDRIVE.md](./SETUP-ONEDRIVE.md)** again. Check especially:

- OneDrive is signed in on this PC
- The folder opens in File Explorer (not only “online” and failing)
- `.env` `DATA_DIR` matches the address bar **exactly** (username, `OneDrive - District`, spelling)
- You pointed at `RouteChangeTracker`, **not** at `_app_data` inside it
- You did not wrap the path in quotes in `.env`

---

## “Port is already in use”

Usually Teamster Tracker is **already running** in another black window.

1. Find that window and use the app at `http://localhost:3847`, **or** close that window and start again.
2. If something else owns port 3847, edit `.env` and set e.g. `PORT=3848`, then use `http://localhost:3848`.

---

## Excel / workbook says it is locked or will not update

Someone (or OneDrive) may have `RouteChangeTracker.xlsx` open.

1. Close the workbook in Excel on all PCs.
2. Wait a moment for OneDrive to sync.
3. Use the app again (it regenerates the workbook from `_app_data`).

Do not hand-edit the JSON files inside `_app_data`.

---

## OneDrive “sync pending” / files missing on another PC

The app writes to the PC that is running `Start.bat`. OneDrive must finish syncing before another person sees changes.

- Prefer **Always keep on this device** on the `RouteChangeTracker` folder.
- Avoid two people running the app against the same files at the **exact same time** (last writer can overwrite). Day-to-day: one active Admin session is safest.

---

## Email / zip delivery problems (for whoever sends the package)

The portable zip includes `node.exe` and libraries. District email may:

- Block `.exe` or `.zip` attachments
- Strip executables silently
- Flag the package as malware simply because it is new

Prefer sharing the portable zip via **OneDrive / Teams link** (or USB), not as an email attachment. After unzipping, use **Unblock** (section above) if Windows marked the files.

---

## Other things that often go wrong on locked-down PCs

| Issue | What it looks like | What to do |
|--------|--------------------|------------|
| **ARM / unusual PC** | `node.exe` won’t run; “not a valid Win32 application” | This package is **64-bit Windows (x64)**. Ask IT whether the PC is ARM; you may need an ARM build. |
| **Running from OneDrive itself** | Random missing modules, sync fights, slow starts | Move the **app** folder to Desktop/Documents. Only **data** belongs on OneDrive. |
| **Controlled Folder Access** | Node cannot write to Documents/OneDrive | Windows Security → allow `runtime\node.exe`, or ask IT. |
| **Offline / VPN** | OneDrive path missing until connected | Sign in to OneDrive / connect VPN, confirm the folder opens, retry. |
| **Wrong browser URL** | Typed `https://` or a network address | Use exactly `http://localhost:3847` (http, not https). |
| **Closed the black window** | Browser suddenly can’t reach the app | That window *is* the server. Start `Start.bat` again and leave it open. |
| **Edited `.env` in Word** | Fancy quotes / wrong filename (`.env.txt`) | Edit in Notepad; ensure the file is named `.env` not `.env.txt`. |

---

## Still stuck?

1. Copy the **full text** from the black command window.
2. Note what you clicked (SmartScreen, Unblock, etc.).
3. Send that to the person who handed you the app — or to IT with the portable-server question above if you saw an administrator block.
