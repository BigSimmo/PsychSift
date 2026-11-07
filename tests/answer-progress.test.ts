import { describe, expect, it, vi } from "vitest";
import {
  answerProgressDisplayMessage,
  answerProgressPreviewMessage,
  answerProgressStepIndex,
  answerProgressTookUnusualRoute,
  normalizeAnswerProgressEvent,
} from "../src/components/clinical-dashboard/answer-progress";
import { toPublicAnswerProgressEvent } from "../src/lib/answer-progress-public";
import {
  evidencePreviewReconcilesWithFinal,
  readAnswerStream,
} from "../src/components/clinical-dashboard/search-utils";
import type { VerifiedEvidencePreviewUnit } from "../src/lib/answer-stream-contract";

const previewSource = {
  id: "chunk-1",
  document_id: "doc-1",
  title: "Clozapine Monitoring",
  file_name: "clozapine.pdf",
  page_number: 3,
  chunk_index: 1,
  section_heading: "Monitoring",
  content: "ANC thresholds and FBC monitoring schedule for clozapine.",
  image_ids: [],
  similarity: 0.82,
};

const evidencePreview: VerifiedEvidencePreviewUnit = {
  schemaVersion: 1,
  kind: "evidence_preview",
  sequence: 0,
  sources: [previewSource],
  selectedContextCount: 1,
};

