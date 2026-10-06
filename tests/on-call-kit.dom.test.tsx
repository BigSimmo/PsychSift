/** @vitest-environment jsdom */
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Siren } from "lucide-react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/client", () => ({ useAuthSession: () => ({ status: "signed_out", authEpoch: 1 }) }));

import { ModeActionButton } from "@/components/mode-kit/action-button";
import { OnCallDialRow, toHandbookDial } from "@/components/on-call/kit/dial-row";
import { OnCallDialSheet } from "@/components/on-call/kit/dial-sheet";
import { ModeFactTile } from "@/components/mode-kit/fact-tile";
import { OnCallGroupedList, OnCallRow } from "@/components/on-call/kit/grouped-list";
import { OnCallHandbookState, OnCallHospitalChooser } from "@/components/on-call/kit/handbook-state";
import { OnCallHeroLink } from "@/components/on-call/kit/hero-link";
import { OnCallHospitalLine } from "@/components/on-call/kit/hospital-line";
import { OnCallModuleSkeleton } from "@/components/on-call/kit/module-skeleton";
import { ModeNotice } from "@/components/mode-kit/notice";
import { OnCallStateLabel } from "@/components/on-call/kit/state-label";
import { OnCallUpdatedLine } from "@/components/on-call/kit/updated-line";
import type { HospitalHandbookState } from "@/components/on-call/use-hospital-handbook";
import { readOnCallYouCalled } from "@/lib/on-call/call-marks";
import {
  formatOnCallDate,
  formatOnCallDateTime,
  formatOnCallShortDay,
  formatOnCallTime,
  onCallAgo,
} from "@/lib/on-call/display-dates";
import { resolveHandbookPhone } from "@/lib/on-call/number-resolver";
import { onCallRecentStorageKey, readOnCallRecent } from "@/lib/on-call/recent-storage";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

const NOW = new Date("2026-09-26T02:00:00.000Z");

describe("display dates (Perth, fixed month names)", () => {
  it("writes the date first and the age after it", () => {
    expect(formatOnCallDate("2026-09-20T04:00:00.000Z")).toBe("20 Sep 2026");
    expect(formatOnCallDate("2026-06-12T04:00:00.000Z")).toBe("12 Jun 2026");
    expect(onCallAgo("2026-09-20T04:00:00.000Z", NOW)).toBe("6 days ago");
    expect(onCallAgo("2026-03-12T04:00:00.000Z", NOW)).toBe("6 months ago");
    expect(onCallAgo("2026-09-26T01:00:00.000Z", NOW)).toBe("today");
  });

  it("uses 24-hour Perth time and the short day form", () => {
    expect(formatOnCallTime("2026-09-25T18:14:00.000Z")).toBe("02:14");
    expect(formatOnCallShortDay("2026-09-26T02:00:00.000Z")).toBe("Sat 26 Sep");
    expect(formatOnCallDateTime("2026-09-26T02:00:00.000Z")).toBe("26 Sep 2026, 10:00 am");
  });

  it("handles null, undefined, and invalid date strings gracefully without throwing", () => {
    expect(formatOnCallDate(null)).toBe("");
    expect(formatOnCallDate(undefined)).toBe("");
    expect(formatOnCallDate("not-a-date")).toBe("");
    expect(formatOnCallDateTime(null)).toBe("");
    expect(formatOnCallDateTime(undefined)).toBe("");
    expect(formatOnCallDateTime("not-a-date")).toBe("");
  });
});

