import { useState } from "react";

import { render, screen, waitFor } from "@testing-library/react";
import userEvent, { PointerEventsCheckLevel } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { installMatchMediaStub } from "./setup/jsdom.setup";

vi.mock("@/components/clinical-dashboard/signed-image", () => ({
  SignedImage: ({ caption, alt }: { caption?: string; alt?: string }) => <p>{caption ?? alt}</p>,
}));

import { AnswerSourceDrawer } from "@/components/clinical-dashboard/answer-source-drawer";
import { AnswerSourceRail } from "@/components/clinical-dashboard/answer-source-rail";
import type { AnswerSourceRow } from "@/components/clinical-dashboard/answer-source-rows";
import { normalizeSourceMetadata } from "@/lib/source-metadata";

/**
 * From 1024px a cited source opens docked beside the answer instead of in the
 * shared Sheet (answer-source-docked-panel.tsx). It is not a dialog, so these
 * pin what replaces the dialog's guarantees: a named landmark, focus moved in on
 * open, Escape and a visible close button, and focus handed back on close.
 * Below 1024px the drawer must still be the Sheet dialog, unchanged.
 */

function row(overrides: Partial<AnswerSourceRow> & { id: string; title: string }): AnswerSourceRow {
  return {
    documentId: `doc-${overrides.id}`,
    pageNumber: 4,
    metadata: normalizeSourceMetadata(null),
    score: 0.8,
    href: `/documents/${overrides.id}?chunk=${overrides.id}`,
    ...overrides,
  };
}

const SOURCES: AnswerSourceRow[] = [
  row({ id: "s1", title: "Clozapine monitoring protocol", sourceStrength: "strong", snippet: "Check FBC weekly." }),
  row({ id: "s2", title: "Metabolic screening standard", pageNumber: 11, sourceStrength: "limited" }),
];

function RailAndDrawer() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  return (
    <>
      <button type="button">Elsewhere in the answer</button>
      <AnswerSourceRail sources={SOURCES} query="clozapine monitoring" onOpenSource={setOpenIndex} />
      <AnswerSourceDrawer
        sources={SOURCES}
        openIndex={openIndex}
        onOpenIndexChange={setOpenIndex}
        onClose={() => setOpenIndex(null)}
      />
    </>
  );
}

// jsdom loads no stylesheet, so the panel's `pointer-events-auto` class cannot
// undo the overlay wrapper's inline `pointer-events: none` here as it does in a
// browser (the Playwright desktop specs cover real pointer input).
function setupUser() {
  return userEvent.setup({ pointerEventsCheck: PointerEventsCheckLevel.Never });
}

async function openDocked(user: ReturnType<typeof userEvent.setup>, index = 0) {
  const railRow = screen.getAllByTestId("answer-source-rail-row")[index];
  await user.click(railRow);
  const panel = await screen.findByRole("complementary", { name: SOURCES[index].title });
  return { railRow, panel };
}

describe("answer source docked panel (from 1024px)", () => {
  it("opens beside the answer as a named landmark, not a dialog, and takes focus", async () => {
    installMatchMediaStub(true);
    // jsdom has no layout; give the panel the 26rem width it has from 1280px.
    const width = vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(416);
    const user = setupUser();
    const main = document.body.appendChild(Object.assign(document.createElement("main"), { id: "main-content" }));
    render(<RailAndDrawer />);

    const { panel } = await openDocked(user);
    width.mockRestore();
    expect(panel).toHaveAttribute("data-testid", "answer-source-drawer");
    expect(panel).toHaveAccessibleDescription("Check the answer against the cited passage.");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(panel).not.toHaveAttribute("aria-modal");
    await waitFor(() => expect(document.activeElement).toBe(panel));
    expect(document.body.dataset.sourceDocked).toBe("true");
    // The answer column's reserve is the panel's width, its right offset and a gutter.
    expect(document.body.style.getPropertyValue("--source-dock-reserve")).toMatch(/^4\d\dpx$/);
    // Also inline on the answer's scroll area, which desktop Safari needs to re-lay it out.
    expect(main.style.paddingRight).toMatch(/^4\d\dpx$/);
    expect(screen.getByRole("button", { name: "Close source detail" })).toBeVisible();
    await user.keyboard("{Escape}");
    expect(main.style.paddingRight).toBe("");
    main.remove();
  });

  it("closes on Escape and returns focus to the source that opened it", async () => {
    installMatchMediaStub(true);
    const user = setupUser();
    render(<RailAndDrawer />);
    const historyLength = window.history.length;

    const { railRow } = await openDocked(user);
    // Not modal, so no Back entry: one the reader left through the page would strand Back.
    expect(window.history.length).toBe(historyLength);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId("answer-source-drawer")));
    await user.keyboard("{Escape}");

    expect(screen.queryByTestId("answer-source-drawer")).toBeNull();
    expect(document.body.dataset.sourceDocked).toBeUndefined();
    expect(document.body.style.getPropertyValue("--source-dock-reserve")).toBe("");
    await waitFor(() => expect(document.activeElement).toBe(railRow));
  });

  it("closes from its close button and returns focus to the row it was last showing", async () => {
    installMatchMediaStub(true);
    const user = setupUser();
    render(<RailAndDrawer />);

    const { panel } = await openDocked(user);
    await user.click(screen.getByRole("button", { name: /^Show source 2/ }));
    expect(panel).toHaveAccessibleName(SOURCES[1].title);
    await user.click(screen.getByRole("button", { name: "Close source detail" }));

    expect(screen.queryByTestId("answer-source-drawer")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(screen.getAllByTestId("answer-source-rail-row")[1]));
  });

  it("leaves focus where the reader moved it while the panel was open", async () => {
    installMatchMediaStub(true);
    const user = setupUser();
    render(<RailAndDrawer />);

    await openDocked(user);
    const elsewhere = screen.getByRole("button", { name: "Elsewhere in the answer" });
    // Not modal: the answer stays usable beside the panel.
    await user.click(elsewhere);
    expect(document.activeElement).toBe(elsewhere);
    await user.keyboard("{Escape}");

    expect(screen.queryByTestId("answer-source-drawer")).toBeNull();
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    expect(document.activeElement).toBe(elsewhere);
  });

  it("keeps the shared Sheet dialog below 1024px", async () => {
    installMatchMediaStub(false);
    const user = setupUser();
    render(<RailAndDrawer />);

    await user.click(screen.getAllByTestId("answer-source-rail-row")[0]);
    const dialog = screen.getByRole("dialog", { name: SOURCES[0].title });
    expect(dialog).toHaveAttribute("data-testid", "answer-source-drawer");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.queryByRole("complementary", { name: SOURCES[0].title })).toBeNull();
    expect(document.body.dataset.sourceDocked).toBeUndefined();
  });
});
