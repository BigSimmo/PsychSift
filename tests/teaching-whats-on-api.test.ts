import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), auth: vi.fn(), demo: vi.fn(), rate: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/supabase/auth", () => {
  class AuthenticationError extends Error {}
  return {
    requireAuthenticatedUser: mocks.auth,
    AuthenticationError,
    unauthorizedResponse: () => Response.json({ message: "Sign in" }, { status: 401 }),
  };
});
vi.mock("@/lib/env", () => ({ isDemoMode: mocks.demo }));
vi.mock("@/lib/api-rate-limit", () => ({
  consumeSubjectApiRateLimit: mocks.rate,
  allowRateLimitInMemoryFallbackOnUnavailable: () => false,
  rateLimitJsonResponse: (message: string) => Response.json({ message, code: "rate_limited" }, { status: 429 }),
}));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { GET as resourcesGet } from "@/app/api/teaching/resources/route";
import { POST as resourceTeamPost } from "@/app/api/teaching/resources/services/[serviceId]/route";
import { GET as whatsOnGet, POST as whatsOnPost } from "@/app/api/teaching/whats-on/route";
import { demoDocuments } from "@/lib/demo-data";
import { AuthenticationError } from "@/lib/supabase/auth";
import {
  DEMO_OLDER_ADULT_SERVICE_ID,
  DEMO_TEACHING_SERVICE_ID,
  DEMO_YOUTH_SERVICE_ID,
  demoOccurrenceId,
  demoTeachingSessionDetail,
} from "@/lib/teaching/demo-programme";
import {
  collectionReadResultSchema,
  resourcesForSessionSchema,
  resourcesForWeekSchema,
  sessionDetailSchema,
  whatsOnReadResultSchema,
  type ResourceRow,
} from "@/lib/teaching/model";

const actor = "11111111-1111-4111-8111-111111111111";
const serviceId = "22222222-2222-4222-8222-222222222222";
const occurrenceId = "33333333-3333-4333-8333-333333333333";
const context = { params: Promise.resolve({ serviceId }) };