describe("OnCallDialRow", () => {
  it("dials from the call disc at the 48px floor, names the digits, and learns the tap", async () => {
    render(
      <OnCallDialRow
        id="h1"
        source="handbook"
        title="Switchboard"
        dial={resolveHandbookPhone("(08) 9000 0000")}
        testId="row"
      />,
    );
    const call = within(screen.getByTestId("row")).getByRole("link", { name: "Call Switchboard, 9 0 0 0, 0 0 0 0" });
    expect(call).toHaveAttribute("href", "tel:0890000000");
    expect(call.className).toMatch(/min-h-12/);
    expect(call.className).toMatch(/min-w-12/);
    // The name and number are one button that opens the dialling details.
    const opener = within(screen.getByTestId("row")).getByRole("button", { name: /9000 0000/ });
    expect(opener).toHaveAttribute("aria-haspopup", "dialog");
    expect(opener.className).toMatch(/\bmin-h-12\b/);
    expect(opener.className).not.toMatch(/truncate/);
    const number = opener.querySelector("[data-dial-row-number]") as HTMLElement;
    expect(number).toHaveTextContent("9000 0000");
    expect(number.className).toMatch(/font-normal/);
    expect(number.className).not.toMatch(/font-(bold|extrabold|black|semibold)/);
    expect(number.className).not.toMatch(/truncate/);
    await userEvent.click(call);
    expect(readOnCallRecent()[0]).toMatchObject({ id: "h1", source: "handbook", count: 1 });
    // A hospital row is remembered by id, kind and time only (review B2).
    expect(readOnCallRecent()[0]).not.toHaveProperty("title");
    expect(window.localStorage.getItem(onCallRecentStorageKey)).not.toMatch(/Switchboard|9000/);
    expect(readOnCallYouCalled()[0]?.entryId).toBe("h1");
    expect(within(screen.getByTestId("row")).getByText(/^You called \d{2}:\d{2}$/)).toBeInTheDocument();
  });

  it("shows switchboard then extension and dials with a pause", () => {
    render(
      <OnCallDialRow
        id="h2"
        source="handbook"
        title="Registrar"
        dial={resolveHandbookPhone("08 9000 0004, 4455")}
        testId="row"
      />,
    );
    expect(screen.getByRole("link", { name: /^Call Registrar/ })).toHaveAttribute("href", "tel:0890000004,4455");
    expect(screen.getByText(/then ext 4455/)).toBeInTheDocument();
  });

  it("never gives a desk-only number a call disc, and says where to dial it from", async () => {
    render(
      <OnCallDialRow id="h3" source="handbook" title="Ward 4B" dial={resolveHandbookPhone("4456")} testId="row" />,
    );
    expect(screen.queryByRole("link")).toBeNull();
    expect(document.querySelector('a[href^="tel:"]')).toBeNull();
    expect(screen.getByText("From a hospital phone")).toBeInTheDocument();
    // Its disc is a copy control that opens the sheet, never a call link.
    const copyDisc = screen.getByRole("button", { name: "Copy Ward 4B, ext 4456" });
    expect(copyDisc).toHaveAttribute("aria-haspopup", "dialog");
    expect(copyDisc.className).toMatch(/min-h-12/);
    await userEvent.click(copyDisc);
    expect(await screen.findByRole("button", { name: /^Copy extension for Ward 4B/ })).toBeInTheDocument();
    expect(document.querySelector('a[href^="tel:"]')).toBeNull();
  });

  it("offers the recorded mobile route as the only call link beside a short code", () => {
    render(
      <OnCallDialRow
        id="h4"
        source="handbook"
        title="Emergency line"
        dial={resolveHandbookPhone("55")}
        mobileDial={resolveHandbookPhone("9000 0000, 55")}
        testId="row"
      />,
    );
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", "tel:0890000000,55");
    expect(links[0]).toHaveAccessibleName(/^Call Emergency line from a mobile/);
  });

  it("paints quiet red only when asked for the emergency tone", () => {
    const { rerender } = render(
      <OnCallDialRow id="h5" source="handbook" title="Line" dial={resolveHandbookPhone("9000 0005")} testId="row" />,
    );
    expect(screen.queryByTestId("row-emergency-dot")).toBeNull();
    expect(screen.getByTestId("row").innerHTML).not.toMatch(/--danger/);
    rerender(
      <OnCallDialRow
        id="h5"
        source="handbook"
        title="Line"
        dial={resolveHandbookPhone("9000 0005")}
        tone="emergency"
        testId="row"
      />,
    );
    const dot = screen.getByTestId("row-emergency-dot");
    expect(dot.className).toMatch(/size-1\.5/);
    expect(dot.className).toMatch(/--danger/);
    expect(screen.getByRole("link").innerHTML).toMatch(/--danger/);
  });
});

