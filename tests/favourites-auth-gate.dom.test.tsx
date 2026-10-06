/** @vitest-environment jsdom */

import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import userEvent from "@testing-library/user-event";

import { ClinicalSidebarContent, deriveSidebarIdentity } from "@/components/clinical-dashboard/ClinicalSidebar";
import { FavouritesCommandLibraryPage } from "@/components/clinical-dashboard/favourites-command-library-page";
import { AccountSetupDialog } from "@/components/clinical-dashboard/account-setup-dialog";
import { ApplicationsLauncherWorkspace } from "@/components/applications-launcher-page";
import { MasterSearchHeader } from "@/components/clinical-dashboard/master-search-header";
import { UniversalSearchCommandSurface } from "@/components/clinical-dashboard/universal-search-command-surface";
import { ToolsSearchResultsPage } from "@/components/tools/tools-search-results-page";
import { favouriteItems, type FavouriteItem } from "@/components/clinical-dashboard/favourites-prototype-data";
import { filterCrossModesForSession, visibleAppModeDefinitionsForSession } from "@/lib/app-modes";
import { toolCatalogRecordsForSession } from "@/lib/tools-catalog";

const authSession = vi.hoisted(() => ({
  status: "signed_out" as string,
  session: null as { user: { email?: string } } | null,
  isConfigured: true,
  error: null as string | null,
  notice: null as string | null,
  signInWithEmail: vi.fn(),
  signInWithPassword: vi.fn(),
  signUpWithPassword: vi.fn(),
  signInWithOAuth: vi.fn(),
  signOut: vi.fn(),
}));

const router = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  prefetch: vi.fn(),
}));

const searchCommand = vi.hoisted(() => ({
  value: null as { query: string; modeId: "tools" } | null,
}));

const savedRegistry = vi.hoisted(() => ({
  items: [] as FavouriteItem[],
}));

vi.mock("@/lib/supabase/client", () => ({
  useAuthSession: () => authSession,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
  // The header reads the pathname to mark the current page in the mode sheet's
  // in-mode section level. `/` is the shared home, which owns no section list —
  // the level these tests exercise is the mode list.
  usePathname: () => "/",
}));

vi.mock("@/components/clinical-dashboard/use-saved-registry-favourites", () => ({
  useSavedRegistryFavourites: () => ({
    items: savedRegistry.items,
    status: "ready",
    registryStatus: "ready",
    refetch: () => undefined,
  }),
}));

