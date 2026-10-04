/** @vitest-environment jsdom */

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OnCallContactsSection } from "@/components/on-call/on-call-contacts-section";
import { OnCallEntryRow } from "@/components/on-call/on-call-entry-row";
import { OnCallFreshnessBadge } from "@/components/on-call/on-call-freshness-badge";
import { OnCallOfflineBanner } from "@/components/on-call/on-call-offline-banner";
import { onCallEntryFreshness, type OnCallEntry } from "@/lib/on-call/entry-model";
import { clearOnCallRecent, readOnCallRecent } from "@/lib/on-call/recent-storage";

afterEach(cleanup);

const NOW = new Date("2026-09-04T00:00:00.000Z");

function contact(overrides: Partial<OnCallEntry> & { id: string; slug: string; title: string }): OnCallEntry {
  return {
    section: "contacts",
    subtitle: null,
    body: null,
    details: { role: overrides.title },
    linkedDocumentIds: [],
    tags: [],
    isPersonal: false,
    includeOnCard: false,
    sortOrder: 0,
    lastVerifiedAt: NOW.toISOString(),
    ...overrides,
  };
}

const FRESH_ED_REGISTRAR = contact({
  id: "11111111-1111-1111-1111-111111111111",
  slug: "ed-registrar",
  title: "ED registrar",
  tags: ["Emergency Department"],
  details: { role: "ED registrar", phone: "0412 345 678", availability: "24/7" },
  lastVerifiedAt: new Date("2026-06-01T00:00:00.000Z").toISOString(),
});

const FRESH_WARD_NURSE = contact({
  id: "22222222-2222-2222-2222-222222222222",
  slug: "ward-4b-nic",
  title: "Ward 4B nurse in charge",
  tags: ["Ward 4B"],
  details: { role: "Ward 4B nurse in charge", extension: "5678", pager: "555" },
  lastVerifiedAt: new Date("2026-05-01T00:00:00.000Z").toISOString(),
});

const STALE_OVERDUE_ANAESTHETIST = contact({
  id: "33333333-3333-3333-3333-333333333333",
  slug: "on-call-anaesthetist",
  title: "On-call anaesthetist",
  tags: ["Theatre"],
  details: { role: "On-call anaesthetist", phone: "0400 000 000" },
  lastVerifiedAt: new Date("2020-01-01T00:00:00.000Z").toISOString(),
});

const STALE_NEVER_VERIFIED_SOCIAL_WORK = contact({
  id: "44444444-4444-4444-4444-444444444444",
  slug: "after-hours-social-work",
  title: "After-hours social work",
  tags: ["Ward 4B"],
  details: { role: "After-hours social work", afterHoursPhone: "0455 111 222" },
  lastVerifiedAt: null,
});

describe("OnCallEntryRow", () => {
  it("renders the whole row as a single tap target of at least 48px, tall enough to tap one-handed", () => {
    render(
      <OnCallEntryRow title="ED registrar" href="tel:0412345678" testId="row">
        <span>0412 345 678</span>
      </OnCallEntryRow>,
    );
    const row = screen.getByTestId("row");
    expect(row.tagName).toBe("A");
    // min-h-tap is the repo's 48px tap-target utility; 44px (min-h-11) is
    // explicitly banned because it reintroduces a known browser-test flake.
    expect(row.className).toMatch(/\bmin-h-tap\b/);
    expect(row.className).not.toMatch(/\bmin-h-11\b/);
  });

  it("uses a tel: href so ringing the number is one tap, with no separate button to hunt for", () => {
    render(
      <OnCallEntryRow title="ED registrar" href="tel:0412345678" testId="row">
        content
      </OnCallEntryRow>,
    );
    expect(screen.getByTestId("row")).toHaveAttribute("href", "tel:0412345678");
  });

  it("renders as a static, non-interactive row when neither href nor onClick is supplied", () => {
    render(
      <OnCallEntryRow title="No number on file" testId="row">
        content
      </OnCallEntryRow>,
    );
    const row = screen.getByTestId("row");
    expect(row.tagName).not.toBe("A");
    expect(row.tagName).not.toBe("BUTTON");
  });
});

