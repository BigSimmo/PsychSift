import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  applyOfflinePackMarkup,
  buildOfflinePackMarkup,
  offlineCrisisContacts,
  formatCheckedDate,
  loadReviewedTimeframes,
  PACK_END,
  PACK_START,
} from "../scripts/build-offline-pack";
import { removePathSync } from "../scripts/retryable-fs.mjs";
import { POISONS_INFORMATION_CONTACT, WA_CRISIS_CONTACTS } from "../src/lib/crisis-contacts";
import { timeframeContentSha256, type MhaTimeframeEntry } from "../src/lib/mha-timeline";

/**
 * These tests exercise the generator's logic directly (pure functions plus a
 * throwaway timeframes file), not `npm run offline:build`/`check:offline-pack`
 * — those CLI wrappers are covered by running them for real, per builder-common.md's
 * "smallest sufficient proof". The committed `public/offline.html` (read here
 * too, for the "numbers match the module" and "shows verifiedOn" checks) is the
 * proof the generator was actually run.
 */

const NONEXISTENT_TIMEFRAMES_PATH = join(tmpdir(), "offline-pack-content-test-does-not-exist.json");

let tempDir: string | undefined;

afterEach(() => {
  if (tempDir) {
    removePathSync(tempDir, { recursive: true });
    tempDir = undefined;
  }
});

/**
 * Signs a synthetic fixture the way `npm run clinical:review` would — a matching
 * content pin — so it passes the app's own `isReviewedTimeframe` rule. The
 * quotes are invented: these tests exercise rendering, not statutory content.
 */
function signed(entry: Record<string, unknown>): Record<string, unknown> {
  const base = {
    status: "reviewed",
    reviewedBy: "Dr Example",
    reviewedAt: "2026-09-20T00:00:00.000Z",
    ...entry,
    reviewedContentSha256: null,
  };
  return { ...base, reviewedContentSha256: timeframeContentSha256(base as unknown as MhaTimeframeEntry) };
}

function writeTimeframesFixture(entries: unknown[]): string {
  tempDir = mkdtempSync(join(tmpdir(), "mha-timeframes-"));
  const path = join(tempDir, "mha-timeframes.json");
  writeFileSync(path, JSON.stringify({ exportMetadata: {}, entries }), "utf8");
  return path;
}

describe("build-offline-pack: crisis numbers", () => {
  const offlineHtml = readFileSync(join(process.cwd(), "public", "offline.html"), "utf8");
  const markup = buildOfflinePackMarkup(NONEXISTENT_TIMEFRAMES_PATH);

  it("shows exactly the numbers WA_CRISIS_CONTACTS exports, with a tel: link and a checked date, for both the generated markup and the committed page", () => {
    expect(WA_CRISIS_CONTACTS.length).toBeGreaterThan(0);

    for (const contact of WA_CRISIS_CONTACTS) {
      const telHref = `href="tel:${contact.telephoneUri}"`;
      const checkedLine = `Checked ${formatCheckedDate(contact.verifiedOn)}`;

      expect(markup, `generated markup is missing ${contact.name}'s tel link`).toContain(telHref);
      expect(markup, `generated markup is missing ${contact.name}'s display number`).toContain(
        contact.telephoneDisplay,
      );
      expect(markup, `generated markup is missing ${contact.name}'s checked date`).toContain(checkedLine);
      expect(markup, `generated markup is missing ${contact.name}'s source link`).toContain(contact.sourceUrl);

      expect(
        offlineHtml,
        `public/offline.html is missing ${contact.name}'s tel link — run npm run offline:build`,
      ).toContain(telHref);
      expect(
        offlineHtml,
        `public/offline.html is missing ${contact.name}'s checked date — run npm run offline:build`,
      ).toContain(checkedLine);
    }
  });

  it("shows a stated caveat wherever one is set, and none where it is null", () => {
    for (const contact of WA_CRISIS_CONTACTS) {
      if (contact.caveat) {
        expect(markup, `${contact.name}'s caveat is missing from the generated markup`).toContain(contact.caveat);
      }
    }
    // Contacts with no caveat (000, Lifeline, SCBS, 13YARN) must not render an empty caveat paragraph.
    expect(markup).not.toContain('<p class="crisis-caveat"></p>');
  });

  it("carries no clinical query, answer, document or patient data — only the public contact fields", () => {
    // A quick structural sanity check that the pack is built from PublicCrisisContact
    // fields alone: every rendered number traces back to WA_CRISIS_CONTACTS or the Poisons line,
    // urgent first (design audit D06): 000, then Poisons, then the shared list in its own order.
    const telMatches = [...markup.matchAll(/href="tel:([^"]+)"/g)].map((match) => match[1]);
    expect(telMatches).toEqual(offlineCrisisContacts().map((contact) => contact.telephoneUri));
    expect(telMatches.slice(0, 2)).toEqual(["000", POISONS_INFORMATION_CONTACT.telephoneUri]);
    expect(telMatches.slice(2).sort()).toEqual(
      WA_CRISIS_CONTACTS.slice(1)
        .map((contact) => contact.telephoneUri)
        .sort(),
    );
  });
});

