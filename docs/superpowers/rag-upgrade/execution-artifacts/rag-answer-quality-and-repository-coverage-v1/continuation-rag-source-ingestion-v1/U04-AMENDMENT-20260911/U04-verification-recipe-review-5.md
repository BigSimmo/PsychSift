# U04 recipe 5, host experiment 3 and concrete admission review

**Recipe specification: PASS at source level. Recipe quality: PASS at source level. Experiment specification: PASS. Experiment quality: PASS. Concrete synthetic admission: READY under the exact outer launch constraints below.** No remaining high-confidence Critical or Important source defect found in the complete corrected algorithm. These verdicts permit only the separately admitted next synthetic host attempt. They do not claim a successful runtime fix, actual Vitest execution, real-gate admission or U04 product acceptance.

The first actual host experiment remains **FAILED**. The correction addresses a documented lifetime distinction and preserves strict cleanup verdicts. The exact cause of the earlier count remains an inference, not proven by its artifacts.

## Actual failure and official-source basis

I read and hashed the exact immutable attempt-1 evidence:

| Artifact | SHA-256 |
| --- | --- |
| `U04-host-proof-20260910-1-healthy-result.json` | `53272bcf9badd969c0133fdcdfb5a4b3aae4b9f7a7e4be534cef7e4121a40e6e` |
| `U04-host-proof-20260910-1-healthy-spec.json` | `523cbb103100822dfd75db8ba9a20f76c48ac051fca34a2f75dcd8b47a3357e8` |
| `U04-host-proof-20260910-1-summary.json` | `6be6a3f04025138ca8f9248a0ef88a6937981602c82f013a69a741a574c3d467` |

The healthy result records primary exit 0, no timeout/cancellation, `activeBeforeCleanup:1`, `forcedCleanup:true`, confirmed cleanup, `activeAfterCleanup:0`, and host exit 1. The spec binds host 4 and experiment 2 in healthy mode; that source branch creates no descendant. The summary is failed with no accepted case results. The harness aborts on the first failed case, so the other four cases remain unproved. This evidence is not converted into a pass.

Matching pre/post pins, normal lease release and preload restoration for this execution were separately reported by the controller. The three read artifacts establish the failed-case fields above. Earlier blocked prelaunch checks remain distinct from this actual experiment attempt.

