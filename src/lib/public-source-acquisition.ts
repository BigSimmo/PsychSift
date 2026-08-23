import { createHash } from "node:crypto";
import { BlockList, isIP } from "node:net";

import {
  assertIndexableCatalogueEntry,
  australianSourceByKey,
  australianSourcePolicyVersion,
  isIndexableAustralianSource,
  type AustralianSourceDefinition,
  type SourceLicencePolicy,
} from "@/lib/australian-source-catalogue";
import {
  assertActivationAllowsAcquisition,
  australianSourcePolicyDigest,
  type PublicSourceActivationManifestV1,
} from "@/lib/public-source-activation-manifest";
import { assertAllowedFile, assertFileContentSignature } from "@/lib/http";
import { MAX_UPLOAD_MB_CEILING } from "@/lib/upload-limits";
import { assertUploadStructure } from "@/lib/upload-structure";
import { forbiddenPublicSourceIdentity } from "../../supabase/functions/_shared/public-source-policy";

const sha256Pattern = /^sha256:[a-f0-9]{64}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const defaultAllowedContentTypes = Object.freeze([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "text/html",
]);

export type ResolvedAddress = Readonly<{ address: string; family: 4 | 6 }>;
export type ResolveHost = (hostname: string) => Promise<readonly ResolvedAddress[]>;
export type AcquisitionFetch = (
  url: URL,
  addresses: readonly ResolvedAddress[],
) => Promise<Readonly<{ response: Response; remoteAddress: string }>>;
export type PublicSourceScanReasonCode =
  "malware_detected" | "protected_source_identity" | "invalid_document" | "blocked";
export const publicSourceContentIdentityVerdictVersion = "public-source-content-identity-v1" as const;
export type PublicSourceContentIdentityVerdict = Readonly<{
  accepted: boolean;
  contentIdentity: "clear" | "protected" | "unknown";
  inspectedContentHash: string;
  verdictVersion: typeof publicSourceContentIdentityVerdictVersion;
  reasonCode?: PublicSourceScanReasonCode;
}>;
export type PublicSourceContentIdentityScan = (input: {
  bytes: Uint8Array;
  contentType: string;
  contentHash: string;
  catalogueKey: string;
}) => Promise<PublicSourceContentIdentityVerdict>;

export type PublicSourceAcquisitionPlan = Readonly<{
  schemaVersion: "public-source-acquisition-v1";
  sourcePolicyVersion: typeof australianSourcePolicyVersion;
  sourcePolicyDigest: string;
  sourceActivationManifest: PublicSourceActivationManifestV1;
  sourceActivationEventId: string | null;
  catalogueKey: string;
  exactUrl: string;
  exactVersion: string;
  exactDocumentLicence: Extract<SourceLicencePolicy, "public_index_permitted">;
  licenceEvidenceDigest: string;
  stagingOwnerId: string;
  maxBytes: number;
  maxRedirects: number;
  allowedContentTypes: readonly string[];
  targetLifecycle: "shadow";
}>;

export type PublicSourceStagingCandidate = Readonly<{
  ownerId: string;
  exactUrl: string;
  exactVersion: string;
  contentType: string;
  bytes: Uint8Array;
  contentHash: string;
  sourceBytes: Uint8Array;
  sourceContentType: string;
  sourceContentHash: string;
  lifecycle: "shadow";
  metadata: Readonly<Record<string, string | boolean>>;
}>;

export function localPublicSourceContentIdentityVerdict(input: {
  bytes: Uint8Array;
  contentType: string;
  contentHash: string;
}): PublicSourceContentIdentityVerdict {
  if (input.contentType !== "text/plain") {
    return Object.freeze({
      accepted: false,
      contentIdentity: "unknown",
      inspectedContentHash: input.contentHash,
      verdictVersion: publicSourceContentIdentityVerdictVersion,
      reasonCode: "invalid_document",
    });
  }
  const protectedIdentity = forbiddenPublicSourceIdentity(new TextDecoder().decode(input.bytes));
  return Object.freeze({
    accepted: !protectedIdentity,
    contentIdentity: protectedIdentity ? "protected" : "clear",
    inspectedContentHash: input.contentHash,
    verdictVersion: publicSourceContentIdentityVerdictVersion,
    ...(protectedIdentity ? { reasonCode: "protected_source_identity" as const } : {}),
  });
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

const nonGlobalIpv4 = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  nonGlobalIpv4.addSubnet(network, prefix, "ipv4");
}

