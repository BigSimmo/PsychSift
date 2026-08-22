# RAG answer quality, repository content, and Australian source augmentation — design

**Status:** Approved programme design, reconciled against `origin/main` `aa0c04bce12995894a9287cb1a084f89f2ed6ef8` on 2026-08-22. The new programme implementation has not started; the existing RAG improvement Track A, buffered-final path, and flag-gated evidence-preview prerequisites are recorded below and are not to be reimplemented.

**Date:** 2026-08-20

**Approval recorded:** 2026-08-21. All recommended brainstorming/grilling decisions were accepted, with the explicit correction that published site content is public to every reader and only administrators may add or change it.

**Primary decision:** Activated shared guidelines admitted by an administrator or trusted backend remain the governing uploaded corpus. Curated Australian sources augment them but do not silently replace them. All published Clinical KB site content is readable by every user; only administrators may add, edit, publish, or retire it. Ordinary users cannot upload documents, and owned document staging never participates in Answer retrieval.

---

## 1. Outcome

The chat should answer the clinical question directly, at the length the question needs, from the best governed evidence available. It should stop producing a generic two-sentence answer merely because the first retrieval pass was weak, a prompt budget was short, or the display clipped useful content.

The completed system will:

1. search uploaded guidance, approved Clinical KB site content, and approved Australian public material in one governed retrieval;
2. retrieve the relevant site domains for specifier, differential, medication, service, form, DSM, formulation, therapy, dictionary, factsheet, calculator, and tool questions;
3. resolve the newest fully activated public site release for every new question, return the same published site content to every reader, and invalidate stale answer/search caches when that release changes;
4. keep a current, valid uploaded guideline primary when site/public content also answers a clinical-guidance question;
5. use first-party and Australian material to fill genuine gaps without treating derivative site summaries as independent authority;
6. decompose broad questions so one missing subtopic does not collapse the whole answer into “not enough information”;
7. provide the supported part of an answer, name the exact remaining gap, and ask one useful clarification when it would change the result;
8. choose answer length from the question and evidence yield instead of a global word cap;
9. begin displaying only complete, verified, immutable semantic units while the remaining answer is prepared; and
10. measure retrieval, grounding, usefulness, latency, source freshness, augmentation availability, and false-insufficiency rates before rollout.

Uploaded-document trust is defined by the companion [trusted-ingestion design](2026-08-21-trusted-admin-document-ingestion-design.md): administrator/backend upload is the clinical admission action, but file bytes remain technically untrusted and cannot enter answers until security, identifier, extraction, index-integrity, source-policy, lifecycle, and digest-bound activation gates pass. First-party `clinical_kb_site` content is likewise public after administrator publication; there is no user-private site-content or private upload lane in Answer.

The Safety findings, Clinical notes, and Evidence panels shown in the supplied screenshot are not part of this programme. The main answer must be complete without requiring those panels. Existing verification and clinical-safety controls remain in force.

### 1.1 Current implementation baseline

This programme extends, rather than re-creates, several current owners:

- query intent/classification, bounded retrieval variants, conservative source-backed fallback, legacy owner-plus-public retrieval machinery, answer feedback, RAG fixtures, and two telemetry stores already exist; candidate Answer retrieval must constrain shared guideline/site content to one public population;
- `registry-corpus.ts` already projects services, forms, medications, and differentials into `documents`/`document_chunks`, with deterministic IDs/content hashes and optional best-effort re-embedding; specifiers and other canonical site datasets are not integrated, and the current optional refresh path is not a freshness guarantee;
- broad-question model routing, bounded `max_output_tokens` truncation recovery, and a one-prior-question follow-up wrapper also exist and must be protected by programme cases before any tuning;
- RAG improvement Track A is complete through S3: prompt v19/schema v4, the related-information composition menu, moderate 60–110-word guidance, up to six structured answer sections, and deterministic follow-up suggestions have landed and their recorded canary pair is green;
- Gate E blinded-comparison tooling landed in PR #2208 (`scripts/eval-answer-quality.ts` plus `scripts/blind-answer-pairs.ts`), and the historical paid v18-versus-v19 capture/owner blinded read is closed: 30 fixed cases, no added live questions, v18 3, v19 3, tie 24, neither 0. This is no-harm/no-measurable-difference baseline evidence with the recorded source-only/byte-identical caveats, not evidence that the new v20 programme is provider-verified; do not re-run it without a fresh explicit provider request;
- the accepted 2026-08-22 Gate E diagnosis in `docs/rag-improvement/231-diagnosis-2026-08-22.md` closes retrieval starvation as the current timeout premise: measured retrieval is 955 ms on text and 6,720 ms on hybrid against the 25-second fast-route budget. Remaining `provider_timeout` cases must be separated into response-bearing quality-retry exhaustion and zero-response initial-attempt timeout using per-attempt response/latency telemetry before remediation. Do not raise `answerRouteBudgetMs`, assume one mechanism, or move an existing quality predicate without first proving that the demonstrated answer fails it;
- `scoreAnswerQualityEvalCase` currently derives a 900-word contract ceiling from the six-section v19 schema, while a stale HANDOVER row still mentions the superseded 220-word ceiling. The evaluation owner must reconcile that documentation and re-derive the bound when v20 permits eight sections;
- Phase 0 incremental event rejection and flag-gated governed evidence preview exist on the server, and flag-gated client parsing/rendering has landed; and
- production answer prose remains buffered. Verified incremental lead/section generation, semantic-boundary parsing, and pre-persistence reconciliation have not landed.

