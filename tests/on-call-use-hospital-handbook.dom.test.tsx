/** @vitest-environment jsdom */
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  state: { status: "authenticated", authEpoch: 1 } as { status: string; authEpoch: number },
}));
vi.mock("@/lib/supabase/client", () => ({ useAuthSession: () => auth.state }));

import { ON_CALL_WITHDRAWN_MESSAGE, useHospitalHandbook } from "@/components/on-call/use-hospital-handbook";
import {
  clearOnCallDeviceState,
  onCallHandbookSeenStorageKey,
  onCallHospitalChoiceStorageKey,
  readOnCallEditorFlag,
} from "@/lib/on-call/device-state-keys";
import { readOnCallEmergencyPinned } from "@/lib/on-call/emergency-pin-memory";
import { HANDBOOK_REPORT_REASONS } from "@/lib/on-call/handbook-reports";
import type { ServiceDetail, ServiceEntry, ServiceSummary } from "@/lib/on-call/service-model";

const SERVICE = "20000000-0000-4000-8000-000000000001";
const SITE_A = "30000000-0000-4000-8000-00000000000a";
const SITE_B = "30000000-0000-4000-8000-00000000000b";
const summary: ServiceSummary = {
  id: SERVICE,
  name: "Synthetic Hospital Service",
  role: "member",
  clinicalReviewer: false,
  sites: [
    { id: SITE_A, name: "Site A" },
    { id: SITE_B, name: "Site B" },
  ],
};

function content(over: Partial<ServiceEntry["content"]> = {}): ServiceEntry["content"] {
  return {
    siteId: SITE_A,
    section: "contacts",
    kind: "operational",
    title: "Medicine: Registrar on call",
    body: "",
    phone: "(08) 9000 0001",
    sources: [],
    orientationPhase: "first_shift",
    ...over,
  };
}
function entry(
  id: string,
  published: ServiceEntry["content"] | null,
  draft: ServiceEntry["content"] = published ?? content(),
): ServiceEntry {
  return {
    id,
    revision: 2,
    publishedRevision: published ? 1 : null,
    content: draft,
    publishedContent: published,
    status: published ? "published" : "draft",
    authorId: null,
    reviewedBy: null,
    reviewedAt: null,
    reviewComment: "",
    updatedAt: "2026-09-20T04:00:00.000Z",
  };
}
function detail(entries: ServiceEntry[]): ServiceDetail {
  return {
    service: { id: SERVICE, name: summary.name },
    membership: { role: "member", clinicalReviewer: false },
    sites: summary.sites,
    entries,
    members: [],
    invitations: [],
    reports: [],
    orientation: [],
  };
}
function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}
function getCalls(url: string): number {
  return vi
    .mocked(globalThis.fetch)
    .mock.calls.filter(([input, init]) => init?.method !== "POST" && String(input) === url).length;
}

