import { afterEach, describe, expect, it, vi } from "vitest";
import * as privacy from "@/lib/privacy";
import { redactLogContext } from "@/lib/logger";

const privateText = "Synthetic Person 1990-01-02 private-guideline.pdf";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.doUnmock("@/lib/supabase/admin");
  vi.doUnmock("../worker/observability");
});

describe("content-free operational diagnostics", () => {
  it("keeps only fixed classifications and operational codes, never error prose", () => {
    const error = Object.assign(new Error(privateText), {
      code: "23505",
      status: 503,
      details: privateText,
      hint: privateText,
    });
    const details = privacy.contentFreeErrorDetails(error);
    expect(details).toEqual({ errorType: "Error", errorCode: "23505", status: 503 });
    expect(JSON.stringify(details)).not.toContain(privateText);
  });

  it("does not trust arbitrary names, codes, objects or thrown strings", () => {
    for (const error of [
      Object.assign(new Error(privateText), { name: privateText, code: privateText, status: 1000 }),
      privateText,
      { message: privateText, code: { privateText }, status: privateText },
    ]) {
      const text = JSON.stringify(privacy.contentFreeErrorDetails(error));
      expect(text).not.toContain(privateText);
      expect(text).not.toContain("1990-01-02");
    }
  });

  it("redacts user-controlled filenames and storage paths at the logger boundary", () => {
    expect(
      redactLogContext({ fileName: privateText, storagePath: "owner/documents/" + privateText, fileCount: 1 }),
    ).toEqual({ fileName: "[redacted]", storagePath: "[redacted]", fileCount: 1 });
  });

  it("never puts a fatal exception's content in console or webhook output", async () => {
    const error = Object.assign(new Error(privateText), { code: "23505" });
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => {
        throw error;
      },
    }));
    vi.doMock("../worker/observability", () => ({
      captureWorkerException: vi.fn(),
      flushWorkerErrorTracking: vi.fn(async () => undefined),
    }));
    vi.stubEnv("WORKER_FAILURE_WEBHOOK_URL", "https://hooks.invalid/synthetic-audit");
    const post = vi.fn<typeof fetch>(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", post);
    const printed = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const exit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const { runWorkerMain } = await import("../worker/main");
    await runWorkerMain();
    expect(exit).toHaveBeenCalledWith(1);
    expect(post).toHaveBeenCalledTimes(1);
    const sent = String(post.mock.calls[0]?.[1]?.body);
    expect(sent).toContain("CRITICAL");
    expect(sent).not.toContain(privateText);
    expect(JSON.stringify(printed.mock.calls)).not.toContain(privateText);
  });
});