describe("OnCallFreshnessBadge", () => {
  it("carries the word 'checked' plus a date for a fresh entry, not colour alone", () => {
    render(
      <OnCallFreshnessBadge
        freshness={onCallEntryFreshness({ lastVerifiedAt: FRESH_ED_REGISTRAR.lastVerifiedAt }, NOW)}
      />,
    );
    const badge = screen.getByTestId("on-call-freshness-badge");
    expect(badge).toHaveTextContent(/checked/i);
    expect(badge).toHaveTextContent(/\d{2}\/\d{2}\/\d{4}/);
    // The icon is a real glyph, not decoration alone standing in for the words.
    expect(badge.querySelector("svg")).not.toBeNull();
  });

  it("states plainly that a never-verified entry has not been checked, without inventing a date", () => {
    render(<OnCallFreshnessBadge freshness={onCallEntryFreshness({ lastVerifiedAt: null }, NOW)} />);
    const badge = screen.getByTestId("on-call-freshness-badge");
    expect(badge).toHaveTextContent(/never checked/i);
    expect(badge).not.toHaveTextContent(/\d{2}\/\d{2}\/\d{4}/);
  });

  it("uses a different icon for fresh vs stale, so the distinction survives with no colour perception at all", () => {
    const { container: freshContainer } = render(
      <OnCallFreshnessBadge
        freshness={onCallEntryFreshness({ lastVerifiedAt: FRESH_ED_REGISTRAR.lastVerifiedAt }, NOW)}
      />,
    );
    const freshIcon = freshContainer.querySelector("svg")?.getAttribute("class");
    cleanup();
    const { container: staleContainer } = render(
      <OnCallFreshnessBadge freshness={onCallEntryFreshness({ lastVerifiedAt: null }, NOW)} />,
    );
    const staleIcon = staleContainer.querySelector("svg")?.getAttribute("class");
    expect(freshIcon).not.toEqual(staleIcon);
  });
});

describe("OnCallOfflineBanner", () => {
  it("names the date the saved copy was taken", () => {
    render(<OnCallOfflineBanner savedAt="2026-08-20T00:00:00.000Z" />);
    expect(screen.getByTestId("on-call-offline-banner")).toHaveTextContent(/20\/08\/2026/);
  });

  it("is not itself a live region — the visible banner carries no aria-live or status/alert role", () => {
    render(<OnCallOfflineBanner savedAt="2026-08-20T00:00:00.000Z" />);
    const banner = screen.getByTestId("on-call-offline-banner");
    expect(banner).not.toHaveAttribute("aria-live");
    expect(banner).not.toHaveAttribute("role");
  });

  it("announces through a separate sr-only live region instead", () => {
    render(<OnCallOfflineBanner savedAt="2026-08-20T00:00:00.000Z" />);
    const announcement = screen.getByTestId("on-call-offline-banner-announcement");
    expect(announcement).toHaveAttribute("aria-live", "polite");
    expect(announcement.className).toMatch(/\bsr-only\b/);
    expect(announcement).toHaveTextContent(/20\/08\/2026/);
  });
});

/**
 * Local-time clocks for the after-hours rule, built with the `Date(y, m, d, h)`
 * constructor so the hour under test is the hour on the reader's own phone
 * whatever zone the test runner sits in. 16 September 2026 is a Wednesday.
 */
const WEEKDAY_MORNING = new Date(2026, 8, 16, 9, 0, 0);
const WEEKDAY_NIGHT = new Date(2026, 8, 16, 22, 0, 0);

const DAY_AND_NIGHT_BED_MANAGER = contact({
  id: "55555555-5555-5555-5555-555555555555",
  slug: "bed-manager",
  title: "Bed manager",
  tags: ["Ward 4B"],
  details: { role: "Bed manager", phone: "08 9224 1111", afterHoursPhone: "0455 222 333" },
  lastVerifiedAt: new Date(2026, 8, 10, 9, 0, 0).toISOString(),
});

const PERSONAL_CONSULTANT = contact({
  id: "66666666-6666-6666-6666-666666666666",
  slug: "consultant-mobile",
  title: "Consultant mobile",
  tags: ["Ward 4B"],
  isPersonal: true,
  details: { role: "Consultant mobile", phone: "0400 111 222" },
  lastVerifiedAt: new Date(2026, 8, 10, 9, 0, 0).toISOString(),
});

