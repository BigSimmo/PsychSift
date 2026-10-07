/** @vitest-environment jsdom */

// The sign-in dialog behind the signed-out Sample box loads on first open and
// then stays mounted, so closing it runs the sheet's normal close and puts
// focus back on the Sign in button.

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/dynamic", async () => {
  const { lazy, Suspense, createElement } = await import("react");
  return {
    default: (load: () => Promise<React.ComponentType<Record<string, unknown>>>) => {
      const Lazy = lazy(async () => ({ default: await load() }));
      return (props: Record<string, unknown>) =>
        createElement(Suspense, { fallback: null }, createElement(Lazy, props));
    },
  };
});
vi.mock("@/components/clinical-dashboard/account-setup-dialog", async () => {
  const { Sheet } = await import("@/components/ui/sheet");
  return {
    AccountSetupDialog: ({ open, onClose }: { open: boolean; onClose: () => void }) => (
      <Sheet open={open} onClose={onClose} title="Account setup" closeLabel="Close account setup">
        <p>Sign in here</p>
      </Sheet>
    ),
  };
});

import { SignedOutSampleNotice } from "@/components/mode-kit/signed-out-sample";

afterEach(() => cleanup());

describe("SignedOutSampleNotice sign-in dialog", () => {
  it("returns focus to the Sign in button when the dialog closes", async () => {
    render(
      <SignedOutSampleNotice title="Sign in to see your day" testId="sample">
        Invented example.
      </SignedOutSampleNotice>,
    );
    const trigger = screen.getByRole("button", { name: "Sign in" });
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole("button", { name: "Close account setup" }));
    await waitFor(() => expect(screen.queryByText("Sign in here")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});
