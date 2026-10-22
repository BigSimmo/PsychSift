# Cross-border disclosure basis — OpenAI (PIA-1)

**Status:** OpenAI standard-agreement acceptance and Railway DPA execution recorded verified for the restricted first-release scope; ZDR, whole-of-flow APP 8 and notice/clinical decisions remain unresolved. **Narrative reconciled:** 2026-10-21 against the register; original provider observations retain their dates below.
**Owner of the open step:** OpenAI account owner + authorised legal signatory + privacy adviser
**Tracks:** the OpenAI contractual portion of **PIA-1** in [docs/privacy-impact-assessment.md](privacy-impact-assessment.md) §10; Railway's companion contract is tracked below.
**Companion:** the `/privacy` collection notice ([src/app/privacy/page.tsx](../src/app/privacy/page.tsx)) and composer reminder ([src/lib/ui-copy.ts](../src/lib/ui-copy.ts)) ship as draft APP 5 / APP 1 controls pending governance approval under **PIA-5**.

**Status authority:** [`docs/governance/privacy-readiness.v1.json`](governance/privacy-readiness.v1.json). The OpenAI and Railway agreement items were recorded `verified` on 2026-10-05, with review expiry 2026-12-01: [OpenAI standard-agreement evidence](governance/openai-standard-agreement-evidence-2026-10-05.md) and [Railway execution evidence](governance/railway-dpa-completion-evidence-2026-10-05.md). Their scope is public clinical references and wholly invented examples, excluding real-patient cases and voice. This does not establish ZDR, wider sensitive-data suitability, whole-flow legal approval, deployed restrictions or release acceptance. Earlier ledger claims and September observations below are historical; the register and its dated evidence govern current recorded status.

> **Not legal advice.** This records the current, verifiable facts about OpenAI's data-handling
> terms and maps them to APP 8 so a qualified privacy adviser can sign off the cross-border basis.
> The APP-8 reasoning below is an engineering interpretation and must be confirmed by counsel before
> real patient use.

---

## 1. Why this exists

