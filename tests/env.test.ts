import { afterEach, describe, expect, it, vi } from "vitest";

describe("developer-area access-key environment parsing", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("treats blank and under-strength access keys as unconfigured at module load", async () => {
    // Replacing the schema preprocessor with a direct min(32) validation should
    // make this import reject. The actual app imports this module before proxy
    // authorization can fall back to the administrator gate.
    for (const accessKey of ["", "short", "x".repeat(31)]) {
      vi.resetModules();
      vi.stubEnv("DEVELOPER_AREA_ACCESS_KEY", accessKey);

      await expect(import("@/lib/env")).resolves.toMatchObject({
        env: { DEVELOPER_AREA_ACCESS_KEY: undefined },
      });
    }
  });
});

describe("deep-probe secret environment parsing", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("treats a blank secret as unset, as the offline test wrapper leaves it", async () => {
    vi.stubEnv("HEALTH_DEEP_PROBE_SECRET", "");

    await expect(import("@/lib/env")).resolves.toMatchObject({
      env: { HEALTH_DEEP_PROBE_SECRET: undefined },
    });
  });

  it("still rejects a non-blank secret shorter than 16 characters", async () => {
    vi.stubEnv("HEALTH_DEEP_PROBE_SECRET", "too-short");

    await expect(import("@/lib/env")).rejects.toThrow();
  });
});
