# Kidoland UI and UX guidance

**Updated:** 2026-10-05
**Purpose:** implementation guidance for the existing single-school, SQ/EN web app.
**Sources:** [MVP PRD](kidoland-prd-v1.md), [approved attendance boundaries](../_bmad-output/implementation-artifacts/spec-daily-attendance.md), [brainstorm](../_bmad-output/brainstorming/.memlog.md), and `src/App.tsx`, `src/App.css`, `src/i18n/translations.ts`. The attendance spec wins on scope or behavior conflicts. Consent and management rules below are explicit implementation recommendations for the following features, rather than already implemented behavior.

## Experience and visual hierarchy

Use forest green primary actions, warm cream page backgrounds, white record cards, and a consistent set of outline icons. The shared design system lives in `src/theme.css`; module layouts remain in `src/App.css`, and icons live in `src/Icon.tsx`. Use one clear page title, a short description, then the task controls and records. Main screens occupy the available workspace instead of placing the whole page inside a narrow card. Reserve cards for related records, forms, summaries, and actions. Child name is the first item in every child card; group and date follow. Use written status labels alongside color. Avoid photos as decoration: the pilot has a consent flag, not a photo sharing system.

Keep each action beside the record it affects. Attendance saves immediately per child; reports and consent use an explicit Save action. Show success only after the server confirms the result. Do not advertise card payment, enrollment, classroom management, or offline sync until available. Describe pilot payments as invoices and recorded payments.

## Navigation and dashboards

After login, open the role dashboard. Keep Dashboard, Attendance, Reports, and Payments reachable for every role; add Children for director management and Photo consent for parents when those features ship. Staff can inspect consent in child details. Mark the current destination visually and with `aria-current="page"`.

On desktop, use a persistent 236px sidebar grouped into Daily care, Family & community, and Care & management. The header shows the active screen, language switch, account identity, and logout. At widths of 900px or less, a labeled navigation toggle opens the grouped links; choosing a destination closes it and focuses the page heading. Opening the menu moves keyboard focus to the active link. Escape closes the menu and returns focus to the toggle. At phone widths, expanded links use two columns. Keep all destinations available to the existing roles, with written labels alongside icons. Language and logout remain available in the header, with no horizontal scrolling.

| Role | Dashboard order | Primary action | Other useful destinations |
| --- | --- | --- | --- |
| Teacher | Today's date → attendance → daily reports | Mark attendance | Write report; view invoices |
| Parent | Linked child cards → today's attendance/report → unpaid invoices | View today's report | Attendance history; invoices; photo consent |
| Director | Today's attendance → report completion → unpaid invoices | Review attendance | Children/parent links; invoices; reports |

Attendance counts must include **unmarked** separately: present + absent + unmarked = roster size. Report completion counts distinct children with a saved report for the selected day, rather than all report records. If data is loading or unavailable, display that state instead of zero. Keep summaries simple; no live occupancy, room capacity, reminders, or projected analytics. Dashboard links should open the named working screen and carry the selected date. Show six real-data metrics, attendance and report progress for staff, and child-specific status cards for parents. Keep three primary shortcuts for attendance, reports, and payments; the sidebar provides the remaining destinations. A count or balance only appears after a successful API response. Decorative welcome artwork never implies a live record.

## Attendance: fast, explicit, correctable

1. Teacher opens Attendance on a phone. A labeled date input defaults to the browser's **local calendar date**; a Today button restores it. Accept any real calendar date supported by the approved spec; do not silently prohibit past or future dates.
2. Show children with group names in stable name order. Provide a local child/group search and present, absent, and unmarked summary counts for the complete loaded roster. Search filters visible rows without changing saved records or counts; no matches offers Clear search. Each row/card has name, group, saved status, and two staff buttons: Present and Absent. A missing entry reads Unmarked. It must never appear absent or count as absent.
3. Tapping a status saves just that child/date. Indicate the pending choice as Saving; disable conflicting attendance actions while the save is pending. Keep the last confirmed status distinguishable from the pending request.
4. Success updates the saved label and selected button. Corrections use the same buttons and update the same entry. No confirmation dialog or batch action is needed.
5. Failure retains the last confirmed status and shows an inline error with Retry. Retry repeats the attempted child/date/status only while that context is still current. The user can also choose the status again.
6. Parent opens the same date-based roster for linked children, with labels only and no write controls. Do not show other families' names.

