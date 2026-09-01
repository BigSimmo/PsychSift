# U02 clinical review 1

- Reviewer: `/root/u02_clinical_review_1`
- Role: `clinical-governance-reviewer`
- Review base/head: `f485df3358f43dff2b85698fcfc25d018854930a..4621b3000a05cd88494f4b87d807c8761d7f862f`
- Specification verdict: **Issues found**
- Task-quality verdict: **Needs fixes**
- Review mode: xhigh, static, read-only

## Strengths

- Exact document/generation equality, ordered whole-summary anchors, claim allowlists, deterministic projections, and deep freezing are centralized in the shared contract.
- Edge places policy, generation, complete source loading, and summary validation before its first completion-gate decision.
- Desired generated labels precede stale generated-label removal, and deletion remains restricted to generated labels.

## Critical findings

1. Node and Edge currentness validate the stored metadata payload and labels but do not compare every projected summary column. Edge also self-authorizes the candidate model. Divergent `summary`, `clinical_specifics`, source IDs, model, or generated time can therefore be blessed as current.
2. Inline worker enrichment uses stale claimed-job policy metadata after the generation commit deep-merges onto live document authority. A concurrent P05 denial can be missed.

## Important findings

1. Claim pages and label confidence are coerced with `Number(...)` instead of requiring primitive numbers.
2. Fallback validation does not enforce its exact deterministic anchor and evidence projection.
3. A marker-true, label-mismatched Node row begins label repair without first persisting the completion marker as false.
4. The mandatory `npm run eval:rag:offline` command remains red. The baseline diagnosis prevents attributing its failures to U02, but acceptance requires either a green gate or an explicit task-authority exception.

## Minor findings

1. Label-boundary matching indexes neighboring UTF-16 code units, so an astral Unicode letter or number can be mistaken for a token boundary.

## Unverified report claims

The reviewer did not rerun RED chronology or reported suite outcomes. No tests or external actions ran during review.