`origin/main` also now contains the planning-only `2026-08-22-mode-aware-clinical-ask-implementation.md`; no implementation from that plan has landed. It is not a prerequisite for this programme, but it overlaps `src/lib/env.ts`, `src/components/ClinicalDashboard.tsx`, answer-feedback owners, `docs/openai-rag-operations.md`, and migration scheduling. Do not execute the two plans concurrently. Recommended order is this RAG programme first, followed by a fresh-current-main revalidation of Mode-aware Clinical Ask. If that plan lands first, rebase/reconcile this package before P00.

`src/lib/rag/rag.ts` is exactly at its enforced 4,362-line no-growth ceiling. Every programme task that touches it must use thin wiring into cohesive modules and keep the file at or below that budget; raising the budget is not an implementation option. Gate receipts now memoise unchanged lint, typecheck, and Vitest runs, and the gate arbiter requires an explicit verdict before expensive local gates. RAG, database, UI, workflow, dependency, container, and unknown scopes never defer on clean-history yield; report `RUN`, `DEFER`, `PROVEN`, and reused receipts exactly rather than relabelling any of them as a fresh pass.

All eight programme plans therefore begin with a current-owner test and make the smallest extension that satisfies this design. “Not started” below refers to the integrated programme, not to those prerequisites.

## 2. Why answers are currently brief or falsely unsupported

“The answer is not there” can be caused at every stage of the RAG lifecycle. Re-ingestion fixes only the subset caused by missing or poor index content.

