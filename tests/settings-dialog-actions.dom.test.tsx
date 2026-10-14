import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The settings surface owns the destructive privacy actions (clear recent
// searches, clear saved items), preference reset, and sign-out. These flows had
// no render coverage. The data/auth/account hooks are mocked (the same harness
// shape as settings-inert-preferences.dom.test.tsx) so the destructive wiring is
// asserted without real storage or auth; useTheme/useAppPreferences run
// unmocked in jsdom.

const { clearRecentQueries, clearFavourites, signInWithEmail, signInWithOAuth, mockRecentCount, mockFavourites } =
  vi.hoisted(() => {
    let recentCount = 3;
    let favouritesData = { medications: [{ id: "m1" }] };
    return {
      clearRecentQueries: vi.fn(),
      clearFavourites: vi.fn(async () => true),
      signInWithEmail: vi.fn(),
      signInWithOAuth: vi.fn(),
      mockRecentCount: {
        get: () => recentCount,
        set: (count: number) => {
          recentCount = count;
        },
      },
      mockFavourites: {
        get: () => favouritesData,
        set: (data: { medications: Array<{ id: string }> }) => {
          favouritesData = data;
        },
      },
    };
  });

vi.mock("@/lib/recent-query-storage", () => ({
  clearRecentQueries: () => clearRecentQueries(),
  // Non-zero so the "Clear recent searches" action is enabled by default.
  countRecentQueries: () => mockRecentCount.get(),
}));

vi.mock("@/components/account-data-provider", () => ({
  useAccountData: () => ({
    // One saved item so the "Clear saved items" action is enabled by default.
    favourites: mockFavourites.get(),
    clearFavourites,
    isSaved: () => false,
    setFavourite: vi.fn(async () => true),
  }),
}));

vi.mock("@/lib/supabase/client", () => ({
  useAuthSession: () => ({
    status: "signed_out",
    // Configured so the email sign-in submit is enabled; irrelevant to the
    // signed-in destructive-action tests (which never render the sign-in form).
    isConfigured: true,
    error: null,
    notice: null,
    session: null,
    signInWithEmail,
    signInWithOAuth,
    signOut: vi.fn(),
  }),
}));

import { SettingsDialog } from "@/components/clinical-dashboard/settings-dialog";
import {
  EMPTY_PATIENT_PROFILE,
  getPatientProfileSnapshot,
  resetPatientProfile,
  writePatientProfile,
} from "@/lib/patient-profile-storage";

function renderDialog(identityOverrides: Record<string, unknown> = {}) {
  const onSignOut = vi.fn();
  render(
    <SettingsDialog
      open
      onClose={vi.fn()}
      identity={{
        displayName: "Local session",
        initials: "LS",
        detail: "Browser only",
        signedIn: true,
        ...identityOverrides,
      }}
      onSignOut={onSignOut}
      onOpenGuide={vi.fn()}
    />,
  );
  return { onSignOut };
}

afterEach(async () => {
  cleanup();
  resetPatientProfile();
  // Sheet cleanup restores focus in requestAnimationFrame and performs one
  // defensive retry 50 ms later. Queue our timer from the following frame so
  // it cannot overtake that nested retry when the CI event loop is delayed.
  await new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => window.setTimeout(resolve, 60));
  });
  vi.clearAllMocks();
});

