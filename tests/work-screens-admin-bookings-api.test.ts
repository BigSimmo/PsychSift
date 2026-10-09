import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const ACTOR = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const COURSE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const TEAM = "11111111-1111-4111-8111-111111111111";

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

type RpcAnswer = { data?: unknown; error?: { code?: string; message?: string } | null };

function mockServer(
  answers: Record<string, RpcAnswer> = {},
  options: { demo?: boolean; signedIn?: boolean; limited?: boolean } = {},
) {
  const rpc = vi.fn(async (fn: string) => {
    const answer = answers[fn] ?? { error: { code: "PGRST202", message: "function not found" } };
    return { data: answer.data ?? null, error: answer.error ?? null };
  });
  const from = vi.fn(() => {
    throw new Error("bookings routes must not query tables directly");
  });
  vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc, from }) }));
  class AuthenticationError extends Error {}
  vi.doMock("@/lib/supabase/auth", () => ({
    AuthenticationError,
    requireAuthenticatedUser: vi.fn(async () => {
      if (options.signedIn === false) throw new AuthenticationError("no session");
      return { id: ACTOR, appMetadata: {} };
    }),
    unauthorizedResponse: () => new Response(JSON.stringify({ code: "authentication_required" }), { status: 401 }),
  }));
  const consume = vi.fn(async () => ({ limited: Boolean(options.limited) }));
  vi.doMock("@/lib/api-rate-limit", () => ({
    allowRateLimitInMemoryFallbackOnUnavailable: () => true,
    consumeSubjectApiRateLimit: consume,
    rateLimitJsonResponse: () => new Response("limited", { status: 429 }),
  }));
  vi.doMock("@/lib/env", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/env")>()),
    isDemoMode: () => Boolean(options.demo),
  }));
  return { rpc, from, consume };
}