const specialUseIpv6 = new BlockList();
for (const [network, prefix] of [
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["2620:4f:8000::", 48],
  ["3fff::", 20],
] as const) {
  specialUseIpv6.addSubnet(network, prefix, "ipv6");
}

function isPrivateOrNonGlobalIp(address: string) {
  const family = isIP(address);
  if (family === 4) {
    return nonGlobalIpv4.check(address, "ipv4");
  }
  if (family === 6) {
    const normalized = address.toLowerCase();
    const firstHextet = Number.parseInt(normalized.split(":", 1)[0] || "0", 16);
    return firstHextet < 0x2000 || firstHextet > 0x3fff || specialUseIpv6.check(address, "ipv6");
  }
  return true;
}

function assertSafeAddressSet(addresses: readonly ResolvedAddress[]) {
  if (addresses.length === 0) throw new Error("Acquisition DNS lookup returned no addresses.");
  for (const resolved of addresses) {
    if (isPrivateOrNonGlobalIp(resolved.address)) {
      throw new Error("Acquisition DNS lookup resolved to a private or non-global network target.");
    }
  }
}

function parseAndValidateUrl(rawUrl: string, definition: AustralianSourceDefinition) {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("Acquisition URL is invalid.");
  }
  if (url.protocol !== "https:") throw new Error("Acquisition URL must use HTTPS and may not target a private host.");
  if (url.username || url.password) throw new Error("Acquisition URL may not contain credentials.");
  if (url.port && url.port !== "443") throw new Error("Acquisition URL must use the default HTTPS port.");
  const allowedHost = new URL(definition.canonicalUrl).hostname.toLowerCase();
  if (url.hostname.toLowerCase() !== allowedHost) {
    throw new Error(`Acquisition URL host is not the exact allowlisted host for ${definition.key}.`);
  }
  if (isIP(url.hostname) && isPrivateOrNonGlobalIp(url.hostname)) {
    throw new Error("Acquisition URL may not target a private network address.");
  }
  return url;
}

export async function validateAcquisitionUrl(
  rawUrl: string,
  definition: AustralianSourceDefinition,
  resolve?: ResolveHost,
) {
  const url = parseAndValidateUrl(rawUrl, definition);
  if (resolve) assertSafeAddressSet(await resolve(url.hostname));
  return url;
}

export async function validateRedirect(rawUrl: string, definition: AustralianSourceDefinition, resolve?: ResolveHost) {
  return validateAcquisitionUrl(rawUrl, definition, resolve);
}

function activeIndexableDefinition(catalogueKey: string, exactLicence: SourceLicencePolicy) {
  const source = australianSourceByKey(catalogueKey);
  if (!source) throw new Error(`Public source ${catalogueKey} is not in the active catalogue.`);
  assertIndexableCatalogueEntry(source);
  if (!isIndexableAustralianSource(catalogueKey, exactLicence)) {
    throw new Error(`Public source ${catalogueKey} lacks exact-document licence permission.`);
  }
  return source;
}

