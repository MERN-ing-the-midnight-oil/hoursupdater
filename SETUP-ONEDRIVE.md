# Set Up on OneDrive

Teamster Tracker stores its **data** in a OneDrive folder. The **app** itself stays in a normal folder on your PC (Desktop, Downloads, etc.) — not inside OneDrive.

```
Your PC (local folder)                    OneDrive (shared data)
─────────────────────                     ──────────────────────
TeamsterTracker\                          …\RouteChangeTracker\
  Start.bat                                 RouteChangeTracker.xlsx  ← created by app
  .env          ← points DATA_DIR here →    _app_data\               ← created by app
  runtime\node.exe
  app\
```

## 1. Create the shared folder

1. Open **File Explorer**.
2. Go to your district OneDrive (often named like `OneDrive - District` or similar).
3. Create a new folder named **`RouteChangeTracker`** (exact spelling is fine to change, but keep it simple).
4. Leave it empty for now. The app will create `_app_data` and the Excel file inside it.

Optional: right-click the folder → **Always keep on this device** so Windows does not leave it “online-only” when you need it.

## 2. Copy the full path

1. Open the `RouteChangeTracker` folder you just created.
2. Click the address bar in File Explorer (or copy the path from the folder properties).
3. You should get something like:

   `C:\Users\rachel.smith\OneDrive - District\RouteChangeTracker`

Spaces and the dash in `OneDrive - District` are normal. Copy the path exactly.

## 3. Point the app at that folder

1. In the Teamster Tracker portable folder (next to `Start.bat`), open **`.env`** in Notepad.  
   If you only see `.env.example`, copy it and rename the copy to `.env`.
2. Set `DATA_DIR` to the path you copied. Example:

   ```env
   DATA_DIR=C:\Users\rachel.smith\OneDrive - District\RouteChangeTracker
   PORT=3847
   ```

3. Save the file.

Do **not** put quotes around the path. Do **not** point `DATA_DIR` at `_app_data` — point it at the `RouteChangeTracker` folder itself.

## 4. Start the app

Double-click **`Start.bat`**.

- A black window should stay open.
- Edge (or your default browser) should open to `http://localhost:3847`.
- If the browser does not open, paste that address into Edge yourself.

## 5. First-time setup inside the app

After it opens:

1. Add **staff names** (Admin → settings).
2. Confirm or load the **school calendar**.
3. **Bulk-import** the driver roster when you are ready (September for production).

## Checklist

- [ ] OneDrive is signed in on this PC
- [ ] `RouteChangeTracker` folder exists and opens in File Explorer
- [ ] `.env` has the correct `DATA_DIR` path
- [ ] Portable app folder is **not** inside OneDrive
- [ ] `Start.bat` leaves a black window open and the browser can reach `http://localhost:3847`

If any step fails, see **TROUBLESHOOTING.md**.
