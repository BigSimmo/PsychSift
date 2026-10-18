# Clinical release boundaries: remediation handoff

This is the scoped engineering handoff for F06, F15 and HY03. It is not an approval record or a
new task ledger. The [privacy-readiness register](privacy-readiness.v1.json) remains the status
authority; the [production-readiness gate](../production-readiness.md#fail-closed-invariant) and
its validator are unchanged.

## F06: external evidence remains outstanding

The register retains seven verified requirements and these four release blockers:

| Requirement                          | Status and accountable role      | Genuine evidence or authorized decision still required                                                                                                                                                                                                                                                                                             |
| ------------------------------------ | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PRIV-PROVIDER-OPENAI-ZDR`           | `pending`; OpenAI account owner  | Production API-key organisation/project match without publishing secrets; current provider approval/configuration covering deployed Responses and Embeddings models; effective prompt-cache retention/TTL; sharing controls; dated sanitized evidence and expiry. Request acknowledgment, `store:false` and disabled logging do not establish ZDR. |
| `PRIV-LEGAL-APP8-CROSS-BORDER-BASIS` | `pending`; Privacy adviser       | Whole-flow determination covering Railway Singapore, OpenAI overseas processing, subprocessors, retention, security, deletion and incident terms; applicable basis, restrictions, residual risk and whether real-patient use is approved, restricted or prohibited.                                                                                |
| `PRIV-LEGAL-APP1-APP5-NOTICE`        | `pending`; Privacy adviser       | Accountable legal entity/jurisdiction, privacy contact, complaints/escalation and access/correction/deletion process, collection purpose and authority/consent basis, recipients/countries, change maintenance, intended audience and approved version/effective/review dates. These details cannot be invented by engineering.                    |
| `PRIV-CLINICAL-PHI-MINIMISATION`     | `partial`; Clinical safety owner | Named intended deployment and explicit residual-risk decision: accept a trained non-identifying workflow with monitoring/escalation, require evaluated fail-closed egress controls with clinical-preservation criteria, or prohibit provider-backed real-patient use. Warnings and identifier-shaped checks do not guarantee de-identification.    |

For every closed requirement record the requirement ID, actual `verified` or `accepted_decision`
decision, authorized role, rationale, intended scope, decision/review-expiry dates and sanitized
external evidence reference. An accepted restricted-use decision does not assert that the underlying
provider entitlement was verified. Keep confidential contracts, screenshots, personal signatures,
secret values and patient information outside Git. The existing
[role-attestation pack](privacy-role-attestation-pack-2026-09-01.md) contains the decision prompts;
use the current register and October agreement records where older prose differs.

The OpenAI and Railway agreement requirements are already recorded as verified on 2026-10-05 for
public references and wholly invented examples, excluding real-patient cases and voice. Their
recorded expiry is 2026-12-01. This handoff neither reopens those agreements nor extends their scope
or expiry. See the [OpenAI](openai-standard-agreement-evidence-2026-10-05.md) and
[Railway](railway-dpa-completion-evidence-2026-10-05.md) evidence records.

Clinical production activation and patient-data processing remain blocked under the existing gate.
A restricted non-identifying deployment still needs an actual authorized assessment, including
account-data risk. Ordinary local development is not approval. After genuine evidence is supplied,
the authorized owner updates the existing register and runs the existing release check. No gate,
status, legal determination, provider setting or live database was changed here.

## F15: hospital sick reports share the real-staff hold

The endpoint projects named roster inability-to-attend/cover reports; it does not read an illness
reason or diagnosis. In production it now returns 503 before creating the real admin client or
reading roles/reports unless `ROSTER_TEAM_RELEASE_ENABLED` is exactly `true`. Demo mode continues to
refuse the real reader. Explicit enablement preserves authentication, rate limiting, fresh role
loading and the reader's hospital-scoped capability check.

This applies the broad Roster/Admin/Teaching real-staff hold in the
[PIA](../privacy-impact-assessment.md#roster-release-2-local-implementation-assessment-2026-09-27)
to a roster-derived hospital projection. A separately authorized hospital-dashboard policy could
change that scope; no such approval was supplied or invented. Service privacy approval, isolation
proof and the Singapore application-server/residency determination remain external requirements.
Synthetic route/helper tests do not prove live auth, RLS, existing staff rows or deployed enablement.

## HY03: Factsheet summary context

The short clinical-reference projection now retains the existing demonstration/not-clinician-approved
notice and labels `reviewedOn` as `Content month`. The shared notice and date meaning are included in
source lineage, so that context participates in publication identity as well as the body hash.

`locally_reviewed` continues to mean source correspondence under
[Source Acquisition: Sign-off](../source-acquisition-protocol.md#4-sign-off), distinct from formal
clinical approval. Currentness and manifest eligibility are unchanged. This correction preserves
context; it does not invent a new rule prohibiting the short-summary corpus, certify the full
handout or claim that the existing local review was false. The clinical/content owner still needs
to resolve the short-summary corpus's intended audience and permitted use explicitly. No corpus
sync, index publication, hosted activation or provider-backed retrieval comparison occurred here.
