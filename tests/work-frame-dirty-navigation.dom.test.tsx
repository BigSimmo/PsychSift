import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CmeEntryForm } from "@/components/cme/cme-entry-form";
import { useDirtyStateGuard } from "@/components/ui/use-dirty-state-guard";
import { WorkFrameHeader, universalHeaderLeadingSlotId } from "@/components/work-frame/work-frame-header";
import { resetWorkTrailForTests } from "@/components/work-frame/work-frame-store";
import { WORK_AREAS } from "@/lib/work-frame/areas";

const navigation = vi.hoisted(() => ({ push: vi.fn(), nativeFollow: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
  usePathname: () => "/roster/manage?view=team",
}));

// Next's documented onNavigate contract: only same-tab SPA navigation calls it.
// Hosted/browser coverage remains responsible for Next's actual event dispatch.
vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    onClick,
    onNavigate,
    ...rest
  }: Omit<ComponentProps<"a">, "href"> & {
    href: string;
    children: ReactNode;
    onNavigate?: (event: { preventDefault: () => void }) => void;
  }) => (
    <a
      {...rest}
      href={href}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        event.preventDefault();
        if (
          event.ctrlKey ||
          event.metaKey ||
          event.shiftKey ||
          event.altKey ||
          event.button !== 0 ||
          rest.target === "_blank"
        ) {
          navigation.nativeFollow(href);
          return;
        }
        let cancelled = false;
        onNavigate?.({
          preventDefault: () => {
            cancelled = true;
          },
        });
        if (!cancelled) navigation.push(href);
      }}
    >
      {children}
    </a>
  ),
}));

vi.mock("@/components/work-frame/use-work-frame-gate-open", () => ({
  useWorkFrameGateOpen: () => () => true,
}));
vi.mock("@/components/work-frame/use-sticky-work-tabs", () => ({ useStickyWorkTabs: () => {} }));
vi.mock("@/components/work-mode-launch/work-mode-launch-provider", () => ({
  useNewWorkMode: () => false,
  useWorkModeRouteVisible: () => () => true,
}));
vi.mock("@/components/favourites/work-page-favourite-button", () => ({ WorkPageFavouriteButton: () => null }));

afterEach(() => {
  navigation.push.mockReset();
  navigation.nativeFollow.mockReset();
  resetWorkTrailForTests();
});

function Frame({ dirty = true, cpd = false }: { dirty?: boolean; cpd?: boolean }) {
  useDirtyStateGuard(dirty && !cpd);
  const area = WORK_AREAS.manage;
  return (
    <>
      <div id={universalHeaderLeadingSlotId} />
      <WorkFrameHeader
        area={area}
        modeId="roster"
        current={area.tabs[2]}
        currentIsOwnPage={false}
        eyebrow={null}
        title="Synthetic draft"
        status={null}
        action={null}
        bandRef={() => {}}
      />
      {cpd ? <CmeEntryForm onSubmit={vi.fn()} /> : <p data-testid="draft">Synthetic unsaved draft</p>}
    </>
  );
}

describe("Work navigation from a dirty page", () => {
  it.each(["tab", "more", "back", "more back"] as const)(
    "asks once for %s, retaining the draft on Stay and navigating once on Leave",
    async (kind) => {
      const user = userEvent.setup();
      const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
      render(<Frame />);
      if (kind === "more" || kind === "more back") await user.click(screen.getByTestId("work-frame-more"));
      const target = () =>
        kind === "tab"
          ? within(screen.getByTestId("mode-band-tabs")).getByRole("link", { name: "Inbox" })
          : kind === "more"
            ? within(screen.getByRole("dialog")).getByRole("link", { name: /^Inbox/ })
            : screen.getByTestId(kind === "back" ? "work-frame-back" : "work-more-back");
      await user.click(target());
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(navigation.push).not.toHaveBeenCalled();
      expect(screen.getByTestId("draft")).toHaveTextContent("Synthetic unsaved draft");
      if (kind === "more" || kind === "more back") expect(screen.getByRole("dialog")).toBeInTheDocument();
      confirm.mockReturnValue(true);
      await user.click(target());
      expect(confirm).toHaveBeenCalledTimes(2);
      expect(navigation.push).toHaveBeenCalledTimes(1);
    },
  );

  it("leaves pristine navigation prompt-free and preserves modified/open-tab activation", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { rerender } = render(<Frame dirty={false} />);
    const inbox = () => within(screen.getByTestId("mode-band-tabs")).getByRole("link", { name: "Inbox" });
    fireEvent.click(inbox());
    expect(navigation.push).toHaveBeenCalledTimes(1);
    expect(confirm).not.toHaveBeenCalled();
    rerender(<Frame />);
    fireEvent.click(inbox(), { ctrlKey: true });
    fireEvent.click(inbox(), { metaKey: true });
    expect(navigation.nativeFollow).toHaveBeenCalledTimes(2);
    expect(navigation.push).toHaveBeenCalledTimes(1);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("asks an already-dirty CPD entry only once and leaves modified links prompt-free", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<Frame cpd />);
    await user.type(screen.getByLabelText(/what was it/i), "Synthetic learning draft");
    const inbox = within(screen.getByTestId("mode-band-tabs")).getByRole("link", { name: "Inbox" });
    fireEvent.click(inbox, { ctrlKey: true });
    expect(confirm).not.toHaveBeenCalled();
    await user.click(inbox);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(navigation.push).toHaveBeenCalledTimes(1);
    confirm.mockReturnValue(false);
    await user.click(inbox);
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(navigation.push).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText(/what was it/i)).toHaveValue("Synthetic learning draft");
  });

  it("consults the same guard for a completed swipe and clears its declined visual state", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<Frame />);
    const content = screen.getByTestId("draft");
    const swipe = () => {
      fireEvent.touchStart(content, { touches: [{ clientX: 250, clientY: 200 }] });
      fireEvent.touchMove(content, { touches: [{ clientX: 500, clientY: 202 }] });
      fireEvent.touchEnd(content, { changedTouches: [{ clientX: 500, clientY: 202 }] });
    };
    swipe();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(navigation.push).not.toHaveBeenCalled();
    expect(screen.getByTestId("mode-band-tabs")).not.toHaveAttribute("data-swiping");
    expect(document.querySelector("[data-swipe-target]")).toBeNull();
    confirm.mockReturnValue(true);
    swipe();
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(navigation.push).toHaveBeenCalledTimes(1);
  });
});
