<!-- bmad:context -->
<!-- Verified 2026-10-05 against 1a65e18. Managed by bmad-project-context; edits inside this block are replaced on refresh. Keep anything you want preserved outside the markers. -->

## kidoland

Kindergarten management app for attendance, daily child reports with photo uploads, and tuition payments. React 19/TypeScript frontend with Vite, Express 5 backend with SQLite. Planning documentation lives in `docs/` and `_bmad-output/planning-artifacts/`.

## Policy

- Commit directly to main using conventional commit prefixes (`feat:`, `fix:`, `refactor:`, `test:`).
- Never modify `server/kidoland.sqlite` directly in tests; integration tests must use ephemeral temporary databases (`KIDOLAND_DB_PATH`).
- Never edit installer-managed `_bmad/config.toml` or `_bmad/config.user.toml`; place custom overrides in `_bmad/custom/`.

## Where things are

- Backend API: `server/src/index.ts`; SQLite schema and migrations in `server/src/db.ts`
- Web UI components: `src/App.tsx`, `src/Reports.tsx`, `src/Attendance.tsx`, `src/Payments.tsx`, `src/Children.tsx`, `src/Dashboard.tsx`
- Translations: `src/i18n/translations.ts` (en and sq)
- Test suites: `tests/pilot-ui.tsx`, `tests/attendance-ui.tsx`, and `server/tests/*.test.ts`

## Running and verifying

- `npm run dev:all` runs both backend (port 4000) and frontend (port 5173) together.
- `npm test` runs the root suite (mocked attendance UI regression + headless Chrome pilot test).
- `npm test --prefix server` runs the isolated SQLite backend test matrix.
- `npm run build && npm run lint` checks TypeScript types and lints with oxlint.

## Conventions that differ from defaults

- Financial amounts are strictly integer cents (`amountCents`) summed with `BigInt`, never floating-point numbers.
- All user-facing UI copy must support both English and Albanian in `src/i18n/translations.ts`.
- All UI inputs and buttons must fit within 320px viewports without horizontal overflow (`box.right <= window.innerWidth + 1`).
- `reports` table maintains an exact 10-column layout for test fixture compatibility; attach report images via `report_photos`.

## Known pitfalls

- Running `npm run dev` starts only the Vite web client without the API; use `npm run dev:all` for full local operation.
- Do not run `INSERT INTO reports VALUES (?,...)` with more than 10 positional parameters; use `report_photos` for photo attachments.
- File inputs must have `box-sizing: border-box; width: 100%; max-width: 100%` or they overflow 320px in headless Chrome checks.

<!-- /bmad:context -->
