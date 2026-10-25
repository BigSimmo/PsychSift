import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { lookup as dnsLookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { request as httpsRequest } from "node:https";
import { pipeline, Readable, type Transform } from "node:stream";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import { z } from "zod";

import {
  assertIndexableCatalogueEntry,
  australianSourceByKey,
  australianSourcePolicyVersion,
  type AustralianSourceDefinition,
  type SourceLicencePolicy,
} from "@/lib/australian-source-catalogue";
import { assertAllowedFile, assertFileContentSignature } from "@/lib/http";
import {
  parsePublicSourceActivationManifest,
  publicSourcePolicyDigest,
  type PublicSourceActivationManifestV1,
} from "@/lib/public-source-activation-manifest";
import { MAX_UPLOAD_MB_CEILING } from "@/lib/upload-limits";
import { assertUploadStructure } from "@/lib/upload-structure";

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const uuidSchema = z.string().uuid();
const maximumAcquisitionBytes = MAX_UPLOAD_MB_CEILING * 1024 * 1024;
type JsdomConstructor = new (
  html: string,
  options: { contentType: string },
) => {
  window: { document: Document; close(): void };
};

/**
 * jsdom is a dev dependency, absent from the production image. Load it only
 * when HTML is actually extracted (the source-acquisition scripts), never at
 * import: Roster's calendar-link code imports this module for
 * `isGlobalPublicAddress`, and a top-level require crashed every Roster route
 * that reached it in production.
 */
function loadJsdom(): JsdomConstructor {
  return (createRequire(import.meta.url)("jsdom") as { JSDOM: JsdomConstructor }).JSDOM;
}

const acquisitionPlanSchema = z
  .object({
    version: z.literal(1),
    sourcePolicyVersion: z.literal(australianSourcePolicyVersion),
    sourcePolicyDigest: sha256Schema,
    activationEventId: uuidSchema,
    activationSequence: z.number().int().positive(),
    catalogueKey: z.string().trim().min(1).max(100),
    exactUrl: z.string().url().max(4_000),
    exactVersion: z.string().trim().min(1).max(200),
    exactDocumentLicence: z.literal("public_index_permitted"),
    licenceEvidenceDigest: sha256Schema,
    stewardId: uuidSchema,
    lifecycle: z.literal("discovered"),
  })
  .strict();

export type PublicSourceAcquisitionPlan = Readonly<z.infer<typeof acquisitionPlanSchema>>;
export type ResolvedAcquisitionAddress = { address: string; family: 4 | 6 };
export type AcquisitionResolver = (hostname: string, signal?: AbortSignal) => Promise<ResolvedAcquisitionAddress[]>;
export type AcquisitionResponse = {
  status: number;
  headers: Record<string, string | undefined>;
  body: AsyncIterable<Uint8Array>;
  cancel?: () => void;
};
export type AcquisitionRequestInput = {
  url: URL;
  hostname: string;
  address: string;
  family: 4 | 6;
  signal: AbortSignal;
};
export type AcquisitionRequest = (input: AcquisitionRequestInput) => Promise<AcquisitionResponse>;

type SafeAcquisitionFacts = {
  catalogueKey: string;
  hostname: string;
  statusClass?: string;
  byteCount?: number;
  digest?: string;
  disposition?: string;
};

export class PublicSourceAcquisitionError extends Error {
  readonly facts: SafeAcquisitionFacts;

  constructor(message: string, facts: SafeAcquisitionFacts) {
    super(message);
    this.name = "PublicSourceAcquisitionError";
    this.facts = facts;
  }

  toJSON() {
    return { name: this.name, message: this.message, ...this.facts };
  }
}

const nonGlobalAddresses = new BlockList();
for (const [network, prefix, family] of [
  ["0.0.0.0", 8, "ipv4"],
  ["10.0.0.0", 8, "ipv4"],
  ["100.64.0.0", 10, "ipv4"],
  ["127.0.0.0", 8, "ipv4"],
  ["169.254.0.0", 16, "ipv4"],
  ["172.16.0.0", 12, "ipv4"],
  ["192.0.0.0", 24, "ipv4"],
  ["192.0.2.0", 24, "ipv4"],
  ["192.88.99.0", 24, "ipv4"],
  ["192.168.0.0", 16, "ipv4"],
  ["198.18.0.0", 15, "ipv4"],
  ["198.51.100.0", 24, "ipv4"],
  ["203.0.113.0", 24, "ipv4"],
  ["224.0.0.0", 4, "ipv4"],
  ["240.0.0.0", 4, "ipv4"],
  ["::", 96, "ipv6"],
  ["::1", 128, "ipv6"],
  ["64:ff9b:1::", 48, "ipv6"],
  ["100::", 64, "ipv6"],
  ["2001::", 23, "ipv6"],
  ["2001:2::", 48, "ipv6"],
  ["2001:db8::", 32, "ipv6"],
  ["2002::", 16, "ipv6"],
  ["2620:4f:8000::", 48, "ipv6"],
  ["3fff::", 20, "ipv6"],
  ["5f00::", 16, "ipv6"],
  ["fc00::", 7, "ipv6"],
  ["fe80::", 10, "ipv6"],
  ["fec0::", 10, "ipv6"],
  ["ff00::", 8, "ipv6"],
] as const) {
  nonGlobalAddresses.addSubnet(network, prefix, family);
}

export function isGlobalPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !nonGlobalAddresses.check(address, "ipv4");
  if (family === 6) {
    if (/^::ffff:(?:\d{1,3}\.){3}\d{1,3}$/i.test(address) || /^::ffff:[0-9a-f]{1,4}:[0-9a-f]{1,4}$/i.test(address)) {
      return false;
    }
    return !nonGlobalAddresses.check(address, "ipv6");
  }
  return false;
}

