import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Settings carries nine sections and roughly thirty controls, which is past the
// point where scanning finds anything. The header filter is the answer, and the
// declarative index behind it (settings-sections.ts) is only trustworthy while
// it matches the rows the dialog actually renders — the contract test below is
// what stops the two drifting apart.

vi.mock("@/lib/supabase/client", () => ({
  useAuthSession: () => ({
    status: "signed_out",
    isConfigured: false,
    error: null,
    notice: null,
    session: null,
    signInWithEmail: vi.fn(),
    signInWithOAuth: vi.fn(),
    signOut: vi.fn(),
  }),
}));

vi.mock("@/components/account-data-provider", () => ({
  useAccountData: () => ({
    favourites: {},
    clearFavourites: vi.fn(async () => true),
    isSaved: () => false,
    setFavourite: vi.fn(async () => true),
  }),
}));

import { SettingsDialog } from "@/components/clinical-dashboard/settings-dialog";
import {
  matchingSettingsRowIds,
  matchingSettingsSectionIds,
  SETTINGS_SEARCH_ENTRIES,
  SETTINGS_SECTIONS,
} from "@/components/clinical-dashboard/settings-sections";

function renderDialog() {
  return render(
    <SettingsDialog
      open
      onClose={vi.fn()}
      identity={{ displayName: "Local session", initials: "LS", detail: "Browser only", signedIn: true }}
      onSignOut={vi.fn()}
      onOpenGuide={vi.fn()}
    />,
  );
}

function searchFor(value: string) {
  fireEvent.change(screen.getByTestId("settings-search-input"), { target: { value } });
}

/** Every id the dialog exposes as a filterable row, however it is rendered. */
function renderedRowIds(): string[] {
  return [...document.querySelectorAll<HTMLElement>("[data-settings-search-row]")]
    .map((element) => element.dataset.settingsSearchRow ?? "")
    .filter(Boolean);
}

function expectSearchIndexInSync() {
  const rendered = new Set(renderedRowIds());
  const indexed = new Set(SETTINGS_SEARCH_ENTRIES.map((entry) => entry.id));
  for (const id of indexed) {
    expect(rendered.has(id), `${id} is indexed for search but not rendered`).toBe(true);
  }
  for (const id of rendered) {
    expect(indexed.has(id), `${id} is rendered but missing from the search index`).toBe(true);
  }
}

afterEach(async () => {
  cleanup();
  // Sheet restores focus in requestAnimationFrame with one defensive retry.
  await new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => window.setTimeout(resolve, 60));
  });
  vi.clearAllMocks();
});

