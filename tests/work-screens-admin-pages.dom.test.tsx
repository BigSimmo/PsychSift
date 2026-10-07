/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "@/components/ui/toast";
import { ACCOUNT_TRANSITION_EVENT } from "@/lib/account-scoped-browser-state";
import { EXAMPLE_BLOCKED_EVENT } from "@/lib/example-data/guards";
import { resetExampleDataForTests, setExampleDataOn } from "@/lib/example-data/store";
import { ADMIN_PAPERWORK_STORAGE_KEY, forgetAdminPaperworkOnDevice } from "@/lib/work-screens/admin/paperwork-store";
import { complianceFixture } from "./helpers/on-call-entry-fixture";

const search = vi.hoisted(() => ({ params: new URLSearchParams() }));
const clipboard = vi.hoisted(() => ({ copy: vi.fn(async (text: string) => void text) }));
vi.mock("@/lib/copy-to-clipboard", () => ({ copyTextToClipboard: clipboard.copy }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/sharing",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => search.params,
}));

vi.mock("@/components/account-data-provider", () => ({
  useAccountData: () => ({ isAuthenticated: true }),
  useOptionalAccountData: () => ({ isAuthenticated: true }),
}));

// The sign-in dialog needs the auth provider, which a unit render does not mount.
vi.mock("@/components/clinical-dashboard/account-setup-dialog", () => ({ AccountSetupDialog: () => null }));

const storeState = vi.hoisted(() => ({
  entries: [] as unknown[],
  loading: false,
  isOffline: false,
  loadError: null as "offline" | "failed" | null,
  signedOut: false,
  demoMode: false,
  cachedAt: null as string | null,
  retry: () => {},
}));
// The example data switch reads the sign-in status. Signed out here follows the entries store's flag.
vi.mock("@/lib/supabase/client", () => ({
  useAuthSession: () => ({
    status: storeState.signedOut ? "signed_out" : "authenticated",
    session: null,
    authEpoch: 0,
  }),
}));
vi.mock("@/lib/on-call/entry-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/on-call/entry-store")>()),
  useOnCallEntries: () => storeState,
}));

const roster = vi.hoisted(() => ({
  status: "ready" as "ready" | "loading" | "error" | "signed-out",
  shifts: [] as unknown[],
}));
vi.mock("@/components/roster/use-roster-shifts", () => ({
  useRosterShifts: () => ({
    status: roster.status,
    shifts: roster.shifts,
    teamLoading: false,
    teamMessage: null,
    sample: false,
    demoMode: false,
    reload: vi.fn(async () => {}),
  }),
}));
vi.mock("@/components/roster/use-roster-team", () => ({
  useRosterTeams: () => ({ status: "ready", data: { teams: [] } }),
  useRosterRead: () => ({ status: "idle", data: null }),
}));
vi.mock("@/components/roster/use-roster-extra-time", () => ({
  useRosterExtraTime: () => ({ status: "ready", records: [] }),
}));

import { AdminDocumentsPage } from "@/components/work-screens/admin/documents-page";
import { AdminPayPage } from "@/components/work-screens/admin/pay-page";
import { AdminRequestsPage } from "@/components/work-screens/admin/requests-page";
import { AdminSharingPage } from "@/components/work-screens/admin/sharing-page";
import { AdminTaxPage } from "@/components/work-screens/admin/tax-page";
import { AdminWorkforcePage } from "@/components/work-screens/admin/workforce-page";

const NOW = new Date("2026-10-07T01:00:00Z");

function withToasts(node: ReactNode) {
  return render(<ToastProvider>{node}</ToastProvider>);
}

function stored(): Record<string, unknown> | null {
  const raw = window.localStorage.getItem(ADMIN_PAPERWORK_STORAGE_KEY);
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
}

