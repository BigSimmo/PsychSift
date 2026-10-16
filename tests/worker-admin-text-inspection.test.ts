import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ContentSha256 } from "../src/lib/document-ingress-safety";
import { evaluateDocumentIngressSafety } from "../src/lib/document-ingress-safety";
import { classifySourceAuthority } from "../src/lib/source-authority-registry";
import { identifierShapeWarning } from "../src/lib/clinical-ask/context";
import {
  assertIngestionProviderEgress,
  type IngestionProviderEgressRequest,
} from "../src/lib/ingestion-provider-egress";
import { IngestionAttempt } from "../supabase/functions/_shared/ingestion-attempt";
import {
  ADMIN_TEXT_INSPECTION_MAX_BYTES,
  createAdminTextInspectionLoader,
  type AdminTextCurrentFacts,
  type AdminTextScannerConfiguration,
} from "../worker/admin-text-inspection";
import { scanWindowsDefenderBytes, type WindowsMalwareInspectionConfiguration } from "../worker/malware-inspection";
import { scanClamAvBytes, type ClamAvInspectionConfiguration } from "../worker/clamav-inspection";
import { createWorkerProviderEgressContext, workerProviderSourceBinding } from "../worker/provider-egress";
import type { JobRow } from "../worker/types";

vi.mock("../worker/malware-inspection", async (original) => ({
  ...(await original<typeof import("../worker/malware-inspection")>()),
  scanWindowsDefenderBytes: vi.fn(),
}));
vi.mock("../worker/clamav-inspection", async (original) => ({
  ...(await original<typeof import("../worker/clamav-inspection")>()),
  scanClamAvBytes: vi.fn(),
}));
const scan = vi.mocked(scanWindowsDefenderBytes);
const clamScan = vi.mocked(scanClamAvBytes);
const hash = (value: string | Uint8Array): ContentSha256 =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
const uuid = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const sourceText = "Synthetic public reference guidance.\nUse the current local service pathway.\n";
const payloadFor = (input: string[] = ["Use the current local service pathway."]) =>
  JSON.stringify({
    model: "text-embedding-3-small",
    dimensions: 1536,
    input,
    encoding_format: "base64",
  });

function setup(sourceBytes: Uint8Array = Buffer.from(sourceText)) {
  const job: JobRow = {
    locked_by: "synthetic-worker",
    lease_token: uuid(4),
    lease_expected_generation_id: null,
    lease_write_generation_id: uuid(3),
    lease_authority_digest: hash("synthetic-admitted-authority"),
    lease_expires_at: "2099-01-01T00:00:00Z",
    lease_duration_seconds: 300,
    id: uuid(2),
    document_id: uuid(1),
    batch_id: null,
    attempt_count: 1,
    max_attempts: 3,
    documents: {
      id: uuid(1),
      owner_id: uuid(5),
      title: "Synthetic reference",
      file_name: "reference.txt",
      file_type: "text/plain",
      storage_path: "synthetic/reference.txt",
      content_hash: hash(sourceBytes).slice(7),
      metadata: { admission_event_id: uuid(6) },
    },
  };
  const binding = workerProviderSourceBinding(job, job.documents);
  const attempt = new IngestionAttempt({
    job_kind: "node",
    job_id: job.id,
    document_id: job.document_id,
    worker_id: job.locked_by,
    lease_token: job.lease_token,
    expected_generation_id: null,
    authority_digest: job.lease_authority_digest,
  });
  const current: AdminTextCurrentFacts = {
    binding,
    catalogueKey: "tga",
    sourceBytes,
    sourceMetadata: {
      source_kind: "document",
      source_catalogue_key: "tga",
      publisher_code: "TGA",
      publisher: "Therapeutic Goods Administration",
      jurisdiction: "Australia",
      source_role: "regulatory",
      corpus_scope: "australian_public",
      content_mode: "indexed_content",
      source_policy_version: "australian-source-policy-v1",
      licence_policy: "public_index_permitted",
      document_status: "current",
    },
    // Synthetic current server-owned admin grant, distinct from the inventory's
    // unavailable rights evidence. There is no runtime grant producer in this fixture.
    policyObservations: {
      binding,
      policyVersion: "synthetic-operative-admin-grant-v1",
      purpose: "embedding",
      admission: "current",
      ownerScope: "permitted",
      rights: "permitted",
      purposeClearance: "permitted",
      source: "eligible",
      indexLicence: "permitted",
      sourcePolicy: "matched",
    },
    facts: {
      version: "ingestion-provider-authority-facts-v1",
      status: "observed",
      documentId: job.document_id,
      ownerId: uuid(5),
      jobKind: "node",
      jobId: job.id,
      generationId: uuid(3),
      expectedGenerationId: null,
      authorityDigest: binding.authorityDigest,
      sourceSha256: binding.contentSha256,
      sourceByteLength: sourceBytes.length,
      mimeType: "text/plain",
      fileNameSha256: hash("reference.txt"),
      storagePathSha256: hash("synthetic/reference.txt"),
      admissionEventId: uuid(6),
      admissionPolicyVersion: "trusted-document-admission-v1",
      admissionDigest: hash("synthetic admission"),
      currentRightsEvidence: "unavailable",
      safetyEvidence: "unavailable",
      declaredAuthority: {
        version: 1,
        sourceRole: "regulatory",
        authorityBasis: "administrator_template",
        licencePolicy: "public_index_permitted",
        rightsEvidenceRef: "synthetic administrator declaration",
        publisher: "Therapeutic Goods Administration",
        jurisdiction: "Australia",
        publicationDate: null,
        effectiveDate: null,
        reviewDate: null,
        expiryDate: null,
        currentness: "current",
        supersedesDocumentId: null,
        purpose: "clinical_retrieval",
        supportedFeatures: ["text"],
        providerProcessing: "permitted",
      },
    },
  };
  const loadCurrent = vi.fn(async () => current);
  const loadScannerConfiguration = vi.fn(
    async ({ contentSha256 }: { contentSha256: ContentSha256 }): Promise<WindowsMalwareInspectionConfiguration> => ({
      scanner: { path: "C:\\synthetic\\MpCmdRun.exe", sha256: hash("synthetic scanner") },
      statusReader: { path: "C:\\synthetic\\powershell.exe", sha256: hash("synthetic status reader") },
      signatureVersion: "1.2.3",
      engineVersion: "1.2.3",
      productVersion: "1.2.3",
      maxSignatureAgeDays: 1,
      timeoutMs: 1000,
      cloudAuthorisation: { contentSha256, reference: `synthetic authorised bytes ${contentSha256}` },
    }),
  );
  const loader = createAdminTextInspectionLoader({ attempt, ownerId: uuid(5), loadCurrent, loadScannerConfiguration });
  const payload = payloadFor();
  const request: IngestionProviderEgressRequest = { purpose: "embedding", payload, payloadSha256: hash(payload) };
  return { job, binding, attempt, current, loadCurrent, loadScannerConfiguration, loader, payload, request };
}

