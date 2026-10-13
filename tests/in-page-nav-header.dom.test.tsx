import { render, screen, waitFor, within } from "@testing-library/react";
import Link from "next/link";
import userEvent from "@testing-library/user-event";
import { Compass, ShieldCheck, Stethoscope } from "lucide-react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { InPageNavHeader } from "@/components/in-page-nav/in-page-nav-header";
import { toDocumentSections, type PageSection } from "@/components/in-page-nav/page-section-index";
import { phoneHeaderCollapseAddonSlotId } from "@/lib/mode-home-composer";

/** Reassigned per case so a rerender can simulate a route change. */
let pathname: string | null = null;
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ back: vi.fn(), replace: vi.fn() }),
}));

// Module state, so a case that navigates would otherwise hand its final
// pathname to whichever case runs next.
beforeEach(() => {
  pathname = null;
});

/** `PhoneHeaderCollapsePortal` resolves its host only below this breakpoint. */
function stubPhoneBreakpoint(isPhone: boolean) {
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query) =>
      ({
        matches: isPhone && query === "(max-width: 639px)",
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }) satisfies MediaQueryList,
  );
}

const sections: PageSection[] = [
  { id: "service-overview", label: "Overview", icon: Stethoscope },
  { id: "service-referral", label: "Referral", icon: Compass },
  { id: "service-verification", label: "Verification", icon: ShieldCheck },
];

function renderHeader(props: Partial<Parameters<typeof InPageNavHeader>[0]> = {}) {
  // The top bar's round left slot, where Back is drawn.
  if (!document.getElementById("universal-header-leading")) {
    const slot = document.createElement("div");
    slot.id = "universal-header-leading";
    document.body.append(slot);
  }
  return render(
    <InPageNavHeader
      back={{ href: "/services", label: "Services" }}
      title="Community Alcohol and Drug Services (CADS) network"
      sections={sections}
      activeId="service-referral"
      onSelectSection={() => undefined}
      testIdPrefix="service"
      {...props}
    />,
  );
}

describe("toDocumentSections", () => {
  it("fills the document-only fields so the shared primitives render unchanged", () => {
    const [first] = toDocumentSections(sections);
    expect(first).toMatchObject({ id: "service-overview", label: "Overview", detail: "", collapsible: false });
  });

  it("splits weight equally when nothing has been measured", () => {
    for (const section of toDocumentSections(sections)) {
      expect(section.weight).toBeCloseTo(1 / 3, 5);
    }
  });

  it("prefers an explicit weight over a measured one", () => {
    // A page that computed its own weights knows something measurement cannot
    // see — a tab panel that is not on screen has no height at all.
    const measured = new Map([
      ["service-overview", 0.9],
      ["service-referral", 0.05],
      ["service-verification", 0.05],
    ]);
    const projected = toDocumentSections([{ ...sections[0]!, weight: 0.25 }, ...sections.slice(1)], measured);
    // Explicit 0.25 wins over measured 0.9; the set is then renormalised.
    expect(projected[0]!.weight).toBeCloseTo(0.25 / (0.25 + 0.05 + 0.05), 5);
    expect(projected[0]!.weight).not.toBeCloseTo(0.9, 5);
  });

  it("uses a measured weight when the section declares none", () => {
    const measured = new Map([
      ["service-overview", 0.6],
      ["service-referral", 0.25],
      ["service-verification", 0.15],
    ]);
    const projected = toDocumentSections(sections, measured);
    expect(projected[0]!.weight).toBeCloseTo(0.6, 5);
    expect(projected.reduce((sum, section) => sum + section.weight, 0)).toBeCloseTo(1, 10);
  });

  it("renormalises mixed explicit and measured weights so the track stays proportional", () => {
    // usePageSectionWeights normalises only the measured subset to 1. Combining
    // that with an already-normalised explicit weight without a second pass
    // would hand DocumentSectionTrack 0.8/0.5/0.5 and flexGrow would paint the
    // intended 80% segment at ~44%.
    const measured = new Map([
      ["service-referral", 0.5],
      ["service-verification", 0.5],
    ]);
    const projected = toDocumentSections([{ ...sections[0]!, weight: 0.8 }, ...sections.slice(1)], measured);
    const total = projected.reduce((sum, section) => sum + section.weight, 0);
    expect(total).toBeCloseTo(1, 10);
    expect(projected[0]!.weight).toBeCloseTo(0.8 / 1.8, 5);
    expect(projected[1]!.weight).toBeCloseTo(0.5 / 1.8, 5);
    expect(projected[2]!.weight).toBeCloseTo(0.5 / 1.8, 5);
  });

  it("leaves an already-normalised all-explicit set unchanged", () => {
    const explicit = [
      { ...sections[0]!, weight: 0.5 },
      { ...sections[1]!, weight: 0.3 },
      { ...sections[2]!, weight: 0.2 },
    ];
    const projected = toDocumentSections(explicit);
    expect(projected.map((section) => section.weight)).toEqual([0.5, 0.3, 0.2]);
  });
});

