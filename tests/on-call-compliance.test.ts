import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { FORBIDDEN_VERDICTS, readerFacingStrings, type ReaderFacingString } from "./helpers/reader-facing-strings";

import { ON_CALL_COMPLIANCE_BANDS } from "@/components/on-call/on-call-page-sections";
import {
  COMPLIANCE_KIND,
  complianceConsequence,
  complianceExpiresOn,
  complianceSortRank,
  isComplianceEntry,
  partitionLogisticsEntries,
  recordedExpiryHasPassed,
  sortComplianceEntries,
} from "@/lib/on-call/compliance";
import { DEMO_ON_CALL_ENTRIES } from "@/lib/on-call/demo-entries";
import {
  ON_CALL_COMPLIANCE_CONSEQUENCES,
  onCallDetailsSchemaFor,
  type OnCallComplianceConsequence,
  type OnCallEntry,
} from "@/lib/on-call/entry-model";

/**
 * Compliance rides the stored `logistics` section rather than adding a seventh
 * one, because the section list is a database CHECK constraint and merging the
 * migration that widened it would reach the live clinical database within
 * seconds. A requirement is genuinely an Admin row whose point is that it
 * expires, so the discriminator lives in `details.kind`, which is JSONB and
 * therefore free. Who's who took the same route out of `contacts`, and
 * `tests/on-call-who-is-who.test.ts` is this file's mirror.
 *
 * Three contracts are pinned here, because a refactor can break any of them
 * while leaving the page rendering something that still looks plausible:
 *
 *  1. THE PARTITION — a requirement filed among the parking notes and the pay
 *     claims, where nothing is expected to expire, is the one hazard the split
 *     was accepted in exchange for.
 *  2. THE ORDER — the page ranks by what LAPSING COSTS and only then by date.
 *     A test that checked dates alone would let someone quietly reverse that.
 *  3. THE DATE SEMANTICS — `YYYY-MM-DD` strings compared against the viewer's
 *     own local day, never two `Date` objects.
 *
 * And a fourth, which is a clinical-governance control rather than a
 * behaviour: nothing on this surface may render a VERDICT. See the last
 * describe block.
 */

const NEVER_VERIFIED = null;

function logisticsEntry(overrides: Partial<OnCallEntry> & { details: unknown }): OnCallEntry {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    section: "logistics",
    slug: "entry",
    title: "Entry",
    subtitle: null,
    body: null,
    linkedDocumentIds: [],
    tags: [],
    isPersonal: false,
    includeOnCard: false,
    sortOrder: 0,
    lastVerifiedAt: NEVER_VERIFIED,
    ...overrides,
  };
}

/** A `logistics` row already carrying the compliance discriminator. */
function requirement(details: Record<string, unknown>, overrides: Partial<OnCallEntry> = {}): OnCallEntry {
  return logisticsEntry({
    ...overrides,
    details: { category: "Registration", kind: COMPLIANCE_KIND, ...details },
  });
}

/** `00000000-0000-4000-8000-00000000000N`, so ids read as ids in a failure. */
function id(suffix: string): string {
  return `00000000-0000-4000-8000-${suffix.padStart(12, "0")}`;
}

describe("logistics details schema", () => {
  const schema = onCallDetailsSchemaFor("logistics");

  it("accepts a compliance requirement", () => {
    const parsed = schema.safeParse({
      category: "Registration",
      kind: COMPLIANCE_KIND,
      consequence: "stops-work",
      expiresOn: "2027-03-12",
      provenance: "typed",
    });
    expect(parsed.success).toBe(true);
  });

  it("still accepts an ordinary admin row with no kind", () => {
    expect(schema.safeParse({ category: "Leave", hours: "Business hours" }).success).toBe(true);
  });

  it("rejects a kind it does not know, rather than treating it as an ordinary admin row", () => {
    // `.strict()` rejects unknown KEYS; this pins that an unknown VALUE is
    // rejected too. Silently falling back to "ordinary admin row" would hide a
    // requirement whose expiry stops someone working on a page where nothing
    // is expected to expire.
    expect(schema.safeParse({ category: "Registration", kind: "compliance-requirement" }).success).toBe(false);
  });

  it("rejects a consequence it does not know, rather than dropping the row into the unranked band", () => {
    // The same argument one field over. An unrecognised band would be read as
    // "no consequence recorded" by `complianceSortRank`, which sorts last — so
    // a typo would move a registration renewal to the bottom of the page.
    expect(schema.safeParse({ category: "Registration", consequence: "stops-everything" }).success).toBe(false);
  });

  it("rejects an expiry that is not YYYY-MM-DD", () => {
    expect(schema.safeParse({ category: "Registration", expiresOn: "12/03/2027" }).success).toBe(false);
  });
});