export async function planAcquisition(input: {
  catalogueKey: string;
  url: string;
  exactVersion?: string;
  exactDocumentLicence?: SourceLicencePolicy;
  licenceEvidenceDigest?: string;
  stagingOwnerId?: string;
  activationManifest?: unknown;
  sourceActivationEventId?: string;
  maxBytes?: number;
  maxRedirects?: number;
  allowedContentTypes?: readonly string[];
  /** Accepted for dependency-injection symmetry; planning never calls it. */
  fetch?: AcquisitionFetch;
}): Promise<PublicSourceAcquisitionPlan> {
  const source = australianSourceByKey(input.catalogueKey);
  if (!source) throw new Error(`Public source ${input.catalogueKey} is not in the active catalogue.`);
  if (source.contentMode === "link_only") {
    throw new Error(`Public source ${source.key} is link-only and cannot be acquired.`);
  }
  if (source.lifecycle !== "active") {
    throw new Error(`Public source ${source.key} is ${source.lifecycle} and cannot be acquired.`);
  }
  const exactLicence = input.exactDocumentLicence ?? "review_required";
  activeIndexableDefinition(input.catalogueKey, exactLicence);
  const activation = assertActivationAllowsAcquisition(input.activationManifest, input.catalogueKey);
  if (input.sourceActivationEventId !== undefined && !uuidPattern.test(input.sourceActivationEventId)) {
    throw new Error("Acquisition source activation event ID is invalid.");
  }
  const url = await validateAcquisitionUrl(input.url, source);
  if (!isNonEmpty(input.exactVersion)) throw new Error("Acquisition requires an operator-supplied exact version.");
  if (!sha256Pattern.test(input.licenceEvidenceDigest ?? "")) {
    throw new Error("Acquisition requires an exact licence evidence digest.");
  }
  if (!isNonEmpty(input.stagingOwnerId) || !uuidPattern.test(input.stagingOwnerId)) {
    throw new Error("Acquisition requires a valid staging owner ID.");
  }
  const maxBytes = input.maxBytes ?? 50 * 1024 * 1024;
  const maxRedirects = input.maxRedirects ?? 3;
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || maxBytes > MAX_UPLOAD_MB_CEILING * 1024 * 1024) {
    throw new Error(`Acquisition maxBytes must be between 1 byte and ${MAX_UPLOAD_MB_CEILING} MB.`);
  }
  if (!Number.isSafeInteger(maxRedirects) || maxRedirects < 0 || maxRedirects > 10) {
    throw new Error("Acquisition redirect limit must be between 0 and 10.");
  }
  const allowedContentTypes = input.allowedContentTypes ?? defaultAllowedContentTypes;
  if (
    allowedContentTypes.length === 0 ||
    allowedContentTypes.some((value) => !isNonEmpty(value) || !defaultAllowedContentTypes.includes(value))
  ) {
    throw new Error("Acquisition requires at least one allowed content type.");
  }

  return Object.freeze({
    schemaVersion: "public-source-acquisition-v1" as const,
    sourcePolicyVersion: australianSourcePolicyVersion,
    sourcePolicyDigest: australianSourcePolicyDigest,
    sourceActivationManifest: activation,
    sourceActivationEventId: input.sourceActivationEventId ?? null,
    catalogueKey: source.key,
    exactUrl: url.href,
    exactVersion: input.exactVersion.trim(),
    exactDocumentLicence: "public_index_permitted" as const,
    licenceEvidenceDigest: input.licenceEvidenceDigest!,
    stagingOwnerId: input.stagingOwnerId,
    maxBytes,
    maxRedirects,
    allowedContentTypes: Object.freeze([...new Set(allowedContentTypes)]),
    targetLifecycle: "shadow" as const,
  });
}

