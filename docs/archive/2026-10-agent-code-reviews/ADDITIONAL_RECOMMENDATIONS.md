# Additional Code Quality & Security Recommendations

> **Archived report (2026-10).** Historical point-in-time agent code review retained for audit history.

Beyond the 6 bugs fixed, here are strategic improvements to enhance maintainability, performance, and resilience.

---

## 1. 🔒 SECURITY RECOMMENDATIONS

### 1.1 - Add Environment Variable Validation Tests

**Priority:** MEDIUM  
**Impact:** Prevent configuration errors in production

**Issue:**  
No comprehensive tests validate that environment variables are properly coerced and validated at startup. A misconfiguration (e.g., typo in `OPENAI_MAX_OUTPUT_TOKENS`) silently defaults instead of failing fast.

**Recommendation:**

```typescript
// tests/env-validation.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";

describe("Environment variable validation", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should reject invalid EMBEDDING_DIMENSIONS", () => {
    process.env.EMBEDDING_DIMENSIONS = "-1";
    expect(() => {
      // Re-import to trigger validation
      delete require.cache[require.resolve("@/lib/env")];
      require("@/lib/env");
    }).toThrow();
  });

  it("should reject invalid RAG_PROVIDER_MODE", () => {
    process.env.RAG_PROVIDER_MODE = "invalid";
    expect(() => {
      delete require.cache[require.resolve("@/lib/env")];
      require("@/lib/env");
    }).toThrow();
  });

  it("should enforce minimum OPENAI_MAX_OUTPUT_TOKENS", () => {
    // Verify it's at least 1000 to avoid truncation
    process.env.OPENAI_MAX_OUTPUT_TOKENS = "500";
    // Should log warning or throw
  });
});
```

---

### 1.2 - Add Rate Limiting to /api/webhooks/*

**Priority:** MEDIUM  
**Impact:** Prevent webhook-based DoS attacks

**Issue:**  
Webhook receivers at `/api/webhooks/*` have no rate limiting. A malicious actor sending thousands of webhook events could:

- Exhaust database connections
- Trigger spam ingestion jobs
- Flood logs with forwarder messages

**Recommendation:**

```typescript
// src/lib/webhook-rate-limit.ts
import { rateLimit } from "Ratelimit"; // Use @upstash/ratelimit or similar

export function createWebhookRateLimiter(webhookId: string, maxRequestsPerMinute = 100) {
  return {
    async checkLimit(identifier: string) {
      // Use Redis or Upstash with sliding window
      const key = `webhook:${webhookId}:${identifier}`;
      const count = await redis.incr(key);
      if (count === 1) await redis.expire(key, 60);

      if (count > maxRequestsPerMinute) {
        throw new Error(`Rate limit exceeded for ${webhookId}`);
      }
    },
  };
}
```

Apply to all webhook routes in `/api/webhooks/`.

---

### 1.3 - Secure Proxy Auth Header Validation

**Priority:** MEDIUM  
**Impact:** Prevent HMAC collision attacks

**Issue:**  
Current HMAC comparison in `proxy.ts` is correct after Fix #1, but no validation ensures the payload is well-formed JSON before parsing. Malformed payloads could cause errors.

**Recommendation:**

```typescript
// src/lib/supabase/proxy-auth-crypto.ts
export function parseProxyAuthPayload(
  headerValue: string,
): { id: string; appMetadata: Record<string, unknown> } | null {
  const payloadBase64 = verifyProxyAuthHeader(headerValue);
  if (!payloadBase64) return null;

  try {
    const json = Buffer.from(payloadBase64, "base64").toString("utf8");
    const parsed = JSON.parse(json);

    // Validate structure
    if (!parsed.id || typeof parsed.id !== "string") return null;
    if (parsed.appMetadata && typeof parsed.appMetadata !== "object") return null;

    return parsed;
  } catch {
    return null;
  }
}
```

---

### 1.4 - Add CORS Enforcement on Cross-Origin Requests

**Priority:** MEDIUM  
**Impact:** Prevent cross-origin API abuse

**Issue:**  
The CSP header is strict, but CORS headers are not explicitly configured. A cross-origin fetch from `attacker.com` to `https://your-domain/api/search` is rejected by CORS, but error messages might leak information.

**Recommendation:**