function assertStaticAcquisitionUrl(rawUrl: string, definition: AustralianSourceDefinition): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("Acquisition URL is invalid.");
  }
  if (url.protocol !== "https:") throw new Error("Acquisition URL must use HTTPS.");
  if (url.username || url.password) throw new Error("Acquisition URL credentials are forbidden.");
  if (url.hash) throw new Error("Acquisition URL fragments are forbidden.");
  if (url.port && url.port !== "443") throw new Error("Acquisition URL must use port 443.");
  if (isIP(url.hostname) !== 0) throw new Error("Acquisition URL IP literals are forbidden.");
  const allowedHostname = new URL(definition.canonicalUrl).hostname.toLowerCase();
  if (url.hostname.toLowerCase() !== allowedHostname) throw new Error("Acquisition URL hostname is not allowlisted.");
  return url;
}

const defaultResolver: AcquisitionResolver = async (hostname) => {
  const answers = await dnsLookup(hostname, { all: true, verbatim: true });
  return answers.map((answer) => {
    if (answer.family !== 4 && answer.family !== 6) throw new Error("Acquisition DNS address family is invalid.");
    return { address: answer.address, family: answer.family };
  });
};

function raceWithAbort<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return operation;
  if (signal.aborted) return Promise.reject(signal.reason ?? new Error("Acquisition cancelled."));
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new Error("Acquisition cancelled."));
    signal.addEventListener("abort", abort, { once: true });
    operation.then(
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

export async function validateAcquisitionUrl(
  rawUrl: string,
  definition: AustralianSourceDefinition,
  dependencies: { resolve?: AcquisitionResolver; signal?: AbortSignal } = {},
) {
  const url = assertStaticAcquisitionUrl(rawUrl, definition);
  const resolver = dependencies.resolve ?? defaultResolver;
  const answers = await raceWithAbort(resolver(url.hostname, dependencies.signal), dependencies.signal);
  if (answers.length === 0) throw new Error("Acquisition hostname returned no DNS addresses.");
  if (answers.some((answer) => !isGlobalPublicAddress(answer.address))) {
    throw new Error("Acquisition hostname resolved to a private or non-global address.");
  }
  const answer = [...answers].sort((left, right) =>
    left.address < right.address ? -1 : left.address > right.address ? 1 : left.family - right.family,
  )[0]!;
  return { url, hostname: url.hostname, address: answer.address, family: answer.family };
}

export async function validateRedirect(
  rawUrl: string,
  definition: AustralianSourceDefinition,
  dependencies: { resolve?: AcquisitionResolver; signal?: AbortSignal } = {},
) {
  return validateAcquisitionUrl(rawUrl, definition, dependencies);
}

function freezePlan(plan: z.infer<typeof acquisitionPlanSchema>): PublicSourceAcquisitionPlan {
  return Object.freeze(plan);
}

export async function planAcquisition(input: {
  catalogueKey: string;
  exactUrl?: string;
  url?: string;
  exactVersion?: string;
  exactDocumentLicence?: SourceLicencePolicy;
  licenceEvidenceDigest?: string;
  stewardId?: string | null;
  activationEventId?: string | null;
  activationSequence?: number | null;
  activationManifest?: PublicSourceActivationManifestV1 | unknown;
  resolve?: AcquisitionResolver;
  request?: AcquisitionRequest;
  fetch?: unknown;
}): Promise<PublicSourceAcquisitionPlan> {
  const definition = australianSourceByKey(input.catalogueKey);
  if (!definition) throw new Error("Source is not in the active catalogue.");
  assertIndexableCatalogueEntry(definition);

  const activationManifest = parsePublicSourceActivationManifest(input.activationManifest);
  if (activationManifest.decision !== "activate" || activationManifest.catalogueKey !== definition.key) {
    throw new Error("A matching active source definition is required for acquisition.");
  }
  if (input.exactDocumentLicence !== "public_index_permitted") {
    throw new Error("Exact document licence must permit public indexing.");
  }
  if (!input.stewardId) throw new Error("A non-null staging steward is required.");
  if (!input.activationEventId) throw new Error("A source activation event is required.");
  if (!Number.isSafeInteger(input.activationSequence) || (input.activationSequence ?? 0) < 1) {
    throw new Error("A positive activation event sequence is required.");
  }
  const exactUrl = input.exactUrl ?? input.url;
  if (!exactUrl) throw new Error("An exact operator-supplied URL is required.");
  assertStaticAcquisitionUrl(exactUrl, definition);

  return freezePlan(
    acquisitionPlanSchema.parse({
      version: 1,
      sourcePolicyVersion: australianSourcePolicyVersion,
      sourcePolicyDigest: publicSourcePolicyDigest,
      activationEventId: input.activationEventId,
      activationSequence: input.activationSequence,
      catalogueKey: definition.key,
      exactUrl,
      exactVersion: input.exactVersion,
      exactDocumentLicence: input.exactDocumentLicence,
      licenceEvidenceDigest: input.licenceEvidenceDigest,
      stewardId: input.stewardId,
      lifecycle: "discovered",
    }),
  );
}

export function parsePublicSourceAcquisitionPlan(input: unknown): PublicSourceAcquisitionPlan {
  const plan = acquisitionPlanSchema.parse(input);
  if (plan.sourcePolicyDigest !== publicSourcePolicyDigest) throw new Error("Acquisition plan policy digest changed.");
  const definition = australianSourceByKey(plan.catalogueKey);
  assertIndexableCatalogueEntry(definition);
  assertStaticAcquisitionUrl(plan.exactUrl, definition);
  return freezePlan(plan);
}

export function acquisitionPlanDigest(plan: PublicSourceAcquisitionPlan): string {
  return createHash("sha256").update(JSON.stringify(plan), "utf8").digest("hex");
}

const defaultRequest: AcquisitionRequest = async ({ url, hostname, address, family, signal }) =>
  new Promise((resolve, reject) => {
    const request = httpsRequest(
      url,
      {
        method: "GET",
        headers: {
          accept:
            "application/pdf, application/vnd.openxmlformats-officedocument.wordprocessingml.document, text/plain, text/html",
        },
        servername: hostname,
        lookup: (_hostname, options, callback) =>
          options?.all ? callback(null, [{ address, family }]) : callback(null, address, family),
        signal,
      },
      (response) => {
        const headers = Object.fromEntries(
          Object.entries(response.headers).map(([key, value]) => [
            key.toLowerCase(),
            Array.isArray(value) ? value[0] : value,
          ]),
        );
        resolve({
          status: response.statusCode ?? 0,
          headers,
          body: response,
          cancel: () => response.destroy(),
        });
      },
    );
    request.once("error", reject);
    request.end();
  });

function decompressedBody(response: AcquisitionResponse): AsyncIterable<Uint8Array> {
  const encoding = response.headers["content-encoding"]?.trim().toLowerCase();
  const source = Readable.from(response.body);
  if (!encoding || encoding === "identity") return source;
  // pipeline, not pipe: a body that fails or is destroyed by a timeout must fail the decompressor
  // too, or the read loop waits on it forever. The loop sees the error through the decompressor.
  const decompress = (decompressor: Transform) => pipeline(source, decompressor, () => undefined);
  if (encoding === "gzip") return decompress(createGunzip());
  if (encoding === "deflate") return decompress(createInflate());
  if (encoding === "br") return decompress(createBrotliDecompress());
  throw new Error("Unsupported response content encoding.");
}

function safeError(
  message: string,
  plan: PublicSourceAcquisitionPlan,
  url: URL,
  extras: Partial<SafeAcquisitionFacts> = {},
) {
  return new PublicSourceAcquisitionError(message, {
    catalogueKey: plan.catalogueKey,
    hostname: url.hostname,
    ...extras,
  });
}

export async function fetchApprovedPublicSource(
  planInput: PublicSourceAcquisitionPlan,
  dependencies: {
    resolve?: AcquisitionResolver;
    request?: AcquisitionRequest;
    maxBytes?: number;
    totalTimeoutMs?: number;
    inactivityTimeoutMs?: number;
    signal?: AbortSignal;
  } = {},
) {
  const plan = parsePublicSourceAcquisitionPlan(planInput);
  const definition = australianSourceByKey(plan.catalogueKey)!;
  const resolve = dependencies.resolve ?? defaultResolver;
  const request = dependencies.request ?? defaultRequest;
  const maxBytes = Math.min(dependencies.maxBytes ?? maximumAcquisitionBytes, maximumAcquisitionBytes);
  const totalTimeoutMs = dependencies.totalTimeoutMs ?? 120_000;
  const inactivityTimeoutMs = dependencies.inactivityTimeoutMs ?? 15_000;
  const controller = new AbortController();
  const externalSignal = dependencies.signal;
  if (externalSignal?.aborted) throw safeError("Acquisition cancelled.", plan, new URL(plan.exactUrl));
  const abortFromCaller = () => controller.abort(externalSignal?.reason);
  externalSignal?.addEventListener("abort", abortFromCaller, { once: true });
  const totalTimer = setTimeout(() => controller.abort(new Error("Acquisition total timeout.")), totalTimeoutMs);

  let currentUrl = new URL(plan.exactUrl);
  const visited = new Set<string>();
  try {
    for (let redirectCount = 0; ; redirectCount += 1) {
      if (controller.signal.aborted) throw safeError("Acquisition cancelled or timed out.", plan, currentUrl);
      if (visited.has(currentUrl.href)) throw safeError("Acquisition redirect loop rejected.", plan, currentUrl);
      visited.add(currentUrl.href);
      let validated: Awaited<ReturnType<typeof validateAcquisitionUrl>>;
      try {
        validated = await validateAcquisitionUrl(currentUrl.href, definition, { resolve, signal: controller.signal });
      } catch {
        throw safeError("Acquisition URL or DNS validation failed.", plan, currentUrl);
      }
      let response: AcquisitionResponse;
      try {
        response = await request({ ...validated, signal: controller.signal });
      } catch {
        throw safeError("Acquisition request failed or timed out.", plan, currentUrl);
      }
      if (response.status >= 300 && response.status < 400) {
        response.cancel?.();
        const location = response.headers.location;
        if (!location)
          throw safeError("Acquisition redirect omitted a location.", plan, currentUrl, { statusClass: "3xx" });
        if (redirectCount >= 3)
          throw safeError("Acquisition exceeded three redirects.", plan, currentUrl, { statusClass: "3xx" });
        let redirectUrl: URL;
        try {
          redirectUrl = new URL(location, currentUrl);
          // The next loop iteration resolves, validates every returned address,
          // and pins one of them into the request. Static validation here rejects
          // an off-host redirect without performing a redundant DNS lookup.
          assertStaticAcquisitionUrl(redirectUrl.href, definition);
        } catch {
          throw safeError("Acquisition redirect URL was rejected.", plan, currentUrl, { statusClass: "3xx" });
        }
        currentUrl = redirectUrl;
        continue;
      }
      if (response.status < 200 || response.status >= 300) {
        response.cancel?.();
        throw safeError("Acquisition request failed.", plan, currentUrl, {
          statusClass: `${Math.floor(response.status / 100)}xx`,
          ...(response.status === 404 || response.status === 410 ? { disposition: "withdrawal" } : {}),
        });
      }
      const declaredLength = Number(response.headers["content-length"] ?? "");
      if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
        response.cancel?.();
        throw safeError("Acquisition exceeded the byte limit.", plan, currentUrl, { byteCount: declaredLength });
      }

      const parts: Buffer[] = [];
      const hash = createHash("sha256");
      let byteCount = 0;
      let inactivityTimer: ReturnType<typeof setTimeout> | undefined;
      const armInactivity = () => {
        clearTimeout(inactivityTimer);
        inactivityTimer = setTimeout(
          () => controller.abort(new Error("Acquisition inactivity timeout.")),
          inactivityTimeoutMs,
        );
      };
      try {
        armInactivity();
        for await (const value of decompressedBody(response)) {
          if (controller.signal.aborted) throw new Error("Acquisition cancelled or timed out.");
          armInactivity();
          const part = Buffer.from(value);
          byteCount += part.byteLength;
          if (byteCount > maxBytes) throw new Error("Acquisition exceeded the byte limit.");
          hash.update(part);
          parts.push(part);
        }
      } catch (error) {
        response.cancel?.();
        throw safeError(
          error instanceof Error && /byte limit/i.test(error.message)
            ? "Acquisition exceeded the streamed/decompressed byte limit."
            : "Acquisition stream cancelled, timed out, or failed.",
          plan,
          currentUrl,
          { byteCount },
        );
      } finally {
        clearTimeout(inactivityTimer);
      }
      const content = Buffer.concat(parts, byteCount);
      const rawResponseHash = hash.digest("hex");
      const rawResponseByteCount = byteCount;
      let validatedContent: Awaited<ReturnType<typeof validateFetchedPublicSource>>;
      try {
        validatedContent = await validateFetchedPublicSource({
          mime: response.headers["content-type"] ?? "",
          content,
        });
      } catch {
        throw safeError("Acquired content failed type or structure validation.", plan, currentUrl, {
          byteCount,
          digest: rawResponseHash,
        });
      }
      const contentHash = createHash("sha256").update(validatedContent.content).digest("hex");
      return {
        finalUrl: currentUrl.href,
        contentHash,
        byteCount: validatedContent.content.byteLength,
        rawResponseHash,
        rawResponseByteCount,
        ...validatedContent,
      };
    }
  } finally {
    clearTimeout(totalTimer);
    externalSignal?.removeEventListener("abort", abortFromCaller);
  }
}

