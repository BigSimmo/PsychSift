import { describe, expect, it } from "vitest";

// src/instrumentation-client.ts turns off Zod's JIT (an eval probe the CSP reports)
// without importing Zod, by writing Zod's global config object. This pins that
// Zod still reads that object, so an upgrade that moves it fails here.
describe("instrumentation-client Zod setting", () => {
  it("turns on jitless in the config Zod reads", async () => {
    await import("@/instrumentation-client");
    const { config } = await import("zod/v4/core");
    expect(config().jitless).toBe(true);
  });
});
