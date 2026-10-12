import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installMatchMediaStub } from "./setup/jsdom.setup";

import type { Therapy } from "@/components/therapy-compass/data/types";
import { therapyCompareAddonSlotId } from "@/lib/mode-home-composer";
import { THERAPY_MAX_COMPARE } from "@/lib/therapy-compass-navigation";

const tc = vi.hoisted(() => ({
  compareSlugs: [] as string[],
  compareTherapies: [] as Therapy[],
  clearCompare: vi.fn(),
  removeCompare: vi.fn(),
  pathname: "/therapy-compass/search",
}));

vi.mock("next/navigation", () => ({
  usePathname: () => tc.pathname,
}));

vi.mock("@/components/therapy-compass/bindings", () => ({
  useTcBindings: () => ({
    compareSlugs: tc.compareSlugs,
    compareTherapies: tc.compareTherapies,
    clearCompare: tc.clearCompare,
    removeCompare: tc.removeCompare,
    workspaceHref: (href: string) => `${href}?compare=${tc.compareSlugs.join(",")}`,
  }),
}));

import { TherapyCompareTray } from "@/components/therapy-compass/therapy-compare-tray";

function therapy(slug: string, name: string, aliases: string[] = []): Therapy {
  return { slug, name, aliases, tags: [], category: "Behavioural" } as unknown as Therapy;
}

const CBT = therapy("cbt", "Cognitive behavioural therapy", ["CBT"]);
const ACT = therapy("act", "Acceptance and commitment therapy", ["ACT"]);

function select(...items: Therapy[]) {
  tc.compareTherapies = items;
  tc.compareSlugs = items.map((item) => item.slug);
}

/** The dock renders the addon slot inside its own form; stand one in for it. */
function mountDockSlot() {
  const slot = document.createElement("div");
  slot.id = therapyCompareAddonSlotId;
  document.body.append(slot);
  return slot;
}

beforeEach(() => {
  // The tray gates on the phone breakpoint the dock itself uses (639px).
  installMatchMediaStub(true);
  tc.pathname = "/therapy-compass/search";
  select();
});

afterEach(() => {
  document.getElementById(therapyCompareAddonSlotId)?.remove();
  tc.clearCompare.mockReset();
  tc.removeCompare.mockReset();
});

describe("Therapy compare tray (the shared Compare tray)", () => {
  it("does not exist until something is ticked", () => {
    mountDockSlot();
    render(<TherapyCompareTray />);

    expect(screen.queryByTestId("therapy-compare-tray")).toBeNull();
  });

  it("does not duplicate selection chrome on the compare page itself", () => {
    tc.pathname = "/therapy-compass/compare";
    mountDockSlot();
    select(CBT, ACT);
    render(<TherapyCompareTray />);

    expect(screen.queryByTestId("therapy-compare-tray")).toBeNull();
  });

  it("on a phone docks inside the composer's addon slot rather than positioning itself", async () => {
    const slot = mountDockSlot();
    select(CBT);
    render(<TherapyCompareTray />);

    const tray = await screen.findByTestId("therapy-compare-tray");
    // Inheriting the dock's fixed position, z-index, safe-area and scroll-hide
    // transform is the entire reason this is a portal and not new chrome.
    expect(slot.contains(tray)).toBe(true);
  });

  it("on a phone with no dock slot renders nothing rather than covering the page", () => {
    select(CBT, ACT);
    render(<TherapyCompareTray />);

    expect(screen.queryByTestId("therapy-compare-tray")).toBeNull();
  });

  it("on wider screens floats as a pill with a spacer keeping the last row clear", async () => {
    installMatchMediaStub(false);
    select(CBT, ACT);
    render(<TherapyCompareTray />);

    expect(await screen.findByTestId("therapy-compare-tray")).toBeInTheDocument();
    expect(screen.getByTestId("therapy-compare-tray-spacer")).toBeInTheDocument();
  });

  it("holds Compare back until there are two, and says why", async () => {
    mountDockSlot();
    select(CBT);
    render(<TherapyCompareTray />);

    const compare = await screen.findByTestId("therapy-compare-tray-compare");
    expect(compare.tagName).toBe("BUTTON");
    expect(compare).toHaveAttribute("aria-disabled", "true");
    expect(compare).not.toBeDisabled();
    expect(compare).toHaveAccessibleDescription("Tick at least 2 therapies to compare.");
  });

  it("opens the existing compare page once two are selected", async () => {
    mountDockSlot();
    select(CBT, ACT);
    render(<TherapyCompareTray />);

    const compare = await screen.findByTestId("therapy-compare-tray-compare");
    expect(compare.tagName).toBe("A");
    expect(compare).toHaveAttribute("href", "/therapy-compass/compare?compare=cbt,act");
  });

  it("shows the record's abbreviation where it has one, counts the set, and clears it", async () => {
    mountDockSlot();
    select(CBT, ACT);
    render(<TherapyCompareTray />);

    const tray = await screen.findByTestId("therapy-compare-tray");
    expect(tray).toHaveTextContent("CBT · ACT");
    expect(tray).toHaveTextContent(`2 of ${THERAPY_MAX_COMPARE} selected`);
    expect(tray).toHaveAttribute("role", "region");
    expect(tray).toHaveAccessibleName("Compare selection");

    await userEvent.click(screen.getByTestId("therapy-compare-tray-clear"));
    expect(tc.clearCompare).toHaveBeenCalledTimes(1);
  });

  it("lists each selection in a sheet so one can be removed without clearing the rest", async () => {
    const user = userEvent.setup();
    mountDockSlot();
    select(CBT, ACT);
    render(<TherapyCompareTray />);

    await user.click(screen.getByTestId("therapy-compare-tray-open"));
    const sheet = await screen.findByTestId("therapy-compare-tray-sheet");
    expect(sheet).toBeVisible();
    await user.click(screen.getByRole("button", { name: /Remove ACT from the comparison/ }));
    expect(tc.removeCompare).toHaveBeenCalledWith("act");
    expect(tc.clearCompare).not.toHaveBeenCalled();
  });
});