describe("isComplianceEntry", () => {
  it("is true for a logistics entry flagged as a compliance requirement", () => {
    expect(isComplianceEntry(requirement({ consequence: "stops-work" }))).toBe(true);
  });

  it("is false for an ordinary admin row", () => {
    expect(isComplianceEntry(logisticsEntry({ details: { category: "Parking" } }))).toBe(false);
  });

  it("is false for a row in another section that happens to carry the same key", () => {
    // The section test in `isComplianceEntry` is documented as non-redundant,
    // and this is the case that makes it so: `details` is unvalidated `unknown`
    // on the entry type and every section shares the column, so nothing stops a
    // contacts row carrying `kind: "compliance"`. Adopted, it would render as a
    // requirement — a phone number filed under "Stops you working".
    for (const section of ["contacts", "playbook", "referrals", "orientation", "education"] as const) {
      expect(
        isComplianceEntry(logisticsEntry({ section, details: { role: "Registrar", kind: COMPLIANCE_KIND } })),
        `a ${section} row carrying the compliance discriminator was adopted into Compliance`,
      ).toBe(false);
    }
  });

  it("is false for the other section's discriminator", () => {
    expect(isComplianceEntry(logisticsEntry({ details: { category: "Parking", kind: "role-explainer" } }))).toBe(false);
  });

  it("is false when details is not an object at all", () => {
    expect(isComplianceEntry(logisticsEntry({ details: null }))).toBe(false);
    expect(isComplianceEntry(logisticsEntry({ details: undefined }))).toBe(false);
    expect(isComplianceEntry(logisticsEntry({ details: COMPLIANCE_KIND }))).toBe(false);
    expect(isComplianceEntry(logisticsEntry({ details: [COMPLIANCE_KIND] }))).toBe(false);
  });
});

describe("partitionLogisticsEntries", () => {
  const adminRow = logisticsEntry({ id: id("a"), slug: "parking", details: { category: "Facilities" } });
  const requirementRow = requirement({ consequence: "stops-work" }, { id: id("b"), slug: "registration" });
  const contactRow = logisticsEntry({
    id: id("c"),
    section: "contacts",
    slug: "ward-4b",
    details: { role: "Ward 4B" },
  });

  it("keeps requirements out of the Admin list", () => {
    const { admin } = partitionLogisticsEntries([adminRow, requirementRow]);
    expect(admin.map((entry) => entry.id)).toEqual([adminRow.id]);
  });

  it("collects the requirements", () => {
    const { compliance } = partitionLogisticsEntries([adminRow, requirementRow]);
    expect(compliance.map((entry) => entry.id)).toEqual([requirementRow.id]);
  });

  it("drops entries from other sections entirely rather than passing them through", () => {
    // Dropped, not forwarded: a caller rendering `admin` must not be able to
    // put a contacts row on the Admin page by handing the whole corpus in.
    const { admin, compliance } = partitionLogisticsEntries([adminRow, requirementRow, contactRow]);
    expect(admin).not.toContain(contactRow);
    expect(compliance).not.toContain(contactRow);
    expect(admin.length + compliance.length).toBe(2);
  });

  it("preserves the order it was given inside each list", () => {
    // Both pages sort afterwards, but they sort a list this function built —
    // reordering here would silently change the tiebreak both of them rely on.
    const second = logisticsEntry({ id: id("d"), slug: "pay", details: { category: "Pay" } });
    const { admin } = partitionLogisticsEntries([adminRow, requirementRow, second]);
    expect(admin.map((entry) => entry.slug)).toEqual(["parking", "pay"]);
  });

  describe("against the demo corpus", () => {
    const stored = DEMO_ON_CALL_ENTRIES.filter((entry) => entry.section === "logistics");
    const { admin, compliance } = partitionLogisticsEntries(DEMO_ON_CALL_ENTRIES);

    it("has something of both kinds to tell apart", () => {
      // Without this the three assertions below would all pass on an empty
      // corpus, which is the shape a broken demo fixture takes.
      expect(admin.length).toBeGreaterThan(0);
      expect(compliance.length).toBeGreaterThan(0);
    });

    it("puts every stored logistics row in exactly one of the two lists", () => {
      // Counted from the corpus rather than written down: a row added to either
      // page must land somewhere, and a literal here would only ever be stale.
      expect(admin.length + compliance.length).toBe(stored.length);
    });

    it("puts no row in both", () => {
      const overlap = admin.filter((entry) => compliance.some((other) => other.id === entry.id));
      expect(overlap.map((entry) => entry.slug)).toEqual([]);
    });

    it("splits on the discriminator and nothing else", () => {
      expect(compliance.every(isComplianceEntry)).toBe(true);
      expect(admin.some(isComplianceEntry)).toBe(false);
    });

    it("leaves every other section out", () => {
      const sections = new Set([...admin, ...compliance].map((entry) => entry.section));
      expect([...sections]).toEqual(["logistics"]);
    });
  });
});

