# Clinical Governance Workstream

PsychSift is currently a source-backed clinical reference prototype. Before production clinical use, complete and record the following governance decisions.

## Deployment Classification

- Confirm whether the product is reference retrieval, clinical decision support, documentation assistance, patient-facing software, or a combination.
- Complete local TGA Software as a Medical Device screening before using generated clinical output in care.
- Name the clinical owner responsible for source approval, review cadence, incident review, and decommission decisions.

## Source Governance

- Define allowed source types, jurisdictions, and publisher hierarchy.
- Record source title, publisher, jurisdiction, version, publication date, review date, source status, local validation status, and extraction quality for every document.
- Treat unknown source metadata as unverified, not current.
- Define a review cycle for outdated, review-due, and unknown sources.

## Data And Privacy

- Do not upload patient-identifiable documents unless local governance and privacy approvals explicitly allow it.
- Confirm OpenAI and Supabase data-processing arrangements are acceptable for the intended clinical setting.
- Define audit requirements for uploads, document access, user queries, generated answers, copied drafts, and source opening.

The status authority is [`governance/privacy-readiness.v1.json`](governance/privacy-readiness.v1.json),
with the current evidence summary in
[`governance/privacy-closeout-2026-09-01.md`](governance/privacy-closeout-2026-09-01.md). As of
2026-09-01, OpenAI API sharing and call logging are disabled and optional hosted tools are disabled;
OpenAI has acknowledged the ZDR request, but ZDR, DPA, APP 8, APP 1/5 notice, and clinical
PHI-minimisation approvals remain release blockers. Do not infer approval from request submission or
from the public `/privacy` transparency page.

## Clinical Use Rules

- Generated answers and copied drafts must be verified against linked source text, local policy, and patient context before use.
- Do not add dose calculators, diagnostic scores, patient-facing recommendations, or automated treatment recommendations without dedicated clinical validation.
- Keep demo content clearly synthetic and separated from real clinical content.

### Named instruments and clinical scoring aids (Transparent Reference Aid Policy)

**Status: updated 2026-10-03.** PsychSift operates as an educational and clinical reference tool, following the transparent reference aid model (analogous to MDCalc, UpToDate, and Therapeutic Guidelines / eTG).

Standard, published clinical instruments (e.g. Hunter Serotonin Toxicity Criteria, Bush-Francis Catatonia Rating Scale, 4AT delirium screening) may present their published criteria items, transparent scoring formulas, and published cut-offs for clinician reference, provided:

1. **Source Attribution:** The primary validated source or statutory guideline is explicitly cited.
2. **Transparent Calculation:** Criteria and formulas are shown openly rather than computed by unexplainable "black-box" models.
3. **Reference Disclaimer:** Clinical copy transparently notes that reference scoring aids support but never substitute for bedside clinical assessment, local hospital protocol, and patient context.

Clinical copy should avoid issuing unconditioned automated prescribing or admission orders, while freely including essential clinical risk screening (such as screening for bipolar disorder before commencing antidepressant therapy, or checking thiamine status).

### Withholding a contaminated generated record

Where a generated record is found to describe a different diagnosis, withhold the affected body
rather than printing it under a warning. A warning asking the reader to distrust what follows is
weaker than not publishing it, and these pages are world-readable with no login wall.

Set `generatedBodyUnreliable` on the record's curated entry in `src/lib/differential-curated.ts`,
alongside a `contentNote` saying what was wrong and what still stands. `withholdGeneratedBody`
strips the affected fields at the page boundary and the page states the absence rather than
rendering an empty panel. Withholding is a holding action, not a fix: the record still needs review,
and the ten locally authored differential records still carry no clinician sign-off (`/issues`
`#87GR24`).

## Pull Request Preflight

Use the `.github/pull_request_template.md` clinical governance section for any change that touches ingestion, answer generation, search/ranking, source rendering, document access, privacy, production environment behavior, or clinical output.

- Confirm the Supabase target remains `Clinical KB Database` (`sjrfecxgysukkwxsowpy`).
- Confirm service-role credentials and private document access remain server-only.
- Confirm unknown or outdated source metadata is treated conservatively.
- Confirm demo/synthetic content remains separated from real clinical sources.
- Confirm clinical decision-support behavior changes have deployment classification and TGA SaMD impact reviewed before production use.

## Verification Records

### RLS & access scoping — 2026-06-28

