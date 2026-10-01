# Kidoland PRD v1 (MVP)

**Product:** Kidoland — bilingual kindergarten ops for parents, teachers, and directors
**Markets:** Kosovo & Albania first
**Languages:** Albanian (sq) + English (en)
**Date:** 2026-10-01
**Source:** BMAD brainstorm (`_bmad-output/brainstorming/`)

## Problem

Kindergartens still run on paper sheets, WhatsApp photos, and cash envelopes. Parents call to ask if their child ate or slept. Teachers finish late paperwork. Directors lack a clear view of attendance, reports, and unpaid fees.

## Goal

Ship an MVP that schools use **every day**: teachers file a daily child report in under ~60 seconds; parents see it the same day; families can view itemized invoices and payment records after cash or bank transfer.

## Users & jobs

| Role | Primary job |
| --- | --- |
| Parent | Read linked-child reports/attendance, itemized invoices and photo permission |
| Teacher | Mark attendance and save/correct checklist reports on a phone |
| Director | Manage children/parent links, attendance, report completion and unpaid fees |

## In scope (MVP)

1. **Auth & roles** — login JWT; roles parent / teacher / director; protected screens
2. **Children** — director creates/edits children and groups, links existing parents, explicitly provisions parent accounts
3. **Daily reports** — bilingual mood/meals/nap/activity choices, optional notes and exact child/day correction; staff write, parents read linked children
4. **Attendance (light)** — present/absent per calendar day, unmarked distinct, corrections, parent read-only history
5. **Tuition invoices** — staff create/list itemized EUR fees, durable unchanged-draft retries; parent sees own; director alone records paid cash/transfer
6. **i18n** — full UI SQ/EN toggle with persisted preference and preserved drafts
7. **Trust basics** — default-no parent-owned photo permission, reset on parent transfer; transparent invoice fee totals
8. **Dashboards** — date-scoped school/family attendance and reports plus unpaid fees; contextual child/date shortcuts

## Out of scope (phase 2+)

Payment gateways, external notifications/reminders, photo uploads/sharing, enrollment contracts, live pickup, offline queues, multi-tenancy and the phase-two catalog. Infant feeding/diaper logs, white-label, waitlist marketplace, AI auto-drafting and government reporting remain future work.

## Success metrics

- Teacher: median time to save a report &lt; 60s
- Parent: open report same day without calling school
- Director: &gt;80% children with a report by 16:30 on weekdays (pilot school)
- Payments: unpaid invoice list usable weekly

## Non-functional

- Mobile-first web (phone teachers/parents)
- Online writes with explicit loading/error/retry; offline queues remain future work
- SQLite (or Postgres later) + REST API
- Secure passwords (bcrypt), JWT expiry, role checks on every write

## Risks

- Teachers reject heavy forms → keep checklist-first UI
- Mixed payments (cash/transfer) → allow “mark paid” before card gateway
- Grandparents without smartphones → printable/PDF weekly summary later

## Pilot implementation status

Authentication, child/parent management, attendance, parent-owned consent, checklist reports/correction, itemized invoices/manual paid recording, role dashboards and persisted SQ/EN are implemented. Existing rows survive additive migrations; legacy invoice totals become one tuition item. Report histories retain a 50-record cap; invoice lists return all pending records plus up to 100 paid records. Selected child/day correction is independent of history caps. Dashboard balances are grouped by stored currency and returned as exact integer-cent strings, including totals above safe JSON-number limits. Unresolved invoice drafts/request identities survive navigation/reload within the authenticated account and require an explicit retry.

## Run and checks

Install both package sets; `npm run dev:all` starts API and Vite together. Use `KIDOLAND_DB_PATH` for a disposable database. Run `npm run build`, `npm run lint`, server TypeScript checking, `npm test --prefix server` and `npm test`. The browser suite runs the actual App against an isolated API, with all roles and 320px checks; `PILOT_WIDTH=1440 npm run test:pilot` runs desktop. See [README](../README.md) for exact commands, screenshots and remaining verification limitations.

## Pilot decisions

- Single school and EUR for new invoices; existing currencies remain readable.
- Manual cash/transfer payment recording by directors; no in-app gateway.
- Photo permission records a choice only; no photo sharing feature exists.
