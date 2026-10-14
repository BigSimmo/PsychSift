import { createHash } from "node:crypto";
import { types } from "node:util";
import { z } from "zod";
import {
  assertIndexableCatalogueEntry,
  australianSourceByKey,
  australianSourcePolicyVersion,
} from "../src/lib/australian-source-catalogue";
import { identifierShapeWarning } from "../src/lib/clinical-ask/context";
import { classifySourceAuthority } from "../src/lib/source-authority-registry";
import type {
  ContentSha256,
  DocumentIngressSafetyObservations,
  ProviderEgressBinding,
} from "../src/lib/document-ingress-safety";
import type { IngestionProviderEgressRequest } from "../src/lib/ingestion-provider-egress";
import { IngestionAttempt, parseIngestionFence } from "../supabase/functions/_shared/ingestion-attempt";
import { forbiddenPublicSourceIdentity } from "../supabase/functions/_shared/public-source-policy";
import { scanWindowsDefenderBytes, type WindowsMalwareInspectionConfiguration } from "./malware-inspection";
import { scanClamAvBytes, type ClamAvInspectionConfiguration } from "./clamav-inspection";
import { parseWorkerProviderAuthorityFacts, type WorkerProviderAuthorityFacts } from "./provider-egress";
import type { ManagedProviderEmbeddingRequestContext } from "./managed-provider-vectors";

/** A deliberately bounded first adapter, not a PDF or general document inspector. */
export const ADMIN_TEXT_INSPECTION_MAX_BYTES = 2 * 1024 * 1024;
export const ADMIN_NATIVE_PDF_INSPECTION_POLICY_VERSION = `admin-reference-four-page-native-pdf-text-exposure-v1:${australianSourcePolicyVersion}:identifier-shape-warning-v1:labelled-isbn13-v1`;
export const ADMIN_TEXT_INSPECTION_POLICY_VERSION = `admin-reference-utf8-text-v1:${australianSourcePolicyVersion}:identifier-shape-warning-v1:labelled-isbn13-v1`;
export class AdminTextInspectionRefusal extends Error {
  constructor(readonly code: string) {
    super(`admin_text_inspection_${code}`);
    this.name = "AdminTextInspectionRefusal";
  }
}
const refuse = (code: string): never => {
  throw new AdminTextInspectionRefusal(code);
};
const hash = (bytes: Uint8Array | string): ContentSha256 =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
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
const sameBinding = (a: ProviderEgressBinding, b: ProviderEgressBinding) =>
  a != null && bindingKeys.every((key) => a[key] === b[key]);