| Layer                  | Failure                                                                        | What the user sees                               | Required correction                                                                          |
| ---------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Source coverage        | The required guideline was never uploaded or approved                          | No answer or a generic gap                       | Corpus inventory and coverage ownership                                                      |
| Site-domain coverage   | A site mode has no governed corpus adapter or is silently omitted              | Specifier/differential/medication questions miss | Explicit first-party domain registry, adapter, and inclusion/exclusion manifest              |
| Site-content freshness | Canonical site content changed but its projection/cache did not                | The chat contradicts the current site            | Changed-only synchronization, active release/change epoch, pending exclusion, cache digest   |
| Source currency        | Only a withdrawn, superseded, or expired edition is active                     | Stale answer or refusal                          | Effective dates, tombstones, supersession graph, review queue                                |
| Access/licensing       | eTG complete or AMH is treated like copyable public content                    | Missing evidence or unlawful copying risk        | Link-only metadata; never ingest protected content                                           |
| Extraction             | PDF text, tables, columns, headings, footnotes, or OCR are malformed           | Relevant document exists but the fact is absent  | Per-document extraction quality audit and targeted reprocessing                              |
| Chunking               | A rule, exception, population, and action are split apart                      | Nearby fragments fail claim support              | Structure-aware candidate pipeline and paired-context checks                                 |
| Metadata               | Publisher, jurisdiction, status, role, or dates are absent/wrong               | Correct source is filtered or misused            | Typed source-governance metadata and validation                                              |
| Embeddings/index       | Chunks are absent, stale, duplicated, or built with a mismatched generation    | Low or inconsistent recall                       | Generation audit and controlled shadow reindex                                               |
| Query understanding    | Acronym, medicine, document title, spelling, scope, or intent is misread       | Wrong search terms and irrelevant results        | Query analysis, decomposition, and targeted clarification                                    |
| Conversation context   | A short follow-up loses or misapplies the previous topic                       | “What about monitoring?” becomes generic         | Protect the bounded follow-up wrapper; measure before adding history payloads                |
| Retrieval scope        | Legacy owner/public filters omit public content or admit private staging       | “Not found” or inconsistent answers by login     | One public Answer corpus with anonymous/authenticated parity and private-row exclusion       |
| Domain routing         | A query is routed only to documents and not its relevant site domain           | Generic answer despite a strong site record      | Deterministic site-domain hints with open fallback and cross-domain coverage                 |
| Recall                 | Candidate count, lexical/vector mix, thresholds, or time budgets are too tight | Only weak fragments reach generation             | Recall diagnostics and intent-specific candidate budgets                                     |
| Ranking                | A relevant chunk is retrieved but ranked below noise                           | Generic response from weaker context             | Relevance-first reranking and per-subquestion coverage                                       |
| Diversity              | Results repeat one document or one subtopic                                    | Broad question gets one narrow fact              | Controlled document and subquestion diversity                                                |
| Source-role confusion  | PBS, legislation, consumer content, or an alert is used as treatment guidance  | Basic or misleading answer                       | Role eligibility before synthesis; role is not a relevance boost                             |
| Conflict handling      | Local and newer public guidance disagree                                       | Silent choice or blanket refusal                 | Explicit conflict object, local-primary rule, review flag                                    |
| Context packing        | Useful chunks are dropped, truncated, duplicated, or buried                    | Generator sees an incomplete case                | Claim-oriented context pack with token accounting                                            |
| Model routing          | A broad/complex question takes an unsuitable fast or extractive route          | Shallow answer despite adequate evidence         | Protect complexity-aware routing and compare route outcomes                                  |
| Prompt policy          | The prompt prescribes 2–4 sentences and 60–110 words                           | Correct but consistently shallow answers         | Adaptive answer contract and evidence-yield targets                                          |
| Output schema          | Too few sections or tight field limits prevent complete coverage               | Important details disappear                      | Adaptive section plan with bounded but higher yield                                          |
| Provider truncation    | Reasoning plus structured output exhausts `max_output_tokens`                  | Incomplete response degrades to a short fallback | Preserve bounded truncation self-heal; test full eight-section output before changing limits |
| Verification           | One unsupported subclaim causes the entire answer to fail closed               | “Not enough information” despite partial support | Verify by claim/section and retain independently supported units                             |
| Fallback               | Provider/parse/timeout fallback emits a canned refusal                         | Short generic response during degradation        | Useful source-backed partial fallback with exact gap reason                                  |
| Display                | `primaryAnswerDisplayText` keeps three fragments and an 85-word budget         | Server answer is fuller than the UI              | Remove silent clipping and render governed adaptive output                                   |
| Streaming              | The UI waits for the complete provider response                                | Long blank wait followed by one payload          | Verified incremental delivery, not raw token streaming                                       |
| Cache                  | Old prompt/index/source-policy fingerprints serve stale answers                | Improvements appear inconsistent                 | Version every answer-affecting contract and invalidate safely                                |
| Evaluation             | Only average recall or hand-picked successes are measured                      | False-insufficiency regressions escape           | Must-pass real failures and per-stage diagnostic metrics                                     |
| Operations             | Australian or first-party synchronization fails silently                       | Evidence disappears or becomes stale             | Independent corpus health, stale exclusion, and uploaded/site/Australian degraded modes      |
| Feedback               | “Unhelpful” feedback is not tied to a diagnostic trace                         | Same failure repeats                             | Privacy-minimised reason codes linked to an evaluation case                                  |

The programme must diagnose the layer before recommending re-indexing. Blanket re-indexing through an unchanged pipeline wastes time, creates operational risk, and can reproduce the same defects.

## 3. Source policy

### 3.1 Priority and conflict contract

The source order is a governance rule, not a blanket ranking weight. First-party site content can be primary for a product/catalogue fact, but it does not displace a directly relevant uploaded guideline for a clinical recommendation:

1. **Uploaded local guideline — primary.** A current, valid, accessible uploaded guideline that directly covers the question governs the answer.
2. **Clinical KB site content — first-party product context and governed augmentation.** Use canonical specifier, differential, medication, service, form, and other registered site records for product/catalogue facts and eligible supporting context. Preserve source lineage; a derivative summary is not a second independent source.
3. **WA public authority — augmentation.** Current WA Health, WA Office of the Chief Psychiatrist, and controlled WA health-service material may fill gaps or provide a currency signal.
4. **Australian national authority — augmentation.** TGA, ACSQHC, Australian Government Department of Health, Disability and Ageing, NHMRC, and scope-appropriate professional colleges may fill gaps within their role.
5. **Other Australian state guidance — fallback.** Use only when local and national sources do not cover the issue and label the jurisdiction.
6. **International authority — supplementary fallback.** NICE, WHO, or another approved international source may be used only when uploaded and Australian evidence is insufficient; it never masquerades as local policy.

If a newer Australian source materially conflicts with the uploaded local guideline:

- retain the uploaded guideline as the local primary source while it remains formally current and valid;
- show the conflict in the answer instead of silently reconciling it;
- identify the Australian source, publication/effective date, jurisdiction, and source role;
- create a review flag for the uploaded document; and
- do not automatically change local practice or activate a replacement.

If the uploaded guideline is withdrawn, explicitly superseded, expired, inaccessible, or fails a danger-level governance gate, it is not eligible merely because it was uploaded.

### 3.2 Approved source catalogue