vi.mock("@/components/clinical-dashboard/search-command-context", () => ({
  useSearchCommand: () => searchCommand.value,
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

function CommandSurfaceFixture({
  canAccessFavourites,
  modeId,
  query,
}: {
  canAccessFavourites: boolean;
  modeId: "prescribing";
  query: string;
}) {
  return (
    <UniversalSearchCommandSurface
      demoMode={false}
      canAccessFavourites={canAccessFavourites}
      modeId={modeId}
      query={query}
      recentQueries={[]}
      dropdownOpen
      onDropdownOpenChange={() => undefined}
      onQueryChange={() => undefined}
      onSearch={() => undefined}
      onPickRecent={() => undefined}
      onCrossMode={() => undefined}
    >
      <input data-testid="global-search-input" />
    </UniversalSearchCommandSurface>
  );
}

describe("favourites auth gate DOM", () => {
  beforeEach(() => {
    authSession.status = "signed_out";
    authSession.session = null;
    authSession.error = null;
    authSession.notice = null;
    searchCommand.value = null;
    savedRegistry.items = [];
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => vi.unstubAllGlobals());

  it("keeps the seven canonical navigation entries separate from conditional Favourites", () => {
    const { rerender } = render(<ClinicalSidebarContent {...sidebarProps(false)} />);

    expect(screen.queryByRole("navigation", { name: "Your library" })).toBeNull();
    const navigation = within(screen.getByRole("navigation", { name: "Pinned shortcuts" }));
    expect(
      navigation.getAllByRole("link").map((link) => ({ name: link.textContent, href: link.getAttribute("href") })),
    ).toEqual([
      // Design review 2026-10-03, item 4: My Day leads the default shortcuts.
      { name: "My Day", href: "/my-day" },
      { name: "Answer", href: "/?mode=answer" },
      { name: "Documents", href: "/?mode=documents" },
      { name: "Services", href: "/?mode=services" },
      { name: "Medication", href: "/?mode=prescribing" },
      { name: "Factsheets", href: "/?mode=factsheets" },
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

  it("shows a signed-out visitor the sample library instead of the signup gate", async () => {
    authSession.status = "signed_out";
    render(<FavouritesCommandLibraryPage query="" demoMode={false} />);

    expect(screen.getByRole("heading", { name: "Favourites" })).toBeVisible();
    expect(screen.getByTestId("favourites-signed-out-sample")).toBeVisible();
    expect(screen.getByText("Sign in to see your favourites")).toBeVisible();
    expect(screen.queryByTestId("favourites-open-account-setup")).toBeNull();
    expect(screen.getByTestId("favourites-command-library")).toBeInTheDocument();
    expect((await screen.findAllByText("Major depressive disorder", {}, { timeout: 15000 })).length).toBeGreaterThan(0);
  });

  it("keeps the interactive library available in demo mode without the signup gate", () => {
    authSession.status = "signed_out";
    render(<FavouritesCommandLibraryPage query="" demoMode={true} />);

    expect(screen.getByRole("heading", { name: "Favourites" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Sign up to save favourites" })).toBeNull();
    expect(screen.queryByTestId("favourites-open-account-setup")).toBeNull();
  });

  it("labels demo-mode fixture favourites as examples (#358YM0)", () => {
    authSession.status = "signed_out";
    render(<FavouritesCommandLibraryPage query="" demoMode={true} />);

    expect(screen.getByText("Example favourites shown in demo mode")).toBeVisible();
    const fixture = favouriteItems[0];
    // Every surface that names a fixture item carries the tag beside its title.
    const tags = screen.getAllByText("Example", { exact: true });
    expect(tags.length).toBeGreaterThanOrEqual(favouriteItems.length);
    expect(screen.getAllByText(fixture.title).length).toBeGreaterThan(0);
    // A truncating title beside the tag must be able to shrink (min-w-0), or it
    // widens the row instead of ellipsing.
    for (const tag of tags) {
      for (const sibling of Array.from(tag.parentElement?.children ?? [])) {
        const classes = (sibling.getAttribute("class") ?? "").split(/\s+/);
        if (classes.includes("truncate")) expect(classes).toContain("min-w-0");
      }
    }
  });

  it("never labels a clinician's own saved favourites as examples (#358YM0)", () => {
    authSession.status = "authenticated";
    authSession.session = { user: { email: "clinician@clinic.example" } };
    savedRegistry.items = [
      {
        ...favouriteItems[0],
        id: "saved-own-item",
        title: "My own saved favourite",
      },
    ];
    render(<FavouritesCommandLibraryPage query="" demoMode={false} />);

    expect(screen.getAllByText("My own saved favourite").length).toBeGreaterThan(0);
    expect(screen.queryByText("Example", { exact: true })).toBeNull();
    expect(screen.queryByText("Example favourites shown in demo mode")).toBeNull();
  });

  it("uses favourites intent copy on the account setup dialog", () => {
    render(<AccountSetupDialog open onClose={() => undefined} intent="favourites" />);

    expect(screen.getByRole("heading", { name: "Sign up to save favourites" })).toBeVisible();
    expect(screen.getByText(/Sign in or create an account to save favourites/i)).toBeVisible();
    expect(screen.getByText("Save favourites")).toBeVisible();
  });

  it("separates account-synced data from device-only recents", () => {
    render(<AccountSetupDialog open onClose={() => undefined} />);

    expect(screen.getByRole("heading", { name: "Your workspace, wherever you work." })).toBeVisible();
    expect(screen.getByText("Save favourites")).toBeVisible();
    expect(screen.getByText(/Reopen trusted resources on any device/i)).toBeVisible();
    expect(screen.getByText("Keep your clinical defaults")).toBeVisible();
    expect(screen.getByText(/Your jurisdiction and answer style follow you/i)).toBeVisible();
    expect(screen.getByText("Recent searches stay here")).toBeVisible();
    expect(screen.getByText(/Browser activity does not sync to your account/i)).toBeVisible();
    expect(screen.getAllByText("Do not enter patient-identifiable information.")).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: "Privacy and data processing" })).toHaveLength(2);
    for (const privacyLink of screen.getAllByRole("link", { name: "Privacy and data processing" })) {
      expect(privacyLink).toHaveAttribute("href", "/privacy");
    }
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
    expect(screen.getByRole("button", { name: "Sign in with email" })).toBeDisabled();
  });

  it("submits password sign-in and announces success and failure feedback", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<AccountSetupDialog open onClose={() => undefined} />);

    const submit = screen.getByRole("button", { name: "Sign in with email" });
    expect(submit).toBeDisabled();
    const email = screen.getByLabelText(/Email address/);
    expect(email).toHaveAttribute("data-sheet-autofocus", "true");
    await user.type(email, "clinician@clinic.example");
    await user.type(screen.getByLabelText(/^Password/), "existing-passphrase");
    await user.click(submit);
    expect(authSession.signInWithPassword).toHaveBeenCalledWith("clinician@clinic.example", "existing-passphrase");

    authSession.notice = "Check your email to confirm your account, then sign in.";
    rerender(<AccountSetupDialog open onClose={() => undefined} />);
    expect(screen.getByRole("status")).toHaveTextContent("Check your email to confirm your account, then sign in.");

    authSession.notice = null;
    authSession.error = "Sign-in failed. Check your email and password, or confirm your email address.";
    rerender(<AccountSetupDialog open onClose={() => undefined} />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Sign-in failed. Check your email and password, or confirm your email address.",
    );
  });

  it("keeps the Tools Show all chip as a 48px tap target to the directory", () => {
    render(<ApplicationsLauncherWorkspace canAccessFavourites={false} />);

    const showAll = screen.getByTestId("tools-show-all");
    expect(showAll).toHaveAttribute("href", "/tools");
    expect(showAll).toHaveAttribute("aria-label", "Show all tools");
    expect(showAll).toHaveClass("min-h-tap");
    expect(showAll).toHaveTextContent("Show all");
    expect(screen.getByTestId("tools-show-all-well")).toBeInTheDocument();
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

  it("uses one guest-safe ranked collection for Smart Tools cards and mobile rows", () => {
    render(
      <ApplicationsLauncherWorkspace query="where can I check medication interactions?" canAccessFavourites={false} />,
    );

    expect(screen.getAllByTestId(/^application-card-/)[0]).toHaveAttribute(
      "data-testid",
      "application-card-medication-prescribing",
    );
    expect(screen.getAllByTestId(/^application-row-/)[0]).toHaveAttribute(
      "data-testid",
      "application-row-medication-prescribing",
    );
    expect(screen.getByTestId("application-card-medication-prescribing")).toBeInTheDocument();
    expect(screen.getByTestId("application-row-medication-prescribing")).toBeInTheDocument();
    for (const toolId of ["clinical-kb-search", "documents", "favourites"]) {
      expect(screen.queryByTestId(`tool-shortcut-${toolId}`)).toBeNull();
      expect(screen.queryByTestId(`application-card-${toolId}`)).toBeNull();
      expect(screen.queryByTestId(`application-row-${toolId}`)).toBeNull();
    }
  });

  it("suppresses local-only Tools Smart actions for authenticated users but keeps literal tool access", () => {
    const { rerender } = render(
      <ApplicationsLauncherWorkspace query="where can I check medication interactions?" canAccessFavourites />,
    );

    for (const toolId of ["clinical-kb-search", "documents", "favourites"]) {
      expect(screen.queryByTestId(`tool-shortcut-${toolId}`)).toBeNull();
      expect(screen.queryByTestId(`application-card-${toolId}`)).toBeNull();
      expect(screen.queryByTestId(`application-row-${toolId}`)).toBeNull();
    }

    for (const [query, toolId] of [
      ["PsychSift Search", "clinical-kb-search"],
      ["Documents", "documents"],
      ["Favourites", "favourites"],
    ]) {
      rerender(<ApplicationsLauncherWorkspace query={query} canAccessFavourites />);

      expect(screen.getAllByTestId(`tool-shortcut-${toolId}`)).toHaveLength(toolId === "favourites" ? 1 : 2);
      expect(screen.getByTestId(`application-card-${toolId}`)).toBeInTheDocument();
      expect(screen.getByTestId(`application-row-${toolId}`)).toBeInTheDocument();
    }
  });

  it.each([
    ["where can I check medication interactions?", "application-card-medication-prescribing"],
    ["forms", "application-card-forms"],
  ])("lets the Tools owner replace an empty shared command and submit %s", async (query, expectedCard) => {
    const user = userEvent.setup();
    searchCommand.value = { query: "", modeId: "tools" };
    render(<ApplicationsLauncherWorkspace query="" canAccessFavourites={false} />);

    const input = screen.getByRole("textbox", { name: "Search tools" });
    await user.type(input, query);

    expect(input).toHaveValue(query);
    expect(screen.getAllByTestId(/^application-card-/)[0]).toHaveAttribute("data-testid", expectedCard);

    await user.keyboard("{Enter}");
    expect(router.push).toHaveBeenCalledWith(`/tools?q=${encodeURIComponent(query)}&run=1`);
  });

  it("keeps Tools Saved workflows available when Favourites access is granted", () => {
    render(<ApplicationsLauncherWorkspace canAccessFavourites={true} />);

    expect(screen.getByRole("radio", { name: "Saved (1)" })).toBeVisible();
    expect(screen.getByTestId("tool-shortcut-favourites")).toBeVisible();
    expect(
      toolCatalogRecordsForSession({ authenticated: true, demoMode: false }).some((t) => t.id === "favourites"),
    ).toBe(true);
    expect(filterCrossModesForSession(["favourites", "forms"], { authenticated: false, demoMode: false })).toEqual([
      "forms",
    ]);
  });

  it("hides authenticated saved matches only for natural Prescribing Smart search", async () => {
    savedRegistry.items = [
      {
        ...favouriteItems[0],
        id: "saved-prescribing-monitoring-query",
        title: "Sertraline monitoring saved search",
        primaryAction: "Run",
        href: "/favourites?q=sertraline-monitoring&run=1",
        keywords: "sertraline medicine that needs regular blood tests monitoring",
      },
    ];
    vi.stubGlobal("matchMedia", () => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));

    const { rerender } = render(
      <CommandSurfaceFixture
        canAccessFavourites
        modeId="prescribing"
        query="medicine that needs regular blood tests"
      />,
    );

    await screen.findByRole("listbox");
    expect(screen.queryByText("Sertraline monitoring saved search")).toBeNull();

    rerender(<CommandSurfaceFixture canAccessFavourites modeId="prescribing" query="sertraline" />);
    expect(await screen.findByText("Sertraline monitoring saved search")).toBeVisible();
  });

  it("hides document mode actions only for natural Prescribing Smart search", async () => {
    vi.stubGlobal("matchMedia", () => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));

    const { rerender } = render(
      <CommandSurfaceFixture
        canAccessFavourites={false}
        modeId="prescribing"
        query="medicine that needs regular blood tests"
      />,
    );

    await screen.findByRole("listbox");
    expect(screen.queryByText("Browse library")).toBeNull();
    expect(screen.queryByText("Scope sources")).toBeNull();
    expect(screen.queryByText("Recent documents")).toBeNull();

    rerender(<CommandSurfaceFixture canAccessFavourites={false} modeId="prescribing" query="sertraline" />);
    expect(await screen.findByText("Browse library")).toBeVisible();
  });

  it("applies the same Favourites access gate to the all-tools results directory", () => {
    const { rerender } = render(<ToolsSearchResultsPage canAccessFavourites={false} />);

    expect(screen.getByRole("heading", { level: 1, name: "Tools" })).toBeVisible();
    expect(within(screen.getByTestId("tool-row-clinical-kb-search")).getByRole("link")).toHaveAttribute(
      "href",
      "/?mode=answer",
    );
    expect(screen.getByRole("button", { name: "About PsychSift Search" })).toBeVisible();
    expect(screen.getByRole("region", { name: "Safety" })).toBeVisible();
    expect(screen.queryByRole("region", { name: "Saved" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Saved workflows" })).toBeNull();
    // The default Saved workflows pin resolves against the session, so a guest never sees it.
    expect(screen.queryByTestId("tool-pin-favourites")).toBeNull();

    rerender(<ToolsSearchResultsPage canAccessFavourites />);

    expect(screen.getByRole("region", { name: "Saved" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Saved workflows" })).toBeVisible();
    expect(screen.getByTestId("tool-pin-favourites")).toBeVisible();
  });

  it("offers an all-tools recovery path when a URL query has no matching tools", () => {
    render(<ToolsSearchResultsPage initialQuery="no-such-tool" canAccessFavourites={false} />);

    expect(screen.getByRole("heading", { level: 2, name: "No tools match" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Show all tools" })).toHaveAttribute("href", "/tools");
  });

  it("uses the Tools Smart matcher for the submitted medication-interactions query", () => {
    render(
      <ToolsSearchResultsPage initialQuery="where can I check medication interactions?" canAccessFavourites={false} />,
    );

    expect(
      within(screen.getByRole("region", { name: "Tool results" })).getByRole("heading", {
        level: 3,
        name: "Medication Prescribing",
      }),
    ).toBeVisible();
    expect(screen.queryByRole("heading", { level: 3, name: "Saved workflows" })).toBeNull();
  });

  it("keeps local-only Tools Smart results free of escape tools while literal titles still open them", () => {
    const { rerender } = render(
      <ToolsSearchResultsPage initialQuery="where can I check medication interactions?" canAccessFavourites />,
    );
    const results = screen.getByRole("region", { name: "Tool results" });

    for (const title of ["PsychSift Search", "Documents", "Saved workflows"]) {
      expect(within(results).queryByRole("heading", { level: 3, name: title })).toBeNull();
      expect(within(results).queryByRole("link", { name: title })).toBeNull();
    }

    rerender(<ToolsSearchResultsPage initialQuery="Documents" canAccessFavourites />);
    const literalResults = screen.getByRole("region", { name: "Tool results" });
    expect(within(literalResults).getByRole("heading", { level: 3, name: "Documents" })).toBeVisible();
    expect(within(literalResults).getByRole("link", { name: "Documents" })).toBeVisible();
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
