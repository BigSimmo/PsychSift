# U04 host experiment 4 and proposed admission 4 — independent review 6

**Specification: PASS at source level. Quality: PASS at source level. Exact synthetic admission: READY under the outer launch constraints below.** No remaining high-confidence blocking defect was found in this bounded correction. This decision concerns a fresh five-case synthetic host experiment; it is neither execution evidence nor permission to redispatch automatically. Actual attempts 1 and 2 remain **FAILED**. All previous failed reviews and attempt artifacts remain immutable.

## Scope and frozen inputs

O is `C:/Users/joshs/Codex-Handoffs/Ingestion/Execution/20260907-continuation`. R is `C:/Users/joshs/.codex/worktrees/rag-local-build-20260822/Database`. Fresh read-only Git inspection confirms branch `codex/rag-local-build-20260822`, HEAD `378c9c3997f91921d89aa6d919b5c9ef05b2152a`, and clean tracked status using `git status --short --untracked-files=no`.

| Exact input | Observed SHA-256 |
| --- | --- |
| `U04-host-experiment-repair-brief-3.md` | `941814bc5940e484283dad7dc02f093a3e39049e86b0700f7243fea27b960215` |
| `U04-host-experiment-4.mjs` | `13c260016359c34aeabac02be4edb6d0032c10deb569ed95e454ce035bfd5cf7` |
| `U04-host-experiment-admission-proposed-4.json` | `7c5642f1a7673b335252bab094248981398010e39415ae446f6ac1ecd4fe27b7` |
| `U04-owned-process-host-candidate-5.py` | `22c711c7f3e0d703719729940d30494b49a95d511c312731af1220e72df6cec5` |
| `U04-run-explicit-vitest-candidate-5.mjs` | `e122ec5208eed1c406584f610e34dfad274053ca8394230a3d314d984526b08e` |

The complete harness 4 and proposed admission 4 were read. Host 5 and runner 5 retain the exact identities accepted at source level in `U04-verification-recipe-review-5.md`; that full recipe review is reused, not represented as new runtime proof. The host ownership and cleanup paths relevant to this correction were checked again. The scoped clean-launch procedure from `U04-host-experiment-launch-addendum-1.md` remains applicable with the new exact harness/admission/attempt bindings.

## Attempt 2 and recovery evidence

Attempt `U04-host-proof-20260910-2` failed its orphan scenario. Its summary has `exitCode:1`, `cleanupConfirmed:false`, and only four accepted cases. The separate orphan report records primary exit 0, no timeout, no forced cleanup, job empty after 47 ms of natural-completion grace, and host exit 0. These facts fail the required forced-cleanup assertion. They are not an orphan-containment pass.

All five existing spec/result pairs bind matching nonce, parent PID, spec digest and host digest, and report confirmed cleanup with zero active job processes. Their current digests match the five pairs in the recovery-preflight record. The first four cases retain their individual results: healthy succeeded naturally; exit-7 failed as intended; early cancellation started no primary; stuck required timeout and forced cleanup. The aggregate experiment still failed.

| Recovery artifact | Observed SHA-256 |
| --- | --- |
| `U04-host-proof-20260910-2-recovery-preflight.json` | `ccff47455a25fe7e6d2fcc85e272f4c5277fced9d3046011ac711f2b057912d3` |
| `U04-host-proof-20260910-2-recovery-result.json` | `6686e71d862cbe823e14a1f985016682963510b0455218d337eaab7be8d83ba0` |
| `U04-host-proof-20260910-2-summary.json` | `333df768948c2edbf53c6c2e1f0cbf17a97aeb9513c8ed12dec215c8491bdabd` |

The preflight records the exact coordinator PID 30988, command line, creation identity, the five bound result pairs, and absence of each recorded host/primary/grandchild PID. The result records termination of only that task-owned coordinator, owner absence, no lock-file edits, and verdict FAIL. This supports the stated narrow recovery boundary. I verified the artifact identities and bindings; I did not independently repeat live process probes or perform termination. Controller-reported post-run pin parity and preload restoration remain controller evidence. An outer recovery exit of -1 is not successful experiment completion or normal lease release.

## Fixture diagnosis and correction

Node v24.19.0's Windows libuv source creates an additional kill-on-close job for non-detached children. Its detached branch omits that additional assignment and does not request `CREATE_BREAKAWAY_FROM_JOB`. This directly supports why the previous fixture could disappear with its primary; the recorded attempt alone does not prove the exact kernel event. See [official Node v24.19.0 process.c, initialization and spawn paths](https://raw.githubusercontent.com/nodejs/node/v24.19.0/deps/uv/src/win/process.c) (lines 65–115, 988–1042).

Harness 4 line 23 sets `detached:mode==='orphan'` only for the orphan grandchild. It retains ignored stdio and hidden-window launch. The grandchild first writes its exclusive PID evidence and then remains busy; the primary waits for that evidence before explicitly exiting 0 (lines 18–27). This constructs the intended surviving-child condition without weakening a verdict.

Host 5 still creates and assigns its primary before resuming it, and sets only `KILL_ON_JOB_CLOSE`, with no breakaway permission (lines 149–169). Windows propagates job membership through process creation; breaking away from an inner job stops at an ancestor that disallows it. Terminating the outer job also terminates its nested jobs. Therefore the detached fixture remains subject to the host's outer containment under the reviewed implementation. See [Microsoft nested-job inheritance and termination rules](https://learn.microsoft.com/en-us/windows/win32/procthread/nested-jobs). Actual detached-descendant containment is precisely what the next experiment must demonstrate; source review does not substitute for that result.