| Source                                                            | Permitted role                                                               | Content mode           | Activation rule                                                               |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------- | ----------------------------------------------------------------------------- |
| Uploaded indexed guidelines                                       | Local policy, pathway, treatment, monitoring, forms and workflow as authored | Indexed content        | Current/valid, access-authorised, extraction acceptable                       |
| Approved Clinical KB site records                                 | Product/catalogue facts and role-constrained first-party clinical context    | Versioned site index   | Registered producer, source lineage, review state, valid active release       |
| WA Health policy frameworks                                       | WA policy and governance                                                     | Curated public index   | Human-approved source definition and document version                         |
| WA Office of the Chief Psychiatrist                               | Standards, guidelines, statutory clinical governance                         | Curated public index   | Same                                                                          |
| Controlled WA HSP/hospital publications                           | Local operational or clinical policy                                         | Curated public index   | Ownership, currency, and public access verified                               |
| WA legislation                                                    | Legal requirement only                                                       | Curated public index   | Legal role; never treatment guidance                                          |
| TGA                                                               | Product regulation and safety alerts                                         | Curated public index   | Role-constrained and current                                                  |
| ACSQHC                                                            | National safety and quality standards                                        | Curated public index   | Role-constrained and current                                                  |
| Australian Government Department of Health, Disability and Ageing | National programmes, policy, and official clinical resources                 | Curated public index   | Role-constrained and current                                                  |
| NHMRC                                                             | Approved guidelines and guideline methodology                                | Curated public index   | Current guideline only                                                        |
| RANZCP                                                            | Current specialist-college guidance                                          | Curated public index   | Retired guidance excluded by default                                          |
| RACGP                                                             | Scope-appropriate primary-care guidance                                      | Curated public index   | Use only for questions within scope                                           |
| PBS                                                               | Subsidy, authority, listing, and restriction facts                           | Curated public index   | Never substitute for treatment guidance                                       |
| Australian Prescriber                                             | Supporting professional review and education                                 | Curated public index   | Supporting role, not local policy                                             |
| eTG complete                                                      | Authenticated reference destination                                          | **Link-only metadata** | Never download, copy, quote, summarise, cache, chunk, embed, or index content |
| Australian Medicines Handbook                                     | Authenticated reference destination                                          | **Link-only metadata** | Same prohibition as eTG                                                       |
| Other Australian state authorities                                | Jurisdiction-labelled fallback                                               | Curated public index   | Only after local/national insufficiency                                       |
| Approved international authorities                                | Supplementary fallback                                                       | Curated index          | Only after uploaded/Australian insufficiency                                  |

**Explicit exclusion:** Healthdirect is not in the approved catalogue and must not be fetched, indexed, suggested, or used in answers.

**Historical correction:** NPS MedicineWise is not a current authority entry. Historical documents may remain labelled as historical; successor medicines-safety material is catalogued under its current publisher, such as ACSQHC.

### 3.3 Source roles and access modes

Every governed source and indexed document carries:

- `corpus_scope`: `uploaded_local`, `clinical_kb_site`, `australian_public`, or `international_supplementary`;
- `source_role`: `local_guideline`, `clinical_guideline`, `clinical_reference`, `service_directory`, `form_reference`, `tool_reference`, `safety_alert`, `regulatory`, `quality_standard`, `legal`, `subsidy`, `professional_review`, `service_policy`, or `reference_link`;
- for first-party content only: canonical site domain/route, logical record ID, producer/access partition, validation state, source-lineage digest, partition release ID, public static-manifest digest where applicable, dynamic-state digest, and partition release digest;
- `content_mode`: `indexed_content` or `link_only`;
- canonical URL, publisher identity, jurisdiction, publication/effective/review/expiry dates;
- currentness, clinical validation, extraction quality, and public-activation status;
- supersedes/superseded-by identifiers, retrieval time, content hash, and change state; and
- licence policy and an immutable reason when content indexing is forbidden.

For uploaded documents, `corpus_scope = uploaded_local` is written only on the activated shared generation. The prior owned row is staging, not an owner corpus. A role is supplied explicitly by the administrator upload template or trusted-backend manifest (prefilled defaults are allowed); publisher authority, content mode, and licence permission are never inferred from the document body.

`source_role` first determines whether a source is eligible to answer a claim. Relevance ranks eligible evidence. Authority metadata must not receive a broad score boost: an earlier experiment showed that governance weighting can reduce recall and ranking quality.

An official publisher or `.gov.au` domain establishes identity, not permission to copy/index. Catalogue roots default to licence review. Each exact public document version needs recorded licence evidence before `public_index_permitted`; eTG/AMH remain `metadata_link_only`, and explicitly forbidden/historical material remains non-indexable.

## 4. User-facing answer contract

### 4.1 Adaptive length

Length follows the clinical task and supported evidence yield:

