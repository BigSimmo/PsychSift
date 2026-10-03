# Privacy Impact Assessment â€” PsychSift Production

**Current status authority:** [`docs/governance/privacy-readiness.v1.json`](governance/privacy-readiness.v1.json). This narrative explains the assessment; the versioned register separates code proof from provider configuration, legal approval, and clinical acceptance. Pending external items in that register are not completed by technical controls described here.

**Status:** Draft for governance approval Â· **Date:** 2026-07-06 Â· **Revised:** 2026-09-01
**Scope:** Clinical data flows through the PsychSift app (Next.js on Railway Singapore + Supabase Sydney + OpenAI), the live Supabase project `PsychSift Production` (`sjrfecxgysukkwxsowpy`), and the WA private-clinical deployment context.
**Author:** Automated code-level assessment (multi-agent audit of `src/app/api/**`, `src/lib/*`, `supabase/schema.sql`, `supabase/migrations/**`), cross-checked against the live database.

**Repository last verified:** `d3074946a917cac378de64284c67cbc1d4dc58fa` on 2026-09-01.
Provider, contractual, and legal claims retain their individual evidence dates. This revision
reconciles the repository's OpenAI DPA/ZDR claims against the external-evidence boundary and records
current names-only provider checks; it does
not claim a Railway contract, whole-of-flow legal approval, or clinical acceptance. See the
[2026-09-01 closeout record](governance/privacy-closeout-2026-09-01.md).

**2026-09-20 addition.** The On Call Compliance page was added to the register: a new
personal-information category in section 2, a new gap **PIA-9** in section 10, and a pointer from the
APP 6 row in section 9. That entry was written by reading the working tree of the unmerged feature
branch `claude/on-call-review-redesign-1yyqh0` on 2026-09-20; it describes code that has not been
merged to `main` and therefore has never been deployed, and no live database was read for it. The
**Revised** date above deliberately still reads 2026-09-01, because nothing else in this document was
re-checked and the earlier revision's evidence and approval status are unchanged.

> **This is not legal advice.** It is a technical privacy assessment written to be handed to a
> privacy officer / legal reviewer. Statements about the _Privacy Act 1988_ (Cth), the Australian
> Privacy Principles (APPs) and WA health-records obligations are engineering interpretations that
> must be confirmed by a qualified adviser before the app is used with real patients.

---

## Roster Release 2 local implementation assessment (2026-09-27)

This addition describes local implementation and the proposed follow-up database
contract. It is not evidence of deployment, health-service privacy approval or a
successful staging isolation run. Real staff use remains gated on that approval,
two-user staging isolation proof and the decision about Singapore application
servers. Roster has no patient-data purpose and no AI processing.

| Information                              | Access and purpose                                                                                                                                                                                                                                                                                                                                                                                                   | Retention and deletion                                                                                                                                                                                         |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Team roster and member names             | Active members of the same confirmed team see shifts; designated roster managers publish and manage members.                                                                                                                                                                                                                                                                                                         | Team roster history is retained for 12 months under the database contract. Deleting personal Roster data does not remove the team's assignments.                                                               |
| Swaps, open shifts and dates unavailable | Session-scoped actions; doctors act on their own requests, managers decide eligible team requests.                                                                                                                                                                                                                                                                                                                   | Delete my data withdraws pending requests and clears future unavailable dates; completed team decisions remain team records. Failed withdrawals are disclosed.                                                 |
| Planned leave                            | The owner maintains their leave. Ordinary active team members see only an anonymous overlap count. The G4 follow-up allows designated managers to read active members' named leave within the same confirmed team, limited to user id, name, kind, start/end dates and status over at most 62 days, for roster planning. Ordinary and former members cannot read that named view. HR remains the approval authority. | Leave is purged 365 days after its end date and can be removed individually or through Delete my data. The named manager view requires matching service approval and isolation evidence before real staff use. |
| Publication seen receipts                | Team managers see whether active members have seen the latest roster, to target reminders.                                                                                                                                                                                                                                                                                                                           | Managed with team publication records; not exported to analytics.                                                                                                                                              |
| Browser push subscription                | Endpoint and encryption keys are stored for the subscribing account; a shared browser subscription transfers to the last subscribing account.                                                                                                                                                                                                                                                                        | Removed when disabled, deleted with personal data, or removed after a push-service 404/410. Push providers receive only a fixed type code. Lock-screen text contains no name, time or workplace.               |
| Ask Roster text                          | Parsed in the current browser tab. Structured dates and shift identifiers are used only after the doctor opens a request.                                                                                                                                                                                                                                                                                            | Typed text is not sent to AI, a server, analytics, URLs or persistent browser storage.                                                                                                                         |
| Invitations and owner panel              | The platform owner confirms teams and appoints managers. Looking up an individual member's email is explicit and owner-only. Managers create email-bound invitations; the code is in a URL fragment and removed on opening.                                                                                                                                                                                          | Invitations expire within seven days. Codes are not persisted on the phone; the database stores only the token hash.                                                                                           |
| Uploaded roster file                     | PDF/Excel files are processed in application-server memory by the existing file reader; CSV is parsed locally. The publication operation receives structured shift rows and a source filename only.                                                                                                                                                                                                                  | Files and raw extracted cells are not logged or stored. Browser preview data is memory-only.                                                                                                                   |
| Calendar feed and Excel export           | The private calendar feed exposes only the owner's opted-in shifts with generic titles, no colleague names or workplace. Excel export is manager-only and contains team names and shift times.                                                                                                                                                                                                                       | The feed is not a shared cache; each request rechecks team access. A downloaded workbook is a user-held copy requiring the service's handling policy.                                                          |

Publishing must recheck the preview freshness under the same database lock as
approvals, and write roster names, codes and assignments in one transaction.
An unavailable safety operation keeps Publish disabled. Local code and mocked
tests do not establish hosted access controls, processor configuration or legal
approval.

## 1. Executive summary

The app is a **clinical knowledge base** â€” it indexes clinical reference material (guidelines,
drug monographs, protocols) and answers clinician questions over that corpus with retrieval-augmented
generation. It is **not** a patient record system. Provider-backed features do not ask for patient
identifiers. The Safety Plan Generator accepts sensitive identifier-free working content and support
contacts, but keeps them in the current browser tab rather than transmitting or persisting them.

The dominant privacy risk is therefore **incidental PHI**: a clinician will inevitably type patient
details into a free-text query ("42yo F on clozapine 400mg with rising WCC, next step?"). That query
is processed by the Railway application tier in Singapore and can be sent to OpenAI in the United
States for retrieval embedding even when the final answer is source-only. When model-backed answer
synthesis is used, the query and selected excerpts are sent again. The query is hash-redacted before
it is written to log tables in Supabase. A secondary
risk is PHI inside **uploaded documents** if users upload anything other than published reference
material.

**What is already good:**

- **Data residency**: the Supabase project runs in **`ap-southeast-2` (AWS Sydney, Australia)** â€”
  clinical data at rest stays onshore. Confirmed live via the Supabase API (project region
  `ap-southeast-2`).
- **Query redaction**: raw query text is **not** persisted **server-side** by default. Every log write
  goes through `queryTextForStorage()` which stores a hash placeholder unless
  `RAG_PERSIST_RAW_QUERY_TEXT=true` ([src/lib/query-privacy.ts](../src/lib/query-privacy.ts)). This is a
  server-side statement only: the browser row in §2 and the browser-side retention note in §6 record
  that raw query text and the generated answer are held in `window.sessionStorage` for up to 12 hours
  (gap PIA-8).
- **The M15 HMAC fix is present** ([src/lib/query-privacy.ts](../src/lib/query-privacy.ts)) â€” the
  stored hash is a keyed HMAC-SHA256 pseudonym **when `RAG_QUERY_HASH_SECRET` is set** (see gap PIA-2).
- **Retention is automated**: nightly `pg_cron` jobs purge `rag_queries` (30d) and
  `rag_retrieval_logs` (90d). **Verified running on live** (both jobs `active = true`) - verified
  2026-07-06 under job ids that were re-issued 2026-09-01; see §6 for what is and is not proven since.
- **OpenAI response storage is off** by default (`OPENAI_STORE_RESPONSES=false`,
  [src/lib/env.ts](../src/lib/env.ts)).
- Storage buckets are **private**; files are only reachable via short-lived (10 min) server-minted
  signed URLs after an ownership check.

**Top gaps (full register in Â§10):**

