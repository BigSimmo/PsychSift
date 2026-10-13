import { describe, expect, it } from "vitest";
import { anonymousApiSubjectKey, withOwnerReadScope } from "@/lib/public-api-access";

function anonymousRequest(ip: string, userAgent: string) {
  return new Request("http://localhost/api/answer", {
    headers: {
      "x-real-ip": ip,
      "user-agent": userAgent,
    },
  });
}

function forwardedRequest(forwardedFor: string, cloudflareIp: string) {
  return new Request("http://localhost/api/upload", {
    headers: {
      "x-forwarded-for": forwardedFor,
      "cf-connecting-ip": cloudflareIp,
    },
  });
}

function headersOnlyRequest(headers: Record<string, string>) {
  return new Request("http://localhost/api/upload", { headers });
}

describe("anonymous API rate-limit identity", () => {
  it("does not let callers rotate the quota by changing user-agent", () => {
    const first = anonymousApiSubjectKey(anonymousRequest("198.51.100.10", "client-a"));
    const second = anonymousApiSubjectKey(anonymousRequest("198.51.100.10", "client-b"));

    expect(second).toBe(first);
  });

  it("keeps distinct network identities separate", () => {
    const first = anonymousApiSubjectKey(anonymousRequest("198.51.100.10", "client"));
    const second = anonymousApiSubjectKey(anonymousRequest("198.51.100.11", "client"));

    expect(second).not.toBe(first);
  });

  it("ignores caller-controlled identity entries before Railway's appended address", () => {
    const first = anonymousApiSubjectKey(forwardedRequest("192.0.2.10, 198.51.100.20", "203.0.113.10"));
    const second = anonymousApiSubjectKey(forwardedRequest("192.0.2.99, 198.51.100.20", "203.0.113.99"));

    expect(second).toBe(first);
  });

  it("keeps distinct Railway-appended client addresses separate", () => {
    const first = anonymousApiSubjectKey(forwardedRequest("192.0.2.10, 198.51.100.20", "203.0.113.10"));
    const second = anonymousApiSubjectKey(forwardedRequest("192.0.2.10, 198.51.100.99", "203.0.113.10"));

    expect(second).not.toBe(first);
  });

  it("never trusts cf-connecting-ip: callers sharing only that header collapse to the unknown-ip bucket", () => {
    const first = anonymousApiSubjectKey(headersOnlyRequest({ "cf-connecting-ip": "203.0.113.10" }));
    const second = anonymousApiSubjectKey(headersOnlyRequest({ "cf-connecting-ip": "203.0.113.99" }));

    // Prior to trusting only the deployment proxy's entry, distinct cf-connecting-ip values
    // would have produced distinct keys. Now both fall through to the shared "unknown-ip" signal.
    expect(second).toBe(first);
  });

  it("falls back to a shared unknown-ip signal when no proxy header is present", () => {
    const first = anonymousApiSubjectKey(headersOnlyRequest({ "user-agent": "client-a" }));
    const second = anonymousApiSubjectKey(headersOnlyRequest({ "user-agent": "client-b" }));

    expect(second).toBe(first);
  });

  it("prefers x-forwarded-for over x-real-ip when both are present", () => {
    const request = new Request("http://localhost/api/upload", {
      headers: {
        "x-forwarded-for": "192.0.2.10, 198.51.100.20",
        "x-real-ip": "203.0.113.55",
      },
    });
    const usesForwardedFor = anonymousApiSubjectKey(request);
    const matchesForwardedForTail = anonymousApiSubjectKey(forwardedRequest("203.0.113.10, 198.51.100.20", "unused"));
    const matchesRealIpOnly = anonymousApiSubjectKey(headersOnlyRequest({ "x-real-ip": "203.0.113.55" }));

    expect(usesForwardedFor).toBe(matchesForwardedForTail);
    expect(usesForwardedFor).not.toBe(matchesRealIpOnly);
  });

  it("trims whitespace and ignores empty entries in x-forwarded-for", () => {
    const padded = anonymousApiSubjectKey(headersOnlyRequest({ "x-forwarded-for": "  198.51.100.20 ,  " }));
    const clean = anonymousApiSubjectKey(headersOnlyRequest({ "x-forwarded-for": "198.51.100.20" }));

    expect(padded).toBe(clean);
  });

  it("incorporates RATE_LIMIT_SALT and produces distinct subject keys when salt changes", () => {
    const originalEnv = process.env.RATE_LIMIT_SALT;
    try {
      delete process.env.RATE_LIMIT_SALT;
      const defaultSaltKey = anonymousApiSubjectKey(anonymousRequest("198.51.100.10", "client"));

      process.env.RATE_LIMIT_SALT = "custom-test-salt-123";
      const customSaltKey = anonymousApiSubjectKey(anonymousRequest("198.51.100.10", "client"));

      expect(customSaltKey).not.toBe(defaultSaltKey);
      expect(customSaltKey).toMatch(/^anon:[0-9a-f]{32}$/);
      expect(defaultSaltKey).toMatch(/^anon:[0-9a-f]{32}$/);
    } finally {
      if (originalEnv !== undefined) {
        process.env.RATE_LIMIT_SALT = originalEnv;
      } else {
        delete process.env.RATE_LIMIT_SALT;
      }
    }
  });
});

