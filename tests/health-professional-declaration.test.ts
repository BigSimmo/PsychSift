import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TERMS_VERSION } from "../src/lib/front-door-content";
import { TERMS_METADATA_KEY } from "../src/lib/terms-acceptance";

// Regulatory re-audit R2-01 (26 Oct 2026): the AI routes refuse a signed-in account that has
// not recorded the "I'm a health professional and I accept the Terms" declaration.
const declarationRoutes = [
  "src/app/api/answer/route.ts",
  "src/app/api/answer/stream/route.ts",
  "src/app/api/clinical-ask/stream/route.ts",
];

describe("health professional declaration on the AI routes", () => {
  it.each(declarationRoutes)("%s checks the declaration after sign-in and the rate limit", (path) => {
    const source = readFileSync(path, "utf8");
    const signIn = source.indexOf("requireSignedInClinicalAccess(access);");
    const rateLimit = source.indexOf("consumeSubjectApiRateLimit(");
    const declaration = source.indexOf("await requireHealthProfessionalDeclaration(access, supabase);");
    // The rate limit runs first so refused accounts still spend their allowance on the account lookup.
    expect(signIn).toBeGreaterThan(-1);
    expect(rateLimit).toBeGreaterThan(signIn);
    expect(declaration).toBeGreaterThan(rateLimit);
  });
});

describe("requireHealthProfessionalDeclaration", () => {
  afterEach(() => {
    vi.doUnmock("@/lib/env");
    vi.resetModules();
  });

  async function load(localNoAuth = false) {
    vi.resetModules();
    vi.doMock("@/lib/env", async (importOriginal) => ({
      ...(await importOriginal<typeof import("@/lib/env")>()),
      isLocalNoAuthMode: () => localNoAuth,
    }));
    const clinicalAccess = await import("../src/lib/clinical-access");
    clinicalAccess.resetHealthProfessionalDeclarationCache();
    return clinicalAccess;
  }

  function client(result: { data: unknown; error: unknown } | Error) {
    const getUserById = vi.fn(async () => {
      if (result instanceof Error) throw result;
      return result;
    });
    return { getUserById, supabase: { auth: { admin: { getUserById } } } as never };
  }

  const signedIn = { authenticated: true, ownerId: "user-1" };
  const accepted = { user: { user_metadata: { [TERMS_METADATA_KEY]: { version: TERMS_VERSION, acceptedAt: "x" } } } };

  it("lets through an account that holds the current declaration, and remembers it", async () => {
    const { requireHealthProfessionalDeclaration } = await load();
    const { getUserById, supabase } = client({ data: accepted, error: null });
    await expect(requireHealthProfessionalDeclaration(signedIn, supabase, 1_000)).resolves.toBeUndefined();
    await expect(requireHealthProfessionalDeclaration(signedIn, supabase, 2_000)).resolves.toBeUndefined();
    expect(getUserById).toHaveBeenCalledTimes(1);
    expect(getUserById).toHaveBeenCalledWith("user-1");
  });

  it("checks the account again once the remembered result is ten minutes old", async () => {
    const { requireHealthProfessionalDeclaration } = await load();
    const { getUserById, supabase } = client({ data: accepted, error: null });
    await requireHealthProfessionalDeclaration(signedIn, supabase, 0);
    await requireHealthProfessionalDeclaration(signedIn, supabase, 10 * 60 * 1000 + 1);
    expect(getUserById).toHaveBeenCalledTimes(2);
  });

  it("refuses an account with no declaration with a 403, and does not remember the refusal", async () => {
    const { requireHealthProfessionalDeclaration, DECLARATION_REQUIRED_MESSAGE } = await load();
    const { getUserById, supabase } = client({ data: { user: { user_metadata: {} } }, error: null });
    for (const at of [1, 2]) {
      await expect(requireHealthProfessionalDeclaration(signedIn, supabase, at)).rejects.toMatchObject({
        status: 403,
        message: DECLARATION_REQUIRED_MESSAGE,
        details: { code: "terms_acceptance_required" },
      });
    }
    expect(getUserById).toHaveBeenCalledTimes(2);
  });

  it("refuses an account that accepted an older Terms version", async () => {
    const { requireHealthProfessionalDeclaration } = await load();
    const { supabase } = client({
      data: { user: { user_metadata: { [TERMS_METADATA_KEY]: { version: "2020-01-01-old", acceptedAt: "x" } } } },
      error: null,
    });
    await expect(requireHealthProfessionalDeclaration(signedIn, supabase)).rejects.toMatchObject({ status: 403 });
  });

  it("refuses rather than lets through when the account lookup fails", async () => {
    const { requireHealthProfessionalDeclaration } = await load();
    for (const result of [new Error("synthetic outage"), { data: { user: null }, error: { message: "synthetic" } }]) {
      const { supabase } = client(result);
      await expect(requireHealthProfessionalDeclaration(signedIn, supabase)).rejects.toMatchObject({
        status: 503,
        details: { code: "declaration_check_unavailable" },
      });
    }
  });

  it("refuses a signed-out request", async () => {
    const { requireHealthProfessionalDeclaration } = await load();
    const { getUserById, supabase } = client({ data: accepted, error: null });
    await expect(requireHealthProfessionalDeclaration({ authenticated: false }, supabase)).rejects.toMatchObject({
      status: 401,
    });
    expect(getUserById).not.toHaveBeenCalled();
  });

  it("allows local no-auth development mode through without a lookup", async () => {
    const { requireHealthProfessionalDeclaration } = await load(true);
    const { getUserById, supabase } = client({ data: { user: { user_metadata: {} } }, error: null });
    await expect(requireHealthProfessionalDeclaration({ authenticated: false }, supabase)).resolves.toBeUndefined();
    expect(getUserById).not.toHaveBeenCalled();
  });
});
