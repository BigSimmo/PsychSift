# CodeScene maintainability remediation: non-RAG phase

This work follows the full-file CodeScene audit of `BigSimmo/PsychSift` at
`7f3303c009df84a1e4e2b3e54ea6e4b32f3bf147`. Audit warnings describe maintainability;
they do not establish functional defects. Individual file scores are not
CodeScene's official repository score.

The full finding backlog, plan, source hashes and verification evidence are kept
in the local task workspace outside this repository. Task identity:
`psychsift-codescene-remediation-20261009`. This document explains the maintained
source changes; the task checkpoint records their current acceptance state.

## Scope and boundaries

RAG remediation is paused at Josh's request. This includes retrieval and ranking,
answer generation and verification, extraction/chunking/index/embedding producers,
related evaluation and protected tests. Source-rendering components are treated
conservatively as adjacent to that deferred work.

Local maintainability edits do not authorize provider traffic, production access,
publication or deployment. Existing unrelated changes in the original checkout
must be preserved. The remediation uses an isolated checkout with one writer per
owned file and one controller for shared verification.

## Implemented work packages

- `scripts/generate-design-system-adoption.mjs`: separates visual-provenance and
  adoption-manifest checks into ordered validation phases. Each phase keeps the
  existing error text, rejection conditions, ordering and early-return behavior.
  PNG header, structure and decoded-data checks, candidate source-binding phases
  and class-expression resolution have distinct helpers. Invalid-image refusal,
  exact suite/path checks, lexical shadowing, unknown values and cycles remain
  part of their original contracts.
- `scripts/design-system-contract-utils.mjs`: separates class-expression AST
  resolution from class-root and token-contract reporting. Unknown bindings,
  shadowing, cycles, alternative order and the edge-conflict early stop retain
  their existing meaning. Internal raw-scale checks receive a cohesive options
  object.
- `scripts/ledger-inbox.mjs`: separates request validation, payload construction,
  request application, cancellation, reconciliation and CLI dispatch. Receipt
  identity, fingerprints, dry-run behavior, locking and existing remote-check
  semantics must remain unchanged.
- `scripts/lib/tenancy-scan.mjs`: the separate privacy-sensitive work package
  simplifies AST evidence collection without changing tenancy rules. Acceptance
  requires focused offline proof and independent privacy/schema review.
- `scripts/ci-change-scope.mjs`: separates owner-manifest path checks, direct and
  derived change classification, Lighthouse budget parsing and self-test groups.
  Path containment, symlink refusal, policy patterns, output order and the full
  set of routing assertions are preserved.
- `scripts/check-codex-cloud-setup.mjs`: separates TOML/MCP parsing, inventory
  checks, setup phases and runtime validation phases. Credential restrictions,
  defaults, command requirements, diagnostic order and dependency checks remain
  intact. This source refactor does not change or provision any environment.

## Verification and completion

Verification uses existing focused behavioral tests and original-versus-candidate
output comparisons where appropriate. Required local domain checks and independent
reviews apply to stable source hashes. CodeScene re-reviews record remaining
warnings; helper extraction alone does not establish whole-file completion.

Do not regenerate adoption manifests, visual baselines, gate figures, debt
baselines or snapshots to make a check pass. Existing failures must be diagnosed
and distinguished from regressions on the audited base.

The programme remains incomplete while non-deferred findings lack implementation
and acceptance evidence or a reviewed, finding-specific reason to retain their
structure. Deferred, blocked, pending, failed and unscored work must remain visible
in the same task checkpoint. A local receipt export does not imply ledger sync,
CI success, merge, deployment or release acceptance.

## Restored checkpoint — 9 October 2026

The six saved script refactors were restored byte for byte at their original base commit. Their source hashes are unchanged, so the saved CodeScene analysis and independent source reviews remain historical evidence for exactly those versions.

Fresh local verification completed on the restored checkout:

