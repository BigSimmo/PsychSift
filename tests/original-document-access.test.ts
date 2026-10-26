import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TERMS_VERSION } from "../src/lib/front-door-content";
import { TERMS_METADATA_KEY } from "../src/lib/terms-acceptance";

// D26-40 and R-05 (26 Oct 2026): the signed link to a shared document's original file needs the
// health professional declaration on the account, and, when the owner turns the switch on, an
// administrator. Synthetic ids and accounts only.
const callerId = "00000000-0000-4000-8000-0000000000a1";
const otherOwnerId = "00000000-0000-4000-8000-0000000000b2";
const documentId = "00000000-0000-4000-8000-0000000000d3";

const declared = { [TERMS_METADATA_KEY]: { version: TERMS_VERSION, acceptedAt: "2026-10-26T00:00:00.000Z" } };

type Account = { user_metadata?: Record<string, unknown>; app_metadata?: Record<string, unknown> } | Error;

afterEach(() => {
  vi.doUnmock("@/lib/env");
  vi.doUnmock("@/lib/supabase/admin");
  vi.doUnmock("@/lib/public-api-access");
  vi.resetModules();
});

async function loadHelper({ adminOnly = false, localNoAuth = false } = {}) {
  vi.resetModules();
  vi.doMock("@/lib/env", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/lib/env")>();
    return {
      ...actual,
      env: { ...actual.env, THIRD_PARTY_ORIGINALS_ADMIN_ONLY: adminOnly },
      isLocalNoAuthMode: () => localNoAuth,
    };
  });
  const clinicalAccess = await import("../src/lib/clinical-access");
  clinicalAccess.resetHealthProfessionalDeclarationCache();
  return import("../src/lib/original-document-access");
}

function accountClient(account: Account) {
  const getUserById = vi.fn(async (id: string) => {
    if (account instanceof Error) throw account;
    return { data: { user: { id, user_metadata: {}, app_metadata: {}, ...account } }, error: null };
  });
  return { getUserById, supabase: { auth: { admin: { getUserById } } } as never };
}

const signedIn = { authenticated: true, ownerId: callerId };

describe("requireOriginalDocumentAccess", () => {
  it("lets callers open their own uploads without any account lookup", async () => {
    const { requireOriginalDocumentAccess } = await loadHelper({ adminOnly: true });
    const { getUserById, supabase } = accountClient(new Error("must not be called"));
    await expect(requireOriginalDocumentAccess(signedIn, { owner_id: callerId }, supabase)).resolves.toBeUndefined();
    expect(getUserById).not.toHaveBeenCalled();
  });

  it("refuses a shared original until the account records the declaration (D26-40)", async () => {
    const { requireOriginalDocumentAccess, ORIGINAL_DECLARATION_REQUIRED_MESSAGE } = await loadHelper();
    const { supabase } = accountClient({});
    await expect(requireOriginalDocumentAccess(signedIn, { owner_id: null }, supabase)).rejects.toMatchObject({
      status: 403,
      details: { code: "terms_acceptance_required" },
      message: ORIGINAL_DECLARATION_REQUIRED_MESSAGE,
    });
  });

  it("refuses when the declaration lookup fails", async () => {
    const { requireOriginalDocumentAccess } = await loadHelper();
    const { supabase } = accountClient(new Error("auth unavailable"));
    await expect(requireOriginalDocumentAccess(signedIn, { owner_id: otherOwnerId }, supabase)).rejects.toMatchObject({
      status: 503,
    });
  });

  it("opens a shared original to a declared account while the switch is off (the default)", async () => {
    const { requireOriginalDocumentAccess } = await loadHelper();
    const { supabase } = accountClient({ user_metadata: declared });
    await expect(requireOriginalDocumentAccess(signedIn, { owner_id: null }, supabase)).resolves.toBeUndefined();
  });

  it("limits shared originals to administrators when the switch is on (R-05)", async () => {
    const helper = await loadHelper({ adminOnly: true });
    const clinician = accountClient({ user_metadata: declared });
    await expect(
      helper.requireOriginalDocumentAccess(signedIn, { owner_id: null }, clinician.supabase),
    ).rejects.toMatchObject({
      status: 403,
      details: { code: "original_document_admin_only" },
      message: helper.ORIGINAL_ADMIN_ONLY_MESSAGE,
    });

    const administrator = accountClient({ user_metadata: declared, app_metadata: { site_role: "administrator" } });
    await expect(
      helper.requireOriginalDocumentAccess(signedIn, { owner_id: null }, administrator.supabase),
    ).resolves.toBeUndefined();
  });

  it("refuses when the administrator lookup fails with the switch on", async () => {
    const { requireOriginalDocumentAccess } = await loadHelper({ adminOnly: true });
    let calls = 0;
    const getUserById = vi.fn(async (id: string) => {
      calls += 1;
      if (calls > 1) throw new Error("auth unavailable");
      return { data: { user: { id, user_metadata: declared, app_metadata: {} } }, error: null };
    });
    await expect(
      requireOriginalDocumentAccess(signedIn, { owner_id: null }, { auth: { admin: { getUserById } } } as never),
    ).rejects.toMatchObject({ status: 503, details: { code: "original_access_check_unavailable" } });
  });

  it("lets local no-auth development through", async () => {
    const { requireOriginalDocumentAccess } = await loadHelper({ adminOnly: true, localNoAuth: true });
    const { getUserById, supabase } = accountClient(new Error("must not be called"));
    await expect(
      requireOriginalDocumentAccess({ authenticated: false }, { owner_id: null }, supabase),
    ).resolves.toBeUndefined();
    expect(getUserById).not.toHaveBeenCalled();
  });
});