beforeEach(() => {
  scan.mockReset();
  clamScan.mockReset();
  // Offline scanner boundary only; these synthetic results never establish real clearance.
  scan.mockImplementation(async ({ expectedSha256 }) => ({
    verdict: "clean",
    scannerVersion: "WindowsDefender:1.2.3/1.2.3/1.2.3",
    contentSha256: expectedSha256,
  }));
  clamScan.mockImplementation(async ({ expectedSha256 }) => ({
    verdict: "clean",
    scannerVersion: "ClamAV synthetic mocked scanner",
    contentSha256: expectedSha256,
  }));
});

function setupClamAv() {
  const f = setup();
  const configuration: ClamAvInspectionConfiguration = {
    scanner: { path: "/usr/bin/clamscan", sha256: hash("synthetic Linux executable") },
    databaseDirectory: "/synthetic/signatures",
    databases: ["main.cvd", "daily.cld", "bytecode.cvd"].map((name) => ({ name, sha256: hash(name) })),
    version: "ClamAV 1.4.3/27800/Tue Oct 6 01:00:00 2026",
    signaturesUpdatedAtMs: Date.now(),
    maxSignatureAgeDays: 1,
    timeoutMs: 1000,
  };
  const supplied: AdminTextScannerConfiguration = { backend: "clamav", configuration };
  const loadScannerConfiguration = vi.fn(async (): Promise<AdminTextScannerConfiguration> => supplied);
  const loader = createAdminTextInspectionLoader({
    attempt: f.attempt,
    ownerId: uuid(5),
    loadCurrent: f.loadCurrent,
    loadScannerConfiguration,
  });
  return { ...f, configuration, supplied, loadScannerConfiguration, loader };
}

function admittedDraft(f: ReturnType<typeof setup>) {
  // Actual new admission emits source_kind:document, strips catalogue-only
  // input fields and injects the bound authority/admission identity below.
  const metadata: Record<string, unknown> = { ...f.current.sourceMetadata };
  for (const key of ["source_catalogue_key", "source_policy_version"]) delete metadata[key];
  Object.assign(metadata, {
    corpus_scope: "uploaded_local",
    publisher_code: null,
    authority: { ...f.current.facts.declaredAuthority },
    authority_basis: f.current.facts.declaredAuthority.authorityBasis,
    rights_evidence_ref: f.current.facts.declaredAuthority.rightsEvidenceRef,
    admission_event_id: f.binding.admissionEventId,
    admission_policy_version: f.current.facts.admissionPolicyVersion,
    content_hash: f.binding.contentSha256.slice(7),
    clinical_validation_status: "unverified",
    technical_ready: false,
  });
  Object.assign(f.current, { sourceMetadata: metadata });
}

