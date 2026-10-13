# Phase 1: Critical P0 Hotfixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remediate the three Critical P0 blockers identified in the full repository audit (`MEM-01/MEM-02`, `TS-01`, `CS-001`) with complete test-driven verification, eliminating serverless memory leaks, preventing Vitest mock cross-contamination, and providing psychiatric medical math calculators with robust clinical boundary validation.

**Architecture:**

1. Use the existing zero-dependency `src/lib/bounded-ttl-cache.ts` LRU/TTL primitive across `openai.ts` and `signed-url-cache.ts` to strictly cap memory consumption and eliminate OOM and cross-request leakage risks in warm serverless containers.
2. Introduce `tests/setup/node.setup.ts` with automatic `afterEach` mock restoration and register it under the Node project in `vitest.config.mts`.
3. Scaffold psychiatric medical math calculators in `src/lib/calculators/clinical-math/` (renal CrCl/eGFR, QTc correction, lithium clearance) isolated from psychometric fixture JSONs, backed by comprehensive unit tests.

**Tech Stack:** TypeScript 6, Node.js 24, Vitest 5, Next.js 16.

**Spec:** [`docs/audit/full-repository-audit-2026-10-11.md`](docs/audit/full-repository-audit-2026-10-11.md)

## Global Constraints

- Zero npm package installations or lockfile churn (`package-lock.json` must remain pristine to satisfy `check:installed-lock-parity`).
- Strict dev drive protection: never delete or prune directories in `D:\Worktrees` or `D:\Repos`.
- Preserve existing psychometric calculator governance hashes (`check:calculator-content`).
- Smallest sufficient verification gate: run focused Vitest and typecheck after each task.

## Review Focus

1. **Renal CrCl / eGFR zero/negative edge cases:** Inputs where age <= 0, weight <= 0, or creatinine <= 0 must fail-closed with safe error results rather than `NaN` or `Infinity`.
2. **QTc correction division-by-zero:** Heart rate <= 0 or RR interval <= 0 must fail-closed safely without mathematical exceptions.
3. **Lithium clearance physiological boundaries:** Extreme weights or renal values must produce bounded results with clinical warnings.
4. **Cache eviction bounds:** LRU cache must strictly evict oldest entries once capacity is exceeded without retaining orphan references.
5. **Vitest mock isolation:** Global stubs in node environment tests must be cleanly restored without leaking across suites.

---

### Task 1: Vitest Mock Isolation & Setup (`TS-01`)

**Files:**

- Create: `tests/setup/node.setup.ts`
- Modify: `vitest.config.mts:100-110`
- Test: `tests/setup-node.test.ts`

- [ ] **Step 1: Write failing test proving setup file is loaded in Node environment**
      Create `tests/setup-node.test.ts` that verifies mock isolation and stub restoration.
- [ ] **Step 2: Create `tests/setup/node.setup.ts`**
      Implement `afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); })`.
- [ ] **Step 3: Update `vitest.config.mts`**
      Add `setupFiles: ["tests/setup/node.setup.ts"]` to the `node` project in `vitest.config.mts`.
- [ ] **Step 4: Run focused test to verify**
      Run `npx vitest run tests/setup-node.test.ts` and verify it passes cleanly.
- [ ] **Step 5: Run full test suite sanity check**
      Run `npm run test` or focused suites to ensure existing node tests continue to pass without regression.

---

### Task 2: Serverless Cache Boundedness & Eviction Hardening (`MEM-01` & `MEM-02`)

**Files:**

- Modify: `src/lib/bounded-ttl-cache.ts`
- Modify: `src/lib/openai.ts:65, 145-169`
- Modify: `src/lib/signed-url-cache.ts:29, 45-59`
- Create / Test: `tests/bounded-ttl-cache.test.ts`

- [ ] **Step 1: Write failing tests for cache capacity & TTL eviction**
      Create `tests/bounded-ttl-cache.test.ts` testing LRU ordering, capacity trimming, TTL expiration, and falsy key handling.
