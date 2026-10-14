# Privacy readiness role-attestation pack — 2026-09-01

This pack contains the evidence and decisions that remain role-bound after the automated and operator
work in [`privacy-closeout-2026-09-01.md`](privacy-closeout-2026-09-01.md). Sections 1 and 2 record
the PsychSift owner's explicit operational approval on 2026-09-01; sections 3–8 remain unapproved.
The named role-holder must review each remaining section, make the stated decision, and provide only a
sanitized reference to confidential material. Contracts, account screenshots, patient data, secret
values, and personal signatures must remain outside Git.

The [prepared completion drafts](privacy-completion-drafts-2026-09-13.md) contain proposed notice
wording, provider requests and one reusable decision record. They are unsigned drafts, not evidence
of agreement, provider approval or clinical acceptance.

## How to close an item

Provide the requirement ID, decision (`verified`, `accepted_decision`, or rejected), accountable role,
decision date, review-expiry date, and a sanitized external reference. The repository owner can then
update [`privacy-readiness.v1.json`](privacy-readiness.v1.json) and rerun
`npm run check:production-readiness`.

## 1. Production HMAC-secret evidence

**Requirement:** `PRIV-PROVIDER-PRODUCTION-HMAC-SECRET`

**Role:** Production platform owner
**Decision:** verified by the Production platform owner on 2026-09-01.

Evidence:

- `npm run check:env-parity -- --gh --railway` passed on 2026-09-01.
- `RAG_QUERY_HASH_SECRET` was present by name in the pinned GitHub repository and Railway production
  services.
- No value was emitted, compared, rotated, or persisted.
- Production code fails closed when the secret is absent.

Role-holder decision:

- [x] The PsychSift owner gave contextual explicit approval of the documented production HMAC
      control after the Production platform owner approval was requested.
- [x] The approval is recorded for `PRIV-PROVIDER-PRODUCTION-HMAC-SECRET` only.

The response did not provide a legal name, handwritten signature, or separate declaration about
secret rotation. This record does not claim those facts. The supporting names-only check identifies
the pinned targets and the code evidence establishes the fail-closed guard.

Sanitized external reference: `PsychSift owner approval in Codex task 01a04af2-74bf-7e40-aa14-4a9e78295b33 on 2026-09-01; task content retained outside Git`

Review expiry: `2026-10-01`

## 2. Retention schedules

**Requirement:** `PRIV-PROVIDER-RETENTION-SCHEDULE-PARITY`

**Role:** Database operations owner
**Decision:** verified by the Database operations owner on 2026-09-01.

Evidence:

- Target: the operator-pinned Clinical KB staging project in Sydney.
- Pre-state: historical retention migrations and purge functions existed; `pg_cron` did not.
- Applied migration: `20260901033250_enable_staging_privacy_retention_schedules`.
- Post-state: all four jobs are active with production-matching commands and schedules:
  - `purge-expired-rag-queries` — `30 3 * * *`
  - `purge-rag-retrieval-logs` — `0 3 * * *`
  - `purge-rag-query-misses` — `45 3 * * *`
  - `purge-rag-response-cache` — `15 * * * *`
- The obsolete unbounded cache job is absent.

Rollback: unschedule those four named jobs. Drop `pg_cron` only after confirming no unrelated jobs
exist, because dropping the extension permanently deletes every cron job.

Role-holder decision:

- [x] The PsychSift owner gave contextual explicit approval of the verified retention schedules after
      the Database operations owner approval was requested.
- [x] The approval is recorded for `PRIV-PROVIDER-RETENTION-SCHEDULE-PARITY` only.

The supporting technical record covers the target, migration, post-state, schedules, and rollback.
This record does not claim that the owner separately restated each technical detail.

Sanitized external reference: `Supabase migration 20260901033250, post-state review, and PsychSift owner approval in Codex task 01a04af2-74bf-7e40-aa14-4a9e78295b33 on 2026-09-01`

Review expiry: `2026-10-01`

### Production configuration recheck — 2026-09-13

An operator-authorised, read-only `cron.job` check on production Clinical KB Database found exactly
one active instance of each of the four jobs listed above. Each schedule and command matched
`20260901033250_enable_staging_privacy_retention_schedules.sql`; the obsolete
`purge-expired-rag-response-cache` job was absent. Command equality was evaluated inside the database;
only job names, schedules and boolean comparison results were returned. No retained user content,
credentials or raw job commands were exported.