- Supabase **security advisors: 0 findings** for `Clinical KB Database` (`sjrfecxgysukkwxsowpy`). The linter specifically flags missing RLS / insecure policies, so a clean run confirms RLS is enabled and policy-covered across `public` tables.
- Supabase **performance advisors: INFO only** — unused indexes (expected on a low-traffic database; do not drop pre-launch) and one auth connection-strategy tip (switch to percentage-based allocation when scaling instance size).
- Supabase unused-index advisor items are a watchlist, not a removal queue. Keep search/RAG support indexes such as document-label, title, chunk, summary, RAG logging, and audit indexes unless production query evidence plus local verification shows they are genuinely dead.
- Document organization coverage is an operational invariant: after ingestion or generated-label reclassification, run `npm run check:document-label-coverage` and require zero indexed documents missing generated `site` or `document_type` labels.
- **Application-layer cross-owner denial** (service-role routes enforce `owner_id` scoping in code) is covered by `tests/private-access-routes.test.ts` and `tests/private-rag-access.test.ts` (unowned document detail/signed-url/rename rejected; listing and search scoped to the authenticated owner).
- **Follow-up:** add a live DB-level RLS integration test that connects as two real authenticated users via the publishable (anon) key and asserts owner B cannot read owner A's rows. This needs a seeded test project/harness and is tracked as a remaining item.

## Source Provenance Taxonomy

Source provenance is an issuer-identity signal only. It is independent from currency, local validation, extraction quality, document type, and clinical relevance; combinations such as `Official · Outdated` and `Trusted · Unverified` are valid and must stay visible as separate caveats.

- **Official**: authenticated documents issued by a recognised Western Australian hospital or WA health-service network, including CAHS, WACHS, EMHS, NMHS, and SMHS. Official does not mean current, locally approved, or clinically relevant.
- **Trusted**: every other recognised authority, including BMJ, NICE, WHO, Australian national bodies, other Australian state health departments, generic WA Health material, and WA specialty services such as CAMHS.
- **Unclassified**: unknown authority, ambiguous identity, conflicting metadata, publisher aliases without compatible jurisdiction, or registry summaries. Registry summaries retain their separate identity and never inherit Official or Trusted provenance from linked or nearby authorities.

Authority must come from registered publisher codes or compatible canonical publisher/jurisdiction metadata. Arbitrary title, body, or extracted text claims do not establish source authority.

## Mode-aware Clinical Ask governance

Clinical Ask remains dormant by default and is separate from Smart mode search. The shared mode composer never
routes a natural-language query to Clinical Ask: Services, Forms, Differentials, Formulation, DSM-5 Diagnosis,
Specifiers, Therapy, Medication, Tools, Calculators, Factsheets, and Dictionary interpret natural language locally
and show their ordinary deterministic catalogue results. Medication Smart search is retrieval-only: it does not infer
suitability, dose, or treatment. In the Medication, Tools, Calculators, Factsheets, and Dictionary Smart states,
universal-search, Document, and Answer requests are suppressed; literal searches retain their existing behaviour.
`CLINICAL_ASK_ENABLED` governs only the dormant answer workflow; it does not enable, disable, or alter Smart search.
There is no microphone control or separate Ask rail. If Clinical Ask is exposed through a dedicated governed-answer
surface in future, every request must use the same deterministic Evidence Ladder: local
Catalogue first, authorised owner-scoped Indexed evidence second, and an allowlisted External Authority only when
there is a deterministic evidence gap, unresolved conflict, stale material, or a `needs_review` source. An unsupported
conclusion is rendered as an Evidence Gap; source conflict and review state remain visible, and clinically material
suggestions require Clinician Confirmation.

The authority registry is the only external-domain approval owner. A change requires a reviewed registry edit naming
the canonical HTTPS origin, publisher, jurisdiction, modes, and permitted path prefixes; focused redirect, private-IP,
subdomain, attribution, and exact-extract tests; clinical/source-governance approval; and an updated approval artefact.
Do not add a domain from request text, provider output, redirects, or retrieved page content. `reviewed` means the
catalogue/indexed record passed its repository review process; `needs_review` remains usable only with a visible
caution and can trigger external gap resolution; `unknown` never silently becomes reviewed.

Provider output is untrusted draft data at the synthesis boundary. Deterministic response governance validates mode
shape, claim-to-evidence support, citations, prohibited outcomes, and clinical confirmation before anything is shown.
External extracts remain server-only and request-scoped: attributable citations and retrieval dates may reach the
answer, but external pages are not durably imported into the catalogue, index, transcript, Case Context, logs, or
telemetry. Roll back generation with `CLINICAL_ASK_ENABLED=false`; disable only external fallback with
`CLINICAL_ASK_EXTERNAL_SEARCH_ENABLED=false`; use `CLINICAL_ASK_DISABLED_MODES` only as the emergency per-mode
denylist. None of these flags removes the separately required hosted migration, provider, clinical-evaluation,
protected-staging canary, contractual, or physical-device evidence.

An `answered` stream payload fails closed unless it contains governed evidence and every visible lead, section, and
conflict claim references evidence present in that payload. An Evidence Gap may still carry zero or partial evidence.
Clinical Ask production activation remains separately gated by named human clinical and contractual/privacy approval
plus physical iPhone Safari and installed-PWA acceptance. These answer-workflow gates do not block provider-free Smart
catalogue search.
