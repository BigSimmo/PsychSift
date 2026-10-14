import { createHash } from "node:crypto";
import {
  createDocumentIngressSafetyAuthority,
  ProviderEgressDeniedError,
  type ContentSha256,
  type DocumentIngressSafetyAuthority,
  type IngressHardGateReason,
  type ProviderEgressBinding,
  type ProviderEgressDenialCode,
  type ProviderEgressPermit,
  type ProviderEgressPurpose,
  // @ts-expect-error Deno requires explicit local extensions.
} from "./document-ingress-safety.ts";

declare const ingestionContextType: unique symbol;
/** Opaque attempt/operation identity; serialized or copied objects have no authority. */
export type IngestionProviderEgressContext = Readonly<{ [ingestionContextType]: true }>;
export type IngestionProviderEgressRequest = Readonly<{
  purpose: ProviderEgressPurpose;
  payloadSha256: ContentSha256;
  payload: string | Uint8Array;
  signal?: AbortSignal;
}>;
export type IngestionProviderEgressContextOptions = Readonly<{
  binding: ProviderEgressBinding;
  loadCurrent(request: IngestionProviderEgressRequest): Promise<{
    sourceBinding: ProviderEgressBinding;
    sourceObservations: unknown;
    observations: unknown;
  }>;
  permitTtlMs?: number;
  now?: () => number;
}>;

/** Deliberately contains only fixed denial/remediation codes, never source bytes. */
export class IngestionProviderEgressRefusal extends ProviderEgressDeniedError {
  readonly codes;
  readonly reasons: readonly IngressHardGateReason[];
  readonly actions;
  constructor(code: ProviderEgressDenialCode, reasons: readonly IngressHardGateReason[] = []) {
    super(code);
    this.name = "IngestionProviderEgressRefusal";
    const defaultReason: IngressHardGateReason =
      code === "provider_egress_binding_mismatch"
        ? { code: "binding_invalid", action: "reload_current_generation" }
        : code === "provider_egress_policy_evidence_mismatch"
          ? { code: "source_policy_mismatch", action: "refresh_source_policy" }
          : code === "provider_egress_purpose_mismatch"
            ? { code: "source_policy_mismatch", action: "review_source_eligibility" }
            : { code: "safety_observation_invalid", action: "repeat_safety_checks" };
    this.reasons = Object.freeze(
      (reasons.length ? reasons : [defaultReason]).map((reason) => Object.freeze({ ...reason })),
    );
    this.codes = Object.freeze(this.reasons.map((reason) => reason.code));
    this.actions = Object.freeze([...new Set(this.reasons.map((reason) => reason.action))]);
  }
}

type AttemptState = {
  binding: ProviderEgressBinding;
  loadCurrent: IngestionProviderEgressContextOptions["loadCurrent"];
  revoked: boolean;
  refusal?: IngestionProviderEgressRefusal;
  sourceEvidence?: string;
};
type ContextRecord = {
  attempt: AttemptState;
  authority: DocumentIngressSafetyAuthority;
  permits: Map<string, ProviderEgressPermit>;
  operation: boolean;
};
const contexts = new WeakMap<object, ContextRecord>();
const bindingKeys = [
  "admissionEventId",
  "documentId",
  "generationId",
  "jobId",
  "attemptId",
  "leaseId",
  "contentSha256",
  "authorityDigest",
] as const;

function sameBinding(actual: ProviderEgressBinding, expected: ProviderEgressBinding): boolean {
  return actual != null && bindingKeys.every((key) => actual[key] === expected[key]);
}

export function createIngestionProviderEgressContext(
  options: IngestionProviderEgressContextOptions,
): IngestionProviderEgressContext {
  const context = Object.freeze(Object.create(null)) as IngestionProviderEgressContext;
  contexts.set(context, {
    attempt: {
      binding: Object.freeze({ ...options.binding }),
      loadCurrent: options.loadCurrent,
      revoked: false,
    },
    authority: createDocumentIngressSafetyAuthority({ permitTtlMs: options.permitTtlMs ?? 30_000, now: options.now }),
    permits: new Map(),
    operation: false,
  });
  return context;
}

function recordFor(context: IngestionProviderEgressContext): ContextRecord {
  const record = contexts.get(context);
  if (!record) throw new IngestionProviderEgressRefusal("provider_egress_permit_invalid");
  if (record.attempt.refusal) throw record.attempt.refusal;
  if (record.attempt.revoked) throw new IngestionProviderEgressRefusal("provider_egress_permit_revoked");
  return record;
}

/** Start once per provider operation, never per retry. Fresh permits must still
 * match the attempt's pinned source evidence and shared terminal refusal state. */
export function createIngestionProviderEgressOperation(
  context: IngestionProviderEgressContext,
): IngestionProviderEgressContext {
  const parent = recordFor(context);
  // A preflight may already have supplied an operation context. Preserve that
  // lifetime when the SDK wrapper adopts it; nesting must not renew its permits.
  if (parent.operation) return context;
  const operation = Object.freeze(Object.create(null)) as IngestionProviderEgressContext;
  contexts.set(operation, {
    attempt: parent.attempt,
    authority: parent.authority,
    permits: new Map(),
    operation: true,
  });
  return operation;
}

