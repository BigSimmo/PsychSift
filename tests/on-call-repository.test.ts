import { describe, expect, it, vi } from "vitest";
import { PublicApiError } from "@/lib/http";
import { ON_CALL_SECTIONS, onCallDetailsSchemaFor } from "@/lib/on-call/entry-model";
import {
  COMPLIANCE_MARKER_KEYS,
  PUBLIC_ON_CALL_SECTIONS,
  assertValidLinkedDocumentIds,
  fetchOwnerOnCallEntries,
  fetchSharedOnCallEntries,
  fetchVisibleOnCallEntries,
  onCallEntryToRow,
  rowMayBeComplianceRequirement,
  rowToOnCallEntry,
} from "@/lib/on-call/repository";

function fakeClient(rows: unknown[]) {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    in: vi.fn(() => chain),
    order: vi.fn(() => chain),
    limit: vi.fn(() => Promise.resolve({ data: rows, error: null })),
  };
  return { from: vi.fn(() => chain), chain };
}

const SHARED_ROW = {
  id: "11111111-1111-4111-8111-111111111111",
  section: "contacts",
  slug: "s1",
  title: "Switchboard",
  subtitle: null,
  body: null,
  details: {},
  linked_document_ids: [],
  tags: [],
  is_personal: false,
  include_on_card: false,
  sort_order: 0,
  last_verified_at: null,
};

const PERSONAL_ROW = {
  id: "22222222-2222-4222-8222-222222222222",
  section: "contacts",
  slug: "s2",
  title: "Consultant mobile",
  subtitle: null,
  body: null,
  details: {},
  linked_document_ids: [],
  tags: [],
  is_personal: true,
  include_on_card: false,
  sort_order: 0,
  last_verified_at: null,
};

describe("fetchOwnerOnCallEntries", () => {
  it("filters by owner_id on the same chain as from()", async () => {
    const client = fakeClient([]);
    await fetchOwnerOnCallEntries(client as never, "owner-1");
    expect(client.from).toHaveBeenCalledWith("on_call_entries");
    expect(client.chain.eq).toHaveBeenCalledWith("owner_id", "owner-1");
  });

  it("refuses to run without an owner rather than returning another tenant's rows", async () => {
    const client = fakeClient([]);
    await expect(fetchOwnerOnCallEntries(client as never, "")).rejects.toThrow(/owner/i);
    expect(client.from).not.toHaveBeenCalled();
  });
});

describe("fetchSharedOnCallEntries", () => {
  // The safety-critical assertion of the public-visibility change. On Call entries are
  // world-readable, so this read must never be able to return an entry the editor marked
  // "Private — only you". A world-readable fetch is an export, which is what that
  // control promises to keep the row out of.
  it("filters out personal entries on the same chain as from()", async () => {
    const client = fakeClient([]);
    await fetchSharedOnCallEntries(client as never);
    expect(client.from).toHaveBeenCalledWith("on_call_entries");
    expect(client.chain.eq).toHaveBeenCalledWith("is_personal", false);
  });

  it("never narrows by owner, because there is no viewer to narrow to", async () => {
    const client = fakeClient([]);
    await fetchSharedOnCallEntries(client as never);
    expect(client.chain.eq).not.toHaveBeenCalledWith("owner_id", expect.anything());
  });

  it("still applies a section filter alongside the personal-entry exclusion", async () => {
    const client = fakeClient([]);
    await fetchSharedOnCallEntries(client as never, { section: "playbook" });
    expect(client.chain.eq).toHaveBeenCalledWith("is_personal", false);
    expect(client.chain.eq).toHaveBeenCalledWith("section", "playbook");
  });
});

/**
 * The control that keeps a doctor's own regulatory record off a public page.
 *
 * On Call has no login wall: `GET /api/on-call/entries` answers anonymous
 * callers, and the 2026-09-04 decision that made it do so was about ward
 * numbers and escalation ladders. The Compliance page stores registration,
 * indemnity, credentialing, Working with Children Check and police-clearance
 * records for one named person, and often a link to the certificate. The
 * editor stores those rows private, but the flag is a setting and settings can
 * be changed, imported around, or edited directly in the database — so the
 * read itself refuses, on the raw row, before anything is parsed.
 *
 * Every case below is a way that refusal could be got around. If one of these
 * ever goes green by being deleted rather than by being fixed, the thing that
 * leaks is somebody's Ahpra registration.
 */
