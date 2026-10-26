import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Only a site administrator may create, edit or verify a SHARED On Call entry (owner decision,
 * 25 Oct 2026, after sign-up opened to anyone). The handlers run for real against a fake
 * database; an ordinary account can still keep private entries.
 */

const OWNER = "00000000-0000-4000-8000-000000000001";
const ENTRY_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ADMINISTRATOR = "00000000-0000-4000-8000-000000000002";

const mocks = vi.hoisted(() => ({
  user: { id: "", appMetadata: {} as Record<string, unknown> },
  liveAdministrator: false,
  from: vi.fn(),
  writes: [] as Array<{ kind: string; values?: unknown; filters: Array<[string, string, unknown]> }>,
  storedIsPersonal: false as boolean | null,
  administrators: [] as string[],
  foreignDemoRows: [] as unknown[],
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
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: mocks.from,
    auth: {
      admin: {
        listUsers: async () => ({
          data: { users: mocks.administrators.map((id) => ({ id, app_metadata: { site_role: "administrator" } })) },
          error: null,
        }),
      },
    },
  }),
}));
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
import { GET as demoContentStatus, POST as loadDemoContent } from "@/app/api/on-call/demo-content/route";
import {
  SHARED_ON_CALL_PUBLISHER_TTL_MS,
  resetSharedOnCallPublisherCacheForTests,
  sharedOnCallPublisherIds,
} from "@/lib/on-call/shared-entry-publisher";

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

/** A table that answers every read with no rows and records what was written. */
function demoContentTable() {
  // The cross-owner probe is the only read that filters out the caller with `neq`.
  let probe = false;
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in", "limit"]) chain[method] = vi.fn(() => chain);
  chain.neq = vi.fn(() => {
    probe = true;
    return chain;
  });
  chain.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve({ data: probe ? mocks.foreignDemoRows : [], error: null }).then(resolve, reject);
  chain.upsert = vi.fn((values: unknown[]) => {
    mocks.writes.push({ kind: "upsert", values, filters: [] });
    return { select: async () => ({ data: values.map((_, index) => ({ id: String(index) })), error: null }) };
  });
  return chain;
}

describe("loading the example On Call content", () => {
  // Most of the example corpus is shared, so loading it publishes to every signed-in reader
  // (privacy audit PP-01). Only an administrator may (owner decision, 26 Oct 2026).
  beforeEach(() => {
    mocks.from.mockImplementation(() => demoContentTable());
    resetSharedOnCallPublisherCacheForTests();
    mocks.administrators = [OWNER];
    mocks.foreignDemoRows = [];
  });

  it("refuses an account that is not an administrator, before writing", async () => {
    const response = await loadDemoContent(
      new Request("http://localhost/api/on-call/demo-content", { method: "POST" }),
    );
    expect(response.status).toBe(403);
    expect(((await response.json()) as { code?: string }).code).toBe("on_call_shared_entry_administrator_required");
    expect(mocks.writes).toEqual([]);
  });

  it("refuses an account whose session claims the role when the live check does not confirm it", async () => {
    signIn("administrator");
    mocks.liveAdministrator = false;
    const response = await loadDemoContent(
      new Request("http://localhost/api/on-call/demo-content", { method: "POST" }),
    );
    expect(response.status).toBe(403);
    expect(mocks.writes).toEqual([]);
  });

  it("lets an administrator load it", async () => {
    signIn("administrator");
    const response = await loadDemoContent(
      new Request("http://localhost/api/on-call/demo-content", { method: "POST" }),
    );
    expect(response.status).toBe(201);
    expect(mocks.writes.map((write) => write.kind)).toEqual(["upsert"]);
  });

  it("is refused while another administrator's copy is on the shared read", async () => {
    signIn("administrator");
    mocks.administrators = [OWNER, OTHER_ADMINISTRATOR];
    mocks.foreignDemoRows = [{ slug: "demo-switchboard" }];
    const response = await loadDemoContent(
      new Request("http://localhost/api/on-call/demo-content", { method: "POST" }),
    );
    expect(response.status).toBe(409);
    expect(mocks.writes).toEqual([]);
  });

  it("is not blocked by an ordinary account's copy, which no longer reaches the shared read", async () => {
    // Only the caller is an administrator, so there is nobody else whose copy could be visible and
    // the cross-owner probe never runs, whatever rows other accounts hold.
    signIn("administrator");
    mocks.foreignDemoRows = [{ slug: "demo-switchboard" }];
    const response = await loadDemoContent(
      new Request("http://localhost/api/on-call/demo-content", { method: "POST" }),
    );
    expect(response.status).toBe(201);
  });

  it("tells the control whether this account may load it", async () => {
    const ordinary = await demoContentStatus(new Request("http://localhost/api/on-call/demo-content"));
    expect(await ordinary.json()).toMatchObject({ loaded: 0, mayLoad: false });

    signIn("administrator");
    const administrator = await demoContentStatus(new Request("http://localhost/api/on-call/demo-content"));
    expect(await administrator.json()).toMatchObject({ loaded: 0, mayLoad: true });
  });
});

