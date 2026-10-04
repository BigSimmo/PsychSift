/** @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FirstNationsMenuActions } from "@/components/first-nations/page-menu";
import { resetAfterEach } from "./fixtures/first-nations-models";

vi.mock("@/components/first-nations/kit", async () => await import("./fixtures/first-nations-kit-double"));
resetAfterEach();

describe("FirstNationsMenuActions", () => {
  it("offers the pocket card and Log as CPD with the page only", () => {
    render(
      <FirstNationsMenuActions pageTitle="Talking" href="/first-nations/talking" reportHref={null} training={null} />,
    );
    expect(screen.getByRole("link", { name: "Pocket card" }).getAttribute("href")).toBe("/first-nations/card");
    expect(screen.getByRole("button", { name: "What am I reading?" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Log as CPD" }).getAttribute("href")).toBe(
      "/cme/new?title=First+Nations%3A+Talking&sourceUrl=%2Ffirst-nations%2Ftalking",
    );
    expect(screen.queryByRole("link", { name: "Report a wrong number" })).toBeNull();
  });
  it("offers Report a wrong number when there is somewhere to send it", () => {
    render(
      <FirstNationsMenuActions
        pageTitle="Contacts"
        href="/first-nations/contacts"
        reportHref="mailto:first-nations-numbers@example.org"
        training={null}
      />,
    );
    expect(screen.getByRole("link", { name: "Report a wrong number" }).getAttribute("href")).toMatch(/^mailto:/);
  });
});
