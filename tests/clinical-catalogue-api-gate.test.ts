import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

// #3728: these routes refuse signed-out requests on the server with the #3696 rule
// (requireSignedInClinicalAccess, a 401), called straight after the access context.
const gatedRoutes = [
  "src/app/api/search/route.ts",
  "src/app/api/search/universal/route.ts",
  "src/app/api/medications/route.ts",
  "src/app/api/medications/[slug]/route.ts",
  "src/app/api/differentials/route.ts",
  "src/app/api/differentials/[slug]/route.ts",
  "src/app/api/differentials/presentations/[slug]/route.ts",
];

describe("signed-in gate on the catalogue and search APIs", () => {
  it.each(gatedRoutes)("%s refuses signed-out requests right after its access context", (path) => {
    const source = readFileSync(path, "utf8");
    expect(source).toMatch(
      /const access = await public(?:Catalogue)?AccessContext\(request, supabase\);\n(?:\s*\/\/[^\n]*\n)*\s*requireSignedInClinicalAccess\(access\);/u,
    );
  });

  it("leaves the search interaction telemetry route on its own owner check", () => {
    const source = readFileSync("src/app/api/search/interaction/route.ts", "utf8");
    expect(source).not.toContain("requireSignedInClinicalAccess");
  });
});

describe("requireSignedInClinicalAccess", () => {
  afterEach(() => {
    vi.doUnmock("@/lib/env");
    vi.resetModules();
  });

  async function load(localNoAuth: boolean) {
    vi.resetModules();
    vi.doMock("@/lib/env", async (importOriginal) => ({
      ...(await importOriginal<typeof import("@/lib/env")>()),
      isLocalNoAuthMode: () => localNoAuth,
    }));
    return import("@/lib/clinical-access");
  }

  it("refuses a signed-out request and lets a signed-in one through", async () => {
    const { requireSignedInClinicalAccess } = await load(false);
    expect(() => requireSignedInClinicalAccess({ authenticated: false })).toThrow("Sign in to use this.");
    expect(() => requireSignedInClinicalAccess({ authenticated: true })).not.toThrow();
  });

  it("keeps local no-auth development mode open", async () => {
    const { requireSignedInClinicalAccess } = await load(true);
    expect(() => requireSignedInClinicalAccess({ authenticated: false })).not.toThrow();
  });
});
