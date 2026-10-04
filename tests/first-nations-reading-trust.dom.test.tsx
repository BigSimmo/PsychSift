/** @vitest-environment jsdom */
// Reading-trust sheet explains awaiting / statewide tips / PsychSift templates / EMHS-off.
// Entry points: the example line and the page ••• row. Open state must stay ephemeral.
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import FirstNationsLayout from "@/app/(search-app)/first-nations/layout";
import { ExampleLine } from "@/components/first-nations/bedside-home";
import { FirstNationsMenuActions } from "@/components/first-nations/page-menu";
import { resetAfterEach } from "./fixtures/first-nations-models";

vi.mock("next/font/local", () => ({ default: () => ({ variable: "fn-serif" }) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/first-nations/talking", useRouter: () => ({}) }));
resetAfterEach();

function trustDialog() {
  return screen.getByRole("dialog", { name: "What am I reading?" });
}

describe("First Nations reading-trust sheet", () => {
  it("opens from the example line with the four plain trust statuses", () => {
    window.localStorage.setItem("first-nations-primer-dismissed", "1");
    render(
      <FirstNationsLayout>
        <ExampleLine />
      </FirstNationsLayout>,
    );
    expect(screen.queryByRole("dialog", { name: "What am I reading?" })).toBeNull();
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /What am I reading\?/ }));
    });
    const dialog = trustDialog();
    expect(dialog.textContent).toMatch(/Awaiting/);
    expect(dialog.textContent).toMatch(/Statewide tips/);
    expect(dialog.textContent).toMatch(/PsychSift templates/);
    expect(dialog.textContent).toMatch(/EMHS off/);
    expect(dialog.textContent).not.toMatch(/Reviewed by|signed off|Not yet reviewed/i);
    window.localStorage.removeItem("first-nations-primer-dismissed");
  });

  it("opens from the page menu and closes without writing storage", () => {
    window.localStorage.setItem("first-nations-primer-dismissed", "1");
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    render(
      <FirstNationsLayout>
        <FirstNationsMenuActions pageTitle="Talking" href="/first-nations/talking" reportHref={null} training={null} />
      </FirstNationsLayout>,
    );
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "What am I reading?" }));
    });
    const dialog = trustDialog();
    act(() => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Got it" }));
    });
    expect(screen.queryByRole("dialog", { name: "What am I reading?" })).toBeNull();
    expect(setItem).not.toHaveBeenCalled();
    setItem.mockRestore();
    window.localStorage.removeItem("first-nations-primer-dismissed");
  });
});