export function assertPublicSourceAcquisitionPlan(plan: PublicSourceAcquisitionPlan) {
  if (plan.schemaVersion !== "public-source-acquisition-v1" || plan.targetLifecycle !== "shadow") {
    throw new Error("Acquisition plan schema or staging lifecycle is invalid.");
  }
  if (plan.sourcePolicyVersion !== australianSourcePolicyVersion) {
    throw new Error("Acquisition source policy version changed after planning.");
  }
  if (plan.sourcePolicyDigest !== australianSourcePolicyDigest) {
    throw new Error("Acquisition source policy digest changed after planning.");
  }
  if (!uuidPattern.test(plan.stagingOwnerId)) throw new Error("Acquisition staging owner is invalid.");
  if (plan.sourceActivationEventId !== null && !uuidPattern.test(plan.sourceActivationEventId)) {
    throw new Error("Acquisition source activation event is invalid.");
  }
  if (!isNonEmpty(plan.exactVersion) || !sha256Pattern.test(plan.licenceEvidenceDigest)) {
    throw new Error("Acquisition exact-version or licence evidence is invalid.");
  }
  if (
    !Number.isSafeInteger(plan.maxBytes) ||
    plan.maxBytes <= 0 ||
    plan.maxBytes > MAX_UPLOAD_MB_CEILING * 1024 * 1024 ||
    !Number.isSafeInteger(plan.maxRedirects) ||
    plan.maxRedirects < 0 ||
    plan.maxRedirects > 10 ||
    plan.allowedContentTypes.length === 0 ||
    plan.allowedContentTypes.some((value) => !defaultAllowedContentTypes.includes(value))
  ) {
    throw new Error("Acquisition limits or content types changed after planning.");
  }
  assertActivationAllowsAcquisition(plan.sourceActivationManifest, plan.catalogueKey);
  const definition = activeIndexableDefinition(plan.catalogueKey, plan.exactDocumentLicence);
  parseAndValidateUrl(plan.exactUrl, definition);
  return definition;
}

async function readBoundedBody(response: Response, maxBytes: number) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error("Public source response exceeds the approved size limit.");
  }
  if (!response.body) throw new Error("Public source response has no readable body.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  const hash = createHash("sha256");
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error("Public source response exceeds the approved streamed size limit.");
      }
      hash.update(value);
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return Object.freeze({ bytes, contentHash: `sha256:${hash.digest("hex")}` });
}

async function fetchBounded(
  plan: PublicSourceAcquisitionPlan,
  deps: { fetch: AcquisitionFetch; resolve: ResolveHost },
  allowWithdrawalSignal = false,
) {
  const definition = assertPublicSourceAcquisitionPlan(plan);
  let currentUrl = plan.exactUrl;
  for (let redirectCount = 0; ; redirectCount += 1) {
    const url = await validateAcquisitionUrl(currentUrl, definition);
    let addresses: readonly ResolvedAddress[];
    try {
      addresses = await deps.resolve(url.hostname);
    } catch {
      throw new Error("Public source DNS validation failed.");
    }
    assertSafeAddressSet(addresses);
    let connected: Awaited<ReturnType<AcquisitionFetch>>;
    try {
      connected = await deps.fetch(url, Object.freeze([...addresses]));
    } catch {
      throw new Error("Public source validated transport failed.");
    }
    const { response, remoteAddress } = connected;
    if (!addresses.some(({ address }) => address.toLowerCase() === remoteAddress.toLowerCase())) {
      throw new Error("Public source transport did not connect to a validated address.");
    }
    if (response.status >= 300 && response.status < 400) {
      if (redirectCount >= plan.maxRedirects) throw new Error("Public source redirect limit exceeded.");
      const location = response.headers.get("location");
      if (!location) throw new Error("Public source redirect omitted a location.");
      currentUrl = (await validateRedirect(new URL(location, url).href, definition)).href;
      continue;
    }
    if (!response.ok && !(allowWithdrawalSignal && (response.status === 404 || response.status === 410))) {
      throw new Error(`Public source request failed with bounded status ${response.status}.`);
    }
    return response;
  }
}