This closes the missing post-merge production configuration read recorded on 2026-09-04. It does not
prove successful purge executions or row deletion, refresh staging evidence, renew the owner's
2026-09-01 approval or extend its expiry.

## 3. OpenAI ZDR account evidence

**Requirement:** `PRIV-PROVIDER-OPENAI-ZDR`

**Role:** OpenAI account owner
**Prepared recommendation:** keep pending until current account evidence is attached.

Repository ledger `#053` claims API zero data retention and disabled input/output sharing as of
2026-08-18. After account-owner authentication on 2026-09-01, a read-only OpenAI Platform review
established the following current facts:

- the account exposes one Personal organisation and its Default project;
- the signed-in user is the sole visible organisation member and has the `Owner` role;
- API feedback, evaluation/fine-tuning, and API input/output sharing are disabled;
- with the account owner's explicit approval, API call logging was changed from `Enabled per call` to
  `Disabled`;
- hosted MCP, web search, file search, image generation, code interpreter, and container networking
  were set to `Disabled`;
- these interim controls do not confer ZDR, and the Platform did not display a ZDR entitlement;
- the app defaults Responses requests to `store:false`;
- the app requests a 30-minute prompt-cache TTL for GPT-5.6 and retains a legacy 24-hour default for
  explicit pre-5.6 models; and
- no ZDR entitlement, configured ZDR retention type, or `/v1/embeddings` coverage was displayed.

On 2026-09-01, OpenAI acknowledged receipt of an `API for Enterprise` sales request for ZDR covering
Responses, Embeddings, prompt caching, the applicable DPA, and Australia data-residency options.
That acknowledgment proves submission only; it does not prove approval or configuration.

The Default project contains app-labelled API keys, but Railway OAuth withholds secret values. This
review did not compare or expose keys and therefore cannot prove that production uses this project.
The old repository claim is not sufficient and is not supported by the current visible settings.

The account owner must confirm:

- [ ] the organisation and project are the targets behind the production `OPENAI_API_KEY`;
- [ ] Zero Data Retention is currently approved/enabled;
- [ ] it covers `/v1/responses` and `/v1/embeddings` for the deployed models;
- [ ] the effective prompt-cache behavior under ZDR, including the app's requested cache TTL;
- [ ] API input/output data sharing remains disabled; and
- [ ] the evidence date and review expiry.

Sanitized provider reference: `________________`

The strongest acceptable evidence is the configured organisation and production-project retention
type returned by OpenAI's Admin API, or an OpenAI support/contract record that expressly confirms ZDR
for Responses, Embeddings, and the effective prompt-cache behavior. Do not create or expose an Admin
API key merely to place evidence in Git.

Do not store the project key, full screenshot, organisation identifiers, or provider correspondence in
Git.

## 4. OpenAI DPA

**Requirement:** `PRIV-LEGAL-OPENAI-DPA`

**Role:** Authorised legal signatory
**Prepared recommendation:** keep pending until applicable-contract and acceptance evidence is attached.