describe("complianceConsequence", () => {
  it("reads a recorded consequence", () => {
    expect(complianceConsequence(requirement({ consequence: "chased" }))).toBe("chased");
  });

  it("is undefined when none was recorded", () => {
    expect(complianceConsequence(requirement({}))).toBeUndefined();
  });

  it("is undefined for a value that is not one of the declared bands", () => {
    expect(complianceConsequence(requirement({ consequence: "stops-everything" }))).toBeUndefined();
    expect(complianceConsequence(logisticsEntry({ details: null }))).toBeUndefined();
  });
});

describe("complianceSortRank", () => {
  it("ranks the bands in the order they are declared", () => {
    // Derived from `ON_CALL_COMPLIANCE_CONSEQUENCES`, never from three strings
    // written out here: that array's order is load-bearing, and a band inserted
    // in the middle must re-rank the page rather than leave a stale expectation
    // passing.
    const ranks = ON_CALL_COMPLIANCE_CONSEQUENCES.map((consequence) =>
      complianceSortRank(requirement({ consequence })),
    );
    expect(ranks).toEqual(ON_CALL_COMPLIANCE_CONSEQUENCES.map((_, index) => index));
  });

  it("sorts an unrecorded consequence after every declared band", () => {
    // Unknown is not the same as harmless. It cannot be ranked against a stated
    // cost either, so it goes last rather than being guessed at.
    const unrecorded = complianceSortRank(requirement({}));
    for (const consequence of ON_CALL_COMPLIANCE_CONSEQUENCES) {
      expect(
        unrecorded,
        `"${consequence}" did not rank ahead of a requirement with no recorded consequence`,
      ).toBeGreaterThan(complianceSortRank(requirement({ consequence })));
    }
  });

  it("treats a consequence it does not recognise as unrecorded rather than ranking it", () => {
    expect(complianceSortRank(requirement({ consequence: "stops-everything" }))).toBe(
      complianceSortRank(requirement({})),
    );
  });
});

