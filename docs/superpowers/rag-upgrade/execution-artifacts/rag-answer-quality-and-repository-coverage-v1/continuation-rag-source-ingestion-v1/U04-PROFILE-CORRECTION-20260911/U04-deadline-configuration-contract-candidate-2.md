# U04 deadline configuration contract candidate 2

Controller correction, 11 September 2026. Outside draft, not adopted or executed. This replaces deadline candidate1 as the proposed profile prerequisite, following independent review1 (31af1fa64658801f8b30c849b46478b1f5324101a3d8343b95da5ec6b7591c79). The original diagnostic proposal and failed review remain preserved. Original U04 TASK_BASE is e502ecd9b18f4a8f22469f68c0ffa5976a33a619.

## Adopted semantics preserved

The 15000 ms server deadline concerns the top-level database statement and must be effectively configured before dispatch. The positive lock timeout, at most 2000 ms, applies before every relevant blocking acquisition; the adopted contract permits function-local configuration before that acquisition. The client retains its separate 20000 ms total deadline for one operation. Do not turn this into a gateway-acceptance timer or a universal hard real-time terminal-scheduling guarantee. Do not raise the configured limits, introduce hidden grace periods, round away observed overruns, or infer rollback from timeout/abort/response loss.

Independently reviewed effective server/role configuration gates an operational profile. Separately admitted connected execution and contention proof gates operational use. Local strict parsing and mocked construction require neither gateway telemetry nor completion of five diagnostics. No configured timeout or valid record proves that an actual request was canceled.

## Closed configuration facts

Use the enclosing SQL environment's exact primitive types, RetainedBytes, RoutineIdentity and ImplementationBinding. This is a nested fixed field of both the native facts and their typed capture projection. It inherits evidenceMode, target, capturedAt, producer and implementation from that same enclosing record; no standalone deadline record may be substituted for the full capture. Every listed key is mandatory, every other key rejected.

```text
DeadlineConfigurationV1 {
  kind: "u04-deadline-configuration-v1",
  deploymentIdentity: Text,
  transport: "supabase-postgrest-rpc",
  requestPathIdentity: Text,
  policy: {
    topLevelStatementDeadlineMs: 15000,
    lockTimeoutMs: PositiveInt,
    clientTotalDeadlineMs: 20000
  },
  bindings: DeadlineRoutineBinding[],
  client: {
    implementationPath: Text,
    sourceDigest: Digest,
    totalDeadlineMs: 20000,
    scope: "one_operation_total"
  }
}
DeadlineRoutineBinding {
  routine: RoutineIdentity,
  sessionRole: Text,
  effectiveRole: Text,
  statementTimeout: {
    effectiveMs: UInt,
    source: "role" | "database" | "request" | "server",
    appliesBefore: "top_level_dispatch",
    configurationEvidence: RetainedBytes
  },
  lockTimeout: {
    effectiveMs: UInt,
    source: "function" | "role" | "database" | "request" | "server",
    appliesBefore: "blocking_acquisition",
    configurationEvidence: RetainedBytes
  }
}
```

Policy.lockTimeoutMs is in 1..2000 and equals the enclosing OperationLimits. Bindings contain exactly the fixed top-level capture/read/mutation operation-family routine signatures required by the independently admitted U04 implementation, once each in QName+ordered-argument-signature code-unit order. This includes the 26 readers and the already adopted capture/enqueue/seal/control/writer owners as applicable; it adds no RPC, routine, operation or arbitrary dispatch target. Routine names/signatures are evidence identities only. The producer/consumer's fixed implementation closure determines exact membership; a caller cannot supply a subset to omit a slower or differently configured operation.

