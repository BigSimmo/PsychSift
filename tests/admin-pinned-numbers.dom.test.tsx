/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdminPinButton } from "@/components/admin/admin-pin-button";
import { AdminPinnedNumbers } from "@/components/admin/admin-pinned-numbers";
import type { AdminHelpItem } from "@/lib/admin/help-items";
import { adminPinsStorageKey } from "@/lib/admin/pins";
import { onCallEntryFixture } from "./helpers/on-call-entry-fixture";

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/help",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

function helpItem(title: string, phone: string | null): AdminHelpItem {
  const entry = onCallEntryFixture({ section: "logistics", title });
  return {
    key: entry.id,
    tab: "on-site",
    title,
    detail: null,
    phone,
    url: null,
    updatedOn: null,
    source: "you",
    entry,
    searchText: title.toLowerCase(),
  };
}

const security = helpItem("Security escort", "9000 0003");
const parking = helpItem("Parking permit", null);

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("Admin pinned numbers", () => {
  it("shows nothing until something is pinned", () => {
    render(<AdminPinnedNumbers items={[security, parking]} testId="pinned" />);
    expect(screen.queryByTestId("pinned")).toBeNull();
  });

  it("pins from a row, lists it with a call link, and unpins from the list", () => {
    render(
      <>
        <AdminPinButton entryId={security.entry!.id} title="Security escort" testId="pin-security" />
        <AdminPinButton entryId={parking.entry!.id} title="Parking permit" testId="pin-parking" />
        <AdminPinnedNumbers items={[security, parking]} testId="pinned" />
      </>,
    );
    fireEvent.click(screen.getByTestId("pin-security"));
    fireEvent.click(screen.getByTestId("pin-parking"));
    expect(screen.getByTestId("pin-security")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("heading", { name: "Pinned" })).toBeInTheDocument();
    expect(screen.getByTestId(`pinned-${security.key}`).querySelector('a[href^="tel:"]')).not.toBeNull();
    expect(screen.getByTestId(`pinned-${parking.key}`).querySelector("a")?.getAttribute("href")).toContain(
      `/admin/help#`,
    );
    // Only row ids reach the device.
    expect(window.localStorage.getItem(adminPinsStorageKey)).toBe(
      JSON.stringify([security.entry!.id, parking.entry!.id]),
    );

    fireEvent.click(screen.getByTestId(`pinned-${security.key}-pin`));
    expect(screen.queryByTestId(`pinned-${security.key}`)).toBeNull();
    expect(screen.getByTestId("pin-security")).toHaveAttribute("aria-pressed", "false");
  });

  it("skips a pin whose row is no longer in the list", () => {
    window.localStorage.setItem(adminPinsStorageKey, JSON.stringify(["99999999-9999-4999-8999-999999999999"]));
    render(<AdminPinnedNumbers items={[security]} testId="pinned" />);
    expect(screen.queryByTestId("pinned")).toBeNull();
  });
});
