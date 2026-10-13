import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { installMatchMediaStub } from "./setup/jsdom.setup";

const announcer = vi.hoisted(() => ({ announce: vi.fn() }));
vi.mock("@/components/ui/live-announcer", () => ({ announce: announcer.announce }));

import { SharedCompareTray } from "@/components/compare/shared-compare-tray";

const SLOT_ID = "test-dock-slot";

function tray(count: number, onClear = vi.fn()) {
  return (
    <SharedCompareTray
      count={count}
      names={["Delirium", "Acute psychosis", "Mania"].slice(0, count)}
      compareHref="/differentials/compare?ids=a,b"
      onClear={onClear}
      noun="diagnoses"
      phonePlacement={{ dockSlotId: SLOT_ID }}
      testId="tray"
    />
  );
}

beforeEach(() => {
  announcer.announce.mockReset();
  document.getElementById(SLOT_ID)?.remove();
});

describe("SharedCompareTray", () => {
  it("appears only once something is ticked, and goes when the selection empties", async () => {
    installMatchMediaStub(false);
    const { rerender } = render(tray(0));
    expect(screen.queryByTestId("tray")).toBeNull();
    expect(screen.queryByTestId("tray-spacer")).toBeNull();

    rerender(tray(1));
    expect(await screen.findByTestId("tray")).toBeInTheDocument();
    expect(screen.getByTestId("tray-count")).toHaveTextContent("1 selected");

    rerender(tray(0));
    expect(screen.queryByTestId("tray")).toBeNull();
    // The bottom spacer only exists while the tray does, so an empty list has no blank band.
    expect(screen.queryByTestId("tray-spacer")).toBeNull();
  });

  it("reads 'N selected, Clear, Compare' and Compare opens the existing compare page", async () => {
    installMatchMediaStub(false);
    const onClear = vi.fn();
    render(tray(2, onClear));

    const region = await screen.findByRole("region", { name: "Compare selection" });
    expect(region).toHaveTextContent("2 selected");
    expect(region).toHaveTextContent("Delirium · Acute psychosis");
    expect(screen.getByRole("link", { name: "Compare" })).toHaveAttribute("href", "/differentials/compare?ids=a,b");

    await userEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("keeps Compare reachable but unavailable below two, with the reason", async () => {
    installMatchMediaStub(false);
    render(tray(1));

    const compare = await screen.findByTestId("tray-compare");
    expect(compare).toHaveAttribute("aria-disabled", "true");
    expect(compare).not.toBeDisabled();
    expect(compare).toHaveAccessibleDescription("Tick at least 2 diagnoses to compare.");
  });

  it("announces selection changes to screen readers, but not the first render", () => {
    installMatchMediaStub(false);
    const { rerender } = render(tray(1));
    expect(announcer.announce).not.toHaveBeenCalled();

    rerender(tray(2));
    expect(announcer.announce).toHaveBeenLastCalledWith(
      "2 diagnoses selected for comparison. Compare is ready.",
      expect.anything(),
    );

    rerender(tray(0));
    expect(announcer.announce).toHaveBeenLastCalledWith("Comparison selection cleared.", expect.anything());
  });

  it("on a phone sits inside the search dock's addon slot, above the search box", async () => {
    installMatchMediaStub(true);
    const slot = document.createElement("div");
    slot.id = SLOT_ID;
    document.body.append(slot);
    render(tray(2));

    const region = await screen.findByTestId("tray");
    expect(slot.contains(region)).toBe(true);
  });

  it("on a phone without a dock slot becomes a footer layer and pads the list end", async () => {
    installMatchMediaStub(true);
    render(
      <SharedCompareTray
        count={2}
        compareHref="/dsm/compare?ids=a,b"
        onClear={vi.fn()}
        noun="diagnoses"
        phonePlacement="footer-layer"
        testId="tray"
      />,
    );

    const region = await screen.findByTestId("tray");
    expect(region.closest(".shared-compare-tray-layer")).not.toBeNull();
    expect(screen.getByTestId("tray-spacer")).toBeInTheDocument();
  });
});
