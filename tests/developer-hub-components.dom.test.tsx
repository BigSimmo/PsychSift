import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { EnvironmentStrip } from "@/components/developer-area/hub/environment-strip";
import { FreshnessStamp } from "@/components/developer-area/hub/freshness-stamp";
import { PanelCard } from "@/components/developer-area/hub/panel-card";

afterEach(cleanup);

/**
 * Formats the date the way the component does. #L14: `FreshnessStamp` now
 * pins `timeZone: "Australia/Perth"` explicitly (Perth carries no daylight
 * saving, so this is the same offset year-round) rather than following the
 * host's local timezone (`Australia/Perth` locally, UTC on many CI boxes),
 * so this helper pins the same zone to keep the assertion about *which* date
 * rendered rather than about the formatter or the host running the test.
 */
function mediumDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-AU", { dateStyle: "medium", timeZone: "Australia/Perth" });
}

describe("FreshnessStamp", () => {
  it("always renders, and says so when the revision is unknown", () => {
    render(<FreshnessStamp freshness={{ contentAt: null, viewedAt: "2026-08-21T00:00:00Z", ageHours: null }} />);
    expect(screen.getByTestId("developer-hub-freshness")).toHaveTextContent(/revision unknown/i);
  });

  it("reports the gap between ledger content and build", () => {
    render(
      <FreshnessStamp
        freshness={{ contentAt: "2026-08-20T00:00:00Z", viewedAt: "2026-08-21T00:00:00Z", ageHours: 24 }}
      />,
    );
    const stamp = screen.getByTestId("developer-hub-freshness");
    expect(stamp).toHaveTextContent(/24 hours/i);
    // The age alone is not the claim: an implementation that printed the gap but
    // dropped the date it was measured from would still be unfalsifiable.
    expect(stamp).toHaveTextContent(mediumDate("2026-08-20T00:00:00Z"));
  });

  it("says the revision is unknown when the recorded date cannot be parsed", () => {
    render(
      <FreshnessStamp
        freshness={{ contentAt: "not-a-date", viewedAt: "2026-08-21T00:00:00Z", ageHours: Number.NaN }}
      />,
    );
    const stamp = screen.getByTestId("developer-hub-freshness");
    expect(stamp).toHaveTextContent(/revision unknown/i);
    // A confident-looking stamp carrying no information is the failure this
    // component exists to prevent.
    expect(stamp).not.toHaveTextContent(/invalid date/i);
    expect(stamp).not.toHaveTextContent(/NaN/);
  });

  it("labels both timestamps, so neither reads as a second ledger date", () => {
    render(
      <FreshnessStamp
        freshness={{ contentAt: "2026-08-20T00:00:00Z", viewedAt: "2026-08-21T00:00:00Z", ageHours: 24 }}
      />,
    );
    const stamp = screen.getByTestId("developer-hub-freshness");
    expect(stamp).toHaveTextContent(new RegExp(`viewed ${mediumDate("2026-08-21T00:00:00Z")}`));
    expect(stamp).toHaveTextContent(/Ledger content as of/);
  });

  // #L14: the server-rendered stamp used to follow the container's clock (UTC
  // on Railway) with no timezone printed, while the client-side CheckedAt line
  // on the same ingestion page followed the browser (Perth) — an unlabelled
  // eight-hour gap on the one page that polls live. Pinning Australia/Perth
  // and printing the zone name closes both halves of that gap.
  it("prints the timezone alongside the content date, pinned to Australia/Perth regardless of host clock", () => {
    render(
      <FreshnessStamp
        freshness={{ contentAt: "2026-08-20T00:00:00Z", viewedAt: "2026-08-21T00:00:00Z", ageHours: 24 }}
      />,
    );
    const stamp = screen.getByTestId("developer-hub-freshness");
    expect(stamp).toHaveTextContent(/AWST/);
  });

  it("says '1 hour old', not '1 hours old'", () => {
    render(
      <FreshnessStamp
        freshness={{ contentAt: "2026-08-20T23:00:00Z", viewedAt: "2026-08-21T00:00:00Z", ageHours: 1 }}
      />,
    );
    expect(screen.getByTestId("developer-hub-freshness")).toHaveTextContent(/\b1 hour old\b/);
  });

  /**
   * Both committed snapshots now date their revision to the day rather than the
   * second, because a full timestamp is a per-branch value that made two
   * branches conflict on a file neither was editing
   * (`repo-awareness-snapshot-v3`, `outstanding-issues-snapshot-v2`).
   *
   * The stamp must not dress that day up as an instant. `new Date("2026-08-20")`
   * is midnight UTC, which a Perth formatter renders as "08:00 AWST" — a clock
   * reading nothing recorded — and an hour count taken from it is wrong by
   * however far into the day the commit actually was.
   */
  it("states a day-granularity revision as a day, with no fabricated clock time", () => {
    render(<FreshnessStamp freshness={{ contentAt: "2026-08-20", viewedAt: "2026-08-21T00:00:00Z", ageHours: 24 }} />);
    const stamp = screen.getByTestId("developer-hub-freshness");
    expect(stamp).toHaveTextContent(mediumDate("2026-08-20T00:00:00Z"));
    // The content date carries no time and no zone. `viewedAt` is a real
    // instant and keeps both, so AWST still appears — scope the assertion to
    // the content half rather than the whole stamp.
    expect(stamp.textContent).toMatch(/content as of [^·]*\d{4}\s*·/);
    expect(stamp.textContent).not.toMatch(/content as of [^·]*\d{1,2}:\d{2}/);
  });

  it("ages a day-granularity revision in days, not in hours it cannot support", () => {
    // The reported case, and the one a Perth-day comparison also gets wrong: a
    // ledger commit late in a UTC day is stored as that day, and an hour count
    // read from midnight then calls it a day old within minutes of landing.
    // 23:59 UTC is 07:59 next morning in Perth, so the arithmetic must stay in
    // UTC to match the zone the stored date came from.
    render(<FreshnessStamp freshness={{ contentAt: "2026-08-20", viewedAt: "2026-08-20T23:59:00Z", ageHours: 24 }} />);
    const stamp = screen.getByTestId("developer-hub-freshness");
    expect(stamp).toHaveTextContent(/same day/);
    expect(stamp).not.toHaveTextContent(/hours old/);
  });

  it("says '1 day old', not '1 days old'", () => {
    // One UTC calendar day after the recorded content day.
    render(<FreshnessStamp freshness={{ contentAt: "2026-08-20", viewedAt: "2026-08-21T04:00:00Z", ageHours: 28 }} />);
    expect(screen.getByTestId("developer-hub-freshness")).toHaveTextContent(/\b1 day old\b/);
  });

  it("keeps hour precision for a full timestamp, which still carries it", () => {
    render(
      <FreshnessStamp
        freshness={{ contentAt: "2026-08-20T00:00:00Z", viewedAt: "2026-08-21T00:00:00Z", ageHours: 24 }}
      />,
    );
    expect(screen.getByTestId("developer-hub-freshness")).toHaveTextContent(/24 hours old/);
  });

  it("renders live status when freshness status is live", () => {
    render(
      <FreshnessStamp
        label="Ingestion jobs"
        freshness={{ contentAt: null, viewedAt: "2026-08-21T00:00:00Z", ageHours: null, status: "live" }}
      />,
    );
    const stamp = screen.getByTestId("developer-hub-freshness");
    expect(stamp).toHaveTextContent(/Ingestion jobs read live/i);
    expect(stamp).toHaveTextContent(new RegExp(`viewed ${mediumDate("2026-08-21T00:00:00Z")}`));
    expect(stamp).not.toHaveTextContent(/revision unknown/i);
  });
});