describe("document original signed-url route", () => {
  it("checks original access after the document read and before signing", () => {
    const source = readFileSync("src/app/api/documents/[id]/signed-url/route.ts", "utf8");
    const signIn = source.indexOf("requireSignedInClinicalAccess(access);");
    const read = source.indexOf('select("owner_id,storage_path,file_type,metadata")');
    const check = source.indexOf("await requireOriginalDocumentAccess(access, document, supabase);");
    const sign = source.indexOf("createSignedUrl(");
    expect(signIn).toBeGreaterThan(-1);
    expect(read).toBeGreaterThan(signIn);
    expect(check).toBeGreaterThan(read);
    expect(sign).toBeGreaterThan(check);
  });

  it("fails closed with no link when the server client cannot be built", async () => {
    vi.resetModules();
    vi.doMock("@/lib/env", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@/lib/env")>();
      return { ...actual, isDemoMode: () => false, isLocalNoAuthMode: () => false };
    });
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => {
        throw new Error("Missing Supabase server configuration.");
      },
    }));
    const { GET } = await import("../src/app/api/documents/[id]/signed-url/route");
    const response = await GET(new Request(`http://localhost/api/documents/${documentId}/signed-url`), {
      params: Promise.resolve({ id: documentId }),
    });
    expect(response.status).toBeGreaterThanOrEqual(500);
    expect(JSON.stringify(await response.json())).not.toContain("signedUrl");
  });

  it("refuses a signed-in account without the declaration before any link is signed", async () => {
    vi.resetModules();
    vi.doMock("@/lib/env", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@/lib/env")>();
      return { ...actual, isDemoMode: () => false, isLocalNoAuthMode: () => false };
    });
    const createSignedUrl = vi.fn(async () => ({ data: { signedUrl: "https://storage.invalid/x" }, error: null }));
    const query = {
      or: () => query,
      is: () => query,
      eq: () => query,
      maybeSingle: async () => ({
        data: { owner_id: null, storage_path: "public/guideline.pdf", file_type: "application/pdf", metadata: {} },
        error: null,
      }),
    };
    const supabase = {
      from: () => ({ select: () => query }),
      storage: { from: () => ({ createSignedUrl }) },
      auth: {
        admin: {
          getUserById: async (id: string) => ({
            data: { user: { id, user_metadata: {}, app_metadata: {} } },
            error: null,
          }),
        },
      },
    };
    vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient: () => supabase }));
    vi.doMock("@/lib/public-api-access", async (importOriginal) => ({
      ...(await importOriginal<typeof import("@/lib/public-api-access")>()),
      enforceDocumentReadRateLimit: async () => ({
        access: { authenticated: true, ownerId: callerId },
        rateLimit: { limited: false },
      }),
    }));
    const clinicalAccess = await import("../src/lib/clinical-access");
    clinicalAccess.resetHealthProfessionalDeclarationCache();
    const { GET } = await import("../src/app/api/documents/[id]/signed-url/route");
    const response = await GET(new Request(`http://localhost/api/documents/${documentId}/signed-url`), {
      params: Promise.resolve({ id: documentId }),
    });
    expect(response.status).toBe(403);
    expect(createSignedUrl).not.toHaveBeenCalled();
  });
});
