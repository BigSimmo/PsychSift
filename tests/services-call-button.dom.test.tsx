import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { extractFirstDialablePhone, serviceCallTarget } from "@/lib/service-call";
import type { ServiceRecord } from "@/lib/service-ranker";

const withPhone: ServiceRecord = {
  slug: "call-test-line",
  title: "Call Test Line",
  bestUse: "Synthetic record for the call-button test.",
  primaryContact: { label: "Phone", value: "1800 199 008 after hours", kind: "phone" },
};

const withoutPhone: ServiceRecord = {
  slug: "no-phone-service",
  title: "No Phone Service",
  bestUse: "Synthetic record with only a website.",
  primaryContact: { label: "Website", value: "https://example.org", kind: "web" },
  contacts: [{ label: "Phone", value: "Not publicly stated", kind: "phone" }],
};

const registryRecords = [withPhone, withoutPhone];
const navigation = vi.hoisted(() => ({ push: vi.fn() }));
const registryState = vi.hoisted(() => ({ status: "ready" }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: navigation.push, replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children: ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/use-registry-records", () => ({
  useRegistryRecords: () => ({
    status: registryState.status,
    records: registryState.status === "ready" ? registryRecords : [],
    total: registryRecords.length,
    demoMode: true,
    governance: {},
    refetch: vi.fn(),
  }),
}));

vi.mock("@/components/use-result-sort", () => ({
  useResultSort: () => ["relevance", vi.fn()] as const,
}));

vi.mock("@/components/clinical-dashboard/universal-search-also-matches", () => ({
  UniversalSearchAlsoMatches: () => null,
}));

vi.mock("@/components/account-data-provider", () => ({
  useAccountData: () => ({
    favourites: { service: [], form: [], differential: [] },
    ready: true,
    loadError: null,
    error: null,
    isAuthenticated: true,
    isSaved: () => false,
    setFavourite: vi.fn(async () => true),
    clearFavourites: vi.fn(async () => true),
    reload: vi.fn(),
  }),
}));

import { ServicesNavigatorPage } from "@/components/services/services-navigator-page";

beforeEach(() => {
  setSearch("");
  navigation.push.mockClear();
  registryState.status = "ready";
});

function setSearch(search: string) {
  window.history.replaceState(null, "", `/services/search${search ? `?${search}` : ""}`);
}

function shortlistService(service: ServiceRecord) {
  const card = screen.getByTestId(`service-search-result-${service.slug}`);
  fireEvent.click(within(card).getByRole("button", { name: `More actions for ${service.title}` }));
  fireEvent.click(within(card).getByRole("button", { name: `Add ${service.title} to shortlist` }));
}

describe("serviceCallTarget", () => {
  it("dials the record's own number and shows it as the record writes it", () => {
    expect(serviceCallTarget(withPhone)).toEqual({ href: "tel:1800199008", display: "1800 199 008" });
    expect(
      serviceCallTarget({
        slug: "metro",
        title: "Metro",
        primaryContact: { label: "Phone", value: "(08) 9442 5000", kind: "phone" },
      }),
    ).toEqual({ href: "tel:0894425000", display: "(08) 9442 5000" });
    // An unpaired bracket from the catalogue is dropped from the visible text only.
    expect(
      serviceCallTarget({
        slug: "aod",
        title: "AOD",
        primaryContact: { label: "Phone", value: "08) 9442 5000", kind: "phone" },
      }),
    ).toEqual({ href: "tel:0894425000", display: "08 9442 5000" });
  });

  it("dials only the main number when the record adds an unbracketed extension", () => {
    const call = (value: string) =>
      serviceCallTarget({ slug: "ext", title: "Ext", primaryContact: { label: "Phone", value, kind: "phone" } });
    for (const value of [
      "(08) 9442 5000 ext 1",
      "(08) 9442 5000 Ext. 12",
      "(08) 9442 5000 extn 3",
      "(08) 9442 5000 extension 4",
      "(08) 9442 5000 x1",
      "(08) 9442 5000 X 22",
      "(08) 9442 5000 #2",
    ]) {
      expect(call(value)).toEqual({ href: "tel:0894425000", display: "(08) 9442 5000" });
    }
    // A word that merely contains an x is not an extension marker.
    expect(extractFirstDialablePhone("Fax (08) 9442 5001")).toBe("0894425001");
  });

  it("returns nothing when the record has no dialable phone", () => {
    expect(serviceCallTarget(withoutPhone)).toBeNull();
    expect(serviceCallTarget({ slug: "bare", title: "Bare" })).toBeNull();
  });

  it("refuses two numbers run together rather than dialling a wrong one", () => {
    expect(
      serviceCallTarget({
        slug: "joined",
        title: "Joined",
        primaryContact: {
          label: "Phone",
          value: "Central Intake 1800 273 889. Crisis Care 1800 199 008",
          kind: "phone",
        },
      }),
    ).toBeNull();
  });
});

