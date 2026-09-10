# U04 bounded host lifecycle evidence — 10 September 2026

Controller verdict: **PASS for the five synthetic process-lifecycle scenarios only** at unchanged repository HEAD 378c9c3997f91921d89aa6d919b5c9ef05b2152a. No U04 product test or product acceptance is claimed.

After independent review6 Spec/Quality PASS, exact admission4 and normal coordinator availability, the controller ran the pinned harness through U04-host-experiment-resume-2.ps1. Exact child command, from the programme worktree:

```powershell
& 'C:\Program Files\nodejs\node.exe' 'C:\Users\joshs\Codex-Handoffs\Ingestion\Execution\20260907-continuation\U04-host-experiment-4.mjs' run U04-host-proof-20260910-3
```

Result: **exit 0**, all five cases accepted. Healthy primary/host exit0 without forced cleanup; primary exit7 yields host failure; early cancellation starts no primary; stuck grandchild times out and is forcibly cleaned; orphan primary exits0 without timeout, its surviving child requires forced cleanup. Every bound host report has cleanupConfirmed=true and activeAfterCleanup=0; both grandchild PID probes establish absence before release. Normal coordinator owner subsequently exited. Exact 14 pins and effective admission matched before/after; process-local preload environment restored, lease environment untouched. The earlier busy-coordinator refusal started no fixture and remains separately recorded.

- Summary SHA-256: d71d91bf9d00fe931730f7a103b83694ea19f212b0fba16aa05ef0acfcc8120f.
- Effective admission4 SHA-256: a379dac1f3beae4a1d261d802cfcfa070ee53cfd25917c7b78e82d9a884bdf7b.
- Review6 SHA-256: 11f0d9c70d9abef2b38f3da6f9e087b07f50584f0d3175a6f6ab49e2d6969932.
- Outer evidence: U04-host-proof-20260910-3-resume-2-outer-result.json and U04-host-proof-20260910-3-resume-2-restoration.json.

Attempts1 and2 remain FAILED, with all reports and attempt2's scoped recovery preserved. This does not prove 60-second heartbeat advance, every active-cancellation/disk-error path, full hermetic OS/runtime closure, or actual Vitest reporting/error/discovery behavior. The latter requires an independently admitted concrete manifest and real gate execution once its source exists. No broad tests, providers, SQL, actual documents, ingestion workers, activation, deployment or publishing occurred.