describe("InPageNavHeader", () => {
  afterEach(() => {
    for (const slot of document.querySelectorAll(`#${phoneHeaderCollapseAddonSlotId}`)) slot.remove();
    vi.restoreAllMocks();
  });

  it("renders the template's four slots", () => {
    renderHeader();

    expect(screen.getByRole("link", { name: "Back to services" })).toHaveAttribute("href", "/services");
    const trigger = screen.getByTestId("service-section-trigger");
    // Line two names where you are, which the track can place but never label.
    expect(within(trigger).getByText("Referral")).toBeInTheDocument();
    expect(screen.getByTestId("service-detail-header")).toBeInTheDocument();
  });

  it("tokenizes the phone gutter instead of a literal px-3", () => {
    // The collapse addon is a sibling of .edge-glass-header, so this class is
    // the only thing that can keep the action pill on --header-edge-pad.
    renderHeader();
    const header = screen.getByTestId("service-detail-header");
    expect(header).toHaveClass("inpage-nav-header");
    expect(header.className).not.toMatch(/\bpx-3\b/);
  });

  it("keeps a phone gap between the action row and the section rail", () => {
    renderHeader({ rail: { label: "Service sections", density: "balanced-four" } });
    expect(screen.getByTestId("service-section-rail")).toHaveClass("mt-2");
  });

  it("draws Back in the top bar, not in the page's own row", () => {
    // One Back, in the top bar (11 Oct 2026 rule, header standard 13 Oct 2026).
    renderHeader();
    const back = screen.getByRole("link", { name: "Back to services" });
    expect(back.closest("#universal-header-leading")).not.toBeNull();
    expect(within(screen.getByTestId("service-detail-header")).queryByRole("link", { name: /^Back to/ })).toBeNull();
  });

  it("leaves the page's single h1 to the record body", () => {
    // Information pages keep their large title in the body, so the header title
    // must not be a second heading.
    renderHeader();
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
  });

  it("gives the header the h1 when it is the page's only title", () => {
    renderHeader({ titleAs: "h1" });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Community Alcohol and Drug Services");
  });

  it("opens the section sheet from the title and reports position", async () => {
    const user = userEvent.setup();
    renderHeader();

    await user.click(screen.getByTestId("service-section-trigger"));

    const sheet = await screen.findByTestId("service-section-sheet");
    expect(within(sheet).getByText("Referral · 2 of 3")).toBeInTheDocument();
  });

  it("returns focus to the trigger when the section sheet closes", async () => {
    const user = userEvent.setup();
    renderHeader();
    const trigger = screen.getByTestId("service-section-trigger");

    await user.click(trigger);
    await screen.findByTestId("service-section-sheet");
    await user.click(screen.getByRole("button", { name: "Close section list" }));

    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("returns focus to a visible rail control when the title disclosure is hidden", async () => {
    // With a rail, the disclosure is `sm:hidden`. A sheet opened on phone that
    // closes after the viewport crosses `sm` must not restore to a display:none
    // button (focus then falls to the page body).
    const user = userEvent.setup();
    renderHeader({ rail: { label: "Service sections", density: "balanced-four" } });
    const trigger = screen.getByTestId("service-section-trigger");

    await user.click(trigger);
    await screen.findByTestId("service-section-sheet");

    Object.defineProperty(trigger, "getClientRects", {
      configurable: true,
      value: () => [] as unknown as DOMRectList,
    });

    await user.click(screen.getByRole("button", { name: "Close section list" }));

    const activeRail = screen.getByTestId("service-section-rail").querySelector('[aria-current="true"]');
    expect(activeRail).not.toBeNull();
    await waitFor(() => expect(activeRail).toHaveFocus());
  });

  it("selects a section and closes the sheet in one action", async () => {
    const user = userEvent.setup();
    const selected: string[] = [];
    renderHeader({ onSelectSection: (id) => selected.push(id) });

    await user.click(screen.getByTestId("service-section-trigger"));
    const sheet = await screen.findByTestId("service-section-sheet");
    await user.click(within(sheet).getByRole("button", { name: /Verification/ }));

    expect(selected).toEqual(["service-verification"]);
    await waitFor(() => expect(screen.queryByTestId("service-section-sheet")).toBeNull());
  });

  it("renders no ellipsis when the page has no actions", () => {
    // A control that opens an empty sheet advertises something that is not there.
    renderHeader();
    expect(screen.queryByTestId("service-actions-trigger")).toBeNull();
  });

  it("opens page actions and hands them a way to close the sheet", async () => {
    const user = userEvent.setup();
    renderHeader({
      actionsNoun: "service",
      actions: (close) => (
        <button type="button" onClick={close}>
          Save service
        </button>
      ),
    });

    await user.click(screen.getByRole("button", { name: "Open service actions" }));
    const sheet = await screen.findByTestId("service-actions-sheet");
    await user.click(within(sheet).getByRole("button", { name: "Save service" }));

    await waitFor(() => expect(screen.queryByTestId("service-actions-sheet")).toBeNull());
  });

  it("drops the section machinery when the page has no sections", () => {
    // A one-item sheet and a single full-width segment are what the section
    // shape degrades to on a breadcrumb page, so neither is rendered at all.
    // Omit `sections` entirely — an empty array would still demand a select
    // handler under the discriminated props contract.
    renderHeader({ sections: undefined, activeId: undefined, onSelectSection: undefined });

    expect(screen.queryByTestId("service-section-trigger")).toBeNull();
    expect(screen.queryByTestId("service-section-sheet")).toBeNull();
    expect(screen.getByText("Community Alcohol and Drug Services (CADS) network")).toBeInTheDocument();
  });

  it("keeps the back destination named, as an icon-only control", () => {
    // The arrow has no visible words, so its accessible name is the only thing
    // that says where it goes.
    renderHeader({ sections: undefined, activeId: undefined, onSelectSection: undefined });

    const back = screen.getByRole("link", { name: "Back to services" });
    expect(back).toHaveAttribute("href", "/services");
    expect(within(back).queryByText("Services")).toBeNull();
  });

  it("promotes one action and keeps its name across breakpoints", async () => {
    const user = userEvent.setup();
    const pressed: string[] = [];
    renderHeader({
      sections: undefined,
      activeId: undefined,
      onSelectSection: undefined,
      primaryAction: { label: "Download PDF", icon: Compass, onClick: () => pressed.push("download") },
    });

    // The label is `sr-only` below `sm` rather than removed, so this name holds
    // at every width.
    await user.click(screen.getByRole("button", { name: "Download PDF" }));
    expect(pressed).toEqual(["download"]);
  });

  it("renders a view mode as a radiogroup and reports the chosen value", async () => {
    const user = userEvent.setup();
    const chosen: string[] = [];
    renderHeader({
      sections: undefined,
      activeId: undefined,
      onSelectSection: undefined,
      mode: {
        label: "Reading level",
        value: "easy",
        options: [
          { value: "easy", label: "Easy read" },
          { value: "standard", label: "Standard" },
        ],
        onChange: (value) => chosen.push(value),
      },
    });

    const group = screen.getByRole("radiogroup", { name: "Reading level" });
    expect(within(group).getByRole("radio", { name: "Easy read" })).toBeChecked();

    await user.click(within(group).getByRole("radio", { name: "Standard" }));
    expect(chosen).toEqual(["standard"]);
  });

  it("renders no view mode when the page has none", () => {
    renderHeader({ sections: undefined, activeId: undefined, onSelectSection: undefined });
    expect(screen.queryByRole("radiogroup")).toBeNull();
  });

  it("keeps phone tab order aligned with the painted header rows", () => {
    // Below `sm`, mode is the lower full-width band. Putting it before the
    // verbs in the DOM made keyboard focus enter the lower band then jump back
    // up to Download / ellipsis. DOM order is now verbs then mode; `sm:order-*`
    // only rearranges the desktop paint.
    renderHeader({
      sections: undefined,
      activeId: undefined,
      onSelectSection: undefined,
      primaryAction: { label: "Download PDF", icon: Compass, onClick: () => undefined },
      mode: {
        label: "Reading level",
        value: "easy",
        options: [
          { value: "easy", label: "Easy read" },
          { value: "standard", label: "Standard" },
        ],
        onChange: () => undefined,
      },
      actions: <button type="button">Save</button>,
      actionsNoun: "factsheet",
    });

    const header = screen.getByTestId("service-detail-header");
    const focusables = Array.from(
      header.querySelectorAll('a[href], button:not([disabled]), [role="radio"]'),
    ) as HTMLElement[];
    const names = focusables.map((el) => {
      if (el.getAttribute("role") === "radio") return el.textContent?.trim() ?? "";
      return el.getAttribute("aria-label") || el.textContent?.replace(/\s+/g, " ").trim() || "";
    });

    expect(names).toEqual(["Download PDF", "Open factsheet actions", "Easy read", "Standard"]);
  });

  it("accepts plain node actions from a Server Component page", async () => {
    // Four of the seven converted pages are Server Components. React cannot pass
    // a function across that boundary, so the render-prop form alone would fail
    // to build there; server-rendered JSX passed as a slot is fine.
    const user = userEvent.setup();
    renderHeader({
      actionsNoun: "specifier",
      actions: <Link href="/specifiers/compare">Compare</Link>,
    });

    await user.click(screen.getByRole("button", { name: "Open specifier actions" }));
    const sheet = await screen.findByTestId("service-actions-sheet");
    expect(within(sheet).getByRole("link", { name: "Compare" })).toHaveAttribute("href", "/specifiers/compare");
  });

  it("closes both sheets when the route changes under them", async () => {
    // Server-passed action JSX is mostly `<Link>`s and has no way to call
    // `close()`, so navigation has to close the sheet generically. Both sheets
    // record the route they were opened on rather than a bare boolean.
    const user = userEvent.setup();
    pathname = "/specifiers/with-anxious-distress";
    const view = renderHeader({ actionsNoun: "specifier", actions: <Link href="/specifiers/compare">Compare</Link> });

    await user.click(screen.getByRole("button", { name: "Open specifier actions" }));
    expect(await screen.findByTestId("service-actions-sheet")).toBeInTheDocument();

    pathname = "/specifiers/compare";
    view.rerender(
      <InPageNavHeader
        back={{ href: "/services", label: "Services" }}
        title="Community Alcohol and Drug Services (CADS) network"
        sections={sections}
        activeId="service-referral"
        onSelectSection={() => undefined}
        testIdPrefix="service"
        actionsNoun="specifier"
        actions={<Link href="/specifiers/compare">Compare</Link>}
      />,
    );

    await waitFor(() => expect(screen.queryByTestId("service-actions-sheet")).toBeNull());
  });

  it("portals into the universal collapse slot on phones rather than owning a second scroll-hide header", async () => {
    // The contract is one collapse owner per phone header: below `sm` this
    // subtree belongs to the universal header's collapse row.
    stubPhoneBreakpoint(true);
    const slot = document.createElement("div");
    slot.id = phoneHeaderCollapseAddonSlotId;
    document.body.append(slot);

    renderHeader();

    await waitFor(() => expect(slot.querySelector('[data-testid="service-detail-header"]')).not.toBeNull());
  });

  it("stays in page flow above the phone breakpoint", async () => {
    // At `sm+` the same subtree is sticky in its own page position. Portaling it
    // there would move a desktop page header into the shared search chrome.
    stubPhoneBreakpoint(false);
    const slot = document.createElement("div");
    slot.id = phoneHeaderCollapseAddonSlotId;
    document.body.append(slot);

    renderHeader();

    await waitFor(() => expect(screen.getByTestId("service-detail-header")).toBeInTheDocument());
    expect(slot.querySelector('[data-testid="service-detail-header"]')).toBeNull();
  });
});

/**
 * The shape On Call takes: a bar, and nothing else.
 *
 * These render `InPageNavHeader` directly with explicit sections, which is the
 * only way to exercise a rail in jsdom — `useResolvedPageSections` decides what
 * is on screen with `getClientRects()`, and jsdom reports that empty for every
 * element, so a mode's own header never reaches its rail here. The mode's
 * wiring is pinned on source by `tests/on-call-section-header-testids.test.ts`,
 * and the rendered bar by `tests/ui-on-call-boards.spec.ts` in a browser.
 */
describe("InPageNavHeader with titleHidden", () => {
  const railProps = {
    titleHidden: true,
    rail: { label: "Sections of this page", density: "wordmark-five" as const, modeIdentity: "on-call" },
    back: undefined,
    actions: undefined,
  };

  /**
   * Four sections, because More exists only when the bar cannot show them all.
   * `planModeNavBands` fits three at every band, so a three-section bar has no
   * overflow slot and therefore no sheet to reach — which is correct, and also
   * why the sheet cases below need a fourth.
   */
  const overflowingRailProps = {
    ...railProps,
    sections: [...sections, { id: "service-contact", label: "Contact", icon: Compass }],
  };

  it("draws no row at all when nothing but the bar claims it", () => {
    // The 48px this costs is the whole reason the option exists: with the page
    // named by chrome directly above, a row holding a repeat of that name was
    // the duplication, and an empty row would have been worse.
    renderHeader(railProps);
    const header = screen.getByTestId("service-detail-header");
    expect(header.textContent).not.toContain("Community Alcohol");
    expect(screen.queryByTestId("service-section-trigger")).toBeNull();
    expect(screen.queryByTestId("service-action-group")).toBeNull();
    expect(screen.getByTestId("service-section-rail")).toBeInTheDocument();
  });

  it("still names the page where a screen reader will meet it", async () => {
    // `title` is required either way, and the section sheet is where it lands:
    // unpainted is not unnamed.
    const user = userEvent.setup();
    renderHeader(overflowingRailProps);
    await user.click(screen.getByTestId("service-section-overflow"));
    expect(screen.getByTestId("service-section-sheet").textContent).toContain("Community Alcohol");
  });

  it("keeps the row when something else is still on it", () => {
    // The guard is "nothing else claims the row", not "titleHidden". A page
    // that hides its title but keeps a promoted action must still get a row to
    // put it in.
    renderHeader({ ...railProps, actions: <button type="button">Print</button> });
    expect(screen.getByTestId("service-action-group")).toBeInTheDocument();
    expect(screen.getByTestId("service-detail-header").textContent).not.toContain("Community Alcohol");
  });

  it("carries the mode's identity attribute on the bar, never a dynamic class", () => {
    // `bg-[color:var(--x-${mode})]` produces no CSS at all — Tailwind's scanner
    // only sees literal strings — and an inline style is ceilinged by
    // `check:design-drift-ratchet`. So the hue arrives as an attribute that
    // remaps `--clinical-accent` inside this `<nav>` alone.
    renderHeader(railProps);
    expect(screen.getByTestId("service-section-rail")).toHaveAttribute("data-mode-identity", "on-call");
  });

  it("offers a return out of the section sheet, and only where the bar is its overflow", async () => {
    const user = userEvent.setup();
    renderHeader(overflowingRailProps);
    await user.click(screen.getByTestId("service-section-overflow"));
    const back = screen.getByTestId("service-section-sheet-back");
    expect(back).toHaveAccessibleName(/Back to Community Alcohol/);
    await user.click(back);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("renders no return control on the title-disclosure shape, where the sheet IS the navigation", () => {
    // A second dismissal there is furniture: nothing is still on screen to go
    // back to, which is exactly what the word "return" would be promising.
    renderHeader();
    expect(screen.queryByTestId("service-section-sheet-back")).toBeNull();
  });
});
