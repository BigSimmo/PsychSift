import { createHmac } from "node:crypto";
import type { createAdminClient } from "@/lib/supabase/admin";
import {
  consumeSubjectApiRateLimit,
  allowRateLimitInMemoryFallbackOnUnavailable,
  type ApiRateLimitResult,
} from "@/lib/api-rate-limit";
import { AuthenticationError, getOptionalAuthenticatedUser } from "@/lib/supabase/auth";

type AdminClient = ReturnType<typeof createAdminClient>;

export type RateLimitSubject = { kind: "owner"; ownerId: string } | { kind: "anonymous"; subjectKey: string };

/**
 * Extracts the last non-empty IP address from a proxy forwarding header value.
 *
 * @param value - A comma-separated proxy forwarding header value
 * @returns The last trimmed IP address, or an empty string when no address is present
 */
function trustedProxyIp(value: string | null) {
  const forwarded = value
    ?.split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const ip = forwarded?.at(-1) ?? "";

  // Strip IPv6 brackets and any port (e.g. [2001:db8::1]:443 -> 2001:db8::1)
  if (ip.startsWith("[")) {
    const endPos = ip.indexOf("]");
    if (endPos !== -1) return ip.slice(1, endPos);
  }

  // Strip IPv4 port (e.g. 192.0.2.1:8080 -> 192.0.2.1)
  // Bare IPv6 addresses have multiple colons, so only split if there is exactly one colon
  const colonIndex = ip.indexOf(":");
  if (colonIndex !== -1 && colonIndex === ip.lastIndexOf(":")) {
    return ip.slice(0, colonIndex);
  }

  return ip;
}

/**
 * Determines the request's source IP from trusted proxy forwarding headers.
 *
 * @param request - The request containing the proxy forwarding headers
 * @returns The last non-empty address from `x-forwarded-for`, the address from `x-real-ip`, or `"unknown-ip"` when neither header provides an address
 */
function requestIpSignal(request: Request) {
  return (
    trustedProxyIp(request.headers.get("x-forwarded-for")) ||
    trustedProxyIp(request.headers.get("x-real-ip")) ||
    "unknown-ip"
  );
}

/**
 * Creates a stable anonymous rate-limit subject key from the request's trusted proxy IP signal.
 *
 * @param request - The request from which to derive the IP signal
 * @returns A prefixed, truncated SHA-256 hash of the source IP signal
 */
export function anonymousApiSubjectKey(request: Request) {
  // Trust only the deployment proxy's appended forwarding entry. Ignore the
  // caller-controlled Cloudflare/User-Agent values and any leading XFF entries:
  // Railway appends the trusted client address at the right edge of the chain.
  // If no trusted proxy IP is available, every unknown caller intentionally
  // shares the same conservative quota rather than failing open.
  const source = requestIpSignal(request);
  const salt =
    process.env.RATE_LIMIT_SALT ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    "ps-anon-subject";
  return `anon:${createHmac("sha256", salt).update(source).digest("hex").slice(0, 32)}`;
}

const OWNER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type OwnerScopedQuery<T> = {
  eq(column: string, value: unknown): T;
  is(column: string, value: null): T;
  or(filters: string): T;
};

/**
 * A document is public only when publication deliberately made it so.
 *
 * `documents.owner_id` is `on delete set null`, so deleting an auth user blanks the owner of
 * every document that user held. Treating "no owner" as "public" would then silently publish
 * that user's private clinical documents — no error, no audit signal, and an erasure request
 * is exactly the situation that triggers it.
 *
 * `publish_approved_documents` is the only writer of a null `documents.owner_id`, and it always
 * stamps `metadata.public_corpus = true` in the same statement. Requiring the marker is
 * therefore equivalent for every deliberately published document and excludes orphans. An
 * orphaned row fails closed — invisible rather than exposed — which is the direction this
 * system is meant to fail in.
 */
const PUBLIC_CORPUS_MARKER_FILTER = "metadata->>public_corpus.eq.true";

/**
 * Scope reads to the public corpus and, when signed in, the caller's owned rows.
 *
 * Anonymous callers intentionally see ONLY the public corpus. Uploads are administrator-only;
 * newly uploaded owner-scoped documents remain private until the existing publication-review
 * workflow promotes them to the public corpus.
 *
 * Every call site of this helper queries `documents`, which is the table carrying the
 * publication marker. Applying it to a table without a `metadata` column would filter
 * everything out, so keep new call sites on `documents`.
 */
