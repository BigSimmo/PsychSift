# Documentation and organisation audit remediation

**Status:** local repairs implemented and checked; operational limitations below remain open. No publication or deployment.

Owning project: `BigSimmo/PsychSift`. Task `01a15cb5-c058-7190-a02c-e1865406dc6e`.
Base: `ea8eac2cd9141b787391aab275eed879e7b37deb`. Changes were made in the isolated
`codex/chat-psychsift-audit-fixes-psychsift-audit-fixes` branch. The original checkout's
unrelated changes were preserved. This is an audit evidence record, not another task ledger.

## Finding dispositions

| Finding | Smallest coherent repair                                                                                                                                                                                                  |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F01     | Incident instructions now use the actual feedback schema and authenticated review API/RPC contracts.                                                                                                                      |
| F02     | Superseded Railway service selectors replaced with documented current targets. Live topology still needs verification.                                                                                                    |
| F03     | Source recall distinguishes governance state, provider egress, worker activity, caches and retrieval exclusion. Proven source-specific exclusion remains an explicit containment blocker.                                 |
| F04     | Retention wording separates server metadata, raw browser session restoration, caches and provider retention. The 12-hour browser TTL does not establish background deletion.                                              |
| F05     | Agreement narrative reconciled with dated October evidence and its restricted scope; no wider legal or clinical approval inferred.                                                                                        |
| F06     | Production MCP write experiments removed from onboarding; production access remains governed and read-only by default.                                                                                                    |
| F07     | Routine onboarding points to focused offline app work; worker operation is a separate task.                                                                                                                               |
| F08     | Local launch inspection separated from provider-backed verification, mutation and spending approval.                                                                                                                      |
| F09     | Reusable clinical governance preflight added to the PR template; metadata enforcement remains advisory.                                                                                                                   |
| F10     | Competing programme task-status claims route to the canonical task lifecycle authority; historical programme records retained.                                                                                            |
| F11     | RAG documentation distinguishes the advisory impact line from binding clinical and live-canary requirements.                                                                                                              |
| F12     | Legacy design references point to the current token and design authority hierarchy.                                                                                                                                       |
| F13     | Viewer plans distinguish landed work from residual adoption; convergence debt is not falsely marked complete.                                                                                                             |
| F14     | Trigger Tree runtime state excluded from Git and Docker contexts.                                                                                                                                                         |
| F15     | Supported legacy TypeScript commands restored to the offline typecheck. Existing eight-case archive regression suite included in normal Vitest discovery without moving or deleting it. App tsconfig unchanged.           |
| F16     | JavaScript monetary controls included by coverage globs and required explicitly in the LCOV inventory contract; coverage thresholds unchanged.                                                                            |
| F17     | Shared publication reader, contracts and witness decoder extracted unchanged to `src/lib/publication/`; former worker paths remain compatibility reexports. PR, SAST and container selectors follow the new source paths. |
| F18     | Worker cache invalidation imports the existing cache module directly instead of the answer orchestrator reexport.                                                                                                         |
| F19     | Dated living documents opt into normal link and command checks through explicit lifecycle headers; historical records remain historical. Dead CME example replaced with the actual focused fixture.                       |
| F20     | Maintained handoff, organisation rationale and canonical PR workflow aligned with the owner's normal-merge instruction; retired-rule guard added. Historical squash-recovery evidence retained.                           |
| F21     | Staging instructions require complete application identity before probes and optional seeds, independent of CLI linkage.                                                                                                  |
| F22     | Superseded on merge with main: both recovery CLIs now use the atomic server-side recovery (`applyIngestionRecoveryActions`, commit `4973037a9`), so this patch's client-side executor and its tests were dropped.         |
| F23     | Queue health separated from current fenced-RPC signature and grant compatibility.                                                                                                                                         |
| F24     | Universal rollback/recovery guarantees withdrawn; final-attempt exhaustion and bounded diagnostics documented.                                                                                                            |
| F25     | Disaster-recovery rehearsal identity separated from an explicitly approved production replacement transition.                                                                                                             |
| F26     | API table corrected to implemented routes; the index checker now rejects definite table endpoints without a matching handler.                                                                                             |
| F27     | Plugin workflow selects focused offline checks for routine development and reserves strict readiness for release or activation. Rule-consistency checks include that plugin.                                              |
| F28     | Claude startup base freshness is forced to cached refs even when its parent requests a fetch. Hermetic command-capture regression covers the boundary.                                                                    |

An additional gate-selection issue emerged during verification: the generated repository-awareness
snapshot selected the full browser lane despite having no active route/component consumer since
the engineering panels were retired. Its exact-file classification is corrected with a
regression guard that rejects new application-source consumers. Independent verification review
confirmed the boundary; the final selector reports no browser work. Other data and browser inputs
retain their existing safeguards, and this snapshot retains build, coverage and static checks.

## Organisation approach

