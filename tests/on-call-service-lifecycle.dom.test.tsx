/** @vitest-environment jsdom */

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ServicePage } from "@/components/on-call/service-page";
import type { ServiceDetail, ServiceSummary } from "@/lib/on-call/service-model";

const ownerId = "10000000-0000-4000-8000-000000000001";
const serviceId = "20000000-0000-4000-8000-000000000001";
const siteId = "30000000-0000-4000-8000-000000000001";
const auth = vi.hoisted(() => ({
  state: {
    status: "authenticated",
    authEpoch: 1,
    session: { user: { id: "10000000-0000-4000-8000-000000000001" } } as { user: { id: string } } | null,
  },
}));

vi.mock("@/lib/supabase/client", () => ({ useAuthSession: () => auth.state }));
vi.mock("@/components/clinical-dashboard/account-setup-dialog", () => ({
  AccountSetupDialog: () => null,
}));

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

function adminFixture(): { summary: ServiceSummary; detail: ServiceDetail } {
  const detail: ServiceDetail = {
    service: { id: serviceId, name: "Synthetic private service" },
    membership: { role: "admin", clinicalReviewer: false },
    sites: [{ id: siteId, name: "Synthetic private site" }],
    entries: [],
    members: [{ id: ownerId, role: "admin", clinicalReviewer: false, joinedAt: "2026-09-01T00:00:00Z" }],
    invitations: [],
    reports: [],
    orientation: [],
  };
  return {
    detail,
    summary: {
      id: serviceId,
      name: detail.service.name,
      ...detail.membership,
      sites: detail.sites,
    },
  };
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "false");
  auth.state.status = "authenticated";
  auth.state.authEpoch = 1;
  auth.state.session = { user: { id: ownerId } };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("Service handbook lifecycle isolation", () => {
  it("keeps the one-time invitation code visible across the required detail refresh", async () => {
    const user = userEvent.setup();
    const { summary, detail } = adminFixture();
    const invitationCode = "b".repeat(64);
    let listReads = 0;
    let detailReads = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/on-call/services" && !init?.method) {
        listReads += 1;
        return json({ services: [summary] });
      }
      if (url.startsWith(`/api/on-call/services/${serviceId}`) && !init?.method) {
        detailReads += 1;
        return json(detail);
      }
      if (url === `/api/on-call/services/${serviceId}` && init?.method === "POST") {
        expect(JSON.parse(String(init.body))).toEqual({
          action: "invitation.create",
          role: "member",
          expiresInDays: 3,
          invitedEmail: "dr.ivy@example.org",
        });
        return json({
          code: invitationCode,
          invitationId: "50000000-0000-4000-8000-000000000001",
          expiresAt: "2026-09-26T00:00:00Z",
        });
      }
      throw new Error(`Unexpected offline request: ${url}`);
    });

    render(<ServicePage initialServiceId={serviceId} initialSiteId={siteId} />);
    const navigation = await screen.findByRole("navigation", { name: "Service handbook sections" });
    await user.click(within(navigation).getByRole("button", { name: "Members" }));
    expect(screen.getByRole("button", { name: "Create invitation" })).toBeDisabled();
    await user.type(screen.getByLabelText(/Invitee's email/), "dr.ivy@example.org");
    await user.click(screen.getByRole("button", { name: "Create invitation" }));

    expect(await screen.findByText(invitationCode)).toBeVisible();
    expect(screen.getByText(/shown once and expires/i)).toBeVisible();
    expect(listReads).toBe(1);
    expect(detailReads).toBe(2);
  });

  it("hides the previous owner's detail immediately and ignores its late response after sign-out", async () => {
    const { summary, detail } = adminFixture();
    let releaseDetail: ((response: Response) => void) | undefined;
    const delayedDetail = new Promise<Response>((resolve) => {
      releaseDetail = resolve;
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/on-call/services") return json({ services: [summary] });
      if (url.startsWith(`/api/on-call/services/${serviceId}`)) return delayedDetail;
      throw new Error(`Unexpected offline request: ${url}`);
    });

    const view = render(<ServicePage initialServiceId={serviceId} initialSiteId={siteId} />);
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(2));

    auth.state.status = "signed_out";
    auth.state.authEpoch = 2;
    auth.state.session = null;
    view.rerender(<ServicePage initialServiceId={serviceId} initialSiteId={siteId} />);

    // Signed out now shows the invented sample service, never the previous owner's.
    expect(screen.getByText(/Synthetic demonstration only/)).toBeVisible();
    expect(screen.queryByText("Synthetic private service")).toBeNull();

    releaseDetail?.(json(detail));
    await waitFor(() => expect(screen.getByText(/Synthetic demonstration only/)).toBeVisible());
    expect(screen.queryByText("Synthetic private service")).toBeNull();
  });
});