/** Record a boundary refusal so concurrent siblings cannot continue the same context. */
export function denyIngestionProviderEgress(
  context: IngestionProviderEgressContext,
  code: ProviderEgressDenialCode,
): never {
  const record = recordFor(context);
  record.attempt.refusal ??= new IngestionProviderEgressRefusal(code);
  throw record.attempt.refusal;
}

export function revokeIngestionProviderEgressContext(context: IngestionProviderEgressContext): void {
  const record = contexts.get(context);
  if (!record) throw new IngestionProviderEgressRefusal("provider_egress_permit_invalid");
  record.attempt.revoked = true;
  record.attempt.refusal ??= new IngestionProviderEgressRefusal("provider_egress_permit_revoked");
  for (const permit of record.permits.values()) record.authority.revokePermit(permit);
}

export function assertIngestionProviderEgressContextActive(
  context: IngestionProviderEgressContext,
  signal?: AbortSignal,
): void {
  recordFor(context);
  signal?.throwIfAborted();
}

/** Reload trusted state for every dispatch/reuse. This adapter itself does not scan. */
export async function assertIngestionProviderEgress(
  context: IngestionProviderEgressContext,
  purpose: ProviderEgressPurpose,
  payload: string | Uint8Array,
  signal?: AbortSignal,
): Promise<void> {
  const record = recordFor(context);
  const attempt = record.attempt;
  signal?.throwIfAborted();
  try {
    const snapshot = typeof payload === "string" ? payload : new Uint8Array(payload);
    const payloadSha256: ContentSha256 = `sha256:${createHash("sha256").update(snapshot).digest("hex")}`;
    // The loader receives its own byte copy: mutating it cannot alter dispatch bytes.
    const current = await attempt.loadCurrent(
      Object.freeze({
        purpose,
        payloadSha256,
        payload: typeof snapshot === "string" ? snapshot : new Uint8Array(snapshot),
        ...(signal ? { signal } : {}),
      }),
    );
    assertIngestionProviderEgressContextActive(context, signal);
    if (!current || !sameBinding(current.sourceBinding, attempt.binding)) {
      throw new IngestionProviderEgressRefusal("provider_egress_binding_mismatch");
    }
    const sourceResult = record.authority.evaluate(current.sourceObservations);
    if (sourceResult.verdict !== "pass") {
      throw new IngestionProviderEgressRefusal("provider_egress_denied", sourceResult.reasons);
    }
    if (!sameBinding(sourceResult.binding, attempt.binding)) {
      throw new IngestionProviderEgressRefusal("provider_egress_binding_mismatch");
    }
    if (sourceResult.purpose !== purpose) throw new IngestionProviderEgressRefusal("provider_egress_purpose_mismatch");
    // Purpose changes across stages, but current raw-source safety and policy must stay pinned.
    const sourceEvidence = JSON.stringify({
      policyVersion: sourceResult.policyVersion,
      checks: sourceResult.checks.filter((check) => !check.startsWith("purpose:")),
    });
    if (attempt.sourceEvidence !== undefined && attempt.sourceEvidence !== sourceEvidence) {
      throw new IngestionProviderEgressRefusal("provider_egress_policy_evidence_mismatch");
    }
    attempt.sourceEvidence ??= sourceEvidence;
    const sourceKey = `source:${purpose}`;
    let sourcePermit = record.permits.get(sourceKey);
    if (!sourcePermit) {
      sourcePermit = record.authority.issuePermit(sourceResult, attempt.binding, purpose);
      record.permits.set(sourceKey, sourcePermit);
    }
    record.authority.assertPermit(sourcePermit, attempt.binding, purpose, sourceResult);
    const payloadBinding = Object.freeze({ ...attempt.binding, contentSha256: payloadSha256 });
    const result = record.authority.evaluate(current.observations);
    if (result.verdict !== "pass") {
      throw new IngestionProviderEgressRefusal("provider_egress_denied", result.reasons);
    }
    if (!sameBinding(result.binding, payloadBinding)) {
      throw new IngestionProviderEgressRefusal("provider_egress_binding_mismatch");
    }
    if (result.purpose !== purpose) throw new IngestionProviderEgressRefusal("provider_egress_purpose_mismatch");
    if (result.policyVersion !== sourceResult.policyVersion) {
      throw new IngestionProviderEgressRefusal("provider_egress_policy_evidence_mismatch");
    }
    try {
      const key = `${purpose}:${payloadSha256}`;
      let permit = record.permits.get(key);
      if (!permit) {
        permit = record.authority.issuePermit(result, payloadBinding, purpose);
        record.permits.set(key, permit);
      }
      // Existing permits never renew their TTL or silently adopt changed policy evidence.
      record.authority.assertPermit(permit, payloadBinding, purpose, result);
    } catch (error) {
      if (error instanceof ProviderEgressDeniedError) throw new IngestionProviderEgressRefusal(error.code);
      throw error;
    }
    assertIngestionProviderEgressContextActive(context, signal);
  } catch (error) {
    if (error instanceof ProviderEgressDeniedError) {
      attempt.refusal ??=
        error instanceof IngestionProviderEgressRefusal ? error : new IngestionProviderEgressRefusal(error.code);
      throw attempt.refusal;
    }
    if (attempt.refusal) throw attempt.refusal;
    signal?.throwIfAborted();
    attempt.refusal ??= new IngestionProviderEgressRefusal("provider_egress_denied", [
      { code: "scanner_unavailable", action: "repeat_safety_checks" },
    ]);
    throw attempt.refusal;
  }
}