This document covers the model-provider leg: query text + retrieved excerpts sent to OpenAI in the
United States for embedding and answer synthesis (PIA §3–4; verified still true in code —
[src/lib/openai.ts:75-79](../src/lib/openai.ts) builds a plain `new OpenAI({ apiKey, timeout, maxRetries })`
with no `baseURL`/ZDR header and `store:false` by default. GPT-5.6-and-later requests use
`prompt_cache_options.ttl="30m"`; gpt-5.5 requests force the legacy
`prompt_cache_retention="24h"` field ([openai.ts](../src/lib/openai.ts)). Railway application and
worker processing in Singapore is the separate overseas processor leg recorded in the PIA; the APP
8 record must cover both providers.

Two obligations attach to that flow:

- **APP 8 (cross-border disclosure).** Before disclosing personal information overseas the entity must
  take **reasonable steps** to ensure the recipient handles it consistently with the APPs. Under
  **s16C** of the _Privacy Act 1988_ (Cth) the discloser stays **accountable** for the overseas
  recipient's acts unless an APP 8.2 exception applies. Health/mental-health data is _sensitive
  information_ — the highest-protection category — so this is the launch-critical item.
- **APP 5 (notification).** Individuals must be told their information is disclosed overseas.
  Draft wording is **already shipped** in the `/privacy` page and composer notice; governance approval
  remains open under **PIA-5** (see §7).

The code-side controls cannot _by themselves_ discharge APP 8 — the "reasonable steps" are largely
**contractual**. The agreement evidence now covers the restricted first-release scope above;
the privacy adviser's whole-of-flow determination remains open. Agreement verification does not
authorise real-patient or voice processing.

## 2. What actually crosses the border

| Egress    | Payload                                                          | Endpoint                                                      | Reference                                                                                   |
| --------- | ---------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Embedding | Raw query text (normalized)                                      | `POST /v1/embeddings` (`text-embedding-3-small`)              | [openai.ts embedTextWithTelemetry](../src/lib/openai.ts)                                    |
| Answer    | Raw query verbatim + retrieved chunk text + static system prompt | `POST /v1/responses` (Terra fast / Sol strong, `store:false`) | [rag.ts](../src/lib/rag/rag.ts) · [rag-source-block.ts](../src/lib/rag/rag-source-block.ts) |

The app does **not scrub** PHI a clinician types. Default server-side query logging stores a
hash placeholder through `queryTextForStorage()` (keyed HMAC when `RAG_QUERY_HASH_SECRET` is
configured); `RAG_PERSIST_RAW_QUERY_TEXT=true` opts into raw server-side query persistence.
Generated-answer persistence in `rag_queries` is separately controlled by
`RAG_PERSIST_ANSWER_TEXT`; cached answer payloads are a separate retention surface. The browser
retains raw query/answer thread text in `window.sessionStorage` for tab restoration with a
12-hour restoration TTL (validated on read/write, not an assured background deletion deadline)
and sign-out/owner checks; server hashing does not remove that shared-workstation
risk. See the authoritative [PIA data flow, mitigations and PIA-8](privacy-impact-assessment.md)
and [thread storage implementation](../src/lib/answer-thread-storage.ts).

When configured, authenticated Responses requests include a stable HMAC-SHA256
`safety_identifier`; anonymous and background requests omit it. Supabase database/storage data
is recorded at rest in **Sydney — AWS `ap-southeast-2`** (PIA §7). Browser storage, Railway
processing and OpenAI retention are separate surfaces; `store:false` and local hashing do not
establish provider deletion or whole-flow onshore processing.

## 3. OpenAI's current terms (verified 2026-07-13)

Facts pulled from OpenAI's public policy/docs pages on 2026-07-13. **Re-verify at execution time** —
these terms change; the PIA (2026-07-06) already predates the Australia data-residency option below.

| Item                          | Current position                                                                                                                                                                                                                                                                                                                                                                                                                                      | Source                                                                                                                                                                                                             |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **DPA available**             | OpenAI executes a Data Processing Addendum for API customers; OpenAI acts as **processor**, and binds each sub-processor to comparable obligations. Current version `v.010126` (1 Jan 2026).                                                                                                                                                                                                                                                          | [DPA](https://openai.com/policies/data-processing-addendum/) · [DPA PDF](https://cdn.openai.com/pdf/openai-data-processing-addendum.pdf)                                                                           |
| **Training**                  | API inputs/outputs are **not used to train models** by default (API opt-out since 1 Mar 2023).                                                                                                                                                                                                                                                                                                                                                        | [Data controls](https://developers.openai.com/api/docs/guides/your-data)                                                                                                                                           |
| **Default retention**         | Inputs/outputs retained **up to 30 days** for abuse monitoring, then deleted.                                                                                                                                                                                                                                                                                                                                                                         | [Data controls](https://developers.openai.com/api/docs/guides/your-data)                                                                                                                                           |
| **Zero Data Retention (ZDR)** | Removes the 30-day abuse-monitoring retention; **not self-serve** — prior approval by OpenAI, configured per **project**. Apply via the account/sales team.                                                                                                                                                                                                                                                                                           | [Data controls](https://developers.openai.com/api/docs/guides/your-data)                                                                                                                                           |
| **Data residency**            | API data residency now covers **Australia** (among US, Europe, UK, Canada, Japan, Korea, Singapore, India, UAE). Enabled by creating a **new Project** and selecting the country; eligibility via sales. **Australia = storage at rest only** — regional _processing/inference_ is US/Europe/UAE only. ~10% uplift for models released from 5 Mar 2026.                                                                                               | [Data residency (API)](https://help.openai.com/en/articles/10503543-data-residency-for-the-openai-api) · [Announcement](https://openai.com/index/expanding-data-residency-access-to-business-customers-worldwide/) |
| **Sub-processors**            | Published list of sub-processors that may process Customer Data. Review for the APP 8 accountability chain.                                                                                                                                                                                                                                                                                                                                           | [Sub-processor list](https://openai.com/policies/sub-processor-list/) · [platform](https://platform.openai.com/subprocessors)                                                                                      |
| **Prompt caching**            | GPT-5.6 requests `prompt_cache_options.ttl="30m"` by default and never receives the deprecated retention field. OpenAI documents prompt-cache application state on local GPU machines with a maximum 24-hour expiration; the requested TTL is a minimum cache lifetime, not that maximum or a deletion deadline. Explicit pre-5.6 deployments retain the legacy retention behavior. ZDR interaction must be **confirmed in writing** (see §6, PIA-6). | [Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching) · [Data controls](https://developers.openai.com/api/docs/guides/your-data)                                                          |

## 4. This app's endpoints are ZDR-eligible

ZDR **excludes** stateful products: Conversations, Assistants/threads, ChatKit, `/v1/files`, vector
stores, fine-tuning, video, vision fine-tuning. This app uses **only** `/v1/responses` (stateless,
`store:false`) and `/v1/embeddings` — **neither is on the exclusion list**. So the two egress points
that carry PHI are exactly the ones ZDR is designed to cover. This is the strongest lever available.

## 5. Recommended basis to satisfy APP 8 _(engineering interpretation — counsel to confirm)_

Relying on **APP 8.1 "reasonable steps"** (a binding contract that holds the recipient to
APP-comparable handling) is the mainstream, defensible path — **not** consent under APP 8.2(b), which
is fragile as a sole basis for sensitive health information. The "reasonable steps" package:

1. **Executed OpenAI DPA** — the contractual spine (processor obligations, sub-processor flow-down,
   security, breach notice, SCC-equivalent terms). **Required.**
2. **ZDR on the project** behind the production key — removes the 30-day retention for both egress
   points (§4). **Strongly recommended.**
3. **Australia data residency** for storage at rest — keeps stored content onshore (inference still
   crosses; PHI-minimisation reduces what inference sees). **Optional but high-value** for a WA
   clinical posture; weigh against the ~10% cost uplift.
4. **No-training default** (already OpenAI's API default) — confirm in the executed contract.
5. **The app's own minimisation** as documented "reasonable steps" under APP 11: default server-side
   query hashing, `store:false`, Supabase Sydney residency, and the shipped PHI reminder
   (do-not-enter-identifiers), with the browser/cache and optional persistence limits in §2.

These are the proposed engineering inputs to the authorised APP 8 decision. They do not close
PIA-1 automatically; the register's evidence/decision requirements govern release acceptance.

## 6. Open question to pin with OpenAI

**What is the effective prompt-cache deletion behavior under ZDR for GPT-5.6 requests that specify
the 30-minute TTL, and for requests where the app omits the extended TTL option?** Get this in
writing — it determines whether **PIA-6** is fully resolved by ZDR or merely mitigated. Record the
answer in the status block.

## 7. Consistency with the shipped user-facing notice

The `/privacy` page and composer notice tell users that durable database/storage data is in
**Sydney**, Railway processes requests in **Singapore**, and question text + excerpts go to
**OpenAI in the US**. OpenAI is asked not to store response objects (`store:false`), while separate
provider retention and local 30d/90d retention are disclosed. This document must stay consistent
with those claims.

- **Merge status:** the draft APP-5/1 controls are **live on `main`** — `src/app/privacy/page.tsx` and
  the composer notice landed via **PR #513** (`eeb2340ad`). Their final governance approval remains
  open under **PIA-5**, alongside the APP 8 contractual basis below.
- **Follow-up:** if **Australia data residency** is enabled, update the "where stored" section to
  describe the selected OpenAI storage region without implying that inference is processed in
  Australia.

## 8. Operator action checklist

Provider agreement acceptance and account-setting changes must be performed by the appropriate
account holder or authorised signatory. An automated agent must not accept those terms or impersonate
those roles.

The operator approved pursuing these steps on 2026-07-14. Repository ledger `#053` subsequently
recorded DPA and ZDR completion on 2026-08-18, and `#HVTYAT` reconciled narrative documentation on
2026-08-27. An authenticated owner review on 2026-09-01 found API data sharing disabled and, with
explicit approval, changed API call logging and the optional hosted-tool classes to `Disabled`.
No visible ZDR entitlement or configured retention type was present. On 2026-09-01, OpenAI
acknowledged receipt of an `API for Enterprise` sales request for ZDR covering Responses, Embeddings,
prompt caching, the applicable DPA, and Australia data-residency options. Submission is not approval.
At that September observation, secure ZDR and applicable-contract acceptance references were still
missing. The 5 October evidence subsequently verified the narrow OpenAI standard-agreement and
Railway execution items; ZDR and broader legal/clinical decisions remain unresolved in the register.

- [x] **1. Record applicable OpenAI standard-agreement/DPA acceptance evidence** for the production account
      → [openai.com/policies/data-processing-addendum](https://openai.com/policies/data-processing-addendum/).
      Recorded verified 2026-10-05 through owner-attested standard terms and existing use, not
      a newly executed countersigned agreement. See `OPENAI-STD-20261005` and the linked evidence.
      The older 2026-08-18 assertion remains historical. Keep confidential records outside Git.
- [x] **2. Record Railway DPA execution evidence.** Recorded verified 2026-10-05 through owner
      confirmation and observed completed DocuSign envelope (`RAILWAY-DPA-20261005`). This closes
      execution evidence only for the restricted first-release scope; it does not certify broader
      sensitive-health-data coverage or whole-flow APP 8 compliance.
- [ ] **3. Attach current ZDR evidence** for the production project. The repository records coverage
      for `/v1/responses` + `/v1/embeddings` on 2026-08-18; the OpenAI account owner must provide a
      sanitized provider-account or written approval reference.
- [ ] **4. Decide on Australia data residency** (new Project + country selection; sales-gated).
      Record region + date, or record an explicit decision not to adopt it and why.
- [ ] **5. Confirm the ZDR ↔ prompt-cache behaviour** in writing (§6); record the answer.
- [ ] **6. Review both providers' sub-processor lists** for anything counsel should note in the APP 8 chain.
- [ ] **7. Legal sign-off** that the §5 package satisfies APP 8 for sensitive health information and
      approves the shipped draft APP 5/1 wording under PIA-5.
- [ ] **8. Keep `/privacy` copy in sync** if AU residency is adopted (§7) — note US/AU storage.
- [ ] **9. Code follow-ups** once the above land (§9), if adopted.

> Draft APP 5/1 controls (the collection notice + `/privacy` page) are live on `main` via PR #513.
> Final governance approval remains open under **PIA-5**; this checklist also tracks the remaining
> **APP 8** contractual basis for both overseas providers.

### Status record — dated evidence, subordinate to the register

| Field                               | Value                                                                                                         | Date       | Evidence                                                                    |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------- |
| OpenAI org / production project id  | Default project serves production, owner-attested; exact identities retained privately                        | 2026-10-05 | OPENAI-STD-20261005-ACCOUNT; no secret values compared                      |
| DPA accepted (version)              | Standard Services Agreement and incorporated DPA effective 2026-01-01; recorded verified for restricted scope | 2026-10-05 | OPENAI-STD-20261005; owner attestation of existing standard-contract use    |
| Railway DPA executed (version)      | Completed envelope observed; recorded verified for restricted scope                                           | 2026-10-05 | RAILWAY-DPA-20261005; signed terms were not exported or re-reviewed         |
| Railway Singapore processor basis   | Execution item verified; broader sensitive-data suitability / APP 8 decision unresolved                       | 2026-10-05 | Railway evidence limits and canonical register                              |
| ZDR approved (project)              | _requested; approval pending_                                                                                 | 2026-09-01 | OpenAI acknowledged the API for Enterprise sales request                    |
| ZDR covers /responses + /embeddings | _pending_                                                                                                     |            | No current ZDR entitlement or endpoint-coverage evidence                    |
| ZDR zeroes prompt cache? (§6)       | _pending external confirmation_                                                                               |            | Provider/account evidence required                                          |
| Australia data residency            | _not enabled_                                                                                                 |            | Transits Singapore (Railway) / US (OpenAI API)                              |
| API data sharing disabled           | _yes in current Platform account_                                                                             | 2026-09-01 | Feedback, eval/fine-tuning, and API input/output sharing all disabled       |
| API call logging disabled           | _yes in current Platform account_                                                                             | 2026-09-01 | Changed from per-call control to Disabled with account-owner approval       |
| Optional OpenAI hosted tools        | _disabled in current Platform account_                                                                        | 2026-09-01 | MCP, web/file search, image generation, code interpreter, container network |
| No-training confirmed in contract   | Historical 2026-08-18 claim; acceptance evidence is now linked, with no new bespoke term determination        | 2026-10-05 | OpenAI standard-agreement evidence; no ZDR inference                        |
| APP 5/1 notice governance approval  | _pending (PIA-5)_                                                                                             |            | `/privacy` page live with configured behaviour copy                         |
| Counsel sign-off (APP 8)            | _repository claim; external reference pending_                                                                | 2026-08-18 | Privacy-adviser reference required                                          |

Railway's execution-evidence step is recorded complete for the restricted scope. The signed copy
and certificate remain in secure owner records; do not repeat signing to reconcile this narrative.
Before broadening to real-patient or voice processing, obtain the separate suitability and
whole-flow decisions identified by the register. September public-term observations above remain
dated history, not a new review of the signed terms. This documentation reconciliation accepted
no agreement, changed no provider setting and supplies no fresh live verification.

## 9. Code follow-ups triggered by the outcome

These touch the OpenAI request path — do them **only after** the legal decision, and treat them as
provider-path changes (confirm before running against live).

- **ZDR granted:** no code change strictly required (ZDR is account/project-side). Revisit
  `OPENAI_PROMPT_CACHE_TTL` depending on the §6 answer and note the resolution against **PIA-6**.
- **Australia data residency adopted:** the client currently has no `baseURL` override
  ([openai.ts:75-79](../src/lib/openai.ts)). Data-residency Projects route via the standard API with a
  region-scoped project key; confirm whether a `baseURL`/project-key change is needed and wire an
  `OPENAI_BASE_URL` env only if OpenAI's residency setup requires it.
- **Defence-in-depth (optional, PIA-1 fix #4):** a lightweight outbound PHI/entity strip on the query
  before egress. Larger change; not required to close PIA-1.

## 10. Sources

- OpenAI — [Data controls in the OpenAI platform](https://developers.openai.com/api/docs/guides/your-data)
- OpenAI — [Data Processing Addendum](https://openai.com/policies/data-processing-addendum/) · [PDF v.010126](https://cdn.openai.com/pdf/openai-data-processing-addendum.pdf)
- OpenAI — [Sub-processor list](https://openai.com/policies/sub-processor-list/)
- OpenAI — [Data residency for the OpenAI API](https://help.openai.com/en/articles/10503543-data-residency-for-the-openai-api) · [Expanding data residency worldwide](https://openai.com/index/expanding-data-residency-access-to-business-customers-worldwide/)
- Railway — [Data Processing Addendum](https://railway.com/legal/dpa) · [Trust Center](https://trust.railway.com/)
- OAIC — Australian Privacy Principles (APP 8 cross-border disclosure; s16C accountability), _Privacy Act 1988_ (Cth)
- Internal — [Privacy Impact Assessment](privacy-impact-assessment.md) (PIA-1, PIA-6)