On date change, clear the old date's rows while loading; do not display the previous day's status under the new date. Ignore late responses after date/account changes. Logout clears personal content immediately. A failed roster request shows an error and Retry, not an empty roster. An empty roster is a successful response with no children. Never infer attendance from reports.

## Photo consent: a separate, parent-owned choice

Proposed pilot policy: default `false`; an existing child with no recorded consent has **no permission**. Parent may change only their linked children's choice. Teacher and director can read consent to guide care; they cannot grant it on behalf of a parent. A director linking a child to a parent does not imply permission. Keep the scope to one yes/no flag per child; granular albums, public marketing permission, photo uploads, and signatures are later work.

For each linked child, show the saved choice and a labeled radio group: Allow photos / Do not allow photos. Describe the pilot's intended use concretely: “Allow the kindergarten to include your child in photos shared privately with their family through Kidoland.” This proposed purpose must match the school's actual use before any photo feature ships; it does not authorize public sharing. Explain that the parent can change the choice anytime.

Changing the radio selection is a draft until Save choice succeeds. Show Saved next to the child afterward. During save, disable the card's choices and Save; retain the last confirmed choice on error and keep the draft for Retry. Staff see “Photo permission: Allowed / Not allowed.” If consent cannot be loaded, show “Permission unavailable” and do not treat it as allowed. A false default is not proof the parent explicitly refused: do not display “Parent declined” without evidence.

## Children and parent links

Director-only management: child name, group, and linked parent account. Use existing parent accounts in the selector; do not silently create accounts or invent an invitation flow. If no parent accounts exist, explain why linking cannot proceed. Teacher sees the roster; parent sees only linked children. Hide mutation controls for those roles and enforce the same restrictions on the server.

Use a small labeled form with Save and Cancel, field-level required errors, and visible child context. Editing a link must explicitly identify the selected parent before saving because it changes who sees reports, attendance, invoices, and consent. Do not add delete/archive controls to this pilot without a separate requirement. Preserve existing records when editing name/group. Recommended transfer rule: clear photo permission when parent ownership changes and require the newly linked parent to choose; disclose this alongside the link change. This prevents carrying another guardian's permission into the new relationship.

## Reports and invoice detail

Reports: staff choose child and local date first, then mood, meals, nap, activities, and optional note. Keep frequently used answers short and selectable where supported, with free text for nuance. A saved report clearly identifies child/date and gives a success message before clearing its fields. Parent cards prioritize mood, meals, nap, then activities/note. “No report for this day” must remain distinct from a failed load. Translate labels and preset options; preserve teachers' free text exactly as authored. On desktop, mood, meals, and nap selectors share a row, with activities in a separate checklist section; on phones these fields stack.

Invoices: each invoice shows child, billing period, due date, fee descriptions/amounts, total, and Pending/Paid. Fee line totals must equal the invoice total; display the currency consistently. A director creates line items with labeled description and amount fields and explicit Add fee / Remove fee controls; preserve entered lines on validation failure. Parent sees a readable breakdown before any payment-status action. Keep the current staff ability to record payment; parents have no Mark paid control. Do not offer Pay now without a working payment route. Label old invoices without itemization honestly rather than inventing historical fees.

## Bilingual labels and states

Every control, success/error message, empty state, loading state, and accessible name must switch with SQ/EN. Keep names, group names, notes, and other user-entered content unchanged. Use localized display dates and currency while API dates remain `YYYY-MM-DD`. Changing language must preserve the current date, draft values, and navigation state. Update the document language. Albanian labels must wrap without clipping.