export function withOwnerReadScope<T extends OwnerScopedQuery<T>>(query: T, ownerId: string | undefined): T {
  // The owner id is interpolated into a PostgREST `or=` filter string, where a comma,
  // parenthesis, or dot is filter syntax rather than data. Supabase user ids are always
  // UUIDs, so anything else is rejected and the read falls back to the public corpus
  // instead of letting a crafted identity widen the filter.
  if (ownerId && OWNER_ID_PATTERN.test(ownerId)) {
    return query.or(`owner_id.eq.${ownerId},and(owner_id.is.null,${PUBLIC_CORPUS_MARKER_FILTER})`);
  }
  return query.is("owner_id", null).eq("metadata->>public_corpus", "true");
}

// Owner-internal document columns that must never be exposed on a row the caller does not own.
// `withOwnerReadScope` lets an authenticated caller read PUBLIC documents (owner_id IS NULL) that
// belong to nobody; those rows must not leak the storage location, dedup hash, import provenance,
// raw stage error, or free-form `metadata` of the operator who ingested them. `metadata` is
// arbitrary and can carry owner-internal provenance (e.g. the bulk-edit author's user id, prior
// titles, indexing internals), so — matching the anonymous list projection and the `[id]` detail
// route — it is stripped for non-owners rather than surfaced as governance data.
const NON_OWNER_INTERNAL_DOCUMENT_FIELDS = [
  "owner_id",
  "storage_path",
  "content_hash",
  "source_path",
  "import_batch_id",
  "error_message",
  "metadata",
  "source_chunk_ids",
  "source_image_ids",
  "model",
] as const;

/** True when `viewerOwnerId` is set and owns the row (i.e. the caller's own document). */
export function callerOwnsDocumentRow(row: { owner_id?: unknown }, viewerOwnerId: string | undefined): boolean {
  return Boolean(viewerOwnerId) && row.owner_id === viewerOwnerId;
}

/**
 * Strip operator-internal storage fields from a document row unless the caller owns it.
 *
 * No-op for owned rows and for rows already selected without those columns (e.g. the anonymous
 * public projection), so it is safe to map over every returned row regardless of caller identity.
 */
export function redactNonOwnedDocumentFields<T extends Record<string, unknown>>(
  row: T,
  viewerOwnerId: string | undefined,
): T {
  if (callerOwnsDocumentRow(row, viewerOwnerId)) return row;
  const redacted = { ...row };
  for (const field of NON_OWNER_INTERNAL_DOCUMENT_FIELDS) {
    delete redacted[field];
  }
  return redacted;
}

export async function publicAccessContext(request: Request, supabase: AdminClient) {
  const user = await getOptionalAuthenticatedUser(request, supabase);
  if (user) {
    return {
      authenticated: true,
      ownerId: user.id,
      rateLimitSubject: { kind: "owner", ownerId: user.id } satisfies RateLimitSubject,
    };
  }

  return {
    authenticated: false,
    ownerId: undefined,
    rateLimitSubject: { kind: "anonymous", subjectKey: anonymousApiSubjectKey(request) } satisfies RateLimitSubject,
  };
}

/**
 * Access context for public catalogue GETs (Services, Forms, Medications,
 * Differentials, universal search domains that read those catalogues).
 *
 * `publicAccessContext` deliberately refuses invalid credentials so a stale
 * cookie cannot silently become "anonymous" on routes that also return private
 * owner rows. Catalogue list/detail GETs are different: the public corpus is
 * meant to stay readable without a session, and a hard 401 blanks the mode with
 * "Could not load services/forms" for clinicians who still carry an expired PWA
 * cookie. Fall back to anonymous rate-limit scope; private rows stay unreachable
 * because anonymous reads never leave the public corpus.
 */
export async function publicCatalogueAccessContext(request: Request, supabase: AdminClient) {
  try {
    return await publicAccessContext(request, supabase);
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return {
        authenticated: false,
        ownerId: undefined,
        rateLimitSubject: {
          kind: "anonymous",
          subjectKey: anonymousApiSubjectKey(request),
        } satisfies RateLimitSubject,
      };
    }
    throw error;
  }
}

export async function enforceDocumentReadRateLimit(
  request: Request,
  supabase: AdminClient,
): Promise<{ access: Awaited<ReturnType<typeof publicAccessContext>>; rateLimit: ApiRateLimitResult }> {
  const access = await publicAccessContext(request, supabase);
  const rateLimit = await consumeSubjectApiRateLimit({
    supabase,
    subject: access.rateLimitSubject,
    bucket: "document_read",
    allowInMemoryFallbackOnUnavailable: allowRateLimitInMemoryFallbackOnUnavailable(),
  });
  return { access, rateLimit };
}