Retain the existing framework and domain structure. The curated documentation entry and
organisation map provide task-first navigation and logical ownership; a wholesale feature-folder
conversion would add churn without resolving these findings. New shared publication and recovery
modules have explicit area ownership. Existing external entrypoints, history, generated asset
generations, lockfiles and runtime-specific dependency boundaries are preserved.

Future family moves must prove path selectors and actual scan targets, script root discovery,
nested browser collection, ownership placement, Docker build contexts and installed-client
references before changing paths. This patch makes no bulk move or dead-code deletion claim.

## Independent review and limits

Independent ingestion review found no introduced blocker in F22. Independent RAG review verified
all three publication module bodies equal their originals after import-path normalization and
confirmed selector/container closure. Independent clinical-governance review found no introduced
high-confidence defect in the eight operational/governance documents. These are engineering source
reviews of uncommitted changes, not clinical-owner sign-off or deployed acceptance.

On merge with main (22 October 2026) the hazard register had been resealed and its drift
exceptions removed. To avoid new drift on sealed paths, this patch no longer edits
`docs/clinical-governance.md` or `src/lib/rag/rag-source-block.ts`: the development-profile guide
moved to `docs/governance/development-governance-scope.md`, and the RAG source block keeps its
original import through the worker compatibility re-export. No exception or seal was changed.

Recovery update on merge with main (22 October 2026): main replaced client-side recovery writes with
one atomic server-side recovery call that rechecks authority and lease identity, so the guarded
client-side executor this patch originally added (F22) was removed rather than merged. The lease
race described in the original review is now handled by that server-side check (per main's code; not re-verified live).
Final-attempt recovery and source exclusion still need separately approved operational
decisions and live evidence.

Local evidence includes 18 focused suites (295 passed, 39 existing skips), 979 offline RAG tests,
25 offline adversarial tests, lint, typechecking, documentation maintenance and policy checks.
The final snapshot/scope batch passed four suites (169 passed, 20 existing skips; some overlap
with the earlier focused batch). The new import guard covers tracked and untracked source files.
The isolated offline production app build succeeded. The full Chromium run was deliberately stopped
after 80 cases passed while the snapshot ownership error was diagnosed; it is partial browser
evidence, not a completed 763-test pass.

No provider calls, hosted CI, live database changes, clinical approval, publication or deployment
are established here. At that checkpoint full LCOV measurement, the full unit/PR-local gate and
complete browser acceptance remained separate proof boundaries. The continuation below retains
the later verification outcomes. See the same task's private implementation checkpoint
for exact local check output and final source identities; canonical task reconciliation remains
unsynced.

## Further review and full local verification

The owner's follow-up requests safe remaining repairs and full local verification before review.
The review base remains `ea8eac2cd9141b787391aab275eed879e7b37deb`; the initial 83-file candidate
was pinned as Git tree `bdd52861a52a57e3a808cf3d0575fa0572611537` so independent reviewers could
inspect a fixed work product. A separate ingestion reviewer checked the release-reporting delta.

Independent review also corrected two documentation findings: the handoff skill now routes
auto-merge authority to the canonical workflow, and the historical viewer notices acknowledge
the implemented signed-URL batch caller. The remaining prescriptive squash-only phrase in the
review protocol now says "After the merge". Historical records remain preserved.

The full offline verification plan runs the union of PR-local and full static gates, with the
complete default coverage suite replacing the duplicate plain unit invocation. It retains all
coverage thresholds and validates actual LCOV entries for the four JavaScript monetary controls.
App and worker builds, offline RAG gates, and structural readiness are included. Strict production
readiness runs separately and may retain owner-decision or live-evidence blockers; local execution
does not approve those decisions. Exact outcomes and required approvals belong to this task's
review bundle once execution completes.

The first complete default coverage run executed 1,969 files in 2,839.97 seconds: 1,959 passed,
7 failed and 3 skipped; 31,915 cases passed, 32 failed and 143 skipped. Two failed files could not
collect. This run exposed integration gaps in the route parser and runner-visibility extraction,
Windows Cloud-harness portability defects, lazy-import synchronization in two UI tests, and a
deadline race in a scanner semantic fixture. The repaired guards retain source enumeration and
all include globs; UI tests await real dynamic imports; scanner tests preserve real filesystem/hash
checks and the dedicated deadline/child-close assertions. The scanner adapter and UI runtime are
unchanged. Cloud fixtures preserve fake-command precedence and physical checkout identity, and
the generated profile normalizes native Git paths before its fail-closed checkout comparison.

Focused verification and the repaired-input full gate are recorded separately in the private review
bundle. The failing full attempt generated no LCOV and is not a passing coverage result. Source
comparison of previously untouched failing files establishes unchanged source, not a passing baseline.
The strict offline release diagnostic failed on the four existing pending/partial privacy controls:
OpenAI ZDR, APP8 cross-border basis, APP1/APP5 notice, and clinical information minimisation.
Its downstream production-readiness script was not reached; owner/provider/adviser evidence is
still required. No control, coverage threshold or exception was relaxed to obtain a passing check.
