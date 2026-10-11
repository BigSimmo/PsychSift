import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

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

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
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
    status: "ready",
    records: registryRecords,
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
  it("puts a tel: call link with the visible number on a card whose record has a phone", () => {
    render(<ServicesNavigatorPage />);
    const card = screen.getByTestId(`service-search-result-${withPhone.slug}`);
    const call = within(card).getByRole("link", { name: /^Call 1800 199 008/ });
    expect(call).toHaveAttribute("href", "tel:1800199008");
    expect(call).toHaveTextContent("Call 1800 199 008");
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