| Answer shape                                     | Lead answer                  | Sections                                                                                |
| ------------------------------------------------ | ---------------------------- | --------------------------------------------------------------------------------------- |
| One fact, definition, dose, threshold, or yes/no | 1–3 concise sentences        | 0–1 only when essential                                                                 |
| Focused action or monitoring question            | 2–5 sentences                | 1–3 distinct supported sections                                                         |
| Broad management/pathway question                | Complete orienting paragraph | 3–7 ordered clinical sections                                                           |
| Comparison or conflict                           | Complete comparison lead     | Structured comparison/conflict sections, held until cross-source verification completes |
| Partial evidence                                 | Supported answer portion     | Exact source gap and targeted clarification/follow-up                                   |

These are shape targets, not hard word caps. The response stops when the question is answered and the evidence has no additional high-yield point. It must not pad a narrow question, repeat content across fields, or silently clip a broad answer.

### 4.2 Ambiguity and partial support

- Ask a clarification before retrieval only when population, setting, medicine, document, jurisdiction, or requested decision is materially ambiguous and competing interpretations would produce different answers.
- Otherwise proceed and state the interpretation briefly.
- Decompose broad questions into named subquestions and track evidence coverage for each.
- Keep independently supported subanswers even when another subquestion has no support.
- Replace the generic “not enough information” state with a structured reason: `not_in_corpus`, `retrieval_miss`, `insufficient_claim_support`, `source_role_mismatch`, `source_conflict`, `governance_block`, `timeout`, or `provider_failure`.
- When the user can resolve the gap, ask one targeted question. When they cannot, say what source or scope is missing and provide the supported portion.

### 4.3 Citations and source presentation

- Use compact inline citations attached to the sentence or section they support.
- Cite the smallest sufficient directly supporting chunk set.
- Distinguish uploaded-local, Australian augmentation, conflict, and supplementary sources in metadata, not promotional prose.
- Link-only eTG/AMH entries may be offered as “consult this authenticated reference” but cannot support a factual claim unless separately visible permitted evidence supports that claim.
- The main answer must stand alone; optional panels may expose deeper provenance but cannot contain required answer content exclusively.

## 5. Retrieval and composition architecture

The answer path becomes an explicit pipeline:

1. **Analyse.** Normalise the query, detect intent, identify material ambiguity, and build ordered subquestions.
2. **Snapshot and scope.** Resolve access plus one immutable request snapshot. Search `uploaded_local`, current `clinical_kb_site`, and active `australian_public`; add `international_supplementary` only after an evidence-gap decision.
3. **Retrieve.** Run lexical, semantic, title/section, structured-table, and document lookup routes appropriate to each subquestion.
4. **Merge.** Deduplicate by canonical document/chunk generation while preserving corpus and role provenance.
5. **Eligibility.** Remove inaccessible, inactive, withdrawn, superseded, link-only-content, role-ineligible, and danger-governance candidates.
6. **Rank.** Rank eligible candidates by clinical relevance and directness, with bounded source/subquestion diversity.
7. **Pack.** Build claim-oriented evidence groups that keep rule, population, exception, action, and units together.
8. **Assess coverage.** Record direct, partial, conflicting, or absent coverage for every subquestion.
9. **Compose.** Generate an adaptive lead and only the supported sections.
10. **Verify.** Check every claim, number, role, citation, source conflict, and governance rule independently.
11. **Fallback.** Preserve verified supported units and emit an exact gap reason if generation, parsing, time, or evidence fails.
12. **Deliver.** Send verified incremental units followed by one authoritative final payload.

Published first-party site content is deliberately public to every reader. New site content and document upload are administrator/backend-only: active `clinical_kb_site` and `uploaded_local` content are shared, while drafts, owned document staging, and legacy owner-private uploads are ineligible for Answer retrieval. Administrator/user identifiers are audit data and never retrieval, cache, log, or preview partition keys.

## 6. Ingestion and re-index design

### 6.1 Audit before mutation

For each active document, the audit records:

- expected versus actual pages, chunks, tables, images, and searchable units;
- empty, duplicate, oversized, undersized, low-information, and orphaned units;
- heading/section continuity and table row/header preservation;
- embedding/index generation, model, dimensions, strategy, and completeness;
- metadata completeness and source-governance validity;
- supersession/currentness state; and
- performance on one or more evaluation questions that should retrieve the document.

The audit assigns a reason code and one of four actions: `no_change`, `metadata_only`, `targeted_reprocess`, or `shadow_reindex`.

### 6.2 First-party site-content lifecycle

Repository-wide answering is driven by an explicit registry of approved canonical published content producers, not by crawling pages or indexing code. Existing service/form/medication/differential projections are reused; specifiers and later domains join through deterministic adapters. Every record carries a stable logical ID, producer class, publication version, content hash, source lineage, public-read policy, role, route, validation/currentness state, and release identity. Adapters read the same public state the site renders; drafts and previews are never eligible. Only administrator-authorized server paths may create, edit, publish, or retire records.

