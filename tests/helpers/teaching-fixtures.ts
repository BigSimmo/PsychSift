import { resetSharedGets } from "@/lib/shared-get";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, vi, type MockInstance } from "vitest";

import type { SessionDetailRead, SessionSummaryRead } from "@/components/teaching/teaching-reads";
import type { TeachingWeekResponse, TeamSummary } from "@/lib/teaching/model";

import { authState } from "./teaching-auth";

/** Wednesday 30 September 2026, 11:50 in Perth: the v5.2 mockups' clock. */
export const NOW = new Date("2026-09-30T03:50:00Z");
/** 12:40 the same day: the 12:30 session is on and check-in is open. */
export const DURING = new Date("2026-09-30T04:40:00Z");
/** 14:00 the same day: that session has ended. */
export const AFTER = new Date("2026-09-30T06:00:00Z");
export const TODAY = "2026-09-30";
export const NB = " ";
export const TEAM_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const TEAM_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const OCC = "11111111-1111-4111-8111-111111111111";

export const teamA: TeamSummary = {
  id: TEAM_A,
  name: "Hospital A psychiatry",
  role: "doctor",
  acceptsRealData: true,
  isDemo: false,
};
export const teamB: TeamSummary = { ...teamA, id: TEAM_B, name: "Hospital B psychiatry" };

export function session(overrides: Partial<SessionSummaryRead> = {}): SessionSummaryRead {
  return {
    occurrenceId: OCC,
    serviceId: TEAM_A,
    title: "Registrar teaching",
    startsAt: "2026-09-30T04:30:00.000Z",
    endsAt: "2026-09-30T05:30:00.000Z",
    venue: "Seminar room 1",
    hasJoinLink: false,
    status: "scheduled",
    isPresenter: false,
    source: "teaching",
    ...overrides,
  };
}

export function detail(overrides: Partial<SessionDetailRead> = {}): SessionDetailRead {
  return {
    ...session(),
    joinUrl: null,
    presenterName: null,
    materials: [],
    changeReason: null,
    canShowCode: false,
    counts: null,
    myAttendance: null,
    // `SessionDetail.visitor` is a required field on the real model (part 2's
    // S1); a session read before F2 lands is never a visitor's.
    visitor: false,
    ...overrides,
  };
}

export function week(overrides: Partial<TeachingWeekResponse> = {}): TeachingWeekResponse {
  return {
    teams: [teamA],
    sessions: [session()],
    notices: [],
    attendance: [],
    relocated: [],
    relocatedUnavailable: false,
    ...overrides,
  };
}

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** The canonical API error shape `parseApiErrorResponse` reads. */
export function apiError(status: number, code: string): Response {
  return json(status, { error: "Refused", message: "Refused", code });
}

export type FetchRoute = (
  url: string,
  body: Record<string, unknown> | null,
  init?: RequestInit,
) => Response | Promise<Response> | null | undefined;

/** Routes every fetch through `route`; an unrouted request fails the test loudly. */
export function serveFetch(route: FetchRoute): MockInstance<typeof fetch> {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    const response = await route(url, body, init);
    if (!response) throw new Error(`Unexpected fetch ${init?.method ?? "GET"} ${url}`);
    return response;
  });
}

/** The element with this test id; throws when absent, so it also works inside `waitFor`. */
export function byId(id: string): HTMLElement {
  return screen.getByTestId(id);
}

export function fetchCalls(fetchMock: MockInstance<typeof fetch>, prefix: string): number {
  return fetchMock.mock.calls.filter(([input]) => String(input).startsWith(prefix)).length;
}

/** Fake `Date` at `at`, a signed-in reader, and a clean DOM and mocks after each test. Call once per file. */
export function useTeachingTestClock(at: Date = NOW) {
  beforeEach(() => {
    resetSharedGets();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(at);
    authState.status = "authenticated";
    authState.authEpoch = 1;
    authState.signInWithEmail.mockClear();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
}
