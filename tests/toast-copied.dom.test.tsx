/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DashboardShell } from "@/components/clinical-dashboard/dashboard-shell";
import { CopyButton } from "@/components/ui/copy-button";
import { ToastProvider, useCopyToast } from "@/components/ui/toast";

afterEach(cleanup);

function TestCopyConsumer() {
  const showCopyToast = useCopyToast();
  return (
    <button type="button" onClick={() => showCopyToast()}>
      Trigger Toast
    </button>
  );
}

describe("Unified copy toast feedback (#HWYCPF)", () => {
  it("pushes a success toast with 'Copied to clipboard' via useCopyToast", () => {
    render(
      <ToastProvider>
        <TestCopyConsumer />
      </ToastProvider>,
    );

    const button = screen.getByRole("button", { name: "Trigger Toast" });
    act(() => {
      fireEvent.click(button);
    });

    const toast = screen.getByTestId("toast");
    expect(toast).toBeInTheDocument();
    expect(toast).toHaveAttribute("data-tone", "success");
    expect(screen.getByText("Copied to clipboard")).toBeInTheDocument();
  });

  it("fires copy toast when CopyButton is clicked inside ToastProvider", () => {
    const handleCopy = vi.fn();
    render(
      <ToastProvider>
        <CopyButton label="Copy doses" copied={false} onClick={handleCopy} testId="copy-btn" />
      </ToastProvider>,
    );

    const button = screen.getByTestId("copy-btn");
    act(() => {
      fireEvent.click(button);
    });

    expect(handleCopy).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Copied to clipboard")).toBeInTheDocument();
  });

  it("does not crash when CopyButton is used outside ToastProvider", () => {
    const handleCopy = vi.fn();
    render(<CopyButton label="Copy text" copied={false} onClick={handleCopy} testId="copy-outside" />);

    const button = screen.getByTestId("copy-outside");
    expect(() => {
      act(() => {
        fireEvent.click(button);
      });
    }).not.toThrow();

    expect(handleCopy).toHaveBeenCalledTimes(1);
  });

  it("renders within DashboardShell without duplicate toast regions or duplicate toast items", () => {
    render(
      <ToastProvider>
        <DashboardShell>
          <TestCopyConsumer />
        </DashboardShell>
      </ToastProvider>,
    );

    const button = screen.getByRole("button", { name: "Trigger Toast" });
    act(() => {
      fireEvent.click(button);
    });

    const toasts = screen.getAllByTestId("toast");
    expect(toasts).toHaveLength(1);
    const regions = screen.getAllByTestId("toast-region");
    expect(regions).toHaveLength(1);
  });
});
