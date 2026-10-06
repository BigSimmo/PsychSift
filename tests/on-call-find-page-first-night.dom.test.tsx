/** @vitest-environment jsdom */
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { entriesState } from "./helpers/on-call-handbook-fixture";

vi.mock("next/navigation", () => ({
  usePathname: () => "/on-call/find",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/on-call/entry-store", () => ({ useOnCallEntries: () => entriesState([]) }));

import { OnCallFirstNightPanel } from "@/components/on-call/find/first-night-panel";
import { OnCallFirstNightPage } from "@/components/on-call/on-call-first-night-page";
import { onCallChecklistItemKey, onCallChecklistStorageKey } from "@/lib/on-call/checklist-storage";
import { ON_CALL_FIRST_NIGHT_STAGES } from "@/lib/on-call/first-night";

const PROMPTS = ON_CALL_FIRST_NIGHT_STAGES.map((stage) => ({
  id: stage.id,
  prompts: stage.prompts.map((prompt) => prompt.text),
}));

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

const TOTAL = PROMPTS.reduce((sum, stage) => sum + stage.prompts.length, 0);

describe("Handbook's First night panel", () => {
  it("counts the same prompts the First night page draws, so the tick keys match", () => {
    render(<OnCallFirstNightPage />);
    for (const stage of PROMPTS) {
      const list = screen.getByTestId(`on-call-orientation-checklist-first-night-${stage.id}`);
      const texts = within(list)
        .getAllByRole("button")
        .map((button) => button.querySelector("span.min-w-0 > span")?.textContent?.trim());
      expect(texts).toEqual([...stage.prompts]);
    }
  });

  it("counts the real ticks kept on this device, and starts on the first unfinished stage", () => {
    const before = PROMPTS[0];
    const night = PROMPTS[1];
    window.localStorage.setItem(
      onCallChecklistStorageKey,
      JSON.stringify([
        ...before.prompts.map((text) => onCallChecklistItemKey("first-night-before", text)),
        onCallChecklistItemKey("first-night-night", night.prompts[0]),
      ]),
    );
    render(<OnCallFirstNightPanel />);
    const done = before.prompts.length + 1;
    expect(screen.getByRole("img", { name: `${done} of ${TOTAL} ticked` })).toHaveTextContent(`${done}/${TOTAL}`);
    expect(screen.getByText("Sort these in daylight")).toBeInTheDocument();
    expect(screen.getByTestId("on-call-find-first-night-stage-night")).toHaveAttribute("aria-pressed", "true");
    const prompts = screen.getByTestId("on-call-find-first-night-prompts");
    expect(within(prompts).getAllByRole("listitem")).toHaveLength(3);
    expect(within(prompts).getByText(night.prompts[0])).toHaveTextContent(", ticked");
    expect(within(prompts).getByText(night.prompts[1])).toHaveTextContent(", not ticked");
    expect(screen.getByText(`${night.prompts.length - 3} more`)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open First night" })).toHaveAttribute("href", "/on-call/first-night");
  });

  it("switches stage, and follows a tick made on the First night page", async () => {
    render(
      <>
        <OnCallFirstNightPanel />
        <OnCallFirstNightPage />
      </>,
    );
    expect(screen.getByRole("img", { name: `0 of ${TOTAL} ticked` })).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("on-call-find-first-night-stage-wrong"));
    expect(screen.getByTestId("on-call-find-first-night-stage-wrong")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("If something goes wrong", { selector: "h3" })).toBeInTheDocument();
    const wrong = PROMPTS[2];
    const list = screen.getByTestId("on-call-orientation-checklist-first-night-wrong");
    await userEvent.click(within(list).getByRole("button", { name: new RegExp(wrong.prompts[1]) }));
    expect(screen.getByRole("img", { name: `1 of ${TOTAL} ticked` })).toBeInTheDocument();
    expect(
      within(screen.getByTestId("on-call-find-first-night-prompts")).getByText(wrong.prompts[1]),
    ).toHaveTextContent(", ticked");
  });
});