| ID     | Risk      | One-line                                                                                                                                                                                                                                                                                                                                                   |
| ------ | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PIA-1  | High      | Overseas processing occurs in Railway Singapore and OpenAI US; the applicable processor/APP 8 basis and final notice wording require governance approval.                                                                                                                                                                                                  |
| PIA-2  | Mitigated | Production fails closed without `RAG_QUERY_HASH_SECRET`; names-only presence in Railway and GitHub was recorded on 2026-07-27. Value equality was not exposed read-only.                                                                                                                                                                                   |
| PIA-3  | Mitigated | Generated answer text is omitted from `rag_queries` by default. `RAG_PERSIST_ANSWER_TEXT=true` is explicit opt-in and blocked by production readiness.                                                                                                                                                                                                     |
| PIA-4  | Mitigated | Query-miss and bounded response-cache purges were verified active live on 2026-07-14; the duplicate unbounded cache job was removed.                                                                                                                                                                                                                       |
| PIA-5  | Medium    | Draft point-of-entry collection notices and a `/privacy` data-processing page ship, but no governance-approved final privacy policy exists (APP 1, APP 5).                                                                                                                                                                                                 |
| PIA-6  | Low-Med   | GPT-5.6-and-later models use `prompt_cache_options.ttl="30m"` by default; gpt-5.5 forces the legacy 24h field. OpenAI documents up to 24 hours of prompt-cache application state; the configured TTL is only the minimum cache lifetime.                                                                                                                   |
| PIA-7  | Low       | `RAG_PERSIST_RAW_QUERY_TEXT=true` would store raw PHI query text with no secondary safeguard beyond the 30-day purge.                                                                                                                                                                                                                                      |
| PIA-8  | Low-Med   | A completed answer thread keeps raw query text and the generated answer in `sessionStorage` for up to 12 h; on a shared clinical workstation an unclosed tab leaves incidental PHI restorable.                                                                                                                                                             |
| PIA-9  | Mitigated | On Call compliance records (a clinician's own registration, indemnity, credentialing, training, CPD, Working with Children Check and police clearance) are now stored private and withheld fail-closed from the anonymous On Call shared read. Whether the clearance fields are "sensitive information" is an open APP 3 / APP 6 question for the adviser. |
| PIA-11 | Medium    | CPD records are one clinician's own professional record, including free-text reflections and uploaded certificates; owner-only, never sent to OpenAI or indexed. Patient details typed or uploaded by mistake rely on warnings only (re-review item 8).                                                                                                    |

---

## 2. System overview and data classification

| Data category                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Where it lives                                                                                                                                                                                                                                                               | Sensitivity                                                                                                                                | Notes                                                                                                                                                                                                                                                                                     |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Clinical reference corpus (documents, chunks, embeddings, images, tables)                                                                                                                                                                                                                                                                                                                                                                                                              | Supabase (Sydney) + storage buckets                                                                                                                                                                                                                                          | Lowâ€“Medium                                                                                                                               | Published guidelines are not PHI; **uploaded** docs _could_ contain PHI.                                                                                                                                                                                                                  |
| Free-text clinical queries                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Processed by Railway (Singapore); hashed into Supabase logs (Sydney); sent to OpenAI (US) for retrieval embedding and, when selected, answer synthesis                                                                                                                       | **High (potential PHI)**                                                                                                                   | The primary incidental-PHI vector; embedding egress can occur even when the final answer is source-only.                                                                                                                                                                                  |
| Generated answers                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `rag_queries.answer` (not persisted unless `RAG_PERSIST_ANSWER_TEXT`); short-lived `rag_response_cache.payload`                                                                                                                                                              | **High (derived from PHI query + corpus)**                                                                                                 | Durable answer log dropped at rest by default (PIA-3); expired cache rows have a bounded hourly purge when `pg_cron` is available.                                                                                                                                                        |
| Safety-plan working content                                                                                                                                                                                                                                                                                                                                                                                                                                                            | React memory in the current browser tab; user-directed clipboard, print, or PDF output                                                                                                                                                                                       | **High (sensitive health information)**                                                                                                    | No patient-identifier field; not sent to the application service or stored by PsychSift. Exported copies leave this boundary.                                                                                                                                                             |
| Answer threads and recent queries in the browser                                                                                                                                                                                                                                                                                                                                                                                                                                       | `window.sessionStorage`, owner-scoped keys `clinical-kb-answer-thread:<ownerId>` and `clinical-kb-recent-queries:<ownerId>`                                                                                                                                                  | **High (raw query text + derived answer)**                                                                                                 | Raw query text, generated answer, and source excerpts for up to 12 turns, 12-hour TTL; last 5 raw queries. Tab-scoped; see section 6.                                                                                                                                                     |
| User identity                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Supabase Auth (`auth.users`), `owner_id` foreign keys                                                                                                                                                                                                                        | Medium (PII)                                                                                                                               | Email + SSO identity; managed by Supabase Auth.                                                                                                                                                                                                                                           |
| Audit trail                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `audit_logs`                                                                                                                                                                                                                                                                 | Medium                                                                                                                                     | Append-only, service-role-only, retained indefinitely by design.                                                                                                                                                                                                                          |
| Operational telemetry                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `rag_retrieval_logs`, ingestion job tables                                                                                                                                                                                                                                   | Lowâ€“Medium                                                                                                                               | Redacted query text; per-owner.                                                                                                                                                                                                                                                           |
| On Call compliance requirements (the account holder's own registration, indemnity, credentialing, mandatory training, CPD, Working with Children Check and police clearance)                                                                                                                                                                                                                                                                                                           | Supabase (Sydney): `on_call_entries.details` JSONB on rows whose `section` is `logistics`, owner-scoped. The rendered list is also cached in the browser's `localStorage`.                                                                                                   | **High (personal information about an identified individual; the clearance fields may also be sensitive information - see PIA-9)**         | Not patient data: these are recorded dates about the clinician using the app. Stored `is_personal` by the server whatever the request body says, withheld fail-closed from the anonymous shared read, kept off the printable card, and never sent to OpenAI. Added 2026-09-20; see PIA-9. |
| CPD record: the account holder's own activities (title, date, hours, category split, cost), free-text reflections, source links, development-plan goals, routines, drafts (with "waiting for supervisor/workforce" notes and follow-up dates), missed teaching sessions (title, minutes lost, optional reason), training periods and milestones (stage, rotation, FTE, dates), year snapshots and amendment reasons, and uploaded evidence files (certificates, receipts, assessments) | Supabase (Sydney): 14 `cme_*` tables, owner-scoped, service-role only; files in the private bucket `cme-private-evidence`. The unsaved log form is also held in the browser tab's `sessionStorage` until saved or the tab closes; Today's module order is in `localStorage`. | **High (personal information about an identified individual; free text and files may carry patient details despite controls, see PIA-11)** | Not patient data by design. Never sent to OpenAI, never indexed, never read by retrieval, embedding or answer paths. Added 2026-09-20 onwards; see PIA-11.                                                                                                                                |
| Roster own shifts (`on_call_shifts`, `on_call_shift_imports`): a doctor's own shift times, title, place, workplace and import file name                                                                                                                                                                                                                                                                                                                                                | Supabase (Sydney), owner-scoped, service role only                                                                                                                                                                                                                           | Medium (staff personal information, not patient data)                                                                                      | The doctor only; kept until they delete it. The uploaded file itself is read in memory and never stored.                                                                                                                                                                                  |
| Roster calendar links (`roster_calendar_links`): the address of the doctor's own roster calendar                                                                                                                                                                                                                                                                                                                                                                                       | Supabase (Sydney), owner-scoped, service role only                                                                                                                                                                                                                           | Medium (the link is a secret)                                                                                                              | The doctor only; kept until they delete it. Never logged.                                                                                                                                                                                                                                 |
| Roster settings (`user_preferences.roster`): the doctor's remembered roster row name, what each shift code means per workplace, and whether shifts go to their calendar feed; plus the evening-before shift reminder in their reminder settings                                                                                                                                                                                                                                        | Supabase (Sydney), the doctor's own preferences row, service role only; never sent to the phone's storage                                                                                                                                                                    | Low                                                                                                                                        | The doctor only; removed by Roster's delete-my-data or with the account.                                                                                                                                                                                                                  |
| Team roster (`roster_publications`, `roster_assignments`): staff names and shift times for a team                                                                                                                                                                                                                                                                                                                                                                                      | Supabase (Sydney), reached only through `roster_read` / `roster_command`                                                                                                                                                                                                     | Medium (staff personal information)                                                                                                        | Members of that team; 12 months. Printed names of people not on the app are cleared 90 days after the shift.                                                                                                                                                                              |
| Swaps and open shifts (`roster_swaps`, `roster_open_shifts`)                                                                                                                                                                                                                                                                                                                                                                                                                           | Supabase (Sydney), through the Roster functions                                                                                                                                                                                                                              | Medium                                                                                                                                     | The two doctors and the team's managers; 12 months.                                                                                                                                                                                                                                       |
| Roster seen receipts (`roster_publication_seen`): when a doctor first opened a published roster                                                                                                                                                                                                                                                                                                                                                                                        | Supabase (Sydney), through the Roster functions                                                                                                                                                                                                                              | Low-Med                                                                                                                                    | The team's roster managers only; deleted with the roster (12 months).                                                                                                                                                                                                                     |
| Dates a doctor can't work (`roster_unavailability`): dates only, no reason                                                                                                                                                                                                                                                                                                                                                                                                             | Supabase (Sydney), through the Roster functions                                                                                                                                                                                                                              | Low-Med                                                                                                                                    | The doctor and the team's managers; 30 days after the date.                                                                                                                                                                                                                               |
| Planned leave (`roster_leave`): dates and type (annual or professional development), no reason                                                                                                                                                                                                                                                                                                                                                                                         | Supabase (Sydney), owner-scoped                                                                                                                                                                                                                                              | Medium                                                                                                                                     | The doctor and Admin mode; the team sees a count only; 12 months after it ends.                                                                                                                                                                                                           |
| Phone alert subscriptions (`web_push_subscriptions`): a browser's push address and keys, no shift content                                                                                                                                                                                                                                                                                                                                                                              | Supabase (Sydney), owner-scoped                                                                                                                                                                                                                                              | Low                                                                                                                                        | The doctor only; until they turn alerts off.                                                                                                                                                                                                                                              |
| Team membership audit (`on_call_service_member_events`): joins, removals and role changes                                                                                                                                                                                                                                                                                                                                                                                              | Supabase (Sydney), service role only                                                                                                                                                                                                                                         | Low-Med                                                                                                                                    | Platform only; 12 months.                                                                                                                                                                                                                                                                 |
| Admin extra time, leave balances and settings (`extra_time_records`, `admin_leave_balances`, `admin_settings`) and Teaching tables (`teaching_*`)                                                                                                                                                                                                                                                                                                                                      | Supabase (Sydney), service role only                                                                                                                                                                                                                                         | Medium (staff personal information)                                                                                                        | As the Admin and Teaching plans describe.                                                                                                                                                                                                                                                 |

**Planned Roster Release 2 leave access (approved by Josh 2026-09-27; not yet deployed):**
the current table row above describes the count-only access in the merged SQL; live schema
application is checked separately by the post-merge drift workflow. The follow-up migration's
`roster_read('team_leave')` will let a roster manager of a confirmed team see an active team
member's `userId`, name, leave kind (annual or professional development), start and end dates,
and status (planned, applied or approved), for a requested window of at most 62 days. The
purpose is to plan cover; this view does not approve leave. Ordinary members continue to see
only the anonymous overlap count. The dates, kind and status stay in the existing owner-scoped
`roster_leave` table in Supabase (Sydney); names come from the team's member record. No leave
reason or patient information is collected, and the plan adds no phone storage. The merged purge
is designed to delete leave 12 months after it ends; account deletion cascades to the leave row.
Release 2's
"Delete my data" flow will delete the doctor's own leave rows, and revoking team membership
must remove named-read access immediately. Before real staff use this view, update the current
inventory row when G4 ships, pass the manager/member/former-member staging isolation proof,
obtain the health service's privacy approval, and resolve the Singapore app-server decision.

**Roster, Admin and Teaching (added 2026-09-26):** these tables hold staff personal information,
not patient data. The app servers run in Singapore and the database in Sydney; a health service may
require Australian hosting, which is checked with them before real staff data goes in. P1 #F9HZEG
(two-user isolation proof) must close first.

**Admin update 1:** Today, Renewals, New job and Help read the owner's existing On Call
`logistics` records; this interface adds no database table or browser cache. Other doctors'
shared rows are read-only and are excluded from the owner's calendar, copy and print outputs.
Optional proof notes are checked for patient-identifying shapes before saving. Admin records
are not sent to search or a model provider.

**Admin pinned numbers (owner decision, 2026-10-01):** Help and Today let the doctor pin the
numbers they ring most. Pins are the one thing Admin keeps on the device: `localStorage` key
`clinical-kb-admin-pins` holds up to eight `on_call_entries` row ids and nothing else (no title,
number or other record text; anything that is not a row id is refused on write and dropped on read).
They are removed on sign-out and account switch through `clearAccountScopedBrowserState`
([client.tsx](../src/lib/supabase/client.tsx)). Evidence: [pins.ts](../src/lib/admin/pins.ts),
[tests/admin-pins.test.ts](../tests/admin-pins.test.ts).

**Patient labels on the device (Today plan, 2026-10-03):** a bed number or a patient's initials,
the only patient labels Today features may hold, are kept on the device and never sent to the
server. Every such store must use [patient-label-storage.ts](../src/lib/patient-label-storage.ts):
its keys share one prefix, `psychsift:patient-labels:`, and an expiry stamp is written before any
label. Labels are wiped at the end of the shift (the rostered end when the writer knows it,
otherwise 12 hours after the first label of the shift; a later roster end may bring the wipe
forward but never push it back) and on sign-out and account switch through
`clearAccountScopedBrowserState`. The wipe removes only keys with that prefix, and fails closed:
a missing, damaged or clock-contradicted stamp wipes the labels rather than showing them. As of
this change no feature writes a label yet; the timer, call-note and handover builds plug into it.
Evidence: [tests/patient-label-storage.dom.test.tsx](../tests/patient-label-storage.dom.test.tsx).

**Deployment context (from code):** the answer system prompt positions the assistant as _"an
experienced psychiatrist in Perth"_ ([src/lib/rag/rag.ts](../src/lib/rag/rag.ts)) â€” i.e. a **WA psychiatry**
use case. Psychiatric context raises the sensitivity ceiling: mental-health information is squarely
"sensitive information" and "health information" under the _Privacy Act 1988_ (Cth).

---

## 3. Clinical-data flow map

The end-to-end path for a single clinician query. **Bold** nodes are where PHI can land.

```
Clinician browser
   â”‚  POST /api/answer  { query: "<free text, may contain patient details>", ... }
   â–¼
[Next.js route â€” Railway Singapore]  src/app/api/answer/route.ts
   â”‚  â€¢ auth resolved â†’ access.ownerId (or undefined for anon/public)
   â”‚  â€¢ rate-limit bucket "answer"
   â”‚  â€¢ resolveSearchScope() â†’ owner-scoped candidate document set
   â–¼
[RAG pipeline]  answerQuestionWithScope()  src/lib/rag/rag.ts
   â”‚
   â”œâ”€â”€â–º(A) QUERY EMBEDDING â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
   â”‚      raw query text â†’ OpenAI embeddings (text-embedding-3-small)    â”‚
   â”‚      src/lib/openai.ts embedTextWithTelemetry                         â”‚  â–ºâ–º OpenAI API
   â”‚                                                                     â”‚     (US region,
   â”œâ”€â”€â–º(B) RETRIEVAL (Supabase RPCs, owner-filtered in SQL)             â”‚      api.openai.com)
   â”‚      match_document_chunks* etc. â€” Sydney, never leaves AU          â”‚
   â”‚                                                                     â”‚
   â”œâ”€â”€â–º(C) ANSWER SYNTHESIS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
   â”‚      **raw query verbatim** (answer-generation request builder)     â”‚
   â”‚      + **retrieved chunk text** (buildRagSourceBlock)               â”‚
   â”‚      + system instructions                                          â”‚
   â”‚      â†’ OpenAI Responses API (Terra fast / Sol strong)              â”€â”˜
   â”‚      store:false; GPT-5.6 prompt_cache_options.ttl:30m
   â”‚
   â”œâ”€â”€â–º(D) LOCAL LOGGING (Supabase, Sydney, owner-stamped)
   â”‚      insertRagQuery()
   â”‚        â€¢ query           = **hash placeholder** (queryTextForStorage)  â† redacted
   â”‚        â€¢ normalized_query= **hash placeholder**                        â† redacted
   â”‚        â€¢ answer          = null unless RAG_PERSIST_ANSWER_TEXT         â† dropped at rest (PIA-3)
   â”‚        â€¢ source_chunk_ids= real chunk UUIDs                            â† owner's own data
   â”‚        â€¢ metadata.query_hash = HMAC/SHA-256 (query-privacy.ts)
   â”‚
   â””â”€â”€â–º(E) RESPONSE CACHE (Supabase rag_response_cache, authenticated owner-scoped)
          payload = full answer, TTL ~5 min (RAG_ANSWER_CACHE_TTL_MS)
          disabled for anonymous answers; authenticated rows are keyed by owner_id
   â–¼
Clinician browser  â† answer + citations
```

`/api/search` follows the same shape but writes `rag_queries` / `rag_query_misses` /
`rag_retrieval_logs` (all redacted via the same helpers â€”
[src/app/api/search/route.ts](../src/app/api/search/route.ts)).

The browser request, answer pipeline, and ingestion worker are processed by Railway in Singapore. The
model egress points (A) and (C) then carry query/evidence content to OpenAI in the US. Durable Supabase
data remains in Sydney. Governance must assess both overseas processing paths rather than treating
OpenAI as the only cross-border flow.

The `/safety-plan` route has a separate local-only flow: form inputs update React state in the current
browser tab, with no API request or browser-storage write. Clearing the plan, unmounting the component,
or closing the tab discards that working state. Copy, print, and save-as-PDF are explicit user-directed
exports; the exported copy is outside PsychSift and must be handled under the organisation's approved
clinical-record process. The tool provides no patient name, date-of-birth, or record-number field and
warns against putting patient identifiers into free text; any patient identifier must be added after
export if local policy permits it. Support-contact names and phone details are accepted as sensitive
working content within the same local-only boundary.

---

## 4. What reaches OpenAI, and under what terms

### 4.1 What is sent

| Payload         | Content                                                                                                                                       | Reference                                                              |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Embedding input | **Raw query text**, verbatim (normalized whitespace/case only)                                                                                | [src/lib/openai.ts](../src/lib/openai.ts) â†’ `embedTextWithTelemetry` |
| Answer input    | **Raw query verbatim** (`Question:\n${args.query}`)                                                                                           | [src/lib/rag/rag.ts](../src/lib/rag/rag.ts)                            |
| Answer input    | **Retrieved chunk text** (content, capped ~1800 chars, plus title/page/section/table-facts/captions)                                          | [src/lib/rag/rag.ts](../src/lib/rag/rag.ts)                            |
| Instructions    | Static system prompt ("experienced psychiatrist in Perthâ€¦")                                                                                 | [src/lib/rag/rag.ts](../src/lib/rag/rag.ts)                            |
| Metadata        | `{ operation }`; when configured, `safety_identifier` is an HMAC-SHA256 pseudonym of the authenticated owner. The raw owner id is never sent. | [src/lib/openai.ts](../src/lib/openai.ts)                              |

The app never _adds_ patient identifiers, but it does not scrub them either: **any PHI the clinician
types into the query, or that exists in an indexed excerpt, is transmitted to OpenAI.**

### 4.2 Handling controls on the OpenAI request

- **Models:** `gpt-5.6-terra` for fast synthesis, summaries, indexing, and vision;
  `gpt-5.6-sol` for strong synthesis; `gpt-5.6-luna` is the documented query-classifier
  rollout target; `text-embedding-3-small` remains the embedding model
  ([src/lib/env.ts](../src/lib/env.ts), [.env.example](../.env.example)). Existing deployments
  with explicit model variables remain pinned until their configuration is changed.
- **`store: false`** by default â€” responses are not retained in OpenAI's dashboard/store
  ([src/lib/openai.ts](../src/lib/openai.ts), [src/lib/env.ts](../src/lib/env.ts)).
- **GPT-5.6 prompt caching:** the app sends `prompt_cache_options: { ttl: "30m" }`
  unless `OPENAI_PROMPT_CACHE_TTL=off`; it never sends the deprecated
  `prompt_cache_retention` field to GPT-5.6. Explicit pre-5.6 deployments retain the legacy
  `OPENAI_PROMPT_CACHE_RETENTION` behavior ([src/lib/openai.ts](../src/lib/openai.ts)). The 30-minute
  value is a minimum cache lifetime, not a guaranteed deletion deadline. See PIA-6.
- **Safety identifier:** when `OPENAI_SAFETY_IDENTIFIER_SECRET` is configured, authenticated
  Responses requests carry a stable HMAC-SHA256 pseudonym. Anonymous and background requests omit
  it, and raw owner identifiers are never sent. Production readiness warns when the secret is absent.
- **No `baseURL` override and no zero-data-retention (ZDR) header** are set in code â€” the client is a
  plain `new OpenAI({ apiKey, timeout, maxRetries })` ([src/lib/openai.ts](../src/lib/openai.ts)),
  so traffic goes to `api.openai.com` (US) under whatever data-processing terms attach to the API
  **account/organisation**.

### 4.3 Data-processing terms â€” what code can and cannot tell us

The code shows the _technical_ posture (US endpoint, `store:false`, model-aware prompt-cache
configuration, optional HMAC safety identifier, no ZDR header).
It **cannot** tell us the contractual posture. The following are **operator/legal actions**, not code
facts, and must be confirmed:

- The production OpenAI project's **Data Processing Addendum (DPA)** and **Zero Data Retention (ZDR)**
  posture are external account/legal facts rather than code facts. Ledger `#053` records them as
  verified on 2026-08-18. An authenticated Platform owner review on 2026-09-01 found API data
  sharing disabled and changed API call logging and optional hosted-tool classes to `Disabled`, but found no visible ZDR entitlement or configured
  retention type. OpenAI acknowledged receipt of the ZDR sales request on 2026-09-01, but receipt is
  not approval. The privacy-readiness register therefore keeps ZDR and the DPA pending.
- The accountable owners must attach sanitized external evidence and periodically revalidate account
  controls before the register evidence expires.
- OpenAI's no-training and retention commitments must remain pinned to the specific account/contract,
  not inferred from client code.

Under **APP 8 (cross-border disclosure)**, the app operator remains accountable for OpenAI's handling
of the disclosed information unless an APP 8.2 exception applies. The corresponding processor/legal
assessment for Railway Singapore must also be recorded. Closing these overseas-processing terms is one
of the most important privacy items before real patient use (PIA-1).

---

## 5. Logging and redaction â€” per-table verification

All three log tables are **owner-stamped** and **RLS-enabled** (owner-read for authenticated users;
service-role for writes). Redaction is applied centrally at every write site.

| Table                | Raw query stored?     | Redaction mechanism                                                                                                                                                                                                                                 | Other sensitive columns                                                                                                 | RLS                                                     |
| -------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `rag_queries`        | No (hash placeholder) | `queryTextForStorage` / `normalizedQueryTextForStorage` ([query-privacy.ts](../src/lib/query-privacy.ts)); centralized write in `insertRagQuery`                                                                                                    | `answer` is null by default and stored only with explicit `RAG_PERSIST_ANSWER_TEXT=true`; `source_chunk_ids` (own data) | owner-read, [schema.sql](../supabase/schema.sql)        |
| `rag_query_misses`   | No (hash placeholder) | same helpers; writes in [search/route.ts](../src/app/api/search/route.ts), [interaction/route.ts](../src/app/api/search/interaction/route.ts)                                                                                                       | `metadata.query_hash`                                                                                                   | owner-read, [schema.sql](../supabase/schema.sql)        |
| `rag_retrieval_logs` | No (hash placeholder) | same helpers; write at [search/route.ts](../src/app/api/search/route.ts)                                                                                                                                                                            | retrieval telemetry only                                                                                                | owner-read, [schema.sql](../supabase/schema.sql)        |
| `audit_logs`         | N/A (no query text)   | action/resource metadata only; the write boundary allowlists operational metadata and excludes user-controlled filenames/titles/content hashes ([audit.ts](../src/lib/audit.ts)). Migration `20260717163000` minimizes existing rows on deployment. | `owner_id`, `action`, `resource_id`                                                                                     | service-role-only, [schema.sql](../supabase/schema.sql) |

### 5.1 M15 HMAC query-hash fix â€” verified present, enforced in production

The audit's **M15** remediation is in the code
([src/lib/query-privacy.ts](../src/lib/query-privacy.ts)):

```ts
export function hashQueryText(query: string) {
  const normalized = normalizeQueryText(query);
  if (env.RAG_QUERY_HASH_SECRET) {
    return createHmac("sha256", env.RAG_QUERY_HASH_SECRET).update(normalized).digest("hex"); // keyed pseudonym
  }
  return createHash("sha256").update(normalized).digest("hex"); // legacy unsalted fallback
}
```

- **When `RAG_QUERY_HASH_SECRET` is set:** the stored hash is a keyed HMAC-SHA256 â€” not
  offline-reversible, not correlatable outside this deployment. âœ” This is the intended fix.
- **When it is unset:** the code **silently falls back to unsalted SHA-256**. A short, low-entropy
  clinical query ("john smith clozapine") is then **dictionary-reversible** â€” an attacker (or a
  curious insider) with read access to the log tables can hash candidate patient/drug strings offline
  and match rows, and can correlate the same query across rows. This defeats the redaction it is
  meant to provide.

**Status (PIA-2 â€” mitigated):** production now **fails closed** when the secret is absent.
`requireQueryHashSecret()` ([src/lib/env.ts](../src/lib/env.ts)) throws at server startup
([src/instrumentation.ts](../src/instrumentation.ts)) when `NODE_ENV=production` and
`RAG_QUERY_HASH_SECRET` is unset, so a misconfigured clinical server refuses to boot rather than
degrade to the unsalted digest. `npm run check:production-readiness` additionally asserts the boot
guard is wired into the startup path and that the secret is present, and
[tests/instrumentation.test.ts](../tests/instrumentation.test.ts) /
[tests/env-query-hash-secret.test.ts](../tests/env-query-hash-secret.test.ts) cover the fail-closed
behaviour. The schema stays `z.string().min(16).optional()` so dev/CI keep the legacy digest for
stored-row joins. Names-only presence in Railway and the GitHub repository was verified on
2026-07-27. Those read-only surfaces do not reveal values, so equality was not compared. Do not
rotate the secret merely to compare it because rotation breaks query-pseudonym continuity; instead,
revalidate presence and rotation ownership during the next approved credential review.

### 5.2 Redaction helper coverage

`redactLogValue` / `safeErrorLogDetails` ([src/lib/privacy.ts](../src/lib/privacy.ts)) strip paths,
URLs, secrets (incl. `sb_secret_` / `sb_publishable_`), and emails from error details before they are
logged, and `redactCaptionIdentifiers` strips emails/MRN/NHS-style ids/phone numbers from image
captions ([privacy.ts](../src/lib/privacy.ts)). These are sound as far as they go, but they are
**pattern-based** and do not attempt to redact free-text clinical narrative (names in prose, etc.) â€”
which is why the query-hash approach (not raw storage) is the right primary control.

---

## 6. Retention and purge

| Data                                      | Retention                              | Mechanism                                                                                                                                                                                                                                                                                          | Live status                                                                                                                                                                                                          |
| ----------------------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rag_queries`                             | 30 days                                | `purge_expired_rag_queries(30)`, `pg_cron` `purge-expired-rag-queries` @ 03:30 UTC                                                                                                                                                                                                                 | Verified configured 2026-09-13: unique active job; schedule/command match                                                                                                                                            |
| `rag_retrieval_logs`                      | 90 days                                | `pg_cron` `purge-rag-retrieval-logs` @ 03:00 UTC                                                                                                                                                                                                                                                   | Verified configured 2026-09-13: unique active job; schedule/command match                                                                                                                                            |
| `rag_query_misses`                        | 90 days                                | `purge_expired_rag_query_misses(90)`, `pg_cron` `purge-rag-query-misses` @ 03:45 UTC                                                                                                                                                                                                               | Verified configured 2026-09-13: unique active job; schedule/command match                                                                                                                                            |
| `rag_response_cache`                      | ~5 min read TTL                        | `expires_at` filtered on read; `purge_expired_rag_response_cache(1000)`, hourly `pg_cron` `purge-rag-response-cache`                                                                                                                                                                               | Verified configured 2026-09-13: unique active job; schedule/command match; obsolete job absent                                                                                                                       |
| `audit_logs`                              | Indefinite (by design)                 | Documented in [migration 20260702120000](../supabase/migrations/20260702120000_rag_retrieval_logs_retention.sql)                                                                                                                                                                                   | Intentional; "do not add purge without compliance review"                                                                                                                                                            |
| Browser answer thread                     | 12 h (or tab close)                    | `window.sessionStorage` TTL + `New chat`, sign-out, and account-change clears ([answer-thread-storage.ts](../src/lib/answer-thread-storage.ts))                                                                                                                                                    | Client-side only; no server job to verify                                                                                                                                                                            |
| Browser recent queries                    | Tab close                              | `window.sessionStorage`; cleared by Settings > Privacy and security ([recent-query-storage.ts](../src/lib/recent-query-storage.ts))                                                                                                                                                                | Client-side only; no server job to verify                                                                                                                                                                            |
| Browser patient labels (bed, initials)    | End of shift (rostered end, else 12 h) | One prefixed store with an expiry stamp; wiped at shift end and on sign-out and account change ([patient-label-storage.ts](../src/lib/patient-label-storage.ts))                                                                                                                                   | Client-side only; [tests/patient-label-storage.dom.test.tsx](../tests/patient-label-storage.dom.test.tsx)                                                                                                            |
| `cme_*` tables and `cme-private-evidence` | Until the owner deletes them           | No purge job. An evidence "removal" deletes the stored file (or queues deletion in `storage_cleanup_jobs` when storage doesn't answer) and keeps a metadata row renamed "Removed file" with its sha256 and a 3–500 character reason. Every table references `auth.users` with `on delete cascade`. | Intentional: CPD records must be kept for the owner's audit window (3 or 5 years, unresolved, see CME design doc §14). Whether deleting an account also removes evidence _files_ from storage was not verified here. |

**Historical verification (live `cron.job` query, 2026-07-06) - job ids below are superseded:**

```
jobid 11  purge-expired-rag-queries    30 3 * * *  active=true  select public.purge_expired_rag_queries(30);
jobid 12  purge-rag-retrieval-logs      0 3 * * *  active=true  delete from public.rag_retrieval_logs where created_at < now() - interval '90 days';
```

So the answer to "_is anything scheduled?_" is **yes** for the two jobs verified on 2026-07-06. Since
that verification, migration `20260708120000_rag_query_misses_retention.sql` added a 90-day query-miss
purge, and migration `20260713201542_consolidate_rag_response_cache_retention.sql` consolidated two
cache purge jobs onto the existing bounded hourly purge. The remaining retention work is:

- **PIA-4 verification:** production was verified on 2026-07-14: migration `20260708120000` runs
  `purge-rag-query-misses`, and migration `20260713201542` runs the bounded
  `purge-rag-response-cache`. The obsolete `purge-expired-rag-response-cache` job is absent. The job ids
  recorded by that check (13 and 16) were re-issued on 2026-09-01 - see the schedule re-creation note
  below.
  Repeat this check for any secondary environment that retains real data.
- The purge functions are installed conditionally (`if to_regnamespace('cron') is null then return`,
  [migration 20260629060603](../supabase/migrations/20260629060603_rag_queries_retention.sql)) â€”
  fine on live (pg_cron present) but **preview/branch databases silently skip scheduling**. Not a
  production risk, but worth noting for any secondary environment that retains real data.

**Schedule re-creation, 2026-09-01 (supersedes the job ids above).** Migration
`20260901033250_enable_staging_privacy_retention_schedules.sql` ships in `supabase/migrations`, so
merging it to `main` applied it to the live `PsychSift Production` project as well as to staging: its
name says "staging" but its effect is environment-neutral. It unschedules the five named purge jobs and
re-schedules four of them, so `purge-expired-rag-queries`, `purge-rag-retrieval-logs`,
`purge-rag-query-misses` and `purge-rag-response-cache` now hold **new `cron.job` ids on production**.
Job ids 11, 12, 13 and 16 are therefore stale evidence and must not be re-quoted; the durable evidence
is the **job name plus schedule**. The post-merge `live-drift` workflow is **not** the gate here: its
drift inventory compares extensions, tables, views, functions, indexes, policies, constraints, triggers
and storage buckets only ([scripts/check-drift.ts](../scripts/check-drift.ts)), and `cron.job` rows are
not among those categories - so a failed or skipped apply of `20260901033250` would leave `live-drift`
green while the purge jobs sat in whatever prior state they had. That blind spot is recorded as finding
**M23** in [docs/audit/full-repository-audit-2026-09-02.md](audit/full-repository-audit-2026-09-02.md).
**Production configuration recheck, 2026-09-13.** An operator-authorised read-only `cron.job`
comparison on PsychSift Production confirmed exactly one active instance of all four jobs, with
schedules and commands matching `20260901033250_enable_staging_privacy_retention_schedules.sql`.
The obsolete `purge-expired-rag-response-cache` job was absent. Only job names, schedules and
boolean comparisons were returned; no user records or raw commands were exported. This closes the
missing post-merge configuration read. It does not prove successful purge executions or row deletion,
recheck staging, or renew the existing role approval. See the
[role-attestation pack section 2](governance/privacy-role-attestation-pack-2026-09-01.md#2-retention-schedules).
Future evidence should continue to identify jobs by name and state which environment was checked.

**Browser-side retention (not a server control).** A completed answer keeps the raw query text, the
generated answer, and the source excerpts for up to 12 turns (up to 4.5 MB) in `window.sessionStorage` under
the owner-scoped key `clinical-kb-answer-thread:<ownerId>`, with a 12-hour TTL
([`answerThreadTtlMs`](../src/lib/answer-thread-storage.ts)); signed-out visitors share the
`guest-tab-session` owner key. The last five raw queries per owner are stored under
`clinical-kb-recent-queries:<ownerId>` ([recent-query-storage.ts](../src/lib/recent-query-storage.ts)).
Session storage dies with the tab, and the thread is additionally cleared by `New chat`, sign-out, and an
account change; recent queries are cleared from Settings > Privacy and security. The residual control
question is a **shared clinical workstation** where a tab is left open: incidental PHI in a typed query
remains restorable there until the TTL expires or the tab closes. Behaviour is pinned by
[tests/answer-thread-storage.test.ts](../tests/answer-thread-storage.test.ts),
[tests/use-answer-thread-bootstrap.test.ts](../tests/use-answer-thread-bootstrap.test.ts), and
[tests/recent-query-storage.test.ts](../tests/recent-query-storage.test.ts). Any move of this content to
`localStorage`, or any widening beyond the owner-scoped keys, is a deviation from this assessment and
needs governance review.

---

## 7. Data residency

- **Supabase project region: `ap-southeast-2` (AWS Asia Pacific, Sydney).** Confirmed via the Supabase
  management API for project `sjrfecxgysukkwxsowpy`. All Postgres data (documents, chunks, embeddings,
  logs, auth) and both storage buckets are **onshore in Australia**. This is a strong position for WA
  clinical use and directly supports APP 11 expectations for health information.
- **Railway application and worker: Singapore.** Browser questions, retrieved evidence, generated
  answers, and ingestion material are processed by the Railway services before reads/writes reach
  Supabase Sydney. The operator must record the applicable processor, contract, and APP 8 assessment;
  this technical PIA does not decide the legal classification.
- **OpenAI: United States.** Query text + retrieved excerpts are disclosed to `api.openai.com` (no
  regional endpoint or ZDR configured in code). This is the second overseas processing path and remains
  a central part of the APP 8 assessment (PIA-1).

**Net:** durable Supabase data is Australian; application/worker processing occurs in Singapore; and
OpenAI retrieval embedding plus model-backed inference occur in the US. Embedding egress can happen
even when the final answer is source-only. The approved privacy notice and contractual record must
cover both overseas paths and their purposes.

---

## 8. Storage-bucket access paths

- Buckets `clinical-documents` and `clinical-images` are **private**
  ([docs/multi-user-auth-setup.md](multi-user-auth-setup.md) Â§7).
- No direct client storage access. Files are served only via **server-minted signed URLs** with a
  **10-minute TTL** (`signedUrlTtlSeconds = 60 * 10`,
  [documents/[id]/signed-url/route.ts](../src/app/api/documents/[id]/signed-url/route.ts),
  [images/[id]/signed-url/route.ts](../src/app/api/images/[id]/signed-url/route.ts)).
- Every signed-URL mint is **preceded by an ownership check** on the parent document row
  (`withOwnerReadScope(...)` before `createSignedUrl`,
  [documents/[id]/signed-url/route.ts](../src/app/api/documents/[id]/signed-url/route.ts)) â€” see the
  companion tenancy review for the adversarial verification.
- Storage objects are namespaced by owner (`${uploadOwnerId}/documents/${documentId}/...`,
  [upload/route.ts](../src/app/api/upload/route.ts)), and the DB additionally carries owner-scoped
  storage RLS policies ([schema.sql](../supabase/schema.sql)) as a backstop for any future
  client-direct access.

Signed-URL handling is well-scoped. The residual consideration is only that a 10-minute URL, once
minted, is bearer-usable by anyone it is shared with in that window â€” acceptable for this use case.

---

## 9. Assessment against Australian Privacy Act / WA health obligations

**Framework.** Private-sector health service providers are **APP entities regardless of turnover** â€”
the small-business exemption does **not** apply where health services are provided and health
information is handled (_Privacy Act 1988_ (Cth), s6D(4)(b)). Health/mental-health information is
**"sensitive information"** attracting the highest APP protections. WA has no equivalent of Victoria's
_Health Records Act 2001_ or NSW's _HRIP Act 2002_ for the private sector; the _Privacy Act_ + APPs are
the operative framework for a WA private clinician. (The WA _Privacy and Responsible Information Sharing
Act 2024_ targets WA **public-sector** entities and may apply to public-health deployments â€” confirm
with counsel if this is deployed inside a WA Health service.)

| APP                                         | Obligation                                                                         | Status in this app                                                                                                                                                                                                                                                                                                                  | Gap              |
| ------------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| **APP 1** â€” open & transparent management | Have a clear, up-to-date APP privacy policy                                        | A draft `/privacy` data-processing page ships, but it is explicitly governance-review-required and is not represented as the final approved APP privacy policy                                                                                                                                                                      | PIA-5            |
| **APP 3** â€” collection of sensitive info  | Collect health info only with consent + where reasonably necessary                 | App does not solicit PHI; incidental entry remains possible. â€œDo not enter patient-identifiable informationâ€ notices now appear beside query/upload controls, but no governance-approved consent framework is claimed                                                                                                            | PIA-5            |
| **APP 5** â€” notification of collection    | Tell individuals what's collected & disclosed (incl. overseas)                     | Draft point-of-entry notices and the `/privacy` page disclose Singapore application processing and model-provider use; final wording and legal/governance approval remain outstanding                                                                                                                                               | PIA-1, PIA-5     |
| **APP 6** â€” use/disclosure                | Use only for the primary purpose or a permitted secondary purpose                  | Query used for answer generation (primary). Log retention = quality/eval (secondary) â€” defensible but should be documented. On Call compliance records are disclosed to nobody but their owner, which is the primary purpose they were entered for; whether the clearance fields are sensitive information is unresolved (PIA-9). | PIA-5, PIA-9     |
| **APP 8** â€” cross-border disclosure       | Discloser stays accountable for the overseas recipient unless an exception applies | Current Platform evidence confirms OpenAI API sharing, API call logging, and optional hosted tools are disabled but does not substantiate ZDR; the executed DPA reference is also missing. Railway's Singapore processor contract remains unresolved, so the privacy adviser cannot close the whole-of-flow APP 8 basis.            | **PIA-1**        |
| **APP 11** â€” security & destruction       | Reasonable security; destroy/de-identify when no longer needed                     | Strong: Sydney data residency, RLS, private storage, query hashing, default-null answer logs, owner-attested production HMAC evidence, and owner-attested production/staging query/log/cache purge schedules.                                                                                                                       | PIA-2/4          |
| **NDB scheme** (Pt IIIC)                    | Notify OAIC + individuals of eligible breaches of health info                      | No documented breach-response runbook tied to these tables                                                                                                                                                                                                                                                                          | Recommend adding |

**Overall:** the _engineering_ controls for data-at-rest are strong and largely APP-11-aligned. The
material shortfalls are **governance/contractual** (Railway's APP 8 cross-border terms and final approval
of the draft APP 1/5 policy/notice wording). Production HMAC evidence and production/staging
retention-schedule parity were owner-attested on 2026-09-01. OpenAI data sharing, API call logging,
and optional hosted tools are disabled, but DPA/ZDR remain pending current secure evidence.
Answer prose is omitted by
default; enabling its persistence is an exceptional, non-production mode requiring governance approval.
Anonymous answer caching is disabled. The tenancy review found **zero** confirmed cross-tenant leaks; the
remaining items are compliance-posture and PHI-minimisation gaps.

---

## 10. Gap register (ranked by risk)

### PIA-1 â€” Overseas Railway/OpenAI processing needs an approved contractual basis and notice **(High)**

- **Risk:** Health/PHI in requests, queries, excerpts, and ingestion material is processed by Railway
  in Singapore. Query text can reach OpenAI in the US for retrieval embedding even when the final
  answer is source-only; model-backed synthesis additionally sends the query and selected excerpts.
  OpenAI's contract remains deliberately non-code-visible. Repository ledger `#053` says its DPA and
  production-project ZDR were verified on 2026-08-18, but a 2026-09-01 authenticated Platform review
  found no visible ZDR entitlement or configured retention type. A draft in-product provider
  disclosure now exists, reducing the
  point-of-entry visibility gap, but it is not governance-approved legal wording â†’ APP 8 accountability
  exposure and a residual APP 5 governance gap.
- **Evidence:** the live app and worker are recorded in Railway Singapore
  ([deployment-architecture.md](deployment-architecture.md)); the OpenAI client uses
  `api.openai.com` ([openai.ts](../src/lib/openai.ts)); raw query + excerpts are sent by the RAG pipeline.
- **Fix (ranked):** (1) Attach sanitized secure references for the OpenAI production project's ZDR
  settings/coverage and countersigned DPA. (2) Obtain a countersigned Railway DPA or enterprise schedule that expressly covers
  the actual incidental sensitive-health-data flow, then record the complete APP 8 determination. The
  standard Railway DPA's current Exhibit A lists sensitive/special-category data as `None`. (3) Obtain
  governance/legal approval for the shipped draft APP-5 collection/provider
  disclosure and final privacy policy. (4) Retain the shipped on-query/upload PHI reminder.
  (5) Optionally, add a lightweight PHI-scrub / entity-strip on the outbound query as defence-in-depth.
- **Progress (2026-07-13):** fixes (3)+(4) are **live on `main`** via PR #513
  ([src/app/privacy/page.tsx](../src/app/privacy/page.tsx), composer notice), as draft wording pending
  governance approval. The remaining Railway contractual basis is captured decision-ready
  in **[docs/openai-cross-border-basis.md](openai-cross-border-basis.md)**, which also records that
  the app's egress endpoints (`/v1/responses`, `/v1/embeddings`) are **ZDR-eligible** and that OpenAI now
  offers **Australia data residency** (storage) â€” an option that postdates this PIA. The OpenAI
  DPA/ZDR steps are repository claims pending secure external references; Railway execution and
  whole-of-flow privacy-adviser sign-off also remain operator/legal, not code.

### PIA-2 â€” Query-hash HMAC silently downgrades without the secret **(Mitigated)**

- **Risk:** If `RAG_QUERY_HASH_SECRET` is unset in prod, stored query hashes are unsalted SHA-256 â†’
  dictionary-reversible and cross-row correlatable, defeating the redaction (undoes M15).
- **Evidence:** [query-privacy.ts](../src/lib/query-privacy.ts); the secret is
  `z.string().min(16).optional()` in [env.ts](../src/lib/env.ts).
- **Fix (landed):** `requireQueryHashSecret()` now makes the secret **mandatory in production** â€” it
  fails closed at startup ([instrumentation.ts](../src/instrumentation.ts)) when `NODE_ENV=production` and
  the secret is missing, mirroring the `requireServerEnv` pattern. `check:production-readiness` asserts
  the boot guard is wired in and the secret is present; covered by
  [instrumentation.test.ts](../tests/instrumentation.test.ts) and
  [env-query-hash-secret.test.ts](../tests/env-query-hash-secret.test.ts).
- **Operational evidence:** names-only presence passed for Railway and GitHub on 2026-07-27. The
  secret values were neither emitted nor compared. Revalidate presence, ownership, and the rotation
  procedure during the next credential review; do not rotate solely to establish equality.

### PIA-3 â€” Generated answers stored un-redacted in `rag_queries` **(Mitigated)**

- **Risk:** The `answer` column held the full generated text, which can restate patient specifics
  echoed from the query; the query itself is hashed but the answer was not. Owner-scoped (not
  cross-tenant) and purged at 30 days, but it was un-redacted PHI-derived content at rest.
- **Fix (shipped):** Answer-text persistence in the durable log is gated behind a dedicated
  `RAG_PERSIST_ANSWER_TEXT` flag (default **off**), applied centrally in `insertRagQuery` via
  `answerTextForStorage` ([query-privacy.ts](../src/lib/query-privacy.ts), [rag.ts](../src/lib/rag/rag.ts)) so
  every `logRagQuery` caller is covered, and at the promoted-eval-case write in
  [eval-cases/route.ts](../src/app/api/eval-cases/route.ts). With the flag off the column is written as
  `null` and each row records `metadata.answer_retained = false`. The offline eval/quality pipeline
  reads the in-memory answer (`logQuery: false`) and never reads this column back
  ([scripts/eval-rag.ts](../scripts/eval-rag.ts), [scripts/eval-answer-quality.ts](../scripts/eval-answer-quality.ts),
  [scripts/promote-query-misses.ts](../scripts/promote-query-misses.ts)), so persistence-off does not
  affect eval â€” confirming the pipeline has no real dependency on stored answer text. The flag is
  additionally blocked in a production-like environment by `npm run check:production-readiness`.
- **Residual cache copy:** The answer also lands in `rag_response_cache.payload`
  ([rag-cache.ts](../src/lib/rag/rag-cache.ts)). Its `expires_at` TTL (`RAG_ANSWER_CACHE_TTL_MS`, default
  5 min) only gates **reads** â€” `sharedCacheSelector` filters on `expires_at`, while
  `replaceSharedCacheRow` deletes only the _same_ cache key before inserting. Migration
  `20260713201542_consolidate_rag_response_cache_retention.sql` unschedules the duplicate unbounded
  job and keeps one hourly purge capped at 1,000 expired rows per invocation. This keeps
  delete transactions bounded while providing hard cleanup when `pg_cron` is available. Production
  was verified live on 2026-07-14: bounded job 16 is active and the obsolete unbounded job is absent.
- **Historical cleanup:** a migration to null existing `rag_queries.answer` values is prepared but
  intentionally unexecuted pending deployment approval; this assessment does not claim live cleanup.

### PIA-4 â€” Query-miss and response-cache purges active **(Mitigated)**

- **Risk:** A secondary environment without the retention migrations or `pg_cron` can still accumulate
  hash-redacted misses and expired response-cache payloads.
- **Evidence:** the original 2026-07-06 live check showed only jobids 11/12. The repository now includes
  [migration 20260708120000](../supabase/migrations/20260708120000_rag_query_misses_retention.sql), which
  installs a 90-day purge, and
  [migration 20260713201542](../supabase/migrations/20260713201542_consolidate_rag_response_cache_retention.sql),
  which installs one bounded hourly response-cache purge when `pg_cron` is available. Production was
  queried live on 2026-07-14: jobids 13 and 16 are active and the obsolete duplicate is absent.
- **Fix:** Repeat the canonical job check for each secondary environment that retains real data.

### PIA-5 â€” Draft notices/page ship; final approved privacy policy remains outstanding **(Medium)**

- **Risk:** The shipped draft point-of-entry notices and `/privacy` page explain collection, retention,
  and overseas/provider processing, but they are explicitly pending governance review and do not by
  themselves establish an approved APP privacy policy.
- **Fix:** Have governance/legal owners review, amend and approve the draft wording; publish the final
  APP privacy policy and retain the point-of-entry links/notices. Broader retention and breach-response
  documentation also remains outstanding. No legal approval is claimed here.

### PIA-6 â€” OpenAI prompt-cache lifetime requires contractual confirmation **(Low-Medium)**

- **Risk:** Query + retrieved excerpts can enter OpenAI prompt caches even with `store:false`.
  OpenAI documents prompt-cache application state on local GPU machines with a maximum 24-hour
  expiration. GPT-5.6 requests a 30-minute TTL by default, but that value controls the minimum cache
  lifetime rather than the maximum or a contractual deletion deadline. Explicit pre-5.6 models can
  still request the legacy 24-hour retention mode.
- **Evidence:** [openai.ts](../src/lib/openai.ts), [.env.example](../.env.example).
- **Fix:** Confirm the effective cache/deletion behavior under the production project's **ZDR** and
  data-residency terms. Keep `OPENAI_PROMPT_CACHE_TTL=off` available when governance requires the app
  to omit the extended GPT-5.6 TTL option; document that provider-default caching policy still applies.

### PIA-7 â€” `RAG_PERSIST_RAW_QUERY_TEXT=true` stores raw PHI query text **(Low, config-gated)**

- **Risk:** Flipping the flag persists raw queries with only the 30-day purge as a safeguard.
- **Evidence:** [query-privacy.ts](../src/lib/query-privacy.ts), [env.ts](../src/lib/env.ts).
- **Fix:** Keep it **off** in production; if ever enabled, require a documented retention/consent basis
  and consider a shorter purge window for raw-text rows.

### PIA-8 â€” Browser-side answer thread retains raw query text for 12 h on a shared workstation **(Low-Medium)**

- **Risk:** A completed answer keeps the raw query text, the generated answer, and the source excerpts
  for up to 12 turns in `window.sessionStorage` under `clinical-kb-answer-thread:<ownerId>` with a
  12-hour TTL, and the last five raw queries under `clinical-kb-recent-queries:<ownerId>`. On a shared
  clinical workstation where a tab is left open, incidental PHI in a typed query stays restorable until
  the TTL expires or the tab closes. Signed-out visitors share the `guest-tab-session` owner key, so an
  anonymous thread survives page loads within that tab rather than being tied to an account. This is the
  browser-side counterpart to the server-side redaction recorded in §1.
- **Evidence:** [answer-thread-storage.ts](../src/lib/answer-thread-storage.ts),
  [recent-query-storage.ts](../src/lib/recent-query-storage.ts); §2 browser row and the browser-side
  retention note in §6. Behaviour is pinned by
  [tests/answer-thread-storage.test.ts](../tests/answer-thread-storage.test.ts),
  [tests/use-answer-thread-bootstrap.test.ts](../tests/use-answer-thread-bootstrap.test.ts), and
  [tests/recent-query-storage.test.ts](../tests/recent-query-storage.test.ts).
- **Fix:** Keep the content in tab-scoped `sessionStorage` (any move to `localStorage`, or any widening
  beyond the owner-scoped keys, is a deviation from this assessment and needs governance review). For
  shared-workstation deployments, require the organisation's session-lock/logout practice, and consider
  a shorter TTL or an explicit end-of-session clear as a governance decision rather than a code default.

### PIA-9 - On Call compliance records are one clinician's regulatory data on a world-readable surface **(Mitigated)**

- **Risk:** The On Call mode's read is deliberately anonymous. `GET /api/on-call/entries`
  ([route.ts](../src/app/api/on-call/entries/route.ts)) answers any caller, signed in or not, with
  every row not flagged `is_personal`; there is no login wall, so "shared" here means readable by
  anyone who reaches the site. That was an owner decision of 2026-09-04, and it was taken about ward
  phone numbers, switchboard extensions and escalation ladders, which is what a covering doctor needs
  at 3am without an account. The Compliance page stores something else on the same table: one named
  clinician's medical registration, indemnity, credentialing, mandatory training, CPD, Working with
  Children Check and national police clearance, each with a recorded expiry date, the issuing body,
  and often a link to where the certificate is kept. As first written the page simply inherited the
  surface's default, so a requirement was published unless its author ticked a box then labelled
  "Personal number", which defaults off and does not read as a question about a police clearance.
  Taken together those fields are an identity record about an identified individual, and disclosing
  them to anonymous callers serves no purpose the 2026-09-04 decision contemplated.
- **History, recorded because a register that shows none teaches nobody:** the defect was present in
  commit `83db94eb` on the feature branch `claude/on-call-review-redesign-1yyqh0`, was found by
  clinical-governance review before that branch was proposed for merge, and is closed in the same
  branch. It was never merged to `main`, and the Supabase and Railway deployments both follow `main`,
  so the defective path never ran in production and no live row was served by it. That is a statement
  about the branch history, not about the live database: a database read is provider-backed and
  outside this assessment's evidence boundary, so it was not performed.
- **Fixed behaviour, read from the working tree on 2026-09-20:**
  - **Written private by the server, not by the client.** `onCallEntryToRow`
    ([repository.ts](../src/lib/on-call/repository.ts)) sets `is_personal` true for any compliance
    row whatever the request body asked for, and both write handlers (`POST` and `PATCH`) funnel
    through it, so an authenticated caller posting straight to the API cannot publish one.
  - **Withheld fail-closed from the shared read.** `fetchSharedOnCallEntries` drops every row that
    `rowMayBeComplianceRequirement` accepts. That predicate reads the RAW database row rather than the
    parsed entry, treats a `logistics` row whose details cannot be read at all as a requirement, and
    matches any `kind` key rather than the exact string, so a malformed or misspelt row is withheld
    rather than published. Withholding a broken parking note costs nothing; publishing a broken
    registration record cannot be undone.
  - **The editor no longer offers the choice.** The privacy checkbox is replaced, on a compliance
    requirement, by a plain statement that the entry is private
    ([on-call-entry-editor.tsx](../src/components/on-call/on-call-entry-editor.tsx)); the
    general-purpose checkbox is relabelled "Private - only you" and now says what not ticking it
    means.
  - **Kept off the printable card.** `selectCardEntries`
    ([card-selection.ts](../src/lib/on-call/card-selection.ts)) excludes compliance rows by name, in
    addition to excluding personal ones, so the exclusion does not depend on the privacy decision
    above staying as it is.
  - **Never sent to a provider.** These rows live in `on_call_entries`, which is not part of the
    retrieval corpus and is read by no RAG, embedding or answer path; nothing in section 3's flow map
    touches them. The editor's evidence field is a URL and explicitly not an upload, because the
    upload path indexes a document and sends it to a provider.
  - Behaviour is pinned by [tests/on-call-repository.test.ts](../tests/on-call-repository.test.ts),
    which covers the write stamp, the fail-closed read filter, a misspelt discriminator, and
    unreadable details.
- **Residual, and what is left for the adviser:**
  - The anonymous shared read itself is unchanged and remains the owner's decision. This entry
    narrows what it carries; it does not revisit it.
  - **Browser-side.** The entry list the page renders is cached in `localStorage`
    ([entry-store.ts](../src/lib/on-call/entry-store.ts)), and the mode's Recent list keeps an entry
    id, its title and a timestamp in `localStorage` too
    ([recent-storage.ts](../src/lib/on-call/recent-storage.ts)). Both are cleared on sign-out and on
    account switch through `clearAccountScopedBrowserState`
    ([client.tsx](../src/lib/supabase/client.tsx)), but neither has a TTL, so on a shared device the
    cached requirement titles and dates persist until someone signs out. This is the same shape as
    PIA-8 on different keys, and it is the one residual exposure a reader of this page can create
    without leaving the device.
  - **Classification is unresolved.** Whether Working with Children Check and national
    police-clearance status are "sensitive information" within the meaning of the _Privacy Act 1988_
    (Cth) is a question for the privacy adviser and is not decided here. If they are, their collection
    engages APP 3 and any disclosure beyond the purpose they were entered for would be an APP 6
    question, which is why the APP 6 row in section 9 now points here. The engineering position is
    narrower and is all this assessment claims: the records are about an identified individual, they
    are disclosed to nobody but their owner, and the controls above are what hold that.
- **Evidence:** [repository.ts](../src/lib/on-call/repository.ts),
  [card-selection.ts](../src/lib/on-call/card-selection.ts),
  [compliance.ts](../src/lib/on-call/compliance.ts),
  [entry-store.ts](../src/lib/on-call/entry-store.ts),
  [recent-storage.ts](../src/lib/on-call/recent-storage.ts),
  [on-call-entry-editor.tsx](../src/components/on-call/on-call-entry-editor.tsx),
  [tests/on-call-repository.test.ts](../tests/on-call-repository.test.ts). Section 2 carries the data
  category; section 9 carries the APP 6 pointer.
- **Fix:** keep all four controls, and treat any one of them being removed as a change to this
  assessment rather than a refactor. In particular, do not narrow `rowMayBeComplianceRequirement` to
  an exact `kind` match, and do not make the card exclusion rely on the privacy flag: a control that
  works only as a side effect of an unrelated decision is not a control. Before this feature is
  deployed, obtain the adviser's classification of the clearance fields, and decide as a governance
  question whether the browser cache above needs a TTL or an explicit clear on a shared device.

### PIA-11 - CPD records are one clinician's professional record, including free text and uploaded files **(Medium)**

- **What it is.** Since 2026-09-20 the CPD mode stores a clinician's own continuing-education record. It is the
  clinician's personal information, not patient data. Two parts carry free text or files that a clinician could
  fill with patient details by mistake: the **reflection** on each activity (and the shorter free-text fields:
  draft notes, missed-session reasons, amendment and evidence-removal reasons), and **evidence uploads**
  (PDF, JPEG or PNG up to 10 MB).
- **Controls in place, read from code:**
  - **Owner-only.** RLS is on for every `cme_*` table, with grants to `service_role` only, and every query filters
    `owner_id` in application code. `CmeOwnerBoundary` binds server-rendered pages to the verified owner and fails
    closed. Cross-tenant probes cover evidence and writes (`tests/cross-tenant-cme-evidence-probe.test.ts`,
    `cross-tenant-write-probe`, `cross-tenant-records-probe`). The two-user staging proof is still open (#F9HZEG).
  - **Private files.** Bucket `cme-private-evidence` is private, with a storage policy that blocks anon and
    authenticated roles. Files are served only through a **60-second** server-minted signed URL after an owner
    check (`api/cme/entries/[id]/evidence/[evidenceId]/route.ts`). Uploads are byte-bounded, and images are
    re-checked with `sharp`.
  - **Patient-detail friction, not detection.** The reflection shows a fixed "keep this free of patient names,
    initials, dates of birth and record numbers" line. An upload requires the user to tick that they have removed
    patient details and previewed the file. The app does not detect identifiers, and says nothing that implies a
    record is clean.
  - **No provider, no indexing.** CPD data is not in the retrieval corpus. No CPD path calls OpenAI. Evidence files
    are not OCR'd or captioned. The mode's search box filters the owner's entries locally, with remote search
    disabled (`search-command-surface.ts`).
  - **Explicit capture only** (owner decision 2026-09-23). Opening a document never creates an activity, and there
    is no reading history. "Log as CPD" from an answer's sources carries the cited source, never the question.
- **Residual exposures:**
  1. **Patient details in free text or files.** This relies on the user. It sits inside the open decision on
     keeping patient details out (privacy re-review item 8): warnings only, an automatic identifier blocker, or
     de-identified material only.
  2. **Calendar feed.** The private calendar link (`calendar_feed_tokens`, bearer token in the URL) publishes CPD
     deadline dates and routine titles to whichever calendar service the clinician subscribes with. Reflections,
     hours and evidence are not in the feed. The link is revocable.
  3. **Browser.** The unsaved log form (title, reflection) sits in the tab's `sessionStorage` until it is saved or
     the tab closes. This is the same accepted shape as PIA-8's answer thread. Module order in `localStorage`
     holds no record content, but is not cleared on account switch (#VKE5R3).
  4. **Removal metadata.** A removed file's hash and free-text reason are kept by design, and the reason could
     itself carry detail.
  5. **Account deletion.** Table rows cascade from `auth.users`. Removal of storage objects on account deletion
     was not verified in this pass.
  6. **Overseas processing.** Railway (Singapore) serves CPD pages and API calls, so CPD content passes through it
     in transit, as for all app traffic (PIA-1). No CPD content goes to OpenAI.
- **Disclosure.** CPD records are disclosed to nobody but their owner. No health service, team, supervisor or
  other mode reads them. Integrations in the CPD elevation plan are one-way links into CPD. Teaching's
  "Log to CPD" writes through its own idempotent function. No CPD content may enter Teaching's service-visible
  audit log or Admin's "Copy for workforce".
- **Fix / keep:** keep every control above. Treat any change that lets another mode, a service role, or a
  provider read CPD content as a change to this assessment. Before CPD is offered to a health service's doctors,
  resolve item 8, confirm evidence-file removal on account deletion, and state CPD in the public privacy notice
  (item 7).

---

## 11. Recommendation

### Mode-aware Clinical Ask privacy boundary

Clinical Ask remains dormant by default and is gated by the `CLINICAL_ASK_ENABLED` server flag. Since PR #2360
removed the composer controls, the product has no user entry point into Clinical Ask: the shared composer never routes
typed input into it, and enabling the flag exposes only the server route until a governed composer action is
reinstated. While the flag is off, the Clinical Ask stream and speech transcription routes answer 404 before any
authentication, rate-limit, or provider work, and the browser policy denies the microphone. The current user
interface has no microphone or dictation control. Typed questions, non-identifying Case Context, clarification
answers, request-scoped external authority extracts, and cited answers remain ephemeral and tab-scoped.
Identifier-shape detection is a blocking warning aid, not de-identification and not a guarantee that clinical text
contains no personal information.

Raw Clinical Ask question, transcript, Case Context, audio, answer, and external extracts are excluded from URLs,
history, browser storage, logs, content-free telemetry, structured feedback, public errors, and default copy output.
Offline and mode-unavailable outcomes retain the question only in tab memory; no automatic ordinary-search fallback
may place it in recents or navigation state. Retry is manual, and returning to search clears the question before
focusing the ordinary composer.
External authority access remains server-only, allowlisted, redirect-checked, attributable, metered, and discarded
after the request; citations and retrieval dates remain visible. These application controls do not prove provider zero
retention, approved cross-border/region terms, hosted migration state, authority approval, clinical evaluation,
protected-staging canary acceptance, production readiness, or physical-device acceptance. Those remain separate
operator/governance evidence gates.

Before the app is used with real patients in a WA clinical setting, close the six release-blocking
requirements in [`privacy-readiness.v1.json`](governance/privacy-readiness.v1.json): OpenAI ZDR and
countersigned-DPA evidence, Railway sensitive-health-data terms, the whole-of-flow APP 8 decision,
APP 1/APP 5 notice approval, and clinical PHI-minimisation acceptance. The production HMAC and
retention-schedule owner attestations were completed on 2026-09-01. **PIA-2** is technically mitigated
by the fail-closed boot guard plus owner-attested names-only production secret presence, subject to
periodic operational revalidation. **PIA-3** is
mitigated (the durable `rag_queries.answer` log is no
longer persisted by default; gated behind `RAG_PERSIST_ANSWER_TEXT`); **PIA-4** is mitigated by the
committed query-miss and bounded response-cache purges, verified live on 2026-07-14. Complete the
**PIA-5** residual data-handling documentation. The data-at-rest security posture (Sydney residency,
RLS, private storage, query hashing, automated purge) is already strong and should be highlighted in
the privacy policy as evidence of "reasonable steps" under APP 11.

PIA-3 is mitigated by default-null answer logging. If exceptional non-production answer persistence is
ever enabled, it remains governance-gated. The historical cleanup migration is prepared but unexecuted;
this assessment does not claim live cleanup or legal approval.

See the companion **[tenancy defense-in-depth review](audit/tenancy-defense-in-depth-review.md)** for the
cross-tenant isolation analysis referenced above.
