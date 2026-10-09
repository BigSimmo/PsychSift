/** @vitest-environment jsdom */

// The administrator's rotation screens, driven through the example rounds:
// the rounds list, collecting preferences, allocating, adjusting one
// placement in the sheet and publishing, and the new-round form's steps.

import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RotationRoundsPage } from "@/components/roster/rotations/admin/rounds-page";
import { RotationRoundPage } from "@/components/roster/rotations/admin/round-page";
import { NewRotationRoundPage } from "@/components/roster/rotations/admin/round-form";
import { resetExampleDataForTests, setExampleDataOn } from "@/lib/example-data/store";

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }));
const search = vi.hoisted(() => ({ value: "" }));

vi.mock("next/navigation", () => ({
  usePathname: () => "/roster/manage/rotations",
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(search.value),
}));

beforeEach(() => {
  window.localStorage.clear();
  resetExampleDataForTests();
  search.value = "";
  router.push.mockReset();
  router.replace.mockReset();
  act(() => setExampleDataOn(true));
});

afterEach(() => cleanup());

const year = new Date().getUTCFullYear();
const openId = `example:round:${year + 1}`;

describe("rotation rounds list", () => {
  it("lists the open round with its progress and the published one", async () => {
    render(<RotationRoundsPage />);
    const open = await screen.findByTestId(`rotation-round-row-${openId}`);
    expect(open.textContent).toContain(`${year + 1} rotations`);
    expect(open.textContent).toMatch(/8 of 12 sent · closes/);
    expect(open.getAttribute("href")).toBe(`/roster/manage/rotations/${encodeURIComponent(openId)}`);
    expect(screen.getByTestId("rotation-rounds-group-published").textContent).toContain(`${year} rotations`);
    expect(screen.getByTestId("rotation-rounds-new").getAttribute("href")).toBe("/roster/manage/rotations/new");
  });
});

describe("one round, from open to published", () => {
  it("collects, allocates, adjusts one placement and publishes", async () => {
    const user = userEvent.setup();
    render(<RotationRoundPage roundId={encodeURIComponent(openId)} />);

    const hero = await screen.findByTestId("rotation-round-collecting-hero");
    expect(hero.textContent).toContain("8 of 12 sent");
    expect(
      within(screen.getByTestId("rotation-round-waiting")).getAllByText(/Draft|Not started/).length,
    ).toBeGreaterThan(0);

    await user.click(screen.getByTestId("rotation-round-allocate"));
    const confirm = screen.getByTestId("rotation-round-allocate-confirm");
    expect(confirm.textContent).toContain("This closes the round");
    await user.click(screen.getByTestId("rotation-round-allocate-confirm-confirm"));

    const result = await screen.findByTestId("rotation-round-result-hero");
    expect(result.textContent).toMatch(/got a 1st choice/);
    expect(screen.getByRole("radiogroup", { name: "Show the allocation" })).toBeTruthy();

    // Tap the first placed person and look at the sheet.
    const firstPerson = screen.getAllByTestId(/^rotation-round-person-/)[0]!;
    await user.click(firstPerson);
    const sheet = await screen.findByTestId("rotation-round-adjust");
    expect(within(sheet).getByText("Their ranking")).toBeTruthy();
    const save = within(sheet).getByTestId("rotation-round-adjust-save");
    expect((save as HTMLButtonElement).disabled).toBe(true);
    // Fixing it in place is a change.
    await user.click(within(sheet).getByRole("switch", { name: "Fix this placement" }));
    expect((save as HTMLButtonElement).disabled).toBe(false);
    await user.click(save);
    await waitFor(() => expect(screen.queryByTestId("rotation-round-adjust")).toBeNull());
    expect(screen.getAllByText("Fixed").length).toBeGreaterThan(0);

    // By person shows each doctor's year.
    await user.click(screen.getByRole("radio", { name: "By person" }));
    expect(screen.getAllByTestId(/^rotation-round-year-[^-]+:[^-]+:[^-]+$/).length).toBeGreaterThan(0);

    await user.click(screen.getByTestId("rotation-round-publish"));
    expect(screen.getByTestId("rotation-round-publish-confirm").textContent).toContain("go on calendars");
    await user.click(screen.getByTestId("rotation-round-publish-confirm-confirm"));
    expect(await screen.findByTestId("rotation-round-published-note")).toBeTruthy();
    expect(screen.queryByTestId("rotation-round-publish")).toBeNull();
  });

  it("says when a round is not there, with a way back", async () => {
    render(<RotationRoundPage roundId="example%3Around%3Anope" />);
    const missing = await screen.findByTestId("rotation-round-missing");
    expect(within(missing).getByRole("link", { name: "All rounds" }).getAttribute("href")).toBe(
      "/roster/manage/rotations",
    );
  });
});

describe("new round form", () => {
  it("steps through terms, rotations and who, with the capacity check", async () => {
    const user = userEvent.setup();
    render(<NewRotationRoundPage />);
    await screen.findByTestId("rotation-round-form");
    expect(screen.getAllByTestId(/^rotation-form-term-\d+$/)).toHaveLength(4);

    await user.click(screen.getByTestId("rotation-form-preset-halves"));
    expect(screen.getAllByTestId(/^rotation-form-term-\d+$/)).toHaveLength(2);

    await user.click(screen.getByTestId("rotation-form-next"));
    expect(screen.getAllByTestId(/^rotation-form-rotation-\d+$/)).toHaveLength(8);
    expect(screen.getByTestId("rotation-form-capacity").textContent).toBe(
      "Passed: 12 doctors need 12 places a term. You have 13.",
    );
    await user.click(within(screen.getByTestId("rotation-form-places-0")).getByRole("button", { name: /^Fewer/ }));
    await user.click(within(screen.getByTestId("rotation-form-places-1")).getByRole("button", { name: /^Fewer/ }));
    expect(screen.getByTestId("rotation-form-capacity").textContent).toMatch(/You have 11. Add 1 more/);

    await user.click(screen.getByTestId("rotation-form-next"));
    expect(screen.getByTestId("rotation-form-name")).toBeTruthy();
    await user.click(screen.getByTestId("rotation-form-save-draft"));
    await waitFor(() => expect(router.replace).toHaveBeenCalledTimes(1));
    expect(String(router.replace.mock.calls[0]![0])).toMatch(/^\/roster\/manage\/rotations\/example%3Around%3A/);
  });
});
