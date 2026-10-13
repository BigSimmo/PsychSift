# Phase 2: High-Yield Clinical & Architectural Hardening Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Phase 2 high-yield hardening addressing P1 issues: ISMP Tall Man lettering for psychiatric look-alike/sound-alike drugs (`CS-002`), semantic chunk boundary negation protection (`CHK-01`), prompt injection defense (`INJ-01`), React hydration mismatch elimination (`FE-HYD-01 to 04`), and Playwright test flake removal (`TS-02`).

**Architecture:**

1. Author `src/lib/medications/tall-man.ts` mapping all psychiatric LASA medication pairs under ISMP and Australian Commission on Safety and Quality in Health Care standards.
2. Upgrade `src/lib/chunking.ts` sentence boundary logic so that leading negative prohibitions ("DO NOT", "NEVER", "CONTRAINDICATED", "AVOID") are never split across chunks.
3. Enclose user search queries in structured `<user_query>` XML blocks with system prompt instruction guardrails.
4. Replace pre-mount `window.location.search` and browser globals in React components (`roster-manage-page.tsx`, `roster-swaps-page.tsx`, `differentials-home.tsx`, `teaching-qr-checkin-sheet.tsx`) with safe post-mount hydration patterns.
5. Replace hardcoded `waitForTimeout` calls with condition polling in Playwright specs.

**Tech Stack:** Next.js 16, React 19, TypeScript 6, Vitest 5, Playwright 1.63.

**Spec:** [`docs/audit/full-repository-audit-2026-10-11.md`](docs/audit/full-repository-audit-2026-10-11.md)

## Global Constraints

- No external dependency additions or lockfile churn (`package-lock.json` must remain pristine).
- Dev drive protection: zero deletions in `D:\Worktrees` or `D:\Repos`.
- Run focused tests and verify gates after each task.

## Review Focus

1. **Tall Man Lettering Accuracy:** Verify standard capitalization on high-risk pairs (`cloZAPine`, `cloNIDine`, `hydrOXYzine`, `hydrALAZINE`, `fluOXEtine`, `fluvOXAMine`).
2. **Chunking Negation Boundary:** Verify sentences with clinical prohibitions are preserved intact within a single chunk.
3. **Prompt Fencing:** Verify user queries containing adversarial instructions do not break out of `<user_query>` tags.
4. **Hydration Parity:** Verify server and client initial render HTML match byte-for-byte on cold reload.

---

### Task 1: ISMP Tall Man Lettering for Psychotropic Safety (`CS-002`)

**Files:**

- Create: `src/lib/medications/tall-man.ts`
- Test: `tests/tall-man-lettering.test.ts`

- [ ] **Step 1: Write failing unit test for Tall Man lettering**
      Create `tests/tall-man-lettering.test.ts` testing formatting of LASA pairs, case insensitivity, and fallback for non-LASA medications.
- [ ] **Step 2: Implement `src/lib/medications/tall-man.ts`**
      Implement `ISMP_TALL_MAN_MEDICATIONS` dictionary and `formatTallMan(name: string): string` helper.
- [ ] **Step 3: Run test to verify**
      Run `node ./node_modules/vitest/vitest.mjs run tests/tall-man-lettering.test.ts` and verify it passes.

---

### Task 2: Chunk Boundary Negation & Prohibition Preservation (`CHK-01`)

**Files:**

- Modify: `src/lib/chunking.ts:394-423`
- Create / Test: `tests/chunking-negation.test.ts`

- [ ] **Step 1: Write failing test proving negation split vulnerability**
      Create `tests/chunking-negation.test.ts` with a clinical sentence containing prohibitions ("DO NOT administer...") and verify it is not split mid-prohibition.
- [ ] **Step 2: Update `src/lib/chunking.ts`**
      Adjust `chunkTextBySentence` to avoid arbitrary cuts on short prefixes and protect leading clinical negations.
- [ ] **Step 3: Run test to verify**
      Run `node ./node_modules/vitest/vitest.mjs run tests/chunking-negation.test.ts` and `node ./node_modules/vitest/vitest.mjs run tests/chunking.test.ts`.

---

### Task 3: Prompt Injection Hardening in RAG Prompts (`INJ-01`)

**Files:**

- Modify: `src/lib/rag/rag.ts:3020-3031`
- Modify: `src/lib/rag/rag-answer-instructions.ts`
- Test: `tests/rag-prompt-injection.test.ts`

- [ ] **Step 1: Write unit test verifying prompt structuring and query fencing**
      Create `tests/rag-prompt-injection.test.ts` asserting `<user_query>` wrapping and prompt delimiter escaping.
- [ ] **Step 2: Update prompt assembly in `src/lib/rag/rag.ts` & instructions in `rag-answer-instructions.ts`**
      Fence user queries and instruct the model to treat `<user_query>` strictly as clinical data.
- [ ] **Step 3: Run test to verify**
      Run `node ./node_modules/vitest/vitest.mjs run tests/rag-prompt-injection.test.ts`.

---

### Task 4: React Hydration Mismatch Elimination (`FE-HYD-01 to 04`)

**Files:**

- Modify: `src/components/roster/manage/roster-manage-page.tsx:172-174`
- Modify: `src/components/roster/swaps/roster-swaps-page.tsx:88-90`
- Modify: `src/components/teaching-attendance/teaching-qr-checkin-sheet.tsx:32`
- Modify: `src/components/clinical-dashboard/differentials-home.tsx:990-1010`
- Test: `tests/roster-manage.dom.test.tsx`

- [ ] **Step 1: Refactor `roster-manage-page.tsx` and `roster-swaps-page.tsx`**
      Use `useState("")` / `useState<string | null>(null)` with `useEffect` to synchronize URL `?team=` post-mount.
- [ ] **Step 2: Refactor `teaching-qr-checkin-sheet.tsx`**
      Use `useState(false)` with `useEffect` to detect `"BarcodeDetector" in window` post-mount.
- [ ] **Step 3: Refactor `differentials-home.tsx`**
      Ensure initial URL ids synchronize post-mount without altering initial SSR markup.
- [ ] **Step 4: Run DOM tests to verify**
      Run `node ./node_modules/vitest/vitest.mjs run tests/roster-manage.dom.test.tsx`.

---

### Task 5: Playwright Flake Elimination (`TS-02`)

**Files:**

- Modify: `tests/ui-chrome-scroll.spec.ts:226`

- [ ] **Step 1: Replace arbitrary sleep with condition polling**
      Replace `await page.waitForTimeout(400)` with `await expect.poll(...)` or state assertion.
- [ ] **Step 2: Verify test syntax and lint**
      Run `npm run lint` and `npm run typecheck`.

---

### Task 6: Phase 2 Quality Gates & Final Verification

- [ ] **Step 1: Run typecheck**
- [ ] **Step 2: Run format check**
- [ ] **Step 3: Run all new and modified test suites**
- [ ] **Step 4: Report results to Josh**