export function normalizeAcquisitionMime(value: string): string {
  return value.split(";", 1)[0]!.trim().toLowerCase();
}

export function extractTrustedHtmlContent(html: string): {
  text: string;
  content: Buffer;
  mime: "text/plain";
  disposition: "shadow" | "quarantined";
} {
  const JSDOM = loadJsdom();
  const dom = new JSDOM(html, { contentType: "text/html" });
  try {
    const directlyHidden = (element: Element) => {
      const style = element.getAttribute("style") ?? "";
      return (
        element.hasAttribute("hidden") ||
        element.hasAttribute("inert") ||
        element.getAttribute("aria-hidden")?.toLowerCase() === "true" ||
        /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)(?:\s*!important)?\s*(?:;|$)/i.test(style)
      );
    };
    const hidden = (element: Element) => {
      for (let current: Element | null = element; current; current = current.parentElement) {
        if (directlyHidden(current)) return true;
      }
      return false;
    };
    const retained = [...dom.window.document.querySelectorAll("main, article")].find((element) => !hidden(element));
    if (!retained) throw new Error("Trusted HTML must contain a visible explicit main or article region.");
    const safe = retained.cloneNode(true) as Element;
    for (const element of safe.querySelectorAll(
      [
        "script",
        "style",
        "template",
        "noscript",
        "iframe",
        "object",
        "embed",
        "svg",
        "canvas",
        "form",
        "button",
        "input",
        "video",
        "audio",
        "source",
        "picture",
        "img",
        "link",
        "meta",
        "base",
        "nav",
        "header",
        "footer",
        "aside",
        '[role="navigation"]',
        '[role="banner"]',
        '[role="contentinfo"]',
        '[role="complementary"]',
        '[role="search"]',
        ".navigation",
        ".site-header",
        ".site-footer",
        ".sidebar",
        ".breadcrumb",
        ".breadcrumbs",
        ".cookie-banner",
      ].join(","),
    )) {
      element.remove();
    }
    for (const element of safe.querySelectorAll("*")) if (hidden(element)) element.remove();
    const text = (safe.textContent ?? "").replace(/\s+/g, " ").trim();
    if (!text) throw new Error("Trusted HTML main content is empty.");
    const disposition = /health\s*direct/i.test(text) ? "quarantined" : "shadow";
    return { text, content: Buffer.from(text, "utf8"), mime: "text/plain", disposition };
  } finally {
    dom.window.close();
  }
}