function get(path: string) {
  return new Request(`https://psychiatry.example${path}`);
}
function post(path: string, body: unknown) {
  return new Request(`https://psychiatry.example${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.demo.mockReturnValue(false);
  mocks.auth.mockResolvedValue({ id: actor });
  mocks.rate.mockResolvedValue({ limited: false });
});

describe("GET /api/teaching/whats-on", () => {
  it("reads the week with no team named, on the whats-on RPC", async () => {
    mocks.rpc.mockResolvedValue({ data: { healthServices: [], sessions: [] }, error: null });
    const response = await whatsOnGet(get("/api/teaching/whats-on?weekStart=2026-09-28"));
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("teaching_whats_on_command", {
      p_actor_id: actor,
      p_service_id: null,
      p_action: "whats_on.read",
      p_payload: { weekStart: "2026-09-28" },
    });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store, max-age=0");
  });

  it("refuses a signed-out caller before any database call", async () => {
    mocks.auth.mockRejectedValue(new AuthenticationError());
    const response = await whatsOnGet(get("/api/teaching/whats-on?weekStart=2026-09-28"));
    expect(response.status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("refuses a week that is not a real date before any database call", async () => {
    const response = await whatsOnGet(get("/api/teaching/whats-on?weekStart=2026-02-30"));
    expect(response.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe("POST /api/teaching/whats-on", () => {
  it("marks a visitor's attendance and never records a made-up method", async () => {
    mocks.rpc.mockResolvedValue({
      data: { occurrenceId, method: "self", recordedAt: "2026-09-30T05:00:00Z" },
      error: null,
    });
    const response = await whatsOnPost(post("/api/teaching/whats-on", { action: "whats_on.attend", occurrenceId }));
    expect(response.status).toBe(200);
    expect(mocks.rpc.mock.calls[0][1]).toMatchObject({ p_service_id: null, p_action: "whats_on.attend" });
    expect((await response.json()).method).toBe("self");
  });

  it("fails closed if the database ever answered attendance with a fourth method", async () => {
    mocks.rpc.mockResolvedValue({
      data: { occurrenceId, method: "visitor", recordedAt: "2026-09-30T05:00:00Z" },
      error: null,
    });
    const response = await whatsOnPost(post("/api/teaching/whats-on", { action: "whats_on.attend", occurrenceId }));
    expect(response.status).toBe(503);
  });

  it("adds a session to the week with the action name kept out of the payload", async () => {
    mocks.rpc.mockResolvedValue({ data: { inMyWeek: true, extra: "dropped" }, error: null });
    const response = await whatsOnPost(post("/api/teaching/whats-on", { action: "week_add.set", occurrenceId }));
    expect(response.status).toBe(200);
    expect(mocks.rpc.mock.calls[0][1]).toEqual({
      p_actor_id: actor,
      p_service_id: null,
      p_action: "week_add.set",
      p_payload: { occurrenceId },
    });
    expect(await response.json()).toEqual({ inMyWeek: true });
  });

  it("maps role_denied through the existing error map, and spends the shared rate-limit bucket", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "teaching_role_denied" } });
    const response = await whatsOnPost(
      post("/api/teaching/whats-on", { action: "resource_save.set", resourceId: occurrenceId }),
    );
    expect(response.status).toBe(403);
    expect(mocks.rate).toHaveBeenCalledWith(expect.objectContaining({ bucket: "teaching" }));
  });
});

describe("GET /api/teaching/resources", () => {
  it("reads a session's materials by occurrence id", async () => {
    mocks.rpc.mockResolvedValue({ data: { items: [] }, error: null });
    const response = await resourcesGet(
      get(`/api/teaching/resources?action=resources.read&occurrenceId=${occurrenceId}`),
    );
    expect(response.status).toBe(200);
    expect(mocks.rpc.mock.calls[0][1]).toMatchObject({ p_action: "resources.read", p_payload: { occurrenceId } });
  });

  it("reads a built-in collection by name, not by id", async () => {
    mocks.rpc.mockResolvedValue({ data: { collection: null, sections: [], items: [] }, error: null });
    const response = await resourcesGet(get("/api/teaching/resources?action=collection.read&builtIn=saved"));
    expect(response.status).toBe(200);
    expect(mocks.rpc.mock.calls[0][1].p_payload).toEqual({ builtIn: "saved" });
  });

  it("never passes a service id, so a whole-service read cannot be asked for here", async () => {
    mocks.rpc.mockResolvedValue({
      data: { forThisWeek: [], collections: [], recordingsCount: 0, savedCount: 0 },
      error: null,
    });
    const response = await resourcesGet(
      get(`/api/teaching/resources?action=resources.read&weekStart=2026-09-28&serviceId=${serviceId}`),
    );
    expect(response.status).toBe(200);
    expect(mocks.rpc.mock.calls[0][1]).toMatchObject({ p_service_id: null, p_payload: { weekStart: "2026-09-28" } });
  });
});

describe("POST /api/teaching/resources/services/[serviceId]", () => {
  it("adds a slides link for the named service's session, ticked for no patient details", async () => {
    mocks.rpc.mockResolvedValue({ data: { resourceId: occurrenceId }, error: null });
    const response = await resourceTeamPost(
      post(`/api/teaching/resources/services/${serviceId}`, {
        action: "resource.add",
        title: "Exam prep slides",
        kind: "slides",
        url: "https://example.org/slides",
        occurrenceId,
        noPatientDetails: true,
      }),
      context,
    );
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("teaching_whats_on_command", {
      p_actor_id: actor,
      p_service_id: serviceId,
      p_action: "resource.add",
      p_payload: {
        title: "Exam prep slides",
        kind: "slides",
        url: "https://example.org/slides",
        occurrenceId,
        noPatientDetails: true,
      },
    });
  });

  it("refuses slides with no session before any database call (master plan R27)", async () => {
    const response = await resourceTeamPost(
      post(`/api/teaching/resources/services/${serviceId}`, {
        action: "resource.add",
        title: "Exam prep slides",
        kind: "slides",
        url: "https://example.org/slides",
        noPatientDetails: true,
      }),
      context,
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ message: "Slides belong to one session. Choose the session." });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("refuses to open a series without a health service, mapped to a plain message", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "teaching_no_health_service" } });
    const response = await resourceTeamPost(
      post(`/api/teaching/resources/services/${serviceId}`, {
        action: "series.set_open_to",
        seriesId: occurrenceId,
        openTo: "health_service",
      }),
      context,
    );
    expect(response.status).toBe(409);
    // Master plan R18: "service", never "team".
    expect(await response.json()).toMatchObject({
      message: "Your service has no health service yet. Ask for it to be set.",
    });
  });

  it("refuses a service id that is not a uuid", async () => {
    const response = await resourceTeamPost(
      post("/api/teaching/resources/services/not-a-uuid", { action: "resource.remove", resourceId: occurrenceId }),
      { params: Promise.resolve({ serviceId: "not-a-uuid" }) },
    );
    expect(response.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("never writes in demo mode", async () => {
    mocks.demo.mockReturnValue(true);
    const response = await resourceTeamPost(
      post(`/api/teaching/resources/services/${serviceId}`, { action: "resource.remove", resourceId: occurrenceId }),
      context,
    );
    expect(response.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe("the made-up demo (master plan R8)", () => {
  // Wednesday 30 September 2026, 09:00 in Perth; the week starts Monday 28 September.
  const weekStart = "2026-09-28";

  beforeEach(() => {
    mocks.demo.mockReturnValue(true);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-30T01:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function expectMadeUp(items: ResourceRow[]) {
    const demoLibrary = new Set(demoDocuments.map((document) => document.id));
    for (const item of items) {
      expect(item.title.startsWith("Demo ")).toBe(false);
      if (item.url) expect(new URL(item.url).origin).toBe("https://example.org");
      if (item.libraryDocumentId) expect(demoLibrary.has(item.libraryDocumentId)).toBe(true);
    }
  }

  it("shows the demo service's week plus three sessions two other made-up services open to it", async () => {
    const response = await whatsOnGet(get(`/api/teaching/whats-on?weekStart=${weekStart}`));
    expect(response.status).toBe(200);
    const read = whatsOnReadResultSchema.parse(await response.json());
    expect(read.healthServices).toEqual(["demo"]);
    const open = read.sessions.filter((session) => !session.own);
    // The v5 mock-up: "3 sessions from other services are open to you".
    expect(open).toHaveLength(3);
    expect(new Set(open.map((session) => session.serviceId))).toEqual(
      new Set([DEMO_OLDER_ADULT_SERVICE_ID, DEMO_YOUTH_SERVICE_ID]),
    );
    expect(new Set(open.map((session) => session.teamName))).toEqual(new Set(["Older adult service", "Youth service"]));
    for (const session of open) expect(session.inMyWeek).toBe(false);
    const own = read.sessions.filter((session) => session.own);
    expect(own.length).toBeGreaterThan(0);
    for (const session of own) {
      expect(session.serviceId).toBe(DEMO_TEACHING_SERVICE_ID);
      expect(session.inMyWeek).toBe(true);
    }
    for (const session of read.sessions) {
      expect(session.title.startsWith("Demo ")).toBe(false);
      expect(session.startsAt >= "2026-09-27T16:00:00.000Z" && session.startsAt < "2026-10-04T16:00:00.000Z").toBe(
        true,
      );
      if (session.joinUrl) expect(new URL(session.joinUrl).origin).toBe("https://example.org");
    }
    const starts = read.sessions.map((session) => session.startsAt);
    expect([...starts].sort()).toEqual(starts);
    // "My level" has something to filter on.
    expect(new Set(read.sessions.map((session) => session.audience)).size).toBeGreaterThan(2);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("opens another service's session as a read-only visitor view with no presenter name", () => {
    const detail = sessionDetailSchema.parse(demoTeachingSessionDetail(demoOccurrenceId(11, "2026-09-30")));
    expect(detail.visitor).toBe(true);
    expect(detail.presenterName).toBeNull();
    expect(detail.canShowCode).toBe(false);
    expect(detail.serviceId).toBe(DEMO_OLDER_ADULT_SERVICE_ID);
    const own = sessionDetailSchema.parse(demoTeachingSessionDetail(demoOccurrenceId(23, "2026-09-30")));
    expect(own.visitor).toBe(false);
  });

  it("serves the week's resources, collections and counts, with a missed recording as catch-up", async () => {
    const response = await resourcesGet(get(`/api/teaching/resources?action=resources.read&weekStart=${weekStart}`));
    expect(response.status).toBe(200);
    const read = resourcesForWeekSchema.parse(await response.json());
    // The v5 mock-up's four materials, each on one of the week's own sessions, plus the ended conference's recording.
    const materials = read.forThisWeek.filter((item) => item.kind !== "recording");
    expect(materials.map((item) => item.title).sort()).toEqual([
      "Case presentation handout",
      "Journal club slides",
      "Psychotherapy reading",
      "Workshop checklist",
    ]);
    for (const item of materials) {
      expect(item.occurrenceId).not.toBeNull();
      expect(item.catchUp).toBe(false);
    }
    const recordings = read.forThisWeek.filter((item) => item.kind === "recording");
    expect(recordings).toHaveLength(1);
    expect(recordings[0].catchUp).toBe(true);
    const starts = read.forThisWeek.map((item) => item.occurrenceId?.slice(-12) ?? "");
    expect([...starts].sort()).toEqual(starts);
    expect(read.collections.map((collection) => [collection.name, collection.count])).toEqual([
      ["Case series", 14],
      ["Journal club", 22],
      ["Exam prep", 9],
      ["Supervision", 6],
      ["Handouts", 31],
      ["Workshops", 5],
    ]);
    expect(read.recordingsCount).toBe(4);
    expect(read.savedCount).toBe(2);
    expectMadeUp(read.forThisWeek);
    // Slides always name one session (master plan R27).
    for (const item of read.forThisWeek.filter((entry) => entry.kind === "slides"))
      expect(item.occurrenceId).not.toBeNull();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("serves one session's own and series materials, and refuses a session the demo does not have", async () => {
    const conference = demoOccurrenceId(3, "2026-09-28");
    const response = await resourcesGet(
      get(`/api/teaching/resources?action=resources.read&occurrenceId=${conference}`),
    );
    expect(response.status).toBe(200);
    const read = resourcesForSessionSchema.parse(await response.json());
    expect(read.items.map((item) => item.kind)).toEqual(["recording"]);
    const missing = await resourcesGet(
      get(`/api/teaching/resources?action=resources.read&occurrenceId=${occurrenceId}`),
    );
    expect(missing.status).toBe(404);
  });

  it("serves Exam prep by section, the built-in Recordings and Saved, and nothing else", async () => {
    const week = resourcesForWeekSchema.parse(
      await (await resourcesGet(get(`/api/teaching/resources?action=resources.read&weekStart=${weekStart}`))).json(),
    );
    const examPrep = week.collections.find((collection) => collection.name === "Exam prep");
    const exam = collectionReadResultSchema.parse(
      await (
        await resourcesGet(get(`/api/teaching/resources?action=collection.read&collectionId=${examPrep?.collectionId}`))
      ).json(),
    );
    expect(exam.collection?.name).toBe("Exam prep");
    expect(exam.sections.map((section) => section.name)).toEqual(["Written exam", "Clinical exam"]);
    expect(exam.items).toHaveLength(9);
    for (const item of exam.items) expect(exam.sections.map((s) => s.sectionId)).toContain(item.sectionId);
    expectMadeUp(exam.items);

    const saved = collectionReadResultSchema.parse(
      await (await resourcesGet(get("/api/teaching/resources?action=collection.read&builtIn=saved"))).json(),
    );
    expect(saved.collection).toBeNull();
    expect(saved.items.map((item) => item.title)).toEqual(["Formulation seminar slides", "Exam tips handout"]);
    const recordings = collectionReadResultSchema.parse(
      await (await resourcesGet(get("/api/teaching/resources?action=collection.read&builtIn=recordings"))).json(),
    );
    expect(recordings.items).toHaveLength(4);
    for (const item of recordings.items) expect(item.kind).toBe("recording");
    expectMadeUp(recordings.items);
    // Every collection page holds as many items as its tile says.
    for (const collection of week.collections) {
      const read = collectionReadResultSchema.parse(
        await (
          await resourcesGet(
            get(`/api/teaching/resources?action=collection.read&collectionId=${collection.collectionId}`),
          )
        ).json(),
      );
      expect(read.items).toHaveLength(collection.count);
      expectMadeUp(read.items);
    }

    const unknown = await resourcesGet(get(`/api/teaching/resources?action=collection.read&collectionId=${actor}`));
    expect(unknown.status).toBe(404);
  });

  it("refuses personal writes in the demo, like every other Teaching write", async () => {
    const response = await whatsOnPost(post("/api/teaching/whats-on", { action: "week_add.set", occurrenceId }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "demo_mode_unavailable" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