describe("SettingsDialog — destructive and account actions", () => {
  // A Development section carries the in-progress surfaces while they are being
  // built. The route is a mockup, so the entry navigates through <Link> and
  // closes the sheet behind it.
  it("opens the Development page from a gated Development section", () => {
    renderDialog();
    const development = document.querySelector('[data-settings-section="development"]');
    expect(development).not.toBeNull();
    expect(development).toHaveTextContent("Owner panel");
    expect(development).toHaveTextContent("Synthetic data only");

    const prototypeLink = screen.getByTestId("settings-row-development-page");
    expect(prototypeLink).toHaveAttribute("href", "/admin/developer-hub");
    expect(prototypeLink).toHaveTextContent("Owner panel");
    expect(development?.contains(prototypeLink)).toBe(true);

    expect(screen.getByRole("navigation", { name: "Settings sections" }).closest("aside")).toHaveClass(
      "hidden",
      "md:flex",
    );
  });

  it("clears recent searches through the privacy action", () => {
    renderDialog();
    const button = screen.getByRole("button", { name: "Clear recent searches" });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(clearRecentQueries).toHaveBeenCalledTimes(1);
  });

  it("keeps the clinical default rows both clickable and singly named", () => {
    // Correct accessible name and a clickable label are not a trade. The row
    // text stays a real `<label htmlFor>` so clicking it focuses the select, and
    // `aria-labelledby` points back at that same label so the name is those
    // words once rather than two `<label for>` elements concatenated.
    renderDialog();
    for (const [id, name] of [
      ["settings-jurisdiction", "Jurisdiction"],
      ["settings-population", "Default population"],
    ] as const) {
      const control = document.getElementById(id);
      expect(control, `${name} control must exist`).not.toBeNull();
      const label = document.querySelector(`label[for="${id}"]`);
      expect(label, `${name} row text must stay a label so clicking it focuses the control`).not.toBeNull();
      expect(label).toHaveAttribute("id", `${id}-label`);
      expect(control).toHaveAttribute("aria-labelledby", `${id}-label`);
      expect(control).toHaveAccessibleName(name);
    }
  });

  it("disables clear recent searches when there are no recent queries", () => {
    mockRecentCount.set(0);
    renderDialog();
    const button = screen.getByRole("button", { name: "Clear recent searches" });
    expect(button).toBeDisabled();
    mockRecentCount.set(3); // Reset for other tests
  });

  // The prescribing profile is physiology, allergies and medications typed for a
  // patient. It is not a "recent search", so it needs its own clear: on a shared
  // computer the searches button alone used to leave a patient's details behind.
  it("clears the prescribing patient profile through its own privacy action", () => {
    writePatientProfile({ ...EMPTY_PATIENT_PROFILE, ageYears: 72, medications: ["lithium"] });
    renderDialog();
    const button = screen.getByRole("button", { name: "Clear prescribing patient profile" });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(getPatientProfileSnapshot()).toMatchObject({ ageYears: null, medications: [] });
    expect(screen.getByText("Prescribing patient profile cleared.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear prescribing patient profile" })).toBeDisabled();
  });

  it("reports when the prescribing profile clear cannot be persisted", () => {
    writePatientProfile({ ...EMPTY_PATIENT_PROFILE, ageYears: 72, medications: ["lithium"] });
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });
    const removeItem = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Clear prescribing patient profile" }));
    expect(getPatientProfileSnapshot()).toMatchObject({ ageYears: 72, medications: ["lithium"] });
    expect(
      screen.getByText("The prescribing patient profile could not be cleared. Please try again."),
    ).toBeInTheDocument();
    setItem.mockRestore();
    removeItem.mockRestore();
  });

  it("still clears the profile by deleting it when writing the empty profile fails", () => {
    writePatientProfile({ ...EMPTY_PATIENT_PROFILE, ageYears: 72, medications: ["lithium"] });
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Clear prescribing patient profile" }));
    setItem.mockRestore();
    expect(getPatientProfileSnapshot()).toMatchObject({ ageYears: null, medications: [] });
    expect(screen.queryByText(/could not be cleared/)).not.toBeInTheDocument();
  });

  it("counts a completed delete as cleared even when reading the key back throws", () => {
    writePatientProfile({ ...EMPTY_PATIENT_PROFILE, ageYears: 72, medications: ["lithium"] });
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    renderDialog();
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("reads unavailable");
    });
    fireEvent.click(screen.getByRole("button", { name: "Clear prescribing patient profile" }));
    getItem.mockRestore();
    setItem.mockRestore();
    expect(screen.queryByText(/could not be cleared/)).not.toBeInTheDocument();
    expect(screen.getByText("Prescribing patient profile cleared.")).toBeInTheDocument();
  });

  it("disables the prescribing profile clear when nothing has been entered", () => {
    renderDialog();
    expect(screen.getByRole("button", { name: "Clear prescribing patient profile" })).toBeDisabled();
  });

  // Clearing saved items deletes every favourite with no undo, so the row now
  // opens a confirmation rather than doing it on the first tap. The row must not
  // touch the data on its own; only the confirm control may.
  it("asks before clearing saved items, then clears and confirms via a status notice", async () => {
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Clear saved items" }));
    expect(clearFavourites).not.toHaveBeenCalled();

    const confirm = await screen.findByRole("button", { name: /^Delete \d+ saved items?$/ });
    fireEvent.click(confirm);

    expect(clearFavourites).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Saved items cleared.")).toBeVisible();
  });

  it("leaves saved items alone when the confirmation is cancelled", async () => {
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Clear saved items" }));
    // The confirmation renders "Cancel" twice on purpose — the sheet's close
    // control borrows the cancel label — so address the footer button inside
    // the dialog rather than by name alone.
    const dialog = await screen.findByTestId("confirm-dialog");
    fireEvent.click(within(dialog).getAllByRole("button", { name: "Cancel" }).at(-1)!);
    expect(clearFavourites).not.toHaveBeenCalled();
  });

  it("signs out through the account action", () => {
    const { onSignOut } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it("switches the guest account entry mode when Sign in is pressed", () => {
    renderDialog({ signedIn: false });
    // Desktop + mobile button sets share the same mode state.
    const signInButtons = screen.getAllByRole("button", { name: "Sign in" });
    const createButtons = screen.getAllByRole("button", { name: "Create account" });

    expect(createButtons[0]).toHaveAttribute("aria-pressed", "true");
    expect(signInButtons[0]).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(signInButtons[0]);

    expect(signInButtons[0]).toHaveAttribute("aria-pressed", "true");
    expect(createButtons[0]).toHaveAttribute("aria-pressed", "false");
    expect(signInButtons[1]).toHaveAttribute("aria-pressed", "true");
    expect(createButtons[1]).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByLabelText(/Email address/)).toBeVisible();
  });

  it("signs in with an entered email address", () => {
    renderDialog({ signedIn: false });
    // "Sign in" (rendered in both the desktop and mobile button sets) opens the
    // email entry form and selects the sign-in mode.
    fireEvent.click(screen.getAllByRole("button", { name: "Sign in" })[0]);

    // Matched loosely because the shared field shell states optionality in the
    // label text itself, so the accessible name is "Email address (required)".
    // That is the contract (FormField marks requirement in text, never by colour
    // alone), not a drifted string — pin the field, not the marker.
    fireEvent.change(screen.getByLabelText(/Email address/), {
      target: { value: "clinician@clinic.example" },
    });
    const submit = screen.getByRole("button", { name: "Continue with email" });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);

    expect(signInWithEmail).toHaveBeenCalledWith("clinician@clinic.example");
  });

  it("signs in with Apple from account settings", () => {
    renderDialog({ signedIn: false });
    fireEvent.click(screen.getAllByRole("button", { name: "Sign in" })[0]);

    const apple = screen.getByRole("button", { name: "Continue with Apple" });
    expect(apple).toBeEnabled();
    expect(screen.getByRole("button", { name: "Continue with Google" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Continue with Microsoft" })).toBeEnabled();
    expect(screen.queryByText(/Apple sign-in is unavailable/i)).toBeNull();

    fireEvent.click(apple);
    expect(signInWithOAuth).toHaveBeenCalledWith("apple");
  });
});
