/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MasterSearchHeader } from "@/components/clinical-dashboard/master-search-header";
import { factsheetsTopicsHref } from "@/lib/app-modes";
import {
  modeHomeComposerReserveAttr,
  modeHomeComposerReservePendingValue,
  modeHomeDesktopComposerSlotId,
} from "@/lib/mode-home-composer";
import { installMatchMediaStub } from "./setup/jsdom.setup";

const router = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  prefetch: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
  // The header reads the pathname to mark the current page in the mode sheet's
  // in-mode section level. `/` is the shared home, which owns no section list —
  // the level these tests exercise is the mode list.
  usePathname: () => "/",
}));

vi.mock("@/lib/supabase/client", () => ({
  useAuthSession: () => ({
    status: "signed_out",
    session: null,
    isConfigured: true,
    error: null,
    signInWithEmail: vi.fn(),
    signOut: vi.fn(),
  }),
}));

vi.mock("@/components/clinical-dashboard/use-saved-registry-favourites", () => ({
  useSavedRegistryFavourites: () => ({
    items: [],
    status: "ready",
    registryStatus: "ready",
    refetch: () => undefined,
  }),
}));

vi.mock("@/components/clinical-dashboard/search-command-context", () => ({
  useSearchCommand: () => null,
}));

vi.mock("@/components/clinical-dashboard/universal-search-also-matches", () => ({
  UniversalSearchAlsoMatches: () => null,
}));

function defaultHeaderProps() {
  return {
    demoMode: false,
    documents: [],
    query: "",
    searchMode: "answer" as const,
    loading: false,
    selectedDocumentIds: [] as string[],
    queryMode: "auto" as const,
    scopeFilters: {},
    realDataReady: true,
    canAccessFavourites: false,
    onQueryChange: vi.fn(),
    onSearchModeChange: vi.fn(),
    onAsk: vi.fn(),
    onClearQuery: vi.fn(),
    onClearScope: vi.fn(),
    onQueryModeChange: vi.fn(),
    onScopeFiltersChange: vi.fn(),
    onToggleScope: vi.fn(),
    queryModeOptions: [{ value: "auto" as const, label: "Auto" }],
  };
}

