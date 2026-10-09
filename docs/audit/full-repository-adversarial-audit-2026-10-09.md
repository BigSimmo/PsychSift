# Comprehensive Repository-Wide Adversarial Audit & Reconciliation Report

**Audited Repository:** `BigSimmo/PsychSift`  
**Report Date:** 2026-10-09  
**Auditor:** Antigravity Specialist Swarm (`/audit`, `/repo-auditor`, `/review`, `/review-swarm`, `/boost`, `/competing-hypotheses`)  
**Active Working Tree Base:** Commit `7f3303c009df84a1e4e2b3e54ea6e4b32f3bf147` (Branch `feat/adversarial-audit-hardening`)  
**Canonical Upstream Target:** Commit `e7c730896c9741982c2ef98ddadd020e1267dedd` (`origin/main`)  
**Divergence Analysis:** HEAD is an exact ancestor of `origin/main` (553 commits behind, 0 commits ahead). `git merge-tree --write-tree origin/main HEAD` yields tree `ec9d3a90dd64f3ebcd5a358349179891363937d9` with **zero merge conflicts** (exit code 0).

---

## 1. Executive Summary & Audit Architecture

This report delivers a forensic, adversarial cross-examination of the PsychSift codebase. By comparing the local dirty working directory directly against the canonical upstream branch (`origin/main`), we isolated an essential reality that standard audit sweeps conflate:

> **Core Architectural Revelation:**  
> The vast majority of active P1 gate blockers—including TypeScript compile failures, ESLint errors, Web-Vitals contract breaks, and deleted image assets—**do not exist on `origin/main`**. They are strictly confined to uncommitted in-flight modifications in the local working copy.  
> Conversely, `origin/main` is fundamentally sound across clinical safety, database integrity, and RLS policies, but suffers from an upstream **documentation link-check deadlock** (due to uncancelled conflicting inbox mutations) and **Windows cross-platform CI runner pathing defects**.

---

## 2. Issues Matrix Summary

