> **Archived report (2026-10).** Historical point-in-time agent code review retained for audit history.

# Extended Issue Inventory - Detailed Breakdown

## PART 1: CRITICAL & HIGH PRIORITY (IMMEDIATE ACTION)

### Issue #1: CRITICAL - HMAC Signature Verification Encoding Bug

**Status:** ✅ FIXED  
**Severity:** 🔴 CRITICAL  
**Category:** Security / Authentication  
**Files Affected:** `src/lib/supabase/proxy-auth-crypto.ts`

**Problem Description:**
The `verifyProxyAuthHeader()` function converts base64url-encoded HMAC signatures to UTF-8 buffers before comparison. Base64url can produce non-UTF-8 byte sequences, causing:

- Encoding errors during buffer conversion
- Failed HMAC verification even with valid signatures
- Users logged out after deployment
- Authentication pipeline broken

**Code Location:** Lines 39-40

```typescript
// BROKEN:
const a = Buffer.from(signature, "utf8");
const b = Buffer.from(expectedSignature, "utf8");
```

**Root Cause:** Misunderstanding of base64url encoding format (uses `-` and `_` instead of `+` and `/`, no padding)

**Solution Applied:**

```typescript
// FIXED:
const a = Buffer.from(signature, "base64url");
const b = Buffer.from(expectedSignature, "base64url");
```

**Verification:**

- ✅ TypeScript compiles
- ✅ Type-safe
- ✅ Backward compatible with existing tokens
- ❌ NOT yet tested (test file missing)

**Risk Level:** 🟠 MEDIUM (low deployment risk, but high impact if broken)

**Rollback:** Revert to `"utf8"` if needed (1 line fix)

**Test Coverage Needed:**

- Edge case: Base64url with `-` and `_` characters
- Edge case: Empty signature
- Edge case: Padding differences
- Happy path: Valid signature verification
- Negative: Tampered signature rejection

---

### Issue #2: HIGH - Cache Race Condition in RAG Alias Fetching

**Status:** ✅ FIXED  
**Severity:** 🟠 HIGH  
**Category:** Concurrency / Data Consistency  
**Files Affected:** `src/lib/rag/rag-retrieval-variants.ts`

**Problem Description:**
The `fetchEnabledRagAliases()` function has no protection against concurrent requests for the same cache key. This causes:

- 2+ concurrent requests → 2+ identical DB queries
- Redundant network latency
- Potential data inconsistency if writes race
- Performance degradation under load
- Wasted database connection pool capacity

**Code Location:** Lines 50-156 (original), 50-180 (after fix)

**Scenario:**

```
Time 0ms: Request A arrives, cache miss for scope "owner-123"
Time 1ms: Request B arrives, cache miss for same scope
Time 2ms: Both fire identical SELECT from rag_aliases
Time 10ms: Request A gets results, writes to cache
Time 11ms: Request B gets results, overwrites cache (redundant)
```

**Root Cause:** No synchronization primitive to track in-flight requests

**Solution Applied:**

```typescript
const ragAliasCacheRequests = new Map<string, Promise<RagAliasInput[]>>();

// Before fetching, check if another request is already fetching same key
if (ragAliasCacheRequests.has(cacheKey)) {
  return ragAliasCacheRequests.get(cacheKey)!; // Wait for existing request
}

// Track this request
ragAliasCacheRequests.set(cacheKey, promise);
try {
  return await promise;
} finally {
  ragAliasCacheRequests.delete(cacheKey); // Cleanup
}
```

**Impact:**

- Eliminates redundant concurrent DB queries
- Improves latency for concurrent requests (all share single fetch)
- Reduces database connection pool pressure
- Better cache effectiveness under load

**Verification:**

- ✅ TypeScript compiles
- ✅ Type-safe
- ✅ No breaking changes
- ❌ NOT tested under concurrency

**Risk Level:** 🟢 LOW (conservative fix, only improves performance)

**Test Coverage Needed:**

