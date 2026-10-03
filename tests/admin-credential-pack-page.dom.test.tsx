/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AdminCredentialPackPage } from "@/components/admin/new-job/admin-credential-pack-page";
import { CREDENTIALS_STORAGE_KEY } from "@/lib/admin/credentials-storage";
import { CREDENTIAL_PACK_NOTE } from "@/lib/admin/credential-pack";
import type { OnCallEntry } from "@/lib/on-call/entry-model";
import { complianceFixture } from "./helpers/on-call-entry-fixture";

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/new-job/credential-pack",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const accountState = vi.hoisted(() => ({ isAuthenticated: true }));
vi.mock("@/components/account-data-provider", () => ({
  useAccountData: () => ({ isAuthenticated: accountState.isAuthenticated }),
}));

const entryState = vi.hoisted(() => ({
  entries: [] as OnCallEntry[],
  loading: false,
  isOffline: false,
  loadError: null as "offline" | "failed" | null,
  signedOut: false,
  demoMode: false,
  cachedAt: null as string | null,
  retry: vi.fn(),
}));
vi.mock("@/lib/on-call/entry-store", () => ({
  useOnCallEntries: () => entryState,
  cacheOnCallEntries: vi.fn(),
}));

const NOW = new Date("2026-09-26T01:00:00Z");
const renewal = complianceFixture("Medical registration renewal", { expiresOn: "2027-03-01", issuingBody: "AHPRA" });

function seedWallet(wallet: Record<string, unknown>) {
  window.localStorage.setItem(CREDENTIALS_STORAGE_KEY, JSON.stringify(wallet));
}

beforeEach(() => {
  window.localStorage.clear();
  accountState.isAuthenticated = true;
  Object.assign(entryState, {
    entries: [],
    loading: false,
    isOffline: false,
    loadError: null,
    signedOut: false,
    demoMode: false,
    cachedAt: null,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("AdminCredentialPackPage", () => {
  it("shows the sign-in message when signed out", () => {
    accountState.isAuthenticated = false;
    Object.assign(entryState, { signedOut: true });
    render(<AdminCredentialPackPage now={NOW} />);
    expect(screen.getByTestId("admin-credential-pack-signed-out")).toBeTruthy();
    expect(screen.queryByTestId("admin-credential-pack-preview")).toBeNull();
  });

  it("shows the same message in demo mode", () => {
    Object.assign(entryState, { demoMode: true });
    render(<AdminCredentialPackPage now={NOW} />);
    expect(screen.getByTestId("admin-credential-pack-signed-out")).toBeTruthy();
    expect(screen.queryByTestId("admin-credential-pack-preview")).toBeNull();
  });

  it("previews the wallet number, the renewal and the note", async () => {
    seedWallet({ ahpraNumber: "MED0001234567", providerNumbers: [] });
    entryState.entries = [renewal];
    render(<AdminCredentialPackPage now={NOW} />);
    const ahpra = await screen.findByTestId("admin-credential-pack-row-number-ahpra");
    expect(ahpra.textContent).toContain("MED0001234567");
    const row = screen.getByTestId(`admin-credential-pack-row-renewal-${renewal.id}`);
    expect(row.textContent).toContain("Expires 1 Mar 2027");
    expect(row.textContent).toContain("Issued by AHPRA");
    expect(screen.getByTestId("admin-credential-pack-note").textContent).toBe(CREDENTIAL_PACK_NOTE);
  });

  it("removes a row from the preview when it is unticked", async () => {
    seedWallet({ ahpraNumber: "MED0001234567", providerNumbers: [] });
    entryState.entries = [renewal];
    render(<AdminCredentialPackPage now={NOW} />);
    await screen.findByTestId("admin-credential-pack-row-number-ahpra");
    fireEvent.click(screen.getByTestId("admin-credential-pack-include-number-ahpra"));
    expect(screen.queryByTestId("admin-credential-pack-row-number-ahpra")).toBeNull();
    expect(screen.getByTestId(`admin-credential-pack-row-renewal-${renewal.id}`)).toBeTruthy();
  });

  it("disables Save as PDF and says nothing is ticked when everything is unticked", async () => {
    seedWallet({ ahpraNumber: "MED0001234567", providerNumbers: [] });
    entryState.entries = [renewal];
    render(<AdminCredentialPackPage now={NOW} />);
    await screen.findByTestId("admin-credential-pack-row-number-ahpra");
    fireEvent.click(screen.getByTestId("admin-credential-pack-include-number-ahpra"));
    fireEvent.click(screen.getByTestId(`admin-credential-pack-include-renewal-${renewal.id}`));
    expect(screen.getByText(/Nothing ticked/)).toBeTruthy();
    expect((screen.getByTestId("admin-credential-pack-pdf") as HTMLButtonElement).disabled).toBe(true);
  });

  it("opens the print dialogue when Save as PDF is clicked", async () => {
    const print = vi.fn();
    vi.stubGlobal("print", print);
    window.print = print;
    seedWallet({ ahpraNumber: "MED0001234567", providerNumbers: [] });
    render(<AdminCredentialPackPage now={NOW} />);
    await screen.findByTestId("admin-credential-pack-row-number-ahpra");
    const button = screen.getByTestId("admin-credential-pack-pdf") as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
    vi.unstubAllGlobals();
  });

  it("shows the empty message when nothing is recorded", async () => {
    seedWallet({ providerNumbers: [] });
    render(<AdminCredentialPackPage now={NOW} />);
    expect(await screen.findByTestId("admin-credential-pack-empty")).toBeTruthy();
  });
});