/**
 * The control that was missing when the compliance leak happened.
 *
 * A security review put it plainly: the leak was not a coding mistake. Every
 * line of the shared read was correct. A page holding a doctor's registration
 * and police clearance was added to a section that had been made public a
 * fortnight earlier for ward phone numbers, and nothing anywhere required
 * anyone to re-decide. No test went red, because no test asserted what the
 * public read is ALLOWED to return — only what it happened to return.
 *
 * These cases are that assertion. They are deliberately about the shape of the
 * answer rather than today's data, so the next section and the next column are
 * withheld until somebody names them on purpose.
 */
describe("fetchSharedOnCallEntries is deny-by-default", () => {
  it("asks the database for an explicit list of publishable sections", async () => {
    const client = fakeClient([]);
    await fetchSharedOnCallEntries(client as never);
    expect(client.chain.in).toHaveBeenCalledWith("section", [...PUBLIC_ON_CALL_SECTIONS]);
  });

  it("publishes fewer sections than the schema allows, or exactly as many — never more", () => {
    // The allow-list may lag the union deliberately; it may never lead it. A
    // value here that is not a real section is a typo that silently withholds
    // a whole page, which is the failure this direction catches.
    for (const section of PUBLIC_ON_CALL_SECTIONS) {
      expect(ON_CALL_SECTIONS as readonly string[]).toContain(section);
    }
  });

  it("withholds a seventh section until it is named, rather than publishing it on arrival", () => {
    // The forcing function. Adding a value to `ON_CALL_SECTIONS` must not
    // publish it: this goes red, and whoever adds the section has to decide,
    // in writing, whether a stranger may read it.
    const undeclared = (ON_CALL_SECTIONS as readonly string[]).filter(
      (section) => !(PUBLIC_ON_CALL_SECTIONS as readonly string[]).includes(section),
    );
    expect(
      undeclared,
      `${undeclared.join(", ")} can be stored but is not in PUBLIC_ON_CALL_SECTIONS. ` +
        "Decide whether an anonymous reader may see it, then add it there with a reason — or leave it out on purpose " +
        "and update this expectation.",
      // `education` is left out on purpose (owner decision, 2026-09-26): a
      // teaching list is its owner's own and reaches nobody else.
    ).toEqual(["education"]);
  });

  it("does not serve Teaching entries on the shared read", async () => {
    const TEACHING_ROW = {
      ...SHARED_ROW,
      id: "12121212-1212-4121-8121-121212121212",
      section: "education",
      slug: "grand-round",
      title: "Grand round",
      details: { topics: [] },
    };
    expect(PUBLIC_ON_CALL_SECTIONS as readonly string[]).not.toContain("education");
    // Checked on the returned rows too, not only in the query, so a request
    // for the section — or a row the filter somehow let through — gets nothing.
    const client = fakeClient([SHARED_ROW, TEACHING_ROW]);
    expect((await fetchSharedOnCallEntries(client as never)).map((entry) => entry.id)).toEqual([SHARED_ROW.id]);
    expect(await fetchSharedOnCallEntries(fakeClient([TEACHING_ROW]) as never, { section: "education" })).toEqual([]);
  });

  it("still returns a viewer's own Teaching entries to them", async () => {
    const TEACHING_ROW = {
      ...SHARED_ROW,
      id: "12121212-1212-4121-8121-121212121212",
      section: "education",
      slug: "grand-round",
      title: "Grand round",
      details: { topics: [] },
    };
    const chain = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      in: vi.fn(() => chain),
      order: vi.fn(() => chain),
      limit: vi
        .fn()
        .mockResolvedValueOnce({ data: [], error: null })
        .mockResolvedValueOnce({ data: [TEACHING_ROW], error: null }),
    };
    const entries = await fetchVisibleOnCallEntries({ from: vi.fn(() => chain) } as never, "owner-1", {
      section: "education",
    });
    expect(entries.map((entry) => [entry.id, entry.isOwn])).toEqual([[TEACHING_ROW.id, true]]);
  });

  it("returns an explicit set of fields, so a new column is not published by being added", async () => {
    const client = fakeClient([SHARED_ROW]);
    const [entry] = await fetchSharedOnCallEntries(client as never);
    // `details` is the one field whose CONTENTS are free-form, which is exactly
    // how the compliance data arrived; the row-level predicate above is what
    // guards it. This list guards the rest.
    expect(Object.keys(entry).sort()).toEqual(
      [
        "body",
        "details",
        "id",
        "includeOnCard",
        "isPersonal",
        "lastVerifiedAt",
        "linkedDocumentIds",
        "section",
        "slug",
        "sortOrder",
        "subtitle",
        "tags",
        "title",
        "view",
      ].sort(),
    );
  });
});