```typescript
// next.config.ts
async headers() {
  return [
    // ... existing headers ...
    {
      source: "/api/:path*",
      headers: [
        {
          key: "Access-Control-Allow-Origin",
          value: "https://trusted-origin.com", // Explicit allowlist, never "*"
        },
        {
          key: "Access-Control-Allow-Credentials",
          value: "true",
        },
        {
          key: "Access-Control-Allow-Methods",
          value: "GET, POST, PUT",
        },
      ],
    },
  ];
}
```

---

## 2. 🎯 PERFORMANCE RECOMMENDATIONS

### 2.1 - Add Query Result Pagination to RAG Aliases

**Priority:** LOW  
**Impact:** Reduce memory usage on large fetches

**Issue:**  
`fetchEnabledRagAliases()` fetches up to 200 aliases per scope (line 180). For global scopes with thousands of aliases, this creates memory churn.

**Recommendation:**

```typescript
// src/lib/rag/rag-retrieval-variants.ts
const maxRagAliasesPerScope = 200; // Already good

// But add cursor-based pagination for future growth:
export async function fetchEnabledRagAliasesWithCursor(
  supabase: ReturnType<typeof createAdminClient>,
  ownerId?: string,
  accessScope?: RetrievalAccessScope,
  cursor?: string,
  signal?: AbortSignal,
): Promise<{ aliases: RagAliasInput[]; nextCursor?: string }> {
  // ... fetch with LIMIT + OFFSET or keyset pagination
  // Returns nextCursor if more results exist
}
```

---

### 2.2 - Warm Additional Caches at Boot

**Priority:** LOW  
**Impact:** Reduce cold-start latency after deploy

**Issue:**  
Only `rag_aliases` is warmed at boot. Other frequently-used lookups (e.g., document categories, therapy compass data) are cold on first request.

**Recommendation:**

```typescript
// src/instrumentation.ts
const { warmEnabledRagAliasCache } = await import("@/lib/rag/rag-retrieval-variants");
const { warmTherapyCompassCache } = await import("@/lib/therapy-compass");
const { warmDocumentCategoryCache } = await import("@/lib/documents/categories");

// Warm in parallel, all with 5-second timeout
await Promise.allSettled(
  [warmEnabledRagAliasCache(), warmTherapyCompassCache(), warmDocumentCategoryCache()].map((p) =>
    Promise.race([p, new Promise((_, reject) => setTimeout(() => reject(new Error("Warmup timeout")), 5000))]),
  ),
);
```

---

### 2.3 - Memoize `normalizeAliasLookup()` for Repeated Queries

**Priority:** LOW  
**Impact:** Reduce CPU for repeated normalization

**Issue:**  
`normalizeAliasLookup(alias.alias)` is called twice per alias in `fetchEnabledRagAliases()` (line 161). For 200 aliases, that's 400 regex + Unicode operations.

**Recommendation:**

```typescript
// src/lib/rag/rag-retrieval-variants.ts
const aliasLookupCache = new Map<string, string>();

function normalizeAliasLookupMemoized(value: string): string {
  if (aliasLookupCache.has(value)) return aliasLookupCache.get(value)!;
  const result = normalizeAliasLookup(value);
  aliasLookupCache.set(value, result);
  return result;
}
```

---

## 3. 🐛 ROBUSTNESS RECOMMENDATIONS

### 3.1 - Add Telemetry for Cache Hit/Miss Rates

**Priority:** MEDIUM  
**Impact:** Debug performance regressions

**Issue:**  
Cache effectiveness is invisible. A bug causing all cache misses goes undetected until users complain.

**Recommendation:**

```typescript
// src/lib/rag/rag-retrieval-variants.ts
let cacheStats = { hits: 0, misses: 0 };

export function getCacheStats() {
  return cacheStats;
}

export async function fetchEnabledRagAliases(...) {
  const cached = readExpiringCacheEntry(ragAliasCache, cacheKey);
  if (cached) {
    cacheStats.hits++;
    return cached.aliases;
  }
  cacheStats.misses++;
  // ... rest of function
}

// Log to observability backend periodically
setInterval(() => {
  const stats = getCacheStats();
  console.log(`Cache stats: ${stats.hits}/${stats.hits + stats.misses} hits`);
}, 60_000);
```

---

### 3.2 - Add Timeout to Supabase Auth Refresh

**Priority:** MEDIUM  
**Impact:** Prevent hanging requests in proxy

