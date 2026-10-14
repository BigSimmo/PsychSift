> **Archived report (2026-10).** Historical point-in-time agent code review retained for audit history.

# Complete Issue Inventory - All Issues Found in Chat

## 🔴 CRITICAL ISSUES (Fixes Applied ✅)

### 1. HMAC Signature Verification Using Wrong Encoding

**Status:** ✅ FIXED  
**File:** `src/lib/supabase/proxy-auth-crypto.ts` (lines 39-40)  
**Severity:** CRITICAL - Authentication  
**Issue:** Converting base64url signatures to UTF-8 buffers causes encoding mismatches  
**Fix Applied:** Changed `Buffer.from(x, "utf8")` → `Buffer.from(x, "base64url")`  
**Impact:** Fixes authentication failures  
**Test Coverage:** Not yet tested (recommended: add HMAC edge case tests)

---

## 🟠 HIGH PRIORITY ISSUES

### 2. Cache Race Condition in RAG Alias Fetching

**Status:** ✅ FIXED  
**File:** `src/lib/rag/rag-retrieval-variants.ts` (lines 50-156)  
**Severity:** HIGH - Data Consistency/Concurrency  
**Issue:** Multiple concurrent requests fetch same cache key simultaneously, causing redundant DB queries and potential data inconsistency  
**Fix Applied:** Added `ragAliasCacheRequests` deduplication map to track in-flight requests  
**Impact:** Eliminates redundant DB queries under concurrent load  
**Test Coverage:** Not yet tested (recommended: add concurrent request tests)

### 3. Unhandled Promise Rejection During Boot

**Status:** ✅ FIXED  
**File:** `src/instrumentation.ts` (lines 72-78)  
**Severity:** HIGH - Error Handling  
**Issue:** `void warmEnabledRagAliasCache()` has no error handler; errors silently fail  
**Fix Applied:** Added `.catch()` with logging  
**Impact:** Errors during cache warmup now visible in logs  
**Test Coverage:** Not yet tested (recommended: add timeout tests)

---

## 🟡 MEDIUM PRIORITY ISSUES

### 4. Missing Null Check on Zone Color

**Status:** ✅ FIXED  
**File:** `src/lib/rag/rag-retrieval-variants.ts` (line 284)  
**Severity:** MEDIUM - String Handling  
**Issue:** `queriedZoneColour(query)` could return empty string, resulting in malformed variants like `" zone"`  
**Fix Applied:** Added `?.trim()` check before using zoneColour  
**Impact:** Prevents empty search query variants  
**Test Coverage:** Covered by existing tests

### 5. Double Assignment Dead Code in Proxy Response

**Status:** ✅ FIXED  
**File:** `src/proxy.ts` (lines 212-258)  
**Severity:** MEDIUM - Logic Error/Null Safety  
**Issue:** `response` variable initialized then immediately overwritten; if `setAll()` never fires, uses stale object  
**Fix Applied:** Initialize as `null`, add null-safe fallback at return  
**Impact:** Eliminates dead code path, prevents potential null references  
**Test Coverage:** Covered by existing tests

### 6. Missing Abort Timeout on Boot Cache Warmup

**Status:** ✅ FIXED  
**File:** `src/lib/rag/rag-retrieval-variants.ts` (lines 118-136)  
**Severity:** MEDIUM - Reliability  
**Issue:** Cache warmup at boot could hang indefinitely if database unresponsive  
**Fix Applied:** Added 5-second abort timeout with `AbortController`  
**Impact:** Prevents boot hangs during network issues  
**Test Coverage:** Not yet tested (recommended: add timeout tests)

---

## 🟢 LOW PRIORITY ISSUES (Not Yet Fixed - Recommended Only)

### 7. Missing Rate Limiting on Webhook Endpoints

**Severity:** LOW-MEDIUM - Security/DoS  
**File:** `src/app/api/webhooks/*` (all webhook routes)  
**Issue:** No rate limiting on `/api/webhooks/*` endpoints; malicious actors could trigger DoS  
**Recommendation:** Implement rate limiting (see ADDITIONAL_RECOMMENDATIONS.md § 1.2)  
**Estimated Fix Time:** 3 hours  
**Priority:** Implement this month

### 8. Missing Auth Request Timeout

**Severity:** LOW-MEDIUM - Reliability  
**File:** `src/proxy.ts` (line 227)  
**Issue:** `supabase.auth.getClaims()` has no timeout; stuck auth service stalls every request  
**Recommendation:** Add 5-second timeout (see ADDITIONAL_RECOMMENDATIONS.md § 3.2)  
**Estimated Fix Time:** 1 hour  
**Priority:** Implement this month

### 9. No Cache Hit/Miss Telemetry

