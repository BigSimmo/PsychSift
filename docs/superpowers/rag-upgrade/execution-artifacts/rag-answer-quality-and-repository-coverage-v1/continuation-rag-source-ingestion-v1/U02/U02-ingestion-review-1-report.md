# U02 ingestion review 1

- Reviewer: `/root/u02_ingestion_review_1`
- Role: `ingestion-worker-reviewer`
- Review base/head: `f485df3358f43dff2b85698fcfc25d018854930a..4621b3000a05cd88494f4b87d807c8761d7f862f`
- Specification verdict: **Issues found**
- Task-quality verdict: **Needs fixes**
- Review mode: xhigh, static, read-only

## Strengths

- Node re-exports the shared coverage implementation while Edge imports the same owner, providing real selection parity.
- Active source loaders constrain generation before deterministic ordering and paging, with explicit overflow failure.
- The normalizer centralizes canonical IDs/text, exact projections, claim allowlists, derived pages, model/version markers, and deep freezing.
- Edge replacement is transactional and desired labels precede stale generated-label deletion.

## Critical findings

1. Edge deterministic fallback projects zero labels, while the unchanged strict completion gate requires `generated_labels > 0`. If fallback is intended to complete, the gate/RPC schema contract requires an approved forward migration and focused zero-label completion coverage. If fallback is intentionally provisional, that defer behavior requires an explicit contract test.
2. `worker/main.ts` manufactures metadata generation equality from the stale claimed-job snapshot before policy preflight and enrichment. Missing, malformed, mismatched, superseded, or concurrently denied live authority can therefore be hidden.

## Important findings

1. Fallback normalization does not enforce the exact first-selected-source, single-anchor, chunk-preference, derived-page, and evidence-type projection.
2. Edge structured-currentness derives expected model authority from the candidate payload itself.
3. `scripts/enrich-documents.ts` performs `metadata-stamp` persistence before exact-generation loading and P05 preflight.

## Minor findings

None.

## Unverified report claims

The reviewer did not rerun RED chronology, test outcomes, baseline reproduction, or the prohibited-action attestation. No tests or external actions ran during review.
