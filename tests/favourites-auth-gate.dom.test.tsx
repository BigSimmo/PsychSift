/** @vitest-environment jsdom */

import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import userEvent from "@testing-library/user-event";

import { ClinicalSidebarContent, deriveSidebarIdentity } from "@/components/clinical-dashboard/ClinicalSidebar";
import { FavouritesCommandLibraryPage } from "@/components/clinical-dashboard/favourites-command-library-page";
import { AccountSetupDialog } from "@/components/clinical-dashboard/account-setup-dialog";
import { ApplicationsLauncherWorkspace } from "@/components/applications-launcher-page";
import { MasterSearchHeader } from "@/components/clinical-dashboard/master-search-header";
import { filterCrossModesForSession, visibleAppModeDefinitionsForSession } from "@/lib/app-modes";
import { toolCatalogRecordsForSession } from "@/lib/tools-catalog";

const authSession = vi.hoisted(() => ({
  status: "signed_out" as string,
  session: null as { user: { email?: string } } | null,
  isConfigured: true,
  error: null as string | null,
  notice: null as string | null,
  signInWithEmail: vi.fn(),
  signInWithOAuth: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  useAuthSession: () => authSession,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
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

function sidebarProps(showAccountLibrary: boolean) {
  return {
    recentQueries: [] as string[],
    identity: deriveSidebarIdentity(showAccountLibrary ? "clinician@clinic.example" : null),
    activeMode: "answer" as const,
    showAccountLibrary,
    onNewChat: () => undefined,
    onPickRecent: () => undefined,
    onOpenSettings: () => undefined,
    onOpenAccount: () => undefined,
    onOpenSearch: () => undefined,
  };
}

function headerProps(canAccessFavourites: boolean) {
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
    canAccessFavourites,
    onQueryChange: () => undefined,
    onSearchModeChange: vi.fn(),
    onAsk: () => undefined,
    onClearQuery: () => undefined,
    onClearScope: () => undefined,
    onQueryModeChange: () => undefined,
    onScopeFiltersChange: () => undefined,
    onToggleScope: () => undefined,
    queryModeOptions: [{ value: "auto" as const, label: "Auto" }],
  };
}

describe("favourites auth gate DOM", () => {
  beforeEach(() => {
    authSession.status = "signed_out";
    authSession.session = null;
    authSession.error = null;
    authSession.notice = null;
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  it("keeps the six canonical navigation entries separate from conditional Favourites", () => {
    const { rerender } = render(<ClinicalSidebarContent {...sidebarProps(false)} />);

    expect(screen.queryByRole("navigation", { name: "Your library" })).toBeNull();
    const navigation = within(screen.getByRole("navigation", { name: "Pinned shortcuts" }));
    expect(
      navigation.getAllByRole("link").map((link) => ({ name: link.textContent, href: link.getAttribute("href") })),
    ).toEqual([
      { name: "Answer", href: "/?mode=answer" },
      { name: "Documents", href: "/documents" },
      { name: "Services", href: "/services" },
      { name: "Medication", href: "/medications" },
      { name: "Factsheets", href: "/factsheets" },
      { name: "Tools", href: "/tools" },
    ]);
    expect(screen.queryByRole("link", { name: "Favourites" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Guide & help$/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^(Switch to )?(dark|light) mode$/i })).toBeNull();

    rerender(<ClinicalSidebarContent {...sidebarProps(true)} />);

    expect(screen.getByRole("navigation", { name: "Your library" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Favourites" })).toHaveAttribute("href", "/favourites");
    expect(
      within(screen.getByRole("navigation", { name: "Pinned shortcuts" })).queryByRole("link", {
        name: "Favourites",
      }),
    ).toBeNull();
  });

  it("omits Favourites from session mode options when signed out and not demo", () => {
    expect(
      visibleAppModeDefinitionsForSession({ authenticated: false, demoMode: false }).map((mode) => mode.id),
    ).not.toContain("favourites");
  });

  it("gates the favourites library and opens signup with save-favourites copy when signed out", () => {
    authSession.status = "signed_out";
    render(<FavouritesCommandLibraryPage query="" demoMode={false} />);

    expect(screen.getByRole("heading", { name: "Favourites command library" })).toBeVisible();
    expect(screen.getByText(/Sign up to save favourites and access them across devices/i)).toBeVisible();
    expect(screen.getByTestId("favourites-open-account-setup")).toBeVisible();
    expect(screen.getByRole("heading", { name: "Sign up to save favourites" })).toBeVisible();
    expect(screen.getByTestId("favourites-command-library")).toBeInTheDocument();
  });

  it("keeps the interactive library available in demo mode without the signup gate", () => {
    authSession.status = "signed_out";
    render(<FavouritesCommandLibraryPage query="" demoMode={true} />);

    expect(screen.getByRole("heading", { name: "Favourites command library" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Sign up to save favourites" })).toBeNull();
    expect(screen.queryByTestId("favourites-open-account-setup")).toBeNull();
  });

  it("uses favourites intent copy on the account setup dialog", () => {
    render(<AccountSetupDialog open onClose={() => undefined} intent="favourites" />);

    expect(screen.getByRole("heading", { name: "Sign up to save favourites" })).toBeVisible();
    expect(screen.getByText(/Sign in or create an account to save favourites/i)).toBeVisible();
    expect(screen.getByText("Saved favourites")).toBeVisible();
  });

  it("separates account-synced data from device-only recents", () => {
    render(<AccountSetupDialog open onClose={() => undefined} />);

    expect(screen.getByRole("heading", { name: "What’s saved where" })).toBeVisible();
    expect(screen.getAllByText("Account")).toHaveLength(2);
    expect(screen.getByText("This device")).toBeVisible();
    expect(screen.getByText(/Recent searches/i)).toBeVisible();
    expect(screen.getByText(/Stay in this browser session and do not sync/i)).toBeVisible();
    expect(screen.getByText(/No PHI required\./i)).toBeVisible();
    expect(screen.queryByText(/Everything syncs across your devices/i)).toBeNull();
    expect(screen.queryByText(/never shared/i)).toBeNull();
    expect(screen.queryByText("Account-scoped saves")).toBeNull();
  });

  it("leads with and wires Apple, Google, and Microsoft OAuth", async () => {
    const user = userEvent.setup();
    render(<AccountSetupDialog open onClose={() => undefined} />);

    const apple = screen.getByRole("button", { name: "Continue with Apple" });
    const google = screen.getByRole("button", { name: "Continue with Google" });
    const microsoft = screen.getByRole("button", { name: "Continue with Microsoft" });
    const email = screen.getByLabelText(/Email address/);

    expect(apple.compareDocumentPosition(google) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(google.compareDocumentPosition(microsoft) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(microsoft.compareDocumentPosition(email) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await user.click(apple);
    expect(authSession.signInWithOAuth).toHaveBeenCalledWith("apple");

    await user.click(google);
    expect(authSession.signInWithOAuth).toHaveBeenCalledWith("google");

    await user.click(microsoft);
    expect(authSession.signInWithOAuth).toHaveBeenCalledWith("azure");

    expect(screen.queryByText(/Apple sign-in is not available/i)).toBeNull();
  });

  it("shows the selected provider and locks competing actions while OAuth starts", () => {
    authSession.signInWithOAuth.mockImplementationOnce(() => new Promise<void>(() => undefined));
    render(<AccountSetupDialog open onClose={() => undefined} />);

    const apple = screen.getByRole("button", { name: "Continue with Apple" });
    fireEvent.click(apple);
    expect(apple).toHaveTextContent("Connecting…");
    for (const provider of ["Apple", "Google", "Microsoft"]) {
      expect(screen.getByRole("button", { name: `Continue with ${provider}` })).toBeDisabled();
    }
    expect(screen.getByRole("button", { name: "Continue with email" })).toBeDisabled();
  });

  it("submits email and announces success and failure feedback", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<AccountSetupDialog open onClose={() => undefined} />);

    const submit = screen.getByRole("button", { name: "Continue with email" });
    expect(submit).toBeDisabled();
    const email = screen.getByLabelText(/Email address/);
    expect(email).toHaveAttribute("data-sheet-autofocus", "true");
    await user.type(email, "clinician@clinic.example");
    await user.click(submit);
    expect(authSession.signInWithEmail).toHaveBeenCalledWith("clinician@clinic.example");

    authSession.notice = "Check your email for the sign-in link.";
    rerender(<AccountSetupDialog open onClose={() => undefined} />);
    expect(screen.getByRole("status")).toHaveTextContent("Check your email for the sign-in link.");

    authSession.notice = null;
    authSession.error = "Sign-in email could not be sent.";
    rerender(<AccountSetupDialog open onClose={() => undefined} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Sign-in email could not be sent.");
  });

  it("blacks out Tools Saved workflows and Favourites shortcuts for guests", () => {
    authSession.status = "signed_out";
    render(<ApplicationsLauncherWorkspace canAccessFavourites={false} />);

    // The category rail is a lens: its options are radios, not buttons.
    expect(screen.queryByRole("radio", { name: "Saved" })).toBeNull();
    expect(screen.queryByTestId("tool-shortcut-favourites")).toBeNull();
    expect(screen.queryByText("Saved workflows")).toBeNull();
    expect(screen.getByTestId("tools-hub")).toBeVisible();
  });

  it("keeps Tools Saved workflows available when Favourites access is granted", () => {
    render(<ApplicationsLauncherWorkspace canAccessFavourites={true} />);

    expect(screen.getByRole("radio", { name: "Saved" })).toBeVisible();
    expect(screen.getByTestId("tool-shortcut-favourites")).toBeVisible();
    expect(
      toolCatalogRecordsForSession({ authenticated: true, demoMode: false }).some((t) => t.id === "favourites"),
    ).toBe(true);
    expect(filterCrossModesForSession(["favourites", "forms"], { authenticated: false, demoMode: false })).toEqual([
      "forms",
    ]);
  });

  it("omits Favourites from the mode menu for guests", async () => {
    const user = userEvent.setup();
    render(<MasterSearchHeader {...headerProps(false)} />);

    await user.click(screen.getByRole("button", { name: /Mode Answer/i }));
    const guestMenu = await screen.findByRole("menu", { name: "Choose app mode" });
    expect(within(guestMenu).queryByRole("menuitemradio", { name: /Favourites/i })).toBeNull();
    expect(within(guestMenu).getByRole("menuitemradio", { name: /Answer/i })).toBeTruthy();
  });

  it("keeps Favourites in the mode menu when access is granted", async () => {
    const user = userEvent.setup();
    render(<MasterSearchHeader {...headerProps(true)} />);

    await user.click(screen.getByRole("button", { name: /Mode Answer/i }));
    const signedInMenu = await screen.findByRole("menu", { name: "Choose app mode" });
    expect(within(signedInMenu).getByRole("menuitemradio", { name: /Favourites/i })).toBeTruthy();
  });

  it("labels gated guest deep links truthfully without exposing Favourites as a selectable mode", async () => {
    const user = userEvent.setup();
    render(<MasterSearchHeader {...headerProps(false)} searchMode="favourites" />);

    const modeTrigger = screen.getByRole("button", { name: /Mode Favourites/i });
    expect(modeTrigger).toBeVisible();
    await user.click(modeTrigger);

    const guestMenu = await screen.findByRole("menu", { name: "Choose app mode" });
    expect(within(guestMenu).queryByRole("menuitemradio", { name: /Favourites/i })).toBeNull();
    expect(within(guestMenu).getByRole("menuitemradio", { name: /Answer/i })).toBeTruthy();
  });
});
