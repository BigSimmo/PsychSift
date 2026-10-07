/** @vitest-environment jsdom */

// Example data UI: the banner under the band (only while the area shows
// examples, Turn off and Undo), the blocked-action sheet it hosts, the
// settings switch with its area count, and the Example tag.

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  status: "authenticated",
  authEpoch: 1,
  session: { user: { created_at: "2020-01-01T00:00:00Z" } },
}));
vi.mock("@/lib/supabase/client", () => ({
  useAuthSession: () => auth,
}));

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }),
}));

import { ExampleDataBanner } from "@/components/example-data/example-data-banner";
import { ExampleDataSwitch } from "@/components/example-data/example-data-switch";
import { ExampleTag } from "@/components/example-data/example-tag";
import { ToastProvider } from "@/components/ui/toast";
import { guardExampleAction } from "@/lib/example-data/guards";
import { exampleAreasLine } from "@/lib/example-data/labels";
import {
  markRealRecordAdded,
  readExampleData,
  resetExampleDataForTests,
  setExampleDataOn,
} from "@/lib/example-data/store";

beforeEach(() => {
  window.localStorage.clear();
  document.cookie = "psychsift_example_data=; Path=/; Max-Age=0";
  resetExampleDataForTests();
  refresh.mockClear();
});

afterEach(() => {
  cleanup();
});

function renderBanner() {
  return render(
    <ToastProvider>
      <ExampleDataBanner area="rost" />
    </ToastProvider>,
  );
}

describe("ExampleDataBanner", () => {
  it("draws nothing while the area shows real data", () => {
    renderBanner();
    expect(screen.queryByRole("region", { name: "Example data" })).toBeNull();
  });

  it("shows while example data is on, and Turn off then Undo switch it off and back on", () => {
    act(() => setExampleDataOn(true));
    renderBanner();
    const banner = screen.getByRole("region", { name: "Example data" });
    expect(within(banner).getByText("Made-up data to look around. Nothing is saved.")).toBeTruthy();
    expect(within(banner).getByText("Example")).toBeTruthy();

    fireEvent.click(within(banner).getByRole("button", { name: "Turn off example data" }));
    expect(screen.queryByRole("region", { name: "Example data" })).toBeNull();
    expect(screen.getByText("Example data off")).toBeTruthy();
    expect(refresh).toHaveBeenCalled();

    refresh.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByRole("region", { name: "Example data" })).toBeTruthy();
    expect(refresh).toHaveBeenCalled();
  });

  it("returns auto mode to auto on Undo, not to an explicit on", () => {
    // A brand new account sees examples in auto mode without ever choosing.
    auth.session.user.created_at = new Date().toISOString();
    try {
      renderBanner();
      expect(readExampleData().choice).toBeNull();
      const banner = screen.getByRole("region", { name: "Example data" });

      fireEvent.click(within(banner).getByRole("button", { name: "Turn off example data" }));
      expect(readExampleData().choice).toBe("off");
      expect(screen.queryByRole("region", { name: "Example data" })).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "Undo" }));
      expect(readExampleData().choice).toBeNull();
      expect(screen.getByRole("region", { name: "Example data" })).toBeTruthy();
    } finally {
      auth.session.user.created_at = "2020-01-01T00:00:00Z";
    }
  });

  it("offers Sign in only to a signed-out visitor", () => {
    act(() => setExampleDataOn(true));
    renderBanner();
    expect(screen.queryByTestId("example-data-banner-sign-in")).toBeNull();
    cleanup();

    auth.status = "signed_out";
    try {
      renderBanner();
      const banner = screen.getByRole("region", { name: "Example data" });
      expect(within(banner).getByRole("button", { name: "Sign in" })).toBeTruthy();
      expect(within(banner).getByRole("button", { name: "Turn off example data" })).toBeTruthy();
    } finally {
      auth.status = "authenticated";
    }
  });

  it("goes when a real record is added in its area", () => {
    act(() => setExampleDataOn(true));
    renderBanner();
    expect(screen.getByRole("region", { name: "Example data" })).toBeTruthy();
    act(() => markRealRecordAdded("rost"));
    expect(screen.queryByRole("region", { name: "Example data" })).toBeNull();
  });

  it("opens the blocked sheet with the action's words, and its button turns example data off", async () => {
    act(() => setExampleDataOn(true));
    renderBanner();

    act(() => {
      expect(guardExampleAction(true, "share")).toBe(false);
    });
    const sheet = screen.getByRole("dialog", { name: "Example data can't be shared" });
    expect(within(sheet).getByText("Turn it off to share your own records.")).toBeTruthy();
    // Focus moves into the sheet.
    await waitFor(() => expect(sheet.contains(document.activeElement)).toBe(true));

    fireEvent.click(within(sheet).getByRole("button", { name: "Turn off example data" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("region", { name: "Example data" })).toBeNull();
    expect(screen.getByText("Example data off")).toBeTruthy();
  });

  it("words every action, and Cancel or Escape close the sheet without turning anything off", () => {
    act(() => setExampleDataOn(true));
    renderBanner();

    act(() => {
      guardExampleAction(true, "export");
    });
    expect(screen.getByRole("dialog", { name: "Example data can't be exported" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    act(() => {
      guardExampleAction(true, "copy");
    });
    const sheet = screen.getByRole("dialog", { name: "Example data can't be copied" });
    expect(within(sheet).getByText("Turn it off to copy your own records.")).toBeTruthy();
    fireEvent.keyDown(document.activeElement ?? sheet, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("region", { name: "Example data" })).toBeTruthy();
  });

  it("lets the action through when the area shows real data", () => {
    renderBanner();
    act(() => {
      expect(guardExampleAction(false, "export")).toBe(true);
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("ExampleDataSwitch", () => {
  it("toggles the one switch and says how many areas show examples", () => {
    render(<ExampleDataSwitch />);
    const toggle = screen.getByRole("switch", { name: "Example data" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(screen.getByText("Made-up data in every area")).toBeTruthy();
    expect(screen.queryByText(/Showing in/)).toBeNull();

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(
      screen.getByText("Showing in 7 areas. Turns off in an area when you add your own record there."),
    ).toBeTruthy();
    expect(screen.getByRole("list", { name: "Areas showing example data" }).querySelectorAll("li")).toHaveLength(7);

    act(() => markRealRecordAdded("cpd"));
    expect(screen.getByText(/Showing in 6 areas/)).toBeTruthy();

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(screen.queryByText(/Showing in/)).toBeNull();
  });

  it("says one area in the singular, and draws bare without its card inline", () => {
    expect(exampleAreasLine(1)).toBe("Showing in 1 area. Turns off in an area when you add your own record there.");
    render(<ExampleDataSwitch variant="inline" />);
    expect(screen.getByTestId("example-data-setting").className).not.toContain("work-card");
    fireEvent.click(screen.getByRole("switch", { name: "Example data" }));
    expect(screen.getByText(/Showing in 7 areas/)).toBeTruthy();
    expect(screen.getByRole("list", { name: "Areas showing example data" })).toBeTruthy();
  });
});

describe("ExampleTag", () => {
  it("reads as an example record", () => {
    render(<ExampleTag />);
    expect(screen.getByRole("img", { name: "Example record" }).textContent).toBe("Example");
  });
});