export async function acquirePublicSourceVersion(
  plan: PublicSourceAcquisitionPlan,
  deps: {
    fetch: AcquisitionFetch;
    resolve: ResolveHost;
    scan: PublicSourceContentIdentityScan;
    findDuplicateVersion: (input: {
      catalogueKey: string;
      exactUrl: string;
      exactVersion: string;
      contentHash: string;
    }) => Promise<string | null>;
    stageOwnedDocument: (
      candidate: PublicSourceStagingCandidate,
    ) => Promise<{ documentId: string; ownerId: string | null }>;
    enqueue: (input: {
      documentId: string;
      ownerId: string;
      catalogueKey: string;
      contentMode: "indexed_content";
      exactDocumentLicence: "public_index_permitted";
      sourcePolicyVersion: string;
      sourcePolicyDigest: string;
      metadata: Readonly<Record<string, string | boolean>>;
    }) => Promise<void>;
    log?: (event: Readonly<Record<string, string | number | boolean>>) => void;
  },
) {
  assertPublicSourceAcquisitionPlan(plan);
  deps.log?.({ event: "public_source_fetch_started", catalogueKey: plan.catalogueKey });
  const { bytes, contentType, contentHash, sourceBytes, sourceContentType, sourceContentHash } =
    await observePublicSourceVersion(plan, deps);
  let duplicate: string | null;
  try {
    duplicate = await deps.findDuplicateVersion({
      catalogueKey: plan.catalogueKey,
      exactUrl: plan.exactUrl,
      exactVersion: plan.exactVersion,
      contentHash: sourceContentHash,
    });
  } catch {
    throw new Error("Public source duplicate-version validation failed.");
  }
  if (duplicate) throw new Error("Duplicate public source version already exists.");

  assertPublicSourceAcquisitionPlan(plan);
  const candidate = buildPublicSourceStagingCandidate(plan, {
    bytes,
    contentType,
    contentHash,
    sourceBytes,
    sourceContentType,
    sourceContentHash,
  });
  let staged: { documentId: string; ownerId: string | null };
  try {
    staged = await deps.stageOwnedDocument(candidate);
  } catch {
    throw new Error("Public source owned staging failed.");
  }
  if (!staged.ownerId || staged.ownerId !== plan.stagingOwnerId) {
    throw new Error("Public source staging adapter did not preserve the exact non-null owner.");
  }

  assertPublicSourceAcquisitionPlan(plan);
  try {
    await deps.enqueue({
      documentId: staged.documentId,
      ownerId: staged.ownerId,
      catalogueKey: plan.catalogueKey,
      contentMode: "indexed_content",
      exactDocumentLicence: "public_index_permitted",
      sourcePolicyVersion: plan.sourcePolicyVersion,
      sourcePolicyDigest: plan.sourcePolicyDigest,
      metadata: candidate.metadata,
    });
  } catch {
    throw new Error("Public source enqueue failed.");
  }
  deps.log?.({ event: "public_source_staged", catalogueKey: plan.catalogueKey, contentBytes: bytes.byteLength });
  return Object.freeze({
    documentId: staged.documentId,
    ownerId: staged.ownerId,
    contentHash: sourceContentHash,
    stagedContentHash: contentHash,
    lifecycle: "shadow" as const,
  });
}

export function buildPublicSourceStagingCandidate(
  plan: PublicSourceAcquisitionPlan,
  content: Readonly<{
    bytes: Uint8Array;
    contentType: string;
    contentHash: string;
    sourceBytes: Uint8Array;
    sourceContentType: string;
    sourceContentHash: string;
  }>,
): PublicSourceStagingCandidate {
  const definition = assertPublicSourceAcquisitionPlan(plan);
  return Object.freeze({
    ownerId: plan.stagingOwnerId,
    exactUrl: plan.exactUrl,
    exactVersion: plan.exactVersion,
    contentType: content.contentType,
    bytes: content.bytes,
    contentHash: content.contentHash,
    sourceBytes: content.sourceBytes,
    sourceContentType: content.sourceContentType,
    sourceContentHash: content.sourceContentHash,
    lifecycle: "shadow",
    metadata: Object.freeze({
      corpus_scope: definition.corpusScope,
      source_catalogue_key: plan.catalogueKey,
      source_policy_version: plan.sourcePolicyVersion,
      source_policy_digest: plan.sourcePolicyDigest,
      content_mode: definition.contentMode,
      licence_policy: plan.exactDocumentLicence,
      licence_evidence_digest: plan.licenceEvidenceDigest,
      source_canonical_url: definition.canonicalUrl,
      source_exact_url: plan.exactUrl,
      source_exact_version: plan.exactVersion,
      content_hash: content.contentHash,
      source_content_hash: content.sourceContentHash,
      source_content_type: content.sourceContentType,
      content_identity_verdict: "clear",
      content_identity_hash: content.contentHash,
      content_identity_verdict_version: publicSourceContentIdentityVerdictVersion,
      source_policy_checked: true,
      public_source_lifecycle: "shadow",
      ...(plan.sourceActivationEventId ? { source_activation_event_id: plan.sourceActivationEventId } : {}),
    }),
  });
}