export async function validateFetchedPublicSource(input: { mime: string; content: Uint8Array }) {
  const mime = normalizeAcquisitionMime(input.mime);
  if (mime === "text/html") return extractTrustedHtmlContent(Buffer.from(input.content).toString("utf8"));
  const fileBytes = new Uint8Array(input.content.byteLength);
  fileBytes.set(input.content);
  const file = new File([fileBytes], "controlled-source", { type: mime });
  assertAllowedFile(file, MAX_UPLOAD_MB_CEILING);
  assertFileContentSignature(mime, input.content);
  await assertUploadStructure(mime, input.content);
  return { mime, content: Buffer.from(input.content), disposition: "shadow" as const };
}

export function classifyPublicSourceChange(input: {
  plan: PublicSourceAcquisitionPlan;
  currentHash: string;
  fetchedHash?: string;
  withdrawal?: boolean;
}) {
  parsePublicSourceAcquisitionPlan(input.plan);
  sha256Schema.parse(input.currentHash);
  if (input.withdrawal) {
    return {
      disposition: "tombstoned" as const,
      createVersion: false,
      removeFromRetrieval: true,
      queueHumanReview: true,
    };
  }
  const fetchedHash = sha256Schema.parse(input.fetchedHash);
  if (fetchedHash === input.currentHash) return { disposition: "unchanged" as const, createVersion: false };
  return { disposition: "shadow" as const, createVersion: true, supersedeCurrent: false };
}