describe("withOwnerReadScope", () => {
  function recordingQuery() {
    const calls: { method: "or" | "is" | "eq"; argument: string | null; column?: string }[] = [];
    const query = {
      eq(...args: [column: string, value: unknown]) {
        calls.push({ method: "eq", column: args[0], argument: String(args[1]) });
        return query;
      },
      is(...args: [column: string, value: null]) {
        calls.push({ method: "is", column: args[0], argument: args[1] });
        return query;
      },
      or(filters: string) {
        calls.push({ method: "or", argument: filters });
        return query;
      },
    };
    return { query, calls };
  }

  // A null owner is not by itself a publication decision: `documents.owner_id` is
  // `on delete set null`, so deleting an auth user blanks the owner of every document they
  // held. Only `publish_approved_documents` writes a null owner deliberately, and it always
  // stamps `metadata.public_corpus`. These assertions pin the marker into every read path so
  // an orphaned private document cannot re-enter the public corpus.
  const publicCorpusMarker = "metadata->>public_corpus.eq.true";

  it("scopes an authenticated read to the caller's rows plus the published public corpus", () => {
    const { query, calls } = recordingQuery();
    const ownerId = "11111111-1111-4111-8111-111111111111";

    withOwnerReadScope(query, ownerId);

    expect(calls).toEqual([
      { method: "or", argument: `owner_id.eq.${ownerId},and(owner_id.is.null,${publicCorpusMarker})` },
    ]);
  });

  it("scopes an anonymous read to the published public corpus", () => {
    const { query, calls } = recordingQuery();

    withOwnerReadScope(query, undefined);

    expect(calls).toEqual([
      { method: "is", column: "owner_id", argument: null },
      { method: "eq", column: "metadata->>public_corpus", argument: "true" },
    ]);
  });

  it("never exposes an owner-less document that publication did not mark as public", () => {
    for (const ownerId of [undefined, "11111111-1111-4111-8111-111111111111"]) {
      const { query, calls } = recordingQuery();

      withOwnerReadScope(query, ownerId);

      const filters = calls.map((call) => `${call.column ?? ""}${call.argument ?? "null"}`).join("|");
      expect(filters, `owner ${String(ownerId)} must require the publication marker`).toContain("public_corpus");
    }
  });

  it("fails closed on a non-uuid owner id instead of interpolating PostgREST filter syntax", () => {
    for (const ownerId of ["*", "x,owner_id.not.is.null", "11111111-1111-4111-8111-111111111111,or(x.eq.1)"]) {
      const { query, calls } = recordingQuery();

      withOwnerReadScope(query, ownerId);

      expect(calls).toEqual([
        { method: "is", column: "owner_id", argument: null },
        { method: "eq", column: "metadata->>public_corpus", argument: "true" },
      ]);
    }
  });
});
