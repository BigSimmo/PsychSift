/** @vitest-environment jsdom */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BedsideHomeView } from "@/components/first-nations/bedside-home";
import { InnerPageView } from "@/components/first-nations/inner-page";
import { buildInnerPageModel } from "@/lib/first-nations/view-model";
import { testInputs } from "./fixtures/first-nations-content";
import {
  clearAccountScopedBrowserStorage,
  FIRST_NATIONS_HOSPITAL_STORAGE_KEY,
} from "@/lib/account-scoped-browser-state";
import { bedsideFixture, resetAfterEach } from "./fixtures/first-nations-models";

vi.mock("@/components/first-nations/kit", async () => await import("./fixtures/first-nations-kit-double"));
vi.mock("@/components/first-nations/first-nations-nav-header", () => ({ FirstNationsNavHeader: () => null }));
vi.mock("@/components/first-nations/page-menu", () => ({
  FirstNationsHomeMenu: () => null,
  FirstNationsMenuActions: () => null,
}));
vi.mock("@/components/first-nations/primer", () => ({ Primer: () => null, PRIMER_EVENT: "x" }));
vi.mock("@/components/first-nations/reading-trust-sheet", () => ({
  ReadingTrustSheet: () => null,
  READING_TRUST_EVENT: "x",
  openReadingTrustSheet: () => {},
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/first-nations" }));
resetAfterEach();

const DIR = "src/components/first-nations";
const APP_DIR = "src/app/(search-app)/first-nations";
const files = [
  ...readdirSync(DIR).map((f) => ({ f, text: readFileSync(join(DIR, f), "utf8") })),
  { f: "error.tsx", text: readFileSync(join(APP_DIR, "error.tsx"), "utf8") },
];
const SIZE_CLASSES = ["text-2xs", "text-sm-minus", "text-base-minus", "text-lg-minus", "fn-display-36"];

/** Size steps used inside `root`, leaving out the desktop-only plan panel (its own column with a sheet-sized title). */
function sizesIn(root: Element): string[] {
  return SIZE_CLASSES.filter((c) =>
    [...root.querySelectorAll(`.${c}`)].some((el) => !el.closest("[data-fn-part='plan-panel']")),
  );
}

describe("First Nations design guard (standard v13.1)", () => {
  it("opens the service directory with the Aboriginal and Torres Strait Islander filter", () => {
    const model = buildInnerPageModel(testInputs(), "contacts");
    model.sections[0].id = "contacts-community";
    render(<InnerPageView model={model} />);
    expect(
      screen.getByRole("link", { name: "Find Aboriginal and Torres Strait Islander services" }).getAttribute("href"),
    ).toBe("/services/search?specialist_groups=aboriginal_torres_strait_islander");
  });
  it("keeps the selected workplace and liaison hero together, persisting only the hospital id", () => {
    const { model, hospital } = bedsideFixture();
    const second = {
      ...hospital,
      id: "second",
      name: "Second hospital",
      liaison: { ...hospital.liaison, number: "(08) 9000 0099" },
    };
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const { container, unmount } = render(<BedsideHomeView model={{ ...model, hospitals: [hospital, second] }} />);
    fireEvent.change(screen.getByRole("combobox", { name: "Your workplace hospital" }), {
      target: { value: "second" },
    });
    expect((screen.getByRole("combobox", { name: "Your workplace hospital" }) as HTMLSelectElement).value).toBe(
      "second",
    );
    expect(container.querySelector("[data-fn-part='hero']")?.textContent).toContain("(08) 9000 0099");
    expect(setItem).toHaveBeenCalledExactlyOnceWith(FIRST_NATIONS_HOSPITAL_STORAGE_KEY, "second");
    unmount();
    render(<BedsideHomeView model={{ ...model, hospitals: [hospital, second] }} />);
    expect((screen.getByRole("combobox", { name: "Your workplace hospital" }) as HTMLSelectElement).value).toBe(
      "second",
    );
    fireEvent.change(screen.getByRole("combobox", { name: "Your workplace hospital" }), {
      target: { value: "second" },
    });
    act(() => clearAccountScopedBrowserStorage());
    expect((screen.getByRole("combobox", { name: "Your workplace hospital" }) as HTMLSelectElement).value).toBe(
      hospital.id,
    );
    expect(localStorage.getItem(FIRST_NATIONS_HOSPITAL_STORAGE_KEY)).toBeNull();
    expect(screen.queryByText("(08) 9000 0099")).toBeNull();
  });
  it("uses nothing heavier than semibold", () => {
    for (const { f, text } of files)
      expect(text, f).not.toMatch(/\bfont-(bold|extrabold|black)\b|font-weight:\s*[7-9]00/);
  });
  it("uses only the scale's size steps", () => {
    for (const { f, text } of files)
      expect(text, f).not.toMatch(/\btext-(3xs|xs|sm|base|lg|xl|[2-9]xl)\b(?!-)|\btext-\[\d/);
  });
  it("keeps the serif accent inside voice.tsx", () => {
    for (const { f, text } of files) if (f !== "voice.tsx") expect(text, f).not.toMatch(/fn-voice/);
  });
  it("uses the mode colour only in the allowed places", () => {
    const allowed = new Set(["module-header.tsx", "day-track.tsx", "voice.tsx", "first-nations-nav-header.tsx"]);
    for (const { f, text } of files) if (!allowed.has(f)) expect(text, f).not.toMatch(/mode-identity|modeIdentity/);
  });
  it("gives tabs no count badges", () => {
    for (const { f, text } of files) expect(text, f).not.toMatch(/\b(badge|count)=\{/);
  });
  it("shows at most four type sizes and one filled button on Bedside", () => {
    const { container } = render(<BedsideHomeView model={bedsideFixture().model} />);
    const used = sizesIn(container);
    expect(used.length, used.join(", ")).toBeLessThanOrEqual(4);
    expect(container.querySelectorAll("[data-mode-filled], [data-variant='primary']").length).toBeLessThanOrEqual(1);
  });
  it("shows at most four type sizes and no filled button on an inner page", () => {
    const { container } = render(<InnerPageView model={buildInnerPageModel(testInputs(), "talking")} />);
    const used = sizesIn(container);
    expect(used.length, used.join(", ")).toBeLessThanOrEqual(4);
    expect(container.querySelectorAll("[data-mode-filled]").length).toBe(0);
  });
});