describe("MasterSearchHeader DOM", () => {
  beforeEach(() => {
    installMatchMediaStub(false);
    vi.clearAllMocks();
  });

  it("disables the query input when private answer search is not ready", () => {
    render(<MasterSearchHeader {...defaultHeaderProps()} realDataReady={false} />);
    const input = screen.getByTestId("global-search-input");
    expect(input).toBeDisabled();
    expect(input).toHaveAttribute("title", "Search setup not ready");
  });

  it("disables the query input for documents search when live data is not ready", () => {
    render(<MasterSearchHeader {...defaultHeaderProps()} searchMode="documents" realDataReady={false} />);
    const input = screen.getByTestId("global-search-input");
    expect(input).toBeDisabled();
    expect(input).toHaveAttribute("title", "Search setup not ready");
  });

  it("keeps the query input enabled for local forms search when live data is not ready", () => {
    render(<MasterSearchHeader {...defaultHeaderProps()} searchMode="forms" realDataReady={false} />);
    expect(screen.getByTestId("global-search-input")).toBeEnabled();
  });

  it("keeps ordinary Search as the only composer action for former Clinical Ask modes", () => {
    const props = defaultHeaderProps();
    props.query = "synthetic question";
    const modes = [
      "services",
      "forms",
      "differentials",
      "formulation",
      "dsm",
      "specifiers",
      "therapy-compass",
    ] as const;
    const { rerender } = render(<MasterSearchHeader {...props} searchMode={modes[0]} />);

    for (const searchMode of modes) {
      rerender(<MasterSearchHeader {...props} searchMode={searchMode} />);
      expect(screen.queryByRole("button", { name: /^Ask / })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Dictate question|Stop recording/ })).not.toBeInTheDocument();
      expect(document.querySelector("[data-clinical-ask-actions]")).toBeNull();
    }

    fireEvent.submit(screen.getByRole("search"));
    expect(props.onAsk).toHaveBeenCalledOnce();
  });

  it("ignores form and keyboard submission while the composer is loading", () => {
    const props = { ...defaultHeaderProps(), query: "bipolar", loading: true };
    render(<MasterSearchHeader {...props} searchMode="dsm" />);

    fireEvent.submit(screen.getByRole("search"));
    fireEvent.keyDown(screen.getByTestId("global-search-input"), { key: "Enter", ctrlKey: true });

    expect(props.onAsk).not.toHaveBeenCalled();
  });

  it("shows provider-free Smart search while preserving the ordinary search action", () => {
    const props = {
      ...defaultHeaderProps(),
      query: "Which service is best for ongoing support after discharge?",
      searchMode: "services" as const,
    };
    const { rerender } = render(<MasterSearchHeader {...props} />);

    expect(screen.getByTestId("smart-search-intent-cue")).toHaveTextContent("Smart search");
    expect(screen.getByRole("button", { name: "Search services" })).toBeInTheDocument();
    expect(screen.getByText("Smart search selected for Services.")).toBeInTheDocument();
    expect(screen.queryByText(/Smart answer/i)).not.toBeInTheDocument();

    rerender(<MasterSearchHeader {...props} query="13YARN" />);
    expect(screen.queryByTestId("smart-search-intent-cue")).not.toBeInTheDocument();
    // A literal query outside the mode-home hero shows no Smart wording at all.
    expect(screen.queryByTestId("search-example-ticker")).not.toBeInTheDocument();
    expect(screen.queryByText(/Smart search/)).not.toBeInTheDocument();
  });

  it("renders the compact pill alone outside the mode-home hero (no ticker, prompts, or privacy line)", () => {
    installMatchMediaStub(false);
    for (const searchMode of ["forms", "documents", "services", "dsm"] as const) {
      const { unmount } = render(<MasterSearchHeader {...defaultHeaderProps()} searchMode={searchMode} />);
      expect(screen.getByTestId("global-search-input")).toBeInTheDocument();
      expect(screen.queryByTestId("smart-search-prompt-row")).not.toBeInTheDocument();
      expect(screen.queryByTestId("search-example-ticker")).not.toBeInTheDocument();
      expect(screen.queryByRole("group", { name: "Search privacy notice" })).toBeNull();
      unmount();
    }
    // The answer dock is its own composer type and keeps the APP-5 line.
    render(<MasterSearchHeader {...defaultHeaderProps()} searchMode="answer" />);
    expect(screen.getByRole("group", { name: "Search privacy notice" })).toBeInTheDocument();
  });

  it("offers a new chat only in a mode that has somewhere for the answer to land", () => {
    // The header's trailing region held the new-chat button for every mode,
    // stood down by a `:has()` rule only while a page occupied the trailing
    // slot. On Call's section pages then moved their page menu into their own
    // in-page header, the slot emptied, and a mode that has never had a chat
    // grew a "Start a new chat" button in its top-right corner.
    //
    // Gated on the mode declaring no results surface, so the check is the same
    // fact that removes the results page — not a mode id this file has to
    // remember.
    const props = defaultHeaderProps();
    render(<MasterSearchHeader {...props} searchMode="answer" />);
    expect(screen.getByRole("button", { name: "Start a new chat" })).toBeInTheDocument();

    cleanup();
    render(<MasterSearchHeader {...props} searchMode="on-call" />);
    expect(screen.queryByRole("button", { name: "Start a new chat" })).not.toBeInTheDocument();
  });

  it("routes Factsheets Browse all sheets to the Topics page", async () => {
    const user = userEvent.setup();
    render(<MasterSearchHeader {...defaultHeaderProps()} searchMode="factsheets" />);

    await user.click(screen.getByRole("button", { name: "Open factsheets options" }));
    await user.click(screen.getByRole("button", { name: "Browse all sheets" }));

    expect(router.push).toHaveBeenCalledWith(factsheetsTopicsHref);
  });

  describe("#WJDQ0X - privacy notice landmark / role=group wrapping", () => {
    it("wraps the composer privacy notice in role='group' with aria-label='Search privacy notice'", () => {
      render(<MasterSearchHeader {...defaultHeaderProps()} />);

      const privacyGroup = screen.getByRole("group", { name: "Search privacy notice" });
      expect(privacyGroup).toBeInTheDocument();

      const warningNotice = screen.getByTestId("answer-composer-privacy-warning");
      expect(warningNotice).toBeInTheDocument();
      expect(privacyGroup).toContainElement(warningNotice);
      expect(within(privacyGroup).getByText("Do not enter patient-identifiable information.")).toBeInTheDocument();
      expect(within(privacyGroup).getByRole("link", { name: "Privacy and data processing" })).toBeInTheDocument();
    });
  });

  describe("#D8JBCV - mobile /tools home privacy notice in footer placement", () => {
    it("keeps the desktop result composer free of the notice regardless of mobileHomeComposerPlacement", () => {
      installMatchMediaStub(false);

      // Without a home slot the desktop composer is a result composer, which
      // renders the compact pill alone; the phone-only placement flag must not
      // reintroduce the notice there.
      const { rerender } = render(
        <MasterSearchHeader {...defaultHeaderProps()} searchMode="tools" mobileHomeComposerPlacement="hero" />,
      );
      expect(screen.queryByRole("group", { name: "Search privacy notice" })).toBeNull();

      rerender(
        <MasterSearchHeader {...defaultHeaderProps()} searchMode="tools" mobileHomeComposerPlacement="footer" />,
      );
      expect(screen.queryByRole("group", { name: "Search privacy notice" })).toBeNull();
    });

    it("omits the privacy notice on a footer-configured /tools result dock with no home slot", () => {
      // Emulate mobile phone screen width (< 640px). A tools result route carries
      // mobileHomeComposerPlacement="footer" but no desktop home composer slot, so
      // the result dock must omit the notice to keep maximum content space.
      installMatchMediaStub(true);

      render(
        <MasterSearchHeader
          {...defaultHeaderProps()}
          searchMode="tools"
          mobileSearchPlacement="bottom"
          mobileHomeComposerPlacement="footer"
        />,
      );

      expect(screen.queryByRole("group", { name: "Search privacy notice" })).toBeNull();
      expect(screen.queryByTestId("answer-composer-privacy-warning")).toBeNull();
    });

    it("suppresses the privacy notice on mobile bottom dock when mobileHomeComposerPlacement is 'hero' and not home hero slot", () => {
      // Emulate mobile phone screen width (< 640px)
      installMatchMediaStub(true);

      render(
        <MasterSearchHeader
          {...defaultHeaderProps()}
          searchMode="prescribing"
          mobileSearchPlacement="bottom"
          mobileHomeComposerPlacement="hero"
        />,
      );

      expect(screen.queryByRole("group", { name: "Search privacy notice" })).toBeNull();
      expect(screen.queryByTestId("answer-composer-privacy-warning")).toBeNull();
    });
  });
  describe("mode-home composer reserve marker", () => {
    // The slot is appended outside React, so testing-library's cleanup does not
    // remove it. Left behind, a stale slot keeps the id and getElementById in the
    // next test resolves to it instead of that test's own slot.
    afterEach(() => {
      document.getElementById(modeHomeDesktopComposerSlotId)?.remove();
    });

    function mountSlot() {
      const slot = document.createElement("div");
      slot.id = modeHomeDesktopComposerSlotId;
      // Exactly what the page SSRs: the reserve marker, and no ready flag —
      // the owning page segment has not hydrated yet.
      slot.setAttribute(modeHomeComposerReserveAttr, modeHomeComposerReservePendingValue);
      document.body.appendChild(slot);
      return slot;
    }

    function spyOnReserveRemoval() {
      const removals: string[] = [];
      const original = Element.prototype.removeAttribute;
      vi.spyOn(Element.prototype, "removeAttribute").mockImplementation(function (this: Element, name: string) {
        if (name === modeHomeComposerReserveAttr && this.id === modeHomeDesktopComposerSlotId) {
          removals.push(this.getAttribute(modeHomeComposerReserveAttr) ?? "(absent)");
        }
        return original.call(this, name);
      });
      return removals;
    }

    it("does not strip the SSR reserve marker while the owning segment is still unhydrated", async () => {
      // Desktop hero width, so the header wants to adopt the slot and keeps the
      // pending reserve while it retries adoption.
      installMatchMediaStub(true);
      mountSlot();
      const removals = spyOnReserveRemoval();

      const props = {
        ...defaultHeaderProps(),
        desktopHomeComposerSlotId: modeHomeDesktopComposerSlotId,
      };
      const { rerender } = render(<MasterSearchHeader {...props} heroComposerBreakpoint="all" />);

      // A dependency change re-runs the composer effect: React fires the cleanup
      // and then the effect body. The cleanup used to removeAttribute() on a slot
      // whose React segment had not hydrated, leaving a window in which the DOM
      // lacked an attribute the page's own client render still produces. A page
      // segment hydrating inside that window reports a hydration mismatch
      // (client "pending" vs server null) on data-composer-reserve.
      rerender(<MasterSearchHeader {...props} heroComposerBreakpoint="sm-up" />);
      await Promise.resolve();

      expect(removals).toEqual([]);
    });

    it("still clears the reserve marker when the composer is suppressed (invariant 15)", async () => {
      installMatchMediaStub(true);
      const slot = mountSlot();

      const props = {
        ...defaultHeaderProps(),
        desktopHomeComposerSlotId: modeHomeDesktopComposerSlotId,
        searchComposerVisible: false,
      };
      render(<MasterSearchHeader {...props} />);
      // The suppression path clears in a queued microtask.
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(slot.hasAttribute(modeHomeComposerReserveAttr)).toBe(false);
    });
  });

  describe("client-side PHI detection warning", () => {
    it("renders role=alert PHI warning when query contains identifier shapes", () => {
      render(
        <MasterSearchHeader {...defaultHeaderProps()} query="Patient Jane Citizen MRN: 12345678 DOB: 01/01/1980" />,
      );

      const alert = screen.getByRole("alert");
      expect(alert).toHaveTextContent("Remove identifiable patient details before searching.");
      expect(alert).toHaveAttribute("id", "composer-phi-warning");
    });

    it("does not render PHI warning for generic clinical queries", () => {
      render(<MasterSearchHeader {...defaultHeaderProps()} query="clozapine neutropenia monitoring guidelines" />);

      expect(screen.queryByTestId("composer-phi-warning")).toBeNull();
    });
  });
});
