import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { updateOnCallEntrySchema } from "@/lib/on-call/api-schemas";

const list = readFileSync("src/app/api/on-call/entries/route.ts", "utf8");
const detail = readFileSync("src/app/api/on-call/entries/[id]/route.ts", "utf8");
const verify = readFileSync("src/app/api/on-call/entries/[id]/verify/route.ts", "utf8");

describe("On Call entries route", () => {
  // 2026-09-04 opened the shared entries to anonymous callers; 2026-09-26 reverses that: shared
  // entries are for signed-in users only, so an anonymous caller gets an empty list and
  // `signedOut: true`, which the client shows its sign-in state on. The caller still passes the
  // rate limiter first. tests/on-call-entries-route.test.ts runs the handler itself.
  it("answers an anonymous caller with no entries before reading anything", () => {
    expect(list).toContain("fetchVisibleOnCallEntries");
    expect(list).toMatch(/if \(!access\.ownerId\) return NextResponse\.json\(\{ entries: \[\], signedOut: true \}\)/);
    expect(list.indexOf("if (!access.ownerId)")).toBeLessThan(list.indexOf("await fetchVisibleOnCallEntries"));
  });

  it("still rate limits every caller before touching the database", () => {
    expect(list).toContain("consumeSubjectApiRateLimit");
    expect(list.indexOf("consumeSubjectApiRateLimit")).toBeLessThan(list.indexOf("fetchVisibleOnCallEntries"));
  });

  it("takes the owner from the access context, never from the request", () => {
    expect(list).not.toMatch(/body\.(owner_id|ownerId)/);
    expect(list).not.toMatch(/searchParams\.get\(\s*["']owner/);
  });

  it("uses the admin client and reads through the repository helper", () => {
    expect(list).toContain("createAdminClient");
    expect(list).toContain("fetchVisibleOnCallEntries");
    // The route must not reach past the helper to query the table itself: the personal-entry
    // exclusion that keeps world-readable reads safe lives inside it.
    expect(list).not.toContain('from("on_call_entries").select');
  });

  it("maps AuthenticationError to a 401 and falls through to jsonError otherwise", () => {
    expect(list).toContain("AuthenticationError");
    expect(list).toContain("unauthorizedResponse()");
    expect(list).toContain("jsonError(error)");
  });

  it("validates linked document IDs before inserting into the database", () => {
    expect(list).toContain("assertValidLinkedDocumentIds");
    const callIndex = list.indexOf("assertValidLinkedDocumentIds(supabase");
    const insertIndex = list.indexOf('.from("on_call_entries")');
    expect(callIndex).toBeGreaterThan(0);
    expect(insertIndex).toBeGreaterThan(0);
    expect(callIndex).toBeLessThan(insertIndex);
  });

  it("refuses an identifier-shaped proof note before writing", () => {
    expect(list).toContain("adminFreeTextProblem(");
    const problemIndex = list.indexOf("adminFreeTextProblem(");
    const insertIndex = list.indexOf('.from("on_call_entries")');
    expect(problemIndex).toBeGreaterThan(0);
    expect(insertIndex).toBeGreaterThan(0);
    expect(problemIndex).toBeLessThan(insertIndex);
  });
});

describe("On Call entry [id] route", () => {
  it("takes the owner from the session only, never the body or a query string", () => {
    for (const source of [detail, verify]) {
      expect(source).not.toMatch(/body\.(owner_id|ownerId)/);
      expect(source).not.toMatch(/searchParams\.get\(\s*["']owner/);
      expect(source).toContain("requireAuthenticatedUser");
    }
  });

  it("validates linked document IDs before updating the database", () => {
    expect(detail).toContain("assertValidLinkedDocumentIds");
    const callIndex = detail.indexOf("assertValidLinkedDocumentIds(supabase");
    const updateIndex = detail.indexOf('.from("on_call_entries")');
    expect(callIndex).toBeGreaterThan(0);
    expect(updateIndex).toBeGreaterThan(0);
    expect(callIndex).toBeLessThan(updateIndex);
  });

  it('scopes every mutation by id AND owner_id on the same chain as .from("on_call_entries")', () => {
    const chains = [...detail.matchAll(/\.from\("on_call_entries"\)([\s\S]*?)(?:;\n|\n\n)/g)];
    expect(chains.length).toBeGreaterThan(0);
    for (const [, chainTail] of chains) {
      expect(chainTail).toContain('.eq("owner_id", user.id)');
    }
  });

  it("returns 404 identically for a missing id and an id owned by someone else", () => {
    expect(detail).toContain("On Call entry not found.");
    // A single not-found branch fed by the same scoped lookup — no separate existence check
    // that would let a caller distinguish "missing" from "not yours".
    expect(detail.match(/On Call entry not found\./g)?.length).toBe(2);
  });

  it("refuses an identifier-shaped proof note before writing", () => {
    expect(detail).toContain("adminFreeTextProblem(");
    const problemIndex = detail.indexOf("adminFreeTextProblem(");
    const updateIndex = detail.indexOf('.from("on_call_entries")');
    expect(problemIndex).toBeGreaterThan(0);
    expect(updateIndex).toBeGreaterThan(0);
    expect(problemIndex).toBeLessThan(updateIndex);
  });
});

describe("On Call entry PATCH schema (updateOnCallEntrySchema)", () => {
  const completeBody = {
    section: "contacts" as const,
    slug: "ward-4b",
    title: "Ward 4B",
    subtitle: null,
    body: null,
    details: { role: "Registrar" },
    linkedDocumentIds: [],
    tags: [],
    isPersonal: false,
    includeOnCard: false,
    sortOrder: 0,
    lastVerifiedAt: "2026-01-01T00:00:00.000Z",
  };

  it("rejects the server-only timestamp in a PATCH body", () => {
    expect(
      updateOnCallEntrySchema.safeParse({ ...completeBody, updatedAt: "2026-11-05T12:00:00.123456+00:00" }).success,
    ).toBe(false);
  });

  it("accepts a complete PATCH body", () => {
    expect(updateOnCallEntrySchema.safeParse(completeBody).success).toBe(true);
  });

  it("rejects a PATCH body that omits lastVerifiedAt instead of silently defaulting it to null", () => {
    const withoutLastVerifiedAt: Record<string, unknown> = { ...completeBody };
    delete withoutLastVerifiedAt.lastVerifiedAt;
    const result = updateOnCallEntrySchema.safeParse(withoutLastVerifiedAt);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.join(".") === "lastVerifiedAt")).toBe(true);
    }
  });

  it("rejects a PATCH body that omits any other defaulted field, not only lastVerifiedAt", () => {
    for (const field of [
      "subtitle",
      "body",
      "linkedDocumentIds",
      "tags",
      "isPersonal",
      "includeOnCard",
      "sortOrder",
    ] as const) {
      const partial: Record<string, unknown> = { ...completeBody };
      delete partial[field];
      expect(updateOnCallEntrySchema.safeParse(partial).success, `omitting ${field} should be rejected`).toBe(false);
    }
  });
});

describe("On Call entry verify route", () => {
  it("sets last_verified_at to the current time and scopes by id and owner_id", () => {
    expect(verify).toContain("last_verified_at: new Date().toISOString()");
    expect(verify).toContain('.eq("id", id)');
    expect(verify).toContain('.eq("owner_id", user.id)');
  });
});