function post(url: string, body: unknown) {
  return new Request(`http://local.test${url}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const READ_ROWS = {
  courses: [
    {
      id: COURSE,
      kind: "requirement",
      title: "Fire safety",
      about: "",
      date: "2099-03-02",
      startTime: "09:00",
      endTime: "10:00",
      location: "Main hall",
      capacity: 10,
      closesOn: null,
      organiser: "Administration",
      renewal: null,
      waitlist: false,
      status: "posted",
      updatedAt: "2026-10-01T00:00:00Z",
      change: null,
      serviceId: null,
      manage: true,
    },
  ],
  bookings: [
    { id: "b1", courseId: COURSE, person: "Dr Lee", self: true, status: "booked", at: "2026-10-02T00:00:00Z" },
  ],
  organiser: { administrator: true, teams: [] },
};

function futureDraft(overrides: Record<string, unknown> = {}) {
  return {
    kind: "course",
    title: "Basic life support",
    about: "Bring your badge.",
    date: "2099-03-02",
    startTime: "13:00",
    endTime: "16:30",
    location: "Education Centre",
    capacity: "12",
    closesOn: "",
    waitlist: true,
    renewal: "basic life support",
    ...overrides,
  };
}

describe("GET /api/work/bookings", () => {
  it("answers the reader's courses and bookings, read as the session user, never cached", async () => {
    const { rpc, consume } = mockServer({ work_bookings_read: { data: READ_ROWS } });
    const { GET } = await import("@/app/api/work/bookings/route");
    const response = await GET(new Request("http://local.test/api/work/bookings"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    const body = await response.json();
    expect(body.status).toBe("ready");
    expect(body.state.courses[0]).toMatchObject({ id: COURSE, kind: "requirement", status: "posted" });
    expect(body.state.bookings[0]).toMatchObject({ person: "Dr Lee", self: true });
    expect(body.managed).toEqual([{ courseId: COURSE, serviceId: null }]);
    expect(rpc).toHaveBeenCalledWith("work_bookings_read", { p_actor_id: ACTOR });
    expect(consume).toHaveBeenCalledWith(expect.objectContaining({ bucket: "work_bookings" }));
  });

  it.each(["PGRST202", "PGRST205", "42P01"])(
    "answers 200 not-set-up when the database says %s (tables not there yet)",
    async (code) => {
      mockServer({ work_bookings_read: { error: { code, message: "missing" } } });
      const { GET } = await import("@/app/api/work/bookings/route");
      const response = await GET(new Request("http://local.test/api/work/bookings"));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: "not-set-up" });
    },
  );

  it("answers not-set-up in demo mode without touching the database", async () => {
    const { rpc } = mockServer({}, { demo: true });
    const { GET } = await import("@/app/api/work/bookings/route");
    const response = await GET(new Request("http://local.test/api/work/bookings"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "not-set-up" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a signed-out reader", async () => {
    const { rpc } = mockServer({ work_bookings_read: { data: READ_ROWS } }, { signedIn: false });
    const { GET } = await import("@/app/api/work/bookings/route");
    const response = await GET(new Request("http://local.test/api/work/bookings"));
    expect(response.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("is 503 on another database failure, without its text", async () => {
    mockServer({ work_bookings_read: { error: { code: "XX000", message: "internal secret detail" } } });
    const { GET } = await import("@/app/api/work/bookings/route");
    const response = await GET(new Request("http://local.test/api/work/bookings"));
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("secret");
  });

  it("is 429 when rate limited", async () => {
    const { rpc } = mockServer({ work_bookings_read: { data: READ_ROWS } }, { limited: true });
    const { GET } = await import("@/app/api/work/bookings/route");
    expect((await GET(new Request("http://local.test/api/work/bookings"))).status).toBe(429);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("POST /api/work/bookings", () => {
  it("books as the session user, ignoring any owner or name the body sends", async () => {
    const { rpc } = mockServer({ work_book_course: { data: { id: "b2", outcome: "waitlisted", position: 2 } } });
    const { POST } = await import("@/app/api/work/bookings/route");
    const response = await POST(
      post("/api/work/bookings", { action: "book", courseId: COURSE, displayName: "Dr Lee", ownerId: OTHER }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, action: "book", id: "b2", outcome: "waitlisted", position: 2 });
    expect(rpc).toHaveBeenCalledWith("work_book_course", {
      p_actor_id: ACTOR,
      p_course_id: COURSE,
    });
  });

  it("cancels a place, or leaves the waitlist", async () => {
    const { rpc } = mockServer({ work_cancel_course_booking: { data: { cancelled: "waitlisted", promoted: 0 } } });
    const { POST } = await import("@/app/api/work/bookings/route");
    const response = await POST(post("/api/work/bookings", { action: "cancel", courseId: COURSE }));
    expect(await response.json()).toEqual({ ok: true, action: "cancel", cancelled: "waitlisted", promoted: 0 });
    expect(rpc).toHaveBeenCalledWith("work_cancel_course_booking", { p_actor_id: ACTOR, p_course_id: COURSE });
  });

  it("passes on the SQL refusal for a full course", async () => {
    mockServer({ work_book_course: { error: { code: "P0001", message: "work_bookings_full" } } });
    const { POST } = await import("@/app/api/work/bookings/route");
    const response = await POST(post("/api/work/bookings", { action: "book", courseId: COURSE }));
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("work_bookings_full");
  });

  it("is 503 work_bookings_not_set_up for a write before the tables land", async () => {
    mockServer();
    const { POST } = await import("@/app/api/work/bookings/route");
    const response = await POST(post("/api/work/bookings", { action: "book", courseId: COURSE }));
    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe("work_bookings_not_set_up");
  });

  it("refuses an unknown action or a malformed course id before the database", async () => {
    const { rpc } = mockServer();
    const { POST } = await import("@/app/api/work/bookings/route");
    expect((await POST(post("/api/work/bookings", { action: "attend", courseId: COURSE }))).status).toBe(400);
    expect((await POST(post("/api/work/bookings", { action: "book", courseId: "not-an-id" }))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses writes in demo mode", async () => {
    const { rpc } = mockServer({}, { demo: true });
    const { POST } = await import("@/app/api/work/bookings/route");
    const response = await POST(post("/api/work/bookings", { action: "book", courseId: COURSE }));
    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("POST /api/work/courses", () => {
  it("posts a checked draft for a team as the session user", async () => {
    const { rpc } = mockServer({
      work_save_course: { data: { id: COURSE, status: "posted", changes: [], calendarsUpdated: 0, promoted: 0 } },
    });
    const { POST } = await import("@/app/api/work/courses/route");
    const response = await POST(
      post("/api/work/courses", {
        action: "save",
        courseId: null,
        serviceId: TEAM,
        organiser: "Medical Education",
        draft: futureDraft(),
        post: true,
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, action: "save", id: COURSE, status: "posted" });
    expect(rpc).toHaveBeenCalledWith(
      "work_save_course",
      expect.objectContaining({ p_actor_id: ACTOR, p_service_id: TEAM, p_capacity: 12, p_post: true }),
    );
  });

  it("refuses a draft the form would refuse, with field messages, before the database", async () => {
    const { rpc } = mockServer();
    const { POST } = await import("@/app/api/work/courses/route");
    const response = await POST(
      post("/api/work/courses", {
        action: "save",
        courseId: null,
        serviceId: null,
        organiser: "Administration",
        draft: futureDraft({ date: "2020-01-01", endTime: "12:00", capacity: "0" }),
        post: true,
      }),
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("work_bookings_invalid_course");
    expect(Object.keys(body.fields).sort()).toEqual(["capacity", "date", "endTime"]);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a past closing day on a new course, but leaves an edit's saved one for SQL to check", async () => {
    const { rpc } = mockServer({
      work_save_course: { data: { id: COURSE, status: "posted", changes: [], calendarsUpdated: 0, promoted: 0 } },
    });
    const { POST } = await import("@/app/api/work/courses/route");
    const draft = futureDraft({ closesOn: "2020-01-01" });
    const fresh = await POST(
      post("/api/work/courses", { action: "save", courseId: null, serviceId: null, organiser: "A", draft, post: true }),
    );
    expect(fresh.status).toBe(400);
    expect((await fresh.json()).fields).toHaveProperty("closesOn");
    expect(rpc).not.toHaveBeenCalled();

    const edit = await POST(
      post("/api/work/courses", {
        action: "save",
        courseId: COURSE,
        serviceId: null,
        organiser: "A",
        draft,
        post: true,
      }),
    );
    expect(edit.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("work_save_course", expect.objectContaining({ p_closes_on: "2020-01-01" }));
  });

  it("passes on a refused permission from SQL", async () => {
    mockServer({ work_save_course: { error: { code: "P0001", message: "work_bookings_role_denied" } } });
    const { POST } = await import("@/app/api/work/courses/route");
    const response = await POST(
      post("/api/work/courses", {
        action: "save",
        courseId: null,
        serviceId: null,
        organiser: "A",
        draft: futureDraft(),
        post: true,
      }),
    );
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("work_bookings_role_denied");
  });

  it("cancels a course", async () => {
    const { rpc } = mockServer({ work_cancel_course: { data: { id: COURSE, calendarsUpdated: 3 } } });
    const { POST } = await import("@/app/api/work/courses/route");
    const response = await POST(post("/api/work/courses", { action: "cancel", courseId: COURSE }));
    expect(await response.json()).toEqual({ ok: true, action: "cancel", id: COURSE, calendarsUpdated: 3 });
    expect(rpc).toHaveBeenCalledWith("work_cancel_course", { p_actor_id: ACTOR, p_course_id: COURSE });
  });

  it("refuses text that looks like patient details", async () => {
    const { rpc } = mockServer();
    const { POST } = await import("@/app/api/work/courses/route");
    const response = await POST(
      post("/api/work/courses", {
        action: "save",
        courseId: null,
        serviceId: null,
        organiser: "A",
        draft: futureDraft({ about: "Patient John Smith, MRN 1234567, DOB 01/02/1980" }),
        post: true,
      }),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).fields).toHaveProperty("about");
    expect(rpc).not.toHaveBeenCalled();
  });
});