describe("fetchSharedOnCallEntries and compliance requirements", () => {
  function logisticsRow(id: string, details: unknown, overrides: Record<string, unknown> = {}) {
    return {
      id,
      section: "logistics",
      slug: `row-${id.slice(0, 4)}`,
      title: `Row ${id.slice(0, 4)}`,
      subtitle: null,
      body: null,
      details,
      linked_document_ids: [],
      tags: [],
      is_personal: false,
      include_on_card: false,
      sort_order: 0,
      last_verified_at: null,
      ...overrides,
    };
  }

  const ADMIN_ROW = logisticsRow("33333333-3333-4333-8333-333333333333", { category: "Leave" });

  it("withholds a compliance requirement even when it is not flagged personal", async () => {
    const row = logisticsRow("44444444-4444-4444-8444-444444444444", {
      category: "Registration",
      kind: "compliance",
      consequence: "stops-work",
      expiresOn: "2027-03-12",
    });
    const client = fakeClient([ADMIN_ROW, row]);
    const entries = await fetchSharedOnCallEntries(client as never);
    expect(entries.map((entry) => entry.id)).toEqual([ADMIN_ROW.id]);
  });

  it("still returns ordinary admin rows, so the filter is not simply excluding the section", async () => {
    const client = fakeClient([ADMIN_ROW]);
    const entries = await fetchSharedOnCallEntries(client as never);
    expect(entries).toHaveLength(1);
  });

  it("withholds a row whose kind is misspelt, because the parsed entry would call it ordinary admin", async () => {
    // `rowToOnCallEntry` nulls details that fail their schema, so a capital C
    // here makes `isComplianceEntry` answer false. Asking the parsed entry
    // would publish exactly the rows most likely to be malformed.
    const row = logisticsRow("55555555-5555-4555-8555-555555555555", {
      category: "Registration",
      kind: "Compliance",
      expiresOn: "2027-03-12",
    });
    const client = fakeClient([row]);
    expect(await fetchSharedOnCallEntries(client as never)).toEqual([]);
  });

  it("withholds a logistics row whose details cannot be read at all", async () => {
    const client = fakeClient([logisticsRow("66666666-6666-4666-8666-666666666666", null)]);
    expect(await fetchSharedOnCallEntries(client as never)).toEqual([]);
  });

  it("withholds a logistics row whose details are an array", async () => {
    // `typeof [] === "object"` and an array has no `kind`, so the first version
    // of this predicate called an array an ordinary Admin row and published it.
    const client = fakeClient([logisticsRow("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", [])]);
    expect(await fetchSharedOnCallEntries(client as never)).toEqual([]);
  });

  it("withholds a requirement that carries compliance fields but has lost its kind", async () => {
    // The case that made `kind` alone insufficient, and the reason this file
    // has a guard below. `kind` is optional in `logisticsDetails`, so this row
    // is SCHEMA-VALID: it parses, its details survive `rowToOnCallEntry`
    // intact, and the old predicate published the expiry, the issuing body and
    // the link to the certificate to anyone who called the endpoint.
    const row = logisticsRow("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", {
      category: "Registration",
      consequence: "stops-work",
      expiresOn: "2027-03-12",
      issuingBody: "Ahpra",
      evidenceUrl: "https://example.org/certificate.pdf",
    });
    expect(onCallDetailsSchemaFor("logistics").safeParse(row.details).success).toBe(true);
    const client = fakeClient([row]);
    expect(await fetchSharedOnCallEntries(client as never)).toEqual([]);
  });

  it.each(COMPLIANCE_MARKER_KEYS)("withholds a logistics row carrying %s on its own", async (key) => {
    const row = logisticsRow("cccccccc-cccc-4ccc-8ccc-cccccccccccc", { category: "Leave", [key]: "anything" });
    const client = fakeClient([row]);
    expect(await fetchSharedOnCallEntries(client as never)).toEqual([]);
  });

  it("withholds a logistics row whose details the section schema refuses", async () => {
    // The shape the marker-key list alone missed, and the reason the docstring
    // claim "it fails closed" needed a second line to be true: snake_case keys
    // carry the same content past a case-sensitive `in` check. Nothing
    // publishable is lost — `rowToOnCallEntry` nulls details that fail this
    // parse, so the row already rendered empty.
    const row = logisticsRow("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", {
      category: "Registration",
      expires_on: "2027-03-12",
      evidence_url: "https://example.org/certificate.pdf",
    });
    expect(onCallDetailsSchemaFor("logistics").safeParse(row.details).success).toBe(false);
    const client = fakeClient([row]);
    expect(await fetchSharedOnCallEntries(client as never)).toEqual([]);
  });

  it("withholds a marker key that sits on the prototype rather than the row's own keys", async () => {
    // `in` walks the prototype chain and `hasOwnProperty` does not. The wider
    // test is the correct one here, and this pins it so the narrowing looks
    // like the regression it would be.
    const details = Object.create({ expiresOn: "2027-03-12" }) as Record<string, unknown>;
    details.category = "Registration";
    const client = fakeClient([logisticsRow("ffffffff-ffff-4fff-8fff-ffffffffffff", details)]);
    expect(await fetchSharedOnCallEntries(client as never)).toEqual([]);
  });

  it("still publishes an admin row that uses only the ordinary admin fields", async () => {
    // The other half of the guard: widening the predicate must not quietly
    // withhold the section it was made public for.
    const row = logisticsRow("dddddddd-dddd-4ddd-8ddd-dddddddddddd", {
      category: "Facilities",
      location: "Level 3",
      hours: "0800-1630",
      phone: "1234",
      url: "https://example.org/parking",
    });
    const client = fakeClient([row]);
    expect((await fetchSharedOnCallEntries(client as never)).map((entry) => entry.id)).toEqual([row.id]);
  });

  /**
   * Deny by default for FIELDS, the same discipline `PUBLIC_ON_CALL_SECTIONS`
   * applies to sections.
   *
   * Adding a field to `logisticsDetails` is how the leak above happened: the
   * compliance fields were added to a section that had been made public a
   * fortnight earlier, and nothing required anyone to re-decide. This fails
   * until the new key is sorted into one list or the other on purpose.
   */
  it("classifies every logistics detail field as either a compliance marker or admin-safe", () => {
    const ADMIN_SAFE_KEYS = ["category", "location", "hours", "phone", "url", "done", "jobStartsOn"];
    const schema = onCallDetailsSchemaFor("logistics") as unknown as { shape: Record<string, unknown> };
    const declared = Object.keys(schema.shape).sort();
    const classified = [...COMPLIANCE_MARKER_KEYS, ...ADMIN_SAFE_KEYS].sort();
    expect(declared).toEqual(classified);
  });

  it("withholds a logistics row whose details are an array, rather than publishing title and body", async () => {
    // Arrays are typeof "object", so the old `"kind" in details` check returned
    // false and the shared read published the row while rowToOnCallEntry nulled
    // details. Fail closed: an array is not a logistics payload.
    const row = logisticsRow("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", [
      { category: "Registration", kind: "compliance", expiresOn: "2027-03-12" },
    ]);
    const client = fakeClient([ADMIN_ROW, row]);
    const entries = await fetchSharedOnCallEntries(client as never);
    expect(entries.map((entry) => entry.id)).toEqual([ADMIN_ROW.id]);
  });

  it("withholds a schema-invalid logistics object that carries no kind", async () => {
    // No `kind`, so the old predicate returned false; the section schema still
    // refuses the payload (bad date / unknown key), and rowToOnCallEntry would
    // only null details after the title and body had already left the server.
    const badDate = logisticsRow("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", {
      category: "Leave",
      expiresOn: "not-a-date",
    });
    const strayKey = logisticsRow("cccccccc-cccc-4ccc-8ccc-cccccccccccc", {
      category: "Leave",
      certificateNumber: "secret-registration-id",
    });
    const client = fakeClient([ADMIN_ROW, badDate, strayKey]);
    const entries = await fetchSharedOnCallEntries(client as never);
    expect(entries.map((entry) => entry.id)).toEqual([ADMIN_ROW.id]);
  });

  it("leaves rows in other sections alone, whatever their details carry", async () => {
    // Who's who rides `details.kind` on contacts and is deliberately public.
    const roleExplainer = {
      ...logisticsRow("77777777-7777-4777-8777-777777777777", { kind: "role-explainer" }),
      section: "contacts",
    };
    const client = fakeClient([roleExplainer]);
    expect(await fetchSharedOnCallEntries(client as never)).toHaveLength(1);
  });

  it("does not hide the requirement from its owner", async () => {
    const row = logisticsRow("88888888-8888-4888-8888-888888888888", {
      category: "Registration",
      kind: "compliance",
    });
    const client = fakeClient([row]);
    const entries = await fetchOwnerOnCallEntries(client as never, "owner-1");
    expect(entries.map((entry) => entry.id)).toEqual([row.id]);
  });
});