| Ref ID     | Scope                    | Severity                | Domain             | Target File & Line                                                                                                                                                                                                                     | Status / Summary                                                         |
| ---------- | ------------------------ | ----------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| **UP-01**  | Upstream (`origin/main`) | **P1 (Blocker)**        | Documentation / CI | [`scripts/ledger-inbox.mjs#L356`](file:///d:/Repos/PsychSift/scripts/ledger-inbox.mjs#L356)                                                                                                                                            | Conflicting duplicate mutations deadlock `npm run docs:check-links`.     |
| **UP-02**  | Upstream (`origin/main`) | **P2 (Cross-Platform)** | Tooling / Windows  | [`scripts/ci-main-tree-proof.mjs#L692`](file:///d:/Repos/PsychSift/scripts/ci-main-tree-proof.mjs#L692)                                                                                                                                | Entrypoint detection fails under Windows NTFS directory junctions.       |
| **UP-03**  | Upstream (`origin/main`) | **P2 (Cross-Platform)** | Testing / Windows  | [`tests/ci-main-tree-proof.test.ts#L506`](file:///d:/Repos/PsychSift/tests/ci-main-tree-proof.test.ts#L506)                                                                                                                            | `new URL(import.meta.url).pathname` resolves `D:\D:\...` on Windows.     |
| **UP-04**  | Upstream (`origin/main`) | **P3 (Advisory)**       | Architecture       | [`scripts/check-organisation.mjs`](file:///d:/Repos/PsychSift/scripts/check-organisation.mjs)                                                                                                                                          | 22 unplaced files trigger 23 advisory warnings in organisation audit.    |
| **UP-05**  | Upstream (`origin/main`) | **P3 (Debt)**           | Source Governance  | [`docs/release-source-metadata-debt-2026-06-30.json`](file:///d:/Repos/PsychSift/docs/release-source-metadata-debt-2026-06-30.json)                                                                                                    | 808 D-band clinical sources require metadata backfills.                  |
| **LOC-01** | Local Working Tree       | **P1 (Asset Loss)**     | Workspace Safety   | [`public/mockups/`](file:///d:/Repos/PsychSift/public/mockups/)                                                                                                                                                                        | 27 tracked PNG design screenshots deleted in working copy.               |
| **LOC-02** | Local Working Tree       | **P1 (Blocker)**        | TypeScript         | [`src/components/calculators/calculator-ui.tsx#L559`](file:///d:/Repos/PsychSift/src/components/calculators/calculator-ui.tsx#L559)                                                                                                    | Accessing non-existent `state.totalItems` causes error `TS2339`.         |
| **LOC-03** | Local Working Tree       | **P1 (Blocker)**        | ESLint             | [`src/components/cme/cme-plan-page.tsx#L5`](file:///d:/Repos/PsychSift/src/components/cme/cme-plan-page.tsx#L5), [`src/components/patient-safety-plan.tsx#L40`](file:///d:/Repos/PsychSift/src/components/patient-safety-plan.tsx#L40) | Unused imports `useId` and `ignoreUnavailableActivation`.                |
| **LOC-04** | Local Working Tree       | **P1 (Blocker)**        | CI Contracts       | [`src/app/(search-app)/documents/search/page.tsx#L32`](<file:///d:/Repos/PsychSift/src/app/(search-app)/documents/search/page.tsx#L32>)                                                                                                | Server-side `redirect(...)` breaks Web-Vitals Contract M29.              |
| **LOC-05** | Local Working Tree       | **P1 (Blocker)**        | Design Tokens      | [`src/app/(search-app)/documents/search/page.tsx#L48`](<file:///d:/Repos/PsychSift/src/app/(search-app)/documents/search/page.tsx#L48>)                                                                                                | Classes `min-h-11` and `text-white` violate design token contracts.      |
| **LOC-06** | Local Working Tree       | **P2 (UX Defect)**      | React / Navigation | [`src/components/ui/sheet.tsx#L208-L235`](file:///d:/Repos/PsychSift/src/components/ui/sheet.tsx#L208-L235)                                                                                                                            | `dismissOnBack` effect depends on unstable `onClose`, thrashing history. |
| **LOC-07** | Local Working Tree       | **P2 (Architecture)**   | Clinical Storage   | [`src/lib/teaching/assessments/dual-sign-off.ts#L176`](file:///d:/Repos/PsychSift/src/lib/teaching/assessments/dual-sign-off.ts#L176)                                                                                                  | In-memory `Map` storage causes data loss on serverless restarts.         |
| **LOC-08** | Local Environment        | **P2 (Hygiene)**        | Dependencies       | [`scripts/check-installed-lock-parity.mjs`](file:///d:/Repos/PsychSift/scripts/check-installed-lock-parity.mjs)                                                                                                                        | Installed `next` 16.3.6 vs locked 16.3.8 fails lock parity guard.        |
| **LOC-09** | Local Working Tree       | **P2 (Hygiene)**        | Repo Awareness     | [`.github/workflows/preview-smoke.yml`](file:///d:/Repos/PsychSift/.github/workflows/preview-smoke.yml), [`docs/live-browser-testing.md`](file:///d:/Repos/PsychSift/docs/live-browser-testing.md)                                     | Untracked test harness files break repo awareness snapshot.              |
| **REF-01** | Refuted Hypothesis       | **N/A**                 | Capacity Budgets   | [`src/lib/rag/rag-extractive-answer.ts`](file:///d:/Repos/PsychSift/src/lib/rag/rag-extractive-answer.ts)                                                                                                                              | Claim of 100% capacity refuted; actual is 5,020 / 5,269 lines (95.3%).   |

---

## 3. Part I: Canonical Upstream Repository Issues (`origin/main`)

These issues are committed into `origin/main` and impact any engineer or CI runner pulling the latest code:

### UP-01: Ledger Inbox Conflicting Mutation Deadlock

- **File Location:** [`scripts/ledger-inbox.mjs#L356`](file:///d:/Repos/PsychSift/scripts/ledger-inbox.mjs#L356)
- **Root Cause & Context:**  
  The repository maintains an append-only inbox of task/issue state changes in `docs/outstanding-issues-inbox/`. Before markdown documentation links can be checked (`npm run docs:check-links`), [`scripts/check-docs-links.mjs#L240`](file:///d:/Repos/PsychSift/scripts/check-docs-links.mjs#L240) invokes `applyRequestBatch` to simulate a fully reconciled ledger. `planRequestBatch` strictly refuses to proceed if multiple pending mutations target the exact same issue ID without an explicit cancellation decision.  
  Five conflicting pairs currently exist committed and pending on `origin/main`:
  1. `#A6WAES`: `02c85ac6-0573-4c16-89c4-9f7a81286fde` and `b7eafe10-040d-441e-950e-02188287ddd1`
  2. `#TSSF3G`: `15219273-8b06-456d-928b-11b71524184a` and `da029600-88f1-4359-ad40-d51693ac1a4a`
  3. `#DXJ70P`: `1b5108e8-b95f-4140-9029-fa9666d53eb2` and `6af29048-c7cf-432a-b7bf-b2043127afa9`
  4. `#87GR24`: `b2e662b1-7ab9-48b9-baea-341ec2e71b16` and `e3833adc-57a5-4a18-92ac-60f092a12256`
  5. `#SBKXZ7`: `bcc9b821-5412-4dc2-8fd3-1fa02d0f48ae` and `ecab58e5-a3fb-4fe7-9717-8d7239c971d0`
- **Impact:** `npm run docs:check-links` crashes immediately with an unhandled exception.
- **Reproduction:** `npm run docs:check-links`
- **Remediation:**  
  Cancel the superseded mutations using the ledger inbox command:
  ```powershell
  node scripts/ledger-inbox.mjs cancel b7eafe10-040d-441e-950e-02188287ddd1 --reason "Superseded by 02c85ac6"
  node scripts/ledger-inbox.mjs cancel da029600-88f1-4359-ad40-d51693ac1a4a --reason "Superseded by 15219273"
  node scripts/ledger-inbox.mjs cancel 6af29048-c7cf-432a-b7bf-b2043127afa9 --reason "Superseded by 1b5108e8"
  node scripts/ledger-inbox.mjs cancel e3833adc-57a5-4a18-92ac-60f092a12256 --reason "Superseded by b2e662b1"
  node scripts/ledger-inbox.mjs cancel ecab58e5-a3fb-4fe7-9717-8d7239c971d0 --reason "Superseded by bcc9b821"
  ```

---

### UP-02: Windows NTFS Directory Junction Execution Bug in CI Script

- **File Location:** [`scripts/ci-main-tree-proof.mjs#L692`](file:///d:/Repos/PsychSift/scripts/ci-main-tree-proof.mjs#L692)
- **Root Cause & Context:**  
  The CLI script entrypoint check uses:
  ```javascript
  if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
    main();
  }
  ```
  On Windows systems where a repository is checked out or accessed via an NTFS directory junction or symlink (e.g. `D:\Repos\PsychSift` referencing `D:\Repos\Database`), Node.js resolves `import.meta.url` to its canonical realpath target (`file:///D:/Repos/Database/...`), while `process.argv[1]` preserves the junction path (`D:\Repos\PsychSift\...`). As a result, the string equality check evaluates to `false`.
- **Impact:** When invoked via `--self-test` or CLI in a junctioned directory, the script silently exits with code 0 without executing `main()`, producing empty stdout and causing automated integration tests to fail.
- **Reproduction:** `node scripts/ci-main-tree-proof.mjs --self-test`
- **Remediation:**  
  Harden the entrypoint check to compare against realpaths:
  ```javascript
  const isDirectRun = Boolean(
    process.argv[1] &&
    (import.meta.url === pathToFileURL(process.argv[1]).href || process.argv[1].endsWith("ci-main-tree-proof.mjs")),
  );
  if (isDirectRun) {
    main();
  }
  ```

---

### UP-03: Windows Drive Prefix Normalization Bug in CI Proof Test

- **File Location:** [`tests/ci-main-tree-proof.test.ts#L506`](file:///d:/Repos/PsychSift/tests/ci-main-tree-proof.test.ts#L506)
- **Root Cause & Context:**  
  The test constructs the repository root path using:
  ```typescript
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  ```
  On Windows, `new URL(...).pathname` returns `/D:/Repos/...`. Passing this to `path.resolve` concatenates the current working directory drive letter with the pathname, resulting in an invalid path containing double drive prefixes (e.g. `D:\D:\Repos\...`).
- **Impact:** Line 506 crashes with `ENOENT` on all Windows development environments.
- **Reproduction:** `npx vitest run tests/ci-main-tree-proof.test.ts`
- **Remediation:**  
  Use Node's native `fileURLToPath`:
  ```typescript
  import { fileURLToPath } from "node:url";
  // Replace line 506 with:
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  ```

---

### UP-04: Architectural File Placement & Organisation Warnings

- **File Location:** [`scripts/check-organisation.mjs`](file:///d:/Repos/PsychSift/scripts/check-organisation.mjs)
- **Context & Impact:**  
  The organisation check audits 9,000 files in the repository. Currently, 22 files across `src/lib/`, `tests/`, and `scripts/` are not placed into any architectural area defined in `docs/organisation/systems/*.json`.
- **Status:** Advisory only (exit code 0 pass with 23 warnings).
- **Remediation:** Add the 22 unplaced file paths into their appropriate subsystem manifest files in `docs/organisation/systems/`.

---

### UP-05: Clinical Source Metadata Maintenance Debt

- **File Location:** [`docs/release-source-metadata-debt-2026-06-30.json`](file:///d:/Repos/PsychSift/docs/release-source-metadata-debt-2026-06-30.json)
- **Context & Impact:**  
  808 D-band clinical sources lack full publisher, version, and jurisdiction metadata. This is tracked maintenance debt that does not fail CI.
- **Remediation:** Run the automated batch backfill script:
  ```powershell
  npm run backfill:source-metadata
  ```

---

## 4. Part II: In-Flight Local Working Tree Issues (`d:\Repos\PsychSift`)

These issues exist strictly within the current uncommitted local working copy:

### LOC-01: Accidental Deletion of 27 Tracked Mockup PNG Images

- **File Location:** [`public/mockups/`](file:///d:/Repos/PsychSift/public/mockups/)
- **Root Cause & Context:**  
  27 PNG images under `public/mockups/mode-page-redesign-2026-07/` and `public/mockups/privacy-page-redesign-2026-08/` are currently deleted in the working tree.
- **Impact:** Loss of documented visual design history and broken references in [`mockups/README.md`](file:///d:/Repos/PsychSift/mockups/README.md) and [`scripts/capture-mockup-screenshots.mjs`](file:///d:/Repos/PsychSift/scripts/capture-mockup-screenshots.mjs).
- **Remediation:** Restore the files from HEAD:
  ```powershell
  git checkout HEAD -- public/mockups/
  ```

---

### LOC-02: Calculator TypeScript `TS2339` Compiler Blocker

- **File Location:** [`src/components/calculators/calculator-ui.tsx#L559`](file:///d:/Repos/PsychSift/src/components/calculators/calculator-ui.tsx#L559)
- **Root Cause & Context:**  
  An uncommitted accessibility update replaced `disabled={!state.complete}` with `aria-disabled` and added an announcement string:
  ```typescript
  const unavailableReason = `Answer all items to copy result summary (${state.answeredCount}/${state.totalItems} complete)`;
  ```
  `DerivedCalculator` (`state`) exposes `answeredCount` and `complete`, but not `totalItems`.
- **Impact:** Breaks `npm run typecheck` (`error TS2339: Property 'totalItems' does not exist on type 'DerivedCalculator'`).
- **Reproduction:** `npm run typecheck`
- **Remediation:**  
  `calc.items.length` exists in scope. In line 559, replace:
  ```typescript
  const unavailableReason = `Answer all items to copy result summary (${state.answeredCount}/${calc.items.length} complete)`;
  ```

---

### LOC-03: ESLint Unused Import Warnings under Zero-Tolerance Rule

- **File Locations:**
  - [`src/components/cme/cme-plan-page.tsx#L5-L12`](file:///d:/Repos/PsychSift/src/components/cme/cme-plan-page.tsx#L5-L12): Unused `useId` (L5) and `ignoreUnavailableActivation` (L12).
  - [`src/components/patient-safety-plan.tsx#L40`](file:///d:/Repos/PsychSift/src/components/patient-safety-plan.tsx#L40): Unused `ignoreUnavailableActivation` (L40).
- **Impact:** The project enforces `--max-warnings 0`. These 3 warnings cause `npm run lint` to exit with failure code 1.
- **Reproduction:** `npm run lint`
- **Remediation:** Delete the 3 unused identifiers from the import statements in both files.

---

### LOC-04 & LOC-05: Document Search Web-Vitals Contract & Design System Violations

- **File Location:** [`src/app/(search-app)/documents/search/page.tsx#L32-L48`](<file:///d:/Repos/PsychSift/src/app/(search-app)/documents/search/page.tsx#L32-L48>)
- **Root Cause & Context:**
  1. Line 32 introduced a server-side redirect: `redirect(documentsSearchHref({ query, run: true }))`. Contract M29 in [`tests/ci-audit-contracts.test.ts#L228`](file:///d:/Repos/PsychSift/tests/ci-audit-contracts.test.ts#L228) strictly forbids server redirects on default routes measured by automated Lighthouse in `.github/workflows/live-web-vitals.yml`.
  2. Line 48 introduced `<Link ... className="inline-flex min-h-11 ... text-white">`. Raw classes `min-h-11` and `text-white` violate [`tests/design-system-contract.test.ts`](file:///d:/Repos/PsychSift/tests/design-system-contract.test.ts).
- **Impact:** Fails `npx vitest run tests/ci-audit-contracts.test.ts` and `npm run check:design-system-contract`.
- **Remediation:** Remove the server-side `redirect(...)`, use client-side navigation if redirection is desired, and replace `min-h-11` with `min-h-tap` and `text-white` with `text-[color:var(--text-on-accent)]`.

---

### LOC-06: Browser History Stack Thrashing in Sheet Primitive

- **File Location:** [`src/components/ui/sheet.tsx#L208-L235`](file:///d:/Repos/PsychSift/src/components/ui/sheet.tsx#L208-L235)
- **Root Cause & Context:**  
  The uncommitted `dismissOnBack` effect adds a history entry via `window.history.pushState` on open and pops it on close. However, `onClose` is listed in the `useEffect` dependency array (`[open, dismissOnBack, sheetId, onClose]`). Because parent components pass inline arrow callbacks (`onClose={() => setOpen(false)}`), any re-render in the parent component changes `onClose` identity, unmounting and remounting the effect, thrashing the browser's back button history stack.
- **Impact:** Users pressing Back on mobile get trapped in redundant history states.
- **Remediation:** Decouple `onClose` using a React ref:
  ```typescript
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // Inside effect: call onCloseRef.current() and remove onClose from dependency array
  ```

---

### LOC-07: In-Memory Storage in Teaching Dual Sign-Off Assessment

- **File Locations:**
  - [`src/lib/teaching/assessments/dual-sign-off.ts#L176`](file:///d:/Repos/PsychSift/src/lib/teaching/assessments/dual-sign-off.ts#L176)
  - [`src/app/api/teaching/assessments/dual-sign-off/route.ts#L71`](file:///d:/Repos/PsychSift/src/app/api/teaching/assessments/dual-sign-off/route.ts#L71)
- **Root Cause & Context:**  
  The trainee-supervisor assessment sign-off domain logic and cryptographic attestation signatures pass unit tests (5/5). However, all assessment state is stored in an in-memory `Map` inside singleton `defaultAssessmentRepository`.
- **Impact:** In production (Vercel serverless / multi-instance containers), assessments disappear whenever cold starts occur or requests route to different workers.
- **Remediation:** Either gate the route behind `ENABLE_EXPERIMENTAL_TEACHING_ASSESSMENTS === "true"` or author a Supabase SQL migration creating an `assessments` table with RLS before staging deployment.

---

### LOC-08: Dependency Lockfile Version Drift

- **File Location:** [`scripts/check-installed-lock-parity.mjs`](file:///d:/Repos/PsychSift/scripts/check-installed-lock-parity.mjs)
- **Context:** Local `node_modules` contains `next@16.3.6`, while `package.json` and `package-lock.json` lock `next@16.3.8`.
- **Remediation:** Run `npm ci` in `d:\Repos\PsychSift`.

---

### LOC-09: Untracked Testing Subsystem Files

- **Files:**
  - [`.github/workflows/preview-smoke.yml`](file:///d:/Repos/PsychSift/.github/workflows/preview-smoke.yml)
  - [`scripts/run-preview-smoke.mjs`](file:///d:/Repos/PsychSift/scripts/run-preview-smoke.mjs)
  - [`tests/ui-user-journeys.spec.ts`](file:///d:/Repos/PsychSift/tests/ui-user-journeys.spec.ts)
  - [`docs/live-browser-testing.md`](file:///d:/Repos/PsychSift/docs/live-browser-testing.md)
- **Impact:** Untracked files trigger failures in `npm run check:repo-awareness-snapshot`.
- **Remediation:** Stage and format these files or register them into the snapshot.

---

## 5. Part III: Refuted Hypotheses & Corrected False Positives

- **REF-01: RAG Extractive Answer Budget Ceiling Misdiagnosis:**
  - _Prior Claim:_ `src/lib/rag/rag-extractive-answer.ts` is at 100% capacity (5,269 / 5,269 lines).
  - _Verification:_ **Refuted.** Line count on both `origin/main` and local HEAD is **5,020 lines**. The budget ceiling in `scripts/check-maintainability-budgets.mjs` is **5,269 lines**. It is at **95.3% capacity with 249 lines of headroom**.
- **REF-02: Branch Rebase Conflict Claim:**
  - _Prior Claim:_ Branch `feat/adversarial-audit-hardening` has merge loss requiring a manual rebase.
  - _Verification:_ **Refuted.** `git rev-list --count origin/main..HEAD` is 0; HEAD is strictly an ancestor of `origin/main`. `git merge-tree` completed cleanly with **zero conflicts**.
- **REF-03: CI Proof Script Single Failure Claim:**
  - _Prior Claim:_ `tests/ci-main-tree-proof.test.ts` failed only because of line 506.
  - _Verification:_ **Refuted.** Testing on Windows revealed **3 failures**, uncovering the NTFS junction execution bug in `scripts/ci-main-tree-proof.mjs#L692`.

---

## 6. Part IV: Clinical Safety & Security Invariant Audit

All core clinical and data integrity invariants were verified and found **100% compliant**:

1. **Clinical Hazard Register:** All 7 clinical hazards and 5 clinical decision points in [`data/hazard-register-snapshot.json`](file:///d:/Repos/PsychSift/data/hazard-register-snapshot.json) and [`docs/clinical-hazard-controls.json`](file:///d:/Repos/PsychSift/docs/clinical-hazard-controls.json) are verified with regression tests passing.
2. **Database Migrations:** All 288 Supabase database migrations are immutable and sequentially verified.
3. **Database Security Privileges:** All 82 `SECURITY DEFINER` functions in the database schema have public and anonymous execution rights explicitly revoked.
4. **API Ownership & Tenancy:** All 112 API routes enforce strict user identity and owner scoping via authenticated sessions.
5. **Privacy & Telemetry:** Offline evaluations confirm no raw PHI leaks into analytics, RAG prompt telemetry, or client bundle payloads.

---

## 7. Recommended Action Plan & Sequence

### Immediate Action (Local Working Copy Fixes)

1. Restore deleted mockups: `git checkout HEAD -- public/mockups/`
2. In [`calculator-ui.tsx#L559`](file:///d:/Repos/PsychSift/src/components/calculators/calculator-ui.tsx#L559), replace `${state.totalItems}` with `${calc.items.length}`.
3. In [`cme-plan-page.tsx`](file:///d:/Repos/PsychSift/src/components/cme/cme-plan-page.tsx) and [`patient-safety-plan.tsx`](file:///d:/Repos/PsychSift/src/components/patient-safety-plan.tsx), remove unused `useId` and `ignoreUnavailableActivation`.
4. In [`src/app/(search-app)/documents/search/page.tsx`](<file:///d:/Repos/PsychSift/src/app/(search-app)/documents/search/page.tsx>), remove the server `redirect(...)` and replace utility classes with design tokens.
5. In [`sheet.tsx`](file:///d:/Repos/PsychSift/src/components/ui/sheet.tsx), decouple `onClose` using `useRef`.
6. Run `npm ci` to align `node_modules` with `package-lock.json`.

### Upstream Canonical Fixes (For PR into `origin/main`)

1. Cancel the 5 conflicting inbox mutations in `docs/outstanding-issues-inbox/` using `node scripts/ledger-inbox.mjs cancel`.
2. Apply the NTFS junction realpath fix in [`scripts/ci-main-tree-proof.mjs#L692`](file:///d:/Repos/PsychSift/scripts/ci-main-tree-proof.mjs#L692).
3. Apply `fileURLToPath` in [`tests/ci-main-tree-proof.test.ts#L506`](file:///d:/Repos/PsychSift/tests/ci-main-tree-proof.test.ts#L506).