describe("answer progress events", () => {
  it("keeps only safe, normalized Australian source counts at the public boundary", () => {
    const publicEvent = toPublicAnswerProgressEvent({
      stage: "ranking",
      message: "private model route marker",
      selectedContextCount: 4.9,
      australianSourceCount: 4,
      waSourceCount: 3,
      usedSupplementaryFallback: true,
      model: "private-model",
      reason: "private-reason",
      smartApiPlan: { private: true },
    });

    expect(publicEvent).toEqual({
      stage: "ranking",
      message: "Selecting the most relevant source passages.",
      selectedContextCount: 4,
      australianSourceCount: 4,
      waSourceCount: 3,
    });
    expect(publicEvent).not.toHaveProperty("usedSupplementaryFallback");
  });

  it("maps every supported internal stage to stable public copy", () => {
    const publicCopy = (stage: string, extra: Record<string, unknown> = {}) =>
      toPublicAnswerProgressEvent({ stage, message: "private internal detail", ...extra });

    expect(publicCopy("scoping")).toEqual({ stage: "scoping", message: "Preparing the clinical search scope." });
    expect(publicCopy("retrieving")).toEqual({
      stage: "retrieving",
      message: "Searching indexed clinical documents.",
    });
    expect(publicCopy("retrieved", { resultCount: 1 })).toEqual({
      stage: "retrieved",
      message: "Found 1 candidate source passage.",
      resultCount: 1,
    });
    expect(publicCopy("retrieved", { resultCount: 7 })?.message).toBe("Found 7 candidate source passages.");
    expect(publicCopy("retrieved")?.message).toBe("Source passages found.");
    // Internal routing and finalizing stages collapse into the public stages that describe them.
    expect(publicCopy("routing")?.stage).toBe("ranking");
    expect(publicCopy("finalizing")).toEqual({
      stage: "verifying",
      message: "Checking citations, clinical numbers, and source metadata.",
    });
    expect(publicCopy("generating")?.message).toBe("Drafting a cited answer from the selected passages.");
    expect(publicCopy("retrying")?.message).toContain("revising it against the evidence");
    expect(publicCopy("fallback")?.message).toBe("Building a source-backed answer from the selected passages.");
    expect(publicCopy("cached")).toEqual({ stage: "cached", message: "Loading a recent cited answer." });
    expect(publicCopy("complete", { elapsedMs: 1200.7 })).toEqual({
      stage: "complete",
      message: "Answer ready.",
      elapsedMs: 1200,
    });
  });

  it("rejects progress payloads that carry no recognized stage", () => {
    expect(toPublicAnswerProgressEvent(null)).toBeNull();
    expect(toPublicAnswerProgressEvent("retrieving")).toBeNull();
    expect(toPublicAnswerProgressEvent({ stage: "internal-debug", message: "private" })).toBeNull();
    expect(toPublicAnswerProgressEvent({ stage: "retrieved", resultCount: Number.NaN })).not.toHaveProperty(
      "resultCount",
    );
  });

  it("accepts legacy message-only progress while rendering stable copy", () => {
    const progress = normalizeAnswerProgressEvent({ message: "Selected fast route using private-model-marker." });

    expect(progress).toMatchObject({ stage: "ranking" });
    expect(answerProgressDisplayMessage(progress!)).toBe("Selecting the most relevant passages\u2026");
    expect(answerProgressDisplayMessage(progress!)).not.toMatch(/fast|private|model|route/i);
  });

  it("renders truthful Australian priority and fallback copy", () => {
    const progress = normalizeAnswerProgressEvent({
      stage: "ranking",
      message: "Selected governed passages.",
      selectedContextCount: 4,
      australianSourceCount: 4,
      waSourceCount: 4,
    });

    expect(answerProgressDisplayMessage(progress!)).toBe("Prioritising Australian sources\u2026");
    expect(answerProgressStepIndex("fallback")).toBe(3);
    expect(answerProgressDisplayMessage({ stage: "fallback", message: "private" })).toBe(
      "Assembling the answer from the sources directly\u2026",
    );
  });

  // The rule the whole wait is built on: no number the reader cannot reconcile
  // with something on screen. `resultCount` is candidate chunks — commonly 24
  // where the answer cites three — so a reader who takes "24" away has been told
  // the wrong thing about how much evidence is behind their answer, whatever
  // noun sat beside it. `australianSourceCount` fails the same test as a ratio,
  // so the fact survives without the figure.
  it("prints no count the reader cannot reconcile with the screen", () => {
    const line = (stage: "retrieving" | "retrieved" | "ranking", extra: Record<string, number> = {}) =>
      answerProgressDisplayMessage({ stage, message: "private", ...extra });

    expect(line("retrieving")).toBe("Searching your documents\u2026");
    expect(line("retrieved")).toBe("Searching your documents\u2026");
    expect(line("retrieved", { resultCount: 24 })).toBe("Searching your documents\u2026");
    expect(line("ranking", { australianSourceCount: 4, waSourceCount: 2 })).toBe(
      "Prioritising Australian sources\u2026",
    );

    for (const stage of ["scoping", "retrieving", "retrieved", "ranking", "generating", "verifying"] as const) {
      expect(
        answerProgressDisplayMessage({ stage, message: "private", resultCount: 24, australianSourceCount: 4 }),
      ).not.toMatch(/\d/);
    }
  });

  // The single exception, and it counts exactly the cards rendered beneath the
  // line — so a reader can check it by looking down.
  it("prints one count, and only for the sources actually on screen", () => {
    expect(answerProgressPreviewMessage(0, "generating")).toBeNull();
    expect(answerProgressPreviewMessage(1, "generating")).toBe("1 source found \u00b7 writing the answer\u2026");
    expect(answerProgressPreviewMessage(3, "generating")).toBe("3 sources found \u00b7 writing the answer\u2026");
    expect(answerProgressPreviewMessage(6, "fallback")).toBe(
      "6 sources found \u00b7 assembling the answer from them\u2026",
    );
    expect(answerProgressPreviewMessage(6, "verifying")).toBe("6 sources found \u00b7 checking the citations\u2026");
    // Before generation starts it states the count only — claiming the answer is
    // being written while ranking is still running would be a lie the reader
    // cannot see through.
    expect(answerProgressPreviewMessage(3, "ranking")).toBe("3 sources found");
  });

  // The wait is where a reader should learn the answer is being assembled without
  // the model, rather than meeting a source-only answer that then has to defend
  // itself.
  it("names the unusual route while it is happening", () => {
    expect(answerProgressDisplayMessage({ stage: "fallback", message: "private" })).toMatch(/sources directly/);
    expect(answerProgressDisplayMessage({ stage: "retrying", message: "private" })).toMatch(/Revising the draft/);
  });

  // A routine answer has nothing to disclose, which is why the retired Processing
  // details panel held the same five stages for every question. Only a
  // non-ordinary route earns the disclosure.
  it("offers the build disclosure only when the answer left the ordinary route", () => {
    const ordinary = (["scoping", "retrieving", "ranking", "generating", "verifying", "complete"] as const).map(
      (stage) => ({ stage, message: "private" }),
    );

    expect(answerProgressTookUnusualRoute(ordinary)).toBe(false);
    expect(answerProgressTookUnusualRoute([...ordinary, { stage: "fallback", message: "private" }])).toBe(true);
    expect(answerProgressTookUnusualRoute([...ordinary, { stage: "retrying", message: "private" }])).toBe(true);
    expect(answerProgressTookUnusualRoute([...ordinary, { stage: "cached", message: "private" }])).toBe(true);
    expect(answerProgressTookUnusualRoute([])).toBe(false);
  });

  it("rejects invalid progress objects and clamps safe counts", () => {
    expect(normalizeAnswerProgressEvent(null)).toBeNull();
    expect(normalizeAnswerProgressEvent({ stage: "ranking", message: "" })).toBeNull();
    expect(
      normalizeAnswerProgressEvent({
        stage: "retrieved",
        message: "Found passages.",
        resultCount: 2.8,
        selectedContextCount: -1,
      }),
    ).toMatchObject({ resultCount: 2, selectedContextCount: undefined });
  });

  it("parses only allowlisted SSE events and clears a verified preview when final becomes authoritative", async () => {
    const progress: string[] = [];
    const tokens: string[] = [];
    const previews: Array<VerifiedEvidencePreviewUnit | null> = [];
    let revisions = 0;
    const body = [
      `event: progress\ndata: ${JSON.stringify({ stage: "ranking", message: "private", verifiedUnit: evidencePreview })}`,
      'event: token\ndata: {"delta":"Draft"}',
      "event: revising\ndata: {}",
      'event: progress\ndata: {"stage":"complete","message":"private","elapsedMs":1200}',
      `event: final\ndata: ${JSON.stringify({
        answer: "Grounded answer.",
        grounded: true,
        confidence: "medium",
        citations: [],
        sources: [previewSource],
      })}`,
      "",
    ].join("\n\n");

    const answer = await readAnswerStream(
      new Response(body, { headers: { "Content-Type": "text/event-stream" } }),
      (event) => progress.push(event.stage),
      (delta) => tokens.push(delta),
      () => {
        revisions += 1;
      },
      undefined,
      (preview) => previews.push(preview),
    );

    expect(progress).toEqual(["ranking", "complete"]);
    expect(tokens).toEqual([]);
    expect(revisions).toBe(0);
    expect(previews).toEqual([evidencePreview, null]);
    expect(answer.answer).toBe("Grounded answer.");
  });

  it("drops invalid, duplicate, and out-of-order verified units", async () => {
    const previews: Array<VerifiedEvidencePreviewUnit | null> = [];
    const previewByStage: Array<[string, VerifiedEvidencePreviewUnit | null]> = [];
    let visiblePreview: VerifiedEvidencePreviewUnit | null = null;
    const body = [
      `event: progress\ndata: ${JSON.stringify({ stage: "ranking", message: "private", verifiedUnit: evidencePreview })}`,
      `event: progress\ndata: ${JSON.stringify({ stage: "generating", message: "private", verifiedUnit: evidencePreview })}`,
      `event: progress\ndata: ${JSON.stringify({
        stage: "verifying",
        message: "private",
        verifiedUnit: { ...evidencePreview, schemaVersion: 2 },
      })}`,
      `event: final\ndata: ${JSON.stringify({
        answer: "Grounded answer.",
        grounded: true,
        confidence: "medium",
        citations: [],
        sources: [previewSource],
      })}`,
      "",
    ].join("\n\n");

    await readAnswerStream(
      new Response(body, { headers: { "Content-Type": "text/event-stream" } }),
      (progress) => previewByStage.push([progress.stage, visiblePreview]),
      undefined,
      undefined,
      undefined,
      (preview) => {
        visiblePreview = preview;
        previews.push(preview);
      },
    );

    expect(previews).toEqual([evidencePreview, null]);
    expect(previewByStage).toContainEqual(["ranking", evidencePreview]);
    expect(previewByStage).toContainEqual(["generating", null]);
    expect(previewByStage).toContainEqual(["verifying", null]);
  });

  it("discards a preview on stream error and starts sequence validation fresh for a retry", async () => {
    const firstAttemptPreviews: Array<VerifiedEvidencePreviewUnit | null> = [];
    const failedBody = [
      `event: progress\ndata: ${JSON.stringify({ stage: "ranking", message: "private", verifiedUnit: evidencePreview })}`,
      'event: error\ndata: {"error":"provider unavailable","status":503}',
      "",
    ].join("\n\n");

    await expect(
      readAnswerStream(
        new Response(failedBody, { headers: { "Content-Type": "text/event-stream" } }),
        () => undefined,
        undefined,
        undefined,
        undefined,
        (preview) => firstAttemptPreviews.push(preview),
      ),
    ).rejects.toThrow("provider unavailable");
    expect(firstAttemptPreviews).toEqual([evidencePreview, null]);

    const retryPreviews: Array<VerifiedEvidencePreviewUnit | null> = [];
    const retryBody = [
      `event: progress\ndata: ${JSON.stringify({ stage: "ranking", message: "private", verifiedUnit: evidencePreview })}`,
      `event: final\ndata: ${JSON.stringify({
        answer: "Retry succeeded.",
        grounded: true,
        confidence: "medium",
        citations: [],
        sources: [previewSource],
      })}`,
      "",
    ].join("\n\n");
    await readAnswerStream(
      new Response(retryBody, { headers: { "Content-Type": "text/event-stream" } }),
      () => undefined,
      undefined,
      undefined,
      undefined,
      (preview) => retryPreviews.push(preview),
    );
    expect(retryPreviews).toEqual([evidencePreview, null]);
  });

  it("discards a preview when the response stream is cancelled", async () => {
    const previews: Array<VerifiedEvidencePreviewUnit | null> = [];
    const encoder = new TextEncoder();
    let previewDelivered = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (!previewDelivered) {
          previewDelivered = true;
          controller.enqueue(
            encoder.encode(
              `event: progress\ndata: ${JSON.stringify({ stage: "ranking", message: "private", verifiedUnit: evidencePreview })}\n\n`,
            ),
          );
          return;
        }
        controller.error(new DOMException("Cancelled", "AbortError"));
      },
    });

    await expect(
      readAnswerStream(
        new Response(body, { headers: { "Content-Type": "text/event-stream" } }),
        () => undefined,
        undefined,
        undefined,
        undefined,
        (preview) => previews.push(preview),
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(previews).toEqual([evidencePreview, null]);
  });

  it("requires byte-identical preview sources to reconcile with final", () => {
    const finalPayload = {
      answer: "Grounded answer.",
      grounded: true,
      confidence: "medium" as const,
      citations: [],
      sources: [previewSource],
    };

    expect(evidencePreviewReconcilesWithFinal(evidencePreview, finalPayload)).toBe(true);
    expect(
      evidencePreviewReconcilesWithFinal(
        { ...evidencePreview, sources: [{ ...previewSource, content: "Changed source text." }] },
        finalPayload,
      ),
    ).toBe(false);
  });

  it("discards a mismatched preview while retaining the authoritative final payload", async () => {
    const previews: Array<VerifiedEvidencePreviewUnit | null> = [];
    const authoritativeSource = { ...previewSource, content: "Authoritative final source text." };
    const body = [
      `event: progress\ndata: ${JSON.stringify({ stage: "ranking", message: "private", verifiedUnit: evidencePreview })}`,
      `event: final\ndata: ${JSON.stringify({
        answer: "Authoritative final answer.",
        grounded: true,
        confidence: "medium",
        citations: [],
        sources: [authoritativeSource],
      })}`,
      "",
    ].join("\n\n");

    const finalPayload = await readAnswerStream(
      new Response(body, { headers: { "Content-Type": "text/event-stream" } }),
      () => undefined,
      undefined,
      undefined,
      undefined,
      (preview) => previews.push(preview),
    );

    expect(previews).toEqual([evidencePreview, null]);
    expect(finalPayload.sources).toEqual([authoritativeSource]);
  });

  it("fails closed when a shared answer stream ends without a valid final payload", async () => {
    const response = new Response('event: progress\ndata: {"stage":"complete","message":"private"}\n\n');

    await expect(readAnswerStream(response, () => undefined)).rejects.toThrow(
      "Answer stream ended before a final answer was received.",
    );
  });

  it("cancels an open reader on caller abort and removes its listener and lock", async () => {
    const cancelled = vi.fn();
    const body = new ReadableStream<Uint8Array>({ cancel: cancelled });
    const response = new Response(body);
    const controller = new AbortController();
    const removeListener = vi.spyOn(controller.signal, "removeEventListener");
    const pending = readAnswerStream(
      response,
      () => undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      controller.signal,
    );
    controller.abort(new DOMException("Synthetic cancellation", "AbortError"));
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(cancelled).toHaveBeenCalledOnce();
    expect(cancelled).toHaveBeenCalledWith(controller.signal.reason);
    expect(removeListener).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(body.locked).toBe(false);
  });

  it("returns a valid terminal final even when source cancellation never settles", async () => {
    const final = {
      answer: "Synthetic terminal answer.",
      grounded: true,
      confidence: "medium",
      citations: [],
      sources: [],
    };
    const cancelled = vi.fn(() => new Promise<void>(() => undefined));
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`event: final\ndata: ${JSON.stringify(final)}\n\n`));
      },
      cancel: cancelled,
    });
    let received: Awaited<ReturnType<typeof readAnswerStream>> | undefined;
    let error: unknown;
    void readAnswerStream(new Response(body), () => undefined).then(
      (value) => {
        received = value;
      },
      (value: unknown) => {
        error = value;
      },
    );
    for (let turn = 0; turn < 12; turn += 1) await Promise.resolve();
    expect(error).toBeUndefined();
    expect(received?.answer).toBe(final.answer);
    expect(cancelled).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
  });
});