describe("OnCallDialRow geometry (review B1, S2)", () => {
  const VERTICAL_PADDING = /(^|\s)(p|py|pt|pb)-\S+/;

  it("is 48px with a title alone and 52px with a number line, with no vertical padding outside the name button", () => {
    render(
      <ul>
        <OnCallDialRow id="g1" source="handbook" title="Bed manager" dial={null} testId="one" />
        <OnCallDialRow
          id="g2"
          source="handbook"
          title="Switchboard"
          dial={resolveHandbookPhone("9000 0000")}
          testId="two"
        />
        <OnCallDialRow id="g3" source="handbook" title="Ward 4B" dial={resolveHandbookPhone("4456")} testId="three" />
      </ul>,
    );
    const one = screen.getByTestId("one");
    expect(one.className).toMatch(/\bmin-h-12\b/);
    expect(one.className).not.toMatch(/\bmin-h-13\b/);
    // A number always leads a secondary line, so a row with one is 52px.
    for (const row of [screen.getByTestId("two"), screen.getByTestId("three")]) {
      expect(row.className).toMatch(/\bmin-h-13\b/);
    }
    for (const row of [one, screen.getByTestId("two"), screen.getByTestId("three")]) {
      const title = row.querySelector("[data-dial-row-title]") as HTMLElement;
      expect(title.className).toMatch(/\bmin-h-12\b/);
      // Padding outside the name button would push the row past the
      // skeleton's 48/52 and shift the list when it loads.
      const outside = [row, ...Array.from(row.querySelectorAll("*"))].filter(
        (element) => element !== title && !title.contains(element),
      );
      for (const element of outside) {
        expect(element.getAttribute("class") ?? "", element.outerHTML.slice(0, 80)).not.toMatch(VERTICAL_PADDING);
      }
      // Every control in the row meets the 48px floor.
      for (const control of Array.from(row.querySelectorAll("a, button"))) {
        expect(control.className, control.outerHTML.slice(0, 80)).toMatch(/\bmin-h-12\b/);
      }
    }
  });

  it("leads the secondary line under the name with the number, in tabular digits, and lets it wrap", () => {
    render(
      <ul>
        <OnCallDialRow
          id="g3"
          source="handbook"
          title="Switchboard"
          dial={resolveHandbookPhone("9000 0000")}
          testId="row"
        />
      </ul>,
    );
    const row = screen.getByTestId("row");
    const titleColumn = row.querySelector("[data-dial-row-title]");
    const numberColumn = row.querySelector("[data-dial-row-number]");
    expect(titleColumn).not.toBeNull();
    expect(numberColumn).not.toBeNull();
    // The number sits inside the name button, first on the line under the name.
    expect(titleColumn?.contains(numberColumn as Node)).toBe(true);
    // Each part carries its own (clipped at line start) dot, so the number's part is the line's first.
    const numberPart = numberColumn?.parentElement;
    expect(numberPart?.parentElement?.firstElementChild).toBe(numberPart);
    expect(numberColumn).toHaveTextContent("9000 0000");
    expect(numberColumn?.className).toMatch(/\bnums\b/);
    // No fixed right-hand column any more: no width and no right alignment.
    expect(numberColumn?.className).not.toMatch(/\bw-\d+\b|\btext-right\b|\btruncate\b/);
    // Only the call disc sits to the right of the name button.
    expect(row.querySelectorAll('a[href^="tel:"]')).toHaveLength(1);
  });

  it("keeps a desk-only number's column aligned with a copy control where the disc would be", () => {
    render(
      <ul>
        <OnCallDialRow id="g4" source="handbook" title="Ward 4B" dial={resolveHandbookPhone("4456")} testId="row" />
      </ul>,
    );
    const spacer = screen.getByTestId("row").querySelector("[data-dial-row-disc-spacer]");
    expect(spacer).not.toBeNull();
    expect(spacer?.tagName).toBe("BUTTON");
    expect(spacer).toHaveAccessibleName("Copy Ward 4B, ext 4456");
  });

  it("draws a row with no number with nothing to call, copy or open", async () => {
    render(
      <ul>
        <OnCallDialRow id="g5" source="handbook" title="Bed manager" dial={null} testId="row" />
      </ul>,
    );
    const row = screen.getByTestId("row");
    expect(screen.getByText("Bed manager")).toBeInTheDocument();
    expect(within(row).queryByRole("link")).toBeNull();
    expect(row.querySelector("[data-dial-row-number], [data-dial-row-disc-spacer]")).toBeNull();
    // The name is not an enabled control: tapping it opens no sheet.
    for (const button of within(row).queryAllByRole("button")) {
      expect(button).toBeDisabled();
      expect(button).not.toHaveAttribute("aria-label");
    }
    await userEvent.click(screen.getByText("Bed manager"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("names the emergency tone in words on the call link, not only in red", () => {
    render(
      <ul>
        <OnCallDialRow
          id="g6"
          source="handbook"
          title="Synthetic line"
          dial={resolveHandbookPhone("9000 0005")}
          tone="emergency"
          testId="row"
        />
      </ul>,
    );
    expect(screen.getByRole("link")).toHaveAccessibleName(/^Call Synthetic line, emergency,/);
  });
});

describe("toHandbookDial for a reader's own numbers (review S5)", () => {
  it("never tells a reader to ring their own pager from a hospital phone", () => {
    const dial = toHandbookDial({ label: "Pager", value: "123", tel: null });
    expect(dial?.route).not.toBe("hospital-phone");
    expect(dial?.display).toBe("123");
    render(
      <ul>
        <OnCallDialRow id="p1" source="entry" title="Own pager" dial={dial} numberLabel="Pager" testId="row" />
      </ul>,
    );
    expect(screen.queryByText("From a hospital phone")).toBeNull();
    expect(screen.getByText("Pager")).toBeInTheDocument();
  });

  it("never prints a doubled Ext", () => {
    const dial = toHandbookDial({ label: "Ext", value: "4455", tel: null });
    render(
      <ul>
        <OnCallDialRow id="p2" source="entry" title="Own desk" dial={dial} numberLabel="Ext" testId="row" />
      </ul>,
    );
    expect(screen.getByText("ext 4455")).toBeInTheDocument();
    // The display already says "ext"; a second "Ext" label beside it would read
    // "Ext ext 4455" (and break the lower-case rule, F20).
    expect(screen.queryByText(/^Ext$/)).toBeNull();
    expect(screen.getByTestId("row").textContent).not.toMatch(/Ext\s*ext/i);
  });
});

describe("OnCallDialSheet", () => {
  it("shows the number large and light, both routes, copy, share and the updated line", () => {
    render(
      <OnCallDialSheet
        open
        onClose={() => {}}
        title="Registrar"
        hospitalName="Synthetic Hospital"
        dial={resolveHandbookPhone("9000 0004, 4455")}
        updatedAt="2026-09-20T04:00:00.000Z"
        now={NOW}
        testId="sheet"
      />,
    );
    const sheet = screen.getByTestId("sheet-body");
    expect(within(sheet).getByText("Synthetic Hospital")).toBeInTheDocument();
    expect(within(sheet).getByTestId("sheet-number").className).toMatch(/font-light/);
    expect(within(sheet).getByText("From a hospital phone")).toBeInTheDocument();
    expect(within(sheet).getByText("From your mobile")).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: /copy/i })).toBeInTheDocument();
    expect(within(sheet).getByText(/^Updated 20 Sep 2026$/)).toBeInTheDocument();
  });

  it("says Not recorded, in muted grey, when a desk-only number has no mobile route", () => {
    render(
      <OnCallDialSheet
        open
        onClose={() => {}}
        title="Ward"
        hospitalName="Synthetic Hospital"
        dial={resolveHandbookPhone("4456")}
        testId="sheet"
      />,
    );
    expect(within(screen.getByTestId("sheet-body")).getByText("Not recorded").className).toMatch(/text-muted/);
    expect(within(screen.getByTestId("sheet-body")).queryByRole("link", { name: /^Call/ })).toBeNull();
  });
});

describe("labels a reader can trust", () => {
  it("says Updated with the date first and a muted age, never Checked, and links the source", () => {
    render(
      <OnCallUpdatedLine
        updatedAt="2026-09-20T04:00:00.000Z"
        now={NOW}
        sources={[{ label: "WA Health", url: "https://www.health.wa.gov.au/" }]}
      />,
    );
    expect(screen.getByText(/^Updated 20 Sep 2026$/)).toBeInTheDocument();
    expect(screen.getByText("· 6 days ago").className).toMatch(/text-muted/);
    expect(screen.queryByText(/checked/i)).toBeNull();
    expect(screen.getByRole("link", { name: /WA Health/ })).toHaveAttribute(
      "rel",
      expect.stringContaining("noreferrer"),
    );
  });

  it.each([
    [{ kind: "not-set-up" } as const, "Not set up for this hospital"],
    [{ kind: "not-recorded" } as const, "Not recorded"],
    [{ kind: "removed" } as const, "This number was removed. Check with switchboard."],
    [{ kind: "reported" } as const, "Reported"],
  ])("renders %o as plain words with no verdict", (state, text) => {
    const { container } = render(<OnCallStateLabel state={state} />);
    expect(container.textContent).toBe(text);
    expect(container.textContent).not.toMatch(/\b(valid|current|safe|compliant|verified|up to date)\b/i);
  });

  it("is muted words and a small dot, never a filled chip; amber only for a removed number", () => {
    const { container, rerender } = render(<OnCallStateLabel state={{ kind: "not-recorded" }} />);
    expect(container.innerHTML).not.toMatch(/-soft|--warning/);
    rerender(<OnCallStateLabel state={{ kind: "removed" }} />);
    const dot = container.querySelector("[data-state-dot]");
    expect(dot?.className).toMatch(/size-1\.5/);
    expect(dot?.className).toMatch(/--warning/);
    expect(container.innerHTML).not.toMatch(/-soft/);
  });
});

describe("modules", () => {
  it("draws a grouped list flat, with an eyebrow and its count, no header icon tile, and 48/52 rows", () => {
    const { rerender } = render(
      <OnCallGroupedList eyebrow="Emergency" count={2} headerIcon={Siren} testId="group">
        <OnCallRow title="Switchboard" testId="row-1" />
        <OnCallRow title="Registrar" subtitle="Medicine" testId="row-2" />
      </OnCallGroupedList>,
    );
    // The calm look draws no icon tile beside the eyebrow, even when a caller passes one.
    expect(screen.queryByTestId("group-icon")).toBeNull();
    expect(screen.getByTestId("group").querySelector("svg")).toBeNull();
    const heading = screen.getByRole("heading", { level: 2 });
    expect(heading).toHaveTextContent(/^Emergency · 2$/);
    expect(screen.getByTestId("group")).toHaveAttribute("aria-labelledby", heading.id);
    // Flat on the page: the list itself carries no raised card.
    expect(screen.getByRole("list").className).not.toMatch(/rounded|shadow|surface-raised/);
    expect(screen.getByTestId("row-1").className).toMatch(/min-h-12/);
    expect(screen.getByTestId("row-1").className).not.toMatch(/min-h-13/);
    expect(screen.getByTestId("row-2").className).toMatch(/min-h-13/);
    expect(screen.getByTestId("row-1").querySelector("svg")).toBeNull();
    rerender(
      <OnCallGroupedList eyebrow="Emergency" surface="card" testId="group">
        <OnCallRow title="Switchboard" testId="row-1" />
      </OnCallGroupedList>,
    );
    expect(screen.getByRole("list").className).toMatch(/surface-raised/);
  });

  it("puts one teal action at the eyebrow's right, at the 48px floor", async () => {
    const onClick = vi.fn();
    render(
      <OnCallGroupedList eyebrow="Your usual" action={{ label: "Edit", onClick, testId: "edit" }} testId="group">
        <OnCallRow title="Switchboard" leading={<span>SW</span>} testId="row-1" />
      </OnCallGroupedList>,
    );
    const edit = screen.getByTestId("edit");
    expect(edit).toHaveTextContent("Edit");
    expect(edit.className).toMatch(/--mode-identity/);
    expect(edit.className).toMatch(/\bmin-h-12\b/);
    await userEvent.click(edit);
    expect(onClick).toHaveBeenCalledTimes(1);
    // A leading badge sits before the text and is hidden from screen readers.
    const lead = screen.getByText("SW").parentElement as HTMLElement;
    expect(lead).toHaveAttribute("aria-hidden", "true");
    expect(
      lead.compareDocumentPosition(screen.getByText("Switchboard")) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("features one hero link in the soft mode tint, and otherwise keeps it a raised hairline card", () => {
    const { rerender } = render(<OnCallHeroLink href="/on-call/now" title="Who do I call now?" testId="hero" />);
    const plain = screen.getByTestId("hero");
    expect(plain.className).toMatch(/--surface-raised/);
    expect(plain.className).not.toMatch(/--command|--mode-identity/);
    rerender(<OnCallHeroLink href="/on-call/now" title="Who do I call now?" featured testId="hero" />);
    const featured = screen.getByTestId("hero");
    expect(featured).toHaveAttribute("data-mode-identity", "on-call");
    expect(featured.className).toMatch(/bg-\[color:var\(--mode-identity-soft\)\]/);
    expect(featured.className).toMatch(/border-\[color:var\(--mode-identity-border\)\]/);
    expect(featured.className).not.toMatch(/--command/);
    expect(featured).toHaveAttribute("href", "/on-call/now");
  });

  it("draws a compact action shape inside a 48px tap area", () => {
    render(<ModeActionButton icon={Siren} label="Share" onClick={() => {}} testId="action" />);
    const button = screen.getByRole("button", { name: "Share" });
    expect(button.className).toMatch(/min-h-12/);
    expect(button.className).toMatch(/min-w-12/);
    expect(screen.getByTestId("action-shape").className).toMatch(/size-8\.5/);
    expect(screen.getByTestId("action-shape").className).toMatch(/rounded-md/);
  });

  it("writes a fact tile's value at 400 and lets it wrap", () => {
    render(<ModeFactTile label="Switchboard" value="9000 0000" testId="tile" />);
    const value = within(screen.getByTestId("tile")).getByText("9000 0000");
    expect(value.className).toMatch(/font-normal/);
    expect(value.className).not.toMatch(/truncate/);
  });

  it("keeps a notice to one calm line", () => {
    render(<ModeNotice testId="notice">Switchboard number changed.</ModeNotice>);
    expect(screen.getByTestId("notice")).toHaveTextContent("Switchboard number changed.");
    expect(screen.getByTestId("notice")).toHaveAttribute("role", "status");
  });

  it("reserves a module's height with static outlines and no shimmer", () => {
    render(<OnCallModuleSkeleton rows={3} testId="skeleton" />);
    const skeleton = screen.getByTestId("skeleton");
    expect(skeleton).toHaveAttribute("aria-hidden", "true");
    expect(skeleton.querySelectorAll("[data-skeleton-row]")).toHaveLength(3);
    expect(skeleton.innerHTML).not.toMatch(/animate-|shimmer/);
  });
});

function handbook(status: HospitalHandbookState["status"]): HospitalHandbookState {
  return {
    status,
    demo: false,
    services: [],
    serviceId: null,
    siteId: null,
    serviceName: null,
    siteName: null,
    hospitals: [],
    hospitalKey: null,
    items: [],
    removed: [],
    emergencyPinExpected: null,
    source: "network",
    savedAt: null,
    error: null,
    choose: vi.fn(),
    changeHospital: vi.fn(),
    retry: vi.fn(),
    report: vi.fn(),
    hasReported: () => false,
    onRosteredSiteMismatch: vi.fn(),
  };
}

describe("OnCallHandbookState", () => {
  it.each([
    ["signed-out", /Hospital numbers are for signed-in members\./],
    ["expired", /Your session ended\. Sign in again to see your hospital's numbers\./],
    ["no-service", /You are not in a hospital handbook yet\./],
    ["unavailable", /could not be loaded/],
  ] as const)("says what %s means and what to do", (status, words) => {
    render(<OnCallHandbookState handbook={handbook(status)} page="call" />);
    expect(screen.getByTestId(`on-call-handbook-state-${status}`)).toHaveTextContent(words);
  });

  it("keeps the loading space with static outlines and renders nothing once ready", () => {
    const { container, rerender } = render(<OnCallHandbookState handbook={handbook("loading")} page="call" />);
    expect(screen.getByTestId("on-call-handbook-state-loading")).toBeInTheDocument();
    rerender(<OnCallHandbookState handbook={handbook("ready")} page="call" />);
    expect(container).toBeEmptyDOMElement();
  });

  it.each(["signed-out", "expired"] as const)(
    "shows %s as a title and a Sign in action only (review S1, N5)",
    (status) => {
      render(<OnCallHandbookState handbook={handbook(status)} page="call" />);
      const state = screen.getByTestId(`on-call-handbook-state-${status}`);
      expect(within(state).getByRole("button", { name: "Sign in" })).toBeInTheDocument();
      expect(state).not.toHaveTextContent(/Nothing you saved|has been lost|Sign in to see/);
      expect(state.querySelectorAll("p")).toHaveLength(1);
    },
  );

  it("shows unavailable with a usable hospital-phone fallback", () => {
    render(<OnCallHandbookState handbook={handbook("unavailable")} page="call" />);
    const state = screen.getByTestId("on-call-handbook-state-unavailable");
    expect(within(state).getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(state).not.toHaveTextContent(/server did not answer/);
    expect(state).toHaveTextContent("use a hospital phone or ask the ward team for switchboard");
  });

  it("links a reader with no handbook to Manage service", () => {
    render(<OnCallHandbookState handbook={handbook("no-service")} page="call" />);
    expect(screen.getByRole("link", { name: /manage service/i })).toHaveAttribute("href", "/on-call/service");
  });
});

describe("OnCallHospitalLine and OnCallHospitalChooser", () => {
  const twoHospitals = (): HospitalHandbookState => ({
    ...handbook("ready"),
    serviceId: "s1",
    siteId: "a",
    serviceName: "Synthetic Health Service",
    siteName: "Synthetic Hospital",
    hospitalKey: "s1:a",
    hospitals: [
      { serviceId: "s1", serviceName: "Synthetic Health Service", siteId: "a", siteName: "Synthetic Hospital" },
      { serviceId: "s1", serviceName: "Synthetic Health Service", siteId: "b", siteName: "Synthetic North Hospital" },
    ],
  });

  it("names the hospital at 500 and changes it from a checked list of names", async () => {
    const state = twoHospitals();
    render(<OnCallHospitalLine handbook={state} />);
    expect(screen.getByText("Synthetic Hospital").className).toMatch(/font-medium/);
    await userEvent.click(screen.getByRole("button", { name: /Change hospital/ }));
    expect(await screen.findByRole("option", { name: /Synthetic Hospital/ })).toHaveAttribute("aria-selected", "true");
    await userEvent.click(screen.getByRole("option", { name: /Synthetic North Hospital/ }));
    expect(state.changeHospital).toHaveBeenCalledWith("s1", "b");
  });

  it("is a listbox of options: one tab stop, arrows move focus without choosing (review S6)", async () => {
    const state = twoHospitals();
    render(<OnCallHospitalChooser handbook={state} />);
    const group = screen.getByRole("listbox", { name: "Hospital" });
    expect(group.querySelectorAll("li")).toHaveLength(0);
    expect([...group.children].map((child) => child.getAttribute("role"))).toEqual(["option", "option"]);
    const [current, other] = within(group).getAllByRole("option");
    expect(current).toHaveAttribute("tabindex", "0");
    expect(other).toHaveAttribute("tabindex", "-1");
    current?.focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(other).toHaveFocus();
    // Moving never changes the hospital: that reloads the page's numbers.
    expect(state.changeHospital).not.toHaveBeenCalled();
    await userEvent.keyboard("{ArrowDown}");
    expect(current).toHaveFocus();
    await userEvent.keyboard("{End}");
    expect(other).toHaveFocus();
    await userEvent.keyboard(" ");
    expect(state.changeHospital).toHaveBeenCalledWith("s1", "b");
  });

  it("offers no Change and no chooser when there is only one hospital", () => {
    const state = { ...twoHospitals(), hospitals: twoHospitals().hospitals.slice(0, 1) };
    const { container } = render(<OnCallHospitalChooser handbook={state} />);
    expect(container).toBeEmptyDOMElement();
    render(<OnCallHospitalLine handbook={state} />);
    expect(screen.queryByRole("button", { name: /Change hospital/ })).toBeNull();
  });
});
