/** @vitest-environment jsdom */

// The help centre (`/my-day/help`): the home lists Get started, the areas and
// Good to know; search shows highlighted results with a spoken count and Escape
// clears it; `?topic=` shows one topic with a way back to all help; answers open
// in place; and `#q-<id>` arrives with that answer already open.

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({
  params: new URLSearchParams(),
  push: vi.fn(),
  replace: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/my-day/help",
  useRouter: () => ({ push: nav.push, replace: nav.replace, back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => nav.params,
}));

const band = vi.hoisted(() => ({ heading: vi.fn() }));
vi.mock("@/components/mode-band/mode-band", () => ({ useModeBandHeading: band.heading }));

vi.mock("@/components/clinical-dashboard/use-app-preferences", () => ({
  useAppPreferences: () => ({ preferences: {}, setPreference: vi.fn() }),
}));

import { WorkHelpPage } from "@/components/work-help/work-help-page";
import { WORK_SETUP_PROGRESS_STORAGE_KEY } from "@/lib/account-scoped-browser-state";
import { workHelpTopic } from "@/lib/work-help";

const rost = workHelpTopic("rost")!;

function withParams(params: Record<string, string>) {
  nav.params = new URLSearchParams(params);
}

beforeEach(() => {
  window.localStorage.clear();
  nav.push.mockReset();
  nav.replace.mockReset();
  band.heading.mockReset();
  withParams({});
  window.history.replaceState(null, "", "/my-day/help");
});

afterEach(() => {
  window.history.replaceState(null, "", "/my-day/help");
});

describe("help home", () => {
  it("shows Get started, the areas and Good to know", () => {
    render(<WorkHelpPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Help" })).toBeInTheDocument();
    const getStarted = screen.getByRole("list", { name: "Get started" });
    expect(within(getStarted).getByText("Set up Work")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Areas" })).toBeInTheDocument();
    expect(screen.getByTestId("work-help-topic-row-rost")).toHaveAttribute("href", "/my-day/help?topic=rost");
    const guides = screen.getByRole("list", { name: "Good to know" });
    expect(within(guides).getByText("Privacy", { exact: false })).toBeInTheDocument();
    expect(band.heading).toHaveBeenCalledWith({ title: "Help" });
  });

  it("puts the doctor's own areas first once setup has started", () => {
    window.localStorage.setItem(
      WORK_SETUP_PROGRESS_STORAGE_KEY,
      JSON.stringify({ v: 1, status: "in-progress", step: "stage", areas: ["teach"], completed: [], skipped: [] }),
    );
    render(<WorkHelpPage />);
    const yours = screen.getByRole("list", { name: "Your areas" });
    expect(within(yours).getByTestId("work-help-topic-row-teach")).toBeInTheDocument();
    expect(within(yours).queryByTestId("work-help-topic-row-rost")).not.toBeInTheDocument();
    const others = screen.getByRole("list", { name: "Other areas" });
    expect(within(others).getByTestId("work-help-topic-row-rost")).toBeInTheDocument();
  });
});

describe("search", () => {
  it('typing "swap" shows results with the word marked and a status line', async () => {
    render(<WorkHelpPage />);
    fireEvent.change(screen.getByTestId("work-help-search"), { target: { value: "swap" } });
    const results = screen.getByTestId("work-help-results");
    expect(screen.queryByRole("list", { name: "Get started" })).not.toBeInTheDocument();
    const swap = within(results).getByTestId("work-help-result-rost-swap-shift");
    expect(swap).toHaveAttribute("href", "/my-day/help?topic=rost#q-swap-shift");
    const marks = results.querySelectorAll("mark");
    expect(marks.length).toBeGreaterThan(0);
    expect(marks[0].textContent?.toLowerCase()).toBe("swap");
    // The spoken count settles once typing pauses, and the search rides in the address.
    await waitFor(() => expect(screen.getByTestId("work-help-status")).toHaveTextContent(/^\d+ results?$/), {
      timeout: 3000,
    });
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/my-day/help?q=swap", { scroll: false }));
  });

  it("a word that is nowhere says so", async () => {
    render(<WorkHelpPage />);
    fireEvent.change(screen.getByTestId("work-help-search"), { target: { value: "xyzzyqq" } });
    expect(screen.getByTestId("work-help-no-results")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("work-help-status")).toHaveTextContent("No help found"), {
      timeout: 3000,
    });
  });

  it("opens with the search from the address", () => {
    withParams({ q: "swap" });
    render(<WorkHelpPage />);
    expect(screen.getByTestId("work-help-search")).toHaveValue("swap");
    expect(screen.getByTestId("work-help-result-rost-swap-shift")).toBeInTheDocument();
  });

  it("Escape clears the search and brings the home back", () => {
    render(<WorkHelpPage />);
    const input = screen.getByTestId("work-help-search");
    fireEvent.change(input, { target: { value: "swap" } });
    expect(screen.getByTestId("work-help-results")).toBeInTheDocument();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input).toHaveValue("");
    expect(screen.queryByTestId("work-help-results")).not.toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Get started" })).toBeInTheDocument();
  });

  it("the clear button clears the search", () => {
    render(<WorkHelpPage />);
    const input = screen.getByTestId("work-help-search");
    fireEvent.change(input, { target: { value: "leave" } });
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(input).toHaveValue("");
    expect(screen.queryByTestId("work-help-results")).not.toBeInTheDocument();
  });
});

describe("one topic", () => {
  it("?topic=rost shows the Roster topic with an All help link", () => {
    withParams({ topic: "rost" });
    render(<WorkHelpPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Roster help" })).toBeInTheDocument();
    expect(screen.getByTestId("work-help-topic-rost")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "All help" })).toHaveAttribute("href", "/my-day/help");
    for (const question of rost.questions) {
      expect(screen.getByRole("button", { name: question.q })).toBeInTheDocument();
    }
    expect(band.heading).toHaveBeenCalledWith({ eyebrow: "Help", title: "Roster" });
  });

  it("an unknown topic falls back to the home", () => {
    withParams({ topic: "nope" });
    render(<WorkHelpPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Help" })).toBeInTheDocument();
    expect(screen.getByTestId("work-help-home")).toBeInTheDocument();
  });

  it("an answer button opens and closes its answer", () => {
    withParams({ topic: "rost" });
    render(<WorkHelpPage />);
    const first = rost.questions[0];
    const button = screen.getByRole("button", { name: first.q });
    expect(button).toHaveAttribute("aria-expanded", "false");
    const panel = document.getElementById(button.getAttribute("aria-controls")!);
    expect(panel).not.toBeVisible();
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(panel).toBeVisible();
    expect(panel).toHaveTextContent(first.a);
    expect(within(panel!).getByRole("link")).toHaveAttribute("href", first.link!.href);
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "false");
  });

  it("arriving with #q-<id> opens that answer, and it can still be closed", () => {
    const first = rost.questions[0];
    window.history.replaceState(null, "", `/my-day/help?topic=rost#q-${first.id}`);
    withParams({ topic: "rost" });
    render(<WorkHelpPage />);
    const button = screen.getByRole("button", { name: first.q });
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: rost.questions[1].q })).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "false");
  });

  it("a hash for a question in another topic opens nothing", () => {
    window.history.replaceState(null, "", "/my-day/help?topic=rost#q-not-a-roster-question");
    withParams({ topic: "rost" });
    render(<WorkHelpPage />);
    for (const question of rost.questions) {
      expect(screen.getByRole("button", { name: question.q })).toHaveAttribute("aria-expanded", "false");
    }
  });
});
