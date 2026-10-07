/** @vitest-environment jsdom */

// Set up Work (`/my-day/setup`): the welcome step, Continue and Skip moving on
// through the address, Back walking back with replace, a deep link to a hidden
// step bringing its area back, the step position counting only visible steps,
// the done step, and the signed-out welcome asking the doctor to sign in.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({
  params: new URLSearchParams(),
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/my-day/setup",
  useRouter: () => ({ push: nav.push, replace: nav.replace, back: nav.back, prefetch: vi.fn() }),
  useSearchParams: () => nav.params,
}));

const auth = vi.hoisted(() => ({ status: "authenticated", authEpoch: 1 }));
vi.mock("@/lib/supabase/client", () => ({ useAuthSession: () => auth }));

vi.mock("@/components/clinical-dashboard/account-setup-dialog", () => ({
  AccountSetupDialog: ({ open }: { open: boolean }) => (open ? <div data-testid="account-dialog" /> : null),
}));

vi.mock("@/components/clinical-dashboard/use-app-preferences", () => ({
  useAppPreferences: () => ({ preferences: { workStage: null, ranzcpStage: null }, setPreference: vi.fn() }),
}));

// The area status rows read Work profile's data; keep every read "still loading"
// so nothing here reaches the network.
vi.mock("@/components/work-profile/use-work-profile-data", () => ({
  useWorkProfileData: () => ({
    roster: { status: "loading" },
    workplaces: { status: "loading" },
    teams: { status: "loading" },
    teaching: { status: "loading" },
    cpd: { status: "loading" },
    admin: { status: "loading" },
    hospitalPhone: false,
    payFortnightAnchor: { status: "loading" },
  }),
}));

import { universalHeaderLeadingSlotId } from "@/components/work-frame/work-frame-header";
import { WorkSetupPage } from "@/components/work-setup/work-setup-page";
import { WORK_SETUP_STEP_COPY, workSetupStepHref } from "@/components/work-setup/work-setup-copy";
import { WorkSetupPromptCard } from "@/components/work-setup/work-setup-prompt-card";
import { WORK_SETUP_PROGRESS_STORAGE_KEY } from "@/lib/account-scoped-browser-state";
import {
  parseWorkSetupProgress,
  serialiseWorkSetupProgress,
  type WorkSetupProgress,
  type WorkSetupStepId,
} from "@/lib/work-setup/progress";

function stored(): WorkSetupProgress {
  return parseWorkSetupProgress(window.localStorage.getItem(WORK_SETUP_PROGRESS_STORAGE_KEY));
}

function seed(progress: Partial<WorkSetupProgress>) {
  window.localStorage.setItem(
    WORK_SETUP_PROGRESS_STORAGE_KEY,
    serialiseWorkSetupProgress({
      status: "in-progress",
      step: "welcome",
      areas: ["rost", "teach", "assess", "cpd", "admin", "call"],
      completed: [],
      skipped: [],
      ...progress,
    }),
  );
}

function atStep(step: WorkSetupStepId | null, extra: Record<string, string> = {}) {
  nav.params = new URLSearchParams(step ? { step, ...extra } : extra);
}

beforeEach(() => {
  // Back is drawn into the top bar's left slot, which the work frame provides.
  document.getElementById(universalHeaderLeadingSlotId)?.remove();
  const slot = document.createElement("div");
  slot.id = universalHeaderLeadingSlotId;
  document.body.appendChild(slot);
  window.localStorage.clear();
  nav.push.mockReset();
  nav.replace.mockReset();
  nav.back.mockReset();
  atStep(null);
  auth.status = "authenticated";
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => true });
});