describe("whose shared On Call entries other readers see", () => {
  const ADMIN = "00000000-0000-4000-8000-0000000000aa";
  const ORDINARY = "00000000-0000-4000-8000-0000000000bb";

  function authClient(listUsers: ReturnType<typeof vi.fn>) {
    return { auth: { admin: { listUsers } } } as never;
  }

  function usersPage(users: Array<{ id: string; app_metadata: Record<string, unknown> }>) {
    return { data: { users }, error: null };
  }

  beforeEach(() => {
    resetSharedOnCallPublisherCacheForTests();
  });

  it("is only site administrators, read from Auth", async () => {
    const listUsers = vi.fn(async () =>
      usersPage([
        { id: ADMIN, app_metadata: { site_role: "administrator" } },
        { id: ORDINARY, app_metadata: {} },
      ]),
    );
    expect(await sharedOnCallPublisherIds(authClient(listUsers), 0)).toEqual([ADMIN]);
  });

  it("asks Auth again only after the cache expires", async () => {
    const listUsers = vi.fn(async () => usersPage([{ id: ADMIN, app_metadata: { site_role: "administrator" } }]));
    await sharedOnCallPublisherIds(authClient(listUsers), 0);
    await sharedOnCallPublisherIds(authClient(listUsers), SHARED_ON_CALL_PUBLISHER_TTL_MS - 1);
    expect(listUsers).toHaveBeenCalledTimes(1);

    listUsers.mockResolvedValueOnce(usersPage([]));
    expect(await sharedOnCallPublisherIds(authClient(listUsers), SHARED_ON_CALL_PUBLISHER_TTL_MS)).toEqual([]);
    expect(listUsers).toHaveBeenCalledTimes(2);
  });

  it("keeps the last list when Auth fails, and throws rather than guess when it has none", async () => {
    const failing = vi.fn(async () => ({ data: { users: [] }, error: new Error("Auth unavailable") }));
    await expect(sharedOnCallPublisherIds(authClient(failing), 0)).rejects.toThrow(/Auth unavailable/);

    const working = vi.fn(async () => usersPage([{ id: ADMIN, app_metadata: { site_role: "administrator" } }]));
    await sharedOnCallPublisherIds(authClient(working), 0);
    expect(await sharedOnCallPublisherIds(authClient(failing), SHARED_ON_CALL_PUBLISHER_TTL_MS)).toEqual([ADMIN]);
  });

  it("reads every page of accounts", async () => {
    const fullPage = Array.from({ length: 1000 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      app_metadata: {},
    }));
    const listUsers = vi
      .fn()
      .mockResolvedValueOnce(usersPage(fullPage))
      .mockResolvedValueOnce(usersPage([{ id: ADMIN, app_metadata: { site_role: "administrator" } }]));
    expect(await sharedOnCallPublisherIds(authClient(listUsers), 0)).toEqual([ADMIN]);
    expect(listUsers).toHaveBeenCalledTimes(2);
  });
});