**Severity:** LOW - Observability  
**File:** `src/lib/rag/rag-retrieval-variants.ts`  
**Issue:** Cache effectiveness invisible; bugs causing all misses go undetected  
**Recommendation:** Add telemetry metrics (see ADDITIONAL_RECOMMENDATIONS.md § 3.1)  
**Estimated Fix Time:** 1 hour  
**Priority:** Implement this month

### 10. Missing Graceful Cache Degradation

**Severity:** LOW - Resilience  
**File:** `src/lib/rag/rag-retrieval-variants.ts`  
**Issue:** If `fetchEnabledRagAliases()` fails, entire search expansion skipped; partial data better than none  
**Recommendation:** Add fallback logic (see ADDITIONAL_RECOMMENDATIONS.md § 3.3)  
**Estimated Fix Time:** 2 hours  
**Priority:** Implement in 1-2 weeks

### 11. Missing CORS Headers on API Routes

**Severity:** LOW - Security  
**File:** `next.config.ts`  
**Issue:** No explicit CORS configuration; could allow unintended cross-origin requests  
**Recommendation:** Add CORS headers (see ADDITIONAL_RECOMMENDATIONS.md § 1.4)  
**Estimated Fix Time:** 1 hour  
**Priority:** Implement this month

### 12. No Proxy Auth Payload Validation

**Severity:** LOW - Robustness  
**File:** `src/lib/supabase/proxy-auth-crypto.ts`  
**Issue:** No validation that payload is well-formed JSON before parsing  
**Recommendation:** Add payload structure validation (see ADDITIONAL_RECOMMENDATIONS.md § 1.3)  
**Estimated Fix Time:** 1 hour  
**Priority:** Implement this month

### 13. Missing Environment Variable Validation Tests

**Severity:** LOW - Configuration Safety  
**File:** `tests/` (needs new file)  
**Issue:** No tests validate environment variables are properly coerced at startup  
**Recommendation:** Add validation test suite (see ADDITIONAL_RECOMMENDATIONS.md § 1.1)  
**Estimated Fix Time:** 2 hours  
**Priority:** Implement this month

### 14. No Pagination for Large Alias Fetches

**Severity:** LOW - Performance  
**File:** `src/lib/rag/rag-retrieval-variants.ts` (line 180)  
**Issue:** Fetches up to 200 aliases per scope; could scale poorly  
**Recommendation:** Add cursor-based pagination (see ADDITIONAL_RECOMMENDATIONS.md § 2.1)  
**Estimated Fix Time:** 2 hours  
**Priority:** Implement when scaling concerns arise

### 15. Missing Additional Cache Warmup

**Severity:** LOW - Performance  
**File:** `src/instrumentation.ts`  
**Issue:** Only `rag_aliases` warmed at boot; other lookups cold on first request  
**Recommendation:** Warm therapy-compass, document categories, etc. (see ADDITIONAL_RECOMMENDATIONS.md § 2.2)  
**Estimated Fix Time:** 2 hours  
**Priority:** Implement when cold-start latency becomes issue

### 16. No Memoization of Repeated Normalization

**Severity:** LOW - Performance  
**File:** `src/lib/rag/rag-retrieval-variants.ts` (line 161)  
**Issue:** `normalizeAliasLookup()` called twice per alias; 400 regex ops for 200 aliases  
**Recommendation:** Add memoization (see ADDITIONAL_RECOMMENDATIONS.md § 2.3)  
**Estimated Fix Time:** 1 hour  
**Priority:** Implement if profiling shows CPU bottleneck

### 17. Missing HMAC Signature Edge Case Tests

**Severity:** MEDIUM - Testing Coverage  
**File:** `tests/proxy-auth-crypto.test.ts` (needs new file)  
**Issue:** Fix #1 (HMAC encoding) has no test coverage for edge cases (empty strings, non-UTF-8, etc.)  
**Recommendation:** Add comprehensive crypto tests (see ADDITIONAL_RECOMMENDATIONS.md § 4.3)  
**Estimated Fix Time:** 2 hours  
**Priority:** HIGH - Add this week

### 18. Missing Concurrent Request Tests (Fix #2)

