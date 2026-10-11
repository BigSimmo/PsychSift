/** @vitest-environment jsdom */

import { readFileSync } from "node:fs";

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import Loading from "@/app/(search-app)/on-call/loading";
import { OnCallCrisisLines } from "@/components/on-call/call/external-line-rows";

afterEach(cleanup);

describe("On Call loading crisis pack", () => {
  it("identifies the shared crisis pack as loading rather than a completed Now page", () => {
    render(<Loading />);
    expect(screen.getByText("Loading this On Call page…")).toHaveAttribute("role", "status");
    expect(screen.getByTestId("on-call-crisis-lines")).toBeInTheDocument();
    expect(screen.queryByTestId("on-call-home-main")).toBeNull();
  });

  it("keeps ModeHomeRouteLoading and mounts the crisis pack above it", () => {
    const source = readFileSync("src/app/(search-app)/on-call/loading.tsx", "utf8");
    expect(source).toContain("ModeHomeRouteLoading");
    expect(source).toContain("OnCallCrisisLines");
    expect(source.indexOf("OnCallCrisisLines")).toBeLessThan(source.indexOf("ModeHomeRouteLoading"));
  });

  it("renders the public crisis pack (000 / MHERL / Lifeline) with no new copy", () => {
    render(<OnCallCrisisLines />);
    const crisis = screen.getByTestId("on-call-crisis-lines");
    expect(within(crisis).getByRole("link", { name: /^call emergency services/i })).toHaveAttribute("href", "tel:000");
    expect(crisis).toHaveTextContent("1300 555 788");
    expect(crisis).toHaveTextContent("13 11 14");
  });
});
