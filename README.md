# Vacation Planner

A tiny local, browser-only vacation planner.

## Run

Requires Node.js 22.18+ and npm. On Windows, double-click `start.cmd`, or run:

```powershell
cd C:\gitlocal\vacation-planner
npm install
npm run dev
```

Open **http://127.0.0.1:5173**. Stop with Ctrl+C. No application backend is
required; Vite only serves the frontend. After the initial dependency install,
the app runs without Internet access.

Always use the same address: `localhost` and `127.0.0.1` have separate browser
storage. The port is fixed so restarting does not silently select a new store.

## Features

- Add people and their vacation date ranges.
- Edit and delete people, vacations, and pair restrictions.
- Show vacations on a scrollable year/month timeline; click a bar to edit it.
- Set pairs of people who must not be on vacation together.
- Highlight conflicting dates without blocking edits.
- Save data in browser localStorage.
- Import and export CSV files compatible with Excel.

## Keep it simple

Vue 3 + TypeScript + Vite. No backend, accounts, external services, or heavy
calendar library. Vacation dates include both the start and end day.

## CSV and backups

Exports include **all years**, people, vacations, and pair restrictions, not just
the visible period. Import validates the complete file before replacing data and
asks for confirmation if a plan already exists. Invalid imports leave it intact.

CSV uses UTF-8 with a BOM, semicolons, quoted fields, and this header:

```text
type;id;name;person_id;start;end;person_a;person_b
```

- `person`: fill `id` and `name`.
- `vacation`: fill `id`, `person_id`, `start`, and `end`.
- `rule`: fill `id`, `person_a`, and `person_b`.

IDs must be unique across all records; references must point to existing people.
Leave unused fields empty. Dates are inclusive calendar dates in `YYYY-MM-DD`
format; imports also accept `DD.MM.YYYY`. Comma-delimited CSV is accepted too.

To edit in Excel, use UTF-8 and semicolon separation, keep IDs and headers intact,
then save as **CSV UTF-8**. Spreadsheet formula prefixes are escaped on export.
Only the app's CSV structure is supported, not arbitrary Excel workbooks.

Data lives in this browser on this computer. Clearing browser data removes it.
**Export CSV regularly; browser storage is not a backup.** Storage failures are
shown on screen. Unreadable existing data is not automatically overwritten.

## GitHub Pages

Create a public GitHub repository and push this project on `main`. In the
repository, select **Settings → Pages → Build and deployment → Source → GitHub
Actions** before the first push.

The workflow in `.github/workflows/pages.yml` installs dependencies, runs tests,
builds the app, and deploys `dist/` on each push to `main`. It can also be started
manually from the Actions tab. No personal access token or application backend
is required.

Vite uses relative asset URLs (`base: './'`), so the same build works at
`https://<username>.github.io/vacation-planner/` and on the existing hosting.
Only application files are published; plans stay in each visitor's browser.

Browser storage belongs to an origin (scheme, hostname, and port), not a URL
path. Export CSV before switching origins and import it on the new site.
Other projects under the same `https://<username>.github.io` origin share the
same localStorage area; this is not an isolation boundary between projects.

## Checks

```powershell
npm test
npm run build
```

Tests cover date boundaries, leap years, conflicts, CSV round-trips, formula
escaping, and import validation. The production build is written to `dist/`.
