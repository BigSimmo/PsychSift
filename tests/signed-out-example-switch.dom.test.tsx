/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SignedOutExampleSwitch } from "@/components/mode-kit/signed-out-example-switch";

const sample = vi.hoisted(() => ({ active: true }));
vi.mock("@/components/mode-kit/use-signed-out-sample", () => ({
  useSignedOutSample: () => sample.active,
}));

afterEach(() => {
  cleanup();
  sample.active = true;
});

describe("SignedOutExampleSwitch", () => {
  function renderSwitch() {
    render(
      <SignedOutExampleSwitch
        area="admin"
        example={<p data-testid="example">Example</p>}
        notice={<p data-testid="notice">Sign in</p>}
      />,
    );
  }

  it("shows the example while example data shows in the area", () => {
    renderSwitch();
    expect(screen.getByTestId("example")).toBeTruthy();
    expect(screen.queryByTestId("notice")).toBeNull();
  });

  it("shows the sign-in notice once example data is off", () => {
    sample.active = false;
    renderSwitch();
    expect(screen.getByTestId("notice")).toBeTruthy();
    expect(screen.queryByTestId("example")).toBeNull();
  });
});