- Load test: 100 concurrent requests to same cache key
- Verify: All return same data
- Verify: Only 1 database query fired
- Verify: Request dedup map cleanup (no memory leak)
- Verify: Error case (one request fails, others don't retry)

---

### Issue #3: HIGH - Unhandled Promise Rejection at Boot

**Status:** ✅ FIXED  
**Severity:** 🟠 HIGH  
**Category:** Error Handling / Boot  
**Files Affected:** `src/instrumentation.ts`

**Problem Description:**
The cache warmup promise is invoked with `void` operator but has no error handler. If the function throws before returning, the error is silently swallowed:

- No logs of boot failures
- Silent degradation
- Cache never warmed
- First user request pays cold-cache penalty
- Errors invisible in monitoring

**Code Location:** Lines 72-78

**Original Code:**

```typescript
void warmEnabledRagAliasCache(); // Error silently fails
```

**Failure Scenario:**

```
1. Boot starts
2. warmEnabledRagAliasCache() called
3. Inside: fetchEnabledRagAliases() throws (DB connection failed)
4. Promise rejects
5. No .catch() handler
6. Error printed to console but not captured
7. Application boots with unwarmed cache
8. First request is slow
9. No alert triggered
```

**Root Cause:** Promise fire-and-forget without error handling

**Solution Applied:**

```typescript
warmEnabledRagAliasCache().catch((error) => {
  console.warn("rag_aliases cache warmup failed; first request will retry.", {
    message: error instanceof Error ? error.message : String(error),
  });
});
```

**Impact:**

- Cache warmup errors now visible in logs
- Application still boots (non-blocking)
- First request can retry cache fetch
- Errors captured for monitoring

**Verification:**

- ✅ TypeScript compiles
- ✅ No breaking changes
- ❌ NOT tested with simulated DB failure

**Risk Level:** 🟢 LOW (only adds logging, no behavior change)

**Test Coverage Needed:**

- Mock DB connection failure
- Verify: Promise rejects
- Verify: .catch() handler fires
- Verify: Error logged to console
- Verify: App continues booting
- Verify: First search request retries cache fetch

---

### Issue #4: MEDIUM - Missing Null Check on Zone Color

**Status:** ✅ FIXED  
**Severity:** 🟡 MEDIUM  
**Category:** String Handling / Query Safety  
**Files Affected:** `src/lib/rag/rag-retrieval-variants.ts`

**Problem Description:**
The `queriedZoneColour(query)` function could return empty string, resulting in malformed query variants:

- Empty string in `${zoneColour} zone` → ` zone`
- Malformed variant added to query pool
- Search results affected (empty zone query matches everything)
- Poor search quality for zone-based queries

**Code Location:** Line 284

**Original Code:**

```typescript
const zoneColour = queriedZoneColour(query);
if (zoneColour) {
  // Only checks truthy, not empty string
  addVariant(`${zoneColour} zone`);
}
```

**Failure Scenario:**

```
1. queriedZoneColour() returns "" (empty string)
2. if ("") evaluates to false (good)
3. But if it returns " " (single space):
   - if (" ") evaluates to true (truthy)
   - addVariant(" zone") added
   - Search queries now include empty zone
```

**Root Cause:** Insufficient null check (truthy check vs. length check)

**Solution Applied:**

```typescript
const zoneColour = queriedZoneColour(query);
if (zoneColour?.trim()) {
  // Check for empty string after trim
  addVariant(`${zoneColour} zone`);
}
```

**Impact:**

- Prevents malformed query variants
- Only adds meaningful zone queries
- Improves search result quality

**Verification:**

- ✅ TypeScript compiles
- ✅ Covered by existing search tests
- ✅ No breaking changes

**Risk Level:** 🟢 LOW (conservative improvement)

**Test Coverage:** Already covered by existing tests

---

### Issue #5: MEDIUM - Double Assignment Dead Code in Proxy

**Status:** ✅ FIXED  
**Severity:** 🟡 MEDIUM  
**Category:** Logic Error / Null Safety  
**Files Affected:** `src/proxy.ts`

**Problem Description:**
The `response` variable is initialized twice with different values, creating:

- Dead code path (first assignment never used)
- Potential null reference if `setAll()` never fires
- Confusing code flow
- Type safety issues

**Code Location:** Lines 212-258

**Original Code:**

```typescript
let response = NextResponse.next({ request: { headers: requestHeadersWithNonce() } }); // Assignment 1
const supabase = createServerClient(url, key, {
  cookies: {
    setAll(cookiesToSet, responseHeaders) {
      response = NextResponse.next({ request: { headers: requestHeadersWithNonce(userHeaderValue) } }); // Assignment 2 (overwrites 1)
```

**Problem Scenario:**

```
1. response = NextResponse.next(...) // Dead code
2. createServerClient called
3. If setAll() never fires:
   - response is the initial (outdated) object
   - Missing auth header updates
4. If setAll() fires:
   - response overwritten (initial assignment wasted)
```

**Root Cause:** Unclear logic flow, initialization before callback definition

**Solution Applied:**

```typescript
let response: NextResponse | null = null;  // Initialize as null
const supabase = createServerClient(url, key, {
  cookies: {
    setAll(cookiesToSet, responseHeaders) {
      response = NextResponse.next({ request: { headers: requestHeadersWithNonce(userHeaderValue) } }); // First real assignment
```

And at return:

```typescript
return withCsp(response ?? NextResponse.next({ request: { headers: requestHeadersWithNonce() } }));
```

**Impact:**

- Eliminates dead code
- Clarifies intent (null until callbacks set it)
- Type-safe null handling
- Prevents potential null reference errors

**Verification:**

- ✅ TypeScript compiles
- ✅ Covered by existing proxy tests
- ✅ No breaking changes

**Risk Level:** 🟢 LOW (improves type safety)

**Test Coverage:** Already covered by existing proxy tests

---

### Issue #6: MEDIUM - Missing Abort Timeout on Boot Cache Warmup

**Status:** ✅ FIXED  
**Severity:** 🟡 MEDIUM  
**Category:** Reliability / Boot  
**Files Affected:** `src/lib/rag/rag-retrieval-variants.ts`

**Problem Description:**
The cache warmup at server boot has no timeout. If database is unresponsive, the boot process can hang indefinitely:

- Deploy hangs
- Container orchestration times out (usually 5-10 minutes)
- Deployment failure
- Service unavailable
- Cascading failures in multi-node setup

**Code Location:** Lines 118-136

**Original Code:**

```typescript
export async function warmEnabledRagAliasCache(
  supabase: ReturnType<typeof createAdminClient> = createAdminClient(),
): Promise<void> {
  try {
    await fetchEnabledRagAliases(supabase, undefined, { includePublic: true });
    // If DB hangs, this await never completes
```

**Failure Scenario:**

```
1. Boot starts, warmEnabledRagAliasCache() called
2. fetchEnabledRagAliases() fires DB query
3. DB doesn't respond (network issue, slow, down)
4. await hangs indefinitely
5. Boot stuck
6. Deployment times out (5-10 min later)
7. Service unavailable
```

**Root Cause:** No timeout protection on async DB operation

**Solution Applied:**

```typescript
export async function warmEnabledRagAliasCache(
  supabase: ReturnType<typeof createAdminClient> = createAdminClient(),
): Promise<void> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);  // 5 second timeout
    try {
      await fetchEnabledRagAliases(supabase, undefined, { includePublic: true }, controller.signal);
    } finally {
      clearTimeout(timeoutId);
    }
```

**Impact:**

- Boot never hangs longer than ~5 seconds
- Warmup failures don't block deployment
- First request retries cache population
- Clear timeout logs for debugging

**Verification:**

- ✅ TypeScript compiles
- ✅ No breaking changes
- ❌ NOT tested with hanging database

**Risk Level:** 🟢 LOW (only adds timeout, doesn't change behavior)

**Test Coverage Needed:**

- Mock DB that hangs for 30 seconds
- Verify: Warmup aborts after ~5 seconds
- Verify: Error logged
- Verify: App boots successfully
- Verify: First search request retries cache

---

## PART 2: RECOMMENDED IMPROVEMENTS (NOT CRITICAL)

### Issue #7: Webhook Rate Limiting Missing

**Status:** 🔜 RECOMMENDED  
**Severity:** 🟡 MEDIUM - Security  
**Category:** DoS Protection  
**Files Affected:** `src/app/api/webhooks/*` (all webhook routes)

**Problem:** No rate limiting on webhook endpoints; attackers could trigger:

- Database connection exhaustion
- Ingestion job queue overflow
- Log spam
- Service degradation

**Recommendation:** Implement rate limiting (3 hours to fix)

**Priority:** This month

---

### Issue #8: Missing Auth Request Timeout

**Status:** 🔜 RECOMMENDED  
**Severity:** 🟡 MEDIUM - Reliability  
**Category:** Performance/Stability  
**Files Affected:** `src/proxy.ts` (line 227)

**Problem:** `supabase.auth.getClaims()` has no timeout; stuck auth service stalls all requests

**Recommendation:** Add 5-second timeout (1 hour to fix)

**Priority:** This month

---

### Issue #9: No Cache Telemetry

**Status:** 🔜 RECOMMENDED  
**Severity:** 🟢 LOW - Observability  
**Category:** Monitoring  
**Files Affected:** `src/lib/rag/rag-retrieval-variants.ts`

**Problem:** Cache effectiveness invisible; bugs causing all misses go undetected

**Recommendation:** Add telemetry tracking (1 hour to fix)

**Priority:** This month

---

### Issue #10: Missing Graceful Cache Degradation

**Status:** 🔜 RECOMMENDED  
**Severity:** 🟢 LOW - Resilience  
**Category:** Error Handling  
**Files Affected:** `src/lib/rag/rag-retrieval-variants.ts`

**Problem:** Cache fetch failure skips all expansion; partial data better than none

**Recommendation:** Add fallback to global-only aliases (2 hours to fix)

**Priority:** 1-2 weeks

---

### Issue #11: Missing CORS Headers

**Status:** 🔜 RECOMMENDED  
**Severity:** 🟡 MEDIUM - Security  
**Category:** API Security  
**Files Affected:** `next.config.ts`

**Problem:** No explicit CORS configuration; could allow unintended cross-origin access

**Recommendation:** Add CORS allowlist (1 hour to fix)

**Priority:** This month

---

### Issue #12: No Proxy Auth Payload Validation

**Status:** 🔜 RECOMMENDED  
**Severity:** 🟢 LOW - Robustness  
**Category:** Input Validation  
**Files Affected:** `src/lib/supabase/proxy-auth-crypto.ts`

**Problem:** No validation that payload is well-formed JSON before parsing

**Recommendation:** Add payload structure validation (1 hour to fix)

**Priority:** This month

---

### Issue #13: Missing Environment Variable Validation Tests

**Status:** 🔜 RECOMMENDED  
**Severity:** 🟢 LOW - Configuration  
**Category:** Testing  
**Files Affected:** `tests/env-validation.test.ts` (new file)

**Problem:** No tests validate environment variables at startup

**Recommendation:** Add validation test suite (2 hours to fix)

**Priority:** This month

---

### Issue #14: No Query Pagination for Large Fetches

**Status:** 🔜 RECOMMENDED  
**Severity:** 🟢 LOW - Performance  
**Category:** Scalability  
**Files Affected:** `src/lib/rag/rag-retrieval-variants.ts`

**Problem:** Fetches up to 200 aliases per call; could scale poorly

**Recommendation:** Add cursor-based pagination (2 hours to fix)

**Priority:** When scaling becomes issue

---

### Issue #15: Missing Additional Cache Warmup

**Status:** 🔜 RECOMMENDED  
**Severity:** 🟢 LOW - Performance  
**Category:** Boot Optimization  
**Files Affected:** `src/instrumentation.ts`

**Problem:** Only `rag_aliases` warmed; other data cold on first request

**Recommendation:** Warm therapy-compass, categories, etc. (2 hours to fix)

**Priority:** When cold-start latency becomes issue

---

### Issue #16: No Normalization Memoization

**Status:** 🔜 RECOMMENDED  
**Severity:** 🟢 LOW - Performance  
**Category:** Optimization  
**Files Affected:** `src/lib/rag/rag-retrieval-variants.ts`

**Problem:** `normalizeAliasLookup()` called twice per alias (400x for 200 aliases)

**Recommendation:** Add memoization cache (1 hour to fix)

**Priority:** If CPU profiling shows bottleneck

---

### Issue #17: Missing HMAC Signature Tests

**Status:** 🔜 RECOMMENDED  
**Severity:** 🟠 HIGH - Testing  
**Category:** Test Coverage  
**Files Affected:** `tests/proxy-auth-crypto.test.ts` (new file)

**Problem:** Fix #1 (HMAC) has no test coverage for edge cases

**Recommendation:** Add comprehensive crypto tests (2 hours to fix)

**Priority:** HIGH - This week

---

### Issue #18: Missing Concurrent Request Tests

**Status:** 🔜 RECOMMENDED  
**Severity:** 🟠 HIGH - Testing  
**Category:** Test Coverage  
**Files Affected:** `tests/rag-alias-cache-dedup.test.ts` (new file)

**Problem:** Fix #2 cache dedup untested under concurrency

**Recommendation:** Add load tests (2 hours to fix)

**Priority:** HIGH - This week

---

### Issue #19: Missing Boot Timeout Tests

**Status:** 🔜 RECOMMENDED  
**Severity:** 🠗 HIGH - Testing  
**Category:** Test Coverage  
**Files Affected:** `tests/boot-warmup-timeout.test.ts` (new file)

**Problem:** Fix #6 timeout logic untested

**Recommendation:** Add timeout tests (2 hours to fix)

**Priority:** HIGH - This week

---

### Issue #20-22: Missing Documentation

**Status:** 🔜 RECOMMENDED  
**Severity:** 🟢 LOW - Maintenance  
**Category:** Documentation  
**Files Affected:** `docs/*` (new/updated files)

**Issues:**

- #20: Webhook rotation schedule
- #21: Cache warmup strategy
- #22: Error budgets

**Priority:** This quarter

---

## SUMMARY TABLE

| #     | Issue              | Status   | Severity | Category       | Est. Hours | Priority     |
| ----- | ------------------ | -------- | -------- | -------------- | ---------- | ------------ |
| 1     | HMAC encoding      | ✅ FIXED | CRITICAL | Security       | —          | Deploy now   |
| 2     | Cache race         | ✅ FIXED | HIGH     | Concurrency    | —          | Deploy now   |
| 3     | Promise error      | ✅ FIXED | HIGH     | Error handling | —          | Deploy now   |
| 4     | Null check         | ✅ FIXED | MEDIUM   | Logic          | —          | Deploy now   |
| 5     | Dead code          | ✅ FIXED | MEDIUM   | Logic          | —          | Deploy now   |
| 6     | Boot timeout       | ✅ FIXED | MEDIUM   | Reliability    | —          | Deploy now   |
| 7     | Rate limiting      | 🔜 TODO  | MEDIUM   | Security       | 3          | This month   |
| 8     | Auth timeout       | 🔜 TODO  | MEDIUM   | Reliability    | 1          | This month   |
| 9     | Cache telemetry    | 🔜 TODO  | LOW      | Observability  | 1          | This month   |
| 10    | Degradation        | 🔜 TODO  | LOW      | Resilience     | 2          | 1-2 weeks    |
| 11    | CORS headers       | 🔜 TODO  | MEDIUM   | Security       | 1          | This month   |
| 12    | Payload validation | 🔜 TODO  | LOW      | Robustness     | 1          | This month   |
| 13    | Env tests          | 🔜 TODO  | LOW      | Testing        | 2          | This month   |
| 14    | Pagination         | 🔜 TODO  | LOW      | Scalability    | 2          | Future       |
| 15    | Cache warming      | 🔜 TODO  | LOW      | Performance    | 2          | Future       |
| 16    | Memoization        | 🔜 TODO  | LOW      | Performance    | 1          | Future       |
| 17    | Crypto tests       | 🔜 TODO  | HIGH     | Testing        | 2          | This week    |
| 18    | Concurrent tests   | 🔜 TODO  | HIGH     | Testing        | 2          | This week    |
| 19    | Timeout tests      | 🔜 TODO  | HIGH     | Testing        | 2          | This week    |
| 20-22 | Documentation      | 🔜 TODO  | LOW      | Maintenance    | 3          | This quarter |

---

## TOTAL EFFORT ESTIMATE

**Already Done (Deploy Now):** 0 hours (all 6 bugs fixed in code)

**This Week (Must Have):** 6 hours

- Add 3 critical test files (2 + 2 + 2)

**This Month (Should Have):** 11 hours

- Rate limiting (3h)
- Auth timeout (1h)
- Cache telemetry (1h)
- Env tests (2h)
- CORS (1h)
- Payload validation (1h)
- Graceful degradation (2h)

**This Quarter (Nice to Have):** 3 hours

- Documentation (3h)

**Future (Optional):** 6 hours

- Pagination, warming, memoization

**Grand Total:** 26 hours over next 3 months