/**
 * A colleague's name is the author's own note. The number and the role are what
 * a covering doctor needs; the name went to every visitor and sat in their
 * device cache for a week (owner decision, 2026-09-26).
 */
describe("contact names on the shared read", () => {
  const NAMED_ROW = {
    ...SHARED_ROW,
    id: "13131313-1313-4131-8131-131313131313",
    slug: "ed-reg",
    title: "ED registrar",
    details: { role: "ED registrar", phone: "9224 0001", contactName: "Dr A. Colleague", availability: "24/7" },
  };

  it("drops contactName from a shared row for a viewer who does not own it", async () => {
    const [entry] = await fetchSharedOnCallEntries(fakeClient([NAMED_ROW]) as never);
    expect(entry.details).toEqual({ role: "ED registrar", phone: "9224 0001", availability: "24/7" });
    expect(JSON.stringify(entry)).not.toContain("Dr A. Colleague");
  });

  it("drops it for a signed-in viewer who is not the owner", async () => {
    const chain = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      in: vi.fn(() => chain),
      order: vi.fn(() => chain),
      limit: vi
        .fn()
        // The shared read sees the row; this viewer owns nothing.
        .mockResolvedValueOnce({ data: [NAMED_ROW], error: null })
        .mockResolvedValueOnce({ data: [], error: null }),
    };
    const otherViewer = await fetchVisibleOnCallEntries({ from: vi.fn(() => chain) } as never, "owner-2");
    expect(otherViewer).toHaveLength(1);
    expect(JSON.stringify(otherViewer)).not.toContain("Dr A. Colleague");
  });

  it("keeps contactName for the owner, whose own copy wins the merge", async () => {
    const chain = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      in: vi.fn(() => chain),
      order: vi.fn(() => chain),
      limit: vi
        .fn()
        .mockResolvedValueOnce({ data: [NAMED_ROW], error: null })
        .mockResolvedValueOnce({ data: [NAMED_ROW], error: null }),
    };
    const [entry] = await fetchVisibleOnCallEntries({ from: vi.fn(() => chain) } as never, "owner-1");
    expect(entry.isOwn).toBe(true);
    expect(entry.details).toMatchObject({ contactName: "Dr A. Colleague" });
    expect((await fetchOwnerOnCallEntries(fakeClient([NAMED_ROW]) as never, "owner-1"))[0].details).toMatchObject({
      contactName: "Dr A. Colleague",
    });
  });
});