export type FetchApprovedSourceArgs = {
  manifestPath: string;
  apply: boolean;
  expectedCount?: number;
  confirmSha256?: string;
};

export function parseFetchApprovedSourceArgs(argv: string[]): FetchApprovedSourceArgs {
  let manifestPath: string | undefined;
  let expectedCount: number | undefined;
  let confirmSha256: string | undefined;
  let apply = false;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--manifest") manifestPath = argv[++index];
    else if (token === "--expected-count") expectedCount = Number(argv[++index]);
    else if (token === "--confirm-sha256") confirmSha256 = argv[++index]?.toLowerCase();
    else if (token === "--apply") apply = true;
    else throw new Error(`Unknown argument: ${token}`);
  }
  if (!manifestPath) throw new Error("--manifest <path> is required.");
  if (expectedCount !== undefined && (!Number.isSafeInteger(expectedCount) || expectedCount < 1)) {
    throw new Error("--expected-count must be a positive integer.");
  }
  if (confirmSha256 !== undefined && !sha256Schema.safeParse(confirmSha256).success) {
    throw new Error("--confirm-sha256 must be a lowercase SHA-256 digest.");
  }
  if (apply && expectedCount === undefined) throw new Error("--expected-count is required with --apply.");
  if (apply && confirmSha256 === undefined) throw new Error("--confirm-sha256 is required with --apply.");
  return {
    manifestPath,
    apply,
    ...(expectedCount === undefined ? {} : { expectedCount }),
    ...(confirmSha256 ? { confirmSha256 } : {}),
  };
}