let routes: Record<string, () => Response>;
beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "false");
  auth.state = { status: "authenticated", authEpoch: 1 };
  window.localStorage.clear();
  clearOnCallDeviceState(); // also drops the hook's in-memory memo between tests
  routes = {
    "/api/on-call/services": () => json({ services: [summary] }),
    [`/api/on-call/services/${SERVICE}?siteId=${SITE_A}`]: () => json(detail([entry("e1", content())])),
  };
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    if (init?.method === "POST") return json({ reportId: "r1" });
    const url = typeof input === "string" ? input : input instanceof URL ? input.pathname + input.search : input.url;
    return routes[url]?.() ?? json({ error: "not found" }, 404);
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("useHospitalHandbook", () => {
  it("serves the in-memory sample hospital, with no request and nothing to dial, when there is no session", () => {
    auth.state = { status: "signed_out", authEpoch: 1 };
    const { result } = renderHook(() => useHospitalHandbook());
    expect(result.current.status).toBe("ready");
    expect(result.current.demo).toBe(true);
    expect(result.current.items.length).toBeGreaterThan(0);
    for (const item of result.current.items) {
      expect(item.dial.tel).toBeNull();
      expect(item.mobileDial?.tel ?? null).toBeNull();
    }
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("serves the same sample when the session has expired", () => {
    auth.state = { status: "expired", authEpoch: 1 };
    const { result } = renderHook(() => useHospitalHandbook());
    expect(result.current.status).toBe("ready");
    expect(result.current.demo).toBe(true);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("treats a 401 from a session that looked live as expired", async () => {
    routes["/api/on-call/services"] = () => json({ error: "auth" }, 401);
    const { result } = renderHook(() => useHospitalHandbook());
    await waitFor(() => expect(result.current.status).toBe("expired"));
  });

  it("says when the account is in no hospital handbook", async () => {
    routes["/api/on-call/services"] = () => json({ services: [] });
    const { result } = renderHook(() => useHospitalHandbook());
    await waitFor(() => expect(result.current.status).toBe("no-service"));
  });

  it("is unavailable, with a retry, when the handbook cannot be read", async () => {
    let fail = true;
    routes["/api/on-call/services"] = () => (fail ? json({ error: "down" }, 503) : json({ services: [summary] }));
    const { result } = renderHook(() => useHospitalHandbook());
    await waitFor(() => expect(result.current.status).toBe("unavailable"));
    fail = false;
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.status).toBe("ready"));
  });

  it("keeps published staff names in memory without saving them in device storage", async () => {
    const named = content({
      section: "cover",
      kind: "clinical",
      sources: [{ label: "Rota", url: "https://example.org/rota" }],
      cover: { staffName: "Dr Alex Example", grade: "registrar", window: { start: "00:00", end: "23:59" } },
    });
    routes[`/api/on-call/services/${SERVICE}?siteId=${SITE_A}`] = () => json(detail([entry("named-cover", named)]));
    const { result } = renderHook(() => useHospitalHandbook());
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(JSON.stringify(result.current)).toContain("Dr Alex Example");
    expect(JSON.stringify(window.localStorage)).not.toContain("Dr Alex Example");
    expect(JSON.stringify(window.sessionStorage)).not.toContain("Dr Alex Example");
  });

  it("loads the first service and site and exposes only published content", async () => {
    routes[`/api/on-call/services/${SERVICE}?siteId=${SITE_A}`] = () =>
      json(
        detail([
          entry("e1", content()),
          entry("e2", null, content({ title: "Draft only" })),
          entry("e3", content({ title: "ICU: Registrar" }), content({ title: "Editor's unpublished edit" })),
        ]),
      );
    const { result } = renderHook(() => useHospitalHandbook());
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.serviceName).toBe("Synthetic Hospital Service");
    expect(result.current.siteName).toBe("Site A");
    expect(result.current.items.map((item) => item.title).sort()).toEqual([
      "ICU: Registrar",
      "Medicine: Registrar on call",
    ]);
  });

  it("remembers the chosen site on this device and reloads for it", async () => {
    routes[`/api/on-call/services/${SERVICE}?siteId=${SITE_B}`] = () =>
      json(detail([entry("b1", content({ siteId: SITE_B, title: "ED: Registrar" }))]));
    const { result } = renderHook(() => useHospitalHandbook());
    await waitFor(() => expect(result.current.status).toBe("ready"));
    act(() => result.current.choose(SERVICE, SITE_B));
    await waitFor(() => expect(result.current.items.map((item) => item.id)).toEqual(["b1"]));
    expect(result.current.siteName).toBe("Site B");
    expect(JSON.parse(window.localStorage.getItem(onCallHospitalChoiceStorageKey) ?? "null")).toEqual({
      serviceId: SERVICE,
      siteId: SITE_B,
    });
  });

  it("offers every hospital to change to, and changeHospital switches like choose", async () => {
    routes[`/api/on-call/services/${SERVICE}?siteId=${SITE_B}`] = () =>
      json(detail([entry("b1", content({ siteId: SITE_B, title: "ED: Registrar" }))]));
    const { result } = renderHook(() => useHospitalHandbook());
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.hospitals.map((hospital) => hospital.siteName)).toEqual(["Site A", "Site B"]);
    act(() => result.current.changeHospital(SERVICE, SITE_B));
    await waitFor(() => expect(result.current.siteName).toBe("Site B"));
    expect(() => result.current.onRosteredSiteMismatch("Site A")).not.toThrow();
  });

  it("reads the hospital once a minute at most, and again after a sign-out wipe", async () => {
    const first = renderHook(() => useHospitalHandbook());
    await waitFor(() => expect(first.result.current.status).toBe("ready"));
    first.unmount();
    const second = renderHook(() => useHospitalHandbook());
    await waitFor(() => expect(second.result.current.status).toBe("ready"));
    expect(getCalls(`/api/on-call/services/${SERVICE}?siteId=${SITE_A}`)).toBe(1);
    second.unmount();
    act(() => clearOnCallDeviceState());
    const third = renderHook(() => useHospitalHandbook());
    await waitFor(() => expect(third.result.current.status).toBe("ready"));
    expect(getCalls(`/api/on-call/services/${SERVICE}?siteId=${SITE_A}`)).toBe(2);
  });

  it("names an entry withdrawn since this device last saw it, by id and time only", async () => {
    const lastSeen = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    window.localStorage.setItem(
      onCallHandbookSeenStorageKey,
      JSON.stringify({ [`${SERVICE}:${SITE_A}`]: { seen: { e1: lastSeen, gone: lastSeen }, gone: {} } }),
    );
    const { result } = renderHook(() => useHospitalHandbook());
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.removed).toHaveLength(1);
    expect(result.current.removed[0]?.id).toBe("gone");
    expect(Number.isFinite(Date.parse(result.current.removed[0]?.goneAt ?? ""))).toBe(true);
    expect(ON_CALL_WITHDRAWN_MESSAGE).toBe("This number was removed. Check with switchboard.");
  });

  it("stores nothing but entry ids and times in the seen map (review B2)", async () => {
    routes[`/api/on-call/services/${SERVICE}?siteId=${SITE_A}`] = () =>
      json(detail([entry("e1", content()), entry("e2", content({ title: "ICU: Registrar", phone: "9000 0002" }))]));
    const first = renderHook(() => useHospitalHandbook());
    await waitFor(() => expect(first.result.current.status).toBe("ready"));
    first.unmount();
    // A second read without e2 moves it to "gone": still an id and a time.
    act(() => clearOnCallDeviceState());
    window.localStorage.setItem(
      onCallHandbookSeenStorageKey,
      JSON.stringify({
        [`${SERVICE}:${SITE_A}`]: { seen: { e1: new Date().toISOString(), e2: new Date().toISOString() }, gone: {} },
      }),
    );
    routes[`/api/on-call/services/${SERVICE}?siteId=${SITE_A}`] = () => json(detail([entry("e1", content())]));
    const second = renderHook(() => useHospitalHandbook());
    await waitFor(() => expect(second.result.current.status).toBe("ready"));
    const stored = JSON.parse(window.localStorage.getItem(onCallHandbookSeenStorageKey) ?? "{}") as Record<
      string,
      { seen: Record<string, string>; gone: Record<string, string> }
    >;
    const hospital = stored[`${SERVICE}:${SITE_A}`];
    expect(Object.keys(hospital ?? {}).sort()).toEqual(["gone", "seen"]);
    expect(Object.keys(hospital?.seen ?? {})).toEqual(["e1"]);
    expect(Object.keys(hospital?.gone ?? {})).toEqual(["e2"]);
    for (const value of [...Object.values(hospital?.seen ?? {}), ...Object.values(hospital?.gone ?? {})]) {
      expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    }
    const raw = window.localStorage.getItem(onCallHandbookSeenStorageKey) ?? "";
    expect(raw).not.toMatch(/Registrar|Medicine|ICU|9000/);
  });

  it("reads an older seen map that held titles as nothing seen, and rewrites it without them", async () => {
    window.localStorage.setItem(
      onCallHandbookSeenStorageKey,
      JSON.stringify({ [`${SERVICE}:${SITE_A}`]: { e1: "Medicine: Registrar on call", gone: "ICU: Registrar" } }),
    );
    const { result } = renderHook(() => useHospitalHandbook());
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.removed).toEqual([]);
    expect(window.localStorage.getItem(onCallHandbookSeenStorageKey)).not.toMatch(/Registrar|Medicine|ICU/);
  });

  it("remembers whether this hospital pins an emergency row, and whether the reader edits", async () => {
    const { result } = renderHook(() => useHospitalHandbook());
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(readOnCallEmergencyPinned(`${SERVICE}:${SITE_A}`)).toBe(false);
    expect(readOnCallEditorFlag()).toBe(false);
  });

  it("sends a fixed-reason report once and not again from this device", async () => {
    const { result } = renderHook(() => useHospitalHandbook());
    await waitFor(() => expect(result.current.status).toBe("ready"));
    await act(async () => expect(await result.current.report("e1", "not-in-service")).toBe("sent"));
    await act(async () => expect(await result.current.report("e1", "not-in-service")).toBe("already-reported"));
    const posts = vi.mocked(globalThis.fetch).mock.calls.filter(([, init]) => init?.method === "POST");
    expect(posts).toHaveLength(1);
    expect(JSON.parse(String(posts[0]?.[1]?.body))).toEqual({
      action: "report.create",
      entryId: "e1",
      reason: HANDBOOK_REPORT_REASONS["not-in-service"],
    });
    expect(result.current.hasReported("e1", "not-in-service")).toBe(true);
  });

  it("drops the previous account's hospital the moment the session changes", async () => {
    const { result, rerender } = renderHook(() => useHospitalHandbook());
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    auth.state = { status: "authenticated", authEpoch: 2 };
    rerender();
    expect(result.current.items).toEqual([]);
  });

  it("serves the synthetic fixture in demo mode and sends nothing", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    const { result } = renderHook(() => useHospitalHandbook());
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.demo).toBe(true);
    expect(result.current.siteName).toBe("Demonstration Hospital");
    await act(async () =>
      expect(await result.current.report(result.current.items[0]!.id, "wrong-department")).toBe("demo"),
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
    // No fixture uses 000 as a hospital line (plan Global Constraint 9).
    expect(result.current.items.some((item) => item.dial.display === "000")).toBe(false);
  });
});

describe("Stage C handbook scope", () => {
  it("keeps another site's published content out even when its draft moved here", async () => {
    routes[`/api/on-call/services/${SERVICE}?siteId=${SITE_A}`] = () =>
      json(
        detail([
          entry("other-site", content({ siteId: "30000000-0000-4000-8000-000000000099" }), content({ siteId: SITE_A })),
        ]),
      );
    const { result } = renderHook(() => useHospitalHandbook());
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.items).toEqual([]);
  });
});
