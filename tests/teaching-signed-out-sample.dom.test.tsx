/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ pathname: "/teaching" }));
vi.mock("next/navigation", async (original) => ({
  ...(await original<object>()),
  usePathname: () => state.pathname,
  useRouter: () => ({ push: () => undefined, replace: () => undefined, prefetch: () => undefined }),
}));
vi.mock("@/lib/supabase/client", () => import("./helpers/teaching-auth"));
vi.mock("@/components/clinical-dashboard/account-setup-dialog", () => ({
  AccountSetupDialog: ({ open }: { open: boolean }) => (open ? <div data-testid="sign-in-dialog" /> : null),
}));

import { TeachingSampleChrome } from "@/components/teaching/teaching-sample-notice";
import { TeachingCollection } from "@/components/teaching/teaching-collection";
import { TeachingLogbook } from "@/components/teaching/teaching-logbook";
import { TeachingResources } from "@/components/teaching/teaching-resources";
import { TeachingToday } from "@/components/teaching/teaching-today";
import { TeachingWhatsOn } from "@/components/teaching/teaching-whats-on";
import { authState } from "./helpers/teaching-auth";
import { NOW, apiError, serveFetch, useTeachingTestClock } from "./helpers/teaching-fixtures";

// eslint-disable-next-line react-hooks/rules-of-hooks
useTeachingTestClock(NOW);

function signedOutWith(status: "signed_out" | "expired" = "signed_out") {
  authState.status = status as never;
  const fetchMock = serveFetch(() => apiError(401, "authentication_required"));
  const storageWrites = [vi.spyOn(Storage.prototype, "setItem")];
  return { fetchMock, storageWrites };
}

describe("signed-out Teaching sample, the default", () => {
  it("shows the shared sign-in notice above every page, with no Leave the sample and no cookie", async () => {
    signedOutWith();
    const cookieWrite = vi.spyOn(document, "cookie", "set");
    render(<TeachingSampleChrome cookieSample={false} />);
    expect(screen.getByTestId("teaching-signed-out-sample")).toHaveTextContent("Sign in to see your teaching");
    expect(screen.queryByTestId("teaching-sample-leave")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByTestId("sign-in-dialog")).toBeInTheDocument();
    expect(cookieWrite).not.toHaveBeenCalled();
  });

  it("treats an expired sign-in the same way, and keeps off the check-in landing", () => {
    signedOutWith("expired");
    const { rerender } = render(<TeachingSampleChrome cookieSample />);
    expect(screen.getByTestId("teaching-signed-out-sample")).toBeInTheDocument();
    expect(screen.queryByTestId("teaching-sample-banner")).not.toBeInTheDocument();
    state.pathname = "/teaching/c/token";
    rerender(<TeachingSampleChrome cookieSample />);
    expect(screen.queryByTestId("teaching-signed-out-sample")).not.toBeInTheDocument();
    state.pathname = "/teaching";
  });

  it("leaves a signed-in reader unchanged: no notice, and the old cookie banner only if the cookie is on", () => {
    const { rerender } = render(<TeachingSampleChrome cookieSample={false} />);
    expect(screen.queryByTestId("teaching-signed-out-sample")).not.toBeInTheDocument();
    expect(screen.queryByTestId("teaching-sample-banner")).not.toBeInTheDocument();
    rerender(<TeachingSampleChrome cookieSample />);
    expect(screen.getByTestId("teaching-sample-leave")).toBeInTheDocument();
  });

  it("fills Today with the made-up programme and makes no request and no storage write", async () => {
    const { fetchMock, storageWrites } = signedOutWith();
    render(<TeachingToday demoMode={false} />);
    expect(await screen.findByText("Demo · made-up people")).toBeInTheDocument();
    expect(screen.queryByTestId("teaching-state-signed-out")).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    for (const write of storageWrites) expect(write).not.toHaveBeenCalled();
  });

  it("fills the logbook and says a log is not saved", async () => {
    const { fetchMock } = signedOutWith();
    render(<TeachingLogbook demoMode={false} />);
    await waitFor(() => expect(screen.queryByTestId("teaching-state-signed-out")).not.toBeInTheDocument());
    expect(await screen.findAllByText(/journal club/i)).not.toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("builds Resources, a collection and What's on in the browser and refuses saves locally", async () => {
    const { fetchMock } = signedOutWith();
    const resources = render(<TeachingResources demoMode={false} />);
    // The sample offers New collection, as the mock-up does, and refuses to create it locally.
    fireEvent.click(await screen.findByRole("button", { name: "New collection" }));
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "Reading list" } });
    fireEvent.click(screen.getByRole("button", { name: "Create collection" }));
    expect(await screen.findByText("The sample doesn’t save changes.")).toBeInTheDocument();
    resources.unmount();
    render(<TeachingCollection collection="saved" demoMode={false} />);
    await waitFor(() => expect(screen.queryByTestId("teaching-state-signed-out")).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Add a resource" })).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("builds What's on without a request", async () => {
    const { fetchMock } = signedOutWith();
    render(<TeachingWhatsOn demoMode={false} />);
    const add = await screen.findAllByRole("button", { name: /^Add .* to my week$/ });
    fireEvent.click(add[0]);
    await waitFor(() => expect(screen.getByText("The sample doesn’t save changes.")).toBeInTheDocument());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not use the sample for a signed-in reader: Today still asks the API", async () => {
    const fetchMock = serveFetch(() => apiError(401, "teaching_signed_out"));
    render(<TeachingToday demoMode={false} />);
    await screen.findByTestId("teaching-state-signed-out");
    expect(fetchMock).toHaveBeenCalled();
  });
});
