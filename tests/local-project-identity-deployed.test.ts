import { afterEach, describe, expect, it, vi } from "vitest";

import { readLocalProjectIdentity } from "../src/lib/local-project-identity";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("readLocalProjectIdentity", () => {
  it("treats the deployed site's 404 as a safe hosted origin in a production build", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 404 })),
    );
    const identity = await readLocalProjectIdentity();
    expect(identity?.localServer.safeLocalOrigin).toBe(true);
    expect(identity?.localServer.requestOrigin).toBeNull();
  });

  it("still reports no identity for a 404 outside a production build", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 404 })),
    );
    expect(await readLocalProjectIdentity()).toBeNull();
  });
});