Every binding must resolve to the exact corresponding captured routine definition and reviewed role/path mapping. Retain actual session and effective roles per routine: a SECURITY DEFINER owner is not assumed to be the session role or the capture producer's role. Match the admitted mapping for that signature; never infer privileges from a nonempty role string. Full routine definitions retain function-level settings and SECURITY INVOKER/DEFINER behavior. ConfigurationEvidence additionally retains the complete relevant role/database/request/server setting and role-switch evidence from the fixed supported collector. An empty or nonempty string by itself proves neither configuration nor absence of overrides. The collector's exact supported projection and source attribution must be independently admitted; arbitrary client assertions are insufficient.

Actual observed numeric values are retained unchanged, including zero or nonconforming values in an unsatisfied capture. For a conforming profile, statementTimeout.effectiveMs must equal 15000, and lockTimeout.effectiveMs must equal the positive policy.lockTimeoutMs. Validate native setting text/units losslessly against these values using the reviewed fixed producer mapping. Reject a mismatch; never rewrite actual facts to policy constants. Merely setting statement_timeout inside an already running RPC cannot satisfy appliesBefore=top_level_dispatch. Function-local lock_timeout before blocking acquisition is permitted. Every nested override in the captured dependency definitions must be accounted for by the review; a function/role change that invalidates the effective mapping invalidates admission.

The client path/digest must resolve to the enclosing complete allowed implementation manifest and the exact installed transport wrapper applying one 20000 ms total budget. This binds implementation/configuration only; it does not report a measured client duration. Do not add an environment lookup or permissive timeout default to the profile parser. Deployment and requestPathIdentity match the fixed captured target/path and external admission; a diagnostic-only path with different configuration cannot substitute.

The record is already inside native facts and contains no native-facts, capture, review, bundle, profile, origin or final-plan digest. The graph is acyclic. The original configurationEvidence bytes/lengths/digests are verified alongside the exact typed projection. A later separately authorized runtime witness may cite the completed native-facts digest, but no such witness is embedded here or required to construct the profile.

## Review, unavailable evidence and use

The existing SQL review area server_deadline covers this complete record, all associated effective operation settings, the applicable full routine/role override definitions and client implementation identity. The distinct technical reviewer and external controller admission bind the exact complete capture/bundle and actors. A satisfied label does not itself authorize use. Missing actual configuration, role/path mapping, original evidence, implementation closure or independent review is unavailable: retain a draft gap outside a conforming real profile and refuse operational admission before client construction. No null/default/verified boolean makes that evidence available. Mocked records exercise the same shape but are permanently refused for operational admission.

Separately authorized connected acceptance must establish actual effective deadlines, bounded worst-fixture/contention behavior, role/grants, transaction outcomes and no unsafe retry/reclaim behavior. Its method is chosen and admitted when that gate is undertaken. Candidate1's proposed diagnostics are optional design material only: four new RPCs, a gateway trace protocol, monotonic clock calibration and a fixed five-case run are not adopted mandatory infrastructure. A future executed method must retain failed/unknown outcomes and honestly report timing/cancellation/terminal limits; configuration evidence alone does not close that gate.

Post-dispatch HTTP timeout, abort or response loss remains outcome_unknown. Do not infer commit/rollback, automatically retry, reclaim the same candidate, delete artifacts or read receipts. Exact reconciliation/readback has its separate admission. No new implementation, SQL execution, worker, provider, migration, network fixture, telemetry service or privilege is authorized here.

## Focused local proof after adoption

Use complete synthetic native-facts/capture records with explicitly distinct mock producer/reviewer actors. Refuse unknown/missing keys, wrong target/path/deployment/role, missing or substituted routine bindings, unsafe or nonconforming timeout values, incompatible overrides, altered original evidence bytes and a client file outside the admitted manifest. Prove that statement configuration created only inside a running RPC is insufficient, while a correctly evidenced finite function-local lock timeout before acquisition is representable. Prove that absence of the unadopted five diagnostics does not prevent pure mocked parsing, and that mocked/missing-real-acceptance inputs cannot create operational clients. These tests establish parser/admission behavior only; no actual cancellation or database rollback is claimed.
