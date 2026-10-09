/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ pathname: "/teaching", cookie: "1" }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: state.cookie }) }) }));
vi.mock("@/lib/env", async (original) => ({ ...(await original<object>()), isDemoMode: () => false }));
vi.mock("next/navigation", async (original) => ({
  ...(await original<object>()),
  usePathname: () => state.pathname,
  useRouter: () => ({ push: () => undefined, replace: () => undefined, prefetch: () => undefined }),
}));
vi.mock("@/lib/supabase/client", () => import("./helpers/teaching-auth"));

import ResourcesRoute from "@/app/(search-app)/teaching/resources/page";
import CollectionRoute from "@/app/(search-app)/teaching/resources/[collectionId]/page";
import WhatsOnRoute from "@/app/(search-app)/teaching/whats-on/page";
import { teachingSampleEntryHref } from "@/lib/teaching/sample-paths";
import { authState } from "./helpers/teaching-auth";
import { NOW, apiError, serveFetch, useTeachingTestClock } from "./helpers/teaching-fixtures";

// eslint-disable-next-line react-hooks/rules-of-hooks
useTeachingTestClock(NOW);

describe("signed-out Teaching sample in production", () => {
  it("reads synthetic resources and collections with no Teaching API request or save", async () => {
    authState.status = "signed_out";
    const fetchMock = serveFetch(() => apiError(401, "authentication_required"));
    const { unmount } = render(await ResourcesRoute());
    // The sample offers New collection, as the mock-up does, and refuses to create it locally.
    fireEvent.click(await screen.findByRole("button", { name: "New collection" }));
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "Reading list" } });
    fireEvent.click(screen.getByRole("button", { name: "Create collection" }));
    expect(await screen.findByText("The sample doesn’t save changes.")).toBeInTheDocument();
    const collection = screen
      .getByRole("link", { name: /Exam prep/ })
      .getAttribute("href")!
      .split("/")
      .at(-1)!;
    unmount();
    render(await CollectionRoute({ params: Promise.resolve({ collectionId: collection }) }));
    expect(await screen.findByRole("heading", { name: "Exam prep" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add a resource" })).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reads What's on without an API request and refuses personal writes locally", async () => {
    authState.status = "signed_out";
    const fetchMock = serveFetch(() => apiError(401, "authentication_required"));
    render(await WhatsOnRoute());
    const add = await screen.findAllByRole("button", { name: /^Add .* to my week$/ });
    fireEvent.click(add[0]);
    await waitFor(() => expect(screen.getByText("The sample doesn’t save changes.")).toBeInTheDocument());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("enters from live record deep links at a usable sample page", () => {
    for (const path of ["/teaching/session/123?check-in=scan", "/teaching/team/123", "/teaching/resources/123"]) {
      expect(teachingSampleEntryHref(path)).toBe("/teaching/sample?next=%2Fteaching");
    }
  });
});
