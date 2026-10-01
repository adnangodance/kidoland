# Kidoland PRD v1 (MVP)

**Product:** Kidoland — bilingual kindergarten ops for parents, teachers, and directors  
**Markets:** Kosovo & Albania first  
**Languages:** Albanian (sq) + English (en)  
**Date:** 2026-10-01  
**Source:** BMAD brainstorm (`_bmad-output/brainstorming/`)

## Problem

Kindergartens still run on paper sheets, WhatsApp photos, and cash envelopes. Parents call to ask if their child ate or slept. Teachers finish late paperwork. Directors lack a clear view of attendance, reports, and unpaid fees.

## Goal

Ship an MVP that schools use **every day**: teachers file a daily child report in under ~60 seconds; parents see it the same day; families can view and settle tuition without leaving the app.

## Users & jobs

| Role | Primary job |
| --- | --- |
| Parent | Know mood / meals / nap / note; pay tuition; authorize pickup |
| Teacher | Attendance + daily report fast on phone; offline-tolerant |
| Director | Occupancy, report completion, unpaid invoices, compliance export |

## In scope (MVP)

1. **Auth & roles** — login JWT; roles parent / teacher / director; protected screens  
2. **Children** — link children to parents; groups/rooms  
3. **Daily reports** — mood, meals, nap, activities, note; teacher/director write; parent read own children  
4. **Attendance (light)** — present / absent for the day (can share report day)  
5. **Tuition invoices** — create/list invoices; status pending/paid; parent sees own; director/teacher see school  
6. **i18n** — full UI SQ/EN toggle  
7. **Trust basics** — photo consent flag (yes/no); transparent fee line items on invoice  

## Out of scope (phase 2+)

Live pickup ETA, infant feeding/diaper logs, SMS gateway, multi-site white-label, e-sign enrollment, waitlist marketplace, AI auto-draft beyond checklist helpers, government API reporting.

## Success metrics

- Teacher: median time to save a report &lt; 60s  
- Parent: open report same day without calling school  
- Director: &gt;80% children with a report by 16:30 on weekdays (pilot school)  
- Payments: unpaid invoice list usable weekly  

## Non-functional

- Mobile-first web (phone teachers/parents)  
- Offline-friendly teacher write queue later (phase 1.1 if not day-one)  
- SQLite (or Postgres later) + REST API  
- Secure passwords (bcrypt), JWT expiry, role checks on every write  

## Risks

- Teachers reject heavy forms → keep checklist-first UI  
- Mixed payments (cash/transfer) → allow “mark paid” before card gateway  
- Grandparents without smartphones → printable/PDF weekly summary later  

## Build order

1. Auth + roles ✅  
2. Daily reports ✅  
3. Invoices + mark paid ✅  
4. Attendance light + consent flag ← next  
5. Polish i18n + pilot with one kindergarten  

## Open decisions

- Card payments: Stripe vs local gateway (or mark-paid only for pilot)  
- Single school vs multi-tenant from day one (recommend **single school pilot**, then multi-tenant)  