describe("EnvironmentStrip", () => {
  it("names each unknown instead of dropping it", () => {
    // This is the shape the hub renders in phase 1: nothing has been read yet,
    // so every fact must name its own gap. `demoMode={null}` is the load-bearing
    // one — a component that fell back to "Live data" here would state the
    // opposite of the truth in demo mode, which is the one way this strip can be
    // actively wrong rather than merely incomplete.
    render(<EnvironmentStrip demoMode={null} documentCount={null} buildSha={null} email={null} />);
    const strip = screen.getByTestId("developer-hub-environment-strip");
    expect(strip).toHaveTextContent("environment unknown");
    expect(strip).toHaveTextContent("document count unavailable");
    expect(strip).toHaveTextContent("build unknown");
    expect(strip).toHaveTextContent("account unknown");
    // Neither of the two states an unread environment must not be mistaken for.
    expect(strip).not.toHaveTextContent("Live data");
    expect(strip).not.toHaveTextContent("Demo corpus");
    expect(strip).not.toHaveTextContent(/null|undefined|NaN/);
  });

  it("says demo corpus when the environment was read and is demo", () => {
    // The third state, pinned separately so a future wiring change cannot
    // collapse "unread" and "demo" into one label.
    render(<EnvironmentStrip demoMode documentCount={12} buildSha={null} email={null} />);
    const strip = screen.getByTestId("developer-hub-environment-strip");
    expect(strip).toHaveTextContent("Demo corpus");
    expect(strip).not.toHaveTextContent("environment unknown");
    expect(strip).not.toHaveTextContent("Live data");
  });

  it("reports the live figures when they are known", () => {
    render(
      <EnvironmentStrip demoMode={false} documentCount={2851} buildSha="e52198827abcdef" email="dev@example.com" />,
    );
    const strip = screen.getByTestId("developer-hub-environment-strip");
    expect(strip).toHaveTextContent("Live data");
    expect(strip).toHaveTextContent("2,851 documents");
    expect(strip).toHaveTextContent("build e521988");
    expect(screen.getByTestId("developer-hub-build-link")).toHaveAttribute(
      "href",
      "https://github.com/BigSimmo/PsychSift/commit/e52198827abcdef",
    );
    expect(strip).toHaveTextContent("dev@example.com");
    expect(strip).not.toHaveTextContent("environment unknown");
    expect(strip).not.toHaveTextContent("account unknown");
  });
});