describe("OnCallContactsSection", () => {
  it("renders a tel: link for the phone number so ringing the ED registrar is one tap", () => {
    render(<OnCallContactsSection entries={[FRESH_ED_REGISTRAR]} now={NOW} />);
    const row = screen.getByTestId("on-call-contact-row-ed-registrar");
    expect(row).toHaveAttribute("href", "tel:0412345678");
  });

  it("groups rows by area (tags) under their own headings", () => {
    render(<OnCallContactsSection entries={[FRESH_ED_REGISTRAR, FRESH_WARD_NURSE]} now={NOW} />);
    expect(screen.getByRole("heading", { name: "Emergency Department" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Ward 4B" })).toBeInTheDocument();
    const edGroup = screen.getByTestId("on-call-contacts-group-emergency-department");
    expect(within(edGroup).getByTestId("on-call-contact-row-ed-registrar")).toBeInTheDocument();
    const wardGroup = screen.getByTestId("on-call-contacts-group-ward-4b");
    expect(within(wardGroup).getByTestId("on-call-contact-row-ward-4b-nic")).toBeInTheDocument();
  });

  it("collects stale entries into a 'needs checking' group at the TOP of the page, not the bottom", () => {
    render(
      <OnCallContactsSection
        entries={[FRESH_ED_REGISTRAR, STALE_OVERDUE_ANAESTHETIST, STALE_NEVER_VERIFIED_SOCIAL_WORK]}
        now={NOW}
      />,
    );
    const headings = screen.getAllByRole("heading").map((heading) => heading.textContent);
    expect(headings[0]).toBe("Needs checking");
    expect(headings.indexOf("Needs checking")).toBeLessThan(headings.indexOf("Emergency Department"));

    const staleGroup = screen.getByTestId("on-call-contacts-group-needs-checking");
    expect(within(staleGroup).getByTestId("on-call-contact-row-on-call-anaesthetist")).toBeInTheDocument();
    expect(within(staleGroup).getByTestId("on-call-contact-row-after-hours-social-work")).toBeInTheDocument();

    // A stale entry is not double-counted in its area group as well.
    expect(screen.queryByTestId("on-call-contacts-group-theatre")).toBeNull();
  });

  it("records the contact when the row is dialled so Recent is not permanently empty", async () => {
    clearOnCallRecent();
    const user = userEvent.setup();
    render(<OnCallContactsSection entries={[FRESH_ED_REGISTRAR]} now={NOW} />);
    await user.click(screen.getByTestId("on-call-contact-row-ed-registrar"));
    expect(readOnCallRecent().map((item) => item.id)).toEqual([FRESH_ED_REGISTRAR.id]);
    expect(readOnCallRecent()[0]?.title).toBe("ED registrar");
    clearOnCallRecent();
  });

  it("renders a real empty state, and no groups at all, when there are no contact entries", () => {
    render(<OnCallContactsSection entries={[]} now={NOW} />);
    expect(screen.getByTestId("on-call-contacts-empty")).toBeInTheDocument();
    expect(screen.queryByRole("heading")).toBeNull();
  });

  it("rings the direct line during the working day", () => {
    render(<OnCallContactsSection entries={[DAY_AND_NIGHT_BED_MANAGER]} now={WEEKDAY_MORNING} />);
    expect(screen.getByTestId("on-call-contact-row-bed-manager")).toHaveAttribute("href", "tel:0892241111");
  });

  it("rings the after-hours line at 22:00, which is when this page is actually read", () => {
    render(<OnCallContactsSection entries={[DAY_AND_NIGHT_BED_MANAGER]} now={WEEKDAY_NIGHT} />);
    expect(screen.getByTestId("on-call-contact-row-bed-manager")).toHaveAttribute("href", "tel:0455222333");
  });

  it("offers a copy control named for the number it copies and the contact it belongs to", () => {
    render(<OnCallContactsSection entries={[DAY_AND_NIGHT_BED_MANAGER]} now={WEEKDAY_NIGHT} />);
    // Named, because a bare "Copy" in a list of forty rows tells a screen-reader
    // user nothing about which number they are about to take.
    expect(screen.getByRole("button", { name: /copy after hours number for bed manager/i })).toBeInTheDocument();
  });

  it("keeps the copy control OUTSIDE the row's tel: link, never nested inside it", () => {
    render(<OnCallContactsSection entries={[DAY_AND_NIGHT_BED_MANAGER]} now={WEEKDAY_NIGHT} />);
    const row = screen.getByTestId("on-call-contact-row-bed-manager");
    const copy = screen.getByRole("button", { name: /copy after hours number for bed manager/i });
    // A `<button>` inside an `<a>` is invalid markup and announces one action
    // twice; the row and the control are siblings.
    expect(row.contains(copy)).toBe(false);
    expect(row.querySelector("button")).toBeNull();
  });

  it("puts a number on the clipboard without its formatting", async () => {
    const user = userEvent.setup();
    // Stubbed after `setup()`: user-event installs a clipboard of its own, which
    // would otherwise swallow the write this test is watching for.
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true, writable: true });
    render(<OnCallContactsSection entries={[DAY_AND_NIGHT_BED_MANAGER]} now={WEEKDAY_NIGHT} />);
    await user.click(screen.getByRole("button", { name: /copy after hours number for bed manager/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("0455222333"));
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true, writable: true });
  });

  it("offers no copy control for a personal contact, whose digits the page already withholds", () => {
    render(<OnCallContactsSection entries={[PERSONAL_CONSULTANT]} now={WEEKDAY_NIGHT} />);
    expect(screen.queryByRole("button", { name: /copy/i })).toBeNull();
  });

  it("puts the role full width and the phone on the line below it", () => {
    render(<OnCallContactsSection entries={[FRESH_ED_REGISTRAR]} now={NOW} />);
    const row = screen.getByTestId("on-call-contact-row-ed-registrar");
    const number = row.querySelector("[data-contact-row-number]");
    expect(number).not.toBeNull();
    expect(number).toHaveTextContent("0412 345 678");
    // Title and number both live in the row's text column; dial/copy sit in the
    // sibling actions column (outside the tel: link), matching OnCallDialRow.
    expect(within(row).getByText("ED registrar")).toBeInTheDocument();
    expect(row.contains(number as HTMLElement)).toBe(true);
    const actions = row.closest("[id^='on-call-entry-']")?.querySelector("[data-contact-row-actions]");
    expect(actions).not.toBeNull();
    expect(row.contains(actions as HTMLElement)).toBe(false);
    expect(row).toHaveTextContent(/24\/7/);
  });

  it("keeps a fixed dial/copy column when a shared row has no number, so the trailing edge does not jog", () => {
    const noNumber = contact({
      id: "77777777-7777-7777-7777-777777777777",
      slug: "no-number-role",
      title: "Duty pharmacist",
      tags: ["Pharmacy"],
      details: { role: "Duty pharmacist", availability: "In hours" },
      lastVerifiedAt: new Date("2026-06-01T00:00:00.000Z").toISOString(),
    });
    render(<OnCallContactsSection entries={[FRESH_ED_REGISTRAR, noNumber]} now={NOW} />);
    const withNumber = screen.getByTestId("on-call-contact-row-ed-registrar").closest("[id^='on-call-entry-']");
    const withoutNumber = screen.getByTestId("on-call-contact-row-no-number-role").closest("[id^='on-call-entry-']");
    expect(withNumber?.querySelector("[data-contact-row-actions]")).not.toBeNull();
    expect(withoutNumber?.querySelector("[data-contact-row-actions]")).not.toBeNull();
    expect(withoutNumber?.querySelector("[data-contact-row-disc-spacer]")).not.toBeNull();
    expect(withoutNumber?.querySelector("[data-contact-row-copy-spacer]")).not.toBeNull();
    expect(screen.getByText("No number on file")).toBeInTheDocument();
  });

  it("keeps personal rows digit-free in a shared list and omits the dial/copy column", () => {
    render(<OnCallContactsSection entries={[FRESH_ED_REGISTRAR, PERSONAL_CONSULTANT]} now={WEEKDAY_NIGHT} />);
    const personal = screen.getByTestId("on-call-contact-row-consultant-mobile");
    expect(personal.querySelector("[data-contact-row-number]")).toBeNull();
    expect(personal).not.toHaveTextContent(/0400 111 222/);
    expect(screen.getByTestId("on-call-private-flag")).toHaveTextContent("Private · only you");
    expect(personal.closest("[id^='on-call-entry-']")?.querySelector("[data-contact-row-actions]")).toBeNull();
  });
});
