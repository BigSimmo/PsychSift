> **Archived report (2026-10).** Historical point-in-time agent code review retained for audit history.

# Post-Bug-Fix Checklist

## Immediate Actions (Next 24 Hours)

### Verification

- [ ] Run `npm run typecheck` — confirm no TypeScript errors
- [ ] Run `npm run lint` — confirm no linting violations
- [ ] Run `npm run test` — confirm all unit tests pass
- [ ] Run `npm run test:coverage` — verify coverage hasn't dropped
- [ ] Local dev test: `npm run dev` — test normal flows work
- [ ] Test authentication flow manually (user login → dashboard)

### Code Review

- [ ] Review all 6 changes in `BUG_FIXES_APPLIED.md`
- [ ] Verify HMAC signature changes work with existing auth tokens
- [ ] Verify cache deduplication doesn't break single-request scenarios

### Deploy Preparation

- [ ] Update CHANGELOG with bug fixes
- [ ] Tag release as patch/minor depending on severity
- [ ] Document breaking changes (if any) in release notes

---

## Short-Term (1–2 Weeks)

### Testing

- [ ] Add unit tests for Fix #1 (HMAC crypto) — **HIGH PRIORITY**
- [ ] Add concurrent request tests for Fix #2 (cache dedup)
- [ ] Add timeout tests for Fix #6 (boot warmup)
- [ ] Run E2E tests: `npm run test:e2e` (Playwright)
- [ ] Load test with concurrent users to verify cache dedup works

### Monitoring

- [ ] Set up alerts for:
  - `"rag_aliases cache warmup failed"` in logs
  - Proxy auth failures (HMAC mismatches)
  - Cache hit/miss ratio drops >10%
- [ ] Create dashboard for cache performance metrics
- [ ] Monitor boot-time latency for 5 deploys

### Documentation

- [ ] Document cache warmup strategy (see ADDITIONAL_RECOMMENDATIONS.md)
- [ ] Document webhook rate limiting plan
- [ ] Add troubleshooting guide for auth failures

---

## Medium-Term (1–2 Months)

### High-Priority Recommendations

- [ ] Implement auth timeout (Fix MEDIUM #3.2) — prevents hanging requests
- [ ] Add webhook rate limiting (Security 1.2) — DoS protection
- [ ] Add HMAC signature validation tests (Testing 4.3) — verify crypto correctness
- [ ] Add graceful cache degradation (Robustness 3.3) — improve search resilience

### Observability

- [ ] Add cache telemetry (Robustness 3.1) — monitor effectiveness
- [ ] Add boot-time latency tracking
- [ ] Set up alerts for cache warmup failures
- [ ] Track proxy auth signature failures

### Testing

- [ ] Add environment variable validation tests (Security 1.1)
- [ ] Add concurrent request tests (Testing 4.1)
- [ ] Add timeout tests (Testing 4.2)
- [ ] Expand HMAC test suite (Testing 4.3)

---

## Ongoing (Quarterly)

### Security

- [ ] Review webhook secrets rotation schedule (per WEBHOOKS.md)
- [ ] Audit CORS headers annually
- [ ] Review CSP policy for new resources
- [ ] Update dependencies quarterly with `npm audit`

### Performance

- [ ] Monitor cache hit rates quarterly
- [ ] Review cache sizes and TTLs based on metrics
- [ ] Benchmark search latency trends
- [ ] Profile boot-time latency per release

### Maintenance

- [ ] Update cache warmup documentation if caches change
- [ ] Review error budgets for boot-time failures
- [ ] Document new caches added for warmup
- [ ] Maintain deployment runbooks

---

## Risk Mitigation

### What Could Break After These Fixes?

**Risk 1: HMAC Signature Incompatibility (Fix #1)**

- **Symptom:** Users logged out after deployment
- **Mitigation:** Monitor `proxyAuthUser` header in logs; test with existing tokens
- **Rollback:** Revert `proxy-auth-crypto.ts` if needed (old code handled UTF-8)

**Risk 2: Cache Deduplication Too Aggressive (Fix #2)**

- **Symptom:** Stale aliases for 5 minutes after new aliases are added
- **Mitigation:** Monitor cache hit rate; verify concurrent requests get same results
- **Rollback:** Remove `ragAliasCacheRequests` tracking

**Risk 3: Boot Timeout Aborts Before Completion (Fix #6)**

- **Symptom:** `warmEnabledRagAliasCache` timeout before 5s in slow environments
- **Mitigation:** Increase timeout if needed (currently 5s); log abort reason
- **Rollback:** Remove timeout, accept longer boot times

### Monitoring for Breakage

```typescript
// Log these events to observability backend
- "auth_signature_verification_failed" → indicates Fix #1 broke auth
- "cache_dedup_request_collision" → indicates Fix #2 working
- "cache_warmup_timeout_abort" → indicates Fix #6 triggered
- "cache_warmup_success" → indicates healthy startup
- "proxy_response_null" → indicates Fix #5 caused null reference
```

---

## Rollback Plan

If critical issues occur post-deployment:

### Rollback Fix #1 (HMAC)

```bash
git revert src/lib/supabase/proxy-auth-crypto.ts
npm run build && npm run test
# Deploy
```

### Rollback Fix #2 (Cache Dedup)

```bash
git revert src/lib/rag/rag-retrieval-variants.ts
# Remove ragAliasCacheRequests Map
npm run build && npm run test
# Deploy
```

### Rollback Fix #6 (Boot Timeout)

```bash
git revert src/lib/rag/rag-retrieval-variants.ts
# Remove setTimeout logic from warmEnabledRagAliasCache
npm run build && npm run test
# Deploy
```

---

## Performance Baselines

Measure these before and after deployment to detect regressions:

| Metric                         | Target | Acceptable Range        |
| ------------------------------ | ------ | ----------------------- |
| Boot time                      | <5s    | 4-6s (timeout overhead) |
| First search latency (cold)    | <2s    | <3s                     |
| First search latency (warm)    | <0.5s  | <1s                     |
| Cache hit rate                 | >80%   | >70%                    |
| HMAC verification success      | 100%   | >99%                    |
| Concurrent request dedup ratio | >95%   | >90%                    |

---

## Contact & Escalation

If issues arise:

1. **Cache/RAG Issues** → Check `src/lib/rag/rag-retrieval-variants.ts` logs
2. **Auth Failures** → Check `src/lib/supabase/proxy-auth-crypto.ts` logs
3. **Boot Hangs** → Check `src/instrumentation.ts` warmup logs
4. **Proxy Errors** → Check `src/proxy.ts` response object handling

All fixes include error logging; check application logs first before reverting.

---

## Success Criteria

Post-deployment is successful if:

✅ No HMAC signature verification failures for 24 hours  
✅ No proxy response null reference errors  
✅ Cache hit rate remains >80%  
✅ No "rag_aliases cache warmup failed" errors  
✅ Boot time stays <6 seconds  
✅ First search latency <2 seconds cold, <0.5s warm  
✅ All E2E tests pass  
✅ No regressions in performance benchmarks

---