Static repository content is diffed by hash into a deterministic public static manifest, staged before the matching application release, evaluated, and atomically activated through one public site-release pointer. Administrator-published database records join the same public dynamic state. Publication writes a durable outbox event and increments the public cache change epoch in the same transaction, making the prior projection and eligible cached answers ineligible until replacement. Pending records are anti-joined from the public release; unaffected records may remain available in a typed updating state only while that exclusion is provable. The deployed runtime validates its expected public static digest, while a verified public dynamic update may activate without a redeploy. Unchanged embeddings are reused; deletions are tombstoned. Each answer is pinned to one request snapshot/cache namespace, while the next question resolves the newest public release/change epoch. Legacy `owner_id` values are reconciled into one canonical public publication per logical ID and retained only as server-side authorship/audit data. No answer-time Git read, page crawl, full re-index, or embedding call occurs.

### 6.3 Public-source lifecycle

Public documents move through:

`discovered → metadata_validated → fetched → extracted → shadow_indexed → evaluated → human_approved → active`

A scheduled change detector may fetch public material and build a shadow candidate automatically. It may not activate content automatically. Activation requires a human approval bound to the exact content hash, extraction version, index generation, evaluation report, and source-policy version.

Withdrawn or superseded content is tombstoned immediately for new retrieval, remains auditable, and is removed from active caches. A replacement still requires approval.

eTG and AMH remain `reference_link` + `link_only` through every lifecycle stage; any attempt to submit their protected content to fetch, extraction, embedding, or indexing fails closed and is audited without storing the content.

This public-source lifecycle must not call the trusted-backend upload channel to bypass source-definition, licence, exact-version, or human activation requirements. A trusted backend may transport an explicitly approved local upload, but automated discovery/change detection is a distinct source channel and can create only a shadow candidate.

### 6.4 Controlled re-index

Re-indexing is targeted and generation-based:

1. prove the defect with an audit or must-pass question;
2. create a shadow generation using the proposed extraction/chunking/embedding contract;
3. keep the active generation serving all users;
4. compare integrity, retrieval, answer quality, false-insufficiency, latency, and cost against the baseline;
5. require all hard gates and no material regression in protected slices;
6. obtain human approval for public-source activation and owner approval for live data mutation;
7. atomically activate the candidate generation; and
8. monitor canaries and roll back by restoring the prior generation pointer.

`npm run reindex` is queue recovery, not the controlled shadow cutover, and must not be used as a shortcut for this programme.

Approval semantics remain distinct: a new trusted uploaded document may receive its first shared activation automatically after all hard gates because upload already supplied clinical admission; a replacement generation for an already active document still uses explicit operational promotion after exact-generation comparison and recovery-readiness proof. That operational action is not a second clinical-content approval.

Production data-mutating re-index/backfill work requires explicit authorization plus a project-bound, digested `RecoveryReadinessEvidence` manifest covering current PITR/RPO, database backup evidence, separate Storage recovery evidence, and a recent isolated restore drill. Stage and promotion require fresh evidence; rollback verifies the exact digest bound into the promotion receipt and must not become unavailable solely because that evidence aged after promotion. If PITR remains disabled or Storage/restore evidence is absent, planning and offline harness work can proceed, but production mutation cannot.

## 7. Verified incremental delivery

The experience should begin safely as soon as useful verified material exists, without exposing raw model tokens.

The ordered protocol is:

1. progress state;
2. governed evidence preview after combined retrieval and governance checks;
3. complete verified lead paragraph, if it is independent and immutable;
4. independently verified answer sections in final order; and
5. one authoritative `final` payload.

Delivery invariants:

- each unit is complete, schema-valid, claim-verified, governance-eligible, citation-reconciled, and byte-identical to a subset of `final`;
- sequences strictly increase and reset on every attempt;
- the browser appends a unit once and never edits it;
- comparison conclusions, conflict resolution, cross-section summaries, and provisional numeric content remain buffered until all dependencies verify;
- provider deltas, partial prose, incomplete JSON, raw tokens, and text that may be revised never cross the server boundary;
- cancellation, retry, timeout, parse error, or final reconciliation mismatch discards the attempt’s previews;
- copy, save, export, and feedback activate only after `final`;
- cached answers obey the same event and reconciliation contract; and
- no eTG/AMH excerpt can appear in any unit.

The preferred first implementation uses one provider request. The server holds incomplete provider output, parses complete semantic units, verifies them, and emits only eligible units. If the installed provider/library cannot expose stable unit boundaries, prose stays buffered and only the already-supported evidence preview is incremental. A two-call “quick answer then full answer” design is explicitly deferred because it adds contradiction, cost, and reconciliation risk.

