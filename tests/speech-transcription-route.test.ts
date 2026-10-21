import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  rate: vi.fn(),
  transcribe: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  enabled: vi.fn(),
}));
vi.mock("@/lib/public-api-access", () => ({ publicAccessContext: mocks.access }));
vi.mock("@/lib/clinical-ask/authority-registry", () => ({ clinicalAskEnabled: mocks.enabled }));
vi.mock("@/lib/api-rate-limit", () => ({
  consumeSubjectApiRateLimit: mocks.rate,
  rateLimitJsonResponse: () => new Response("limited", { status: 429 }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/openai", () => ({ transcribeClinicalAskAudio: mocks.transcribe }));
vi.mock("@/lib/logger", () => ({ logger: { warn: mocks.warn, error: mocks.error } }));

import { POST } from "@/app/api/speech/transcribe/route";
import { maxClinicalAskAudioBytes } from "@/lib/validation/speech-transcription-request";

function request(audio?: File, durationMs?: string) {
  const form = new FormData();
  if (audio) form.set("audio", audio);
  if (durationMs !== undefined) form.set("durationMs", durationMs);
  return new Request("http://local.test/api/speech/transcribe", { method: "POST", body: form });
}
function abortableRequest(signal: AbortSignal) {
  const form = new FormData();
  form.set("audio", file());
  return new Request("http://local.test/api/speech/transcribe", { method: "POST", body: form, signal });
}
const file = (type = "audio/webm", bytes = 2, name = "private-name.webm") =>
  new File([new Uint8Array(bytes)], name, { type });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.enabled.mockReturnValue(true);
  mocks.access.mockResolvedValue({ authenticated: true, rateLimitSubject: { kind: "owner", ownerId: "owner-a" } });
  mocks.rate.mockResolvedValue({ limited: false });
  mocks.transcribe.mockResolvedValue({ transcript: "Synthetic transcript", model: "gpt-4o-mini-transcribe" });
});

describe("POST /api/speech/transcribe", () => {
  it("answers 404 before access, the rate limiter, or the provider when Clinical Ask is off", async () => {
    mocks.enabled.mockReturnValue(false);
    const response = await POST(request(file(), "1000"));
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-type")).not.toContain("text/event-stream");
    expect(mocks.access).not.toHaveBeenCalled();
    expect(mocks.rate).not.toHaveBeenCalled();
    expect(mocks.transcribe).not.toHaveBeenCalled();
    // A designed 404 is not a server fault: it must not write an error-level
    // log line (which the Sentry Logs allowlist would forward) per probe.
    expect(mocks.error).not.toHaveBeenCalled();
    expect(mocks.warn).not.toHaveBeenCalled();
  });

  it.each([
    "audio/webm",
    "audio/webm;codecs=opus",
    "audio/ogg",
    "audio/ogg;codecs=opus",
    "audio/mp4",
    "audio/mpeg",
    "audio/wav",
  ])("accepts %s without storage", async (type) => {
    const response = await POST(request(file(type), "1000"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      transcript: "Synthetic transcript",
      durationMs: 1000,
    });
    expect(mocks.transcribe).toHaveBeenCalledWith(expect.any(File), expect.any(AbortSignal), 30_000);
  });

  it.each([
    [undefined, undefined, 400],
    [file("text/plain"), undefined, 415],
    [file("audio/webm", 0), undefined, 400],
    [file("audio/webm", maxClinicalAskAudioBytes + 1), undefined, 413],
    [file(), "60001", 400],
  ] as const)("rejects invalid audio", async (audio, duration, status) => {
    expect((await POST(request(audio, duration))).status).toBe(status);
    expect(mocks.transcribe).not.toHaveBeenCalled();
  });

  it("refuses a signed-out caller before the rate limiter or the provider", async () => {
    mocks.access.mockResolvedValue({ authenticated: false, rateLimitSubject: { kind: "ip", key: "ip-a" } });
    const response = await POST(request(file()));
    expect(response.status).toBe(401);
    expect(mocks.rate).not.toHaveBeenCalled();
    expect(mocks.transcribe).not.toHaveBeenCalled();
  });

  it("authenticates and rate limits before transcription", async () => {
    mocks.rate.mockResolvedValue({ limited: true });
    expect((await POST(request(file()))).status).toBe(429);
    expect(mocks.access).toHaveBeenCalled();
    expect(mocks.rate).toHaveBeenCalledWith(
      expect.objectContaining({ bucket: "speech_transcription", allowInMemoryFallbackOnUnavailable: false }),
    );
    expect(mocks.transcribe).not.toHaveBeenCalled();
  });

  it("fails safely without logging audio, names, accounts, or clinical text", async () => {
    mocks.transcribe.mockRejectedValue(new Error("provider detail"));
    const response = await POST(request(file(), "200"));
    expect(response.status).toBe(502);
    const logged = JSON.stringify([mocks.warn.mock.calls, mocks.error.mock.calls]);
    expect(logged).not.toContain("private-name");
    expect(logged).not.toContain("owner-a");
    expect(logged).not.toContain("Synthetic transcript");
    expect(logged).not.toContain("provider detail");
  });

  it("stops before the provider when the client has aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    expect((await POST(abortableRequest(controller.signal))).status).toBe(499);
    expect(mocks.transcribe).not.toHaveBeenCalled();
  });

  it("maps provider timeout to a generic no-store failure", async () => {
    mocks.transcribe.mockRejectedValue(new DOMException("timed out", "TimeoutError"));
    const response = await POST(request(file()));
    expect(response.status).toBe(502);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).not.toContain("timed out");
  });
});