describe("current administrator plain-text inspection adapter", () => {
  it("processes the current owner-bound administrator draft without granting public corpus eligibility", async () => {
    const publishedScope = setup();
    const publishedObservations = await publishedScope.loader(publishedScope.request, publishedScope.binding);
    const draft = setup();
    admittedDraft(draft);
    const result = await draft.loader(draft.request, draft.binding);
    expect(evaluateDocumentIngressSafety(result.sourceObservations).verdict).toBe("pass");
    expect(evaluateDocumentIngressSafety(result.observations).verdict).toBe("pass");
    expect(draft.current.sourceMetadata.corpus_scope).toBe("uploaded_local");
    expect(draft.current.sourceMetadata.publisher_code).toBeNull();
    expect(draft.current.sourceMetadata.source_kind).toBe("document");
    expect(draft.current.sourceMetadata.source_catalogue_key).toBeUndefined();
    expect(draft.current.sourceMetadata.clinical_validation_status).toBe("unverified");
    expect(classifySourceAuthority(draft.current.sourceMetadata).australianAugmentationEligible).toBe(false);
    // The actual unpublished scope remains part of the provenance pin.
    expect(result.observations.policyVersion).not.toBe(publishedObservations.observations.policyVersion);
    expect(draft.loadCurrent.mock.calls.length).toBeGreaterThanOrEqual(7);
  });

  it("retains the bound historical administrator draft contract with source kind absent", async () => {
    const draft = setup();
    admittedDraft(draft);
    const legacyMetadata: Record<string, unknown> = { ...draft.current.sourceMetadata };
    delete legacyMetadata.source_kind;
    Object.assign(draft.current, { sourceMetadata: legacyMetadata });
    const result = await draft.loader(draft.request, draft.binding);
    expect(evaluateDocumentIngressSafety(result.sourceObservations).verdict).toBe("pass");
    expect(evaluateDocumentIngressSafety(result.observations).verdict).toBe("pass");
    expect(classifySourceAuthority(draft.current.sourceMetadata).australianAugmentationEligible).toBe(false);
  });

  it.each(["registry_record", "image", "Document", "", null, true])(
    "refuses an uploaded administrator draft with unsupported source kind %s",
    async (source_kind) => {
      const draft = setup();
      admittedDraft(draft);
      Object.assign(draft.current.sourceMetadata, { source_kind });
      await expect(draft.loader(draft.request, draft.binding)).rejects.toThrow("catalogue_authority_mismatch");
      expect(scan).not.toHaveBeenCalled();
      expect(clamScan).not.toHaveBeenCalled();
    },
  );

  it("still requires an operative processing grant for an uploaded administrator draft", async () => {
    const draft = setup();
    admittedDraft(draft);
    Object.assign(draft.current.policyObservations, { rights: "denied" });
    await expect(draft.loader(draft.request, draft.binding)).rejects.toThrow("current_processing_policy_unavailable");
    expect(scan).not.toHaveBeenCalled();
    expect(clamScan).not.toHaveBeenCalled();
  });
  it.each([
    ["publisher_code", "TGA"],
    ["source_catalogue_key", "tga"],
    ["authority", undefined],
    ["authority_basis", "backend_manifest"],
    ["rights_evidence_ref", "another declaration"],
    ["admission_event_id", uuid(40)],
    ["admission_policy_version", "other-policy"],
    ["content_hash", hash("other source").slice(7)],
  ])("refuses a draft whose actual admitted %s differs", async (key, value) => {
    const f = setup();
    admittedDraft(f);
    Object.assign(f.current.sourceMetadata, { [key]: value });
    await expect(f.loader(f.request, f.binding)).rejects.toThrow("catalogue_authority_mismatch");
    expect(scan).not.toHaveBeenCalled();
  });

  it("compares draft authority values independently of JSON object key order", async () => {
    const f = setup();
    admittedDraft(f);
    Object.assign(f.current.sourceMetadata, {
      authority: Object.fromEntries(Object.entries(f.current.facts.declaredAuthority).reverse()),
    });
    await expect(f.loader(f.request, f.binding)).resolves.toBeDefined();
  });

  it("refuses contradictory nested draft authority despite permissive flattened fields", async () => {
    const f = setup();
    admittedDraft(f);
    Object.assign(f.current.sourceMetadata, {
      authority: { ...f.current.facts.declaredAuthority, providerProcessing: "forbidden" },
    });
    await expect(f.loader(f.request, f.binding)).rejects.toThrow("catalogue_authority_mismatch");
    expect(scan).not.toHaveBeenCalled();
  });
  it("selects the mocked Linux function for exact source and payload without a Windows cloud grant", async () => {
    const f = setupClamAv();
    const result = await f.loader(f.request, f.binding);
    expect(evaluateDocumentIngressSafety(result.sourceObservations).verdict).toBe("pass");
    expect(evaluateDocumentIngressSafety(result.observations).verdict).toBe("pass");
    expect(scan).not.toHaveBeenCalled();
    expect(clamScan).toHaveBeenCalledTimes(2);
    expect(Buffer.from(clamScan.mock.calls[0][0].bytes)).toEqual(Buffer.from(sourceText));
    expect(Buffer.from(clamScan.mock.calls[1][0].bytes)).toEqual(Buffer.from(f.payload));
    const pinned = clamScan.mock.calls[0][0].config;
    expect(pinned).toEqual(f.configuration);
    expect(pinned).not.toBe(f.configuration);
    expect(Object.isFrozen(pinned)).toBe(true);
    expect(Object.isFrozen(pinned.scanner)).toBe(true);
    expect(Object.isFrozen(pinned.databases)).toBe(true);
    expect(pinned.databases.every(Object.isFrozen)).toBe(true);
    expect(f.loadScannerConfiguration).toHaveBeenCalledTimes(4);
  });

  it.each([
    undefined,
    { backend: "clamav" },
    { backend: "other", configuration: {} },
    { backend: "clamav", configuration: { databases: [] } },
  ])("refuses missing or unsupported Linux backend configuration %j", async (value) => {
    const f = setupClamAv();
    f.loadScannerConfiguration.mockResolvedValue(value as unknown as AdminTextScannerConfiguration);
    await expect(f.loader(f.request, f.binding)).rejects.toThrow("scanner_configuration_invalid");
    expect(scan).not.toHaveBeenCalled();
    expect(clamScan).not.toHaveBeenCalled();
  });

  it("detects Linux database-pin drift after source inspection", async () => {
    const f = setupClamAv();
    clamScan.mockImplementationOnce(async ({ expectedSha256 }) => {
      Object.assign(f.configuration.databases[0], { sha256: hash("changed signatures") });
      return { verdict: "clean", scannerVersion: "synthetic", contentSha256: expectedSha256 };
    });
    await expect(f.loader(f.request, f.binding)).rejects.toThrow("scanner_configuration_changed");
    expect(clamScan).toHaveBeenCalledTimes(1);
  });

  it("detects a Linux backend switch between source and payload", async () => {
    const f = setupClamAv();
    const windows = await setup().loadScannerConfiguration({ contentSha256: hash(f.payload) });
    f.loadScannerConfiguration
      .mockResolvedValueOnce(f.supplied)
      .mockResolvedValueOnce(f.supplied)
      .mockResolvedValueOnce(windows);
    await expect(f.loader(f.request, f.binding)).rejects.toThrow("scanner_configuration_changed");
    expect(clamScan).toHaveBeenCalledTimes(1);
    expect(scan).not.toHaveBeenCalled();
  });

  it("detects complete Linux configuration drift between source and payload", async () => {
    const f = setupClamAv();
    f.loadScannerConfiguration
      .mockResolvedValueOnce(f.supplied)
      .mockResolvedValueOnce(f.supplied)
      .mockResolvedValueOnce({
        backend: "clamav",
        configuration: { ...f.configuration, timeoutMs: 999 },
      });
    await expect(f.loader(f.request, f.binding)).rejects.toThrow("scanner_configuration_changed");
    expect(clamScan).toHaveBeenCalledTimes(1);
  });

  it("retains current grant withdrawal checks around Linux scanning", async () => {
    const f = setupClamAv();
    clamScan.mockImplementationOnce(async ({ expectedSha256 }) => {
      Object.assign(f.current.policyObservations, { rights: "denied" });
      return { verdict: "clean", scannerVersion: "synthetic", contentSha256: expectedSha256 };
    });
    await expect(f.loader(f.request, f.binding)).rejects.toThrow("current_processing_policy_unavailable");
    expect(clamScan).toHaveBeenCalledTimes(1);
  });

  it("fully inspects the exact source and outgoing bytes and passes the existing worker context", async () => {
    const f = setup();
    const context = createWorkerProviderEgressContext(f.job, async () => f.job.documents, f.loader);
    await expect(assertIngestionProviderEgress(context, "embedding", f.payload)).resolves.toBeUndefined();
    expect(scan).toHaveBeenCalledTimes(2);
    expect(Buffer.from(scan.mock.calls[0][0].bytes)).toEqual(Buffer.from(sourceText));
    expect(Buffer.from(scan.mock.calls[1][0].bytes)).toEqual(Buffer.from(f.payload));
    expect(scan.mock.calls.map(([args]) => args.config.cloudAuthorisation.contentSha256)).toEqual([
      f.binding.contentSha256,
      hash(f.payload),
    ]);
    expect(f.loadCurrent.mock.calls.length).toBeGreaterThanOrEqual(7);
    expect(f.current.facts.currentRightsEvidence).toBe("unavailable");
  });

  it("produces immutable hash-bound observations with detector-scoped negative evidence", async () => {
    const f = setup();
    const result = await f.loader(f.request, f.binding);
    expect(evaluateDocumentIngressSafety(result.sourceObservations).verdict).toBe("pass");
    expect(evaluateDocumentIngressSafety(result.observations).verdict).toBe("pass");
    expect(result.sourceObservations).toMatchObject({
      binding: f.binding,
      identifiers: "absent",
      hiddenText: "not_applicable",
      encryption: "not_encrypted",
    });
    expect(result.observations.binding.contentSha256).toBe(hash(f.payload));
    expect(result.observations.policyVersion).toContain("identifier-shape-warning-v1");
    expect(Object.isFrozen(result.sourceObservations.binding)).toBe(true);
    expect(Object.isFrozen(result.sourceObservations.scanner)).toBe(true);
  });

  it.each([
    ["licencePolicy", "review_required"],
    ["providerProcessing", "forbidden"],
    ["currentness", "unknown"],
    ["authorityBasis", "backend_manifest"],
  ])("refuses unavailable current administrator permission %s=%s before scanning", async (key, value) => {
    const f = setup();
    Object.assign(f.current.facts.declaredAuthority, { [key]: value });
    await expect(f.loader(f.request, f.binding)).rejects.toThrow();
    expect(scan).not.toHaveBeenCalled();
  });

  it.each(["effectiveDate", "reviewDate", "expiryDate"])("refuses invalid current authority date %s", async (key) => {
    const f = setup();
    Object.assign(f.current.facts.declaredAuthority, { [key]: key === "effectiveDate" ? "2099-01-01" : "2000-01-01" });
    await expect(f.loader(f.request, f.binding)).rejects.toThrow("authority_not_current");
    expect(scan).not.toHaveBeenCalled();
  });

  it.each(["missing-key", "etg-complete", "nps-medicinewise"])(
    "refuses noneligible current catalogue %s",
    async (key) => {
      const f = setup();
      Object.assign(f.current, { catalogueKey: key });
      await expect(f.loader(f.request, f.binding)).rejects.toThrow("catalogue_not_eligible");
      expect(scan).not.toHaveBeenCalled();
    },
  );

  it.each(["publisher", "sourceRole"])("rejects mismatched declared %s", async (key) => {
    const f = setup();
    Object.assign(f.current.facts.declaredAuthority, { [key]: key === "publisher" ? "Other publisher" : "legal" });
    await expect(f.loader(f.request, f.binding)).rejects.toThrow("catalogue_authority_mismatch");
  });

  it("requires fenced inventory facts; metadata role and scanner status do not establish authority", async () => {
    const f = setup();
    Object.assign(f.current, {
      facts: { source_role: "service_policy", licence_policy: "public_index_permitted", scanner: "clean" },
    });
    await expect(f.loader(f.request, f.binding)).rejects.toThrow("ingestion_rpc_invalid");
    expect(scan).not.toHaveBeenCalled();
  });

  it("does not promote admitted declarations with unavailable rights evidence into a grant", async () => {
    const f = setup();
    Object.assign(f.current, { policyObservations: undefined });
    await expect(f.loader(f.request, f.binding)).rejects.toThrow("current_processing_policy_unavailable");
    expect(scan).not.toHaveBeenCalled();
  });

  it.each(["unverified", " unverified "])(
    "preserves the evaluator's refusal of policy version %j before scanning",
    async (policyVersion) => {
      const f = setup();
      Object.assign(f.current.policyObservations, { policyVersion });
      await expect(f.loader(f.request, f.binding)).rejects.toThrow("current_processing_policy_unavailable");
      expect(scan).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["rights", "denied"],
    ["ownerScope", "denied"],
    ["purposeClearance", "denied"],
    ["admission", "revoked"],
    ["indexLicence", "not_permitted"],
    ["sourcePolicy", "mismatch"],
  ])("refuses the current grant's %s=%s", async (key, value) => {
    const f = setup();
    Object.assign(f.current.policyObservations, { [key]: value });
    await expect(f.loader(f.request, f.binding)).rejects.toThrow("current_processing_policy_unavailable");
    expect(scan).not.toHaveBeenCalled();
  });

  it("refuses a grant for another source or authority", async () => {
    const f = setup();
    Object.assign(f.current.policyObservations, { binding: { ...f.binding, contentSha256: hash("other source") } });
    await expect(f.loader(f.request, f.binding)).rejects.toThrow("current_processing_policy_unavailable");
    expect(scan).not.toHaveBeenCalled();
  });

  it.each([
    ["source_kind", "registry_record"],
    ["source_catalogue_key", "wa-health"],
    ["publisher_code", "WAHEALTH"],
    ["jurisdiction", "Australia/WA"],
    ["corpus_scope", "private_owner"],
    ["corpus_scope", "unknown"],
    ["content_mode", "link_only"],
    ["source_policy_version", "stale-policy"],
    ["licence_policy", "review_required"],
  ])("refuses current source metadata mismatch %s=%s", async (key, value) => {
    const f = setup();
    Object.assign(f.current.sourceMetadata, { [key]: value });
    await expect(f.loader(f.request, f.binding)).rejects.toThrow("catalogue_authority_mismatch");
    expect(scan).not.toHaveBeenCalled();
  });

  it("does not infer WA compatibility from a national-only admitted jurisdiction", async () => {
    const f = setup();
    Object.assign(f.current, { catalogueKey: "wa-health" });
    Object.assign(f.current.facts.declaredAuthority, { publisher: "WA Health", sourceRole: "service_policy" });
    Object.assign(f.current.sourceMetadata, {
      source_catalogue_key: "wa-health",
      publisher_code: "WAHEALTH",
      publisher: "WA Health",
      source_role: "service_policy",
    });
    await expect(f.loader(f.request, f.binding)).rejects.toThrow("catalogue_authority_mismatch");
    expect(scan).not.toHaveBeenCalled();
  });

  it.each(["documentId", "ownerId", "jobId", "generationId", "admissionEventId"])(
    "refuses current %s drift",
    async (key) => {
      const f = setup();
      Object.assign(f.current.facts, { [key]: uuid(20) });
      await expect(f.loader(f.request, f.binding)).rejects.toThrow();
      expect(scan).not.toHaveBeenCalled();
    },
  );

  it.each(["attemptId", "leaseId", "authorityDigest"])("refuses full per-attempt binding %s drift", async (key) => {
    const f = setup();
    Object.assign(f.current, {
      binding: { ...f.binding, [key]: key === "authorityDigest" ? hash("changed authority") : "changed" },
    });
    await expect(f.loader(f.request, f.binding)).rejects.toThrow("binding_mismatch");
    expect(scan).not.toHaveBeenCalled();
  });

  it("refuses source bytes or length that do not match the fenced source", async () => {
    const f = setup();
    Object.assign(f.current, { sourceBytes: Buffer.from(sourceText + "changed") });
    await expect(f.loader(f.request, f.binding)).rejects.toThrow("source_binding_mismatch");
    expect(scan).not.toHaveBeenCalled();
  });

  it("checks revoked permissions immediately after source scanning before any payload scan", async () => {
    const f = setup();
    scan.mockImplementationOnce(async ({ expectedSha256 }) => {
      Object.assign(f.current.facts.declaredAuthority, { licencePolicy: "review_required" });
      return { verdict: "clean", scannerVersion: "synthetic-scanner-v1", contentSha256: expectedSha256 };
    });
    await expect(f.loader(f.request, f.binding)).rejects.toThrow("current_admin_permissions_unavailable");
    expect(scan).toHaveBeenCalledTimes(1);
    await expect(f.loader(f.request, f.binding)).rejects.toThrow("context_refused");
  });

  it("checks withdrawal of the operative current grant after scanning", async () => {
    const f = setup();
    scan.mockImplementationOnce(async ({ expectedSha256 }) => {
      Object.assign(f.current.policyObservations, { rights: "denied" });
      return { verdict: "clean", scannerVersion: "synthetic-scanner-v1", contentSha256: expectedSha256 };
    });
    await expect(f.loader(f.request, f.binding)).rejects.toThrow("current_processing_policy_unavailable");
    expect(scan).toHaveBeenCalledTimes(1);
  });

  it("detects source mutation during inspection", async () => {
    const f = setup();
    scan.mockImplementationOnce(async ({ expectedSha256 }) => {
      f.current.sourceBytes[0] ^= 1;
      return { verdict: "clean", scannerVersion: "synthetic-scanner-v1", contentSha256: expectedSha256 };
    });
    await expect(f.loader(f.request, f.binding)).rejects.toThrow("source_binding_mismatch");
    expect(scan).toHaveBeenCalledTimes(1);
  });

  it("detects provenance drift even when the new permission remains permissive", async () => {
    const f = setup();
    scan.mockImplementationOnce(async ({ expectedSha256 }) => {
      Object.assign(f.current.facts.declaredAuthority, { rightsEvidenceRef: "different declaration" });
      return { verdict: "clean", scannerVersion: "synthetic-scanner-v1", contentSha256: expectedSha256 };
    });
    await expect(f.loader(f.request, f.binding)).rejects.toThrow("current_authority_changed");
    expect(scan).toHaveBeenCalledTimes(1);
  });

  it("refuses malformed UTF-8 source bytes", async () => {
    const f = setup(Buffer.from([0xc3, 0x28]));
    await expect(f.loader(f.request, f.binding)).rejects.toThrow("utf8_invalid");
    expect(scan).not.toHaveBeenCalled();
  });

  it.each(["%PDF-1.7\n", "<html>reference</html>", "plain\u0000text", "plain\u202etext"])(
    "refuses non-inert strict text %j",
    async (text) => {
      const f = setup(Buffer.from(text));
      await expect(f.loader(f.request, f.binding)).rejects.toThrow("source_not_inert_plain_text");
      expect(scan).not.toHaveBeenCalled();
    },
  );

  it("refuses MIME-only PDF without native inspection evidence or treating decoded bytes as inspected text", async () => {
    const f = setup();
    Object.assign(f.current.facts, { mimeType: "application/pdf" });
    await expect(f.loader(f.request, f.binding)).rejects.toThrow(
      "admin_text_inspection_current_native_pdf_inspection_unavailable",
    );
    expect(scan).not.toHaveBeenCalled();
  });

  it("detects identifiers anywhere in the source, including outside embedding input", async () => {
    const f = setup(Buffer.from(sourceText + "\nPatient ID: ABCD1234"));
    await expect(f.loader(f.request, f.binding)).rejects.toThrow("identifier_shape_detected");
    expect(scan).not.toHaveBeenCalled();
  });

  it.each([
    "ISBN Online: 978-1-86496-071-6",
    "ISBN: 9781864960716",
    "ISBN-13: 978 1 86496 071 6",
    "ISBN-13:\n978-1-86496-071-6",
    "ISBN: 979-1-23456-789-6",
  ])("accepts only the validated bibliographic number in %j with unchanged scan bytes", async (bibliography) => {
    const text = sourceText + bibliography + "\n";
    const f = setup(Buffer.from(text));
    const payload = payloadFor([text]);
    // The global clinical Ask detector continues to warn on the actual ISBN.
    expect(identifierShapeWarning("ISBN Online: 978-1-86496-071-6")).toBe(true);
    const result = await f.loader({ ...f.request, payload, payloadSha256: hash(payload) }, f.binding);
    expect(result.sourceObservations.binding.contentSha256).toBe(hash(text));
    expect(result.observations.binding.contentSha256).toBe(hash(payload));
    expect(result.observations.policyVersion).toContain("labelled-isbn13-v1");
    expect(Buffer.from(scan.mock.calls[0][0].bytes)).toEqual(Buffer.from(text));
    expect(Buffer.from(scan.mock.calls[1][0].bytes)).toEqual(Buffer.from(payload));
  });

  it.each([
    ["ISBN Online:", "978-1-86496-071-6"],
    ["ISBN Online: 978-1-86496", "-071-6"],
  ])("assesses exact source slices across the ISBN chunk boundary %j", async (...input) => {
    const text = sourceText + "ISBN Online: 978-1-86496-071-6\n";
    const f = setup(Buffer.from(text));
    const payload = payloadFor(input);
    await expect(f.loader({ ...f.request, payload, payloadSha256: hash(payload) }, f.binding)).resolves.toBeDefined();
    expect(scan).toHaveBeenCalledTimes(2);
  });

  it.each([
    "ISBN Online: 978-1-86496-071-7",
    "ISBN: 977-1-86496-071-7",
    "ISBN13: 978-1-86496-071-6",
    "fakeISBN: 978-1-86496-071-6",
    "ISBN-13x: 978-1-86496-071-6",
    "ISBN: 978--1-86496-071-6",
    "ISBN: 978-1 86496-071-6",
    "ISBN: 978-1-86496-071-60",
    "978-1-86496-071-6",
    "ISBN Online: 978-1-86496-071-6\nPhone: 0412 345 678",
    "ISBN Online: 978-1-86496-071-6\nEmail: person@example.org",
    "ISBN Online: 978-1-86496-071-6\nPatient ID: ABCD1234",
    "ISBN Online: 978-1-86496-071-6\nDOB: 01/02/1980",
    "ISBN Online: 978-1-86496-071-6\n978-1-86496-071-6",
  ])("retains whole-source identifier refusal for %j outside the outgoing slice", async (bibliography) => {
    const f = setup(Buffer.from(sourceText + bibliography));
    await expect(f.loader(f.request, f.binding)).rejects.toThrow("identifier_shape_detected");
    expect(scan).not.toHaveBeenCalled();
  });

  it.each([
    (payload: string) => payload.replace('"input"', '"\\u0069nput"'),
    (payload: string) => payload.replace("ISBN", "\\u0049SBN"),
    (payload: string) => payload.replace('"input":', '"input":["Patient ID: ABCD1234"],"input":'),
  ])("does not let ISBN assessment normalize noncanonical JSON or discarded key residue", async (change) => {
    const text = sourceText + "ISBN Online: 978-1-86496-071-6\n";
    const f = setup(Buffer.from(text));
    const payload = change(payloadFor([text]));
    await expect(f.loader({ ...f.request, payload, payloadSha256: hash(payload) }, f.binding)).rejects.toThrow(
      "payload_format_unsupported",
    );
    expect(scan).not.toHaveBeenCalled();
  });

  it.each([payloadFor(["Patient ID: ABCD1234"]), payloadFor(["Patient ID:\nABCD1234"])])(
    "checks both raw and decoded payload identifier shapes",
    async (payload) => {
      const f = setup();
      await expect(f.loader({ ...f.request, payload, payloadSha256: hash(payload) }, f.binding)).rejects.toThrow(
        "identifier_shape_detected",
      );
      expect(scan).not.toHaveBeenCalled();
    },
  );

  it("refuses duplicate embedding inputs whose earlier value is outside the source", async () => {
    const f = setup();
    const payload =
      '{"model":"text-embedding-3-small","dimensions":1536,"input":["arbitrary non-source text"],"input":["Use the current local service pathway."],"encoding_format":"base64"}';
    await expect(f.loader({ ...f.request, payload, payloadSha256: hash(payload) }, f.binding)).rejects.toThrow(
      "payload_format_unsupported",
    );
    expect(scan).not.toHaveBeenCalled();
  });

  it("refuses noncanonical escaped key or text residue on the actual wire", async () => {
    const f = setup();
    const payload = payloadFor(["Patient ID: ABCD1234"]).replace("Patient", "\\u0050atient");
    await expect(f.loader({ ...f.request, payload, payloadSha256: hash(payload) }, f.binding)).rejects.toThrow(
      "payload_format_unsupported",
    );
    expect(scan).not.toHaveBeenCalled();
  });

  it("refuses unrelated or normalized embedding text", async () => {
    const f = setup();
    const payload = payloadFor(["use the current local service pathway."]);
    await expect(f.loader({ ...f.request, payload, payloadSha256: hash(payload) }, f.binding)).rejects.toThrow(
      "payload_not_source_derived",
    );
    expect(scan).not.toHaveBeenCalled();
  });

  it.each([
    { purpose: "caption", payload: payloadFor() },
    { purpose: "embedding", payload: Buffer.from(payloadFor()) },
    { purpose: "embedding", payload: JSON.stringify({ model: "other-model", input: ["reference"] }) },
    {
      purpose: "embedding",
      payload: JSON.stringify({ model: "text-embedding-3-small", dimensions: 1536, input: [[1, 2, 3]] }),
    },
  ])("refuses unsupported payload purpose, bytes, models and token arrays", async (change) => {
    const f = setup();
    const request = { ...f.request, ...change, payloadSha256: hash(change.payload) } as IngestionProviderEgressRequest;
    await expect(f.loader(request, f.binding)).rejects.toThrow("payload_format_unsupported");
    expect(scan).not.toHaveBeenCalled();
  });

  it("refuses mismatched outgoing hash", async () => {
    const f = setup();
    await expect(f.loader({ ...f.request, payloadSha256: hash("other payload") }, f.binding)).rejects.toThrow(
      "payload_hash_mismatch",
    );
    expect(scan).not.toHaveBeenCalled();
  });

  it("refuses lone surrogates in decoded payload inputs", async () => {
    const f = setup();
    const payload = payloadFor(["\ud800"]);
    await expect(f.loader({ ...f.request, payload, payloadSha256: hash(payload) }, f.binding)).rejects.toThrow(
      "payload_utf8_invalid",
    );
    expect(scan).not.toHaveBeenCalled();
  });

  it("bounds the full source and payload rather than truncating inspection", async () => {
    const f = setup(Buffer.alloc(ADMIN_TEXT_INSPECTION_MAX_BYTES + 1, 65));
    await expect(f.loader(f.request, f.binding)).rejects.toThrow("source_size_invalid");
    const g = setup();
    await expect(
      g.loader({ ...g.request, payload: "a".repeat(ADMIN_TEXT_INSPECTION_MAX_BYTES + 1) }, g.binding),
    ).rejects.toThrow("payload_size_invalid");
    expect(scan).not.toHaveBeenCalled();
  });

  it("never manufactures scanner cloud authorisation", async () => {
    const f = setup();
    const config = await f.loadScannerConfiguration({ contentSha256: hash("wrong bytes") });
    f.loadScannerConfiguration.mockResolvedValue(config);
    await expect(f.loader(f.request, f.binding)).rejects.toThrow("scanner_cloud_authorisation_missing");
    expect(scan).not.toHaveBeenCalled();
  });

  it("propagates scanner failure and permanently refuses further use", async () => {
    const f = setup();
    scan.mockRejectedValueOnce(new Error("synthetic scan unavailable"));
    await expect(f.loader(f.request, f.binding)).rejects.toThrow("synthetic scan unavailable");
    await expect(f.loader(f.request, f.binding)).rejects.toThrow("context_refused");
    expect(scan).toHaveBeenCalledTimes(1);
  });

  it("refuses scanner results with mismatched bytes", async () => {
    const f = setup();
    scan.mockResolvedValueOnce({ verdict: "clean", scannerVersion: "synthetic-v1", contentSha256: hash("wrong scan") });
    await expect(f.loader(f.request, f.binding)).rejects.toThrow("scanner_result_invalid");
  });

  it("checks scanner configuration freshness after scan", async () => {
    const f = setup();
    const config = await f.loadScannerConfiguration({ contentSha256: f.binding.contentSha256 });
    f.loadScannerConfiguration
      .mockResolvedValueOnce(config)
      .mockResolvedValueOnce({ ...config, signatureVersion: "1.2.4" });
    await expect(f.loader(f.request, f.binding)).rejects.toThrow("scanner_configuration_changed");
    expect(scan).toHaveBeenCalledTimes(1);
  });

  it("honours request cancellation before scanning", async () => {
    const f = setup();
    const controller = new AbortController();
    controller.abort(new Error("synthetic cancellation"));
    await expect(f.loader({ ...f.request, signal: controller.signal }, f.binding)).rejects.toThrow(
      "synthetic cancellation",
    );
    expect(scan).not.toHaveBeenCalled();
  });

  it("ends a stalled current-facts read when the request is cancelled", async () => {
    const f = setup();
    const controller = new AbortController();
    f.loadCurrent.mockImplementationOnce(async () => {
      controller.abort(new Error("cancel stalled current read"));
      return new Promise<AdminTextCurrentFacts>(() => {});
    });
    await expect(f.loader({ ...f.request, signal: controller.signal }, f.binding)).rejects.toThrow(
      "cancel stalled current read",
    );
    expect(scan).not.toHaveBeenCalled();
  });

  it("ends a stalled scanner configuration read when the request is cancelled", async () => {
    const f = setup();
    const controller = new AbortController();
    f.loadScannerConfiguration.mockImplementationOnce(async () => {
      controller.abort(new Error("cancel stalled scanner config read"));
      return new Promise<WindowsMalwareInspectionConfiguration>(() => {});
    });
    await expect(f.loader({ ...f.request, signal: controller.signal }, f.binding)).rejects.toThrow(
      "cancel stalled scanner config read",
    );
    expect(scan).not.toHaveBeenCalled();
  });

  it("honours lease cancellation during a source scan", async () => {
    const f = setup();
    scan.mockImplementationOnce(async ({ expectedSha256, signal }) => {
      f.attempt.cancel();
      expect(signal?.aborted).toBe(true);
      return { verdict: "clean", scannerVersion: "synthetic-v1", contentSha256: expectedSha256 };
    });
    await expect(f.loader(f.request, f.binding)).rejects.toThrow("lease_lost");
    expect(scan).toHaveBeenCalledTimes(1);
  });
});
