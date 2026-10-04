/** @vitest-environment jsdom */
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import FirstNationsError from "@/app/(search-app)/first-nations/error";
import { BedsideHomeView } from "@/components/first-nations/bedside-home";
import { FIRST_NATIONS_ICONS } from "@/components/first-nations/first-nations-icons";
import { InnerPageView, toTabs, visibleSections } from "@/components/first-nations/inner-page";
import { FirstNationsPageRenderer } from "@/components/first-nations/page-renderer";
import {
  firstNationsPageIds,
  moduleIcons,
  parseFirstNationsContent,
  type FirstNationsPageId,
} from "@/lib/first-nations/content-schema";
import { buildBedsideModel, buildInnerPageModel } from "@/lib/first-nations/view-model";
import {
  contentInput,
  contentWithNoteWording,
  enabledProfile,
  testInputs,
  type ContentInput,
} from "./fixtures/first-nations-content";
import { acknowledgementApproval, resetAfterEach } from "./fixtures/first-nations-models";

vi.mock("@/components/first-nations/kit", async () => await import("./fixtures/first-nations-kit-double"));
vi.mock("@/components/first-nations/first-nations-nav-header", () => ({ FirstNationsNavHeader: () => null }));
vi.mock("@/components/first-nations/page-menu", () => ({
  FirstNationsHomeMenu: () => null,
  FirstNationsMenuActions: () => null,
}));
vi.mock("@/components/first-nations/primer", () => ({ Primer: () => null, PRIMER_EVENT: "x" }));
vi.mock("@/components/first-nations/reading-trust-sheet", () => ({
  ReadingTrustSheet: () => null,
  READING_TRUST_EVENT: "x",
  openReadingTrustSheet: () => {},
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/first-nations" }));

resetAfterEach();

const profile = enabledProfile();
const ack = acknowledgementApproval();
const parts = () => [...document.querySelectorAll("[data-fn-part]")].map((el) => el.getAttribute("data-fn-part"));
const credit = { sourceId: "src-test", checkedAt: "2026-09-26" } as const;

function contactsPage(input: ContentInput) {
  const contacts = input.pages.find((p) => p.id === "contacts");
  if (!contacts) throw new Error("fixture has no contacts page");
  return contacts;
}

describe("Bedside", () => {
  it("composes example line, crisis strip, hero, Situation, tools, search and Acknowledgement in the Today order", () => {
    render(<BedsideHomeView model={buildBedsideModel(testInputs({ profile, approvals: [ack] }))} />);
    expect(parts().filter((p) => p !== "plan-panel" && p !== "review-stamp")).toEqual([
      "example",
      "crisis",
      "hero",
      "situation",
      "tools",
      "search",
      "acknowledgement",
    ]);
  });
  it("shows the not-set-up state module, statewide numbers and no Acknowledgement while the layer is off", () => {
    render(<BedsideHomeView model={buildBedsideModel(testInputs())} />);
    expect(screen.getByText("Liaison not set up here yet")).toBeTruthy();
    expect(screen.getByText("Statewide numbers still work.")).toBeTruthy();
    expect(parts()).not.toContain("hero");
    expect(parts()).toContain("crisis");
    expect(parts()).not.toContain("acknowledgement");
  });
  it("hides the Acknowledgement until approved words exist", () => {
    render(<BedsideHomeView model={buildBedsideModel(testInputs({ profile }))} />);
    expect(parts()).not.toContain("acknowledgement");
  });
  it("shows one example line while anything awaits approval", () => {
    render(<BedsideHomeView model={buildBedsideModel(testInputs())} />);
    expect(screen.getAllByText("Example only · wording awaiting approval")).toHaveLength(1);
  });
  it("keeps the crisis strip when the phone goes offline", () => {
    render(<BedsideHomeView model={buildBedsideModel(testInputs())} />);
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(screen.getByText("Offline")).toBeTruthy();
    expect(parts()).toContain("crisis");
    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
  });
});

describe("Inner pages", () => {
  it("shows credited content with the example line and never our own unapproved wording", () => {
    const content = parseFirstNationsContent(contentWithNoteWording());
    render(<InnerPageView model={buildInnerPageModel(testInputs({ content }), "contacts")} />);
    expect(screen.getByText("Tip on contacts")).toBeTruthy();
    expect(screen.getAllByText("Example only · wording awaiting approval")).toHaveLength(1);
    expect(screen.queryByText(/Collaborated with/)).toBeNull();
    expect(screen.getByText("13 11 14")).toBeTruthy();
  });
  it("shows the empty state for hospital numbers while the layer is off, keeping the crisis strip", () => {
    const input = contentInput();
    contactsPage(input).sections[0].modules.push({
      id: "hospital-numbers",
      title: "Hospital",
      icon: "phone",
      layout: "service-contacts",
      blocks: [],
    });
    render(
      <InnerPageView
        model={buildInnerPageModel(testInputs({ content: parseFirstNationsContent(input) }), "contacts")}
      />,
    );
    expect(screen.getByText("No hospital numbers yet")).toBeTruthy();
    expect(parts()).toContain("crisis");
  });
  it("ends with the four-number crisis block", () => {
    render(<InnerPageView model={buildInnerPageModel(testInputs(), "talking")} />);
    for (const n of ["000", "13 92 76", "1300 555 788", "13 11 14"])
      expect(screen.getAllByText(n).length).toBe(n === "000" || n === "13 92 76" ? 2 : 1);
  });
  it("shows a number that cannot be dialled as text with its source, never as a tel: link", () => {
    const input = contentInput();
    contactsPage(input).sections[0].modules[0].blocks.push({
      kind: "contact",
      id: "see-website",
      name: "Aboriginal Interpreting WA",
      number: "See website",
      layer: "statewide",
      ...credit,
    });
    const { container } = render(
      <InnerPageView
        model={buildInnerPageModel(testInputs({ content: parseFirstNationsContent(input) }), "contacts")}
      />,
    );
    const text = screen.getByText("See website");
    expect(text.closest("a, button")).toBeNull();
    expect(
      [...container.querySelectorAll("a[href^='tel:']")].every((a) =>
        /^tel:\+?\d+$/.test(a.getAttribute("href") ?? ""),
      ),
    ).toBe(true);
    expect(screen.getAllByText(/From Test guide|Checked/).length).toBeGreaterThan(0);
  });
  it("gives tabs plain labels with no counts", () => {
    const tabs = toTabs(buildInnerPageModel(testInputs(), "talking"));
    expect(tabs.map((t) => t.label)).toEqual(["Main"]);
    expect(tabs.every((t) => !/\d/.test(t.label))).toBe(true);
  });
  it("drops a tab whose modules have nothing left to show", () => {
    const input = contentInput();
    const talking = input.pages.find((p) => p.id === "talking");
    if (!talking) throw new Error("fixture has no talking page");
    talking.sections.push({
      id: "talking-empty",
      tab: "Empty",
      modules: [
        {
          id: "talking-empty-wording",
          title: "Wording",
          icon: "message",
          layout: "list",
          // Our own wording, awaiting approval, so the view-model drops it and the tab has nothing left.
          blocks: [{ kind: "noteWording", id: "w2", heading: "Wording", template: "Spoke with [blank].", ...credit }],
        },
      ],
    });
    const model = buildInnerPageModel(testInputs({ content: parseFirstNationsContent(input) }), "talking");
    expect(toTabs(model).map((t) => t.label)).toEqual(["Main"]);
    expect(visibleSections(model).map((s) => s.id)).toEqual(["talking-main"]);
    render(<InnerPageView model={model} />);
    expect(document.getElementById("talking-empty")).toBeNull();
  });
  it("keeps content icon names and the icon map in step", () => {
    expect(Object.keys(FIRST_NATIONS_ICONS).sort()).toEqual([...moduleIcons].sort());
  });
});

describe("Shipped content", () => {
  it.each(firstNationsPageIds)("renders %s without an EMHS name or a tel: link that is not a number", (id) => {
    const { container } = render(<FirstNationsPageRenderer pageId={id as FirstNationsPageId} />);
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/East Metropolitan|EMHS|Royal Perth/);
    expect(parts()).toContain("crisis");
    expect(screen.getAllByText("Example only · wording awaiting approval").length).toBeLessThanOrEqual(1);
    for (const a of container.querySelectorAll("a[href^='tel:']"))
      expect(a.getAttribute("href")).toMatch(/^tel:\+?\d+$/);
    if (id === "bedside") expect(screen.getByText("Liaison not set up here yet")).toBeTruthy();
  });
});

describe("Error boundary", () => {
  it("uses the shared state module and keeps the crisis strip", () => {
    const retry = vi.fn();
    render(<FirstNationsError error={new Error("x")} retry={retry} />);
    expect(screen.getByText("This page didn't load")).toBeTruthy();
    expect(screen.getByRole("link", { name: /000/ })).toBeTruthy();
    screen.getByRole("button", { name: "Try again" }).click();
    expect(retry).toHaveBeenCalledOnce();
  });
});
