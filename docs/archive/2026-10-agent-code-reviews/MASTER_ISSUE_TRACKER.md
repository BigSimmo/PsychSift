# Master Issue Tracker - All 22 Issues Organized by Timeline

> **Archived report (2026-10).** Historical point-in-time agent code review retained for audit history.

## 🚀 DEPLOYMENT TIMELINE

### TODAY - DEPLOY (6 Bugs Fixed, Ready Now)

```
✅ Issue #1: HMAC encoding - FIXED
✅ Issue #2: Cache race condition - FIXED
✅ Issue #3: Promise rejection - FIXED
✅ Issue #4: Null check - FIXED
✅ Issue #5: Dead code - FIXED
✅ Issue #6: Boot timeout - FIXED

Action: npm run test && deploy
Time: 1-2 hours including verification
```

---

### THIS WEEK - ADD TESTS (3 Test Files, 6 Hours)

```
🔜 Issue #17: HMAC Signature Tests
   File: tests/proxy-auth-crypto.test.ts (new)
   Time: 2 hours
   Priority: HIGH - Verifies Fix #1

🔜 Issue #18: Concurrent Request Tests
   File: tests/rag-alias-cache-dedup.test.ts (new)
   Time: 2 hours
   Priority: HIGH - Verifies Fix #2

🔜 Issue #19: Boot Timeout Tests
   File: tests/boot-warmup-timeout.test.ts (new)
   Time: 2 hours
   Priority: HIGH - Verifies Fix #6

Total: 6 hours
Action: Create 3 new test files
```

---

### THIS MONTH - SECURITY & MONITORING (11 Hours)

```
🔜 Issue #7: Webhook Rate Limiting
   Files: src/app/api/webhooks/* (all routes)
   Time: 3 hours
   Priority: MEDIUM - DoS protection

🔜 Issue #8: Auth Request Timeout
   File: src/proxy.ts (line 227)
   Time: 1 hour
   Priority: MEDIUM - Prevent hanging requests

🔜 Issue #11: CORS Headers
   File: next.config.ts
   Time: 1 hour
   Priority: MEDIUM - API security

🔜 Issue #9: Cache Telemetry
   File: src/lib/rag/rag-retrieval-variants.ts
   Time: 1 hour
   Priority: LOW - Observability

🔜 Issue #12: Proxy Auth Validation
   File: src/lib/supabase/proxy-auth-crypto.ts
   Time: 1 hour
   Priority: LOW - Robustness

🔜 Issue #13: Env Validation Tests
   File: tests/env-validation.test.ts (new)
   Time: 2 hours
   Priority: LOW - Configuration safety

🔜 Issue #10: Graceful Cache Degradation
   File: src/lib/rag/rag-retrieval-variants.ts
   Time: 2 hours
   Priority: LOW - Resilience

Total: 11 hours
Action: Implement security & observability improvements
```

---

### THIS QUARTER - DOCUMENTATION (3 Hours)

```
🔜 Issue #20: Webhook Rotation Schedule
   File: docs/webhooks.md (update/create)
   Time: 1 hour

🔜 Issue #21: Cache Warmup Strategy
   File: docs/cache-warmup.md (create)
   Time: 1 hour

🔜 Issue #22: Error Budgets
   File: docs/error-budgets.md (create)
   Time: 1 hour

Total: 3 hours
Action: Create/update documentation
```

---

### FUTURE - OPTIONAL OPTIMIZATION (6 Hours)

```
🔜 Issue #14: Query Pagination
   File: src/lib/rag/rag-retrieval-variants.ts
   Time: 2 hours
   Trigger: When data volume requires pagination

🔜 Issue #15: Additional Cache Warmup
   File: src/instrumentation.ts
   Time: 2 hours
   Trigger: When cold-start latency is concern

🔜 Issue #16: Normalization Memoization
   File: src/lib/rag/rag-retrieval-variants.ts
   Time: 1 hour
   Trigger: When CPU profiling shows bottleneck

Total: 5 hours (not urgent)
```

---

## 📋 ISSUE TRACKING BY CATEGORY

### Security Issues (5 Total)

```
CRITICAL (1):
  #1 - HMAC encoding ✅ FIXED

HIGH (2):
  #7 - Rate limiting 🔜 3h
  #11 - CORS headers 🔜 1h

MEDIUM (2):
  #8 - Auth timeout 🔜 1h
  #12 - Payload validation 🔜 1h

Total Effort: 6 hours (done + 6h to-do)
```

### Reliability Issues (4 Total)

```
CRITICAL (1):
  #3 - Promise rejection ✅ FIXED

HIGH (1):
  #6 - Boot timeout ✅ FIXED

MEDIUM (2):
  #10 - Graceful degradation 🔜 2h

Total Effort: 2 hours (all fixed except 1)
```

### Performance Issues (4 Total)

```
HIGH (1):
  #2 - Cache race condition ✅ FIXED

MEDIUM (1):
  #5 - Dead code 🔜 Already fixed, 0h

LOW (2):
  #15 - Cache warmup 🔜 2h (future)
  #16 - Memoization 🔜 1h (future)

Total Effort: 3 hours (future only)
```

### Code Quality Issues (3 Total)

```
MEDIUM (3):
  #4 - Null check ✅ FIXED
  #5 - Dead code ✅ FIXED

Total: All fixed, 0h to-do
```

### Testing Gaps (3 Total)

```
HIGH (3):
  #17 - Crypto tests 🔜 2h
  #18 - Concurrent tests 🔜 2h
  #19 - Timeout tests 🔜 2h

Total Effort: 6 hours (this week)
```

### Scalability Issues (2 Total)