Accessibility requirements: announce only newly appended complete units through a restrained live region, never move focus, honour reduced motion, prevent layout shift, and verify phone widths. The Australian index being unavailable does not block uploaded/current-site answering; a stale site index is excluded without blocking valid uploaded/Australian evidence. A site lane in `updating` state may use only unaffected records and gives an exact bounded gap for the pending record. These states never trigger unrestricted live web search.

## 8. Evaluation and operations

### 8.1 Must-pass corpus

Seed the evaluation set with the real questions that produced brief, general, or false-insufficiency answers. Each case records:

- query and any material interpretation;
- expected source document(s), corpus scope, and source role;
- expected first-party site domain(s), public static-manifest match, public release fingerprint, and source-lineage behavior when applicable;
- expected subquestions and minimum coverage;
- facts/numbers that must be present or absent;
- acceptable answer shape and gap behaviour;
- required conflict/currentness behaviour; and
- whether incremental lead/section units are eligible.

Cases contain no patient-identifiable text. User feedback creates a candidate evaluation record, not an automatic production prompt or ranking change.

### 8.2 Gates

The offline candidate must meet all hard gates:

- zero access-control, link-only-content, citation, unsupported-number, prompt-injection, or source-role violations;
- no loss in protected uploaded-guideline recall;
- direct and cross-domain specifier/differential/medication cases retrieve the intended current site records without elevating them over eligible uploaded guidance;
- a stale/mismatched public release is never retrieved or served from cache, a pending administrator-published edit immediately excludes its old projection/cache while unaffected public records remain available only through a proven anti-join, and anonymous/authenticated readers remain in parity;
- false-insufficiency rate improves on the target slice;
- supported-subquestion retention improves or holds;
- must-pass real failures pass;
- no material regression in MRR/recall, conflict detection, citation precision, answer usefulness, or bounded latency; and
- every early unit exactly reconciles with `final`.

Provider-backed baseline/post canaries, live Supabase reads, paid model evaluations, production re-index, and activation are separate approval-gated activities. Offline tests and fixtures do not prove production readiness.

### 8.3 Privacy-minimised observability

Record bounded reason codes and counts, not raw clinical queries or answer prose:

- query class, subquestion count, and ambiguity outcome;
- active corpus scopes, selected site-domain enums, site static-manifest-match/release state, and augmentation health;
- retrieval route, candidate count, role exclusions, and coverage class;
- fallback/insufficiency reason;
- verified units emitted/discarded and reconciliation outcome;
- latency by stage, cache version, source-policy version, and index generation; and
- explicit user rating linked by opaque trace/evaluation identifiers.

## 9. Rollout and rollback

Roll out in dependency order behind independent server and client flags:

1. reconcile the v19 baseline and land diagnostics/evaluation contracts;
2. remove the current 85-word/three-fragment display clipping for the already-finalized v19 lead as a small compatibility fix, without waiting for migrations or v20;
3. source schema/catalogue, read-only audits, first-party domain registry, and provider-free static manifests;
4. shared recovery-evidence and append-only activation-receipt primitives;
5. first-party site shadow synchronization, starting with existing registry families plus specifiers;
6. combined retrieval and cross-domain coverage assessment;
7. adaptive v20 composition and complete inline section rendering;
8. verified lead/section delivery;
9. targeted public-source acquisition/re-index waves; and
10. blinded v19-versus-v20 usefulness review, internal canary, limited cohort, then broader activation.

Every stage has a kill switch. `RAG_SITE_CONTENT_ENABLED=false` removes the first-party site lane while preserving uploaded/Australian retrieval. `RAG_AUSTRALIAN_AUGMENTATION_ENABLED=false` removes Australian/international augmentation. `RAG_ADAPTIVE_ANSWER_ENABLED=false` restores the prior prompt/schema/composition contract. `RAG_ADAPTIVE_ANSWER_RENDER_ENABLED=false` restores the v19 complete-lead legacy surface from Task 0 without changing server evidence; it does not reintroduce the known 85-word clipping defect. Disabling incremental rendering leaves authoritative final delivery unchanged. `RAG_PROGRAMME_MODE=legacy` is the whole-programme rollback. Index/site-release rollback restores the prior public generation without deleting the candidate.

## 10. Programme plans and dependencies