export async function observePublicSourceVersion(
  plan: PublicSourceAcquisitionPlan,
  deps: {
    fetch: AcquisitionFetch;
    resolve: ResolveHost;
    scan: PublicSourceContentIdentityScan;
  },
) {
  assertPublicSourceAcquisitionPlan(plan);
  const response = await fetchBounded(plan, deps);
  return validateFetchedContent(plan, response, deps.scan);
}

export async function observePublicSourceChangeSignal(
  plan: PublicSourceAcquisitionPlan,
  deps: {
    fetch: AcquisitionFetch;
    resolve: ResolveHost;
    scan: PublicSourceContentIdentityScan;
  },
) {
  assertPublicSourceAcquisitionPlan(plan);
  const response = await fetchBounded(plan, deps, true);
  if (response.status === 404 || response.status === 410) {
    return Object.freeze({
      kind: "withdrawn" as const,
      reasonCode: response.status === 404 ? ("publisher_http_404" as const) : ("publisher_http_410" as const),
    });
  }
  const content = await validateFetchedContent(plan, response, deps.scan);
  return Object.freeze({
    kind: "content" as const,
    ...content,
    stagedContentHash: content.contentHash,
    contentHash: content.sourceContentHash,
  });
}

async function validateFetchedContent(
  plan: PublicSourceAcquisitionPlan,
  response: Response,
  scanContent: PublicSourceContentIdentityScan,
) {
  const upstreamContentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (!plan.allowedContentTypes.includes(upstreamContentType)) {
    throw new Error("Public source response content type is not approved.");
  }
  const { bytes: upstreamBytes, contentHash: sourceContentHash } = await readBoundedBody(response, plan.maxBytes);
  let bytes = upstreamBytes;
  let contentType = upstreamContentType;
  if (upstreamContentType === "text/html") {
    const trustedPage = evaluateTrustedPageContent(new TextDecoder().decode(upstreamBytes));
    if (!trustedPage.eligibleForIndex) {
      throw new Error("Public source page was quarantined because excluded-source evidence remained in main content.");
    }
    bytes = new TextEncoder().encode(trustedPage.mainText);
    contentType = "text/plain";
  } else if (
    upstreamContentType === "text/plain" &&
    forbiddenPublicSourceIdentity(new TextDecoder().decode(upstreamBytes))
  ) {
    throw new Error("Public source content was blocked by protected-source policy.");
  }
  const contentHash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  const uploadFile = new File([bytes], new URL(plan.exactUrl).pathname.split("/").pop() || "source", {
    type: contentType,
  });
  assertAllowedFile(uploadFile, plan.maxBytes / (1024 * 1024));
  assertFileContentSignature(contentType, bytes);
  await assertUploadStructure(contentType, bytes);
  let scan: PublicSourceContentIdentityVerdict;
  try {
    scan = await scanContent({ bytes, contentType, contentHash, catalogueKey: plan.catalogueKey });
  } catch {
    throw new Error("Public source upload validation failed.");
  }
  if (
    !scan.accepted ||
    scan.contentIdentity !== "clear" ||
    scan.inspectedContentHash !== contentHash ||
    scan.verdictVersion !== publicSourceContentIdentityVerdictVersion
  ) {
    throw new Error("Public source trusted content-identity validation blocked content.");
  }
  return Object.freeze({
    bytes,
    contentType,
    contentHash,
    sourceBytes: upstreamBytes,
    sourceContentType: upstreamContentType,
    sourceContentHash,
  });
}

