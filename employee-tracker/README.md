# My Teamster Contract Hours Tracker

A static app for employees to record their own clock-in / clock-out changes and see when those times become contracted under the same Teamster rules as Teamster Tracker.

Each person is stored independently in **that browser**. Nothing is submitted to the district or payroll. Use **Download backup** / **Load backup** to move data between computers.

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

This writes the site to `docs/`. GitHub Pages serves that folder from `main`.

## What it does

1. You save your current AM / Midday / PM clock times.
2. You record a new clock-in or clock-out and the date it took effect.
3. The app opens a 15-school-day window (BPS 2026–2027 student calendar, 180 days). Further changes reset the window and add exact minutes.
4. After the window closes:
   - under 30 minutes → new times lock in as contracted hours (daily total rounded once to the nearest 15 minutes)
   - +30 minutes or more → bid pending
   - −30 minutes or more → bump eligible

## Built-in calendar

Official BPS SY2026–27 student year: first day **September 8, 2026**, last day **June 22, 2027** (180 days if no cancellations). Holidays and recesses are included. Teacher-only report days are not school days.