- Adoption: 58 tests passed; the check-only repository contract passed for 55 components and 183 roots.
- Adoption parity: 23 synthetic PNG cases, 28 AST cases and 1,592 production files compared without differences.
- Cloud: all 35 tests passed, preserving the existing assertions and timeout limits.
- CI: all 129 tests across three suites passed, including the complete 384-case Bash matrix.
- Installed dependencies: 709 package locations and 48,240 files matched the saved locked tree.

The earlier interrupted and failed runs remain in the external evidence history. No additional source refactor or test relaxation was needed to close these verification gaps. These results accept the selected behavior-preserving batch locally; they do not establish that every CodeScene warning is fixed, nor hosted CI, publication, deployment or clinical readiness.

The remaining non-RAG inventory contains 1,272 warning-bearing files: 1,253 queued, 13 requiring ownership review and six partially refactored files with remaining findings. There are 4,904 original unresolved finding instances. The broad RAG deferral was widened to include 15 adjacent source/evaluation test files. Every future queued package still needs current-source and caller inspection.

The original checkout has advanced independently since the audit. The restored batch is isolated at its audited base and has not been integrated into that newer checkout. The canonical checkpoint, complete source copies, patch, recovery report, local receipt and hashes are kept in the existing external audit workspace.

## Local testing speed improvements — 9 October 2026

The same restored checkout now contains three focused performance improvements:

- Adoption manifest builds index imports and reuse source analysis within each operation. Later builds observe changed source and configuration.
- Design-contract helpers privately reuse at most four ASTs with identical filenames, source text and parser settings. The text-role scanner skips sources and tokens that cannot match its unchanged rule, retaining CSS errors and exact finding locations.
- The existing policy-only Cloud test harness skips runtime bootstrap and runtime diagnostics. Ordinary setup retains its runtime and credential checks; policy refusals, atomic replacement and failure status remain intact.

Six complete local suites passed: 60 adoption/visual-baseline tests, 73 design-helper/status tests, 35 unchanged Cloud tests and four new policy-harness tests. The complete design-system contract gate passed, including figures, token divergence, adoption and design-sync checks. Baseline/current comparison covered 2,351 tracked source files and 25,861 helper comparisons without differences. Separate fixtures cover cache keys, eviction, changed inputs and scanner errors.

Controlled timings and their limitations are recorded in the external `testing-speed-20261009` evidence directory under the existing remediation workspace. Benchmarks use fresh processes and disable result reuse. The existing content-pinned test receipts were also checked separately; a reused result is labelled as reused proof.

The adoption and contract utility hashes changed in this phase, so their earlier CodeScene reviews are historical. Fresh reviews of these versions are saved separately. The remaining maintainability programme and broader RAG deferral are unchanged. These local performance checks do not establish full-suite, hosted CI or release acceptance, and the prepared changes remain isolated from the newer primary checkout.

## PR #3512 integration repair - 13 October 2026

The published head `29fa506084d57ad72d12427728fc4d3aa8939bca` was merged with main
`08d8fb3eb10c039c507c3a13ebd43b7761b6ed87` in an isolated repair checkout. The only
content conflict was the CI scope self-test: the instruction-continuation assertion
now remains in the workflow/policy group, before the extracted dependency/container
group. Main's instruction routing, starter-sharing tenancy inventory and 224-route
expectation are retained. The original refactors and immutable review record are
preserved.

Fresh provider-free evidence: the CI scope self-test, static Cloud contracts and
owner-scope scanner passed. Ten focused suites passed all 230 tests, covering CI
scope, tenancy, adoption, design utilities, Cloud setup/policy and ledger handling.
Dependency provisioning initially waited behind another worktree's exclusive lease;
normal coordinator admission later succeeded and an exact-lock local donor was
reused. Historical results above remain historical. Hosted CI and release readiness
still require their own evidence. No merge, deployment, live canary or provider call
is authorized by this repair.
