# Kidoland pilot

Single-school React/TypeScript app with Express and SQLite, in Albanian and English.

## Run

Install dependencies with `npm install` and `npm install --prefix server`, then run both services:

```sh
npm run dev:all
```

The launcher streams both services' output and stops both when interrupted or when either exits. Separate terminals remain supported with `npm run dev:api` and `npm run dev:web`. API defaults to `http://127.0.0.1:4000`; Vite defaults to `http://localhost:5173`. Set `PORT` and `VITE_API_URL` for alternate addresses.

SQLite defaults to `server/kidoland.sqlite`. Additive startup migrations preserve existing records, add attendance/photo permission and backfill each legacy invoice's original amount as one tuition fee. To develop without writing pilot data:

```sh
KIDOLAND_DB_PATH=/tmp/kidoland-development.sqlite PORT=4001 VITE_API_URL=http://127.0.0.1:4001 npm run dev:all
```

Fresh databases seed demo accounts: `parent@kidoland.demo` / `parent123`, `teacher@kidoland.demo` / `teacher123`, and `director@kidoland.demo` / `director123`.

## Available pilot workflows

- Directors create parent accounts with name, email and an initial password of at least 10 characters (bcrypt's 72-byte maximum applies). They create/edit children, groups and existing parent links. Changing a parent link resets photo permission, with a warning before saving. Historical records are retained; there is no child deletion.
- Teachers/directors mark attendance per child and calendar date, with corrections updating the same entry. Parents see only linked children. Missing attendance is Unmarked. Dates start at the browser's local day.
- Teachers/directors choose mood, meals, nap and activity checklists, add optional notes and correct an existing child/day report. Known choices translate; unfamiliar old free text remains intact.
- Parents explicitly save yes/no photo permission for their own children. Staff read the saved choice. Default permission is no; photo uploads/sharing are unavailable.
- Staff create itemized EUR invoices with exact positive cent totals. Parents read their own family's fee breakdowns. Only directors record payment after cash or bank transfer. Retrying an unchanged draft after a lost response reuses a durable request ID; unresolved invoice drafts survive navigation/reload for that authenticated account. There is no automatic submission. All pending invoices remain readable; only paid history is capped at 100. Existing legacy currency/date values remain readable.
- Role dashboards show selected-date attendance/report completion and exact unpaid balances grouped by stored currency for the school or linked family. Child report shortcuts preserve the selected child/date; attendance shortcuts preserve the date. SQ/EN preference persists, including entered drafts during language changes. Navigation remains available at 320px.

Authenticated API: `GET/POST /api/children`, `PATCH /api/children/:id`, director-only `GET/POST /api/parents`, own-parent `PATCH /api/children/:id/consent`, `GET /api/attendance?date=YYYY-MM-DD&childId=...`, staff `POST /api/attendance`, `GET /api/reports?childId=...&date=...`, staff `POST /api/reports`, `GET/POST /api/invoices`, director `PATCH /api/invoices/:id/paid`, and `GET /api/dashboard?date=YYYY-MM-DD`. All routes recheck the current authenticated account and enforce roles/ownership.

## Verification

```sh
npm run build
npm run lint
(cd server && ./node_modules/.bin/tsc --noEmit)
npm test --prefix server
npm test
git diff --check
```

API suites start real processes on ephemeral ports with temporary SQLite databases. They verify authorization, parent isolation, strict input/date validation, consent transfer, report correction, safe invoice totals, transactional rollback, retry replay after restart, legacy migration preservation/idempotency, partial database startup, and summaries beyond list caps. Tests never use the pilot database.

`npm test` runs the deterministic mocked attendance regression and then a full App connected to a disposable real API. The full-app browser flow exercises all three demo roles, new parent provisioning, child linking/editing, consent, attendance corrections, report checklist/correction, invoice retry/fees/paid status, language persistence, session isolation and selected child/date shortcuts. It includes deterministic failed/lost responses and true 320px viewport checks. Run `npm run test:pilot` alone, or `PILOT_WIDTH=1440 npm run test:pilot` for desktop. Screenshots are written to `/tmp/kidoland-pilot-320.png` or the selected width. Set `CHROME_PATH` for an installed Chrome/Chromium outside the usual paths; no browser package is required.

The mocked harness `/tests/attendance-ui.html` makes no API calls and restores auth storage after completion. The full-app harness `/tests/pilot-ui.html` clears storage only in the runner's fresh disposable browser profile. Open that harness manually only against a disposable database/profile.

## Remaining limits

Single school, manual cash/transfer records, EUR for new invoices. No payment gateway, notifications/reminders, photo uploads/sharing, live pickup, offline queues, enrollment contracts, multi-tenancy or phase-two catalog. Automated layout checks supplement, but do not replace, human keyboard/screen-reader and visual acceptance. Demo credentials and the development JWT secret must be replaced before real deployment.
