import { afterEach, describe, expect, it, vi } from "vitest";
import { privacySafeErrorEvent } from "@/lib/observability/error-tracking";
import type { init } from "@sentry/node";

const sentry = vi.hoisted(() => ({ init: vi.fn<typeof init>() }));
vi.mock("@sentry/node", () => sentry);

describe("worker error tracking", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("stays inert without SENTRY_DSN and never throws from capture or flush", async () => {
    vi.stubEnv("SENTRY_DSN", "");
    const { initWorkerErrorTracking, captureWorkerException, flushWorkerErrorTracking } =
      await import("../worker/observability");

    expect(initWorkerErrorTracking()).toBe(false);
    expect(() =>
      captureWorkerException(new Error("storage path /docs/patient-notes.pdf failed"), "process"),
    ).not.toThrow();
    await expect(flushWorkerErrorTracking()).resolves.toBeUndefined();
    expect(sentry.init).not.toHaveBeenCalled();
  });

  it("keeps Sentry 11 traces scrubbed and rejects worker log and sensitive-data collection", async () => {
    vi.stubEnv("SENTRY_DSN", "https://synthetic@example.test/1");
    const { initWorkerErrorTracking } = await import("../worker/observability");

    expect(initWorkerErrorTracking()).toBe(true);
    const options = sentry.init.mock.calls[0]?.[0];
    expect(options).toBeDefined();
    if (!options) throw new Error("Worker did not initialize Sentry");
    expect(options.traceLifecycle).toBe("static");
    expect(options.dataCollection).toEqual({
      userInfo: false,
      cookies: false,
      httpHeaders: { request: false, response: false },
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: false,
      genAI: { inputs: false, outputs: false },
      queues: false,
      graphQL: { document: false, variables: false },
      stackFrameVariables: false,
      frameContextLines: 0,
    });
    expect(options.beforeSendLog?.({ level: "info", message: "clinical text", severityNumber: 9 })).toBeNull();
    const transaction = options.beforeSendTransaction?.(
      {
        type: "transaction",
        transaction: "worker/process?document=patient-identifier",
        request: { data: "private body" },
        user: { id: "patient-identifier" },
        spans: [],
      },
      {},
    );
    expect(transaction).not.toHaveProperty("request");
    expect(transaction).not.toHaveProperty("user");
    expect(JSON.stringify(transaction)).not.toMatch(/private body|patient-identifier/);
  });
});

describe("worker event privacy boundary", () => {
  it("keeps the fixed stage labels and strips ingestion paths, filenames, and extracted text", () => {
    const event = privacySafeErrorEvent({
      type: undefined,
      event_id: "worker-1",
      // Ingestion errors routinely quote storage paths and document text.
      message: "OCR failed for clinical-documents/owner-42/Jane Doe discharge summary.pdf",
      exception: {
        values: [
          {
            type: "OcrExtractionError",
            value: "tesseract failed on page 3: 'Jane Doe, MRN 123456, lithium 900mg'",
            stacktrace: {
              frames: [{ filename: "worker/main.ts", function: "processJob", lineno: 1953, colno: 13, in_app: true }],
            },
          },
        ],
      },
      tags: {
        service: "worker",
        worker_stage: "process",
        document_id: "doc-42",
        owner_id: "owner-42",
        storage_path: "clinical-documents/owner-42/Jane Doe discharge summary.pdf",
      },
    });

    expect(JSON.stringify(event)).not.toMatch(/Jane|123456|lithium|doc-42|owner-42|clinical-documents|tesseract/);
    expect(event.tags).toEqual({ service: "worker", worker_stage: "process" });
    expect(event.exception?.values?.[0]).toMatchObject({
      // Custom error names are untrusted free-form text and collapse to Error.
      type: "Error",
      value: "Unhandled server request error",
      stacktrace: { frames: [{ filename: "worker/main.ts", function: "processJob", lineno: 1953 }] },
    });
    // Worker events have no route pattern; grouping uses service + stage.
    expect(event.fingerprint).toEqual(["worker", "process", "Error", "worker/main.ts"]);
  });

  it("still groups app route events by route pattern", () => {
    const event = privacySafeErrorEvent({
      type: undefined,
      event_id: "route-1",
      exception: {
        values: [
          {
            type: "TypeError",
            value: "boom",
            stacktrace: {
              frames: [{ filename: "src/app/api/answer/route.ts", function: "POST", lineno: 42, in_app: true }],
            },
          },
        ],
      },
      tags: { route_path: "/api/answer" },
    });

    expect(event.fingerprint).toEqual(["/api/answer", "TypeError", "src/app/api/answer/route.ts", "POST"]);
  });
});
