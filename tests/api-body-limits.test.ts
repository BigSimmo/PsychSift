import { describe, expect, it, vi } from "vitest";

import { readBoundedFormData, readBoundedJson } from "@/lib/validation/body";

function createChunkedStream(chunks: Uint8Array[], onPull?: (index: number) => void): ReadableStream<Uint8Array> {
  let index = 0;
  return new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (index >= chunks.length) {
          controller.close();
          return;
        }
        onPull?.(index);
        controller.enqueue(chunks[index]!);
        index += 1;
      },
    },
    { highWaterMark: 0 },
  );
}

describe("R10: bounded JSON and multipart form-data body readers", () => {
  it("rejects oversized Content-Length before reading the multipart stream", async () => {
    let pulled = false;
    const stream = createChunkedStream([new Uint8Array(1024)], () => {
      pulled = true;
    });
    const request = new Request("http://localhost/api/upload", {
      method: "POST",
      headers: {
        "content-type": "multipart/form-data; boundary=----TestBoundary",
        "content-length": String(2 * 1024 * 1024),
      },
      body: stream,
      duplex: "half",
    } as RequestInit);

    await expect(
      readBoundedFormData(request, 64 * 1024, {
        envelopeBytes: 16 * 1024,
        tooLargeMessage: "Upload too large.",
        tooLargeCode: "file_too_large",
      }),
    ).rejects.toMatchObject({
      status: 413,
      message: "Upload too large.",
      details: { code: "file_too_large" },
    });
    expect(pulled).toBe(false);
  });

  it("aborts chunked multipart streams without Content-Length as soon as maxBytes + envelopeBytes is exceeded", async () => {
    const pulledIndices: number[] = [];
    const chunk = new Uint8Array(32 * 1024);
    const stream = createChunkedStream([chunk, chunk, chunk, chunk], (idx) => {
      pulledIndices.push(idx);
    });
    const request = new Request("http://localhost/api/teaching/import/read", {
      method: "POST",
      headers: {
        "content-type": "multipart/form-data; boundary=----TestBoundary",
      },
      body: stream,
      duplex: "half",
    } as RequestInit);

    await expect(
      readBoundedFormData(request, 32 * 1024, {
        envelopeBytes: 16 * 1024,
        tooLargeMessage: "That file is over 2 MB.",
        tooLargeCode: "file_too_large",
      }),
    ).rejects.toMatchObject({
      status: 413,
      message: "That file is over 2 MB.",
      details: { code: "file_too_large" },
    });
    // Limit is 48 KB (32 KB + 16 KB); reading stops on chunk index 1 (64 KB) before pulling chunk 2 or 3.
    expect(pulledIndices).toEqual([0, 1]);
  });

  it("parses valid multipart FormData within the byte limit and enforces per-file maxBytes", async () => {
    const okForm = new FormData();
    okForm.set("note", "teaching import");
    okForm.set("file", new File([new Uint8Array(1024)], "roster.csv", { type: "text/csv" }));

    const okRequest = new Request("http://localhost/api/teaching/import/read", {
      method: "POST",
      body: okForm,
    });
    const okData = await readBoundedFormData(okRequest, 4096, { envelopeBytes: 4096 });
    expect(okData.get("note")).toBe("teaching import");
    const file = okData.get("file");
    expect(file).toBeInstanceOf(File);
    expect((file as File).size).toBe(1024);

    // Total multipart body fits within maxBytes + envelopeBytes, but the File itself exceeds maxBytes.
    const bigFileForm = new FormData();
    bigFileForm.set("file", new File([new Uint8Array(3000)], "oversized.csv", { type: "text/csv" }));
    const bigFileRequest = new Request("http://localhost/api/teaching/import/read", {
      method: "POST",
      body: bigFileForm,
    });
    await expect(
      readBoundedFormData(bigFileRequest, 2048, {
        envelopeBytes: 8192,
        tooLargeCode: "file_too_large",
      }),
    ).rejects.toMatchObject({
      status: 413,
      details: { code: "file_too_large" },
    });
  });

  it("throws 400 invalidFormCode when multipart body bytes are malformed", async () => {
    const badBytes = new TextEncoder().encode("not-a-valid-multipart-body");
    const request = new Request("http://localhost/api/speech/transcribe", {
      method: "POST",
      headers: {
        "content-type": "multipart/form-data; boundary=----MissingBoundary",
      },
      body: createChunkedStream([badBytes]),
      duplex: "half",
    } as RequestInit);

    await expect(
      readBoundedFormData(request, 64 * 1024, {
        invalidFormMessage: "Expected multipart/form-data payload.",
        invalidFormCode: "invalid_multipart",
      }),
    ).rejects.toMatchObject({
      status: 400,
      message: "Expected multipart/form-data payload.",
      details: expect.objectContaining({ code: "invalid_multipart" }),
    });
  });

  it("enforces streamed byte limits on readBoundedJson for chunked JSON payloads", async () => {
    const hugeChunk = new TextEncoder().encode(`{"note":"${"x".repeat(300_000)}"}`);
    const request = new Request("http://localhost/api/cme/missed/123", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: createChunkedStream([hugeChunk]),
      duplex: "half",
    } as RequestInit);

    await expect(readBoundedJson(request)).rejects.toMatchObject({
      status: 413,
      details: { code: "payload_too_large" },
    });
  });

  it("returns 413 from /api/teaching/import/read when a streamed upload exceeds IMPORT_MAX_FILE_BYTES", async () => {
    vi.resetModules();
    vi.doMock("@/lib/env", async (importOriginal) => ({
      ...(await importOriginal<typeof import("@/lib/env")>()),
      isDemoMode: () => true,
    }));

    const { POST } = await import("@/app/api/teaching/import/read/route");
    const oneMbChunk = new Uint8Array(1024 * 1024);
    const request = new Request("http://localhost/api/teaching/import/read", {
      method: "POST",
      headers: {
        "content-type": "multipart/form-data; boundary=----OversizedImport",
      },
      body: createChunkedStream([oneMbChunk, oneMbChunk, oneMbChunk]),
      duplex: "half",
    } as RequestInit);

    const response = await POST(request);
    expect(response.status).toBe(413);
  });
});
