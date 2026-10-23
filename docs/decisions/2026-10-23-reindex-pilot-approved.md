# Decision: A three-document re-index pilot may run; the full library re-index stays stopped

- **Status:** decided 2026-10-23
- **Source:** `docs/outstanding-issues-inbox/991126e8-cc3b-4e59-bffc-7dc5e6376305.json`, find "a three-document re-index pilot is approved"

On 23 October 2026 the owner said "go ahead" in the project's re-index readiness thread to a small
paid re-index pilot. This is a narrow exception to
[the stop on the library re-index](2026-10-17-library-reindex-stopped.md). The full library re-index
stays stopped until the owner decides again after seeing the pilot result.

The owner approved it after being told three things. The shadow re-index harness is not built.
Point-in-time recovery is off. The one-step index rollback (PRs #3718 and #3750) has not been tried
on the live database. So the pilot relies on that rollback and the daily backup.

**What the pilot is**

- **Documents:** `CG.MHSP.ClozapinePresAdminMonitor.pdf`, `CG.MHSP.Lithium.pdf` and
  `MHSP.AgitationArousalPharmaMgt.pdf`. They are table-heavy, and the eval canary already checks
  them through its clozapine, lithium and agitation cases.
- **What runs:** one full re-index of each document on the current code (chunker 1.3.1 and the
  OCR fixes from PRs #3710, #3715 and #3716).
- **Scope control:**
  - The production worker is limited to those three documents with `WORKER_ALLOWED_DOCUMENT_IDS`.
  - The app service's `WORKER_MAX_ATTEMPTS` is set to `1` before the jobs are queued. The re-index
    route stamps that value on every job, so no job retries by itself.
  - Both settings go back, and the worker is paused again, once the pilot ends.

**How it is judged**

- **Baseline:** Eval Canary run 39759615452 (22 Oct 2026, main `0a01d2567`). No retrieval or
  ingestion change has landed since then.
- **After:** one Eval Canary run with default settings once the three documents finish.
- **Go:** document recall and content recall stay at 1.0 and no case's rank gets worse.
- **No-go:** run `npm run reindex:rollback` for the three documents, then a confirmation canary.

**Spending approval**

- The owner approved about US$4, with a hard cap of US$5 for the whole pilot.
- **Pricing basis:** the eval canary's figures of US$2.50 per million input tokens and US$15 per
  million output tokens for the indexing and vision model, and US$0.02 per million tokens for
  `text-embedding-3-small`.
- **Re-index:**
  - Each document gets at most about three indexing-model calls (summary, sections and model index,
    each capped at 2,400 to 3,200 output tokens plus reasoning).
  - Each document gets at most 15 image captions (`WORKER_MAX_CAPTIONED_IMAGES_PER_DOCUMENT`).
  - The ceiling is about US$1.00 per document, so US$3.00 for three documents.
  - Captions that are already cached are not paid for again.
- **Retries:** none happen automatically (`WORKER_MAX_ATTEMPTS=1`). The owner may re-queue one failed
  document once by hand, up to US$1.00. Any further failure ends the pilot.
- **After canary:** the answer subset of run 39759615452 cost US$0.13. Allow up to US$0.50.
- **Total ceiling:** US$4.50.

If this summary and the source ever differ, the source wins.