- [ ] **Step 2: Enhance `src/lib/bounded-ttl-cache.ts`**
      Ensure robust LRU eviction (`oldestKey === undefined` check), clean pruning, and helper methods.
- [ ] **Step 3: Harden `src/lib/openai.ts`**
      Replace manual `while (queryEmbeddingCache.size > limit)` with `readExpiringCacheEntry` / `writeBoundedExpiringCacheEntry` or safe bounded LRU logic, ensuring `oldestKey === undefined` is handled and memory is strictly bounded.
- [ ] **Step 4: Harden `src/lib/signed-url-cache.ts`**
      Standardize the LRU eviction loop in `setCachedSignedUrl` to use `readExpiringCacheEntry` / `writeBoundedExpiringCacheEntry` so expired items are pruned on write.
- [ ] **Step 5: Run tests to verify**
      Run `npx vitest run tests/bounded-ttl-cache.test.ts` and `npx vitest run tests/openai.test.ts` to confirm passes.

---

### Task 3: Clinical Math Calculators Scaffolding & Verification (`CS-001`)

**Files:**

- Create: `src/lib/calculators/clinical-math/types.ts`
- Create: `src/lib/calculators/clinical-math/renal.ts`
- Create: `src/lib/calculators/clinical-math/qtc.ts`
- Create: `src/lib/calculators/clinical-math/lithium.ts`
- Create: `src/lib/calculators/clinical-math/index.ts`
- Create: `tests/clinical-math-calculators.test.ts`

- [ ] **Step 1: Write failing tests for medical math formulas**
      Create `tests/clinical-math-calculators.test.ts` containing standard clinical vectors:
  - Cockcroft-Gault CrCl for male/female with µmol/L and mg/dL creatinine.
  - CKD-EPI (2021) eGFR calculation and staging.
  - Bazett and Fridericia QTc calculations with heart rate and RR interval inputs.
  - Borderline / prolonged QTc risk category classification (>450ms male, >460ms female, >500ms high risk).
  - Lithium maintenance target validation (0.6–0.8 mmol/L) and toxicity alert thresholds (>1.2, >2.0 mmol/L).
  - Edge cases: negative/zero age, weight, heart rate, creatinine; extreme values.
- [ ] **Step 2: Implement `types.ts`**
      Define clinical math input/output types, units, and validation result schemas.
- [ ] **Step 3: Implement `renal.ts`**
      Implement Cockcroft-Gault formula ($CrCl = \frac{(140 - \text{age}) \times \text{weight} \times (0.85 \text{ if female})}{72 \times \text{SCr (mg/dL)}}$ or $\frac{(140 - \text{age}) \times \text{weight} \times (1.04 \text{ if female else } 1.23)}{\text{SCr (\mu mol/L)}}$) and CKD-EPI 2021 equation with strict safety guards.
- [ ] **Step 4: Implement `qtc.ts`**
      Implement Bazett ($QT / \sqrt{RR}$), Fridericia ($QT / \sqrt[3]{RR}$), Framingham, and Hodges formulas with clinical risk interpretation bands.
- [ ] **Step 5: Implement `lithium.ts`**
      Implement lithium dosing adjustment and therapeutic range helper.
- [ ] **Step 6: Implement `index.ts`**
      Export all clinical math utilities and types.
- [ ] **Step 7: Run focused tests to verify**
      Run `npx vitest run tests/clinical-math-calculators.test.ts` and verify 100% test pass rate.

---

### Task 4: Phase 1 Final Verification & Quality Gates

**Files:**

- Verify: Full verification gate `verify:cheap` (lock parity, diff integrity, lint, typecheck, tests).

- [ ] **Step 1: Run typecheck**
      Run `npm run typecheck` to verify zero type regressions.
- [ ] **Step 2: Run lint**
      Run `npm run lint` to verify zero lint regressions.
- [ ] **Step 3: Run check:calculator-content**
      Run `npm run check:calculator-content` to ensure governance files and fixtures remain unperturbed.
- [ ] **Step 4: Run unit tests**
      Run `npm run test` to verify all node and jsdom test suites pass.
- [ ] **Step 5: Document Phase 1 completion and report to Josh**