| Execution slice | Plan                                                                                               | Depends on                                                                                                                        | Planning effort                     | Build effort                      |
| --------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | --------------------------------- |
| 1, then 9       | [Evaluation, rollout, and operations](../plans/2026-08-20-rag-evaluation-rollout.md)               | Tasks 1–2 first; Tasks 3–6 consume all later contracts                                                                            | high, final cross-plan review xhigh | high; live promotion review xhigh |
| 2               | [Australian source governance](../plans/2026-08-20-rag-australian-source-governance.md)            | Evaluation/telemetry contracts                                                                                                    | xhigh                               | high                              |
| 2, then 4 and 6 | [Repository content and freshness](../plans/2026-08-21-rag-repository-content-sync.md)             | Tasks 1–2 need evaluation; Tasks 3–5 need the shared recovery-evidence/receipt slice, not completed document re-index wiring      | xhigh                               | high                              |
| 2–3, then 8     | [Ingestion audit and targeted re-index](../plans/2026-08-20-rag-ingestion-reindex.md)              | Audit/recovery contracts first; edge pipeline before live re-index waves                                                          | xhigh                               | high                              |
| 1–5, then 8     | [Trusted administrator/backend ingestion](../plans/2026-08-21-trusted-admin-document-ingestion.md) | Evaluation types first; source policy and shared recovery before automatic activation                                             | xhigh                               | high                              |
| 5               | [Retrieval, decomposition, and coverage](../plans/2026-08-20-rag-retrieval-composition.md)         | Evaluation/telemetry; source/site metadata; site Tasks 1–5                                                                        | xhigh                               | high                              |
| 2, then 7       | [Adaptive answer and display](../plans/2026-08-20-rag-adaptive-answer.md)                          | Lossless v19 lead display is independent; v20 server/section work needs `AnswerCoveragePlan` and stable source/fallback contracts | high                                | high server, medium-high UI       |
| 7               | [Verified incremental delivery](../plans/2026-08-20-rag-verified-incremental-delivery.md)          | Stable final answer/schema/verification/context-snapshot contract                                                                 | xhigh                               | high                              |

The practical critical path is: evaluation Tasks 1–2 → the independent lossless-v19-display slice → Australian governance/read-only audit contracts plus repository-content Tasks 1–2 → shared recovery-evidence/activation-receipt primitives → repository-content Tasks 3–5 → retrieval contracts/retrieval implementation → evaluation rollout ownership through Task 4 → repository-content evaluation handoff → adaptive v20 answer/section rendering → verified delivery → offline edge/reindex contracts and trusted-ingestion implementation → final offline programme comparison → separately authorized connected source verification, provider/blinded v19-versus-v20 evidence, targeted live acquisition/reindex waves, and final rollout. Full edge-ingestion repair and document re-index wiring do not block the first-party site lane; they still block every connected document shadow-stage/evaluate/promote operation. Repository-wide content must not be postponed until after retrieval/adaptive work, because its domain, snapshot, cache, and public-access contracts are inputs to those schemas.

The eight implementation plans live in the sibling `../plans/` directory of each complete package. Their interleaved dependency order is defined by the package execution manifest rather than inferred from document order. Execution uses subagent-driven development sequentially: one fresh implementer for one bounded numeric task, then one fresh task reviewer returning separate specification-compliance and code-quality verdicts, with remediation and re-review before the next task. One Cloud/local execution session handles one phase-plan only, so task briefs, reports, review packages, and `.superpowers/sdd/progress.md` cannot collide across plans. Multiple implementers must not modify this shared RAG path concurrently. Use high build reasoning for RAG, ingestion, access, migrations, privacy, streaming, and rollout; medium-high is reserved for bounded display/UI or mechanical documentation tasks; use xhigh for final plan/branch/promotion review.

## 11. Definition of done

The programme is done only when:

- uploaded indexed guidelines are demonstrably primary in eligible conflicts and normal combined retrieval;
- specifier, differential, and medication questions retrieve their current canonical site content, multi-domain questions cover every required domain, and every approved public knowledge mode is registered and active; only private, operational, unsafe, or non-knowledge modes may have a reviewed permanent exclusion, and `pending_review` never satisfies completion;
- every new question uses the newest valid active public site release, the deployed static manifest exactly matches it, stale site projections/caches are ineligible, anonymous/authenticated readers remain in parity, and an in-flight answer remains pinned to one internally consistent snapshot;
- Healthdirect is absent from discovery, ingestion, retrieval, prompts, and source suggestions;
- eTG and AMH are enforced as link-only without copied or derived protected content;
- the Australian catalogue is curated, versioned, human-activated, tombstone-aware, and operationally observable;
- broad queries retain supported subanswers and use exact gap reasons;
- adaptive answers are not silently shortened by the renderer;
- all factual claims and every early semantic unit pass the same final verification/governance gates;
- targeted shadow re-index can be evaluated, activated atomically, and rolled back without serving a partial generation;
- ordinary users cannot upload documents, owned document staging is never retrieved, and only technically active shared administrator/backend uploads enter `uploaded_local`;
- non-admin site-content mutations are denied, administrator identity remains audit-only, and no owner-private site-content or uploaded-document lane enters Answer;
- must-pass real failure questions, protected RAG fixtures, production-readiness checks, and approved canaries meet their thresholds; and
- the runbook distinguishes code readiness, offline evidence, hosted/provider evidence, migration status, source activation, and production rollout.
