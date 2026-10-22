import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { isAdministratorAppMetadata } from "@/lib/authorization";

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

describe("public content and account authorization model", () => {
  it("trusts only the immutable administrator app-metadata claim", () => {
    expect(isAdministratorAppMetadata({ site_role: "administrator" })).toBe(true);
    expect(isAdministratorAppMetadata({ site_role: "user" })).toBe(false);
    expect(isAdministratorAppMetadata({ role: "administrator" })).toBe(false);
    expect(isAdministratorAppMetadata(null)).toBe(false);
  });

  it("requires administrator authorization before any upload work", () => {
    const uploadRoute = source("src/app/api/upload/route.ts");
    const authCheck = uploadRoute.indexOf("requireAuthenticatedUser(request, adminSupabase, { administrator: true })");
    const formRead = uploadRoute.indexOf("request.formData()");
    // Storage bytes are written through the trusted-admission helper, whose only Storage
    // write is the `.upload(` call pinned below; the route-side call site is what must follow
    // the administrator check.
    const storageWrite = uploadRoute.indexOf("await uploadTrustedDocumentBytes(");
    const admissionSource = source("src/lib/trusted-document-admission.ts");

    expect(authCheck).toBeGreaterThan(-1);
    expect(formRead).toBeGreaterThan(-1);
    expect(storageWrite).toBeGreaterThan(-1);
    expect(admissionSource).toContain("await args.storage.upload(intendedStoragePath, args.bytes");
    expect(authCheck).toBeLessThan(formRead);
    expect(authCheck).toBeLessThan(storageWrite);
    expect(uploadRoute).not.toContain("publicUploadsEnabled");
    expect(uploadRoute).not.toContain("PUBLIC_WORKSPACE_OWNER_ID");
  });

  it("does not expose a browser document-upload workflow", () => {
    const browserSurfaces = [
      source("src/components/ClinicalDashboard.tsx"),
      source("src/components/clinical-dashboard/DocumentManagerPanel.tsx"),
      // The indexing drawer is browser-facing too, so an upload control added there later must
      // fail this check rather than slip through because the file was not in the corpus.
      source("src/components/clinical-dashboard/document-admin.tsx"),
      source("src/components/clinical-dashboard/clinical-dashboard-lazy.tsx"),
      source("src/components/clinical-dashboard/global-search-shell.tsx"),
      source("src/components/clinical-dashboard/master-search-header.tsx"),
      source("src/components/clinical-dashboard/mode-action-popup.tsx"),
    ].join("\n");

    expect(browserSurfaces).not.toContain("documents-upload");
    expect(browserSurfaces).not.toContain("UploadPanel");
    expect(browserSurfaces).not.toContain('type="file"');
    expect(browserSurfaces).not.toContain('"/api/upload"');
    expect(browserSurfaces).not.toContain("Upload PDF");
    expect(browserSurfaces).not.toContain("Add document");
    expect(browserSurfaces).not.toContain("Upload only material");
  });

  it("keeps administrator assignment behind an explicit provider-mutation gate", () => {
    const script = source("scripts/set-site-administrator.ts");
    expect(script).toContain('process.env.ALLOW_SUPABASE_ADMIN_MUTATION !== "true"');
    expect(script).toContain('app_metadata: { ...matchedUser.app_metadata, site_role: "administrator" }');
  });

  it("stores favourites and preferences as owner-scoped RLS data", () => {
    const migration = source("supabase/migrations/20260719064735_user_account_data_and_admin_uploads.sql");
    expect(migration).toContain("create table if not exists public.user_favourites");
    expect(migration).toContain("create table if not exists public.user_preferences");
    expect(migration).toContain("references auth.users(id) on delete cascade");
    expect(migration).toContain("alter table public.user_favourites enable row level security");
    expect(migration).toContain("alter table public.user_preferences enable row level security");
    expect(migration).toContain("revoke all on table public.user_favourites from public, anon, authenticated");
    expect(migration).not.toMatch(/grant [^;]* on table public\.user_(?:favourites|preferences) to authenticated/);
    expect(migration.match(/\(select auth\.uid\(\)\) = user_id/g)?.length).toBeGreaterThanOrEqual(7);
    expect(migration).toContain("revoke insert, update, delete on table storage.objects from anon, authenticated");
  });

  it("keeps document management actions administrator-gated in the client", () => {
    const documentManagementActions = source("src/components/DocumentManagementActions.tsx");
    expect(documentManagementActions).toContain("isAdministratorUser(session?.user)");
    expect(documentManagementActions).toContain('authStatus === "authenticated"');
    expect(documentManagementActions).toContain("assertCanManage()");
  });

  it("keeps public document reads separate from administrator mutations", () => {
    const documentRoute = source("src/app/api/documents/[id]/route.ts");
    const tableFactsRoute = source("src/app/api/documents/[id]/table-facts/route.ts");
    const documentViewer = source("src/components/DocumentViewer.tsx");
    const documentRail = source("src/components/document-viewer/document-rail-panels.tsx");
    // Table review moved with the visuals panel into the main reading column; the
    // administrator gate on it must move too, not quietly disappear.
    const documentVisuals = source("src/components/document-viewer/document-visuals-panel.tsx");
    expect(documentRoute).toContain("loadAuthorizedDocumentDetail({ request, rawId, query: detailQuery })");
    expect(documentRoute.match(/administrator: true/g)?.length).toBe(2);
    expect(tableFactsRoute).toContain("enforceDocumentReadRateLimit(request, supabase)");
    expect(tableFactsRoute).toContain("withOwnerReadScope(");
    expect(tableFactsRoute.match(/administrator: true/g)?.length).toBe(1);
    expect(documentViewer).toContain("isAdministratorUser(session?.user)");
    expect(documentViewer).toContain("canUseAdministrativeApis={canUseAdministrativeApis}");
    expect(documentRail).toContain("{canUseAdministrativeApis ? (");
    expect(documentRail).toContain("canManage={canUseAdministrativeApis}");
    expect(documentVisuals).toContain("{canUseAdministrativeApis && tableFacts.length ? (");
    expect(documentVisuals).toContain("canReview={canUseAdministrativeApis}");
  });

  it("does not turn an ordinary signed-in setup-status request into a server error", () => {
    const setupStatusRoute = source("src/app/api/setup-status/route.ts");
    expect(setupStatusRoute).toContain("error instanceof PublicApiError && error.status === 403");
    expect(setupStatusRoute).toContain("non-administrator credentials receive the same");
  });

  it("does not load or display administrative dashboard surfaces for ordinary accounts", () => {
    const dashboard = source("src/components/ClinicalDashboard.tsx");
    const compact = dashboard.replace(/\s+/g, " ");
    expect(dashboard).toContain("if (!canUseAdministrativeApis)");
    expect(compact).toContain(
      'canUseAdministrativeApis && (settingsState.indexingAdminDrawerOpen || (settingsState.documentsDrawerOpen && settingsState.documentsDrawerMode === "admin"))',
    );
    expect(compact).toContain(
      'const documentsDrawerIsAdmin = settingsState.documentsDrawerMode === "admin" && canUseAdministrativeApis;',
    );
  });
});