**Issue:**  
In `proxy.ts`, `supabase.auth.getClaims()` has no timeout. A stuck auth service stalls _every_ request.

**Recommendation:**

```typescript
// src/proxy.ts
async function getCognitoClaimsWithTimeout(supabase: SupabaseClient, timeoutMs = 5000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await Promise.race([
      supabase.auth.getClaims(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Auth timeout")), timeoutMs)),
    ]);
  } finally {
    clearTimeout(timeoutId);
  }
}

// In proxy():
const claimsResult = await getCognitoClaimsWithTimeout(supabase);
```

---

### 3.3 - Add Graceful Degradation for Cache Fetch Failures

**Priority:** MEDIUM  
**Impact:** Improve resilience when database is slow

**Issue:**  
If `fetchEnabledRagAliases()` fails, the entire search query expansion is skipped. Partial data (e.g., retry with fewer aliases) is better than total failure.

**Recommendation:**

```typescript
// src/lib/rag/rag-retrieval-variants.ts
export async function fetchEnabledRagAliasesWithFallback(
  supabase: ReturnType<typeof createAdminClient>,
  ownerId?: string,
  accessScope?: RetrievalAccessScope,
  signal?: AbortSignal,
): Promise<RagAliasInput[]> {
  try {
    return await fetchEnabledRagAliases(supabase, ownerId, accessScope, signal);
  } catch (error) {
    console.warn("Primary alias fetch failed, attempting fallback", { error });

    // Fallback: fetch only global aliases (faster, no ownership filter)
    try {
      return await fetchEnabledRagAliases(supabase, undefined, { includePublic: true }, signal);
    } catch {
      // Last resort: return empty, allow search to proceed without expansions
      console.error("All alias fetches failed, proceeding without expansion");
      return [];
    }
  }
}
```

---

## 4. 🧪 TESTING RECOMMENDATIONS

### 4.1 - Add Concurrent Request Tests for Cache Deduplication (Fix #2)

**Priority:** MEDIUM  
**Impact:** Verify Fix #2 actually works

**Recommendation:**

```typescript
// tests/rag-alias-cache-dedup.test.ts
import { describe, it, expect } from "vitest";
import { fetchEnabledRagAliases } from "@/lib/rag/rag-retrieval-variants";

describe("RAG alias cache deduplication", () => {
  it("should deduplicate concurrent requests for same scope", async () => {
    const mockSupabase = createMockSupabaseClient();
    let queryCount = 0;

    mockSupabase.from.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          order: () => ({
            limit: () => ({
              abortSignal: () => ({
                [Symbol.asyncIterator]: async function* () {
                  queryCount++;
                  yield { data: mockAliases };
                },
              }),
            }),
          }),
        }),
      }),
    }));

    // Fire 10 concurrent requests for same cache key
    const results = await Promise.all([
      ...Array(10)
        .fill(null)
        .map(() => fetchEnabledRagAliases(mockSupabase, undefined, { includePublic: true })),
    ]);

    // Should only query database ONCE despite 10 requests
    expect(queryCount).toBe(1);
    // All results should be identical
    expect(new Set(results.map((r) => JSON.stringify(r))).size).toBe(1);
  });
});
```

---

### 4.2 - Add Timeout Tests for Boot-Time Warmup (Fix #6)

**Priority:** MEDIUM  
**Impact:** Verify warmup doesn't hang

**Recommendation:**

```typescript
// tests/boot-warmup-timeout.test.ts
it("should abort warmup after 5 seconds", async () => {
  const mockSupabase = createMockSupabaseClient();

  // Simulate hanging database
  mockSupabase.from.mockImplementation(() => ({
    select: () =>
      new Promise((resolve) => {
        setTimeout(resolve, 30_000); // Hang for 30s
      }),
  }));

  const startTime = Date.now();
  await warmEnabledRagAliasCache(mockSupabase);
  const elapsed = Date.now() - startTime;

  // Should complete within ~6 seconds (5s timeout + overhead), not 30s
  expect(elapsed).toBeLessThan(6000);
});
```

---

### 4.3 - Add HMAC Signature Tests (Fix #1)

**Priority:** HIGH  
**Impact:** Ensure crypto fix is correct

**Recommendation:**

