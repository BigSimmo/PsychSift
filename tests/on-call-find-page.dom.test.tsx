/** @vitest-environment jsdom */
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { items, ready } from "./helpers/on-call-handbook-fixture";

const handbook = vi.hoisted(() => ({ state: null as unknown as ReturnType<typeof ready> }));

vi.mock("next/navigation", () => ({
  usePathname: () => "/on-call/find",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock("@/lib/supabase/client", () => ({ useAuthSession: () => ({ status: "authenticated", authEpoch: 1 }) }));
vi.mock("@/components/on-call/use-hospital-handbook", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/on-call/use-hospital-handbook")>()),
  useHospitalHandbook: () => handbook.state,
}));

import { OnCallFindPage } from "@/components/on-call/find/find-page";

beforeEach(() => {
  window.localStorage.clear();
  handbook.state = ready(items([]));
});
afterEach(cleanup);

describe("Find page", () => {
  it("puts Systems down first, leaves on-site items to Admin, and finds a ward by its everyday name", async () => {
    handbook.state = ready(
      items([
        { id: "a", title: "Access: Car park after hours", section: "resources" },
        { id: "d", title: "Downtime: If the electronic record is down", section: "resources" },
        { id: "w", title: "Ward: Synthetic ward 4B", section: "resources", body: "Level 3.\nAlso known as: HDU" },
        { id: "m", title: "Synthetic induction manual", section: "documentation" },
        { id: "o", title: "Parking permits", section: "resources" },
      ]),
    );
    render(<OnCallFindPage />);
    expect(screen.getByTestId("on-call-hospital-line")).toHaveTextContent("Site A");
    const groups = Array.from(document.querySelectorAll('[id^="on-call-group-"]')).map((node) => node.id);
    expect(groups).toEqual([
      "on-call-group-downtime",
      "on-call-group-wards",
      "on-call-group-manuals",
      "on-call-group-other",
    ]);
    expect(screen.getByRole("heading", { level: 2, name: "Systems down" })).toBeInTheDocument();
    expect(screen.queryByText("Car park after hours")).toBeNull();
    expect(within(document.getElementById("on-call-group-other")!).getByText("Parking permits")).toBeInTheDocument();
    const onSite = within(screen.getByTestId("on-call-find-on-site")).getByRole("link");
    expect(onSite).toHaveAttribute("href", "/admin/help");
    expect(onSite).toHaveTextContent("Parking, food and access are in Admin");
    expect(onSite).toHaveTextContent("Go");
    // Your first week is reached from the Handbook tab, next to First night.
    expect(screen.getByTestId("on-call-first-week-entry").closest("a")).toHaveAttribute("href", "/on-call/first-week");
    expect(screen.getByRole("link", { name: "Your manuals" })).toHaveAttribute("href", "/on-call/orientation");
    expect(screen.getAllByRole("searchbox")).toHaveLength(1);
    expect(screen.getByRole("searchbox", { name: "Search the handbook" })).toHaveAttribute(
      "placeholder",
      "Ward, room or equipment",
    );
    // Systems down, then the First night panel, then the rest.
    const order = Array.from(document.querySelectorAll('[id^="on-call-group-"], #on-call-first-night-panel')).map(
      (node) => node.id,
    );
    expect(order.slice(0, 2)).toEqual(["on-call-group-downtime", "on-call-first-night-panel"]);
    const jumps = within(screen.getByTestId("on-call-find-jumps")).getAllByRole("link");
    expect(jumps.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["Systems down", "#on-call-group-downtime"],
      ["Orientation", "/on-call/orientation"],
      ["First night", "#on-call-first-night-panel"],
      ["Wards", "#on-call-group-wards"],
      ["Manuals", "#on-call-group-manuals"],
    ]);
    await userEvent.type(screen.getByRole("searchbox"), "hdu");
    expect(screen.getByText("Synthetic ward 4B")).toBeInTheDocument();
    expect(screen.queryByText("If the electronic record is down")).toBeNull();
    expect(screen.queryByTestId("on-call-find-first-night")).toBeNull();
    expect(screen.queryByText(/being built/i)).toBeNull();
    // No job model exists, so no made-up orientation progress is drawn.
    expect(screen.queryByText(/your job orientation/i)).toBeNull();
  });

  it("wraps a long ward name instead of truncating it (#8RWKA0, moved from Now)", () => {
    handbook.state = ready(
      items([
        { id: "w", title: "Ward: Synthetic mental health observation ward east wing", section: "resources" },
        { id: "d", title: "Downtime: Paper forms", section: "resources" },
      ]),
    );
    render(<OnCallFindPage />);
    const title = within(document.getElementById("on-call-group-wards")!).getByText(
      "Synthetic mental health observation ward east wing",
    );
    expect(title.className).not.toMatch(/\btruncate\b|\bline-clamp-/);
    expect(title.className).toMatch(/\bbreak-words\b/);
  });

  it("opens an item's detail in a sheet, with its date, and without the lines the app reads for itself", async () => {
    handbook.state = ready(
      items([
        { id: "d", title: "Downtime: If the electronic record is down", section: "resources" },
        {
          id: "w",
          title: "Ward: Synthetic ward 4B",
          section: "resources",
          body: "Level 3.\nAlso known as: HDU, high dependency",
        },
        { id: "e", title: "Equipment: Bladder scanner", section: "resources" },
      ]),
    );
    render(<OnCallFindPage />);
    await userEvent.click(screen.getByRole("button", { name: /If the electronic record is down/ }));
    const detail = screen.getByTestId("on-call-find-detail");
    expect(within(detail).getByText("Synthetic example only")).toBeInTheDocument();
    expect(within(detail).getByTestId("on-call-updated-date").textContent).toMatch(/^Updated 20 Sep 2026/);
    await userEvent.keyboard("{Escape}");

    await userEvent.click(screen.getByRole("button", { name: /Synthetic ward 4B/ }));
    const ward = screen.getByTestId("on-call-find-detail");
    expect(within(ward).getByText("Also known as HDU, high dependency")).toBeInTheDocument();
    expect(within(ward).queryByText(/Also known as:/)).toBeNull();
  });

  it("shows three rows of a long group with All N, and never shortens Systems down", async () => {
    const wards = Array.from({ length: 5 }, (_, index) => ({
      id: `w${index}`,
      title: `Ward: Synthetic ward ${index + 1}`,
      section: "resources" as const,
    }));
    const downtime = Array.from({ length: 4 }, (_, index) => ({
      id: `d${index}`,
      title: `Downtime: Synthetic outage ${index + 1}`,
      section: "resources" as const,
    }));
    handbook.state = ready(items([...wards, ...downtime]));
    render(<OnCallFindPage />);
    const wardGroup = document.getElementById("on-call-group-wards")!;
    expect(within(wardGroup).getAllByRole("listitem")).toHaveLength(3);
    expect(within(document.getElementById("on-call-group-downtime")!).getAllByRole("listitem")).toHaveLength(4);
    await userEvent.click(within(wardGroup).getByRole("button", { name: "Show all 5 wards" }));
    expect(within(wardGroup).getAllByRole("listitem")).toHaveLength(5);
    expect(within(wardGroup).queryByRole("button", { name: /Show all/ })).toBeNull();
  });

  it("shows a signed-out reader the sign-in state, the crisis lines and the On site link, and no hospital content", () => {
    handbook.state = ready([], { status: "signed-out" });
    render(<OnCallFindPage />);
    expect(screen.getByTestId("on-call-handbook-state-signed-out")).toBeInTheDocument();
    expect(document.querySelector('[id^="on-call-group-"]')).toBeNull();
    expect(screen.getByTestId("on-call-crisis-lines")).toBeInTheDocument();
    expect(screen.getByTestId("on-call-find-on-site")).toBeInTheDocument();
  });
});
