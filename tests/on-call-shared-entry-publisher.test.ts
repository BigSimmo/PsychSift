import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Only a site administrator may create, edit or verify a SHARED On Call entry (owner decision,
 * 25 Oct 2026, after sign-up opened to anyone). The handlers run for real against a fake
 * database; an ordinary account can still keep private entries.
 */

const OWNER = "00000000-0000-4000-8000-000000000001";
const ENTRY_ID = "11111111-1111-4111-8111-111111111111";

const mocks = vi.hoisted(() => ({
  user: { id: "", appMetadata: {} as Record<string, unknown> },
  liveAdministrator: false,
  from: vi.fn(),
  writes: [] as Array<{ kind: string; values?: unknown; filters: Array<[string, string, unknown]> }>,
  storedIsPersonal: false as boolean | null,
}));

vi.mock("@/lib/env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/env")>()),
  isDemoMode: () => false,
}));
vi.mock("@/lib/api-rate-limit", () => ({
  allowRateLimitInMemoryFallbackOnUnavailable: () => true,
  consumeSubjectApiRateLimit: vi.fn(async () => ({ limited: false })),
  rateLimitJsonResponse: () => new Response("limited", { status: 429 }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: mocks.from }) }));
vi.mock("@/lib/supabase/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase/auth")>();
  const { PublicApiError } = await import("@/lib/http");
  return {
    ...actual,
    requireAuthenticatedUser: vi.fn(
      async (_request: Request, _supabase: unknown, requirement?: { administrator?: boolean }) => {
        if (requirement?.administrator && !mocks.liveAdministrator) {
          throw new PublicApiError("Administrator access required.", 403, { code: "administrator_required" });
        }
        return mocks.user;
      },
    ),
  };
});

import { POST as createEntry } from "@/app/api/on-call/entries/route";
import { PATCH as updateEntry } from "@/app/api/on-call/entries/[id]/route";
import { POST as verifyEntry } from "@/app/api/on-call/entries/[id]/verify/route";

function storedRow(isPersonal: boolean) {
  return {
    id: ENTRY_ID,
    section: "contacts",
    slug: "switchboard",
    title: "Switchboard",
    subtitle: null,
    body: null,
    details: { role: "Switchboard", phone: "9224 2244" },
    linked_document_ids: [],
    tags: [],
    is_personal: isPersonal,
    include_on_card: false,
    sort_order: 0,
    last_verified_at: null,
  };
}

function fakeTable() {
  let pending: { kind: string; values?: unknown; filters: Array<[string, string, unknown]> } = {
    kind: "select",
    filters: [],
  };
  const settle = () => {
    mocks.writes.push(pending);
    if (pending.kind === "select") {
      return Promise.resolve({
        data: mocks.storedIsPersonal === null ? null : { is_personal: mocks.storedIsPersonal },
        error: null,
      });
    }
    const personalFilter = pending.filters.find(([op, column]) => op === "in" && column === "is_personal");
    const isPersonal =
      pending.kind === "insert" || pending.kind === "update-entry"
        ? Boolean((pending.values as { is_personal?: boolean }).is_personal)
        : Boolean(mocks.storedIsPersonal);
    if (personalFilter && !(personalFilter[2] as boolean[]).includes(isPersonal)) {
      return Promise.resolve({ data: null, error: null });
    }
    return Promise.resolve({ data: storedRow(isPersonal), error: null });
  };
  const chain = {
    insert: vi.fn((values: unknown) => {
      pending = { kind: "insert", values, filters: [] };
      return chain;
    }),
    update: vi.fn((values: Record<string, unknown>) => {
      pending = { kind: "is_personal" in values ? "update-entry" : "verify", values, filters: [] };
      return chain;
    }),
    select: vi.fn(() => chain),
    eq: vi.fn((column: string, value: unknown) => {
      pending.filters.push(["eq", column, value]);
      return chain;
    }),
    in: vi.fn((column: string, value: unknown) => {
      pending.filters.push(["in", column, value]);
      return chain;
    }),
    single: vi.fn(settle),
    maybeSingle: vi.fn(settle),
  };
  return chain;
}

function entryBody(isPersonal: boolean) {
  return {
    section: "contacts",
    slug: "switchboard",
    title: "Switchboard",
    subtitle: null,
    body: null,
    details: { role: "Switchboard", phone: "9224 2244" },
    linkedDocumentIds: [],
    tags: [],
    isPersonal,
    includeOnCard: false,
    sortOrder: 0,
    lastVerifiedAt: null,
  };
}

