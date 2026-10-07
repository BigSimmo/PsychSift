/**
 * @vitest-environment jsdom
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApplicationsEntryLink } from "@/components/cme/applications/applications-entry-link";
import { ApplicationsPage } from "@/components/cme/applications/applications-page";
import { ApplicationsTodayCard } from "@/components/cme/applications/applications-today-card";
import { ToastProvider } from "@/components/ui/toast";
import { CPD_APPLICATIONS_STORAGE_KEY, CPD_HOME_SEND_STORAGE_KEY } from "@/lib/account-scoped-browser-state";
import { setSharedDevice } from "@/lib/alerts/shared-device";
import * as clipboard from "@/lib/copy-to-clipboard";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/cme/applications",
  useSearchParams: () => new URLSearchParams(),
}));

const now = new Date("2026-10-06T05:00:00Z");

function stored() {
  return JSON.parse(localStorage.getItem(CPD_APPLICATIONS_STORAGE_KEY) ?? "null");
}

function renderPage(demoMode = false) {
  return render(
    <ToastProvider>
      <ApplicationsPage demoMode={demoMode} now={now} />
    </ToastProvider>,
  );
}

function type(testId: string, value: string) {
  fireEvent.change(screen.getByTestId(testId), { target: { value } });
}

// The work-mode kit's buttons and label links take their 48px height from work-mode.css
// (`--spacing-tap`), not a utility class (work-mode redesign, owner request 6 Oct 2026).
const TAP = /\b(?:min-h-(?:12|13|tap)|size-(?:12|tap)|work-button|work-label__link)\b/;

describe("Job applications season", () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    setSharedDevice(false);
    vi.restoreAllMocks();
  });

  it("starts empty and honest: every stage without a date, and dates not checked", () => {
    renderPage();
    expect(screen.getByTestId("applications-empty").textContent).toContain("Plan your application season");
    expect(screen.getByTestId("applications-dates-not-checked").textContent).toContain(
      "WA recruitment dates are not confirmed",
    );
    expect(screen.getByTestId("applications-dates-not-checked").textContent).toContain("Source pending");
    expect(screen.getByTestId("applications-rail").getAttribute("aria-label")).toBe(
      "Application season, 0 of 5 dates added",
    );
    expect(screen.getAllByText("Date to be confirmed")).toHaveLength(5);
    expect(screen.getByTestId("applications-referee-add-row")).toBeTruthy();
  });

  it("adds a date from the advert, counts down to it, and undoes", () => {
    renderPage();
    fireEvent.click(screen.getByTestId("applications-first-date"));
    const sheet = screen.getByTestId("applications-date-sheet");
    expect(within(sheet).getByTestId("applications-date-stage-close").getAttribute("aria-checked")).toBe("true");
    fireEvent.change(within(sheet).getByLabelText(/^Date/), { target: { value: "30/10/2026" } });
    fireEvent.blur(within(sheet).getByLabelText(/^Date/));
    type("applications-date-source", "Hospital advert");
    fireEvent.click(within(sheet).getByTestId("applications-date-save"));
    expect(stored().dates).toMatchObject([
      { stage: "close", on: "2026-10-30", source: "Hospital advert", remind: true },
    ]);
    expect(screen.getByTestId("applications-rail-today").textContent).toContain("24 days to applications close");
    expect(screen.getByText("Added by you, from Hospital advert")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(stored().dates).toEqual([]);
  });

  it("refuses a patient detail in the source and keeps Save off", () => {
    renderPage();
    fireEvent.click(screen.getByTestId("applications-add-date"));
    fireEvent.change(screen.getByLabelText(/^Date/), { target: { value: "30/10/2026" } });
    fireEvent.blur(screen.getByLabelText(/^Date/));
    type("applications-date-source", "Mrs Smith URN 1234567");
    expect(screen.getByTestId("applications-date-problem").textContent).toContain("This looks like a patient detail");
    fireEvent.click(screen.getByTestId("applications-date-save"));
    expect(stored()).toBeNull();
  });

  it("asks for the date before saving", () => {
    renderPage();
    fireEvent.click(screen.getByTestId("applications-add-date"));
    fireEvent.click(screen.getByTestId("applications-date-save"));
    expect(screen.getByText("Add the date from the advert.")).toBeTruthy();
    expect(stored()).toBeNull();
  });

  it("tracks a referee: add, change status with Undo, then remove", () => {
    renderPage();
    fireEvent.click(screen.getByTestId("applications-add-referee"));
    type("applications-referee-name", "Dr Grant");
    type("applications-referee-role", "Consultant, Example Hospital");
    fireEvent.click(screen.getByTestId("applications-referee-status-asked"));
    fireEvent.click(screen.getByTestId("applications-referee-save"));
    expect(stored().referees).toMatchObject([{ name: "Dr Grant", status: "asked" }]);
    fireEvent.click(screen.getByTestId("applications-referee"));
    fireEvent.click(screen.getByTestId("applications-referee-status-agreed"));
    fireEvent.click(screen.getByTestId("applications-referee-save"));
    expect(stored().referees[0].status).toBe("agreed");
    expect(screen.getByText("Dr Grant marked Agreed")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(stored().referees[0].status).toBe("asked");
    fireEvent.click(screen.getByTestId("applications-referee"));
    fireEvent.click(screen.getByTestId("applications-referee-remove"));
    expect(stored().referees).toEqual([]);
  });

  it("refuses digits in a referee's name", () => {
    renderPage();
    fireEvent.click(screen.getByTestId("applications-add-referee"));
    type("applications-referee-name", "Dr Grant 0412345678");
    expect(screen.getByTestId("applications-referee-name-problem").textContent).toContain("A name has no numbers");
    fireEvent.click(screen.getByTestId("applications-referee-save"));
    expect(stored()).toBeNull();
  });

  it("raises a quiet referee and copies a polite nudge", async () => {
    localStorage.setItem(
      CPD_APPLICATIONS_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        dates: [],
        referees: [
          {
            id: "r1",
            name: "Dr Grant",
            role: "",
            status: "asked",
            history: [{ kind: "status", status: "asked", on: "2026-10-01" }],
          },
        ],
        statement: "",
        hiddenCvLines: [],
      }),
    );
    const copy = vi.spyOn(clipboard, "copyTextToClipboard").mockResolvedValue();
    renderPage();
    expect(screen.getByTestId("applications-quiet").textContent).toContain("Dr Grant has not replied");
    fireEvent.click(screen.getByTestId("applications-nudge-open"));
    expect(screen.getByTestId("applications-referee-waiting").textContent).toBe("No reply yet5 days");
    await act(async () => {
      fireEvent.click(screen.getByTestId("applications-nudge-copy"));
    });
    expect(copy).toHaveBeenCalledWith(expect.stringContaining("Hi Dr Grant, just checking"));
    expect(stored().referees[0].history.at(-1)).toEqual({ kind: "nudge", on: "2026-10-06" });
  });

  it("builds the nudge from the saved name, never from a name being typed", async () => {
    localStorage.setItem(
      CPD_APPLICATIONS_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        dates: [],
        referees: [
          {
            id: "r1",
            name: "Dr Grant",
            role: "",
            status: "asked",
            history: [{ kind: "status", status: "asked", on: "2026-10-01" }],
          },
        ],
        statement: "",
        hiddenCvLines: [],
      }),
    );
    const copy = vi.spyOn(clipboard, "copyTextToClipboard").mockResolvedValue();
    renderPage();
    fireEvent.click(screen.getByTestId("applications-nudge-open"));
    fireEvent.change(screen.getByTestId("applications-referee-name"), { target: { value: "Mr Smith 45M" } });
    expect(screen.getByTestId("applications-nudge").textContent).toContain("Hi Dr Grant,");
    expect(screen.getByTestId("applications-nudge").textContent).not.toContain("Smith");
    await act(async () => {
      fireEvent.click(screen.getByTestId("applications-nudge-copy"));
    });
    expect(copy).toHaveBeenCalledWith(expect.not.stringContaining("Smith"));
  });

  it("Undo reverses only its own change, keeping a nudge copied since", async () => {
    localStorage.setItem(
      CPD_APPLICATIONS_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        dates: [],
        referees: [
          { id: "r1", name: "Dr Moss", role: "", status: "not-asked", history: [] },
          {
            id: "r2",
            name: "Dr Grant",
            role: "",
            status: "asked",
            history: [{ kind: "status", status: "asked", on: "2026-10-01" }],
          },
        ],
        statement: "",
        hiddenCvLines: [],
      }),
    );
    vi.spyOn(clipboard, "copyTextToClipboard").mockResolvedValue();
    renderPage();
    fireEvent.click(screen.getAllByTestId("applications-referee")[0]!);
    fireEvent.click(screen.getByTestId("applications-referee-status-asked"));
    fireEvent.click(screen.getByTestId("applications-referee-save"));
    expect(stored().referees[0].status).toBe("asked");
    fireEvent.click(screen.getByTestId("applications-nudge-open"));
    await act(async () => {
      fireEvent.click(screen.getByTestId("applications-nudge-copy"));
    });
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(stored().referees[0]).toMatchObject({ status: "not-asked", history: [] });
    expect(stored().referees[1].history.at(-1)).toEqual({ kind: "nudge", on: "2026-10-06" });
  });

  it("never guesses the season year, and says the reminder shows in Notifications", () => {
    renderPage();
    expect(screen.getByTestId("applications-no-start").textContent).toContain("Add a start date");
    expect(document.body.textContent).not.toMatch(/Season 2027/);
    fireEvent.click(screen.getByTestId("applications-add-date"));
    const sheet = screen.getByTestId("applications-date-sheet");
    expect(sheet.textContent).toContain("Shows in Notifications from 1 week before until the day.");
    expect(sheet.textContent).not.toContain("buzz or email you, so open");
  });

  it("removes the saved applications and CPD Home records when the device is marked shared", () => {
    localStorage.setItem(CPD_APPLICATIONS_STORAGE_KEY, JSON.stringify({ version: 1 }));
    localStorage.setItem(CPD_HOME_SEND_STORAGE_KEY, JSON.stringify({ version: 1, files: [] }));
    renderPage();
    act(() => setSharedDevice(true));
    expect(localStorage.getItem(CPD_APPLICATIONS_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(CPD_HOME_SEND_STORAGE_KEY)).toBeNull();
    // Turning the switch off does not bring them back.
    act(() => setSharedDevice(false));
    expect(localStorage.getItem(CPD_APPLICATIONS_STORAGE_KEY)).toBeNull();
  });

  it("goes back to the CPD summary, where its link lives", () => {
    renderPage();
    expect(screen.getByTestId("cpd-feature-back").getAttribute("href")).toBe("/cme/summary");
  });

  it("shows the made-up sample in the demo build and keeps nothing", () => {
    renderPage(true);
    expect(screen.getByTestId("applications-mode-note").textContent).toContain("Sample season");
    expect(screen.getAllByTestId("applications-referee")).toHaveLength(3);
    fireEvent.click(screen.getAllByTestId("applications-referee")[2]!);
    fireEvent.click(screen.getByTestId("applications-referee-remove"));
    expect(screen.getAllByTestId("applications-referee")).toHaveLength(2);
    expect(stored()).toBeNull();
  });

  it("keeps nothing on a device marked shared", () => {
    setSharedDevice(true);
    renderPage();
    expect(screen.getByTestId("applications-mode-note").textContent).toContain("shared device");
    fireEvent.click(screen.getByTestId("applications-add-referee"));
    type("applications-referee-name", "Dr Grant");
    fireEvent.click(screen.getByTestId("applications-referee-save"));
    expect(screen.getAllByTestId("applications-referee")).toHaveLength(1);
    expect(stored()).toBeNull();
  });

  it("says when this browser is not keeping changes, instead of Kept on this phone", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("refused", "SecurityError");
    });
    renderPage();
    expect(screen.getByTestId("applications-mode-note").textContent).toBe(
      "This browser is not keeping changes. They last until you leave the page.",
    );
    expect(screen.getByTestId("applications-kept-note").textContent).not.toContain("Kept on this phone");
  });

  it("links to the CV and to support, and every control has a 48px tap target", () => {
    const { container } = renderPage();
    expect(screen.getByTestId("applications-cv-link").getAttribute("href")).toBe("/cme/applications/cv");
    expect(screen.getByTestId("applications-support-link").getAttribute("href")).toBe("/admin/help");
    const short = [...container.querySelectorAll<HTMLElement>("button, a[href]")].filter(
      (node) => !TAP.test(node.className),
    );
    expect(short.map((node) => node.outerHTML.slice(0, 80))).toEqual([]);
  });

  it("exports an entry link and a Today card that shows the next date", () => {
    localStorage.setItem(
      CPD_APPLICATIONS_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        dates: [{ stage: "close", on: "2026-10-09", time: "", source: "", remind: true, addedOn: "2026-10-01" }],
        referees: [],
        statement: "",
        hiddenCvLines: [],
      }),
    );
    render(
      <>
        <ApplicationsEntryLink />
        <ApplicationsTodayCard today="2026-10-06" />
      </>,
    );
    expect(screen.getByTestId("applications-entry-link").getAttribute("href")).toBe("/cme/applications");
    expect(screen.getByTestId("applications-today-card").textContent).toContain("3 days to applications close");
  });
});
