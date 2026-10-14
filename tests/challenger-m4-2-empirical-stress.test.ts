import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { selectCardEntries } from "@/lib/on-call/card-selection";
import type { OnCallEntry } from "@/lib/on-call/entry-model";
import { ON_CALL_CACHE_MAX_AGE_MS } from "@/lib/on-call/entry-store";
import { mayContainOnCallCompliance } from "@/lib/on-call/compliance";
import { CME_EVIDENCE_BUCKET } from "@/lib/cme/evidence-model";

const PROJECT_ROOT = path.resolve(__dirname, "..");

describe("Challenger M4-2: Empirical Stress Test & Technical Verification", () => {
  describe("1. CME Private Evidence Migrations & Storage Architecture", () => {
    const migration1Path = path.join(PROJECT_ROOT, "supabase", "migrations", "20260922175023_cme_private_evidence.sql");
    const migration2Path = path.join(PROJECT_ROOT, "supabase", "migrations", "20260924130000_cme_evidence_removal.sql");
    const routePath = path.join(
      PROJECT_ROOT,
      "src",
      "app",
      "api",
      "cme",
      "entries",
      "[id]",
      "evidence",
      "[evidenceId]",
      "route.ts",
    );

    it("verifies migration 20260922175023_cme_private_evidence.sql table schema & security rules", () => {
      const sql = fs.readFileSync(migration1Path, "utf-8");

      // Verify table creation and columns
      expect(sql).toContain("create table public.cme_evidence (");
      expect(sql).toContain("id uuid primary key");
      expect(sql).toContain("owner_id uuid not null references auth.users(id) on delete cascade");
      expect(sql).toContain("entry_id uuid not null");
      expect(sql).toContain("file_name text not null check (length(file_name) between 1 and 180)");
      expect(sql).toContain(
        "content_type text not null check (content_type in ('application/pdf','image/jpeg','image/png'))",
      );
      expect(sql).toContain("byte_size integer not null check (byte_size between 1 and 10485760)");
      expect(sql).toContain("sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$')");
      expect(sql).toContain("storage_path text not null unique");
      expect(sql).toContain("kind text not null check (kind in ('certificate','receipt','assessment','other'))");
      expect(sql).toContain("redaction_confirmed boolean not null check (redaction_confirmed)");
      expect(sql).toContain("preview_confirmed boolean not null check (preview_confirmed)");
      expect(sql).toContain(
        "foreign key (entry_id, owner_id) references public.cme_entries(id, owner_id) on delete restrict",
      );
      expect(sql).toContain("check (storage_path = owner_id::text || '/' || entry_id::text || '/' || id::text)");

      // Verify RLS and role permissions
      expect(sql).toContain("alter table public.cme_evidence enable row level security;");
      expect(sql).toContain("revoke all on public.cme_evidence from public, anon, authenticated;");
      expect(sql).toContain("grant select, insert on public.cme_evidence to service_role;");

      // Verify private bucket configuration
      expect(sql).toContain("insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)");
      expect(sql).toContain(
        "values ('cme-private-evidence','cme-private-evidence',false,10485760,array['application/pdf','image/jpeg','image/png'])",
      );

      // Verify restrictive storage policy blocking anon and authenticated
      expect(sql).toContain("create policy cme_evidence_no_direct_access on storage.objects as restrictive");
      expect(sql).toContain("for all to anon, authenticated");
      expect(sql).toContain(
        "using (bucket_id <> 'cme-private-evidence') with check (bucket_id <> 'cme-private-evidence')",
      );
    });

    it("verifies migration 20260924130000_cme_evidence_removal.sql tombstone & removal function", () => {
      const sql = fs.readFileSync(migration2Path, "utf-8");

      expect(sql).toContain("alter table public.cme_evidence");
      expect(sql).toContain("add column removed_at timestamptz,");
      expect(sql).toContain("add column removal_reason text,");
      expect(sql).toContain("add constraint cme_evidence_removal_recorded check (");
      expect(sql).toContain("(removed_at is null and removal_reason is null)");
      expect(sql).toContain("or (removed_at is not null and length(btrim(removal_reason)) between 3 and 500)");

      // Partial unique index for active files
      expect(sql).toContain("create unique index cme_evidence_active_entry_sha256_key");
      expect(sql).toContain("on public.cme_evidence(entry_id, sha256) where removed_at is null;");

      // Service role updates only on removal columns
      expect(sql).toContain(
        "grant update (removed_at, removal_reason, file_name) on public.cme_evidence to service_role;",
      );

      // Function cme_remove_evidence checks reason length and sets file_name = 'Removed file'
      expect(sql).toContain(
        "create function public.cme_remove_evidence(p_owner_id uuid, p_evidence_id uuid, p_reason text)",
      );
      expect(sql).toContain("if p_reason is null or length(btrim(p_reason)) not between 3 and 500 then");
      expect(sql).toContain("set removed_at = now(), removal_reason = btrim(p_reason), file_name = 'Removed file'");
      expect(sql).toContain(
        "revoke execute on function public.cme_remove_evidence(uuid,uuid,text) from public, anon, authenticated;",
      );
      expect(sql).toContain("grant execute on function public.cme_remove_evidence(uuid,uuid,text) to service_role;");
    });

    it("verifies signed URL expiry of 60 seconds and CME bucket constant", () => {
      expect(CME_EVIDENCE_BUCKET).toBe("cme-private-evidence");

      const routeCode = fs.readFileSync(routePath, "utf-8");
      expect(routeCode).toMatch(/\.createSignedUrl\(data\.storage_path,\s*60\b/);
      expect(routeCode).toContain('Cache-Control": "private, no-store');
    });
  });

  describe("2. On Call Storage, 7-day TTL, and Zero-localStorage Compliance Guarantee", () => {
    it("verifies ON_CALL_CACHE_MAX_AGE_MS is exactly 7 days", () => {
      expect(ON_CALL_CACHE_MAX_AGE_MS).toBe(7 * 24 * 60 * 60 * 1000);
      expect(ON_CALL_CACHE_MAX_AGE_MS).toBe(604800000);
    });

    it("verifies PERSIST_FETCHED_ON_CALL_ENTRIES is set to false in entry-store.ts", () => {
      const entryStoreCode = fs.readFileSync(
        path.join(PROJECT_ROOT, "src", "lib", "on-call", "entry-store.ts"),
        "utf-8",
      );
      expect(entryStoreCode).toContain("const PERSIST_FETCHED_ON_CALL_ENTRIES: boolean = false;");
      expect(entryStoreCode).toContain("let sessionCache: string | null = null;");
    });

    it("verifies mayContainOnCallCompliance correctly identifies logistics compliance records", () => {
      // Non-logistics section is not compliance
      expect(mayContainOnCallCompliance("contacts", { phone: "123" })).toBe(false);

      // Logistics with canonical compliance categories from ON_CALL_COMPLIANCE_CATEGORIES
      expect(mayContainOnCallCompliance("logistics", { category: "Registration" })).toBe(true);
      expect(mayContainOnCallCompliance("logistics", { category: "Clearances" })).toBe(true);
      expect(mayContainOnCallCompliance("logistics", { category: "Indemnity" })).toBe(true);
      expect(mayContainOnCallCompliance("logistics", { category: "Training" })).toBe(true);
      expect(mayContainOnCallCompliance("logistics", { category: "Credentialing" })).toBe(true);
      expect(mayContainOnCallCompliance("logistics", { category: "CPD" })).toBe(true);

      // Logistics with compliance marker keys
      expect(mayContainOnCallCompliance("logistics", { category: "Leave", kind: "compliance" })).toBe(true);
      expect(mayContainOnCallCompliance("logistics", { category: "Leave", expiresOn: "2027-01-01" })).toBe(true);
      expect(mayContainOnCallCompliance("logistics", { category: "Leave", proofNote: "Checked by supervisor" })).toBe(
        true,
      );
    });
  });

  describe("3. Service Worker Offline Isolation & Pocket Card Print Filters", () => {
    const swPath = path.join(PROJECT_ROOT, "public", "sw.js");

    it("verifies Service Worker public/sw.js privacy-first policies and emergency fallback", () => {
      const swCode = fs.readFileSync(swPath, "utf-8");

      expect(swCode).toContain('const CACHE_PREFIX = "clinical-kb-pwa-";');
      expect(swCode).toContain("function hasSensitiveRequestSignals(request, url) {");
      expect(swCode).toContain('request.method !== "GET"');
      expect(swCode).toContain('url.search !== ""');
      expect(swCode).toContain('request.headers.has("authorization")');
      expect(swCode).toContain('request.headers.has("range")');

      // Caching strictly limited to immutable Next assets and public icons/manifest
      expect(swCode).toContain('url.pathname.startsWith("/_next/static/")');
      expect(swCode).toContain('url.pathname === "/manifest.webmanifest"');

      // Emergency offline response contains no clinical content
      expect(swCode).toContain("function emergencyOfflineResponse() {");
      expect(swCode).toContain("No clinical content is stored in the offline fallback.");

      // Push notification handler handles only enum type codes
      expect(swCode).toContain("const ROSTER_PUSH = {");
      expect(swCode).toContain("event.data?.json()?.t");
    });

    it("empirically verifies selectCardEntries rejects personal entries, compliance entries, stale entries, and role explainers", () => {
      const now = new Date("2026-10-10T12:00:00Z");
      const baseEntry: OnCallEntry = {
        id: "11111111-1111-4111-8111-111111111111",
        slug: "general-switchboard",
        section: "contacts",
        title: "Hospital Switchboard",
        subtitle: "Main desk",
        body: null,
        details: { phone: "08 9000 0000" },
        isPersonal: false,
        includeOnCard: true,
        lastVerifiedAt: "2026-10-01T00:00:00Z", // Fresh (10 days old)
        linkedDocumentIds: [],
        tags: [],
        sortOrder: 0,
      };

      // 1. Valid entry passes filter
      expect(selectCardEntries([baseEntry], now)).toHaveLength(1);

      // 2. includeOnCard = false -> rejected
      expect(selectCardEntries([{ ...baseEntry, includeOnCard: false }], now)).toHaveLength(0);

      // 3. isPersonal = true -> rejected
      expect(selectCardEntries([{ ...baseEntry, isPersonal: true }], now)).toHaveLength(0);

      // 4. Compliance entry in logistics (identified by kind: "compliance") -> rejected
      const complianceEntry: OnCallEntry = {
        ...baseEntry,
        section: "logistics",
        title: "Medical Registration",
        details: { category: "Registration", kind: "compliance", expiresOn: "2027-01-01" },
      };
      expect(selectCardEntries([complianceEntry], now)).toHaveLength(0);

      // 5. Role explainer entry (identified by kind: "role-explainer") -> rejected
      const roleExplainer: OnCallEntry = {
        ...baseEntry,
        title: "Psychiatry Registrar",
        details: { kind: "role-explainer", phone: "0400 000 000" },
      };
      expect(selectCardEntries([roleExplainer], now)).toHaveLength(0);

      // 6. Stale entry (> 1 year unverified) -> rejected
      const staleEntry: OnCallEntry = {
        ...baseEntry,
        lastVerifiedAt: "2025-09-01T00:00:00Z", // >13 months old relative to 2026-10-10
      };
      expect(selectCardEntries([staleEntry], now)).toHaveLength(0);
    });

    it("verifies printed pocket card provenance statement and bedside sheet ephemeral state", () => {
      const cardPath = path.join(PROJECT_ROOT, "src", "components", "on-call", "on-call-card.tsx");
      const cardCode = fs.readFileSync(cardPath, "utf-8");
      expect(cardCode).toContain(
        "PsychSift On Call pocket card. Confirm against the live app before relying on a printed copy, because paper cannot show its own age.",
      );

      const bedsideSheetPath = path.join(PROJECT_ROOT, "src", "components", "calculators", "bedside-sheet.tsx");
      const bedsideCode = fs.readFileSync(bedsideSheetPath, "utf-8");
      expect(bedsideCode).toContain("useState<SessionAnswers>({})");
      expect(bedsideCode).not.toContain("localStorage.setItem");
      expect(bedsideCode).not.toContain("sessionStorage.setItem");
    });
  });

  describe("4. Firefox (Gecko) Click State Failures Technical Cross-References", () => {
    it("verifies src/components/ui/sheet.tsx:384-412 focus restoration rAF + 50ms setTimeout", () => {
      const sheetPath = path.join(PROJECT_ROOT, "src", "components", "ui", "sheet.tsx");
      const sheetCode = fs.readFileSync(sheetPath, "utf-8");

      expect(sheetCode).toContain("restoreTimers.frame = window.requestAnimationFrame(() => {");
      expect(sheetCode).toContain("restoreTarget.focus({ preventScroll: true });");
      expect(sheetCode).toContain("restoreTimers.timeout = window.setTimeout(() => {");
      expect(sheetCode).toMatch(/window\.setTimeout\([\s\S]*?,\s*50\);/);
      expect(sheetCode).toContain("document.activeElement !== document.body && document.activeElement != null");
    });

    it("verifies src/components/document-viewer/source-panels.tsx:1090-1100 moveHit microtask lock and modulo wrapping", () => {
      const sourcePanelsPath = path.join(PROJECT_ROOT, "src", "components", "document-viewer", "source-panels.tsx");
      const panelsCode = fs.readFileSync(sourcePanelsPath, "utf-8");

      expect(panelsCode).toContain("function moveHit(delta: number) {");
      expect(panelsCode).toContain("if (visibleChunks.length === 0 || hitMoveLockRef.current) return;");
      expect(panelsCode).toContain("hitMoveLockRef.current = true;");
      expect(panelsCode).toContain("queueMicrotask(() => {");
      expect(panelsCode).toContain("hitMoveLockRef.current = false;");
      expect(panelsCode).toContain(
        "setActiveHitIndex((current) => (current + delta + visibleChunks.length) % visibleChunks.length);",
      );
    });

    it("empirically simulates the Gecko double-activation race condition over a 2-hit list", async () => {
      // Simulate component state and lock
      let activeHitIndex = 0;
      let hitMoveLock = false;
      const visibleHits = 2; // 2 hits

      function moveHit(delta: number) {
        if (hitMoveLock) return;
        hitMoveLock = true;
        queueMicrotask(() => {
          hitMoveLock = false;
        });
        activeHitIndex = (activeHitIndex + delta + visibleHits) % visibleHits;
      }

      // First click: advance from 0 to 1
      moveHit(1);
      expect(activeHitIndex).toBe(1);
      expect(hitMoveLock).toBe(true);

      // Microtask tick executes (e.g. end of current callstack)
      await new Promise<void>((resolve) => {
        queueMicrotask(() => resolve());
      });
      expect(hitMoveLock).toBe(false);

      // Secondary activation (Gecko exclusive accordion side-effect on next turn)
      moveHit(1);
      // Because microtask expired, lock is open! Index wraps back to 0: (1 + 1 + 2) % 2 = 0!
      expect(activeHitIndex).toBe(0);
      // PROOF: In a 2-hit list, two activations across microtask ticks leave the counter at Hit 1 of 2 (0 index)!
    });

    it("verifies exact test line numbers and comments in tests/ui-tools.spec.ts and tests/ui-smoke.spec.ts", () => {
      const toolsSpecPath = path.join(PROJECT_ROOT, "tests", "ui-tools.spec.ts");
      const toolsCode = fs.readFileSync(toolsSpecPath, "utf-8");

      expect(toolsCode).toContain('test("tool links point to the expected in-app modes", async ({ page }) => {');
      expect(toolsCode).toContain('["services", "Services", "/?mode=services"],');
      expect(toolsCode).toContain('["forms", "Forms", "/?mode=forms"],');
      expect(toolsCode).toContain('await clickWhenSettled(results.getByRole("button", { name: `About ${title}` }));');
      expect(toolsCode).toContain(
        "const detail = page.locator('[data-testid=\"tools-search-detail-sheet\"]:visible');",
      );

      const smokeSpecPath = path.join(PROJECT_ROOT, "tests", "ui-smoke.spec.ts");
      const smokeCode = fs.readFileSync(smokeSpecPath, "utf-8");

      expect(smokeCode).toContain(
        'test("search regressions avoid fetch errors and open viewer hits @critical", async ({ page }) => {',
      );
      expect(smokeCode).toContain("Hit 1 of 2");
      expect(smokeCode).toContain("Hit 2 of 2");
      expect(smokeCode).toContain("Next document search hit");
      expect(smokeCode).toContain("button moved ~70px between Playwright's");
      expect(smokeCode).toContain("__nextHitClicks");
    });
  });
});