```typescript
// tests/proxy-auth-crypto.test.ts
import { signProxyAuthPayload, verifyProxyAuthHeader } from "@/lib/supabase/proxy-auth-crypto";

describe("Proxy auth crypto", () => {
  it("should sign and verify payload with base64url encoding", () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "fixture-placeholder";

    const payload = { id: "user-123", appMetadata: { role: "admin" } };
    const payloadBase64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64");

    const signed = signProxyAuthPayload(payloadBase64);
    expect(signed).toBeTruthy();

    const verified = verifyProxyAuthHeader(signed!);
    expect(verified).toBe(payloadBase64);
  });

  it("should reject tampered signatures", () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-secret-key-at-least-32-chars-long-xxxx";

    const payload = Buffer.from("test", "utf8").toString("base64");
    const signed = signProxyAuthPayload(payload)!;

    // Tamper with signature
    const tampered = signed.slice(0, -5) + "xxxxx";
    const verified = verifyProxyAuthHeader(tampered);

    expect(verified).toBeNull();
  });

  it("should handle base64url edge cases (-, _, no padding)", () => {
    // Payloads with - or _ characters in base64url
    const edgeCasePayload = "SGVsbG8tV29ybGRfMTIz"; // "Hello-World_123" in base64url
    const signed = signProxyAuthPayload(edgeCasePayload);
    const verified = verifyProxyAuthHeader(signed!);

    expect(verified).toBe(edgeCasePayload);
  });
});
```

---

## 5. 📋 MAINTENANCE RECOMMENDATIONS

### 5.1 - Add Deprecation Timeline for Webhook Secrets

**Priority:** LOW  
**Impact:** Plan for credential rotation

**Recommendation:**
Document in a WEBHOOKS.md that webhook secrets rotate every 12 months. Add a task:

```
# docs/webhooks.md - Credential Rotation Schedule

- RAILWAY_WEBHOOK_SECRET: Rotate Q1 2026 (set Q1 2025)
- SUPABASE_INGESTION_WEBHOOK_SECRET: Rotate Q1 2026

Procedure:
1. Generate new secret
2. Set NEW_SECRET in env, old still active
3. Update all callers to send both headers
4. Wait 7 days
5. Remove old secret from code
```

---

### 5.2 - Document Cache Warming Strategy

**Priority:** LOW  
**Impact:** Onboard new maintainers

**Recommendation:**
Create `docs/cache-warmup.md`:

```markdown
# Cache Warmup Strategy

## What Gets Warmed

- rag_aliases (global scope) on every boot

## Why

- Eliminates cold-cache DB latency on first request
- Retrieval variant expansion depends on alias availability
- 5-second timeout prevents boot hangs

## What to Warm Next

- therapy-compass catalogue (static, large)
- document categories (medium)
- user account metadata (requires auth)

## Monitoring

- Check logs for "cache warmup failed" warnings
- Monitor boot-time latency in observability backend
- Alert if first search after deploy is >2s slower
```

---

### 5.3 - Establish Error Budget for Instrumentation

**Priority:** LOW  
**Impact:** Define acceptable boot failure rates

**Recommendation:**

```typescript
// src/instrumentation.ts - Add comment
export async function register() {
  // Error budget: warmup failures are acceptable. The register() function
  // is called once per server instance at boot; any errors here delay
  // application startup by ~5 seconds (the warmup timeout).
  //
  // If warmup fails >1% of boots (measured in observability backend),
  // investigate cache database latency or network issues. But don't make
  // this blocking — first-request cache misses are normal and acceptable.
}
```

---

## Summary

| Recommendation             | Priority | Effort | Impact                |
| -------------------------- | -------- | ------ | --------------------- |
| Env validation tests       | MEDIUM   | 2h     | Prevent config errors |
| Webhook rate limiting      | MEDIUM   | 3h     | DoS protection        |
| Auth timeout               | MEDIUM   | 1h     | Prevent request hangs |
| Graceful cache degradation | MEDIUM   | 2h     | Resilience            |
| Cache telemetry            | MEDIUM   | 1h     | Observability         |
| CORS headers               | MEDIUM   | 1h     | API security          |
| Concurrent request tests   | MEDIUM   | 2h     | Verify Fix #2         |
| Boot timeout tests         | MEDIUM   | 2h     | Verify Fix #6         |
| Crypto signature tests     | HIGH     | 2h     | Verify Fix #1         |
| Docs: cache warmup         | LOW      | 1h     | Maintenance           |
| Docs: webhooks rotation    | LOW      | 1h     | Maintenance           |
