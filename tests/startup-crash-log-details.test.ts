import { describe, expect, it } from "vitest";
import { startupCrashLogDetails } from "../src/lib/privacy";

class BootError extends Error {
  code = "ENV_MISSING";
}

describe("startupCrashLogDetails", () => {
  it("reports name, code, constructor name, and first app frame without the message", () => {
    const secret = "SECRET_MESSAGE_CANARY patient John Citizen";
    const error = new BootError(secret);
    error.stack = [
      `Error: ${secret}`,
      "    at node:internal/modules/run_main:1:1",
      "    at loadConfig (/app/dist/worker/config.js:42:13)",
      "    at /app/worker/main.js:7:1",
    ].join("\n");

    const details = startupCrashLogDetails(error);

    expect(details).toEqual({
      name: "Error",
      code: "ENV_MISSING",
      constructorName: "BootError",
      frame: "/app/dist/worker/config.js:42",
    });
    const serialized = JSON.stringify(details);
    expect(serialized).not.toContain("SECRET_MESSAGE_CANARY");
    expect(serialized).not.toContain("John");
    expect(serialized).not.toContain(secret);
  });

  it("does not treat a multi-line message as a stack frame", () => {
    const error = new Error("boom\n    at fake (/app/dist/leak.js:1:1)");
    error.stack = `Error: ${error.message}\n    at real (/app/worker/main.ts:9:3)`;
    const details = startupCrashLogDetails(error);
    expect(details.frame).toBe("/app/worker/main.ts:9");
    expect(JSON.stringify(details)).not.toContain("boom");
  });

  it("omits non-string codes and frames outside the app paths", () => {
    const error = Object.assign(new Error("hidden reason"), { code: 123 });
    error.stack = "Error: hidden reason\n    at x (/usr/lib/node/foo.js:1:1)";
    const details = startupCrashLogDetails(error);
    expect(details).toEqual({ name: "Error", constructorName: "Error" });
    expect(JSON.stringify(details)).not.toContain("hidden reason");
  });

  it("tolerates non-error values", () => {
    expect(JSON.stringify(startupCrashLogDetails("just a string"))).not.toContain("just a string");
    expect(startupCrashLogDetails(null)).not.toHaveProperty("frame");
  });
});