| English | Albanian |
| --- | --- |
| Attendance | Pjesëmarrja |
| Date / Today | Data / Sot |
| Present / Absent / Unmarked | I pranishëm / Mungon / Pa shënuar |
| Loading attendance… | Duke ngarkuar pjesëmarrjen… |
| Saving… / Saved | Duke ruajtur… / U ruajt |
| Could not load attendance. | Pjesëmarrja nuk mund të ngarkohej. |
| Could not save attendance. Try again. | Pjesëmarrja nuk mund të ruhej. Provoni përsëri. |
| Retry | Provo përsëri |
| No children to show. | Nuk ka fëmijë për t'u shfaqur. |
| Choose a valid date. | Zgjidhni një datë të vlefshme. |
| Photo consent | Pëlqimi për fotografi |
| Allow photos / Do not allow photos | Lejoj fotografi / Nuk lejoj fotografi |
| Save choice | Ruaj zgjedhjen |
| Allowed / Not allowed | Lejohet / Nuk lejohet |
| Permission unavailable | Leja nuk është e disponueshme |
| Could not save your choice. Try again. | Zgjedhja juaj nuk mund të ruhej. Provoni përsëri. |
| You can change this choice anytime. | Mund ta ndryshoni këtë zgjedhje në çdo kohë. |
| Children / Group / Linked parent | Fëmijët / Grupi / Prindi i lidhur |
| Save / Cancel | Ruaj / Anulo |
| No report for this day. | Nuk ka raport për këtë ditë. |
| Fee / Total / Add fee / Remove fee | Tarifa / Gjithsej / Shto tarifë / Hiq tarifën |

These labels are a starting dictionary, not permission to leave unlisted states untranslated. Keep equivalent keys in both dictionaries. Use calm errors explaining the next action, and a translated session-expired message when authentication ends.

## Mobile and accessibility floor

- At 320px, stack card content and controls, allow long names to wrap, and fit date inputs/forms within the panel. On desktop, attendance rows can align identity, status, and actions horizontally without changing reading order.
- Aim for 44px touch targets. Use native buttons, date inputs, labels, and radio groups; include child name in attendance control accessible names. Selected status buttons expose `aria-pressed`; consent radios expose their group label.
- Provide a visible keyboard focus indicator and text/color contrast of at least 4.5:1 for ordinary text. Color alone must never communicate present/absent, selected, paid, or error.
- Announce loading/saving/success with a restrained polite live region; announce actionable errors with an alert. Associate field errors with inputs. Avoid moving focus on save or re-rendering the focused row with a new key.
- After navigation, focus the page heading or main region. Keep keyboard order consistent with visual order. No animation is needed; any later transitions should respect reduced motion.
- Check keyboard use, 200% zoom, 320px and desktop, SQ/EN, long names, multiple linked children, no children, loading/failure/retry, date changes during requests, and account changes. Verify every role's actual controls and empty states.

## Public welcome and sign-in

Use locally rendered garden artwork to introduce the app, with an explicitly labeled example report rather than fabricated live metrics. Describe working features and offer the existing sign-in route. The sign-in screen pairs a quiet introduction with a clearly labeled form; mobile shows the form directly. Provide an accessible show/hide password control and prevent demo-account changes during a pending login. Demo role cards fill credentials without signing in automatically.

## Redesign verification

The browser regression suite exercises real app workflows against an ephemeral database at 320px, including bilingual drafts, mobile navigation open/close and Escape focus, attendance search, report correction, invoice retries, messaging, consent, receipts, and session changes. Visual layout audits also inspect all 15 screens for each role in English and Albanian at 1440px, 768px, 390px, and 320px. Respect reduced motion, native control semantics, visible keyboard focus, and the existing authorization rules.