describe("services result card call button", () => {
  it("puts a compact tel: phone button, named for the service, on a card whose record has a phone", () => {
    // Clinical audit, 13 Oct 2026, item 8: the full-width blue Call bar became a
    // 48px phone button on the row. Same tel: action; the number stays visible and
    // in the accessible name, since touch and screen-reader users never get a tooltip.
    render(<ServicesNavigatorPage />);
    const card = screen.getByTestId(`service-search-result-${withPhone.slug}`);
    const call = within(card).getByRole("link", { name: `Call 1800 199 008, ${withPhone.title}` });
    expect(call).toHaveAttribute("href", "tel:1800199008");
    expect(call).toHaveTextContent("1800 199 008");
    expect(call.className).toContain("min-h-12");
    expect(call.className).toContain("min-w-12");
  });

  it("shows no call link when the record has no dialable phone", () => {
    render(<ServicesNavigatorPage />);
    const card = screen.getByTestId(`service-search-result-${withoutPhone.slug}`);
    expect(within(card).queryByRole("link", { name: /^Call / })).not.toBeInTheDocument();
    expect(card.querySelector('a[href^="tel:"]')).toBeNull();
  });

  it("keeps Review referral and Add to shortlist reachable behind More", () => {
    render(<ServicesNavigatorPage />);
    const card = screen.getByTestId(`service-search-result-${withPhone.slug}`);
    expect(within(card).queryByRole("button", { name: `Add ${withPhone.title} to shortlist` })).toBeNull();

    const more = within(card).getByRole("button", { name: `More actions for ${withPhone.title}` });
    expect(more).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(more);
    expect(more).toHaveAttribute("aria-expanded", "true");

    expect(within(card).getByRole("link", { name: `Review referral for ${withPhone.title}` })).toHaveAttribute(
      "href",
      `/services/${withPhone.slug}`,
    );
    fireEvent.click(within(card).getByRole("button", { name: `Add ${withPhone.title} to shortlist` }));
    expect(within(card).getByRole("button", { name: `Remove ${withPhone.title} from shortlist` })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});

describe("services clinical workflow navigation", () => {
  it("publishes shortlist state synchronously and restores it through native Back and Forward after an explicit clear", async () => {
    setSearch("q=Call&scope=all&focus=1");
    const { rerender } = render(<ServicesNavigatorPage />);
    const card = screen.getByTestId(`service-search-result-${withPhone.slug}`);
    fireEvent.click(within(card).getByRole("button", { name: `More actions for ${withPhone.title}` }));
    // A separate control can update the address after this handler's render.
    // The shortlist must compose with that live URL, not overwrite it.
    window.history.replaceState(null, "", "/services/search?q=Call&scope=all&focus=1&sort=alpha#results");
    const previousLength = window.history.length;
    fireEvent.click(within(card).getByRole("button", { name: `Add ${withPhone.title} to shortlist` }));

    // No wait: a composer submit in this same interaction turn must see it.
    const selectedParams = new URLSearchParams(window.location.search);
    expect(selectedParams.get("shortlist")).toBe(withPhone.slug);
    expect(selectedParams.get("q")).toBe("Call");
    expect(selectedParams.get("scope")).toBe("all");
    expect(selectedParams.get("focus")).toBe("1");
    expect(selectedParams.get("sort")).toBe("alpha");
    expect(window.location.pathname).toBe("/services/search");
    expect(window.location.hash).toBe("#results");
    expect(window.history.length).toBe(previousLength + 1);
    expect(navigation.push).not.toHaveBeenCalled();

    fireEvent.click(within(screen.getByTestId("services-shortlist-bar")).getByRole("button", { name: "Clear" }));
    expect(new URLSearchParams(window.location.search).has("shortlist")).toBe(false);
    expect(new URLSearchParams(window.location.search).has("workflow")).toBe(false);
    expect(new URLSearchParams(window.location.search).get("sort")).toBe("alpha");
    expect(window.location.hash).toBe("#results");
    expect(screen.queryByTestId("services-shortlist-bar")).toBeNull();

    await act(async () => {
      await new Promise<void>((resolve) => {
        window.addEventListener("popstate", () => resolve(), { once: true });
        window.history.back();
      });
    });
    // Next subscribes useSearchParams to history. This mock reads the browser
    // on render, so simulate that notification after the real popstate event.
    rerender(<ServicesNavigatorPage />);
    expect(new URLSearchParams(window.location.search).get("shortlist")).toBe(withPhone.slug);
    expect(screen.getByTestId("services-shortlist-bar")).toHaveTextContent("1 shortlisted");

    await act(async () => {
      await new Promise<void>((resolve) => {
        window.addEventListener("popstate", () => resolve(), { once: true });
        window.history.forward();
      });
    });
    rerender(<ServicesNavigatorPage />);
    expect(new URLSearchParams(window.location.search).has("shortlist")).toBe(false);
    expect(screen.queryByTestId("services-shortlist-bar")).toBeNull();
  });

  it.each([
    { stage: "shortlist", heading: "Shortlist" },
    { stage: "compare", heading: "Compare services" },
  ])("keeps search-only controls out of $stage and restores their saved scope on Search", ({ stage, heading }) => {
    setSearch(`q=Call&scope=all&shortlist=${withPhone.slug},${withoutPhone.slug}&workflow=${stage}`);
    render(<ServicesNavigatorPage />);
    const ribbon = screen.getByTestId("search-query-ribbon");
    expect(within(ribbon).getByRole("heading", { level: 1, name: heading })).toBeVisible();
    expect(within(ribbon).getByRole("status")).toHaveTextContent("2 services");
    expect(screen.queryByRole("group", { name: "Sort results" })).toBeNull();
    expect(screen.queryByRole("group", { name: "Applied filters" })).toBeNull();
    expect(screen.queryByTestId("service-filter-trigger-phone")).toBeNull();
    expect(screen.queryByTestId("service-filter-trigger-desktop")).toBeNull();
    expect(screen.queryByTestId("service-filter-panel")).toBeNull();

    const nav = screen.getByRole("navigation", { name: "Referral progress" });
    fireEvent.click(within(nav).getByRole("button", { name: "Search" }));
    expect(within(ribbon).getByRole("heading", { level: 1, name: "Call" })).toBeVisible();
    expect(screen.getByRole("group", { name: "Sort results" })).toBeVisible();
    expect(screen.getByRole("group", { name: "Applied filters" })).toHaveTextContent("All services");
    fireEvent.click(screen.getByTestId("service-filter-trigger-phone"));
    const scope = screen.getByRole("group", { name: "Search in" });
    expect(within(scope).getByRole("radio", { name: /^All services/ })).toBeChecked();
    const params = new URLSearchParams(window.location.search);
    expect(params.get("q")).toBe("Call");
    expect(params.get("scope")).toBe("all");
    expect(params.get("shortlist")).toBe(`${withPhone.slug},${withoutPhone.slug}`);
    expect(params.has("workflow")).toBe(false);
  });

  it("explains and enforces shortlist, comparison and referral prerequisites", () => {
    render(<ServicesNavigatorPage />);
    const initialUrl = window.location.href;
    const nav = screen.getByRole("navigation", { name: "Referral progress" });
    expect(within(nav).getByRole("button", { name: "Search" })).toHaveAttribute("aria-current", "step");
    for (const name of ["Shortlist", "Compare", "Refer"]) {
      const action = within(nav).getByRole("button", { name });
      expect(action).toHaveAttribute("aria-disabled", "true");
      expect(action).toHaveAccessibleDescription();
      fireEvent.click(action);
    }
    expect(navigation.push).not.toHaveBeenCalled();
    expect(window.location.href).toBe(initialUrl);
    expect(screen.queryByTestId("services-comparison")).toBeNull();
  });

  it("switches between search, shortlist and comparison while carrying the query and selection", async () => {
    setSearch("q=Call&scope=all");
    render(<ServicesNavigatorPage />);
    shortlistService(withPhone);
    shortlistService(withoutPhone);
    const nav = screen.getByRole("navigation", { name: "Referral progress" });
    expect(within(nav).getByRole("button", { name: "Search" })).toHaveAttribute("aria-current", "step");
    fireEvent.click(within(nav).getByRole("button", { name: "Shortlist (2)" }));
    expect(within(nav).getByRole("button", { name: "Shortlist (2)" })).toHaveAttribute("aria-current", "step");
    expect(screen.getByTestId("service-search-results").children).toHaveLength(2);

    fireEvent.click(within(nav).getByRole("button", { name: "Compare" }));
    expect(screen.getByTestId("services-comparison")).toBeVisible();
    expect(screen.queryByTestId("service-search-results")).toBeNull();
    const target = new URL(window.location.href);
    expect(target.pathname).toBe("/services/search");
    expect(target.searchParams.get("q")).toBe("Call");
    expect(target.searchParams.get("scope")).toBe("all");
    expect(target.searchParams.get("shortlist")).toBe(`${withPhone.slug},${withoutPhone.slug}`);
    expect(target.searchParams.get("workflow")).toBe("compare");

    const closeComparison = screen.getByRole("button", { name: "Close service comparison" });
    closeComparison.focus();
    fireEvent.click(closeComparison);
    expect(screen.queryByTestId("services-comparison")).toBeNull();
    expect(within(nav).getByRole("button", { name: "Shortlist (2)" })).toHaveAttribute("aria-current", "step");
    await waitFor(() => expect(within(nav).getByRole("button", { name: "Shortlist (2)" })).toHaveFocus());
    fireEvent.click(within(nav).getByRole("button", { name: "Search" }));
    expect(within(nav).getByRole("button", { name: "Search" })).toHaveAttribute("aria-current", "step");
    expect(screen.getByTestId("services-shortlist-bar")).toHaveTextContent("2 shortlisted");
  });

  it("falls back to the shortlist when removing a compared service breaks the two-service prerequisite", () => {
    setSearch(`shortlist=${withPhone.slug},${withoutPhone.slug}&workflow=compare`);
    render(<ServicesNavigatorPage />);
    fireEvent.click(screen.getByRole("button", { name: `Remove ${withPhone.title} from comparison` }));
    expect(screen.queryByTestId("services-comparison")).toBeNull();
    const nav = screen.getByRole("navigation", { name: "Referral progress" });
    expect(within(nav).getByRole("button", { name: "Compare" })).toHaveAttribute("aria-disabled", "true");
    expect(within(nav).getByRole("button", { name: "Shortlist (1)" })).toHaveAttribute("aria-current", "step");
    expect(screen.getByTestId("service-search-results").children).toHaveLength(1);
  });

  it("restores URL-owned selection and views on back and forward without retaining optimistic state", () => {
    const { rerender } = render(<ServicesNavigatorPage />);
    shortlistService(withPhone);
    setSearch(`shortlist=${withPhone.slug}&workflow=shortlist`);
    rerender(<ServicesNavigatorPage />);
    expect(screen.getByTestId("service-search-results").children).toHaveLength(1);
    setSearch("");
    rerender(<ServicesNavigatorPage />);
    expect(screen.queryByTestId("services-shortlist-bar")).toBeNull();
    expect(screen.getByTestId("service-search-results").children).toHaveLength(2);
    setSearch(`shortlist=${withPhone.slug},${withoutPhone.slug}&workflow=compare`);
    rerender(<ServicesNavigatorPage />);
    expect(screen.getByTestId("services-comparison")).toBeVisible();
    expect(screen.getByTestId("services-shortlist-bar")).toHaveTextContent("2 shortlisted");
  });

  it("does not treat invalid or missing shortlisted records as an available comparison", () => {
    setSearch("shortlist=unknown,missing&workflow=compare");
    render(<ServicesNavigatorPage />);
    expect(screen.queryByTestId("services-comparison")).toBeNull();
    const nav = screen.getByRole("navigation", { name: "Referral progress" });
    expect(within(nav).getByRole("button", { name: "Search" })).toHaveAttribute("aria-current", "step");
    expect(within(nav).getByRole("button", { name: "Compare" })).toHaveAttribute("aria-disabled", "true");
  });

  it.each([
    { shortlist: "missing1,missing2,missing3,missing4,missing5", service: withPhone, expected: [withPhone.slug] },
    {
      shortlist: `${withPhone.slug},missing1,missing2,missing3,missing4`,
      service: withoutPhone,
      expected: [withPhone.slug, withoutPhone.slug],
    },
  ])(
    "lets valid additions replace unavailable URL shortlist entries ($shortlist)",
    ({ shortlist, service, expected }) => {
      setSearch(`shortlist=${shortlist}&workflow=compare`);
      render(<ServicesNavigatorPage />);
      fireEvent.click(
        within(screen.getByRole("navigation", { name: "Referral progress" })).getByRole("button", { name: "Search" }),
      );

      shortlistService(service);

      const card = screen.getByTestId(`service-search-result-${service.slug}`);
      expect(within(card).getByRole("button", { name: `Remove ${service.title} from shortlist` })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      expect(screen.getByTestId("services-shortlist-bar")).toHaveTextContent(`${expected.length} shortlisted`);
      expect(new URLSearchParams(window.location.search).get("shortlist")).toBe(expected.join(","));
    },
  );

  it.each(["loading", "error"])("preserves URL selection while registry state is %s", (status) => {
    const shortlist = `${withPhone.slug},missing`;
    setSearch(`shortlist=${shortlist}&workflow=shortlist`);
    registryState.status = status;
    const { rerender } = render(<ServicesNavigatorPage />);
    expect(new URLSearchParams(window.location.search).get("shortlist")).toBe(shortlist);

    registryState.status = "ready";
    rerender(<ServicesNavigatorPage />);
    expect(screen.getByTestId("services-shortlist-bar")).toHaveTextContent("1 shortlisted");
    expect(new URLSearchParams(window.location.search).get("shortlist")).toBe(shortlist);
  });
});