/**
 * New job's checklist tick and start date (`src/lib/admin/new-job-progress.ts`) are owner-only for
 * the same reason a colleague's name is above: a shared New job row is read-only guidance, not a
 * shared checklist, so a colleague's progress and start date are never sent to another viewer.
 */
describe("New job's done tick and start date on the shared read", () => {
  const NEW_JOB_ROW = {
    ...SHARED_ROW,
    id: "14141414-1414-4141-8141-141414141414",
    section: "logistics",
    slug: "hr-logins",
    title: "HR system logins",
    details: { category: "Logins", done: true, jobStartsOn: "2026-11-02" },
  };

  it("drops done and jobStartsOn from a shared row for a viewer who does not own it", async () => {
    const [entry] = await fetchSharedOnCallEntries(fakeClient([NEW_JOB_ROW]) as never);
    expect(entry.details).toEqual({ category: "Logins" });
    expect(JSON.stringify(entry)).not.toContain("jobStartsOn");
  });

  it("keeps them for the owner, whose own copy wins the merge", async () => {
    const chain = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      in: vi.fn(() => chain),
      order: vi.fn(() => chain),
      limit: vi
        .fn()
        .mockResolvedValueOnce({ data: [NEW_JOB_ROW], error: null })
        .mockResolvedValueOnce({ data: [NEW_JOB_ROW], error: null }),
    };
    const [entry] = await fetchVisibleOnCallEntries({ from: vi.fn(() => chain) } as never, "owner-1");
    expect(entry.isOwn).toBe(true);
    expect(entry.details).toMatchObject({ done: true, jobStartsOn: "2026-11-02" });
  });
});