## Cleanup ordering and complete experiment control flow

The second correction is appropriate: harness lines 67–77 establish a bound host report, job-zero cleanup and exact descendant PID absence before scenario verdicts at 78–85. For stuck/orphan, `cleanupConfirmed` stays false until the probe yields ESRCH. Missing PID evidence, an alive PID, or any other probe error leaves it false. A mismatched or missing host report also retains ownership. Once cleanup is proved, a false scenario assertion can produce an ordinary failed summary and release the normal lease instead of keeping a live coordinator merely because the scenario failed.

The assertions remain strict: healthy requires natural primary/host success without forced cleanup; exit-7 requires its primary code; early cancellation requires no primary start; stuck requires timeout and forced cleanup; orphan requires primary exit 0, no timeout, and forced cleanup. Both descendant cases require confirmed job zero and exact PID absence. The correction does not turn ordinary primary exit into proof of descendant termination.

Admission and hashes precede the coordinator import; inherited ownership is refused; the harness acquires an exclusive, non-reentrant lease with its own PID (lines 30–48). Each sequential case requires fresh exact output paths and a nonce-bound spec (49–57). The direct isolated Python host is awaited asynchronously, preserving normal lease heartbeat (58–65). Signal handling marks cancellation, waits for the current bounded host lifecycle, and prevents another case (44–50, 88). Finalization writes the summary and releases only after affirmative cleanup; uncertainty keeps the owner alive (90–98). Host 5's unchanged termination, completed-primary handle release, cancellation-aware natural grace, and job-empty confirmation remain as reviewed in report 5.

## Concrete admission decision and required outer constraints

**READY for attempt `U04-host-proof-20260910-3` only.** Proposed admission 4 remains `approved:false`. All fourteen current pins were read and matched: `PIN_COUNT=14`, `PIN_MISMATCH_COUNT=0`. No exact next-attempt output path existed, and effective admission 4 was absent when checked. Those are review-time observations and must be refreshed immediately before launch.

1. Preserve the proposed file unchanged. If the controller separately proceeds, create `U04-host-experiment-admission-4.json` with only `approved:true` and the review reference added. Preserve both identities. The harness does not enforce the proposal's entire `pins` array or its `attempt` field; those are mandatory outer checks.
2. Recheck R/branch/HEAD, all fourteen pins, the effective/proposed relationship, and absence of every exact attempt-3 spec/result/cancel/grandchild-PID path plus summary. Check all pins again afterward. The pins cover the declared runtime files and complete local coordinator-helper import closure; they do not claim a hermetic Windows/Python installation.
3. Immediately before Node startup, require absence of `NODE_OPTIONS`, `NODE_PATH`, `CLINICAL_KB_HEAVY_LOCK_TOKEN`, and `CLINICAL_KB_HEAVY_LOCK_PATH`. The previously reviewed same-PowerShell-process procedure may save only the two preload variables in memory, remove their process-local Env entries to establish actual absence, and restore original presence/values in unconditional finally. Never display or persist those values. Never clear inherited lease tokens/paths; their presence means stop. Do not change user/system environment or coordinator state.
4. Use the exact direct Node executable with no runtime/preload arguments, from R, for only this command:

```powershell
& 'C:\Program Files\nodejs\node.exe' 'C:\Users\joshs\Codex-Handoffs\Ingestion\Execution\20260907-continuation\U04-host-experiment-4.mjs' run U04-host-proof-20260910-3
```

5. Retain the normal exclusive coordinator, direct base Python executable with `-I -B`, five sequential cases and 3000 ms workload deadline per case. A busy or inherited lease stops the launch. Missing cleanup proof retains the live owner and heartbeat for separately assessed recovery. Do not hard-kill the coordinator as a generic timeout remedy. Preserve failed evidence rather than reuse a namespace or edit a lock.

No additional source correction is required for this bounded launch. Runtime failure would require evidence review before any further change or attempt. This admission covers only synthetic Win32 lifecycle fixtures. Actual Vitest final-error/reporting behavior, runner cancellation-publication failure behavior, and a real U04 gate manifest remain separate and unproved; no real gate, product test/config, provider, SQL or ingestion-worker execution is admitted here.

## Observed reviewer route and verification boundary

Independent reviewer `/root/u04_runner_review_3`, role `verification-router`, session `01a08bd7-eaa0-7aa2-902e-a9cb0b2a4f12`. Selected fields from this exact session's `session_meta` and latest `turn_context` record provider `openai`, model `gpt-6-astra`, effort `xhigh`. Service tier is absent; no tier or backend route is inferred. Exact own log: `C:/Users/joshs/.codex/sessions/2026/09/10/rollout-2026-09-10T23-02-58-01a08bd7-eaa0-7aa2-902e-a9cb0b2a4f12.jsonl`.

Verification was Tier 0 source/pin/evidence inspection only. I used exact file reads, hashing, selected own-session metadata, tracked-only Git status, and official public Node/Microsoft sources. No tests, syntax/config execution, host or runtime launch, arbiter/gate, coordinator acquisition, live process probe/termination, provider/SQL call, repository edit, untracked enumeration, protected `1` access, commit or delegation occurred. No broader or equivalent gate was stacked. Only this new outside review report was created; all reviewed inputs and failed verdicts were preserved.