Repository ledger `#053` claims DPA `v.010126` was executed on 2026-08-18. No candidate OpenAI DPA
file was found by filename in the user's likely OneDrive, Documents, or Downloads locations.
That does not establish the absence of an agreement: the [OpenAI DPA](https://openai.com/policies/data-processing-addendum/)
effective 2026-01-01 forms part of the [Services Agreement](https://openai.com/policies/services-agreement/).
The applicable acceptance route may be electronic acceptance, an order form, or use under those terms.
A separately countersigned DPA is required only where the customer's actual arrangement requires one.
The authorised legal signatory must establish the applicable agreement from the contracting
system/account owner and provide:

- legal entity;
- agreement version and effective date;
- acceptance method and supporting record, including signatures where applicable;
- scope covering the production organisation/project; and
- confidential record-system reference.

Sanitized contract reference: `________________`

Public terms explain the available contractual route; they do not establish the customer's legal
entity, account scope or actual acceptance. This correction does not approve the pending attestation.

## 5. Railway DPA and sensitive-health-data schedule

**Requirement:** `PRIV-LEGAL-RAILWAY-DPA`

**Role:** Authorised legal signatory
**Prepared recommendation:** do not approve the standard public DPA by itself for real-patient use.

Current facts:

- The connected Railway account identity was confirmed.
- Railway's public DPA requires customer DocuSign submission and becomes binding upon Railway's
  execution.
- Its standard Exhibit A currently states `Sensitive Data or Special Categories of Data: None`.
- This application's documented flow permits incidental health information to transit the Singapore
  application and worker.

Required action:

- obtain a countersigned DPA or negotiated enterprise schedule that expressly covers the actual
  sensitive-health-data flow;
- confirm processing locations, retention/deletion, security, incident notice, audit support, and
  subprocessor-change handling; and
- retain the agreement outside Git.

Sanitized contract reference: `________________`

If Railway will not amend or confirm the sensitive-data scope, the safe decision is to prohibit real
patient information from the Railway-hosted workflow or move that processing to a provider/contract
that covers it.

## 6. APP 8 cross-border basis

**Requirement:** `PRIV-LEGAL-APP8-CROSS-BORDER-BASIS`

**Role:** Privacy adviser
**Prepared recommendation:** not approved for real-patient use yet.

The engineering assessment supports an APP 8.1 reasonable-steps approach: enforce minimisation and
retention controls, bind both overseas processors contractually, review subprocessors, and notify
users of overseas processing. OpenAI's external account/DPA references and Railway's sensitive-data
contract remain incomplete, so the whole-of-flow determination cannot yet be closed.

Privacy-adviser decision:

- [ ] I confirm that I am acting as Privacy adviser.
- [ ] I reviewed Railway Singapore and OpenAI overseas processing, subprocessors, retention, security,
      deletion, and incident terms.
- [ ] I record the applicable APP 8 basis and any conditions or residual risk.
- [ ] I confirm whether real-patient use is approved, restricted, or prohibited.

Decision/reference: `________________`

## 7. APP 1 / APP 5 notice

**Requirement:** `PRIV-LEGAL-APP1-APP5-NOTICE`

**Role:** Privacy adviser
**Prepared recommendation:** keep pending.

The product already discloses Sydney storage, Singapore application/worker processing, OpenAI API
processing outside Australia, retention, owner scoping, and the instruction not to enter identifiers.
However, the repository does not identify the accountable legal entity, privacy contact channel, or
organisation-specific complaint/access/correction process. Those cannot be invented from code.

The privacy adviser must supply or approve:

- accountable legal entity and jurisdiction;
- privacy contact and complaint/escalation channel;
- collection purpose and authority/consent basis;
- access, correction, deletion, and complaint process;
- overseas recipients/countries and provider-change maintenance process; and
- effective date, version, review date, and intended audience.

Approved wording/reference: `________________`

## 8. Clinical PHI minimisation and residual risk

**Requirement:** `PRIV-CLINICAL-PHI-MINIMISATION`

**Role:** Clinical safety owner
**Prepared recommendation:** keep partial until the intended deployment and residual risk are accepted.

Current controls:

- persistent do-not-enter-identifiers warnings at relevant entry points;
- no patient-identifier field in the Safety Plan Generator;
- some identifier-shaped Clinical Ask input is blocked as a warning aid;
- raw query text is omitted from logs by default and logs use a keyed pseudonym;
- generated answer text is omitted from durable query logs by default; and
- owner-scoped storage and bounded retention jobs.

Residual risk:

- free text is not guaranteed de-identified;
- the general provider path does not scrub all outbound PHI;
- over-aggressive automatic scrubbing could remove clinically meaningful context and change retrieval
  or answer safety; and
- user warnings alone do not prevent accidental identifiers.

The Clinical safety owner must choose one:

- [ ] Accept the warning/workflow control for a named, trained, non-identifying-use deployment, with
      monitoring and incident escalation.
- [ ] Require a fail-closed identifier detector before provider egress and define the false-positive,
      false-negative, clinical-preservation, and override evaluation it must pass.
- [ ] Prohibit provider-backed real-patient use and limit the deployment to synthetic or fully
      de-identified material.

Decision, intended deployment, residual-risk rationale, and review expiry: `________________`

## Consolidated release recommendation

Do not mark the deployment privacy-ready for real-patient use until sections 3–8 have role-holder
decisions and secure references. Sections 1–2 were completed from the owner's explicit decision; the
repository update transcribes that decision and does not manufacture an agent approval or personal
signature.