describe("fetchVisibleOnCallEntries", () => {
  // Reversed on 2026-09-26: shared entries are for signed-in users only. Until then an anonymous
  // viewer got the whole shared set here.
  it("returns nothing to an anonymous viewer, without running either read", async () => {
    const client = fakeClient([SHARED_ROW]);
    const entries = await fetchVisibleOnCallEntries(client as never, undefined);
    expect(entries).toEqual([]);
    expect(client.from).not.toHaveBeenCalled();
  });

  it("adds the viewer's own entries, including the personal ones the shared read withholds", async () => {
    // One fake client answers both queries; the rows returned stand in for the union the
    // two reads produce against a real database.
    const client = fakeClient([SHARED_ROW, PERSONAL_ROW]);
    const entries = await fetchVisibleOnCallEntries(client as never, "owner-1");
    expect(client.chain.eq).toHaveBeenCalledWith("is_personal", false);
    expect(client.chain.eq).toHaveBeenCalledWith("owner_id", "owner-1");
    expect(entries.map((entry) => entry.title).sort()).toEqual(["Consultant mobile", "Switchboard"]);
  });

  // The shared read returns every account's non-personal rows, and only the
  // owner may edit or verify one, so each row says which query it came from.
  it("marks the viewer's own rows as theirs and everyone else's as not", async () => {
    const OTHER_ROW = { ...SHARED_ROW, id: "33333333-3333-4333-8333-333333333333", slug: "s3", title: "Ward" };
    const chain = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      in: vi.fn(() => chain),
      order: vi.fn(() => chain),
      limit: vi
        .fn()
        // First the shared read (both rows), then the owner read (only SHARED_ROW).
        .mockResolvedValueOnce({ data: [SHARED_ROW, OTHER_ROW], error: null })
        .mockResolvedValueOnce({ data: [SHARED_ROW], error: null }),
    };
    const client = { from: vi.fn(() => chain), chain };
    const entries = await fetchVisibleOnCallEntries(client as never, "owner-1");
    const byTitle = Object.fromEntries(entries.map((entry) => [entry.title, entry.isOwn]));
    expect(byTitle).toEqual({ Switchboard: true, Ward: false });
  });

  it("returns one object per entry when both reads see the same row", async () => {
    const client = fakeClient([SHARED_ROW]);
    const entries = await fetchVisibleOnCallEntries(client as never, "owner-1");
    expect(entries).toHaveLength(1);
  });
});

/**
 * The write-side half of the same control. The client editor stores compliance
 * rows private; this does not trust it, because an authenticated caller can
 * send whatever body they like straight to the API.
 */
