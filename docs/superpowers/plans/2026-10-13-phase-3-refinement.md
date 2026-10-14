# Phase 3 Implementation Plan: Worker Resource Hygiene, PHI Log Scrubbing & Bundle Diet

## Overview

Phase 3 addresses operational and privacy resilience across the PsychSift repository, completing the 3-phase remediation plan formulated from the full repository audit.

### Key Objectives

1. **`PY-01` (PyMuPDF Resource Hygiene):** Guarantee deterministic cleanup of native C++ PyMuPDF document handles in `worker/python/extract_pdf_assets.py` via `try...finally: document.close()`.
2. **`LOG-01` / `SEC-03` (Incidental PHI Sanitization in Storage Logs):** Proactively scrub Australian Medicare numbers, telephone numbers, hospital MRNs, and DOBs in `src/lib/query-privacy.ts`.
3. **`RSC-01` (Bundle Budget & Dynamic Import Verification):** Verify client bundle budgets and dynamic import boundaries via `scripts/check-bundle-budget.mjs`.
4. **Full Verification Suite:** Ensure all Phase 1, Phase 2, and Phase 3 changes pass TypeScript typecheck, format checks, and automated test suites.

---

## Detailed Tasks

### Task 1: `PY-01` PyMuPDF Resource Hygiene (`worker/python/extract_pdf_assets.py`)

- **Problem:** `extract(pdf_path, output_dir, budget)` opens PyMuPDF via `open_pdf_for_extraction`, but never calls `document.close()`. In long-running workers or batch processing, native memory remains uncollected until process termination.
- **Solution:** Wrap the body of `extract()` in `try...finally: document.close()`.

### Task 2: `LOG-01` / `SEC-03` Incidental PHI Scrubbing (`src/lib/query-privacy.ts`)

- **Problem:** If raw query persistence is enabled (`env.RAG_PERSIST_RAW_QUERY_TEXT = true`), raw text containing accidental patient identifiers (Medicare, phone, MRN, DOB) would be written directly to `rag_queries`.
- **Solution:** Implement `scrubPotentialPhi` and pipe query text through it in `queryTextForStorage` and `normalizedQueryTextForStorage`.
- **Verification:** Add tests in `tests/privacy.test.ts`.

### Task 3: Bundle Diet & Verification

- **Verification:** Run `node scripts/check-bundle-budget.mjs` and confirm compliance.

### Task 4: Complete System Verification

- Run `npm run typecheck`.
- Run all unit and integration tests covering Phases 1, 2, and 3.