function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}
const arrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const bufferGetter = Object.getOwnPropertyDescriptor(arrayPrototype, "buffer")!.get!;
const offsetGetter = Object.getOwnPropertyDescriptor(arrayPrototype, "byteOffset")!.get!;
const lengthGetter = Object.getOwnPropertyDescriptor(arrayPrototype, "byteLength")!.get!;
function copyBytes(value: Uint8Array, maximum = ADMIN_TEXT_INSPECTION_MAX_BYTES): Uint8Array {
  if (types.isProxy(value) || !types.isUint8Array(value)) return refuse("source_bytes_invalid");
  const buffer = Reflect.apply(bufferGetter, value, []) as ArrayBuffer;
  const offset = Reflect.apply(offsetGetter, value, []) as number;
  const length = Reflect.apply(lengthGetter, value, []) as number;
  if (types.isSharedArrayBuffer(buffer) || length < 1 || length > maximum) return refuse("source_size_invalid");
  return new Uint8Array(new Uint8Array(buffer, offset, length));
}
function utf8(bytes: Uint8Array): string {
  try {
    // Preserve the BOM so no byte is silently removed from inspection.
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    if (!Buffer.from(text, "utf8").equals(Buffer.from(bytes))) return refuse("utf8_invalid");
    return text;
  } catch {
    return refuse("utf8_invalid");
  }
}
function assertInertText(text: string): void {
  // Tabs and line breaks are the only accepted controls. Formatting/bidi/zero-width
  // characters and binary/container signatures are outside this plain-text subset.
  if (
    !text.trim() ||
    /[\p{Cc}\p{Cf}]/u.test(text.replace(/[\t\r\n]/g, "")) ||
    /^\s*(?:%PDF-|PK\x03\x04|MZ|\{\\rtf|#!)/.test(text) ||
    /<\/?[A-Za-z!][^>]*>/.test(text)
  )
    refuse("source_not_inert_plain_text");
}
function bibliographicIdentifierAssessment(text: string): string {
  // Only this public-reference adapter exempts explicitly labelled ISBN-13s.
  // Keep exact character offsets for source slices; never alter inspected bytes.
  return text.replace(
    /\bISBN(?:-13)?(?:[ \t]+Online)?[ \t]*:[ \t\r\n]*(97[89]-[0-9]{1,5}-[0-9]{1,7}-[0-9]{1,7}-[0-9]|97[89] [0-9]{1,5} [0-9]{1,7} [0-9]{1,7} [0-9]|97[89][0-9]{10})(?![A-Za-z0-9-]|[ \t]+[0-9])/g,
    (labelled: string, number: string) => {
      const digits = number.replace(/[- ]/g, "");
      if (digits.length !== 13) return labelled;
      const sum = [...digits].reduce((total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 1 : 3), 0);
      if (sum % 10 !== 0) return labelled;
      return labelled.slice(0, labelled.length - number.length) + number.replace(/[0-9]/g, " ");
    },
  );
}
function inspectIdentifiers(text: string, assessment = bibliographicIdentifierAssessment(text)): void {
  // A negative result means only that these existing identifier shapes were not
  // detected in the entire bounded text. It is not proof of perfect PHI absence.
  if (identifierShapeWarning(assessment)) refuse("identifier_shape_detected");
  if (forbiddenPublicSourceIdentity(text)) refuse("protected_source_identity");
}
const embeddingBody = z
  .object({
    model: z.literal("text-embedding-3-small"),
    dimensions: z.literal(1536),
    encoding_format: z.enum(["base64", "float"]).optional(),
    input: z.array(z.string().min(1).max(100000)).min(1).max(128),
  })
  .strict();

export type AdminTextCurrentFacts = Readonly<{
  /** Fresh authority returned by the existing fenced inventory read, not metadata. */
  facts: Readonly<WorkerProviderAuthorityFacts>;
  binding: ProviderEgressBinding;
  /** Server-owned current catalogue identity for this admitted document. */
  catalogueKey: string;
  /** Actual freshly loaded document metadata, matched to the same source binding. */
  sourceMetadata: Readonly<Record<string, unknown>>;
  /** Existing observation contract from a trusted current admin-grant supplier.
   * Admission's declared rights (currentRightsEvidence: unavailable) cannot supply
   * these verdicts by themselves. There is deliberately no default producer. */
  policyObservations: Pick<
    DocumentIngressSafetyObservations,
    | "binding"
    | "policyVersion"
    | "purpose"
    | "admission"
    | "ownerScope"
    | "rights"
    | "purposeClearance"
    | "source"
    | "indexLicence"
    | "sourcePolicy"
  >;
  sourceBytes: Uint8Array;
  /** Server-owned exact-pilot review; no document metadata or caller booleans. */
  nativePdf?: Readonly<{
    recordSha256: string;
    record: Readonly<Record<string, unknown>>;
    pageTexts: readonly string[];
  }>;
}>;
export type AdminTextScannerConfiguration =
  | WindowsMalwareInspectionConfiguration
  | Readonly<{
      backend: "clamav";
      configuration: ClamAvInspectionConfiguration;
    }>;

function snapshotScanner(supplied: AdminTextScannerConfiguration, contentSha256: ContentSha256) {
  if (!supplied || typeof supplied !== "object") return refuse("scanner_configuration_invalid");
  if ("backend" in supplied) {
    if (supplied.backend !== "clamav") return refuse("scanner_configuration_invalid");
    const value = supplied.configuration;
    if (
      !value ||
      !value.scanner ||
      typeof value.scanner.path !== "string" ||
      typeof value.scanner.sha256 !== "string" ||
      typeof value.databaseDirectory !== "string" ||
      !Array.isArray(value.databases) ||
      value.databases.some((entry) => !entry || typeof entry.name !== "string" || typeof entry.sha256 !== "string") ||
      typeof value.version !== "string" ||
      !Number.isSafeInteger(value.signaturesUpdatedAtMs) ||
      !Number.isInteger(value.maxSignatureAgeDays) ||
      !Number.isInteger(value.timeoutMs)
    )
      return refuse("scanner_configuration_invalid");
    return Object.freeze({
      backend: "clamav" as const,
      configuration: Object.freeze({
        ...value,
        scanner: Object.freeze({ ...value.scanner }),
        databases: Object.freeze(value.databases.map((entry) => Object.freeze({ ...entry }))),
      }),
    });
  }
  if (
    supplied.cloudAuthorisation?.contentSha256 !== contentSha256 ||
    typeof supplied.cloudAuthorisation?.reference !== "string" ||
    !supplied.cloudAuthorisation.reference.trim()
  )
    return refuse("scanner_cloud_authorisation_missing");
  return Object.freeze({
    backend: "windows-defender" as const,
    configuration: Object.freeze({
      ...supplied,
      scanner: Object.freeze({ ...supplied.scanner }),
      statusReader: Object.freeze({ ...supplied.statusReader }),
      cloudAuthorisation: Object.freeze({ ...supplied.cloudAuthorisation }),
    }),
  });
}

export type AdminTextInspectionOptions = Readonly<{
  attempt: IngestionAttempt;
  /** Captured from the current worker document, never an end-user request. */
  ownerId: string;
  /** Bounds even a supplier that does not itself respond to cancellation. */
  timeoutMs?: number;
  /** Actual selected SDK batch from the existing checked managed producer. */
  nativePdfBatch?: ManagedProviderEmbeddingRequestContext;
  loadCurrent: (
    request: IngestionProviderEgressRequest,
    binding: Readonly<ProviderEgressBinding>,
  ) => Promise<AdminTextCurrentFacts>;
  /** Server-owned backend pins; Windows additionally needs exact-byte cloud authorisation. */
  loadScannerConfiguration: (
    args: Readonly<{
      request: IngestionProviderEgressRequest;
      binding: Readonly<ProviderEgressBinding>;
      contentSha256: ContentSha256;
      phase: "source" | "payload";
    }>,
  ) => Promise<AdminTextScannerConfiguration>;
}>;

/**
 * Server-owned observations loader for createWorkerProviderEgressContext's third
 * argument. No default wiring, permissions resolver, scanner cache or caller
 * approval flags. Admission declarations establish attributable identity, not
 * current rights. An operative current admin grant must be independently supplied
 * using the existing policy-observation contract before this component is wired.
 */
export function createAdminTextInspectionLoader(options: AdminTextInspectionOptions) {
  const attempt = options.attempt;
  const ownerId = options.ownerId;
  const loadCurrent = options.loadCurrent;
  const loadScannerConfiguration = options.loadScannerConfiguration;
  const timeoutMs = options.timeoutMs ?? 300000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 300000) refuse("timeout_invalid");
  const nativeBatch =
    options.nativePdfBatch === undefined
      ? undefined
      : (JSON.parse(JSON.stringify(options.nativePdfBatch)) as ManagedProviderEmbeddingRequestContext);
  let failed = false;
  return async (originalRequest: IngestionProviderEgressRequest, originalBinding: Readonly<ProviderEgressBinding>) => {
    const binding = Object.freeze({ ...originalBinding });
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(new AdminTextInspectionRefusal("inspection_timeout")), timeoutMs);
    const signal = originalRequest.signal
      ? AbortSignal.any([originalRequest.signal, attempt.signal, deadline.signal])
      : AbortSignal.any([attempt.signal, deadline.signal]);
    const request = Object.freeze({ ...originalRequest, signal });
    const active = () => {
      if (failed) refuse("context_refused");
      attempt.check();
      signal.throwIfAborted();
      if (
        !sameBinding(originalBinding, binding) ||
        originalRequest.payload !== request.payload ||
        originalRequest.payloadSha256 !== request.payloadSha256 ||
        originalRequest.purpose !== request.purpose
      )
        refuse("request_changed");
    };
    try {
      active();
      if (request.purpose !== "embedding" || typeof request.payload !== "string") {
        return refuse("payload_format_unsupported");
      }
      const payloadText = request.payload;
      if (payloadText.length < 1 || payloadText.length > ADMIN_TEXT_INSPECTION_MAX_BYTES)
        refuse("payload_size_invalid");
      const payload = Buffer.from(payloadText, "utf8");
      if (payload.length > ADMIN_TEXT_INSPECTION_MAX_BYTES || utf8(payload) !== payloadText)
        refuse("payload_utf8_invalid");
      if (hash(payload) !== request.payloadSha256) refuse("payload_hash_mismatch");
      let body: z.infer<typeof embeddingBody>;
      try {
        const parsed: unknown = JSON.parse(payloadText);
        // The supported worker wire format is JSON.stringify output. Check before
        // schema normalization: JSON.parse would otherwise discard duplicate keys
        // whose earlier values still occur in the transmitted bytes.
        if (JSON.stringify(parsed) !== payloadText) refuse("payload_format_unsupported");
        body = embeddingBody.parse(parsed);
      } catch {
        return refuse("payload_format_unsupported");
      }
      for (const input of body.input) {
        if (utf8(Buffer.from(input, "utf8")) !== input) refuse("payload_utf8_invalid");
        assertInertText(input);
      }
      const fence = parseIngestionFence(attempt.fence);
      let identity: string | undefined;
      let source: Uint8Array | undefined;
      let scannerPins: string | undefined;
      let currentPolicy: AdminTextCurrentFacts["policyObservations"] | undefined;
      let policyVersion: string | undefined;
      const current = async () => {
        active();
        if (JSON.stringify(attempt.fence) !== JSON.stringify(fence)) refuse("fence_changed");
        const value = await abortable(loadCurrent(request, binding), signal);
        active();
        if (JSON.stringify(attempt.fence) !== JSON.stringify(fence) || !sameBinding(value?.binding, binding))
          refuse("binding_mismatch");
        const facts = parseWorkerProviderAuthorityFacts(
          { ok: true, providerAuthority: value.facts },
          fence,
          binding.generationId,
          binding,
        );
        const declared = facts.declaredAuthority;
        if (
          typeof ownerId !== "string" ||
          !ownerId ||
          facts.ownerId !== ownerId ||
          declared.authorityBasis !== "administrator_template" ||
          declared.licencePolicy !== "public_index_permitted" ||
          declared.providerProcessing !== "permitted" ||
          declared.currentness !== "current" ||
          declared.supportedFeatures.join() !== "text"
        )
          refuse("current_admin_permissions_unavailable");
        const today = new Date().toISOString().slice(0, 10);
        if (
          (declared.effectiveDate !== null && declared.effectiveDate > today) ||
          (declared.expiryDate !== null && declared.expiryDate <= today) ||
          (declared.reviewDate !== null && declared.reviewDate <= today)
        )
          refuse("authority_not_current");
        const nativePdf = facts.mimeType === "application/pdf";
        if (nativePdf) {
          const review = value.nativePdf;
          const record = review?.record;
          if (
            !nativeBatch ||
            !review ||
            !record ||
            facts.sourceByteLength !== 2211561 ||
            binding.contentSha256 !== "sha256:abbc8107a09582e18f36bf4905c75f1fc78af70cd516851b89bff8919ca5bece" ||
            record.version !== "nhmrc-four-page-native-pdf-source-inspection-v1" ||
            record.scope !== "exact_four_page_native_pdf_source_and_text_embedding_only" ||
            record.activeContent !== "absent" ||
            record.identifiers !== "runtime_check_required" ||
            record.hiddenText !== "consistent" ||
            typeof record.expiresAt !== "string" ||
            !Number.isFinite(Date.parse(record.expiresAt)) ||
            Date.parse(record.expiresAt) <= Date.now() ||
            !sameBinding(record.binding as ProviderEgressBinding, binding) ||
            !/^sha256:[0-9a-f]{64}$/.test(review.recordSha256) ||
            review.pageTexts.length !== 4 ||
            review.pageTexts.some((text) => typeof text !== "string" || !text) ||
            !/^sha256:[0-9a-f]{64}$/.test(nativeBatch.planDigest) ||
            nativeBatch.inputs.length !== body.input.length ||
            nativeBatch.inputs.some(
              (item, index) =>
                item.providerInputText !== body.input[index] ||
                !item.sourceUnitIds.length ||
                item.sourceUnitIds.some((unit) => unit.family !== "chunks" || !/^[0-9a-f-]{36}$/i.test(unit.key)),
            ) ||
            JSON.stringify(nativeBatch) !== JSON.stringify(options.nativePdfBatch)
          )
            refuse("current_native_pdf_inspection_unavailable");
        } else if (facts.mimeType !== "text/plain" || nativeBatch !== undefined) {
          refuse("source_format_unsupported");
        }
        const entry = australianSourceByKey(value.catalogueKey);
        try {
          assertIndexableCatalogueEntry(entry);
        } catch {
          return refuse("catalogue_not_eligible");
        }
        // The first supported subset is national. A declaration whose jurisdiction
        // is only Australia cannot prove state-specific catalogue compatibility.
        const metadata = value.sourceMetadata;
        const draft = metadata?.corpus_scope === "uploaded_local";
        if (
          entry.jurisdiction !== "Australia" ||
          !metadata ||
          metadata.publisher !== declared.publisher ||
          metadata.jurisdiction !== declared.jurisdiction ||
          metadata.source_role !== declared.sourceRole ||
          // Admission stores an owner-bound draft as uploaded_local before any
          // publication. Current processing permission is established separately
          // by the fenced administrator facts and operative grant below; this
          // inspection does not make that draft eligible for the public corpus.
          (metadata.corpus_scope !== "uploaded_local" && metadata.corpus_scope !== entry.corpusScope) ||
          metadata.content_mode !== entry.contentMode ||
          metadata.licence_policy !== declared.licencePolicy ||
          metadata.document_status !== declared.currentness ||
          entry.publisher !== declared.publisher ||
          !entry.roles.includes(declared.sourceRole)
        )
          refuse("catalogue_authority_mismatch");
        if (draft) {
          // Admission deliberately strips public-catalogue metadata and injects
          // publisher_code:null. Bind its actual owner-bound authority to the
          // server-owned catalogue selection without projecting public metadata.
          // New trusted admissions emit document; historical admissions may omit
          // source_kind. No other supplied kind establishes this draft contract.
          const authority = metadata.authority;
          if (
            metadata.publisher_code !== null ||
            (metadata.source_kind !== undefined && metadata.source_kind !== "document") ||
            metadata.source_catalogue_key !== undefined ||
            metadata.source_policy_version !== undefined ||
            metadata.authority_basis !== declared.authorityBasis ||
            metadata.rights_evidence_ref !== declared.rightsEvidenceRef ||
            metadata.admission_event_id !== binding.admissionEventId ||
            metadata.admission_policy_version !== facts.admissionPolicyVersion ||
            metadata.content_hash !== binding.contentSha256.slice(7) ||
            !authority ||
            typeof authority !== "object" ||
            Array.isArray(authority) ||
            Object.keys(authority).length !== Object.keys(declared).length ||
            Object.entries(declared).some(
              ([key, value]) => JSON.stringify((authority as Record<string, unknown>)[key]) !== JSON.stringify(value),
            )
          )
            refuse("catalogue_authority_mismatch");
        } else {
          const classification = classifySourceAuthority(metadata);
          if (
            metadata.source_kind !== "document" ||
            metadata.source_catalogue_key !== value.catalogueKey ||
            metadata.publisher_code !== entry.publisherCode ||
            metadata.source_policy_version !== australianSourcePolicyVersion ||
            !classification.cataloguePolicyResolved ||
            classification.conflict ||
            classification.catalogueEntry?.key !== entry.key
          )
            refuse("catalogue_authority_mismatch");
        }
        const policy = value.policyObservations;
        if (
          !policy ||
          !sameBinding(policy.binding, binding) ||
          policy.purpose !== request.purpose ||
          typeof policy.policyVersion !== "string" ||
          !policy.policyVersion.trim() ||
          policy.policyVersion.length > 500 ||
          policy.policyVersion.trim() === "unverified" ||
          policy.admission !== "current" ||
          policy.ownerScope !== "permitted" ||
          policy.rights !== "permitted" ||
          policy.purposeClearance !== "permitted" ||
          policy.source !== "eligible" ||
          policy.indexLicence !== "permitted" ||
          policy.sourcePolicy !== "matched"
        )
          refuse("current_processing_policy_unavailable");
        const bytes = copyBytes(value.sourceBytes, nativePdf ? 2211561 : ADMIN_TEXT_INSPECTION_MAX_BYTES);
        if (facts.sourceByteLength !== bytes.length || hash(bytes) !== binding.contentSha256)
          refuse("source_binding_mismatch");
        const texts = nativePdf ? [...value.nativePdf!.pageTexts] : [utf8(bytes)];
        if (nativePdf && !Buffer.from(bytes.subarray(0, 5)).equals(Buffer.from("%PDF-")))
          refuse("source_format_unsupported");
        for (const text of texts) {
          assertInertText(text);
          inspectIdentifiers(text, bibliographicIdentifierAssessment(text));
        }
        if (nativePdf) {
          const joined = texts.join("\n\n");
          assertInertText(joined);
          inspectIdentifiers(joined, bibliographicIdentifierAssessment(joined));
        }
        const assessedInputs = body.input.map((input) => {
          const text = texts.find((text) => (nativePdf ? text === input : text.includes(input)));
          if (text === undefined) {
            inspectIdentifiers(input);
            return refuse("payload_not_source_derived");
          }
          const offset = text.indexOf(input);
          const assessedInput = bibliographicIdentifierAssessment(text).slice(offset, offset + input.length);
          inspectIdentifiers(input, assessedInput);
          return assessedInput;
        });
        // Canonical wire/schema checks above run on untouched payloadText. Assess
        // its JSON envelope with only source-validated ISBN digits masked, including
        // escaped newlines and ISBNs whose labels lie outside an input slice.
        inspectIdentifiers(payloadText, JSON.stringify({ ...JSON.parse(payloadText), input: assessedInputs }));
        const observed = JSON.stringify({
          facts,
          binding: value.binding,
          catalogueKey: value.catalogueKey,
          entry,
          metadata,
          policy,
          ...(nativePdf ? { nativePdf: value.nativePdf, nativeBatch } : {}),
        });
        if (identity !== undefined && identity !== observed) refuse("current_authority_changed");
        identity = observed;
        currentPolicy = Object.freeze({ ...policy, binding: Object.freeze({ ...policy.binding }) });
        // Binds the trusted current grant verdict and declared rightsEvidenceRef to
        // exact current owner/document/source/admission/fence/catalogue provenance.
        // Source permits bind the full current review and plan, while each SDK batch
        // retains its separate full mutation, page/input/unit and payload scan checks.
        const sourcePolicyEvidence = nativePdf
          ? JSON.stringify({ ...JSON.parse(observed), nativeBatch: { planDigest: nativeBatch!.planDigest } })
          : observed;
        policyVersion = `${nativePdf ? ADMIN_NATIVE_PDF_INSPECTION_POLICY_VERSION : ADMIN_TEXT_INSPECTION_POLICY_VERSION}:${hash(sourcePolicyEvidence)}`;
        source ??= bytes;
        active();
        return bytes;
      };
      await current();
      const scan = async (bytes: Uint8Array, contentSha256: ContentSha256, phase: "source" | "payload") => {
        await current();
        const args = Object.freeze({ request, binding, contentSha256, phase });
        const supplied = await abortable(loadScannerConfiguration(args), signal);
        active();
        const scanner = snapshotScanner(supplied, contentSha256);
        // Cross-phase pins include every backend setting. Windows' exact-byte cloud
        // grant necessarily differs between source/payload; each phase checks it in full.
        const pins = JSON.stringify(
          scanner.backend === "clamav"
            ? scanner
            : {
                ...scanner,
                configuration: { ...scanner.configuration, cloudAuthorisation: undefined },
              },
        );
        if (scannerPins !== undefined && scannerPins !== pins) refuse("scanner_configuration_changed");
        scannerPins = pins;
        await current();
        const inspected = new Uint8Array(bytes);
        const result =
          scanner.backend === "clamav"
            ? await scanClamAvBytes({
                bytes: inspected,
                expectedSha256: contentSha256,
                config: scanner.configuration,
                signal,
              })
            : await scanWindowsDefenderBytes({
                bytes: inspected,
                expectedSha256: contentSha256,
                config: scanner.configuration,
                signal,
              });
        active();
        if (
          hash(inspected) !== contentSha256 ||
          result.verdict !== "clean" ||
          result.contentSha256 !== contentSha256 ||
          typeof result.scannerVersion !== "string" ||
          !result.scannerVersion.trim()
        )
          refuse("scanner_result_invalid");
        await current();
        const after = await abortable(loadScannerConfiguration(args), signal);
        active();
        if (JSON.stringify(snapshotScanner(after, contentSha256)) !== JSON.stringify(scanner))
          refuse("scanner_configuration_changed");
        return Object.freeze({ ...result });
      };
      const sourceScanner = await scan(source!, binding.contentSha256, "source");
      const payloadScanner = await scan(payload, request.payloadSha256, "payload");
      await current();
      const observations = (
        contentSha256: ContentSha256,
        scanner: DocumentIngressSafetyObservations["scanner"],
        originalSource = false,
      ): DocumentIngressSafetyObservations =>
        Object.freeze({
          binding: Object.freeze({ ...binding, contentSha256 }),
          policyVersion: policyVersion!,
          purpose: request.purpose,
          admission: currentPolicy!.admission,
          ownerScope: currentPolicy!.ownerScope,
          rights: currentPolicy!.rights,
          purposeClearance: currentPolicy!.purposeClearance,
          scanner,
          activeContent: "absent",
          identifiers: "absent",
          hiddenText: originalSource && nativeBatch !== undefined ? "consistent" : "not_applicable",
          encryption: "not_encrypted",
          source: currentPolicy!.source,
          indexLicence: currentPolicy!.indexLicence,
          sourcePolicy: currentPolicy!.sourcePolicy,
        });
      active();
      return Object.freeze({
        sourceObservations: observations(binding.contentSha256, sourceScanner, true),
        observations: observations(request.payloadSha256, payloadScanner),
      });
    } catch (error) {
      failed = true;
      signal.throwIfAborted();
      throw error;
    } finally {
      clearTimeout(timer);
    }
  };
}