describe("onCallEntryToRow and compliance requirements", () => {
  function entryFor(details: unknown, isPersonal: boolean) {
    return {
      id: "99999999-9999-4999-8999-999999999999",
      section: "logistics",
      slug: "medical-registration",
      title: "Medical registration",
      subtitle: null,
      body: null,
      details,
      linkedDocumentIds: [],
      tags: [],
      isPersonal,
      includeOnCard: false,
      sortOrder: 0,
      lastVerifiedAt: null,
    } as unknown as Parameters<typeof onCallEntryToRow>[0];
  }

  it("stores a compliance requirement private even when the caller asked for it to be shared", () => {
    const row = onCallEntryToRow(entryFor({ category: "Registration", kind: "compliance" }, false), "owner-1");
    expect(row.is_personal).toBe(true);
  });

  it("leaves an ordinary admin row's own choice alone", () => {
    expect(onCallEntryToRow(entryFor({ category: "Facilities" }, false), "owner-1").is_personal).toBe(false);
    expect(onCallEntryToRow(entryFor({ category: "Access" }, true), "owner-1").is_personal).toBe(true);
  });

  it("catches a misspelt kind, which is what the editor could actually produce", () => {
    expect(
      onCallEntryToRow(entryFor({ category: "Registration", kind: "Compliance" }, false), "owner-1").is_personal,
    ).toBe(true);
  });

  /**
   * The write stamp is NARROWER than the read filter, and this pins the gap so
   * nobody closes it for symmetry's sake.
   *
   * Withholding on read is free and undoes itself when the row is corrected.
   * Stamping on write sticks, and `is_personal: entry.isPersonal || isCompliance`
   * means the owner unticking "Private" is silently overruled — the save
   * succeeds and the tick springs back with no explanation. That is right for a
   * real compliance requirement, where the editor hides the tick box so no
   * control lies about what it does. Applying it to every row the read
   * withholds would put that silent override behind a tick box the Admin form
   * still shows.
   */
  it("does not overrule the owner's sharing choice on a row that merely looks compliance-shaped", () => {
    const strayExpiry = { category: "Facilities", expiresOn: "2027-03-12" };
    // Withheld from strangers...
    expect(rowMayBeComplianceRequirement({ section: "logistics", details: strayExpiry })).toBe(true);
    // ...but not rewritten behind the owner's back.
    expect(onCallEntryToRow(entryFor(strayExpiry, false), "owner-1").is_personal).toBe(false);
  });

  it("does not stamp a row whose details are missing or unreadable", () => {
    // The read withholds these; the write must not turn an empty Admin row
    // private on the strength of a parse failure.
    expect(onCallEntryToRow(entryFor(undefined, false), "owner-1").is_personal).toBe(false);
    expect(onCallEntryToRow(entryFor([], false), "owner-1").is_personal).toBe(false);
  });
});

describe("rowToOnCallEntry", () => {
  it("drops details that do not match the section's schema instead of trusting them", () => {
    const entry = rowToOnCallEntry({
      id: "11111111-1111-4111-8111-111111111111",
      section: "contacts",
      slug: "ward-4b",
      title: "Ward 4B",
      subtitle: null,
      body: null,
      details: { phne: "9999 9999" },
      linked_document_ids: [],
      tags: [],
      is_personal: false,
      include_on_card: false,
      sort_order: 0,
      last_verified_at: null,
    });
    expect(entry.details).toBeNull();
  });

  it("normalizes empty or whitespace-only subtitle to null instead of throwing", () => {
    const entry = rowToOnCallEntry({
      id: "11111111-1111-4111-8111-111111111111",
      section: "contacts",
      slug: "ward-4b",
      title: "Ward 4B",
      subtitle: "",
      body: null,
      details: {},
      linked_document_ids: [],
      tags: [],
      is_personal: false,
      include_on_card: false,
      sort_order: 0,
      last_verified_at: null,
    });
    expect(entry.subtitle).toBeNull();
  });
});

function fakeDocumentClient(rows: Array<{ id: string }>, error: { message: string } | null = null) {
  let capturedOr: string | undefined;
  let capturedIn: { column: string; values: string[] } | undefined;
  let capturedTable: string | undefined;

  const chain: Record<string, unknown> = {
    select: vi.fn(() => chain),
    in: vi.fn((column: string, values: string[]) => {
      capturedIn = { column, values };
      return chain;
    }),
    or: vi.fn((filter: string) => {
      capturedOr = filter;
      return chain;
    }),
    is: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    then(resolve: (val: unknown) => unknown, reject?: (err: unknown) => unknown) {
      return Promise.resolve({ data: error ? null : rows, error }).then(resolve, reject);
    },
  };

  const client = {
    from: vi.fn((table: string) => {
      capturedTable = table;
      return chain;
    }),
    chain,
    get capturedOr() {
      return capturedOr;
    },
    get capturedIn() {
      return capturedIn;
    },
    get capturedTable() {
      return capturedTable;
    },
  };

  return client;
}

