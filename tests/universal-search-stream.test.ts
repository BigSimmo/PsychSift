import { describe, expect, it, vi } from "vitest";

import type { UniversalSearchGroup, UniversalSearchResponse } from "../src/lib/universal-search";

const encoder = new TextEncoder();

function responseFromChunks(chunks: string[]) {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
    { headers: { "Content-Type": "application/x-ndjson; charset=utf-8" } },
  );
}

describe("consumeUniversalSearchNdjson", () => {
  it("treats a complete frame as terminal and cancels an open body without waiting for EOF", async () => {
    const { consumeUniversalSearchNdjson } = await import("../src/lib/universal-search-stream");
    const final: UniversalSearchResponse = { query: "synthetic terminal frame", groups: [], tookMs: 1 };
    const cancelled = vi.fn();
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(value) {
          controller = value;
          controller.enqueue(encoder.encode(`${JSON.stringify({ type: "complete", response: final })}\n`));
        },
        cancel: cancelled,
      }),
    );
    let settled = false;
    const result = consumeUniversalSearchNdjson(response).then((value) => {
      settled = true;
      return value;
    });
    for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
    try {
      expect(settled).toBe(true);
      expect(cancelled).toHaveBeenCalledOnce();
    } finally {
      if (!cancelled.mock.calls.length) controller.close();
    }
    await expect(result).resolves.toEqual(final);
  });

  it("emits progressive groups and returns the canonical final response across split chunks", async () => {
    const { consumeUniversalSearchNdjson } = await import("../src/lib/universal-search-stream");
    const group: UniversalSearchGroup = {
      kind: "medications",
      total: 1,
      latencyMs: 3,
      items: [
        {
          id: "clozapine",
          kind: "medications",
          title: "Clozapine",
          href: "/medications/clozapine",
          score: 10,
        },
      ],
    };
    const final: UniversalSearchResponse = {
      query: "clozapine",
      groups: [group],
      tookMs: 4,
      domainOrder: ["medications"],
    };
    const payload = `${JSON.stringify({ type: "group", query: "clozapine", group })}\n${JSON.stringify({
      type: "complete",
      response: final,
    })}\n`;
    const splitAt = payload.indexOf("Clozapine") + 4;
    const onGroup = vi.fn();

    const result = await consumeUniversalSearchNdjson(
      responseFromChunks([payload.slice(0, splitAt), payload.slice(splitAt)]),
      { onGroup },
    );

    expect(onGroup).toHaveBeenCalledOnce();
    expect(onGroup).toHaveBeenCalledWith(group, "clozapine");
    expect(result).toEqual(final);
  });

  it("cancels the reader and rejects when the caller aborts", async () => {
    const { consumeUniversalSearchNdjson } = await import("../src/lib/universal-search-stream");
    const cancelled = vi.fn();
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              `${JSON.stringify({
                type: "group",
                query: "clozapine",
                group: { kind: "medications", total: 0, latencyMs: 1, items: [] },
              })}\n`,
            ),
          );
        },
        cancel(reason) {
          cancelled(reason);
        },
      }),
      { headers: { "Content-Type": "application/x-ndjson; charset=utf-8" } },
    );
    const controller = new AbortController();
    const pending = consumeUniversalSearchNdjson(response, { signal: controller.signal });
    await Promise.resolve();

    controller.abort(new DOMException("superseded", "AbortError"));

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(cancelled).toHaveBeenCalledOnce();
  });

  it("rejects a truncated stream without a complete event", async () => {
    const { consumeUniversalSearchNdjson } = await import("../src/lib/universal-search-stream");
    const response = responseFromChunks([
      `${JSON.stringify({
        type: "group",
        query: "clozapine",
        group: { kind: "medications", total: 0, latencyMs: 1, items: [] },
      })}\n`,
    ]);

    await expect(consumeUniversalSearchNdjson(response)).rejects.toThrow("complete event");
  });

  it("rejects a redacted server error and cancels the open response body", async () => {
    const { consumeUniversalSearchNdjson } = await import("../src/lib/universal-search-stream");
    const cancelled = vi.fn();
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(`${JSON.stringify({ type: "error", code: "universal_search_failed" })}\n`));
        },
        cancel(reason) {
          cancelled(reason);
        },
      }),
      { headers: { "Content-Type": "application/x-ndjson; charset=utf-8" } },
    );

    await expect(consumeUniversalSearchNdjson(response)).rejects.toThrow("Universal search failed.");
    expect(cancelled).toHaveBeenCalledOnce();
    expect(cancelled).toHaveBeenCalledWith(expect.objectContaining({ message: "Universal search failed." }));
  });
});