describe("welcome", () => {
  it('shows the "Set up Work" heading and Start, and no step position or Back', () => {
    render(<WorkSetupPage />);
    expect(screen.getByRole("heading", { level: 1, name: WORK_SETUP_STEP_COPY["welcome"].title })).toBeInTheDocument();
    expect(screen.getByTestId("work-setup-start")).toHaveTextContent("Start");
    expect(screen.queryByText(/^Step \d+ of \d+$/)).not.toBeInTheDocument();
    expect(screen.queryByTestId("work-setup-signed-out")).not.toBeInTheDocument();
  });

  it("Back on welcome leaves for My Day", () => {
    render(<WorkSetupPage />);
    expect(screen.queryByRole("button", { name: "Previous step" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back to My Day" }));
    expect(nav.push).toHaveBeenCalledWith("/my-day");
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("Start moves to the first step", () => {
    render(<WorkSetupPage />);
    fireEvent.click(screen.getByTestId("work-setup-start"));
    expect(nav.push).toHaveBeenCalledWith(workSetupStepHref("stage"), { scroll: false });
    expect(stored().step).toBe("stage");
    expect(stored().status).toBe("in-progress");
  });

  it("says Carry on once a step has been finished", () => {
    seed({ completed: ["stage"] });
    atStep("welcome");
    render(<WorkSetupPage />);
    expect(screen.getByTestId("work-setup-start")).toHaveTextContent("Carry on");
  });

  it("Not now puts setup away and goes to My Day", () => {
    render(<WorkSetupPage />);
    fireEvent.click(screen.getByTestId("work-setup-not-now"));
    expect(stored().status).toBe("dismissed");
    expect(nav.push).toHaveBeenCalledWith("/my-day");
  });

  it("signed out, shows the sign-in card, which opens sign-in", () => {
    auth.status = "signed_out";
    render(<WorkSetupPage />);
    const card = screen.getByTestId("work-setup-signed-out");
    expect(card).toHaveTextContent("Sign in to save your setup");
    fireEvent.click(screen.getByRole("button", { name: /Sign in to save your setup/ }));
    expect(screen.getByTestId("account-dialog")).toBeInTheDocument();
  });
});

describe("moving through the steps", () => {
  it("Continue marks the step done and pushes the next step's address", () => {
    atStep("stage");
    render(<WorkSetupPage />);
    expect(screen.getByRole("heading", { level: 1, name: WORK_SETUP_STEP_COPY["stage"].title })).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("work-setup-continue"));
    expect(nav.push).toHaveBeenCalledWith(workSetupStepHref("areas"), { scroll: false });
    expect(stored().completed).toEqual(["stage"]);
  });

  it("Skip marks the step skipped and pushes the next step's address", () => {
    atStep("time-zone");
    render(<WorkSetupPage />);
    fireEvent.click(screen.getByTestId("work-setup-skip"));
    expect(nav.push).toHaveBeenCalledWith(workSetupStepHref("roster"), { scroll: false });
    expect(stored().skipped).toEqual(["time-zone"]);
    expect(stored().completed).toEqual([]);
  });

  it("Continue past a hidden step goes to the next visible one", () => {
    seed({ areas: ["teach"] });
    atStep("time-zone");
    render(<WorkSetupPage />);
    fireEvent.click(screen.getByTestId("work-setup-continue"));
    expect(nav.push).toHaveBeenCalledWith(workSetupStepHref("rotation"), { scroll: false });
  });

  it("Back on the first framed step replaces with the welcome step", () => {
    atStep("stage");
    render(<WorkSetupPage />);
    fireEvent.click(screen.getByRole("button", { name: "Previous step" }));
    expect(nav.replace).toHaveBeenCalledWith(workSetupStepHref("welcome"), { scroll: false });
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("Back on a later step replaces with the step before it", () => {
    seed({ areas: ["teach"] });
    atStep("rotation");
    render(<WorkSetupPage />);
    fireEvent.click(screen.getByTestId("work-setup-back"));
    expect(nav.replace).toHaveBeenCalledWith(workSetupStepHref("time-zone"), { scroll: false });
  });

  it("Back after a step opened on this visit goes back through history", () => {
    atStep("stage");
    render(<WorkSetupPage />);
    fireEvent.click(screen.getByTestId("work-setup-continue"));
    fireEvent.click(screen.getByTestId("work-setup-back"));
    expect(nav.back).toHaveBeenCalledTimes(1);
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("merely viewing a step from its address does not rewrite the stored place", async () => {
    seed({ step: "stage" });
    atStep("alerts");
    render(<WorkSetupPage />);
    expect(screen.getByRole("heading", { level: 1, name: WORK_SETUP_STEP_COPY["alerts"].title })).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(stored().step).toBe("stage");
  });
});

describe("step position", () => {
  it("counts only the steps this doctor will see", () => {
    seed({ areas: ["teach"] });
    atStep("rotation");
    render(<WorkSetupPage />);
    // stage, areas, time-zone, rotation, alerts
    expect(screen.getByTestId("work-setup-position")).toHaveTextContent("Step 4 of 5");
  });

  it("counts every step when every area is chosen", () => {
    atStep("alerts");
    render(<WorkSetupPage />);
    expect(screen.getByTestId("work-setup-position")).toHaveTextContent("Step 7 of 7");
  });

  it("a deep link to the roster step brings Roster back into the doctor's areas", async () => {
    seed({ areas: ["teach"] });
    atStep("roster");
    render(<WorkSetupPage />);
    await waitFor(() => expect(stored().areas).toContain("rost"));
    expect(stored().areas).toEqual(["rost", "teach"]);
    // stage, areas, time-zone, roster, rotation, alerts
    expect(screen.getByTestId("work-setup-position")).toHaveTextContent("Step 4 of 6");
    expect(screen.getByRole("heading", { level: 1, name: WORK_SETUP_STEP_COPY["roster"].title })).toBeInTheDocument();
  });

  it("a deep link to other areas that names an area brings that one area back", async () => {
    seed({ areas: ["rost"] });
    atStep("other-areas", { area: "cpd" });
    render(<WorkSetupPage />);
    await waitFor(() => expect(stored().areas).toEqual(["rost", "cpd"]));
    expect(
      screen.getByRole("heading", { level: 1, name: WORK_SETUP_STEP_COPY["other-areas"].title }),
    ).toBeInTheDocument();
  });

  it("a deep link to hidden other areas without an area shows where the doctor got to", () => {
    seed({ areas: ["rost"], step: "rotation" });
    atStep("other-areas");
    render(<WorkSetupPage />);
    expect(screen.getByRole("heading", { level: 1, name: WORK_SETUP_STEP_COPY["rotation"].title })).toBeInTheDocument();
    expect(stored().areas).toEqual(["rost"]);
  });
});

describe("done", () => {
  it('shows "Go to My Day" and the summary of every step', () => {
    seed({ status: "done", step: "done", completed: ["stage"], skipped: ["areas"] });
    atStep("done");
    render(<WorkSetupPage />);
    expect(screen.getByRole("heading", { level: 1, name: WORK_SETUP_STEP_COPY["done"].title })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to My Day" })).toHaveAttribute("href", "/my-day");
    expect(screen.queryByText(/^Step \d+ of \d+$/)).not.toBeInTheDocument();
    expect(screen.getByTestId("work-setup-summary-stage")).toHaveTextContent("Done");
    expect(screen.getByTestId("work-setup-summary-areas")).toHaveTextContent("Skipped");
    expect(screen.getByTestId("work-setup-summary-alerts")).toHaveTextContent("To do");
  });

  it("a summary row opens that step", () => {
    seed({ status: "done", step: "done" });
    atStep("done");
    render(<WorkSetupPage />);
    fireEvent.click(screen.getByTestId("work-setup-summary-alerts"));
    expect(nav.push).toHaveBeenCalledWith(workSetupStepHref("alerts"), { scroll: false });
  });
});

describe("My Day's Set up Work card", () => {
  it("offers Start to a signed-in doctor who has not begun", () => {
    render(<WorkSetupPromptCard />);
    expect(screen.getByTestId("work-setup-prompt")).toHaveTextContent("Stage, areas, time zone, roster and alerts");
    expect(screen.getByRole("link", { name: "Start" })).toHaveAttribute("href", "/my-day/setup");
  });

  it("offers Resume at the stored step, with how many are done", () => {
    seed({ step: "roster", completed: ["stage", "areas"], skipped: ["time-zone"] });
    render(<WorkSetupPromptCard />);
    // A skipped step is not done.
    expect(screen.getByTestId("work-setup-prompt")).toHaveTextContent("2 of 7 done");
    expect(screen.getByRole("link", { name: "Resume" })).toHaveAttribute("href", workSetupStepHref("roster"));
  });

  it("Not now puts it away and stores that", () => {
    render(<WorkSetupPromptCard />);
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(screen.queryByTestId("work-setup-prompt")).not.toBeInTheDocument();
    expect(stored().status).toBe("dismissed");
  });

  it("stays away when finished, put away or signed out", () => {
    seed({ status: "done", step: "done" });
    const { unmount } = render(<WorkSetupPromptCard />);
    expect(screen.queryByTestId("work-setup-prompt")).not.toBeInTheDocument();
    unmount();
    seed({ status: "dismissed" });
    const second = render(<WorkSetupPromptCard />);
    expect(screen.queryByTestId("work-setup-prompt")).not.toBeInTheDocument();
    second.unmount();
    window.localStorage.clear();
    auth.status = "signed_out";
    render(<WorkSetupPromptCard />);
    expect(screen.queryByTestId("work-setup-prompt")).not.toBeInTheDocument();
  });
});