Microsoft documents process-object signaling on termination while object lifetime can continue through open handles. Its job accounting documentation ties `ActiveProcesses` decrement to exit and reference release. Primary termination and job-empty observation are therefore distinct conditions. These sources do not prove which reference caused this count or guarantee one-second convergence. See [Terminating a Process](https://learn.microsoft.com/en-us/windows/win32/procthread/terminating-a-process) and [JOBOBJECT_BASIC_ACCOUNTING_INFORMATION](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_basic_accounting_information).

The owned-job termination fallback remains meaningful: it terminates associated processes and nested child jobs. It does not justify inferring descendant cleanup from a primary exit code. See [TerminateJobObject](https://learn.microsoft.com/en-us/windows/win32/api/jobapi2/nf-jobapi2-terminatejobobject).

## Frozen identities and full-range method

| Input | Observed SHA-256 |
| --- | --- |
| `U04-run-explicit-vitest-candidate-5.mjs` | `e122ec5208eed1c406584f610e34dfad274053ca8394230a3d314d984526b08e` |
| `U04-owned-process-host-candidate-5.py` | `22c711c7f3e0d703719729940d30494b49a95d511c312731af1220e72df6cec5` |
| `U04-host-experiment-3.mjs` | `e6488bee5ba8d8bfcd6ee3d32717f23387b2ae9a8b5f91b752f41a9766f062f3` |
| `U04-host-experiment-admission-proposed-3.json` | `0850f50bc797d9641f309637528494e98ba7d96e790e196b880a5f89afaf12ee` |

The unchanged config adapter 2 retains SHA-256 `fa0f5486a884cef94689ebcf26531cdceaf3db95d220f545a4a61c10fbc6a8fb` from prior review. Proposed admission remains `approved:false`.

R remains `C:/Users/joshs/.codex/worktrees/rag-local-build-20260822/Database`, branch `codex/rag-local-build-20260822`, HEAD `378c9c3997f91921d89aa6d919b5c9ef05b2152a`, with clean tracked status.

I read the complete corrected host and proposal. Exact ordered text comparison after only the declared filename substitutions established `RUNNER_ONLY_NAMED_BINDINGS_CHANGED=True` and `EXPERIMENT_ONLY_NAMED_BINDINGS_CHANGED=True`. Runner 5 retains every runner-4 control flow; experiment 3 retains every accepted experiment-2 assertion. The complete integration is reassessed with the new host using unchanged proof, rather than reviewing only the correction delta.

## Corrected host lifecycle

**Completed-primary references are released before accounting.** Host 130-138 waits for the owned primary to be signaled, checks each thread/process handle close, clears only successfully closed handles, and records release. Normal execution captures the primary exit code at 186-188 before calling this helper after `wait==0` at 189-192. The job handle stays owned. A failed wait/close is an exception, not affirmative release.

**Cleared primary handles do not erase job ownership.** Finally 225-238 checks `assigned` first. It terminates and queries an assigned job until empty even when `pi.process` is already null. An accounting or close failure after primary-handle release cannot enter a false no-primary cleanup branch. An unassigned created primary remains suspended and is terminated/waited explicitly; true pre-creation failures retain no-process cleanup.

**Forced termination also releases primary references after termination.** Host 207-210 records forced cleanup, terminates its job, then waits/releases any retained primary handles before empty-job accounting. The assigned-job exception path uses the same sequence at 227-231. Cleanup API failure or missing report still leaves the Node owner in its live hold.

**The natural-drain interval is bounded and checks real state.** Host 193-206 records post-primary-wait activity, allows a monotonic nominal one-second interval only after primary completion without timeout/cancellation, polls actual job accounting, and checks cancellation nonce during that interval. It records elapsed grace and activity before forced cleanup. Remaining members still cause `forcedCleanup:true`; timeout/cancellation do not receive the normal-completion grace. Scheduling and unresolved cleanup are not hard wall-clock guarantees.

This is a bounded opportunity for natural job shutdown, not a proven timing diagnosis or an assertion waiver. An orphan remaining alive across the grace is still terminated and failed. Host success at 221 still requires primary zero with no timeout, cancellation or forced cleanup. Healthy success must be observed in the new attempt; it cannot be inferred from source or the old forced-cleanup result.

Suspended creation, assignment before resume, kill-on-close/no-breakaway containment, exact entry/runtime/spec identity, early-cancellation reporting, nonce checks and conservative exception cleanup remain intact. No unrelated process search, coordinator modification or external parent-hard-kill recovery was introduced.

## Complete recipe and unchanged experiment

Runner 5 retains root/project dotenv suppression; exact populated/empty discovery caches and unexpected-discovery refusal; normal Vitest start; exact module membership; complete ordered offline membership and fixture checking through the same owned host; live exclusive lease validation; framework-error collection across start/close; final unhandled-error reconciliation after awaited exit; bound affirmative child evidence; post-run pins; caught cancellation-publication errors; and asynchronous ownership retention until cleanup proof. Review-4 runner line pointers remain valid because only host/admission names changed. I1-I8 remain source-corrected; runtime proof stays separate.

Experiment 3 retains E1/E2 fixes. Controlled-grandchild cleanup stays unconfirmed until the exact PID probe returns `ESRCH`; live/uncertain evidence retains ownership. Orphan success requires primary zero without timeout, forced cleanup and confirmed descendant absence. Healthy acceptance still rejects forced cleanup. No case, expected status or assertion was relaxed to pass the earlier failure.

The five cases remain healthy exit, exit 7, early cancellation without primary creation, stuck-grandchild timeout, and primary-zero orphan cleanup. Success would establish only those Win32 host cases. It would not prove actual Vitest result/error accounting, actual recipe cancellation-publication fault handling, complete real-gate import/discovery closure, providers/SQL/native documents, or heartbeat advancement across its 60-second interval during this short experiment.

## Admission 3 and exact next launch

Fresh declared-file and exact-path checks returned:

```text
PIN_COUNT=14
PIN_MISMATCH_COUNT=0
EXISTING_EXACT_ATTEMPT_OUTPUTS=0
EFFECTIVE_ADMISSION_EXISTS=False
```

The sole new attempt is `U04-host-proof-20260910-2`. Preserve attempt 1, admission 2 and their artifacts unchanged. Effective `U04-host-experiment-admission-3.json` may be created only from this exact proposal by changing `approved` to true and adding this review reference; record its digest. The complete pin list, exact attempt and pre/post identity remain controller obligations because the harness enforces only a subset of proposal fields.

Immediately before and after execution, check all pins and the relevant identity/environment conditions. Require actual prelaunch absence of `NODE_OPTIONS` and `NODE_PATH`. Refuse inherited `CLINICAL_KB_HEAVY_LOCK_TOKEN` or `CLINICAL_KB_HEAVY_LOCK_PATH`; leave them untouched. The accepted scoped clean launch remains valid: retain only the preload variables' original presence/values in the same PowerShell process's memory, remove those process-local entries so they are truly absent, and restore unconditionally in that process's `finally`. Empty is not absent. Never display/persist their values. The controller reported a prior null-setting attempt left an empty entry and stopped preflight; that is not passed preflight or experiment evidence.

From R, launch only:

```powershell
& 'C:\Program Files\nodejs\node.exe' 'C:\Users\joshs\Codex-Handoffs\Ingestion\Execution\20260907-continuation\U04-host-experiment-3.mjs' run U04-host-proof-20260910-2
```

Use the pinned direct base Python and the harness's `-I -B`, without a venv redirector or extra Node runtime/preload arguments. Keep normal exclusive admission; stop on busy/inherited ownership. Preserve every exact outside spec/result/PID/summary artifact. Missing or contradictory cleanup proof retains the live parent. The workload deadline does not authorize killing that owner or releasing uncertainty. Retain and classify any new failure before further correction or attempt.

The fourteen pins cover the declared executables, primary DLL, listed standard-library entry files and complete local coordinator/helper import closure; they do not attest every transitive Python/OS runtime byte. This remains a bounded trusted-runtime experiment, not a sandbox or broad gate admission.

## Historical verdicts, route and actions

Preserve recipe reviews 1-3 FAIL/FAIL, recipe review 4 source PASS/PASS, experiment review 1 FAIL/FAIL, experiment review 2 source PASS/PASS, admission review 2, launch addendum 1, every blocked prelaunch record, and actual attempt 1 FAIL. Source acceptance does not supersede failed execution. Host 5's runtime fix is still unproved.

Independent reviewer `/root/u04_runner_review_3`, role `verification-router`, same session `01a08bd7-eaa0-7aa2-902e-a9cb0b2a4f12`; previously observed local resolved route `openai` / `gpt-6-astra` / `xhigh`, parent `01a07b47-4623-7e90-825a-ec25116b8531`. Service tier unavailable; no backend attestation inferred. The exact own-log selected-field evidence is retained in earlier reports.

This review used exact local reads/comparison/hashes/path checks, tracked status/branch/HEAD checks, and public official Microsoft documentation. No secret values were read/displayed. No local runtime, config, host, worker, test, gate, coordinator acquisition, provider-backed workflow, SQL, process termination, repository edit, commit, effective admission or agent dispatch was performed. Only this new outside report was created. An initial shell-based report write was rejected by the tool policy before process creation; the file was confirmed absent, then created with the direct patch tool. No partial report or source mutation resulted from that rejection.

Verification remains source/pin review consuming the existing failed experiment. No fresh passing test line exists. Real U04 manifest/admission, schema-test migration-discovery amendment and connected/clinical acceptance boundaries remain absent or pending.