describe("sortComplianceEntries", () => {
  it("orders by band, even when every date argues the other way", () => {
    // The dates run in the opposite order to the bands, and the unranked row
    // carries the soonest date of all. A comparator that had quietly become
    // date-first would return this list exactly as it arrived.
    const bands = ON_CALL_COMPLIANCE_CONSEQUENCES;
    const dated = bands.map((consequence, index) =>
      requirement(
        { consequence, expiresOn: `2027-01-${`${bands.length - index}`.padStart(2, "0")}` },
        { id: id(`${index + 1}`), slug: consequence, title: consequence },
      ),
    );
    const unranked = requirement({ expiresOn: "2026-01-01" }, { id: id("9"), slug: "unranked", title: "unranked" });
    const soonestFirst = [unranked, ...dated].reverse();

    expect(sortComplianceEntries(soonestFirst).map((entry) => entry.slug)).toEqual([...bands, "unranked"]);
  });

  it("puts the soonest recorded expiry first inside a band", () => {
    const later = requirement({ consequence: "chased", expiresOn: "2027-06-01" }, { id: id("1"), slug: "later" });
    const sooner = requirement({ consequence: "chased", expiresOn: "2027-02-01" }, { id: id("2"), slug: "sooner" });

    expect(sortComplianceEntries([later, sooner]).map((entry) => entry.slug)).toEqual(["sooner", "later"]);
  });

  it("puts a requirement with no recorded date after the dated ones in its own band", () => {
    // Never hoisted above them: a row nobody has dated cannot be shown as more
    // urgent than one with a real deadline.
    const undated = requirement({ consequence: "chased" }, { id: id("1"), slug: "undated" });
    const dated = requirement({ consequence: "chased", expiresOn: "2027-02-01" }, { id: id("2"), slug: "dated" });

    expect(sortComplianceEntries([undated, dated]).map((entry) => entry.slug)).toEqual(["dated", "undated"]);
    expect(sortComplianceEntries([dated, undated]).map((entry) => entry.slug)).toEqual(["dated", "undated"]);
  });

  it("never promotes an undated requirement out of its band", () => {
    // The mirror of the rule above, and the one that matters clinically: an
    // undated registration renewal still outranks a dated fire-safety module,
    // because the band is what the page is ordered by.
    const worstBand = ON_CALL_COMPLIANCE_CONSEQUENCES[0];
    const leastBand = ON_CALL_COMPLIANCE_CONSEQUENCES[ON_CALL_COMPLIANCE_CONSEQUENCES.length - 1];
    const undatedWorst = requirement({ consequence: worstBand }, { id: id("1"), slug: "undated-worst" });
    const datedLeast = requirement({ consequence: leastBand, expiresOn: "2026-01-01" }, { id: id("2"), slug: "dated" });

    expect(sortComplianceEntries([datedLeast, undatedWorst]).map((entry) => entry.slug)).toEqual([
      "undated-worst",
      "dated",
    ]);
  });

  it("breaks a remaining tie on title", () => {
    const zulu = requirement({ consequence: "chased", expiresOn: "2027-02-01" }, { id: id("1"), title: "Zulu" });
    const alpha = requirement({ consequence: "chased", expiresOn: "2027-02-01" }, { id: id("2"), title: "Alpha" });

    expect(sortComplianceEntries([zulu, alpha]).map((entry) => entry.title)).toEqual(["Alpha", "Zulu"]);
  });

  it("is stable for two rows the comparator cannot tell apart", () => {
    // Same band, no date, same title. A list that reshuffles under the thumb
    // between two renders of the same data is worse than a list in the wrong
    // order, so the input order has to survive.
    const first = requirement({ consequence: "chased" }, { id: id("1"), slug: "first", title: "Same" });
    const second = requirement({ consequence: "chased" }, { id: id("2"), slug: "second", title: "Same" });

    expect(sortComplianceEntries([first, second]).map((entry) => entry.slug)).toEqual(["first", "second"]);
    // The reverse too: equal output for both inputs would be an accidental
    // total order rather than stability.
    expect(sortComplianceEntries([second, first]).map((entry) => entry.slug)).toEqual(["second", "first"]);
    const once = sortComplianceEntries([first, second]);
    expect(sortComplianceEntries(once).map((entry) => entry.slug)).toEqual(once.map((entry) => entry.slug));
  });

  it("does not reorder the array it was handed", () => {
    // Both pages hold the partition's output in a memo and re-sort it; sorting
    // in place would have one page's order depend on whether the other had
    // rendered first.
    const entries = [...ON_CALL_COMPLIANCE_CONSEQUENCES]
      .reverse()
      .map((consequence, index) => requirement({ consequence }, { id: id(`${index + 1}`), slug: consequence }));
    const before = entries.map((entry) => entry.slug);

    sortComplianceEntries(entries);

    expect(entries.map((entry) => entry.slug)).toEqual(before);
  });
});

describe("complianceExpiresOn", () => {
  it("reads a YYYY-MM-DD date", () => {
    expect(complianceExpiresOn(requirement({ expiresOn: "2027-03-12" }))).toBe("2027-03-12");
  });

  it("rejects a malformed date rather than returning it", () => {
    // The page prints whatever this returns, so a value it cannot read has to
    // become "No expiry recorded" rather than an unparseable string handed
    // back to the reader — and the sort has to agree with the page about which
    // rows have a usable date.
    for (const expiresOn of ["12/03/2027", "2027-3-1", "12 Mar 2027", "2027-03-12T00:00:00Z", "next March", ""]) {
      expect(complianceExpiresOn(requirement({ expiresOn })), `"${expiresOn}" was handed to the page`).toBeUndefined();
    }
  });

  it("is undefined when there is no date at all", () => {
    expect(complianceExpiresOn(requirement({}))).toBeUndefined();
    expect(complianceExpiresOn(requirement({ expiresOn: 20270312 }))).toBeUndefined();
    expect(complianceExpiresOn(logisticsEntry({ details: null }))).toBeUndefined();
    expect(complianceExpiresOn(logisticsEntry({ details: "2027-03-12" }))).toBeUndefined();
  });
});