function jsonRequest(url: string, method: string, body?: unknown) {
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const params = { params: Promise.resolve({ id: ENTRY_ID }) };

function signIn(kind: "ordinary" | "administrator") {
  mocks.user = {
    id: OWNER,
    appMetadata: kind === "administrator" ? { site_role: "administrator" } : {},
  };
  mocks.liveAdministrator = kind === "administrator";
}

beforeEach(() => {
  mocks.from.mockReset();
  mocks.from.mockImplementation(() => fakeTable());
  mocks.writes.length = 0;
  mocks.storedIsPersonal = false;
  signIn("ordinary");
});

describe("creating an On Call entry", () => {
  it("refuses a shared entry from an account that is not an administrator, before writing", async () => {
    const response = await createEntry(jsonRequest("http://localhost/api/on-call/entries", "POST", entryBody(false)));
    expect(response.status).toBe(403);
    expect(((await response.json()) as { code?: string }).code).toBe("on_call_shared_entry_administrator_required");
    expect(mocks.writes).toEqual([]);
  });

  it("still lets an ordinary account create a private entry", async () => {
    const response = await createEntry(jsonRequest("http://localhost/api/on-call/entries", "POST", entryBody(true)));
    expect(response.status).toBe(201);
    expect(mocks.writes.map((write) => write.kind)).toEqual(["insert"]);
  });

  it("lets an administrator create a shared entry", async () => {
    signIn("administrator");
    const response = await createEntry(jsonRequest("http://localhost/api/on-call/entries", "POST", entryBody(false)));
    expect(response.status).toBe(201);
    expect((mocks.writes[0]!.values as { is_personal: boolean }).is_personal).toBe(false);
  });

  it("refuses an account whose session claims the role when the live check does not confirm it", async () => {
    signIn("administrator");
    mocks.liveAdministrator = false;
    const response = await createEntry(jsonRequest("http://localhost/api/on-call/entries", "POST", entryBody(false)));
    expect(response.status).toBe(403);
    expect(mocks.writes).toEqual([]);
  });
});

describe("editing an On Call entry", () => {
  it("refuses to save an entry as shared for an account that is not an administrator", async () => {
    const response = await updateEntry(
      jsonRequest(`http://localhost/api/on-call/entries/${ENTRY_ID}`, "PATCH", entryBody(false)),
      params,
    );
    expect(response.status).toBe(403);
    expect(mocks.writes).toEqual([]);
  });

  it("lets an ordinary account make its own entry private", async () => {
    const response = await updateEntry(
      jsonRequest(`http://localhost/api/on-call/entries/${ENTRY_ID}`, "PATCH", entryBody(true)),
      params,
    );
    expect(response.status).toBe(200);
    expect(mocks.writes.map((write) => write.kind)).toEqual(["update-entry"]);
  });

  it("lets an administrator save a shared entry", async () => {
    signIn("administrator");
    const response = await updateEntry(
      jsonRequest(`http://localhost/api/on-call/entries/${ENTRY_ID}`, "PATCH", entryBody(false)),
      params,
    );
    expect(response.status).toBe(200);
  });
});

describe("verifying an On Call entry", () => {
  it("lets an ordinary account verify only its private entries, and says why a shared one is refused", async () => {
    mocks.storedIsPersonal = false;
    const response = await verifyEntry(
      jsonRequest(`http://localhost/api/on-call/entries/${ENTRY_ID}/verify`, "POST"),
      params,
    );
    expect(response.status).toBe(403);
    expect(mocks.writes[0]!.filters).toContainEqual(["in", "is_personal", [true]]);
  });

  it("verifies an ordinary account's private entry", async () => {
    mocks.storedIsPersonal = true;
    const response = await verifyEntry(
      jsonRequest(`http://localhost/api/on-call/entries/${ENTRY_ID}/verify`, "POST"),
      params,
    );
    expect(response.status).toBe(200);
  });

  it("still answers not found for an id the caller does not own", async () => {
    mocks.storedIsPersonal = null;
    const response = await verifyEntry(
      jsonRequest(`http://localhost/api/on-call/entries/${ENTRY_ID}/verify`, "POST"),
      params,
    );
    expect(response.status).toBe(404);
  });

  it("lets an administrator verify a shared entry", async () => {
    signIn("administrator");
    mocks.storedIsPersonal = false;
    const response = await verifyEntry(
      jsonRequest(`http://localhost/api/on-call/entries/${ENTRY_ID}/verify`, "POST"),
      params,
    );
    expect(response.status).toBe(200);
    expect(mocks.writes[0]!.filters).toContainEqual(["in", "is_personal", [true, false]]);
  });
});
