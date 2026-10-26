import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `GET /api/on-call/entries` run for real against a fake database, so the
 * assertion is about what leaves the server rather than about the source text.
 *
 * Shared entries are readable by signed-in users only (owner decision,
 * 2026-09-26, reversing the 2026-09-04 anonymous read).
 */

const SHARED_ROW = {
  id: "11111111-1111-4111-8111-111111111111",
  section: "contacts",
  slug: "switchboard",
  title: "Switchboard",
  subtitle: null,
  body: null,
  details: { role: "Switchboard", phone: "9224 2244" },
  linked_document_ids: [],
  tags: [],
  is_personal: false,
  include_on_card: false,
  sort_order: 0,
  last_verified_at: null,
};

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  from: vi.fn(),
}));

vi.mock("@/lib/env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/env")>()),
  isDemoMode: () => false,
}));
vi.mock("@/lib/public-api-access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/public-api-access")>()),
  publicAccessContext: mocks.access,
}));
vi.mock("@/lib/api-rate-limit", () => ({
  allowRateLimitInMemoryFallbackOnUnavailable: () => true,
  consumeSubjectApiRateLimit: vi.fn(async () => ({ limited: false })),
  rateLimitJsonResponse: () => new Response("limited", { status: 429 }),
}));
// One site administrator, so the shared read (owner decision, 26 Oct 2026) has a publisher to read.
const listUsers = vi.hoisted(() =>
  vi.fn(async () => ({
    data: { users: [{ id: "00000000-0000-4000-8000-0000000000aa", app_metadata: { site_role: "administrator" } }] },
    error: null,
  })),
);
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: mocks.from, auth: { admin: { listUsers } } }),
}));

import { GET } from "@/app/api/on-call/entries/route";

function fakeTable(rows: unknown[]) {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    in: vi.fn(() => chain),
    order: vi.fn(() => chain),
    limit: vi.fn(() => Promise.resolve({ data: rows, error: null })),
  };
  return chain;
}

beforeEach(() => {
  mocks.access.mockReset();
  mocks.from.mockReset();
  mocks.from.mockImplementation(() => fakeTable([SHARED_ROW]));
});

describe("GET /api/on-call/entries", () => {
  it("returns no shared entries to a signed-out caller, and never reads the table", async () => {
    mocks.access.mockResolvedValue({ ownerId: undefined, rateLimitSubject: { kind: "ip", ip: "203.0.113.1" } });
    const response = await GET(new Request("http://localhost/api/on-call/entries"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ entries: [], signedOut: true });
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("still returns the shared entries to a signed-in caller", async () => {
    mocks.access.mockResolvedValue({
      ownerId: "00000000-0000-4000-8000-000000000001",
      rateLimitSubject: { kind: "owner", ownerId: "00000000-0000-4000-8000-000000000001" },
    });
    const response = await GET(new Request("http://localhost/api/on-call/entries"));
    const body = (await response.json()) as { entries: Array<{ id: string }>; signedOut: boolean };
    expect(body.signedOut).toBe(false);
    expect(body.entries.map((entry) => entry.id)).toEqual([SHARED_ROW.id]);
    expect(mocks.from).toHaveBeenCalledWith("on_call_entries");
  });
});
