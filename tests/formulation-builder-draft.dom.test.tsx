/** @vitest-environment jsdom */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FormulationBuilderPage } from "@/components/formulation/formulation-builder-page";
import { formulationMechanismIndex } from "@/lib/formulation-mechanism-index";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children: ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const STORAGE_KEY = "psychsift_formulation_draft";
const [first, second] = formulationMechanismIndex;

beforeEach(() => {
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.sessionStorage.clear();
});

async function openDraftStep(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /Continue to framework/ }));
  await user.click(screen.getByRole("button", { name: /Review quality/ }));
  await user.click(screen.getByRole("button", { name: /Create draft/ }));
  return screen.getByRole("textbox", { name: "Formulation draft" });
}

describe("FormulationBuilderPage saved draft", () => {
  it("adds the mechanism from 'Use in formulation' to a saved selection instead of dropping it", async () => {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ selectedIds: [first.id] }));

    render(<FormulationBuilderPage initialMechanisms={[second.id]} />);

    expect(await screen.findByRole("button", { name: `Remove ${first.name}` })).toBeTruthy();
    expect(screen.getByRole("button", { name: `Remove ${second.name}` })).toBeTruthy();
    await waitFor(() =>
      expect(JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) ?? "{}").selectedIds).toEqual([first.id, second.id]),
    );
  });

  it("keeps hand edits when the clinician steps back and returns to the draft", async () => {
    const user = userEvent.setup();
    render(<FormulationBuilderPage initialMechanisms={[first.id]} />);

    const draft = await openDraftStep(user);
    await user.type(draft, " Hand-written line.");
    await user.click(screen.getByRole("button", { name: /Previous/ }));
    await user.click(screen.getByRole("button", { name: /Create draft/ }));

    const returned = screen.getByRole("textbox", { name: "Formulation draft" }) as HTMLTextAreaElement;
    expect(returned.value).toContain("Hand-written line.");
  });

  it("keeps hand edits when an earlier quality note changes", async () => {
    const user = userEvent.setup();
    render(<FormulationBuilderPage initialMechanisms={[first.id]} />);

    const draft = await openDraftStep(user);
    await user.type(draft, " Hand-written line.");
    await user.click(screen.getByRole("button", { name: /Previous/ }));
    const [qualityNote] = screen.getAllByPlaceholderText("Record a concise review note…");
    await user.type(qualityNote!, "x");
    await user.click(screen.getByRole("button", { name: /Create draft/ }));

    const returned = screen.getByRole("textbox", { name: "Formulation draft" }) as HTMLTextAreaElement;
    expect(returned.value).toContain("Hand-written line.");
  });

  it("says so when copying the draft fails", async () => {
    const user = userEvent.setup();
    render(<FormulationBuilderPage initialMechanisms={[first.id]} />);
    await openDraftStep(user);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    Object.defineProperty(document, "execCommand", { configurable: true, value: vi.fn().mockReturnValue(false) });

    await user.click(screen.getByRole("button", { name: /Copy draft/ }));

    expect((await screen.findByRole("status")).textContent).toContain("Couldn't copy");
    expect(screen.queryByRole("button", { name: /Copied/ })).toBeNull();
  });
});
