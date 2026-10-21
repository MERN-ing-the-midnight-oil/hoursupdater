# My Teamster Contract Date Calculator

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
3. The app opens a review window using Art. 3.08 (Bellingham Public Schools 2026–2027 student calendar, 179 days). Before October 1, a change under 30 minutes becomes contracted on October 1. After October 1, changes that stay under 30 minutes are added together for 15 school days, and a later change starts that count over. A total under 30 minutes becomes contracted the next school day. A total of 30 minutes or more goes to bid or bump. Once a route is already up 30 minutes or more, a later change that leaves it there does not move the bid date. That change runs its own 15 school day countdown. The contract says reposting happens when a route “is increased thirty (30) minutes or more for fifteen (15) school days or more.”
4. After the window closes:
   - under 30 minutes → new times are automatically contracted (each run rounded to the nearest 15 minutes, then that sum rounded again)
   - +30 minutes or more → bid pending
   - −30 minutes or more → bump eligible

## Built-in calendar

Bellingham Public Schools 2026–27 student year: first day **August 31, 2026** (grades 1–12), tentative last day **June 11, 2027** (179 days). Holidays, breaks, the teacher workday, Treaty Day, and the semester break are not school days. Every Thursday is an early dismissal, and so is the last day.
