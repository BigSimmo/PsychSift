/** @vitest-environment jsdom */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { SearchCommandProvider } from "@/components/clinical-dashboard/search-command-context";
import {
  SearchResultsEmptyState,
  SearchResultsHeaderBand,
} from "@/components/clinical-dashboard/search-results-header-band";
import {
  ResultFilterSheet,
  ResultFilterTrigger,
  resultFilterFacetGroup,
  resultFilterGroup,
} from "@/components/clinical-dashboard/result-filter-control";

describe("SearchResultsHeaderBand", () => {
  it("presents the query and completed count as one labelled results ribbon", () => {
    const query = "a deliberately long clinical search query";

    render(<SearchResultsHeaderBand modeId="services" query={`  ${query}  `} matchCount={12} />);

    expect(screen.getByRole("region", { name: `Search results for ${query}` })).toHaveAttribute("aria-busy", "false");
    expect(screen.getByRole("heading", { level: 2, name: query })).toHaveAttribute("title", query);
    expect(screen.getByRole("status")).toHaveTextContent("12 services");
  });

  it("says the catalogue may be out of date without disowning the count", () => {
    render(<SearchResultsHeaderBand modeId="differentials" query="delirium" matchCount={7} catalogueDegraded />);

    // The count is still a real count of the list that was searched. What the reader could not
    // otherwise tell is that the list itself came from the in-bundle catalogue.
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("7");
    expect(status).toHaveTextContent("may be out of date");
  });

  it("stays silent about staleness when the published catalogue was read", () => {
    render(<SearchResultsHeaderBand modeId="differentials" query="delirium" matchCount={7} />);

    expect(screen.getByRole("status")).not.toHaveTextContent("may be out of date");
  });

  it("can omit the empty-query fallback so browse is count plus Filter only", () => {
    render(
      <SearchResultsHeaderBand
        modeId="dictionary"
        query=""
        matchCount={96}
        resultNoun="terms"
        hideEmptyQuery
        emptyQueryLabel="Dictionary catalogue"
        mobileControls={<span data-testid="band-filter">Filter</span>}
        mobileControlsPlacement="inline"
      />,
    );

    expect(screen.getByRole("region", { name: "Dictionary catalogue" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "All" })).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("96 terms");
    expect(screen.getByTestId("band-filter")).toBeVisible();
  });

  it("can provide the primary heading on standalone search routes", () => {
    render(<SearchResultsHeaderBand modeId="specifiers" query="seasonal pattern" matchCount={2} headingLevel={1} />);

    expect(screen.getByRole("heading", { level: 1, name: "seasonal pattern" })).toBeVisible();
    expect(screen.queryByRole("heading", { level: 2, name: "seasonal pattern" })).toBeNull();
  });

  it("announces the loading state without exposing a stale result count", () => {
    render(<SearchResultsHeaderBand modeId="differentials" query="acute confusion" matchCount={8} loading />);

    expect(screen.getByRole("region", { name: "Search results for acute confusion" })).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(screen.getByRole("status")).toHaveTextContent("Searching…");
    expect(screen.queryByText("8 differentials")).toBeNull();
  });

  // The clinical invariant. A failed services search that renders "0 matches"
  // asserts "there are no crisis services" when the truth is "we could not
  // check", so no digit may reach the DOM while faulted.
  it("asserts no count when the search failed", () => {
    render(<SearchResultsHeaderBand modeId="services" query="CMHT" matchCount={0} status="error" />);

    const region = screen.getByRole("region", { name: "Search results for CMHT" });
    expect(region).toHaveAttribute("aria-busy", "false");
    expect(screen.getByRole("status")).toHaveTextContent("Couldn’t search");
    // No digit may reach the DOM: that is the whole invariant.
    expect(within(region).queryByText(/\d/)).toBeNull();
  });

  // Suppressing the count in the spine is worthless if a page-supplied filter
  // chip still renders "Forms 0" beside it — the reader still sees a zero
  // asserted about a search that never ran.
  it("drops count-bearing page controls while faulted", () => {
    const { rerender } = render(
      <SearchResultsHeaderBand
        modeId="forms"
        query="transport order"
        matchCount={0}
        status="ready"
        filterControls={<span>Forms 0</span>}
      />,
    );
    expect(screen.getByText("Forms 0")).toBeVisible();

    rerender(
      <SearchResultsHeaderBand
        modeId="forms"
        query="transport order"
        matchCount={0}
        status="error"
        filterControls={<span>Forms 0</span>}
      />,
    );
    const region = screen.getByRole("region", { name: "Search results for transport order" });
    expect(screen.queryByText("Forms 0")).toBeNull();
    // Belt and braces: no digit anywhere in the ribbon, not just in the spine.
    expect(within(region).queryByText(/\d/)).toBeNull();
  });

  it("keeps removable filter state visible while a fault suppresses untrusted counts", () => {
    const onRemove = vi.fn();

    render(
      <SearchResultsHeaderBand
        modeId="documents"
        query="lithium monitoring"
        matchCount={0}
        status="error"
        filterControls={<span>Tables 0</span>}
        appliedFilters={[
          {
            id: "risk-high",
            valueLabel: "High",
            groupLabel: "Risk",
            accessibleLabel: "high-risk sources",
            onRemove,
          },
        ]}
      />,
    );

    const region = screen.getByRole("region", { name: "Search results for lithium monitoring" });
    expect(screen.queryByText("Tables 0")).toBeNull();
    expect(within(region).queryByText(/\d/)).toBeNull();
    expect(screen.getByRole("group", { name: "Applied filters" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Remove high-risk sources filter" })).toBeVisible();
  });

  // Initial loading is the same untrue-zero risk: forms forces matches to [] until
  // the registry is ready, so a count-bearing page control would assert "0" under Searching….
  it("drops count-bearing page controls while loading", () => {
    render(
      <SearchResultsHeaderBand
        modeId="forms"
        query="transport order"
        matchCount={0}
        status="loading"
        filterControls={<span>Forms 0</span>}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Searching…");
    expect(screen.queryByText("Forms 0")).toBeNull();
  });

  it("keeps exactly one status region and one alert while faulted", () => {
    render(<SearchResultsHeaderBand modeId="services" query="CMHT" matchCount={0} status="error" />);

    // Singular role queries throw when they match more than one node, so these
    // also prove the spine's status was not duplicated by the fault panel.
    expect(screen.getByRole("status")).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("Services could not be loaded");
  });

  it("distinguishes an expired session from a broken search", () => {
    render(<SearchResultsHeaderBand modeId="services" query="CMHT" matchCount={0} status="unauthorized" />);

    expect(screen.getByRole("status")).toHaveTextContent("Sign in to search");
    expect(screen.getByRole("alert")).toHaveTextContent("Sign in to continue");
  });

  it("offers retry through the shared busy contract when a recovery handler exists", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();

    render(<SearchResultsHeaderBand modeId="services" query="CMHT" matchCount={0} status="error" onRetry={onRetry} />);

    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("omits the retry affordance when no recovery handler is supplied", () => {
    render(<SearchResultsHeaderBand modeId="services" query="CMHT" matchCount={0} status="error" />);

    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  // Zero is a real answer and must stay distinguishable from a failure.
  it("reports a genuine zero result without raising a fault", () => {
    render(<SearchResultsHeaderBand modeId="services" query="clozapine rechallenge" matchCount={0} />);

    expect(screen.getByRole("status")).toHaveTextContent("0 services");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps the prior count visible while refetching", () => {
    render(<SearchResultsHeaderBand modeId="services" query="CMHT" matchCount={8} status="refetching" />);

    expect(screen.getByRole("region", { name: "Search results for CMHT" })).toHaveAttribute("aria-busy", "true");
    // Text content must match the ready state exactly so the atomic live region
    // does not re-announce an unchanged count.
    expect(screen.getByRole("status")).toHaveTextContent("8 services");
  });

  it("keeps an honest count while labelling a partial-source failure", () => {
    render(<SearchResultsHeaderBand modeId="favourites" query="saved" matchCount={3} status="partial" />);

    const region = screen.getByRole("region", { name: "Search results for saved" });
    expect(region).toHaveAttribute("data-status", "partial");
    expect(screen.getByRole("status")).toHaveTextContent("3 favourites · some sources unavailable");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("offers retry without hiding an honest partial count", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();

    render(
      <SearchResultsHeaderBand modeId="favourites" query="saved" matchCount={3} status="partial" onRetry={onRetry} />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("3 favourites · some sources unavailable");
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  // One plain line since 12 Oct 2026: a healthy search draws no accent and no
  // card, so the count reads like a Work section header. The band keeps a
  // transparent border so forced colours can still draw its edge. Nothing is
  // absolutely positioned, so the corner can never clip a mark.
  it("is one plain line with no accent mark while the search is healthy", () => {
    render(<SearchResultsHeaderBand modeId="services" query="CMHT" matchCount={10} />);

    const region = screen.getByRole("region", { name: "Search results for CMHT" });
    expect(region).toHaveClass("search-band", "border-transparent");
    expect(region.className).not.toMatch(/\bbg-|shadow-/);
    expect(region.querySelector("span.absolute")).toBeNull();
    expect(region.querySelector(".search-band-lead")).toBeNull();
  });

  it("states a browse count alone, keeping its subject as the screen-reader heading", () => {
    render(
      <SearchResultsHeaderBand
        modeId="dsm"
        query=""
        emptyQuerySubject="DSM diagnoses"
        matchCount={146}
        headingLevel={1}
      />,
    );

    expect(screen.getByRole("region", { name: "Browse DSM diagnoses" })).toBeTruthy();
    expect(screen.getByRole("status")).toHaveTextContent("146 DSM diagnoses");
    const heading = screen.getByRole("heading", { level: 1, name: "DSM diagnoses" });
    expect(heading).toHaveClass("sr-only");
    expect(document.querySelector(".search-band-rule")).toBeNull();
  });

  // The tile is gone, and with it the shape channel it carried: alert when the
  // search faulted, a spinner while one ran. The mockup encoded those as colour
  // alone, which makes a failed search identical to a successful one for a
  // reader who cannot separate the hues — so state keeps a shape here, on three
  // independent non-chromatic channels: the mark's stroke count, a glyph that
  // renders only when something is wrong, and the absence of a number.
  it.each([
    ["error" as const, "warning", "Couldn’t search"],
    ["unauthorized" as const, "warning", "Sign in to search"],
    ["partial" as const, "warning", "6 services"],
    ["ready" as const, null, "6 services"],
    ["refetching" as const, null, "6 services"],
  ])("carries %s state as shape, not only hue", (status, tone, text) => {
    render(<SearchResultsHeaderBand modeId="services" query="CMHT" matchCount={6} status={status} />);

    const region = screen.getByRole("region", { name: "Search results for CMHT" });
    const lead = region.querySelector(".search-band-lead");
    if (tone) {
      expect(lead).toHaveAttribute("data-tone", tone);
      expect(lead).toHaveAttribute("aria-hidden");
    } else {
      expect(lead).toBeNull();
    }
    expect(screen.getByRole("status")).toHaveTextContent(text);

    // The clinical invariant, restated where the shape is: a faulted search has
    // no count to report, so no digit may reach the DOM.
    if (status === "error" || status === "unauthorized") {
      expect(screen.getByRole("status").textContent ?? "").not.toMatch(/\d/);
    }
  });

  it("pins Filter and Retry outside the scrolling track so neither can be swiped away", () => {
    render(
      <SearchResultsHeaderBand
        modeId="favourites"
        query="ward round"
        matchCount={3}
        status="partial"
        onRetry={vi.fn()}
        onSortChange={vi.fn()}
        mobileControlsPlacement="inline"
        mobileControls={<button type="button">Filter</button>}
      />,
    );

    const utilities = screen.getByTestId("search-query-ribbon-utilities");
    const track = screen.getByTestId("search-query-ribbon-utility-track");
    const pageFilters = screen.getByTestId("search-query-ribbon-mobile-controls");

    // Only the optional controls scroll. Sort is inside the track; Filter and
    // Retry are siblings after it. Before this, Filter was the track's last
    // child, so it was the first control to fall off the right edge once a mode
    // added anything — the one control carrying filter state.
    expect(track.contains(screen.getByRole("group", { name: "Sort results" }))).toBe(true);
    expect(track.contains(pageFilters)).toBe(false);
    expect(track.contains(screen.getByRole("button", { name: "Retry" }))).toBe(false);
    expect(track.className).toContain("overflow-x-auto");
    // Still the last child of the group: `ui-tools` asserts that placement,
    // because the right edge is where the thumb already is.
    expect(utilities.lastElementChild).toBe(pageFilters);
  });

  it("keeps a full-width phone control on its own row unless the page says otherwise", () => {
    const control = <button type="button">Wide filter</button>;

    const { rerender } = render(
      <SearchResultsHeaderBand modeId="formulation" query="pattern" matchCount={4} mobileControls={control} />,
    );
    // Six modes pass a `w-full` native select here — two of them pass a pair in
    // a two-column grid — and pinning one into a 58px line at 320px makes it
    // unreadable. Unannounced page controls therefore keep today's own row.
    expect(screen.getByTestId("search-query-ribbon-mobile-controls").className).toContain("w-full");
    expect(screen.getByTestId("search-query-ribbon-mobile-controls").className).toContain("basis-full");
    expect(screen.getByTestId("search-query-ribbon-utilities").className).toContain("flex-wrap");

    rerender(
      <SearchResultsHeaderBand
        modeId="documents"
        query="pattern"
        matchCount={4}
        mobileControlsPlacement="inline"
        mobileControls={control}
      />,
    );
    expect(screen.getByTestId("search-query-ribbon-mobile-controls").className).not.toContain("w-full");
  });

  it("keeps inline utilities on one row while the query truncates instead of the controls", () => {
    render(
      <SearchResultsHeaderBand
        modeId="documents"
        query="lithium monitoring in renal impairment"
        matchCount={6}
        onSortChange={vi.fn()}
        mobileControlsPlacement="inline"
        mobileControls={<button type="button">Filter</button>}
      />,
    );

    // The band's stated priority is that the query is what gives way when the
    // line runs out. Shipping the inline group as `shrink` inverted that: the
    // query truncated *and* the utilities were squeezed, so the sort group was
    // clipped by the track's `overflow-x-auto` and its last option faded out
    // under the overflow mask. Pinned as a class because jsdom has no layout —
    // the geometric proof lives in `ui-smoke`, and these two must move together.
    const utilities = screen.getByTestId("search-query-ribbon-utilities").className;
    expect(utilities).toContain("shrink-0");
    // Not a substring accident: `shrink-0` contains `shrink`, so the check that
    // matters is that the bare shrinking utility is absent.
    expect(utilities.split(/\s+/)).not.toContain("shrink");
    expect(utilities).not.toContain("max-[413px]:w-full");
    expect(utilities).not.toContain("max-[413px]:basis-full");
    const rowClass = (screen.getByTestId("search-query-ribbon").firstElementChild as HTMLElement | null)?.className;
    expect(rowClass?.split(/\s+/)).toContain("flex-nowrap");
    expect(rowClass).not.toContain("max-[413px]:flex-wrap");
  });

  it("keeps row geometry while loading even though the page control is gated off", () => {
    const control = <button type="button">Wide filter</button>;
    const rowClass = (root: HTMLElement) => (root.firstElementChild as HTMLElement | null)?.className ?? "";
    const { rerender } = render(
      <SearchResultsHeaderBand
        modeId="services"
        query="CMHT"
        matchCount={0}
        status="loading"
        onSortChange={vi.fn()}
        mobileControls={control}
      />,
    );

    // Placement must key off the raw `mobileControls` prop. Gating on the
    // count-trusted control flipped six modes between nowrap/58px and wrapping
    // geometry the moment results arrived. (`sm:flex-nowrap` is always present;
    // the loading→ready flip was the unprefixed `flex-nowrap` + `min-h-[3.625rem]`.)
    expect(screen.queryByTestId("search-query-ribbon-mobile-controls")).toBeNull();
    const loadingRow = rowClass(screen.getByTestId("search-query-ribbon"));
    expect(loadingRow).toContain("flex-wrap");
    expect(loadingRow.split(/\s+/)).not.toContain("flex-nowrap");
    expect(loadingRow).not.toContain("min-h-[3.625rem]");

    rerender(
      <SearchResultsHeaderBand
        modeId="services"
        query="CMHT"
        matchCount={6}
        status="ready"
        onSortChange={vi.fn()}
        mobileControls={control}
      />,
    );
    const readyRow = rowClass(screen.getByTestId("search-query-ribbon"));
    expect(readyRow).toContain("flex-wrap");
    expect(readyRow.split(/\s+/)).not.toContain("flex-nowrap");
    expect(screen.getByTestId("search-query-ribbon-mobile-controls").className).toContain("basis-full");
  });

  it("lets an explicit status override the deprecated loading shim", () => {
    render(<SearchResultsHeaderBand modeId="services" query="CMHT" matchCount={4} loading status="ready" />);

    expect(screen.getByRole("region", { name: "Search results for CMHT" })).toHaveAttribute("aria-busy", "false");
    expect(screen.getByRole("status")).toHaveTextContent("4 services");
  });

  it("keeps sort, view, and save controls wired inside the utility row", async () => {
    const user = userEvent.setup();
    const onSortChange = vi.fn();
    const onViewChange = vi.fn();
    const onSaveSearch = vi.fn();

    render(
      <SearchCommandProvider value={{ query: "transport order", modeId: "forms" }}>
        <SearchResultsHeaderBand
          modeId="forms"
          query="transport order"
          matchCount={3}
          sortValue="relevance"
          onSortChange={onSortChange}
          view="table"
          onViewChange={onViewChange}
          onSaveSearch={onSaveSearch}
        />
      </SearchCommandProvider>,
    );

    await user.click(screen.getByRole("button", { name: "A–Z" }));
    await user.click(screen.getByRole("button", { name: "List view" }));
    await user.click(screen.getByRole("button", { name: "Save search" }));

    expect(onSortChange).toHaveBeenCalledWith("alpha");
    expect(onViewChange).toHaveBeenCalledWith("list");
    expect(onSaveSearch).toHaveBeenCalledOnce();
  });

  it("offers sort as a segmented control that shows the active order without opening a menu", async () => {
    const user = userEvent.setup();
    const onSortChange = vi.fn();

    render(
      <SearchResultsHeaderBand
        modeId="services"
        query="CMHT"
        matchCount={10}
        sortValue="relevance"
        onSortChange={onSortChange}
      />,
    );

    const sort = screen.getByRole("group", { name: "Sort results" });
    expect(within(sort).getByRole("button", { name: "Relevance" })).toHaveAttribute("aria-pressed", "true");
    expect(within(sort).getByRole("button", { name: "A–Z" })).toHaveAttribute("aria-pressed", "false");

    await user.click(within(sort).getByRole("button", { name: "A–Z" }));
    expect(onSortChange).toHaveBeenCalledWith("alpha");
  });

  it("leads with the count, names what it counted, and keeps the query as its anchor", () => {
    render(<SearchResultsHeaderBand modeId="services" query="CMHT" matchCount={10} />);

    const heading = screen.getByRole("heading", { level: 2, name: "CMHT" });
    const status = screen.getByRole("status");
    // The count is the answer to the search, so it comes first and says what it
    // counted. The query still carries the heading role and its accessible name,
    // so anything resolving it by role is unaffected by the reordering.
    expect(status).toHaveTextContent("10 services");
    expect(status.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The count is neutral text, not a success pill, and the band carries no eyebrow.
    expect(status.className).not.toMatch(/success/);
    expect(heading.parentElement?.textContent).not.toMatch(/Query|Results for/);
  });

  it("uses the singular noun for a single result", () => {
    render(<SearchResultsHeaderBand modeId="services" query="CMHT" matchCount={1} />);
    expect(screen.getByRole("status")).toHaveTextContent("1 service");
  });

  it("keeps an acronym intact in the counted noun", () => {
    render(<SearchResultsHeaderBand modeId="dsm" query="bipolar" matchCount={3} />);
    expect(screen.getByRole("status")).toHaveTextContent("3 DSM diagnoses");
  });

  it("singularises an irregular counted noun", () => {
    render(<SearchResultsHeaderBand modeId="dsm" query="bipolar" matchCount={1} />);
    expect(screen.getByRole("status")).toHaveTextContent("1 DSM diagnosis");
  });

  it("keeps page-specific actions and filters inside the shared ribbon", async () => {
    const user = userEvent.setup();
    const onOpenSources = vi.fn();
    const onFilterTables = vi.fn();

    render(
      <SearchResultsHeaderBand
        modeId="documents"
        query="lithium monitoring"
        matchCount={4}
        utilityControls={
          <button type="button" onClick={onOpenSources}>
            Sources
          </button>
        }
        filterLabel="Filter documents by source type"
        filterControls={
          <button type="button" onClick={onFilterTables}>
            Tables
          </button>
        }
      />,
    );

    const ribbon = screen.getByRole("region", { name: "Search results for lithium monitoring" });
    expect(within(ribbon).getByRole("group", { name: "Filter documents by source type" })).toBeVisible();

    await user.click(within(ribbon).getByRole("button", { name: "Sources" }));
    await user.click(within(ribbon).getByRole("button", { name: "Tables" }));

    expect(onOpenSources).toHaveBeenCalledOnce();
    expect(onFilterTables).toHaveBeenCalledOnce();
  });

  it("pairs sort with a page-specific filter trigger on mobile without changing either action", async () => {
    const user = userEvent.setup();
    const onSortChange = vi.fn();
    const onToggleFilters = vi.fn();

    render(
      <SearchResultsHeaderBand
        modeId="differentials"
        query="acute confusion"
        matchCount={8}
        sortValue="relevance"
        onSortChange={onSortChange}
        filterLabel="Filter differential result type"
        mobileControlsPlacement="inline"
        mobileControls={
          <ResultFilterTrigger
            panelId="differential-filter-panel"
            testId="differential-filter-trigger-phone"
            title="Filter differentials"
            open={false}
            activeCount={0}
            onToggle={onToggleFilters}
          />
        }
        filterControls={
          <button type="button" onClick={vi.fn()}>
            Desktop filters
          </button>
        }
      />,
    );

    // Sort and the page filter are no longer paired: Sort is inboard and the page
    // filter renders last, hard against the ribbon's right edge, because it is the
    // only control carrying state and the one a thumb reaches for.
    const utilities = screen.getByTestId("search-query-ribbon-utilities");
    const pageFilters = screen.getByTestId("search-query-ribbon-mobile-controls");
    expect(utilities.lastElementChild).toBe(pageFilters);
    await user.click(within(utilities).getByRole("button", { name: "A–Z" }));
    await user.click(within(pageFilters).getByTestId("differential-filter-trigger-phone"));

    expect(onSortChange).toHaveBeenCalledWith("alpha");
    expect(onToggleFilters).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("search-query-ribbon-filters")).toHaveClass("hidden", "sm:block");
  });

  // The trigger is what makes the one-line phone bar legal, so its two states
  // are asserted here rather than left to a journey: a resting trigger must not
  // claim a count, and an active one must announce it in text as well as in the
  // badge, because the badge is the only visual difference between them.
  it("reports active filter count on the trigger, in the badge and in text", () => {
    const { rerender } = render(
      <ResultFilterTrigger
        panelId="panel"
        testId="trigger"
        title="Filter differentials"
        open={false}
        activeCount={0}
        onToggle={vi.fn()}
      />,
    );
    expect(screen.getByTestId("trigger")).toHaveAccessibleName(/No filters active/);
    expect(screen.getByTestId("trigger")).not.toHaveAttribute("aria-controls");

    rerender(
      <ResultFilterTrigger
        panelId="panel"
        testId="trigger"
        title="Filter differentials"
        open
        activeCount={2}
        onToggle={vi.fn()}
      />,
    );
    expect(screen.getByTestId("trigger")).toHaveAccessibleName(/2 filters active/);
    expect(screen.getByTestId("trigger")).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("trigger")).toHaveAttribute("aria-controls", "panel");
  });

  it("lets a caller keep the filter wordmark visible at every width", () => {
    render(
      <ResultFilterTrigger
        panelId="panel"
        testId="always-labelled-trigger"
        title="Filter the dictionary catalogue"
        open={false}
        activeCount={0}
        onToggle={vi.fn()}
        labelVisibility="always"
      />,
    );

    expect(screen.getByText("Filter", { selector: "span" })).not.toHaveClass("min-[414px]:max-[429px]:sr-only");
  });
});

describe("ResultFilterSheet facet groups", () => {
  // The whole point of the kind split: a facet must NOT claim mutual exclusion.
  // A radio bank here would tell a reader they cannot hold two domains at once,
  // which is false for every mechanism in the formulation catalogue.
  it("renders many-of-N as a pressed-toggle group and accumulates selections", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();

    render(
      <ResultFilterSheet
        open
        onClose={vi.fn()}
        panelId="formulation-panel"
        testId="formulation-filter-panel"
        title="Filter mechanisms"
        groups={[
          resultFilterFacetGroup({
            id: "domain",
            label: "Domain",
            selected: new Set<"Cognition" | "Affect">(["Cognition"]),
            options: [
              { value: "Cognition", label: "Cognition", hint: "7" },
              { value: "Affect", label: "Affect", hint: "9" },
            ],
            onToggle,
          }),
        ]}
      />,
    );

    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
    const group = screen.getByRole("group", { name: "Domain" });
    expect(within(group).getByRole("button", { name: /Cognition/ })).toHaveAttribute("aria-pressed", "true");
    expect(within(group).getByRole("button", { name: /Affect/ })).toHaveAttribute("aria-pressed", "false");

    await user.click(within(group).getByRole("button", { name: /Affect/ }));
    expect(onToggle).toHaveBeenCalledWith("Affect");
  });

  // The label and hint spans concatenate in the accessible name, and the name
  // computation normalises inter-element whitespace away, so a text-node
  // separator does not fix it. Both group kinds carry counts, so both need the
  // explicit name — and it must match SegmentedControl's, because a mode now
  // hands one option array to the desktop rail and this sheet.
  it("names a counted option 'label (hint)' rather than concatenating to 'All8'", () => {
    render(
      <ResultFilterSheet
        open
        onClose={vi.fn()}
        panelId="differential-panel"
        testId="differential-filter-panel"
        title="Filter differentials"
        groups={[
          resultFilterGroup({
            id: "result-type",
            label: "Show",
            value: "all",
            options: [
              { value: "all", label: "All", hint: "8" },
              { value: "presentation", label: "Presentations", hint: "1" },
            ],
            onChange: vi.fn(),
          }),
          resultFilterFacetGroup({
            id: "domain",
            label: "Domain",
            selected: new Set<string>(),
            options: [{ value: "Crisis", label: "Crisis", hint: "12" }],
            onToggle: vi.fn(),
          }),
        ]}
      />,
    );

    expect(screen.getByRole("radio", { name: "All (8)" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Presentations (1)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Crisis (12)" })).toBeInTheDocument();
    // A hintless option keeps its plain label — every pre-count call site.
    expect(screen.queryByRole("radio", { name: "All8" })).not.toBeInTheDocument();
  });

  // Every toggle must be individually reachable. The lens groups' single tab
  // stop is correct there because arrowing replaces; here it would strand
  // options behind a key binding that must not commit anything.
  it("gives every facet its own tab stop", async () => {
    const user = userEvent.setup();

    render(
      <ResultFilterSheet
        open
        onClose={vi.fn()}
        panelId="formulation-panel"
        testId="formulation-filter-panel"
        title="Filter mechanisms"
        groups={[
          resultFilterFacetGroup({
            id: "domain",
            label: "Domain",
            selected: new Set<"Cognition" | "Affect">(),
            options: [
              { value: "Cognition", label: "Cognition" },
              { value: "Affect", label: "Affect" },
            ],
            onToggle: vi.fn(),
          }),
        ]}
      />,
    );

    const group = screen.getByRole("group", { name: "Domain" });
    const first = within(group).getByRole("button", { name: /Cognition/ });
    const second = within(group).getByRole("button", { name: /Affect/ });
    first.focus();
    await user.tab();
    expect(second).toHaveFocus();
  });

  // A zero reached through the current selection stays reachable and explained.
  // Dropping it would hide the choice that emptied the results.
  it("keeps a zero-yield facet focusable, explained and unselectable", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();

    render(
      <ResultFilterSheet
        open
        onClose={vi.fn()}
        panelId="formulation-panel"
        testId="formulation-filter-panel"
        title="Filter mechanisms"
        groups={[
          resultFilterFacetGroup({
            id: "domain",
            label: "Domain",
            selected: new Set<"Cognition" | "Cultural">(),
            options: [
              { value: "Cognition", label: "Cognition", hint: "7" },
              { value: "Cultural", label: "Cultural", hint: "0", disabled: true },
            ],
            onToggle,
          }),
        ]}
      />,
    );

    const group = screen.getByRole("group", { name: "Domain" });
    const dead = within(group).getByRole("button", { name: /Cultural/ });
    expect(dead).toHaveAttribute("aria-disabled", "true");
    expect(dead).not.toHaveAttribute("disabled");
    expect(dead).toHaveAccessibleDescription("No matches with your current filters.");

    await user.click(dead);
    expect(onToggle).not.toHaveBeenCalled();
  });

  // Mixed sheets are the real shape for formulation: one lens, one facet.
  it("renders lens and facet dimensions side by side with their own semantics", () => {
    render(
      <ResultFilterSheet
        open
        onClose={vi.fn()}
        panelId="mixed-panel"
        testId="mixed-filter-panel"
        title="Filter"
        groups={[
          resultFilterGroup({
            id: "show",
            label: "Show",
            value: "all" as "all" | "diagnoses",
            options: [
              { value: "all", label: "All" },
              { value: "diagnoses", label: "Diagnoses" },
            ],
            onChange: vi.fn(),
          }),
          resultFilterFacetGroup({
            id: "domain",
            label: "Domain",
            selected: new Set<"Cognition">(["Cognition"]),
            options: [{ value: "Cognition", label: "Cognition" }],
            onToggle: vi.fn(),
          }),
        ]}
      />,
    );

    expect(screen.getByRole("radiogroup", { name: "Show" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Domain" })).toBeInTheDocument();
  });

  it("organises one facet into visual sections without changing its OR group", () => {
    render(
      <ResultFilterSheet
        open
        onClose={vi.fn()}
        panelId="formulation-panel"
        testId="formulation-filter-panel"
        title="Filter formulation mechanisms"
        groups={[
          resultFilterFacetGroup({
            id: "domain",
            label: "Domain",
            description: "Select any relevant domains; selections combine with OR.",
            selected: new Set<string>(),
            options: [
              { value: "belief", label: "Belief" },
              { value: "threat", label: "Threat" },
            ],
            optionSections: [
              { id: "meaning", label: "Meaning and belief", optionValues: ["belief"] },
              { id: "emotion", label: "Emotion and threat", optionValues: ["threat"] },
            ],
            onToggle: vi.fn(),
          }),
        ]}
      />,
    );

    expect(screen.getAllByRole("group", { name: "Domain" })).toHaveLength(1);
    expect(screen.getByText("Select any relevant domains; selections combine with OR.")).toBeVisible();
    expect(screen.getByRole("heading", { name: "Meaning and belief" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Emotion and threat" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Belief" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Threat" })).toBeVisible();
  });
});

// docs/filter-contract.md section 5: more than three facet groups adds a
// find-a-filter field and collapses every facet group by default. Formulation
// (one facet group) never crosses this threshold — these tests exist for
// services (five), the first mode to.
describe("ResultFilterSheet dense facet groups", () => {
  function facetGroup(id: string, label: string, options: Array<{ value: string; label: string }>) {
    return resultFilterFacetGroup({ id, label, selected: new Set<string>(), options, onToggle: vi.fn() });
  }

  it("stays exactly as before at three facet groups or fewer — no find field, no collapse", () => {
    render(
      <ResultFilterSheet
        open
        onClose={vi.fn()}
        panelId="three-panel"
        testId="three-filter-panel"
        title="Filter"
        groups={[
          facetGroup("a", "A", [{ value: "1", label: "One" }]),
          facetGroup("b", "B", [{ value: "1", label: "One" }]),
          facetGroup("c", "C", [{ value: "1", label: "One" }]),
        ]}
      />,
    );

    expect(screen.queryByPlaceholderText("Find a filter…")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^A$/ })).not.toBeInTheDocument();
    // Every option is visible and reachable without a disclosure toggle.
    expect(screen.getAllByRole("button", { name: "One" })).toHaveLength(3);
  });

  it("adds a find-a-filter field and collapses groups by default past three", () => {
    render(
      <ResultFilterSheet
        open
        onClose={vi.fn()}
        panelId="dense-panel"
        testId="dense-filter-panel"
        title="Filter services"
        groups={[
          facetGroup("catchments", "Catchment", [{ value: "Peel", label: "Peel" }]),
          facetGroup("age_groups", "Age group", [{ value: "youth", label: "Youth" }]),
          facetGroup("setting_flags", "Setting", [{ value: "community", label: "Community" }]),
          facetGroup("acuity_flags", "Acuity", [{ value: "high", label: "High acuity" }]),
          facetGroup("housing_flags", "Housing", [{ value: "general", label: "General" }]),
        ]}
      />,
    );

    expect(screen.getByPlaceholderText("Find a filter…")).toBeInTheDocument();
    // Collapsed by default: the disclosure button is present, but the option
    // beneath it is not reachable in the accessibility tree.
    const catchmentToggle = screen.getByRole("button", { name: "Catchment" });
    expect(catchmentToggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "Peel" })).not.toBeInTheDocument();
  });

  it("opens a group holding a selection by default, and lets an explicit collapse win afterward", async () => {
    const user = userEvent.setup();

    render(
      <ResultFilterSheet
        open
        onClose={vi.fn()}
        panelId="dense-panel"
        testId="dense-filter-panel"
        title="Filter services"
        groups={[
          resultFilterFacetGroup({
            id: "catchments",
            label: "Catchment",
            selected: new Set(["Peel"]),
            options: [{ value: "Peel", label: "Peel" }],
            onToggle: vi.fn(),
          }),
          facetGroup("age_groups", "Age group", [{ value: "youth", label: "Youth" }]),
          facetGroup("setting_flags", "Setting", [{ value: "community", label: "Community" }]),
          facetGroup("acuity_flags", "Acuity", [{ value: "high", label: "High acuity" }]),
        ]}
      />,
    );

    // Holds a selection — opens itself without any tap.
    expect(screen.getByRole("button", { name: /Catchment/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Peel" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Catchment/ }));
    expect(screen.getByRole("button", { name: /Catchment/ })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "Peel" })).not.toBeInTheDocument();
  });

  it("filters options by the needle, keeps a selected option reachable regardless, and hides an emptied group", async () => {
    const user = userEvent.setup();

    render(
      <ResultFilterSheet
        open
        onClose={vi.fn()}
        panelId="dense-panel"
        testId="dense-filter-panel"
        title="Filter services"
        groups={[
          resultFilterFacetGroup({
            id: "catchments",
            label: "Catchment",
            selected: new Set(["Metro-wide"]),
            options: [
              { value: "Peel", label: "Peel" },
              { value: "Metro-wide", label: "Metro-wide" },
            ],
            onToggle: vi.fn(),
          }),
          facetGroup("age_groups", "Age group", [{ value: "youth", label: "Youth" }]),
          facetGroup("setting_flags", "Setting", [{ value: "community", label: "Community" }]),
          facetGroup("acuity_flags", "Acuity", [{ value: "high", label: "High acuity" }]),
        ]}
      />,
    );

    await user.type(screen.getByPlaceholderText("Find a filter…"), "peel");

    // A live needle owns openness: the matched group is forced open with no
    // disclosure button to fight it.
    expect(screen.queryByRole("button", { name: /^Catchment$/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Peel" })).toBeInTheDocument();
    // The selected option survives the needle even though its label does not
    // match — an active constraint must stay reachable to un-toggle.
    expect(screen.getByRole("button", { name: "Metro-wide" })).toBeInTheDocument();
    // A group with nothing matching disappears rather than showing an empty
    // heading.
    expect(screen.queryByRole("group", { name: "Age group" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Youth" })).not.toBeInTheDocument();
  });

  it("reports no match once the needle matches nothing anywhere", async () => {
    const user = userEvent.setup();

    render(
      <ResultFilterSheet
        open
        onClose={vi.fn()}
        panelId="dense-panel"
        testId="dense-filter-panel"
        title="Filter services"
        groups={[
          facetGroup("catchments", "Catchment", [{ value: "Peel", label: "Peel" }]),
          facetGroup("age_groups", "Age group", [{ value: "youth", label: "Youth" }]),
          facetGroup("setting_flags", "Setting", [{ value: "community", label: "Community" }]),
          facetGroup("acuity_flags", "Acuity", [{ value: "high", label: "High acuity" }]),
        ]}
      />,
    );

    await user.type(screen.getByPlaceholderText("Find a filter…"), "zzz-no-match");
    expect(screen.getByText("No filter matches “zzz-no-match”.")).toBeInTheDocument();
  });

  it("renders the typed scope selector above the groups when a mode supplies one", () => {
    const onChange = vi.fn();
    render(
      <ResultFilterSheet
        open
        onClose={vi.fn()}
        panelId="scope-panel"
        testId="scope-filter-panel"
        title="Filter services"
        groups={[facetGroup("catchments", "Catchment", [{ value: "Peel", label: "Peel" }])]}
        scope={{
          value: "results",
          onChange,
          options: [
            { value: "results", label: "Current results", count: 12 },
            { value: "all", label: "All items", count: 219 },
          ],
        }}
      />,
    );

    expect(screen.getByRole("radio", { name: /current results/i })).toBeChecked();
    expect(screen.getByText("219")).toBeInTheDocument();
  });
});

describe("ResultFilterSheet", () => {
  it("uses typed staged actions, coverage, and one result action", async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    const onBrowseAll = vi.fn();

    render(
      <ResultFilterSheet
        open
        onClose={vi.fn()}
        panelId="document-panel"
        testId="document-filter-panel"
        title="Filter documents"
        groups={[
          resultFilterGroup({
            id: "type",
            label: "Result type",
            value: "all",
            options: [{ value: "all", label: "All" }],
            onChange: vi.fn(),
          }),
        ]}
        applicationMode="staged"
        coverage={{ visibleCount: 7, totalCount: 12 }}
        summary={{ count: 7, noun: "documents" }}
        primaryActionLabel="Update search"
        onApply={onApply}
        secondaryAction={{ label: "Browse all sources", count: 2014, onClick: onBrowseAll }}
      />,
    );

    const coverage = screen.getByRole("progressbar", { name: "Visible results" });
    expect(coverage).toHaveAttribute("aria-valuenow", "7");
    expect(coverage.parentElement).toHaveTextContent("7 of 12 retrieved matches visible");
    expect(screen.getByText(/Changes apply together/)).toHaveClass("sr-only");
    expect(screen.getAllByRole("button", { name: "Update search" })).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "Update search" }));
    await user.click(screen.getByRole("button", { name: /Browse all sources/ }));
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onBrowseAll).toHaveBeenCalledTimes(1);
  });

  it("exposes each dimension as a radio group and reports the selection back typed", async () => {
    const user = userEvent.setup();
    const onFamilyChange = vi.fn();

    render(
      <ResultFilterSheet
        open
        onClose={vi.fn()}
        panelId="specifier-panel"
        testId="specifier-filter-panel"
        title="Filter specifiers"
        groups={[
          resultFilterGroup({
            id: "family",
            label: "Family",
            value: "all" as "all" | "course-onset",
            options: [
              { value: "all", label: "All" },
              { value: "course-onset", label: "Course" },
            ],
            onChange: onFamilyChange,
          }),
        ]}
      />,
    );

    const group = screen.getByRole("radiogroup", { name: "Family" });
    // One-of-N, so exactly one option may be checked — an `aria-pressed` bank
    // would let the DOM claim two mutually exclusive filters at once.
    expect(within(group).getByRole("radio", { name: "All" })).toBeChecked();
    expect(within(group).getByRole("radio", { name: "Course" })).not.toBeChecked();

    await user.click(within(group).getByRole("radio", { name: "Course" }));
    expect(onFamilyChange).toHaveBeenCalledWith("course-onset");
  });

  // `role="radio"` is a promise about the keyboard, not only about the
  // announcement: one tab stop per group, arrows to move and select. Asserted
  // here because the failure mode is silent — the group still reads correctly to
  // a screen reader while answering none of the keys it just advertised.
  it("gives each dimension one tab stop and moves selection with the arrow keys", async () => {
    const user = userEvent.setup();
    const onFamilyChange = vi.fn();
    const onDiagnosisChange = vi.fn();

    render(
      <ResultFilterSheet
        open
        onClose={vi.fn()}
        panelId="specifier-panel"
        testId="specifier-filter-panel"
        title="Filter specifiers"
        groups={[
          resultFilterGroup({
            id: "family",
            label: "Family",
            value: "all",
            options: [
              { value: "all", label: "All" },
              { value: "features", label: "Features" },
              { value: "course", label: "Course" },
            ],
            onChange: onFamilyChange,
          }),
          resultFilterGroup({
            id: "diagnosis",
            label: "Diagnosis",
            value: "",
            options: [
              { value: "", label: "All diagnoses" },
              { value: "bipolar", label: "Bipolar" },
            ],
            onChange: onDiagnosisChange,
          }),
        ]}
      />,
    );

    const family = screen.getByRole("radiogroup", { name: "Family" });
    const diagnosis = screen.getByRole("radiogroup", { name: "Diagnosis" });

    // Exactly one tab stop per group — the checked option — so a reader does not
    // Tab through five options across two dimensions to reach Done.
    expect(within(family).getByRole("radio", { name: "All" })).toHaveAttribute("tabindex", "0");
    expect(within(family).getByRole("radio", { name: "Features" })).toHaveAttribute("tabindex", "-1");
    expect(within(family).getByRole("radio", { name: "Course" })).toHaveAttribute("tabindex", "-1");
    expect(within(diagnosis).getByRole("radio", { name: "All diagnoses" })).toHaveAttribute("tabindex", "0");

    within(family).getByRole("radio", { name: "All" }).focus();
    await user.keyboard("{ArrowRight}");
    expect(onFamilyChange).toHaveBeenLastCalledWith("features");
    await user.keyboard("{End}");
    expect(onFamilyChange).toHaveBeenLastCalledWith("course");
    await user.keyboard("{Home}");
    expect(onFamilyChange).toHaveBeenLastCalledWith("all");
    // Wrapping stays inside the dimension: ArrowLeft from the first option must
    // not walk into the neighbouring group.
    await user.keyboard("{ArrowLeft}");
    expect(onFamilyChange).toHaveBeenLastCalledWith("course");
    expect(onDiagnosisChange).not.toHaveBeenCalled();
  });

  it("makes a checked placeholder the tab stop and arrows off it onto a real option", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <ResultFilterSheet
        open
        onClose={vi.fn()}
        panelId="service-panel"
        testId="service-filter-panel"
        title="Filter services"
        groups={[
          resultFilterGroup({
            id: "quick-filter",
            label: "Quick filters",
            // Services and formulation both sit here: the checked option is a
            // placeholder naming the state you are already in. It is the checked
            // radio, so it is the tab stop — that is how a reader arriving by
            // keyboard learns the current state before moving off it.
            value: "current",
            options: [
              { value: "current", label: "Current search", disabled: true },
              { value: "crisis", label: "Crisis" },
              { value: "free", label: "Free" },
            ],
            onChange,
          }),
        ]}
      />,
    );

    const group = screen.getByRole("radiogroup", { name: "Quick filters" });
    const placeholder = within(group).getByRole("radio", { name: "Current search" });
    expect(placeholder).toHaveAttribute("tabindex", "0");
    expect(within(group).getByRole("radio", { name: "Crisis" })).toHaveAttribute("tabindex", "-1");

    placeholder.focus();
    await user.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenLastCalledWith("crisis");
    expect(within(group).getByRole("radio", { name: "Crisis" })).toHaveFocus();
  });

  // Defensive today — no shipped call site renders an unselected disabled option
  // — but the arrangement is the whole answer to "how does a keyboard reader
  // hear why this one is unavailable", so it is pinned rather than assumed.
  it("puts a dead end on the arrow path without ever selecting it", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <ResultFilterSheet
        open
        onClose={vi.fn()}
        panelId="dead-end-panel"
        testId="dead-end-filter-panel"
        title="Filter"
        groups={[
          resultFilterGroup({
            id: "kind",
            label: "Kind",
            value: "all",
            options: [
              { value: "all", label: "All" },
              { value: "retired", label: "Retired", disabled: true },
              { value: "acute", label: "Acute" },
            ],
            onChange,
          }),
        ]}
      />,
    );

    const group = screen.getByRole("radiogroup", { name: "Kind" });
    const deadEnd = within(group).getByRole("radio", { name: /Retired/ });
    expect(deadEnd).toHaveAttribute("aria-disabled", "true");
    // Not a second tab stop: the group keeps exactly one.
    expect(deadEnd).toHaveAttribute("tabindex", "-1");
    expect(within(group).getByRole("radio", { name: "All" })).toHaveAttribute("tabindex", "0");

    within(group).getByRole("radio", { name: "All" }).focus();
    await user.keyboard("{ArrowRight}");
    // Focus lands on it — that is how the "Not selectable from here" note is
    // announced — but nothing was selected, and "All" was not committed either.
    expect(deadEnd).toHaveFocus();
    expect(onChange).not.toHaveBeenCalled();

    await user.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenCalledExactlyOnceWith("acute");
  });

  it("keeps the group tabbable when the selected value matches no option at all", () => {
    render(
      <ResultFilterSheet
        open
        onClose={vi.fn()}
        panelId="stale-panel"
        testId="stale-filter-panel"
        title="Filter"
        groups={[
          resultFilterGroup({
            // A value the option list no longer offers — a stale URL param, or a
            // catalogue that dropped a category between renders. Nothing is
            // checked, so without a fallback the group would have no tab stop and
            // drop out of the tab order entirely.
            id: "category",
            label: "Category",
            value: "retired",
            options: [
              { value: "all", label: "All" },
              { value: "acute", label: "Acute" },
            ],
            onChange: vi.fn(),
          }),
        ]}
      />,
    );

    const group = screen.getByRole("radiogroup", { name: "Category" });
    expect(within(group).getByRole("radio", { name: "All" })).toHaveAttribute("tabindex", "0");
    expect(within(group).getByRole("radio", { name: "Acute" })).toHaveAttribute("tabindex", "-1");
    expect(within(group).queryAllByRole("radio", { checked: true })).toHaveLength(0);
  });

  it("keeps an unselectable placeholder focusable and explained rather than removing it", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <ResultFilterSheet
        open
        onClose={vi.fn()}
        panelId="service-panel"
        testId="service-filter-panel"
        title="Filter services"
        groups={[
          resultFilterGroup({
            id: "quick-filter",
            label: "Quick filters",
            value: "current",
            options: [
              { value: "current", label: "Current search", disabled: true },
              { value: "crisis", label: "Crisis" },
            ],
            onChange,
          }),
        ]}
      />,
    );

    // Selected-and-disabled is the state the reader is already in, so it renders
    // as the checked option rather than as a dead end.
    const placeholder = screen.getByRole("radio", { name: "Current search" });
    expect(placeholder).toBeChecked();
    expect(placeholder).not.toHaveAttribute("aria-disabled");

    await user.click(screen.getByRole("radio", { name: "Crisis" }));
    expect(onChange).toHaveBeenCalledWith("crisis");
  });

  it("offers Clear only when something is clearable", () => {
    const groups = [
      resultFilterGroup({
        id: "category",
        label: "Category",
        value: "all",
        options: [{ value: "all", label: "All" }],
        onChange: vi.fn(),
      }),
    ];
    const { rerender } = render(
      <ResultFilterSheet
        open
        onClose={vi.fn()}
        panelId="p"
        testId="factsheet-filter-panel"
        title="Filter factsheets"
        groups={groups}
      />,
    );
    expect(screen.queryByTestId("factsheet-filter-panel-clear")).toBeNull();

    rerender(
      <ResultFilterSheet
        open
        onClose={vi.fn()}
        panelId="p"
        testId="factsheet-filter-panel"
        title="Filter factsheets"
        groups={groups}
        onClearAll={vi.fn()}
      />,
    );
    expect(screen.getByTestId("factsheet-filter-panel-clear")).toBeVisible();
  });
});

describe("SearchResultsEmptyState", () => {
  const filters = [
    { id: "medication", valueLabel: "Lithium", onRemove: vi.fn() },
    { id: "action", valueLabel: "Discharge", onRemove: vi.fn() },
  ];

  it("leads with relaxing a filter when the set is empty because of them", async () => {
    const user = userEvent.setup();
    const onClearFilters = vi.fn();
    const onRemove = vi.fn();
    const onBrowseAll = vi.fn();

    render(
      <SearchResultsEmptyState
        modeId="documents"
        query="lithium monitoring"
        appliedFilters={[filters[0], { ...filters[1], onRemove }]}
        onClearFilters={onClearFilters}
        onBrowseAll={onBrowseAll}
        browseAllLabel="Browse all 2,014 sources"
      />,
    );

    // The heading counts the filters rather than quoting the query: the query is
    // not what emptied the set, and saying so sends the reader to rewrite the one
    // thing that was working.
    expect(screen.getByText("No documents match all 2 filters")).toBeVisible();
    // The failure is attributed. "The search itself ran fine" is the sentence
    // that stops a filtered-to-zero result reading as a broken search.
    expect(screen.getByText(/The search itself ran fine/)).toBeVisible();

    // Naming the filter in the label is what makes it a one-tap undo instead of
    // a second thing to go and find.
    await user.click(screen.getByRole("button", { name: "Remove “Discharge”" }));
    expect(onRemove).toHaveBeenCalledTimes(1);

    // Separate control, separate label — the single button that said "Clear
    // filters" and reset the query too is exactly what this replaces.
    await user.click(screen.getByRole("button", { name: "Clear all filters" }));
    expect(onClearFilters).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Browse all 2,014 sources" }));
    expect(onBrowseAll).toHaveBeenCalledTimes(1);
  });

  it("keeps the example and cross-mode routes, demoted below a rule", () => {
    render(
      <SearchResultsEmptyState
        modeId="documents"
        query="lithium monitoring"
        appliedFilters={filters}
        onClearFilters={vi.fn()}
        onTryExample={vi.fn()}
      />,
    );

    const example = screen.getByRole("button", { name: /^Try:/ });
    expect(example).toBeVisible();
    // Demotion is structural, not just ordering: an example query is a different
    // search, and the reader has not finished this one.
    expect(example.parentElement).toHaveClass("border-t");
  });

  it("is unchanged when nothing is applied", () => {
    render(<SearchResultsEmptyState modeId="documents" query="lithium monitoring" onTryExample={vi.fn()} />);

    expect(screen.getByText("No matches for “lithium monitoring”")).toBeVisible();
    // No `onCrossMode` here, so no mode buttons render and the copy must not
    // name one. The body describes the controls actually on the panel.
    expect(screen.getByText("Try one of the examples below.")).toBeVisible();
    expect(screen.queryByTestId("search-results-empty-remove-filter")).toBeNull();
    expect(screen.queryByTestId("search-results-empty-clear-filters")).toBeNull();
    expect(screen.getByRole("button", { name: /^Try:/ }).parentElement).not.toHaveClass("border-t");
  });

  it("offers no Clear all for a single filter, because Remove already is one", () => {
    render(
      <SearchResultsEmptyState
        modeId="documents"
        query="lithium monitoring"
        appliedFilters={[filters[0]]}
        onClearFilters={vi.fn()}
      />,
    );

    expect(screen.getByText("No documents match the selected filter")).toBeVisible();
    expect(screen.getByTestId("search-results-empty-remove-filter")).toBeVisible();
    expect(screen.queryByTestId("search-results-empty-clear-filters")).toBeNull();
  });

  it("announces query-only emptiness and offers a clear-search recovery", async () => {
    const user = userEvent.setup();
    const onClearSearch = vi.fn();

    render(
      <SearchResultsEmptyState modeId="therapy-compass" query="unmatched therapy" onClearSearch={onClearSearch} />,
    );

    // Queried by text, not by role. The panel keeps a bare `aria-live` region
    // (populated after mount) rather than `role="status"`: the band already
    // owns that role on every search route, and a second one made singular
    // `getByRole("status")` queries across the suite ambiguous.
    expect(screen.getByText("No matches for “unmatched therapy”")).toBeVisible();
    // No `onTryExample` or `onCrossMode` handler is passed here — matching the
    // real Therapy call site (therapy-compass/screens/search-screen.tsx) — so
    // this panel has neither an example nor a cross-mode route to offer, even
    // though the mode now carries a full `searchCommandSurfaceByMode` entry. The
    // body must not tell the reader to "try an example, or jump to another mode"
    // when the panel renders no control for either.
    expect(screen.getByText("Check the spelling, or try a broader term.")).toBeVisible();
    expect(screen.queryByRole("button", { name: /^Try:/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Search in / })).toBeNull();

    // The escape hatch sits on the tap floor. It shipped at 36px, which was
    // survivable while these were secondary actions and is not now that they are
    // the only offered way out of a zero result — on this mode `Clear search` is
    // the whole recovery. jsdom cannot measure it, so pin the utility.
    expect(screen.getByTestId("search-results-empty-clear-search")).toHaveClass("min-h-tap");

    await user.click(screen.getByTestId("search-results-empty-clear-search"));
    expect(onClearSearch).toHaveBeenCalledTimes(1);
  });
});
