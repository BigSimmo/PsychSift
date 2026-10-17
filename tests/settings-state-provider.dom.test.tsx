/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  SettingsStateProvider,
  useSettingsState,
  __resetSettingsParamForTests,
} from "@/components/clinical-dashboard/SettingsStateProvider";

function SettingsHarness() {
  const { settingsOpen, setSettingsOpen, closeSettings } = useSettingsState();
  return (
    <div>
      <span data-testid="settings-state">{settingsOpen ? "open" : "closed"}</span>
      <button type="button" data-testid="close-settings" onClick={closeSettings}>
        Close settings
      </button>
      <button type="button" data-testid="set-false" onClick={() => setSettingsOpen(false)}>
        Set false
      </button>
      <button type="button" data-testid="toggle-settings" onClick={() => setSettingsOpen((prev) => !prev)}>
        Toggle
      </button>
    </div>
  );
}

function renderAt(url: string) {
  window.history.replaceState({}, "", url);
  __resetSettingsParamForTests();
  return render(
    <SettingsStateProvider>
      <SettingsHarness />
    </SettingsStateProvider>,
  );
}

beforeEach(() => {
  window.history.replaceState({}, "", "/");
  __resetSettingsParamForTests();
});

afterEach(() => {
  cleanup();
});

describe("SettingsStateProvider", () => {
  it("opens settings from ?settings=open, strips the query param, and closes when closeSettings() is called", async () => {
    await act(async () => {
      renderAt("/?settings=open");
    });

    expect(screen.getByTestId("settings-state").textContent).toBe("open");
    expect(window.location.search).toBe("");

    fireEvent.click(screen.getByTestId("close-settings"));
    expect(screen.getByTestId("settings-state").textContent).toBe("closed");
  });

  it("closes settings opened via ?settings=open when setSettingsOpen(false) or functional toggle is called", async () => {
    await act(async () => {
      renderAt("/?settings=open");
    });
    expect(screen.getByTestId("settings-state").textContent).toBe("open");

    fireEvent.click(screen.getByTestId("set-false"));
    expect(screen.getByTestId("settings-state").textContent).toBe("closed");

    fireEvent.click(screen.getByTestId("toggle-settings"));
    expect(screen.getByTestId("settings-state").textContent).toBe("open");

    fireEvent.click(screen.getByTestId("toggle-settings"));
    expect(screen.getByTestId("settings-state").textContent).toBe("closed");
  });
});