describe("recordedExpiryHasPassed", () => {
  // A local clock, always injected. Nothing here may depend on the day the
  // suite happens to run, and `now` is a parameter precisely so it need not.
  // Perth wall clock (UTC+8): "today" is read in the work time zone, Perth by default.
  const AT_0930 = new Date(Date.UTC(2026, 8, 20, 9 - 8, 30));
  const TODAY = "2026-09-20";
  const YESTERDAY = "2026-09-19";
  const TOMORROW = "2026-09-21";

  it("says a date one day before the viewer's day has passed", () => {
    expect(recordedExpiryHasPassed(requirement({ expiresOn: YESTERDAY }), AT_0930)).toBe(true);
  });

  it("says the recorded day itself has not passed", () => {
    // The boundary, and the reason this function compares strings. Parsing the
    // stored date gives midnight UTC, which for anyone east of UTC is already
    // in the past by breakfast — so a `Date`-to-`Date` comparison would tell a
    // Perth reader at 09:30 that a requirement recorded as expiring TODAY had
    // gone, on the morning they could still act on it.
    expect(recordedExpiryHasPassed(requirement({ expiresOn: TODAY }), AT_0930)).toBe(false);
  });

  it("says a date one day after has not passed", () => {
    expect(recordedExpiryHasPassed(requirement({ expiresOn: TOMORROW }), AT_0930)).toBe(false);
  });

  it("reads the work zone's (Perth) day at both ends of it", () => {
    // Two clocks on the same Perth day, the first on the previous UTC day, so
    // the pair bites wherever the suite runs. Just after midnight catches an
    // implementation that took today's key from `toISOString()` (still the
    // 19th in UTC); just before it catches one that read the device's own day
    // on a phone east of Perth (already the 21st in Sydney).
    const justAfterMidnight = new Date(Date.UTC(2026, 8, 20, 0 - 8, 1));
    const justBeforeMidnight = new Date(Date.UTC(2026, 8, 20, 23 - 8, 59));

    for (const now of [justAfterMidnight, justBeforeMidnight]) {
      expect(recordedExpiryHasPassed(requirement({ expiresOn: TODAY }), now), `${now.toISOString()}`).toBe(false);
      expect(recordedExpiryHasPassed(requirement({ expiresOn: YESTERDAY }), now), `${now.toISOString()}`).toBe(true);
    }
  });

  it("says a requirement with no recorded date has not passed", () => {
    // Nothing was recorded, so there is nothing to have passed. Returning true
    // here would be the page's strongest statement made about its emptiest row.
    expect(recordedExpiryHasPassed(requirement({}), AT_0930)).toBe(false);
    expect(recordedExpiryHasPassed(logisticsEntry({ details: null }), AT_0930)).toBe(false);
  });

  it("says a malformed date has not passed", () => {
    expect(recordedExpiryHasPassed(requirement({ expiresOn: "12/03/2019" }), AT_0930)).toBe(false);
  });

  it("reads the demo corpus's one already-passed row, and only that one", () => {
    // The corpus dates one requirement twelve days into the past so the passed
    // treatment appears in a browser. Run against the real rows because a
    // hand-built fixture cannot show that the helper survives the shape the
    // app actually stores.
    const { compliance } = partitionLogisticsEntries(DEMO_ON_CALL_ENTRIES);
    const passed = compliance.filter((entry) => recordedExpiryHasPassed(entry, new Date()));

    expect(passed.map((entry) => entry.slug)).toEqual(["demo-basic-life-support-module"]);
  });
});

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE NO-VERDICT RULE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * DO NOT DELETE THIS BLOCK AS PEDANTRY. A clinical-governance review rejected
 * an earlier design of this page for exactly the thing it tests: nothing here
 * is checked with the body that issues the requirement, so no string on any
 * compliance surface may assert that the reader IS anything — "compliant",
 * "valid", "current", "up to date", "expired", "lapsed". Every line is phrased
 * as a record of what was entered ("Recorded as expiring 12 Mar 2027 · as you
 * entered it", "— that date has passed"), and the wording IS the control.
 *
 * Until this test existed the rule was enforced by prose alone, so the next
 * person to add a string to the page could break it with nothing going red.
 *
 * HOW IT READS THE FILES. Through the TypeScript parser, not a grep, for one
 * reason above all: the comments on these files discuss every banned word at
 * length, and necessarily so. A check that forbade discussing the rule would
 * be deleted within the month. The parser sees comments as trivia, so they are
 * excluded structurally rather than by an exclusion list — and
 * `reads the page's prose and not its comments` below proves both halves of
 * that, so this block cannot fall through to passing vacuously.
 *
 * WHAT IT CANNOT SEE.
 *
 *  - A verdict assembled at runtime from fragments that are individually
 *    innocent — `${noun} is ${state}` reads as two harmless literals here.
 *  - A verdict a DEPENDENCY produces. Zod's own default messages are the live
 *    example: `evidenceUrl` is `z.string().url()`, so a bad link is reported in
 *    words that exist in no file this gate reads.
 *  - A verdict carried by a glyph rather than a word. This half has always been
 *    left to review, and the page's own empty state uses a sanctioned icon, so
 *    there is nothing here to match on. `on-call-section-identity.ts` carries
 *    the reasoning for `CalendarClock` over `ShieldCheck`.
 *  - Prose a shared design-system primitive owns. `EmptyState`, `Button` and
 *    the offline banner all render on this page; holding the whole design
 *    system to a vocabulary calibrated for compliance would be wrong, so the
 *    line drawn in `COMPLIANCE_SURFACES` is that a file is in scope when its
 *    strings speak about the READER'S REQUIREMENTS, and out of scope when they
 *    speak about the app's own machinery — its cache, its network responses.
 *  - What an owner types into their own rows. The rule binds what the APP says.
 *
 * "A verdict imported from a module this does not scan" used to be on that
 * list and has largely gone from it: every module that puts compliance prose on
 * the page is now either read here (`COMPLIANCE_SURFACES`) or checked at its
 * rendered values (`ON_CALL_COMPLIANCE_BANDS`, below).
 */

/**
 * Every file that can put compliance prose in front of a reader.
 *
 * An INCLUSION list, and the distinction from an exclusion list is the whole
 * design: a file is added when it carries prose about the reader's
 * requirements, and no file is ever removed because a string in it went red.
 * Each entry says what it puts on the page, so a reviewer can tell whether the
 * list is still complete without opening eight files.
 *
 * Four of these carry prose for the other eight On Call views as well, and are
 * scanned whole anyway. That is deliberate: scanning "the compliance part" of a
 * shared file would need a list of declarations to look inside, which is an
 * exclusion list wearing a different hat, and it would have missed the privacy
 * sentence in the editor's JSX on the day it was written.
 *
 * Two modules that DO render on this page are deliberately absent, and the
 * reason is the same one in both cases — their strings report on the app's own
 * machinery rather than on the reader's standing, so the compliance vocabulary
 * is the wrong ruler for them:
 *
 *  - `on-call-offline-banner.tsx` ("Showing a saved copy from …") is about the
 *    cache. A future "this copy is not up to date" would be true of the cache
 *    and no claim at all about a registration.
 *  - `on-call-page-sections.ts` owns the band headings, which ARE compliance
 *    prose — so they are checked at their rendered values instead, by
 *    `holds the band headings to the same rule` below. Reading the file would
 *    additionally hold every Contacts area and Orientation folder to this rule
 *    for no gain.
 */
const COMPLIANCE_SURFACES = [
  /** The rule's own home, and the helpers every surface below reads. */
  "src/lib/on-call/compliance.ts",
  /** The page: every row, every band note, the scope note, the empty state. */
  "src/components/on-call/on-call-compliance-section.tsx",
  /** Route metadata — the browser tab, and the text a shared link carries. */
  "src/app/(search-app)/on-call/compliance/page.tsx",
  /** The page summary and the add hint, both rendered in the actions sheet. */
  "src/components/on-call/on-call-section-page.tsx",
  /** The hub home. Its Compliance tile moved to My Work on 2026-09-26; it
   *  stays in scope because Recent still lists compliance rows by name. */
  "src/components/on-call/on-call-home.tsx",
  /** Admin Today now owns the requirement summary and recorded renewal date. */
  "src/components/admin/today/today-requirements-module.tsx",
  "src/components/admin/today/today-renew-next-card.tsx",
  /** Admin Renewals owns the moved checklist and its reader-facing status. */
  "src/components/admin/admin-renewals-page.tsx",
  "src/components/admin/renewals/checklist-status.tsx",
  /** The demo requirements, which ARE the page's content in demo mode. */
  "src/lib/on-call/demo-entries.ts",
  /** The compliance form's labels, hints and privacy sentence — and
   *  `OnCallVerifyButton`, which this page renders on every row. */
  "src/components/on-call/on-call-entry-editor.tsx",
  /** The search result summary. `onCallSearchSummary` renders "Recorded as
   *  expiring 12 Mar 2027" under a compliance hit — the same sentence as the
   *  page, in a second file. Its own comment quotes the rule and says the
   *  phrase is the page's "word for word", which is exactly the kind of
   *  promise that needs a machine behind it: without this line, changing it
   *  to "Valid to" or "Expires" goes green. */
  "src/lib/on-call/entry-search.ts",
  /** "Checked 14/08/2026", "Never checked" — the status words painted on every
   *  row of this page. The freshness stamp is about the RECORD, and the day one
   *  of these becomes "Up to date" it is a verdict on a requirement instead. */
  "src/components/on-call/on-call-freshness-badge.tsx",
] as const;

function verdictsIn(strings: readonly ReaderFacingString[]): string[] {
  return strings.flatMap(({ file, line, text }) =>
    FORBIDDEN_VERDICTS.filter(({ pattern }) => pattern.test(text)).map(
      ({ pattern, why }) => `${file}:${line} matches ${pattern} (${why}) in ${JSON.stringify(text)}`,
    ),
  );
}

const NO_VERDICT_RULE =
  "A compliance surface may not tell the reader they ARE anything. Nothing here is checked with the issuing " +
  "body, so every string reports what was recorded, when, and on whose word — a clinical-governance review " +
  "rejected an earlier design for exactly this. Rephrase as a record ('Recorded as expiring 12 Mar 2027', " +
  "'— that date has passed'), never as a state. See src/lib/on-call/compliance.ts, 'What this page may never say'.";

describe("the compliance surfaces render no verdict", () => {
  it("reads the page's prose and not its comments", () => {
    const page = "src/components/on-call/on-call-compliance-section.tsx";
    const texts = readerFacingStrings(page).map((found) => found.text);

    // It sees what a reader sees …
    expect(texts).toContain("Nothing here is checked with the issuing body.");
    expect(texts).toContain("No expiry recorded");
    // … and it does not see the comments, which quote the banned words while
    // explaining why they are banned, and must be able to go on doing so.
    expect(readFileSync(page, "utf8"), "the page no longer discusses the banned vocabulary").toMatch(/"compliant"/);
    expect(verdictsIn(readerFacingStrings(page).filter((found) => /compliant/i.test(found.text)))).toEqual([]);
  });

  it("finds prose in every file it claims to cover", () => {
    // The anti-vacuity guard, and it is per file rather than over the pile.
    // An aggregate count cannot tell eight covered files from seven covered
    // files and one whose prose moved elsewhere — and with the demo corpus in
    // the list the pile is ~800 strings, so any aggregate floor worth writing
    // is one a silently-empty file would clear on its own.
    //
    // A path that no longer exists throws out of `readFileSync` instead, which
    // is the loud failure a rename deserves.
    for (const file of COMPLIANCE_SURFACES) {
      expect(readerFacingStrings(file).length, `${file} yielded no reader-facing strings at all`).toBeGreaterThan(0);
    }
  });

  it("says nothing on any surface that asserts the reader holds anything", () => {
    expect(verdictsIn(COMPLIANCE_SURFACES.flatMap(readerFacingStrings)), NO_VERDICT_RULE).toEqual([]);
  });

  it("still catches the verdicts it exists to catch", () => {
    // The positive control, and the one case that stops this whole block dying
    // quietly. Every other assertion here passes when the patterns match
    // NOTHING, so a regex loosened until the page went green would look exactly
    // like a page that had been fixed. These sentences must stay red.
    //
    // The pairs below also ARE the verdict/obligation line, written out: each
    // banned sentence has an allowed one beside it using the same word.
    const verdicts = [
      "Your registration is current.",
      "Registration — current to 12 Mar 2027",
      "Still current",
      "This certificate remains current.",
      "Indemnity stays current until renewal.",
      "You are compliant.",
      "Noncompliant",
      "Valid",
      "Validity confirmed by the board.",
      "Your registration is invalid.",
      "Expired",
      "This one has lapsed.",
      "Everything is up to date.",
      "Up-to-date",
      "In good standing",
      // The bare pill, and the chip that is the same claim with a date bolted
      // on. Both passed until 2026-09-20 — found by re-running the list rather
      // than by reading it.
      "Current",
      "Current · 12 Mar 2027",
    ];

    for (const text of verdicts) {
      expect(
        verdictsIn([{ file: "control", line: 0, text }]),
        `the gate no longer catches ${JSON.stringify(text)}`,
      ).not.toEqual([]);
    }
  });

  it("does not catch an obligation, a record, or the app reporting on itself", () => {
    // The other half of the control, and the more important half. A gate that
    // forbids the page from describing its own subject gets an exemption
    // carved into it within the month, and an exemption list is how this kind
    // of check dies. So these must stay green:
    //
    //  - an OBLIGATION ("what has to stay current") describes what the
    //    requirement demands, and asserts nothing about whether it is met;
    //  - a RECORD ("recorded as expiring …") is the phrasing the rule asks for;
    //  - "lapse" and "lapsing" name what the REQUIREMENT would do, which is the
    //    page's whole organising idea — only "lapsed" is a claim about a holder;
    //  - a report on the app's own machinery ("Save response was invalid") is
    //    about a thing the app produced and can see, not about a certificate.
    const allowed = [
      "What has to stay current",
      "What you keep current",
      "The requirements you keep current",
      "What you need to stay current",
      "These must remain current.",
      "Lapsing stops you working",
      "Let one of these lapse and you stop working.",
      "Recorded as expiring 12 Mar 2027 · as you entered it",
      "— that date has passed",
      "Nothing here is checked with the issuing body.",
      "No expiry recorded",
      "Save response was invalid.",
      "Verify response was invalid.",
    ];

    for (const text of allowed) {
      expect(verdictsIn([{ file: "control", line: 0, text }]), NO_VERDICT_RULE).toEqual([]);
    }
  });

  it("holds the band headings to the same rule, although they live in another module", () => {
    // The page renders these; it does not own them. A heading changed to
    // "Expired" would be a verdict on the Compliance page whatever file it was
    // typed in, so the rendered values are checked rather than the file.
    //
    // This is also why `on-call-page-sections.ts` is not in `COMPLIANCE_SURFACES`
    // and is not an omission: `heading` and `barLabel` are every string that
    // module puts on this page — `complianceGroups` renders no literal of its
    // own — and reading them here covers the values after `COMPLIANCE_BAND_WORDS`
    // has been spread into them, which reading the file would not.
    const bands: ReaderFacingString[] = ON_CALL_COMPLIANCE_BANDS.flatMap((band, index) =>
      [band.heading, band.barLabel].map((text) => ({
        file: `ON_CALL_COMPLIANCE_BANDS[${index}]`,
        line: index,
        text,
      })),
    );

    expect(bands.length, "the page has no bands to check").toBeGreaterThan(0);
    expect(verdictsIn(bands), NO_VERDICT_RULE).toEqual([]);
  });

  it("covers every band the sort can produce, so a new one cannot arrive unchecked", () => {
    // The declaration is derived from `ON_CALL_COMPLIANCE_CONSEQUENCES` plus
    // one row for "no consequence recorded". If a band were added to the enum
    // and not to the page, the check above would pass while the new heading
    // went unread.
    const declared = ON_CALL_COMPLIANCE_BANDS.map((band) => band.consequence);
    const expected: (OnCallComplianceConsequence | null)[] = [...ON_CALL_COMPLIANCE_CONSEQUENCES, null];

    expect(declared).toEqual(expected);
  });
});