describe("settings search index", () => {
  it("has an entry for every row the dialog renders", () => {
    renderDialog();
    // A row with no entry is a row nobody can search for; an entry with no row
    // is a search result that leads nowhere. Both are silent until someone
    // types the word that should have found it, so pin both directions.
    expectSearchIndexInSync();
  });

  it("fails closed when a rendered row is not indexed", () => {
    renderDialog();
    const unindexed = document.createElement("div");
    unindexed.dataset.settingsSearchRow = "settings-row-unindexed-proof";
    document.body.append(unindexed);

    expect(() => expectSearchIndexInSync()).toThrowError(
      "settings-row-unindexed-proof is rendered but missing from the search index",
    );
  });

  it("names a real section for every entry, and covers every section", () => {
    const sectionIds = new Set(SETTINGS_SECTIONS.map((section) => section.id));
    for (const entry of SETTINGS_SEARCH_ENTRIES) {
      expect(sectionIds.has(entry.section), `${entry.id} points at an unknown section`).toBe(true);
    }
    for (const section of SETTINGS_SECTIONS) {
      expect(
        SETTINGS_SEARCH_ENTRIES.some((entry) => entry.section === section.id),
        `${section.id} has no searchable rows, so the rail offers a jump to nothing`,
      ).toBe(true);
    }
  });

  it("has no duplicate ids", () => {
    const ids = SETTINGS_SEARCH_ENTRIES.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("settings search matching", () => {
  it("treats an empty query as no filter rather than no matches", () => {
    expect(matchingSettingsRowIds("")).toBeNull();
    expect(matchingSettingsRowIds("   ")).toBeNull();
    expect(matchingSettingsSectionIds(null)).toEqual(SETTINGS_SECTIONS.map((section) => section.id));
  });

  it("finds density by the words a reader actually types for text size", () => {
    // Interface density scales the rem baseline, so it IS the text-size control.
    // Nobody searching for larger text types "density".
    for (const term of ["text size", "font", "larger", "readability"]) {
      expect([...(matchingSettingsRowIds(term) ?? [])], term).toContain("settings-row-interface-density");
    }
  });

  it("finds appearance from 'dark mode' and privacy from 'history'", () => {
    expect([...(matchingSettingsRowIds("dark mode") ?? [])]).toContain("settings-row-appearance");
    const history = [...(matchingSettingsRowIds("history") ?? [])];
    expect(history).toContain("settings-row-save-recent-searches");
    expect(history).toContain("settings-row-clear-recent-searches");
  });

  it("narrows on extra words instead of widening", () => {
    const one = matchingSettingsRowIds("clear")?.size ?? 0;
    const two = matchingSettingsRowIds("clear saved")?.size ?? 0;
    expect(two).toBeLessThan(one);
    expect(two).toBeGreaterThan(0);
  });

  it("reports no matches distinctly from no filter", () => {
    const matches = matchingSettingsRowIds("zzzznotasetting");
    expect(matches).not.toBeNull();
    expect(matches?.size).toBe(0);
    expect(matchingSettingsSectionIds(matches!)).toEqual([]);
  });
});

describe("settings search in the dialog", () => {
  it("hides non-matching rows and the sections they leave empty", () => {
    renderDialog();
    expect(screen.getByTestId("settings-row-appearance")).toBeVisible();
    expect(screen.getByTestId("settings-row-jurisdiction")).toBeVisible();

    searchFor("dark mode");

    expect(screen.getByTestId("settings-row-appearance")).toBeVisible();
    expect(screen.queryByTestId("settings-row-jurisdiction")).not.toBeInTheDocument();
    // An empty section would render as a heading with nothing under it, which
    // reads as "this section has no settings".
    expect(document.querySelector('[data-settings-section="clinical-defaults"]')).toBeNull();
    expect(document.querySelector('[data-settings-section="app-preferences"]')).not.toBeNull();
    expect(screen.getByRole("button", { name: "App preferences" })).toHaveAttribute("aria-current", "true");
  });

  it("offers a way back when nothing matches", () => {
    renderDialog();
    searchFor("zzzznotasetting");

    expect(screen.getByTestId("settings-search-empty")).toBeVisible();
    expect(screen.queryByTestId("settings-row-appearance")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));

    expect(screen.queryByTestId("settings-search-empty")).not.toBeInTheDocument();
    expect(screen.getByTestId("settings-row-appearance")).toBeVisible();
  });

  it("announces the result count from a live region that is always mounted", () => {
    // A live region created at the moment it first has content is announced
    // unreliably; the container has to already be in the DOM.
    renderDialog();
    const status = document.getElementById("settings-search-results-status");
    expect(status).not.toBeNull();
    expect(status).toHaveAttribute("aria-live", "polite");

    searchFor("dark mode");
    expect(status).toHaveTextContent(/match(es)? your search/);

    searchFor("zzzznotasetting");
    expect(status).toHaveTextContent("No settings match your search.");
  });

  it("clears the filter on Escape before the dialog would close", () => {
    const onClose = vi.fn();
    render(
      <SettingsDialog
        open
        onClose={onClose}
        identity={{ displayName: "Local session", initials: "LS", detail: "Browser only", signedIn: true }}
        onSignOut={vi.fn()}
        onOpenGuide={vi.fn()}
      />,
    );
    const input = screen.getByTestId("settings-search-input");
    fireEvent.change(input, { target: { value: "dark" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect((input as HTMLInputElement).value).toBe("");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("takes unreachable sections out of the rail rather than offering a dead jump", () => {
    renderDialog();
    searchFor("dark mode");
    const clinical = screen.getAllByRole("button", { name: "Clinical defaults" });
    for (const button of clinical) expect(button).toBeDisabled();
  });

  it("keeps search and the section rail desktop-only with no phone chip rail", () => {
    renderDialog();

    expect(screen.getByRole("search")).toHaveClass("hidden", "md:block");
    expect(screen.getByRole("navigation", { name: "Settings sections" }).closest("aside")).toHaveClass(
      "hidden",
      "md:flex",
    );
    expect(screen.queryByTestId("settings-section-chips")).not.toBeInTheDocument();
  });
});

describe("settings shortcuts and privacy additions", () => {
  it("lists every shortcut the app binds, not just two of them", () => {
    renderDialog();
    const card = screen.getByTestId("settings-keyboard-shortcuts-card");
    // `/` and Ctrl+K live in universal-search-command-surface, Ctrl+Enter in
    // master-search-header, Escape in ui/sheet.
    expect(within(card).getByText("Focus search")).toBeVisible();
    expect(within(card).getByText("Open the command palette")).toBeVisible();
    expect(within(card).getByText("Ask the question you have typed")).toBeVisible();
    expect(within(card).getByText("Close this dialog")).toBeVisible();
    // jsdom is not an Apple platform, so the non-Apple modifier is what shows.
    expect(within(card).getAllByText("Ctrl").length).toBe(2);
  });

  it("offers recent-search recording as a real privacy switch", () => {
    renderDialog();
    const row = screen.getByTestId("settings-row-save-recent-searches");
    const control = within(row).getByRole("switch", { name: "Save recent searches" });
    expect(control).toHaveAttribute("aria-checked", "true");
    // Nothing about it is "not active yet": it gates the write in
    // ClinicalDashboard's rememberRecentQuery.
    expect(within(row).queryByText("Not active yet")).not.toBeInTheDocument();
  });

  it("reports settings as device-only while signed out", () => {
    renderDialog();
    const row = screen.getByTestId("settings-row-preference-sync");
    expect(row).toHaveAttribute("data-sync-state", "local-only");
    expect(row).toHaveTextContent("Saved on this device");
  });
});