function decodeHtmlText(input: string) {
  return input
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/** Conservative synthetic-HTML boundary: only retained main content can proceed to indexing. */
export function evaluateTrustedPageContent(html: string) {
  const withoutChrome = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(
      /<(?:script|style|template|header|nav|footer|aside)\b[^>]*>[\s\S]*?<\/(?:script|style|template|header|nav|footer|aside)>/gi,
      " ",
    );
  const mainMatch = withoutChrome.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);
  const retainedHtml = mainMatch?.[1] ?? withoutChrome;
  if (forbiddenPublicSourceIdentity(retainedHtml)) {
    return Object.freeze({
      disposition: "quarantine" as const,
      eligibleForIndex: false,
      mainText: "",
      retainedLinks: Object.freeze([] as string[]),
    });
  }
  const retainedLinks = [...retainedHtml.matchAll(/<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>/gi)]
    .map((match) => match[1])
    .filter((href) => !forbiddenPublicSourceIdentity(href));
  return Object.freeze({
    disposition: "accepted" as const,
    eligibleForIndex: true,
    mainText: decodeHtmlText(retainedHtml),
    retainedLinks: Object.freeze(retainedLinks),
  });
}

export async function checkPublicSourceChange(input: {
  plan: PublicSourceAcquisitionPlan;
  currentVersion: Readonly<{
    catalogueKey: string;
    versionId: string;
    exactUrl: string;
    exactVersion: string;
    contentHash: string;
    lifecycle: "active";
  }>;
  observed:
    | Readonly<{ kind: "content"; contentHash: string }>
    | Readonly<{ kind: "withdrawn"; reasonCode: "publisher_http_404" | "publisher_http_410" }>;
  recordCheck: (event: Readonly<Record<string, string>>) => Promise<void>;
  stageChangedVersion: (candidate: Readonly<Record<string, string | boolean | null>>) => Promise<{
    versionId: string;
    ownerId: string | null;
  }>;
  tombstoneAndQueueReview: (event: Readonly<Record<string, string>>) => Promise<unknown>;
}) {
  assertPublicSourceAcquisitionPlan(input.plan);
  if (
    input.currentVersion.catalogueKey !== input.plan.catalogueKey ||
    input.currentVersion.exactUrl !== input.plan.exactUrl ||
    input.currentVersion.exactVersion !== input.plan.exactVersion ||
    input.currentVersion.lifecycle !== "active" ||
    !sha256Pattern.test(input.currentVersion.contentHash)
  ) {
    throw new Error("Current public source version identity does not match the acquisition plan.");
  }
  if (input.observed.kind === "withdrawn") {
    const event = {
      catalogueKey: input.plan.catalogueKey,
      versionId: input.currentVersion.versionId,
      exactUrl: input.currentVersion.exactUrl,
      exactVersion: input.currentVersion.exactVersion,
      contentHash: input.currentVersion.contentHash,
      reasonCode: input.observed.reasonCode,
    };
    await input.tombstoneAndQueueReview(event);
    return Object.freeze({ outcome: "tombstoned" as const });
  }
  if (input.observed.contentHash === input.currentVersion.contentHash) {
    await input.recordCheck({
      catalogueKey: input.plan.catalogueKey,
      versionId: input.currentVersion.versionId,
      outcome: "unchanged",
      contentHash: input.observed.contentHash,
    });
    return Object.freeze({ outcome: "unchanged" as const });
  }
  const staged = await input.stageChangedVersion({
    catalogueKey: input.plan.catalogueKey,
    currentVersionId: input.currentVersion.versionId,
    contentHash: input.observed.contentHash,
    lifecycle: "shadow",
    ownerId: input.plan.stagingOwnerId,
    supersedesVersionId: null,
    activate: false,
  });
  if (staged.ownerId !== input.plan.stagingOwnerId) {
    throw new Error("Changed public source version must remain owned staging content.");
  }
  return Object.freeze({
    outcome: "changed" as const,
    lifecycle: "shadow" as const,
    versionId: staged.versionId,
    ownerId: staged.ownerId,
  });
}