describe("PanelCard", () => {
  it("links a built panel", () => {
    render(
      <PanelCard
        panel={{
          id: "task-ledger",
          name: "Task ledger",
          summary: "s",
          group: "work",
          phase: 1,
          href: "/admin/developer-hub/ledger",
        }}
      />,
    );
    expect(screen.getByRole("link", { name: /task ledger/i })).toHaveAttribute("href", "/admin/developer-hub/ledger");
  });

  it("marks a planned panel unavailable with a reachable reason, never native disabled", () => {
    render(
      <PanelCard panel={{ id: "work-in-flight", name: "Work in flight", summary: "s", group: "work", phase: 2 }} />,
    );
    const button = screen.getByRole("button", { name: /work in flight/i });
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).not.toHaveAttribute("disabled");
    expect(button).toHaveAttribute("title", expect.stringContaining("coming soon"));

    // Resolve the id the button actually points at, so this pins the *link*
    // between control and reason. A dangling `aria-describedby` leaves the
    // stated reason unreachable, which is the defect the convention prevents.
    const describedBy = button.getAttribute("aria-describedby") ?? "";
    const note = document.getElementById(describedBy);
    expect(note).not.toBeNull();
    expect(note).toHaveTextContent(/not built yet/i);

    // `aria-disabled` is advisory only — it keeps the tab stop, so the control
    // stays operable unless the inert handler cancels the activation.
    const activation = new MouseEvent("click", { bubbles: true, cancelable: true });
    button.dispatchEvent(activation);
    expect(activation.defaultPrevented).toBe(true);
  });
});
