import { afterEach, describe, expect, it, vi } from "vitest";

import { logger } from "../src/lib/logger";
import { normalizeSourceMetadata, sourceMetadataDiagnostics } from "../src/lib/source-metadata";

// Regression for the P1 browser crash: `src/lib/logger.ts` was inlined into the
// browser bundle (reached from `source-metadata.ts`, which the source badges are
// built on) and read `process.env.LOG_LEVEL` unguarded. In a browser `process` is
// undefined, so *any* off-vocabulary metadata value threw a ReferenceError out of
// `enumOrDefault` and unmounted the whole React tree instead of falling back to the
// neutral triad. Two defences are asserted here: the env read is guarded, and
// `source-metadata` no longer pulls the server logger into the client graph at all.
describe("source metadata diagnostics are browser-safe", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("does not import the server logger into the client module graph", async () => {
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("../src/lib/source-metadata.ts", import.meta.url), "utf8"),
    );

    expect(source).not.toMatch(/from\s+["']@\/lib\/logger["']/);
  });

  it("normalizes off-vocabulary values without a ReferenceError when `process` is absent", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("process", undefined);

    const metadata = normalizeSourceMetadata({
      document_status: "validated",
      clinical_validation_status: "validated",
      extraction_quality: "excellent",
    });

    // The neutral fallback triad, not a crash.
    expect(metadata.document_status).toBe("unknown");
    expect(metadata.clinical_validation_status).toBe("unverified");
    expect(metadata.extraction_quality).toBe("unknown");
    expect(warn).toHaveBeenCalledTimes(3);
  });

  it("keeps the diagnostic seam itself safe when `process` is absent", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("process", undefined);

    expect(() => sourceMetadataDiagnostics.warn("document_status", "unsupported_value")).not.toThrow();
    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0]?.[0])).not.toContain("validated");
  });

  it("keeps the logger itself safe when `process` is absent", () => {
    // Defence in depth: any other module that accidentally reaches the logger from
    // client code must degrade to a console line, never a ReferenceError.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("process", undefined);

    expect(() => logger.warn("browser-safety probe")).not.toThrow();
    expect(warn).toHaveBeenCalledOnce();
  });

  it("keeps the logger safe when `process` exists without an `env` bag", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("process", {} as NodeJS.Process);

    expect(() => logger.warn("browser-safety probe")).not.toThrow();
    expect(warn).toHaveBeenCalledOnce();
  });
});
