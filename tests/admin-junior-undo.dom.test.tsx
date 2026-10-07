/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { JuniorUndoBar } from "@/components/admin/junior/junior-shared";
import { ToastProvider } from "@/components/ui/toast";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function Host({ onUndo, onDismiss }: { onUndo: () => void; onDismiss: () => void }) {
  const [label, setLabel] = useState<string | null>("Reminder off");
  return (
    <>
      <button type="button" onClick={() => setLabel("Newer change")}>
        Change again
      </button>
      {label ? (
        <JuniorUndoBar
          key={label}
          label={label}
          onUndo={() => {
            onUndo();
            setLabel(null);
          }}
          onDismiss={() => {
            onDismiss();
            setLabel(null);
          }}
          testId="admin-test-undo"
        />
      ) : null}
    </>
  );
}

describe("Admin Undo uses the shared toast, which sits above the dock and the safe area", () => {
  it("shows Undo in the shared toast region, not a bar of its own", () => {
    render(
      <ToastProvider>
        <Host onUndo={vi.fn()} onDismiss={vi.fn()} />
      </ToastProvider>,
    );
    expect(screen.queryByTestId("admin-test-undo")).toBeNull();
    const region = screen.getByTestId("toast-region");
    expect(region).toHaveClass("app-toast-region");
    expect(within(region).getByTestId("toast")).toHaveTextContent("Reminder off");
  });

  it("runs Undo from the toast, and does not then call dismiss", () => {
    const onUndo = vi.fn();
    const onDismiss = vi.fn();
    render(
      <ToastProvider>
        <Host onUndo={onUndo} onDismiss={onDismiss} />
      </ToastProvider>,
    );
    fireEvent.click(within(screen.getByTestId("toast")).getByRole("button", { name: "Undo" }));
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled();
    expect(screen.queryByTestId("toast")).toBeNull();
  });

  it("clears itself after ten seconds, and a newer Undo is never cleared by the old one", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(
      <ToastProvider>
        <Host onUndo={vi.fn()} onDismiss={onDismiss} />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Change again" }));
    expect(onDismiss).not.toHaveBeenCalled();
    expect(screen.getAllByTestId("toast")).toHaveLength(1);
    expect(screen.getByTestId("toast")).toHaveTextContent("Newer change");
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("toast")).toBeNull();
  });
});
