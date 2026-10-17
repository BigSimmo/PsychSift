/** @vitest-environment jsdom */
// "About this mode" sits in the ••• menu of every First Nations page, so the primer it opens must be
// mounted by the mode's layout, not only by Bedside; otherwise the row is a button that does nothing.
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import FirstNationsLayout from "@/app/(search-app)/first-nations/layout";
import { FirstNationsMenuActions } from "@/components/first-nations/page-menu";
import { CrisisStrip } from "@/components/first-nations/crisis";
import { resetAfterEach } from "./fixtures/first-nations-models";

vi.mock("next/font/local", () => ({ default: () => ({ variable: "fn-serif" }) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/first-nations/talking", useRouter: () => ({}) }));
resetAfterEach();

describe("About this mode on an inner page", () => {
  it.each([null, "1"])("keeps emergency contacts unobstructed with prior dismissal %s", (dismissed) => {
    if (dismissed) window.localStorage.setItem("first-nations-primer-dismissed", dismissed);
    else window.localStorage.removeItem("first-nations-primer-dismissed");
    render(
      <FirstNationsLayout>
        <CrisisStrip />
      </FirstNationsLayout>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    const notice = screen.getByRole("complementary", { name: "First Nations reference notice" });
    expect(notice.textContent).toContain("A reference and contacts tool, not clinical decision support.");
    expect(notice.textContent).toContain(
      "Cultural content shows its source and awaits your service's Aboriginal health team.",
    );
    expect(screen.getByRole("link", { name: /000/ }).getAttribute("href")).toBe("tel:000");
    expect(screen.getByRole("link", { name: /13 92 76/ }).getAttribute("href")).toBe("tel:139276");
    window.localStorage.removeItem("first-nations-primer-dismissed");
  });

  it("opens, closes and reopens the full primer from the menu without changing storage", () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("Storage refused");
    });
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    render(
      <FirstNationsLayout>
        <FirstNationsMenuActions pageTitle="Talking" href="/first-nations/talking" reportHref={null} training={null} />
      </FirstNationsLayout>,
    );
    expect(screen.queryByRole("dialog", { name: "About First Nations" })).toBeNull();
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "About this mode" }));
    });
    const dialog = screen.getByRole("dialog", { name: "About First Nations" });
    expect(within(dialog).getByText("Nothing about any patient is saved or sent.")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Got it" }));
    expect(screen.queryByRole("dialog", { name: "About First Nations" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "About this mode" }));
    expect(screen.getByRole("dialog", { name: "About First Nations" })).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "About First Nations" })).toBeNull();
    expect(screen.getByRole("complementary", { name: "First Nations reference notice" })).toBeTruthy();
    expect(getItem).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
  });
});
