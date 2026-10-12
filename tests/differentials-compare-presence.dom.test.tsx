import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  useDifferentialsCompareHasSelection,
  usePublishDifferentialsCompareCount,
} from "@/components/differentials/compare-presence";

function List({ count }: { count: number }) {
  usePublishDifferentialsCompareCount(count);
  return null;
}

function Shell() {
  return <p data-testid="claim">{useDifferentialsCompareHasSelection() ? "claimed" : "free"}</p>;
}

describe("differentials compare presence", () => {
  it("claims the dock only while a diagnosis is ticked, and releases on unmount", () => {
    const { rerender } = render(
      <>
        <Shell />
        <List count={0} />
      </>,
    );
    expect(screen.getByTestId("claim").textContent).toBe("free");

    act(() =>
      rerender(
        <>
          <Shell />
          <List count={2} />
        </>,
      ),
    );
    expect(screen.getByTestId("claim").textContent).toBe("claimed");

    act(() => rerender(<Shell />));
    expect(screen.getByTestId("claim").textContent).toBe("free");
  });
});