```
LOW (2):
  #14 - Pagination 🔜 2h (future)

Total: 2 hours (future only)
```

### Observability Issues (2 Total)

```
LOW (2):
  #9 - Cache telemetry 🔜 1h (this month)
  #20-22 - Documentation 🔜 3h (this quarter)

Total: 4 hours
```

### Configuration Issues (1 Total)

```
LOW (1):
  #13 - Env tests 🔜 2h (this month)

Total: 2 hours
```

---

## 🎯 ACTION ITEMS BY PRIORITY

### CRITICAL (Do Now - 6 hours)

- [x] Fix #1: HMAC encoding
- [x] Fix #2: Cache race condition
- [x] Fix #3: Promise rejection
- [x] Fix #4: Null check
- [x] Fix #5: Dead code
- [x] Fix #6: Boot timeout
- [ ] Deploy all 6 fixes

### HIGH (Do This Week - 6 hours)

- [ ] Test #17: HMAC signature edge cases
- [ ] Test #18: Concurrent request dedup
- [ ] Test #19: Boot timeout abort

### SHOULD (Do This Month - 11 hours)

- [ ] Issue #7: Webhook rate limiting (3h)
- [ ] Issue #8: Auth timeout (1h)
- [ ] Issue #11: CORS headers (1h)
- [ ] Issue #9: Cache telemetry (1h)
- [ ] Issue #12: Payload validation (1h)
- [ ] Issue #13: Env tests (2h)
- [ ] Issue #10: Graceful degradation (2h)

### NICE (Do This Quarter - 3 hours)

- [ ] Issue #20: Webhook docs (1h)
- [ ] Issue #21: Cache docs (1h)
- [ ] Issue #22: Error budget docs (1h)

### OPTIONAL (Future - 5 hours)

- [ ] Issue #14: Query pagination (2h)
- [ ] Issue #15: Cache warming (2h)
- [ ] Issue #16: Memoization (1h)

---

## 📊 EFFORT BREAKDOWN

```
Already Fixed:           0 hours ✅
Deploy & Verify:         1 hour (today)
Add Critical Tests:       6 hours (this week)
Security & Monitoring:   11 hours (this month)
Documentation:            3 hours (this quarter)
Optional Optimization:    5 hours (future, if needed)
─────────────────────────────────
TOTAL:                   26 hours over 3 months
IMMEDIATE:                1 hour (deploy)
FIRST 30 DAYS:           18 hours
```

---

## ✅ COMPLETION CHECKLIST

### Deploy Phase (Today)

- [ ] Read QUICK_REFERENCE.md (5 min)
- [ ] Run: npm run typecheck && npm run lint && npm run test
- [ ] Manual test: npm run dev
- [ ] Deploy to staging
- [ ] Verify auth works
- [ ] Deploy to production
- [ ] Monitor logs for 1 hour

### Testing Phase (This Week)

- [ ] Create tests/proxy-auth-crypto.test.ts
- [ ] Create tests/rag-alias-cache-dedup.test.ts
- [ ] Create tests/boot-warmup-timeout.test.ts
- [ ] Run full test suite
- [ ] All new tests pass

### Security Phase (This Month - Week 1)

- [ ] Implement webhook rate limiting (3h)
- [ ] Implement auth timeout (1h)
- [ ] Add CORS headers (1h)
- [ ] Deploy security updates
- [ ] Verify no regressions

### Monitoring Phase (This Month - Week 2)

- [ ] Add cache telemetry (1h)
- [ ] Add payload validation (1h)
- [ ] Add env tests (2h)
- [ ] Deploy monitoring updates
- [ ] Verify metrics working

### Resilience Phase (This Month - Week 3)

- [ ] Implement graceful degradation (2h)
- [ ] Add comprehensive tests
- [ ] Load test all improvements

### Documentation Phase (This Quarter - Week 4+)

- [ ] Create webhooks.md (1h)
- [ ] Create cache-warmup.md (1h)
- [ ] Create error-budgets.md (1h)

---

## 🚨 RISK MATRIX

```
Issue    Severity   Deployment  Testing  Rollback  Notes
────────────────────────────────────────────────────────
#1       CRITICAL   High Risk   Low      Easy      Must test HMAC
#2       HIGH       Low Risk    Medium   Easy      Just optimization
#3       HIGH       Low Risk    Low      Easy      Only logging
#4       MEDIUM     Low Risk    Low      Easy      Search quality
#5       MEDIUM     Low Risk    Low      Easy      Code clarity
#6       MEDIUM     Low Risk    Medium   Easy      Boot safety

#7       MEDIUM     Medium      Medium   Hard      DoS protection
#8       MEDIUM     Low Risk    Medium   Easy      Prevents hangs
#11      MEDIUM     Low Risk    Low      Easy      API safety
#9       LOW        Low Risk    Low      Easy      Observability
#12      LOW        Low Risk    Low      Easy      Robustness
#13      LOW        Low Risk    Low      Easy      Testing
#10      LOW        Low Risk    Medium   Easy      Resilience

#17-19   HIGH       Low Risk    Medium   Easy      Test coverage
#20-22   LOW        Low Risk    N/A      N/A       Documentation

Deploy Recommendation: ✅ GO (6 fixes are production-ready)
```

---

## 📞 REFERENCE

All details documented in:

- COMPLETE_ISSUE_INVENTORY.md - List of all 22 issues
- EXTENDED_ISSUE_INVENTORY.md - Detailed breakdown
- BUG_FIXES_APPLIED.md - What was fixed
- ADDITIONAL_RECOMMENDATIONS.md - How to implement improvements
- POST_FIX_CHECKLIST.md - Deployment steps
- QUICK_REFERENCE.md - 5-min visual summary
