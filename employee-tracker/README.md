# Route change history

A read-only page where a driver can look up the clock-time changes the office has logged. Search by driver or by route. The Driver's Guide from the old calculator is on the same page.

The page reads the shared office record. It does not change routes. A single password keeps casual visitors out. The old calculator, where a driver typed their own times, is archived in `archive/`.

## Run locally

From the repo root (after `npm install`):

```bash
npm run start:employee
```

Open **http://localhost:3848**.

## GitHub Pages

```bash
npm run build:employee-pages
```

This writes the site to `docs/`. GitHub Pages serves that folder from `main`. The build also writes `docs/supabase-config.json` from `SUPABASE_URL` and `SUPABASE_ANON_KEY` in `.env`.

The office database has to include `public_route_history` from `office-tracker/supabase/schema.sql`. That function returns route names, driver names, and clock-time changes after the password check.