beforeEach(() => {
  forgetAdminPaperworkOnDevice();
  window.localStorage.clear();
  resetExampleDataForTests();
  clipboard.copy.mockClear();
  storeState.entries = [];
  storeState.loading = false;
  storeState.isOffline = false;
  storeState.loadError = null;
  storeState.signedOut = false;
  storeState.demoMode = false;
  roster.status = "ready";
  roster.shifts = [];
  search.params = new URLSearchParams();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Admin Sharing", () => {
  it("says it is not live, starts every switch off and offers no pack", () => {
    withToasts(<AdminSharingPage now={NOW} />);
    expect(screen.getByTestId("admin-sharing-not-live").textContent).toContain("Not live yet");
    for (const sw of screen.getAllByRole("switch")) expect(sw.getAttribute("aria-checked")).toBe("false");
    expect(screen.getByTestId("admin-sharing-nothing-on")).toBeTruthy();
  });

  it("keeps a switch on this device, builds the pack, and Undo turns it back off", () => {
    storeState.entries = [
      complianceFixture(
        "Medical registration renewal",
        { category: "Registration", expiresOn: "2027-09-30", requirementId: "medical-registration-renewal" },
        { isOwn: true },
      ),
    ];
    withToasts(<AdminSharingPage now={NOW} />);
    fireEvent.click(screen.getByTestId("admin-sharing-switch-registration"));
    expect((stored()?.sharing as { groups: Record<string, boolean> }).groups.registration).toBe(true);
    expect(screen.getByTestId("admin-sharing-workforce-pack")).toBeTruthy();
    expect(screen.queryByTestId("admin-sharing-health-pack")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect((stored()?.sharing as { groups: Record<string, boolean> }).groups.registration).toBe(false);
  });

  it("fails closed when the records do not load: no switches, a retry", () => {
    storeState.isOffline = true;
    storeState.loadError = "offline";
    withToasts(<AdminSharingPage now={NOW} />);
    expect(screen.getByTestId("admin-sharing-load-failed")).toBeTruthy();
    expect(screen.queryByTestId("admin-sharing-groups")).toBeNull();
  });

  it("signed out shows the example records and writes nothing to the device", async () => {
    storeState.signedOut = true;
    window.localStorage.setItem(ADMIN_PAPERWORK_STORAGE_KEY, JSON.stringify({ version: 1, requests: [] }));
    withToasts(<AdminSharingPage now={NOW} />);
    expect(screen.getByTestId("admin-sharing-signed-out")).toBeTruthy();
    fireEvent.click(await screen.findByTestId("admin-sharing-switch-checks"));
    expect(window.localStorage.getItem(ADMIN_PAPERWORK_STORAGE_KEY)).toBeNull();
  });

  it("signed out with example data off shows no example records and still writes nothing", async () => {
    act(() => setExampleDataOn(false));
    storeState.signedOut = true;
    withToasts(<AdminRequestsPage now={NOW} />);
    expect(screen.getByTestId("admin-requests-signed-out").textContent).toContain("Nothing is kept");
    expect(screen.queryByText("Basic life support")).toBeNull();
    expect(window.localStorage.getItem(ADMIN_PAPERWORK_STORAGE_KEY)).toBeNull();
  });
});

describe("Admin Requests", () => {
  it("drafts a request, shows what they will see, and removes it with Undo", () => {
    withToasts(<AdminRequestsPage now={NOW} />);
    fireEvent.click(screen.getByTestId("admin-requests-new"));
    const sheet = screen.getByTestId("admin-requests-sheet");
    fireEvent.change(within(sheet).getByTestId("admin-requests-title"), { target: { value: "Manual handling" } });
    fireEvent.change(within(sheet).getByTestId("admin-requests-due"), { target: { value: "2026-10-18" } });
    fireEvent.change(within(sheet).getByTestId("admin-requests-asked-for"), { target: { value: "2026-11-06" } });
    expect(within(sheet).getByTestId("admin-requests-preview").textContent).toContain("18 Oct 2026 to 6 Nov 2026");
    fireEvent.click(within(sheet).getByTestId("admin-requests-sheet-save"));
    expect(screen.getAllByTestId("admin-requests-card")).toHaveLength(1);
    expect((stored()?.requests as unknown[]).length).toBe(1);
    fireEvent.click(screen.getByTestId("admin-requests-remove"));
    expect((stored()?.requests as unknown[]).length).toBe(0);
    const toast = screen.getByText("Request removed").closest(".app-toast") as HTMLElement;
    fireEvent.click(within(toast).getByRole("button", { name: "Undo" }));
    expect((stored()?.requests as unknown[]).length).toBe(1);
  });

  it("sends a health reason to Staff Health only", () => {
    withToasts(<AdminRequestsPage now={NOW} />);
    fireEvent.click(screen.getByTestId("admin-requests-new"));
    fireEvent.click(screen.getByTestId("admin-requests-reason-health-reason"));
    expect((screen.getByTestId("admin-requests-to") as HTMLInputElement).value).toBe("Staff Health");
    expect(screen.getByTestId("admin-requests-health-line")).toBeTruthy();
  });

  it("will not save a note with patient details", () => {
    withToasts(<AdminRequestsPage now={NOW} />);
    fireEvent.click(screen.getByTestId("admin-requests-new"));
    fireEvent.change(screen.getByTestId("admin-requests-title"), { target: { value: "Leave form" } });
    fireEvent.change(screen.getByTestId("admin-requests-asked-for"), { target: { value: "2026-11-06" } });
    fireEvent.change(screen.getByTestId("admin-requests-note"), { target: { value: "Mr Smith, 45M, bed 12" } });
    expect(screen.getByTestId("admin-requests-note-patient")).toBeTruthy();
    fireEvent.click(screen.getByTestId("admin-requests-sheet-save"));
    expect(stored()).toBeNull();
  });

  it("is removed from the device at an account change", () => {
    withToasts(<AdminRequestsPage now={NOW} />);
    fireEvent.click(screen.getByTestId("admin-requests-new"));
    fireEvent.change(screen.getByTestId("admin-requests-title"), { target: { value: "Fire training" } });
    fireEvent.change(screen.getByTestId("admin-requests-asked-for"), { target: { value: "2026-11-06" } });
    fireEvent.click(screen.getByTestId("admin-requests-sheet-save"));
    expect(stored()).not.toBeNull();
    act(() => {
      window.dispatchEvent(new Event(ACCOUNT_TRANSITION_EVENT));
    });
    expect(window.localStorage.getItem(ADMIN_PAPERWORK_STORAGE_KEY)).toBeNull();
    expect(screen.queryAllByTestId("admin-requests-card")).toHaveLength(0);
  });
});

describe("Admin Documents", () => {
  it("adds a document with where it is kept, never a file", () => {
    withToasts(<AdminDocumentsPage now={NOW} />);
    expect(screen.getByTestId("admin-documents-empty")).toBeTruthy();
    fireEvent.click(screen.getByTestId("admin-documents-add"));
    fireEvent.change(screen.getByTestId("admin-documents-title"), { target: { value: "Employment contract" } });
    fireEvent.click(screen.getByTestId("admin-documents-folder-chip-contracts"));
    fireEvent.change(screen.getByTestId("admin-documents-kept"), { target: { value: "OneDrive" } });
    fireEvent.click(screen.getByTestId("admin-documents-save"));
    expect(screen.getByTestId("admin-documents-folder-contracts").textContent).toContain("Kept in OneDrive");
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });
});

describe("Admin Pay", () => {
  it("checks a payslip against the roster and says the hours differ", () => {
    withToasts(<AdminPayPage now={NOW} />);
    fireEvent.click(screen.getByTestId("admin-pay-check"));
    fireEvent.change(screen.getByTestId("admin-pay-ordinary"), { target: { value: "72" } });
    fireEvent.change(screen.getByTestId("admin-pay-rostered"), { target: { value: "80" } });
    expect(screen.getByTestId("admin-pay-preview").textContent).toContain("8 h fewer");
    fireEvent.click(screen.getByTestId("admin-pay-save"));
    expect(screen.getByTestId("admin-pay-latest").textContent).toContain("Hours differ");
    expect(screen.getByTestId("admin-pay-latest").textContent).not.toMatch(/\$/);
  });

  it("offers a retry and a typed check when the roster does not load", () => {
    roster.status = "error";
    withToasts(<AdminPayPage now={NOW} />);
    expect(screen.getByTestId("admin-pay-roster-failed").textContent).toContain("Try again");
    expect(screen.getByTestId("admin-pay-check")).toBeTruthy();
  });

  it("links to the WA Health agreement for rates instead of showing any", () => {
    withToasts(<AdminPayPage now={NOW} />);
    expect(screen.getByTestId("admin-pay-agreement-link").getAttribute("href")).toMatch(
      /^https:\/\/www\.health\.wa\.gov\.au\//,
    );
    expect(screen.getByTestId("admin-pay").textContent).not.toMatch(/\$\d/);
  });
});

describe("Admin Tax", () => {
  it("ticks the checklist and adds an expense, with totals only from what was typed", () => {
    withToasts(<AdminTaxPage now={NOW} />);
    fireEvent.click(screen.getByTestId("admin-tax-tick-income-statement"));
    expect(screen.getByTestId("admin-tax-tick-income-statement").getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByTestId("admin-tax-add"));
    fireEvent.change(screen.getByTestId("admin-tax-title"), { target: { value: "College fee" } });
    fireEvent.change(screen.getByTestId("admin-tax-amount"), { target: { value: "146.50" } });
    fireEvent.click(screen.getByTestId("admin-tax-save"));
    expect(screen.getByTestId("admin-tax-total").textContent).toContain("$146.50");
    for (const link of within(screen.getByTestId("admin-tax-ato")).getAllByRole("link")) {
      expect(link.getAttribute("href")).toMatch(/^https:\/\/www\.ato\.gov\.au\//);
    }
  });
});

describe("Admin Workforce", () => {
  it("opens on a plain explanation with a link back, and the example only behind the example-only gate", async () => {
    withToasts(<AdminWorkforcePage />);
    expect(screen.getByTestId("admin-workforce-gate").textContent).toContain("It is not live");
    expect(screen.getByTestId("admin-workforce-back").getAttribute("href")).toBe("/admin");
    expect(screen.getByTestId("example-only-gate").textContent).toContain("Workforce is not connected yet");
    expect(screen.queryByTestId("admin-workforce-sample-label")).toBeNull();
    act(() => screen.getByTestId("example-only-gate-look").click());
    expect((await screen.findByTestId("admin-workforce-sample-label")).textContent).toContain(
      "Sample, not your hospital's data",
    );
    expect(screen.queryByTestId("admin-workforce-export")).toBeNull();
    expect(screen.getByTestId("admin-workforce").textContent).not.toMatch(/Dr Josh|Ward 4/);
  });

  it("decides an extension in memory with Undo, and writes nothing", async () => {
    storeState.signedOut = true;
    withToasts(<AdminWorkforcePage />);
    fireEvent.click(await screen.findByTestId("admin-workforce-view-extensions"));
    expect(screen.getAllByTestId("admin-workforce-extension")).toHaveLength(3);
    fireEvent.click(screen.getAllByTestId("admin-workforce-grant")[0]!);
    expect(screen.getAllByTestId("admin-workforce-extension")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getAllByTestId("admin-workforce-extension")).toHaveLength(3);
    // The example data switch's own record is the only thing on the device, never a decision.
    expect(Object.keys(window.localStorage).filter((key) => !key.includes("example"))).toEqual([]);
  });
});

describe("Admin work screens keep device storage in one module", () => {
  it("touches localStorage only in the paperwork store", () => {
    const roots = ["src/components/work-screens/admin", "src/lib/work-screens/admin"];
    const files = roots.flatMap(function walk(root: string): string[] {
      return readdirSync(root).flatMap((name) => {
        const path = join(root, name);
        return statSync(path).isDirectory() ? walk(path) : /\.tsx?$/.test(name) ? [path] : [];
      });
    });
    const offenders = files.filter(
      (file) =>
        !file.endsWith("paperwork-store.ts") &&
        /\b(?:localStorage|sessionStorage|indexedDB)\b/.test(readFileSync(file, "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});

describe("Adversarial review fixes", () => {
  function newRequest(title: string, note = "") {
    fireEvent.click(screen.getByTestId("admin-requests-new"));
    const sheet = screen.getByTestId("admin-requests-sheet");
    fireEvent.change(within(sheet).getByTestId("admin-requests-title"), { target: { value: title } });
    fireEvent.change(within(sheet).getByTestId("admin-requests-asked-for"), { target: { value: "2026-11-06" } });
    if (note) fireEvent.change(within(sheet).getByTestId("admin-requests-note"), { target: { value: note } });
    fireEvent.click(within(sheet).getByTestId("admin-requests-sheet-save"));
  }

  it("will not send a health reason to Medical Workforce, even when the To field is changed back", () => {
    withToasts(<AdminRequestsPage now={NOW} />);
    fireEvent.click(screen.getByTestId("admin-requests-new"));
    fireEvent.change(screen.getByTestId("admin-requests-title"), { target: { value: "Fit test" } });
    fireEvent.change(screen.getByTestId("admin-requests-asked-for"), { target: { value: "2026-11-06" } });
    fireEvent.change(screen.getByTestId("admin-requests-email-address"), { target: { value: "mw@health.example" } });
    fireEvent.click(screen.getByTestId("admin-requests-reason-health-reason"));
    expect((screen.getByTestId("admin-requests-email-address") as HTMLInputElement).value).toBe("");
    fireEvent.change(screen.getByTestId("admin-requests-to"), { target: { value: "Medical Workforce" } });
    expect(screen.getByTestId("admin-requests-sheet").textContent).toContain(
      "A health reason goes to Staff Health only.",
    );
    fireEvent.click(screen.getByTestId("admin-requests-sheet-save"));
    expect(stored()).toBeNull();
  });

  it("keeps the note when a draft is edited", () => {
    withToasts(<AdminRequestsPage now={NOW} />);
    newRequest("Manual handling", "Booked for the next course");
    fireEvent.click(screen.getByTestId("admin-requests-edit"));
    expect((screen.getByTestId("admin-requests-note") as HTMLTextAreaElement).value).toBe("Booked for the next course");
    fireEvent.click(screen.getByTestId("admin-requests-sheet-save"));
    const saved = (stored()?.requests as { message: string }[])[0]!;
    expect(saved.message).toContain("Booked for the next course");
  });

  it("Undo of a removal puts that request back without dropping one added since", () => {
    withToasts(<AdminRequestsPage now={NOW} />);
    newRequest("First");
    fireEvent.click(screen.getByTestId("admin-requests-remove"));
    newRequest("Second");
    const toast = screen.getByText("Request removed").closest(".app-toast") as HTMLElement;
    fireEvent.click(within(toast).getByRole("button", { name: "Undo" }));
    expect((stored()?.requests as { title: string }[]).map((request) => request.title).sort()).toEqual([
      "First",
      "Second",
    ]);
  });

  it("copies a request once on a double tap", async () => {
    withToasts(<AdminRequestsPage now={NOW} />);
    newRequest("Manual handling");
    const copy = screen.getByTestId("admin-requests-copy");
    await act(async () => {
      fireEvent.click(copy);
      fireEvent.click(copy);
    });
    expect(clipboard.copy).toHaveBeenCalledTimes(1);
    expect((stored()?.requests as { status: string }[])[0]!.status).toBe("sent");
  });

  it("copies nothing from the signed-out sample pack, and notes no send", async () => {
    storeState.signedOut = true;
    const blocked: string[] = [];
    const listen = (event: Event) => blocked.push(String((event as CustomEvent).detail));
    window.addEventListener(EXAMPLE_BLOCKED_EVENT, listen);
    withToasts(<AdminSharingPage now={NOW} />);
    const copy = await screen.findByTestId("admin-sharing-workforce-copy");
    const logRows = screen.queryAllByTestId("admin-sharing-log-row").length;
    await act(async () => {
      fireEvent.click(copy);
    });
    window.removeEventListener(EXAMPLE_BLOCKED_EVENT, listen);
    expect(clipboard.copy).not.toHaveBeenCalled();
    // The example data banner explains, so the page adds no toast of its own.
    expect(blocked).toEqual(["copy"]);
    expect(screen.queryByText(/This is an example, so nothing was copied, sent or saved/)).toBeNull();
    expect(screen.queryAllByTestId("admin-sharing-log-row")).toHaveLength(logRows);
  });

  it("will not copy a pack whose renewal issuer looks like a patient detail", async () => {
    storeState.entries = [
      complianceFixture(
        "Medical registration renewal",
        {
          category: "Registration",
          expiresOn: "2027-09-30",
          requirementId: "medical-registration-renewal",
          issuingBody: "Pt John Smith",
        },
        { isOwn: true },
      ),
    ];
    withToasts(<AdminSharingPage now={NOW} />);
    fireEvent.click(screen.getByTestId("admin-sharing-switch-registration"));
    await act(async () => {
      fireEvent.click(screen.getByTestId("admin-sharing-workforce-copy"));
    });
    expect(clipboard.copy).not.toHaveBeenCalled();
    expect(screen.getAllByText(/Nothing was copied or sent/).length).toBeGreaterThan(0);
  });

  it("keeps a change on screen and says so when the phone refuses to save", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    withToasts(<AdminDocumentsPage now={NOW} />);
    fireEvent.click(screen.getByTestId("admin-documents-add"));
    fireEvent.change(screen.getByTestId("admin-documents-title"), { target: { value: "Employment contract" } });
    fireEvent.click(screen.getByTestId("admin-documents-save"));
    expect(screen.getAllByTestId("admin-documents-row")).toHaveLength(1);
    expect(screen.getByTestId("admin-documents-storage").textContent).toContain("last only until you close this page");
  });

  it("opens the doctor's own link for a document", () => {
    withToasts(<AdminDocumentsPage now={NOW} />);
    fireEvent.click(screen.getByTestId("admin-documents-add"));
    fireEvent.change(screen.getByTestId("admin-documents-title"), { target: { value: "Contract" } });
    fireEvent.change(screen.getByTestId("admin-documents-url"), {
      target: { value: "https://drive.example/contract" },
    });
    fireEvent.click(screen.getByTestId("admin-documents-save"));
    fireEvent.click(screen.getByTestId("admin-documents-row"));
    const link = screen.getByTestId("admin-documents-open-link");
    expect(link.getAttribute("href")).toBe("https://drive.example/contract");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("refuses an amount with a comma as the decimal point", () => {
    withToasts(<AdminTaxPage now={NOW} />);
    fireEvent.click(screen.getByTestId("admin-tax-add"));
    fireEvent.change(screen.getByTestId("admin-tax-title"), { target: { value: "College fee" } });
    fireEvent.change(screen.getByTestId("admin-tax-amount"), { target: { value: "12,50" } });
    fireEvent.click(screen.getByTestId("admin-tax-save"));
    expect(screen.getByTestId("admin-tax-sheet").textContent).toContain("Type the amount");
    expect(stored()).toBeNull();
  });

  it("uses flat row buttons, never glass, inside cards", () => {
    withToasts(<AdminTaxPage now={NOW} />);
    fireEvent.click(screen.getByTestId("admin-tax-add"));
    fireEvent.change(screen.getByTestId("admin-tax-title"), { target: { value: "Textbook" } });
    fireEvent.change(screen.getByTestId("admin-tax-amount"), { target: { value: "25" } });
    fireEvent.click(screen.getByTestId("admin-tax-save"));
    expect(screen.getByTestId("admin-tax-remove").className).not.toContain("work-glass-button");
  });
});