describe("assertValidLinkedDocumentIds", () => {
  const callerOwnerId = "00000000-0000-4000-8000-000000000001";
  const doc1 = "11111111-1111-4111-8111-111111111111";
  const doc2 = "22222222-2222-4222-8222-222222222222";
  const otherOwnerDoc = "33333333-3333-4333-8333-333333333333";

  it("passes when documentIds is empty without querying documents", async () => {
    const client = fakeDocumentClient([]);
    await expect(assertValidLinkedDocumentIds(client as never, [], callerOwnerId)).resolves.toBeUndefined();
    expect(client.from).not.toHaveBeenCalled();
  });

  it("passes when all linked document IDs exist and are accessible under the owner scope", async () => {
    const client = fakeDocumentClient([{ id: doc1 }, { id: doc2 }]);
    await expect(assertValidLinkedDocumentIds(client as never, [doc1, doc2], callerOwnerId)).resolves.toBeUndefined();
    expect(client.from).toHaveBeenCalledWith("documents");
    expect(client.capturedIn).toEqual({ column: "id", values: [doc1, doc2] });
    expect(client.capturedOr).toContain(`owner_id.eq.${callerOwnerId}`);
  });

  it("throws PublicApiError 400 when one or more documents do not exist", async () => {
    const client = fakeDocumentClient([{ id: doc1 }]);
    const promise = assertValidLinkedDocumentIds(client as never, [doc1, doc2], callerOwnerId);
    await expect(promise).rejects.toThrow(PublicApiError);
    await expect(promise).rejects.toMatchObject({
      status: 400,
      message: "Invalid linked document IDs: one or more documents do not exist.",
    });
  });

  it("throws PublicApiError 400 when a document belongs to another owner and is excluded by owner scope", async () => {
    // Other owner's document is filtered out by withOwnerReadScope, so documents query returns empty
    const client = fakeDocumentClient([]);
    const promise = assertValidLinkedDocumentIds(client as never, [otherOwnerDoc], callerOwnerId);
    await expect(promise).rejects.toThrow(PublicApiError);
    await expect(promise).rejects.toMatchObject({
      status: 400,
      message: "Invalid linked document IDs: one or more documents do not exist.",
    });
    expect(client.capturedOr).toContain(`owner_id.eq.${callerOwnerId}`);
  });

  it("throws an error when the database query fails", async () => {
    const client = fakeDocumentClient([], { message: "Database connection failed" });
    await expect(assertValidLinkedDocumentIds(client as never, [doc1], callerOwnerId)).rejects.toThrow(
      "Database connection failed",
    );
  });
});

describe("On call repair privacy boundaries", () => {
  it.each(["Registration", " indemnity ", "TRAINING", "Credentialing", "CPD", "Clearances"])(
    "withholds compliance category %s even without kind",
    (category) => {
      expect(rowMayBeComplianceRequirement({ section: "logistics", details: { category } })).toBe(true);
    },
  );
  it("does not stamp a public role explainer private merely because it has a kind", () => {
    const entry = rowToOnCallEntry({ ...SHARED_ROW, details: { role: "Registrar", kind: "role-explainer" } });
    expect(onCallEntryToRow(entry, "owner-1").is_personal).toBe(false);
  });
  it("requires public documents for a shared entry, without widening document access", async () => {
    const client = fakeDocumentClient([]);
    await expect(
      assertValidLinkedDocumentIds(client as never, [SHARED_ROW.id], "00000000-0000-4000-8000-000000000001", false),
    ).rejects.toThrow(PublicApiError);
    expect(client.chain.is).toHaveBeenCalledWith("owner_id", null);
    expect(client.chain.or).not.toHaveBeenCalled();
  });
});