describe("build-offline-pack: reviewed MHA timeframes", () => {
  it("includes a reviewed entry's quote, section and signed-off date", () => {
    const path = writeTimeframesFixture([
      signed({
        id: "SYN-TIMEFRAME-001",
        section: "26",
        quote: "may be detained for up to 24 hours",
      }),
    ]);

    const markup = buildOfflinePackMarkup(path);

    expect(markup).toContain("may be detained for up to 24 hours");
    expect(markup).toContain("Section 26");
    expect(markup).toContain(`Signed off ${formatCheckedDate("2026-09-20")}`);
  });

  it("excludes a drafted entry even when it otherwise looks complete", () => {
    const path = writeTimeframesFixture([
      {
        id: "SYN-TIMEFRAME-002",
        section: "28",
        quote: "detention is capped at 72 hours",
        status: "drafted",
        reviewedBy: null,
        reviewedAt: null,
      },
    ]);

    const markup = buildOfflinePackMarkup(path);

    expect(markup).not.toContain("detention is capped at 72 hours");
    expect(markup).not.toContain("Mental Health Act deadlines");
  });

  it("excludes an entry marked reviewed but missing reviewedBy or reviewedAt (no agent sign-off)", () => {
    const path = writeTimeframesFixture([
      {
        id: "SYN-TIMEFRAME-003",
        section: "30",
        quote: "must be renewed within 48 hours",
        status: "reviewed",
        reviewedBy: null,
        reviewedAt: null,
      },
      {
        id: "SYN-TIMEFRAME-004",
        section: "31",
        quote: "lapses after 7 days",
        status: "reviewed",
        reviewedBy: "Dr Example",
        reviewedAt: null,
      },
    ]);

    const markup = buildOfflinePackMarkup(path);

    expect(markup).not.toContain("must be renewed within 48 hours");
    expect(markup).not.toContain("lapses after 7 days");
  });

  it("mixes drafted and reviewed entries correctly: only the reviewed one is shown", () => {
    const path = writeTimeframesFixture([
      {
        id: "SYN-TIMEFRAME-005",
        section: "32",
        quote: "drafted quote not yet signed off",
        status: "drafted",
        reviewedBy: null,
        reviewedAt: null,
      },
      signed({
        id: "SYN-TIMEFRAME-006",
        section: "33",
        quote: "reviewed quote signed off by the owner",
        reviewedAt: "2026-09-21T00:00:00.000Z",
      }),
    ]);

    const markup = buildOfflinePackMarkup(path);

    expect(markup).not.toContain("drafted quote not yet signed off");
    expect(markup).toContain("reviewed quote signed off by the owner");
    expect(markup).toContain("Section 33");
  });

  it("uses the app's own sign-off rule: a reviewed entry whose pin is wrong, missing or stale, or whose sign-off time is not a UTC timestamp, is excluded", () => {
    const good = signed({ id: "SYN-TIMEFRAME-PIN", section: "34", quote: "pinned fixture quote" });
    const path = writeTimeframesFixture([
      { ...good, id: "bad-pin", quote: "wrong pin quote", reviewedContentSha256: "0".repeat(64) },
      { ...good, id: "no-pin", quote: "missing pin quote", reviewedContentSha256: null },
      // Edited after sign-off: the pin was computed over the old quote.
      { ...good, quote: "edited after sign-off quote" },
      signed({ id: "date-only", section: "35", quote: "date-only sign-off quote", reviewedAt: "2026-09-21" }),
      good,
    ]);

    const markup = buildOfflinePackMarkup(path);

    expect(markup).not.toContain("wrong pin quote");
    expect(markup).not.toContain("missing pin quote");
    expect(markup).not.toContain("edited after sign-off quote");
    expect(markup).not.toContain("date-only sign-off quote");
    expect(markup).toContain("pinned fixture quote");
  });

  it("shows a reviewed entry's trigger, form codes, condition, lead-in and caveat with the quote, escaped", () => {
    const path = writeTimeframesFixture([
      signed({
        id: "SYN-TIMEFRAME-FULL",
        formCodes: ["3A", "3B & C"],
        trigger: "Fixture trigger <b>",
        condition: "Only if the fixture condition applies",
        section: "28",
        leadIn: "fixture stem —",
        quote: "fixture limb stating 72 hours",
        caveat: { section: "28", quote: "fixture caveat <i>ends</i> the period" },
        computeAllowed: false,
      }),
    ]);

    const markup = buildOfflinePackMarkup(path);

    expect(markup).toContain("Fixture trigger &lt;b&gt;");
    expect(markup).toContain("Forms 3A, 3B &amp; C");
    expect(markup).toContain('<p class="act-condition">Only if the fixture condition applies</p>');
    expect(markup).toContain("&ldquo;fixture stem — &hellip; fixture limb stating 72 hours&rdquo;");
    expect(markup).toContain(
      "The Act also says (s 28): &ldquo;fixture caveat &lt;i&gt;ends&lt;/i&gt; the period&rdquo;",
    );
    // A never-calculated (computeAllowed: false) entry still shows as a quote; no time is ever shown here.
    expect(markup).not.toContain("<time");
  });

  it("handles a missing timeframes file by omitting the Act section entirely, without throwing", () => {
    expect(() => loadReviewedTimeframes(NONEXISTENT_TIMEFRAMES_PATH)).not.toThrow();
    expect(loadReviewedTimeframes(NONEXISTENT_TIMEFRAMES_PATH)).toEqual([]);

    const markup = buildOfflinePackMarkup(NONEXISTENT_TIMEFRAMES_PATH);
    expect(markup).not.toContain("Mental Health Act deadlines");
    // The crisis section must still render.
    expect(markup).toContain("Urgent numbers");
  });

  it("handles an empty entries array", () => {
    const path = writeTimeframesFixture([]);
    expect(loadReviewedTimeframes(path)).toEqual([]);
  });

  it("escapes HTML-significant characters in a reviewed quote instead of emitting them raw (injection guard)", () => {
    const path = writeTimeframesFixture([
      signed({
        id: "SYN-TIMEFRAME-INJECT",
        section: '26"><script>alert(1)</script>',
        quote: 'Tom & Jerry said "run" <script>alert(1)</script>',
      }),
    ]);

    const markup = buildOfflinePackMarkup(path);

    // The escaped entities are present, in the quote and the section label alike.
    expect(markup).toContain("Tom &amp; Jerry said &quot;run&quot; &lt;script&gt;alert(1)&lt;/script&gt;");
    expect(markup).toContain("Section 26&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;");

    // No raw markup or unescaped quote/ampersand ever reaches the page.
    expect(markup).not.toContain("<script>alert(1)</script>");
    expect(markup).not.toContain('"run"');
    expect(markup).not.toContain("Tom & Jerry");
  });
});