**Severity:** MEDIUM - Testing Coverage  
**File:** `tests/rag-alias-cache-dedup.test.ts` (needs new file)  
**Issue:** Cache deduplication logic (Fix #2) is untested under real concurrency  
**Recommendation:** Add concurrent request tests (see ADDITIONAL_RECOMMENDATIONS.md § 4.1)  
**Estimated Fix Time:** 2 hours  
**Priority:** HIGH - Add this week

### 19. Missing Boot Timeout Tests (Fix #6)

**Severity:** MEDIUM - Testing Coverage  
**File:** `tests/boot-warmup-timeout.test.ts` (needs new file)  
**Issue:** 5-second timeout logic (Fix #6) is untested  
**Recommendation:** Add timeout tests (see ADDITIONAL_RECOMMENDATIONS.md § 4.2)  
**Estimated Fix Time:** 2 hours  
**Priority:** HIGH - Add this week

### 20. Missing Webhook Rotation Documentation

**Severity:** LOW - Maintenance  
**File:** `docs/webhooks.md` (needs creation/update)  
**Issue:** No documented schedule for rotating webhook secrets  
**Recommendation:** Create rotation timeline (see ADDITIONAL_RECOMMENDATIONS.md § 5.1)  
**Estimated Fix Time:** 1 hour  
**Priority:** Implement this quarter

### 21. Missing Cache Warmup Documentation

**Severity:** LOW - Maintenance  
**File:** `docs/cache-warmup.md` (needs creation)  
**Issue:** Cache warmup strategy not documented; hard to maintain or extend  
**Recommendation:** Create strategy guide (see ADDITIONAL_RECOMMENDATIONS.md § 5.2)  
**Estimated Fix Time:** 1 hour  
**Priority:** Implement this quarter

### 22. Missing Error Budget Definition

**Severity:** LOW - Maintenance  
**File:** `docs/error-budgets.md` (needs creation)  
**Issue:** No documented acceptable failure rates for startup/warmup  
**Recommendation:** Define error budgets (see ADDITIONAL_RECOMMENDATIONS.md § 5.3)  
**Estimated Fix Time:** 1 hour  
**Priority:** Implement this quarter

---

## 📊 ISSUE SUMMARY BY STATUS

### ✅ FIXED (6 Issues)

1. HMAC encoding mismatch
2. Cache race condition
3. Unhandled promise rejection
4. Missing null check
5. Double assignment dead code
6. Missing boot timeout

### 🔜 RECOMMENDED (16 Issues)

All documented with implementation guides in ADDITIONAL_RECOMMENDATIONS.md

---

## 📈 PRIORITY BREAKDOWN

### Immediate (Deploy Today)

- ✅ All 6 fixed bugs are ready

### This Week (1-2 Days)

- 🔜 Add HMAC signature tests (security)
- 🔜 Add concurrent request tests (verify Fix #2)
- 🔜 Add timeout tests (verify Fix #6)

### This Month (1-4 Weeks)

- 🔜 Implement auth timeout (prevents hangs)
- 🔜 Add webhook rate limiting (DoS protection)
- 🔜 Add cache telemetry (observability)
- 🔜 Add env validation tests (safety)
- 🔜 Add CORS headers (security)
- 🔜 Add proxy auth validation (robustness)
- 🔜 Add graceful degradation (resilience)

### This Quarter (1-3 Months)

- 🔜 Query pagination (scalability)
- 🔜 Additional cache warmup (performance)
- 🔜 Cache memoization (optimization)
- 🔜 Documentation updates (maintenance)

### As-Needed (Future)

- 🔜 Memoization (if CPU bottleneck identified)
- 🔜 Pagination (if data volume grows)

---

## 🎯 ACTIONABLE NEXT STEPS

### TODAY

```bash
# 1. All 6 bugs are fixed - just deploy
npm run typecheck && npm run lint && npm run test
npm run dev  # Manual test
git push && deploy
```

### THIS WEEK

```
Add 3 critical test files:
- tests/proxy-auth-crypto.test.ts (HMAC edge cases)
- tests/rag-alias-cache-dedup.test.ts (concurrent requests)
- tests/boot-warmup-timeout.test.ts (boot timeout)

Time: ~6 hours total
```

### THIS MONTH

```
Implement 7 security/reliability recommendations:
- Auth timeout (1h)
- Webhook rate limiting (3h)
- Cache telemetry (1h)
- Env validation tests (2h)
- CORS headers (1h)
- Proxy auth validation (1h)
- Graceful degradation (2h)

Time: ~11 hours total
```

---

## 📋 COMPLETE CHECKLIST

### Fixed Issues (Done ✅)

- [x] HMAC encoding
- [x] Cache race condition
- [x] Promise rejection
- [x] Null check
- [x] Dead code assignment
- [x] Boot timeout

### Priority Tests (Do This Week)

- [ ] HMAC signature tests
- [ ] Concurrent cache tests
- [ ] Boot timeout tests

### Priority Features (Do This Month)

- [ ] Auth timeout
- [ ] Webhook rate limiting
- [ ] Cache telemetry
- [ ] Env validation
- [ ] CORS headers
- [ ] Proxy validation
- [ ] Graceful degradation

### Documentation (Do This Quarter)

- [ ] Cache warmup docs
- [ ] Webhook rotation docs
- [ ] Error budgets doc

### Optional Optimizations (Future)

- [ ] Query pagination
- [ ] Additional cache warming
- [ ] Normalization memoization

---

## 📞 REFERENCE

For details on any issue:

- **Fixed bugs:** See BUG_FIXES_APPLIED.md
- **Recommended improvements:** See ADDITIONAL_RECOMMENDATIONS.md
- **Testing strategy:** See POST_FIX_CHECKLIST.md
- **Deployment plan:** See QUICK_REFERENCE.md