describe("build-offline-pack: marker replacement and staleness detection", () => {
  function wrap(inner: string): string {
    return `<main>\n${PACK_START}\n${inner}\n${PACK_END}\n<a href="/">Try again</a>\n</main>`;
  }

  it("replaces only the region between the sentinels, leaving the rest of the document untouched", () => {
    const before = wrap("STALE CONTENT");
    const after = applyOfflinePackMarkup(before, "FRESH CONTENT");

    expect(after).toContain("FRESH CONTENT");
    expect(after).not.toContain("STALE CONTENT");
    expect(after).toContain('<a href="/">Try again</a>');
    expect(after).toContain(PACK_START);
    expect(after).toContain(PACK_END);
  });

  it("throws when the sentinels are missing, instead of silently doing nothing (a stripped marker must fail loudly)", () => {
    const noMarkers = "<main><p>no sentinels here</p></main>";
    expect(() => applyOfflinePackMarkup(noMarkers, "anything")).toThrow(/sentinels/);
  });

  it("--check's staleness detection: a page holding old markup differs from re-applying the current generator output", () => {
    const freshMarkup = buildOfflinePackMarkup(NONEXISTENT_TIMEFRAMES_PATH);

    const stalePage = wrap("some previously generated but now out-of-date markup");
    const reApplied = applyOfflinePackMarkup(stalePage, freshMarkup);

    // This is exactly what `--check` compares: the committed file (stalePage)
    // against freshly generated + reapplied output. They must differ, which is
    // what makes --check fail closed on drift.
    expect(reApplied).not.toBe(stalePage);
    expect(reApplied).toContain(freshMarkup);
  });

  it("--check reports no drift once the page already holds the current generator output", () => {
    const freshMarkup = buildOfflinePackMarkup(NONEXISTENT_TIMEFRAMES_PATH);
    const currentPage = wrap(freshMarkup);

    const reApplied = applyOfflinePackMarkup(currentPage, freshMarkup);

    expect(reApplied).toBe(currentPage);
  });
});

describe("build-offline-pack: date formatting", () => {
  it("formats a bare date and an ISO datetime the same way, deterministically", () => {
    expect(formatCheckedDate("2026-08-20")).toBe("20 August 2026");
    expect(formatCheckedDate("2026-08-20T00:00:00.000Z")).toBe("20 August 2026");
    expect(formatCheckedDate("2026-01-05")).toBe("5 January 2026");
  });

  it("throws on an unparseable date instead of guessing", () => {
    expect(() => formatCheckedDate("not-a-date")).toThrow();
    expect(() => formatCheckedDate("2026-13-01")).toThrow();
  });
});
