/** @vitest-environment jsdom */
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ServicePage } from "@/components/on-call/service-page";
import type { ServiceContent, ServiceDetail, ServiceEntry, ServiceSummary } from "@/lib/on-call/service-model";

const auth = vi.hoisted(() => ({ useAuthSession: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ useAuthSession: auth.useAuthSession }));
const ownerId = "10000000-0000-4000-8000-000000000001";
const serviceId = "20000000-0000-4000-8000-000000000001";
const siteId = "30000000-0000-4000-8000-000000000001";
const contactId = "40000000-0000-4000-8000-000000000001";
const teachingId = "40000000-0000-4000-8000-000000000002";
const adminId = "40000000-0000-4000-8000-000000000003";
const orientationId = "40000000-0000-4000-8000-000000000004";
function entry(
  id: string,
  section: ServiceContent["section"],
  title: string,
  extra: Partial<ServiceContent> = {},
): ServiceEntry {
  const content: ServiceContent = {
    siteId,
    section,
    kind: "operational",
    title,
    body: "Synthetic service information only",
    phone: "",
    sources: [],
    orientationPhase: "first_shift",
    ...extra,
  };
  return {
    id,
    revision: 1,
    publishedRevision: 1,
    content,
    publishedContent: content,
    status: "published",
    authorId: ownerId,
    reviewedBy: null,
    reviewedAt: null,
    reviewComment: "",
    updatedAt: "2026-09-23T00:00:00Z",
  };
}
function fixture(): ServiceDetail {
  return {
    service: { id: serviceId, name: "Synthetic invited service" },
    membership: { role: "member", clinicalReviewer: false },
    sites: [{ id: siteId, name: "Synthetic site" }],
    entries: [
      entry(contactId, "contacts", "Synthetic local contact", {
        phone: "08 5555 0100",
        sources: [{ label: "Official local source", url: "https://example.org/local-source" }],
      }),
      entry(teachingId, "teaching", "Synthetic teaching meeting", {
        sources: [{ label: "Teaching source", url: "https://example.org/teaching" }],
      }),
      entry(adminId, "admin", "Synthetic roster change"),
      entry(orientationId, "orientation", "Collect the synthetic handset"),
    ],
    members: [],
    invitations: [],
    reports: [],
    orientation: [],
  };
}
function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}
function mockServiceApi(pendingOrientation = false) {
  const detail = fixture();
  if (pendingOrientation) {
    detail.membership.role = "editor";
    detail.entries = detail.entries.map((item) =>
      item.id === orientationId
        ? {
            ...item,
            revision: 3,
            status: "pending_review",
            content: { ...item.content, title: "Unpublished revised handset checklist" },
          }
        : item,
    );
  }
  const summary: ServiceSummary = {
    id: serviceId,
    name: detail.service.name,
    ...detail.membership,
    sites: detail.sites,
  };
  const writes: { url: string; body: Record<string, unknown> }[] = [];
  const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      writes.push({ url, body });
      if (url === `/api/on-call/services/${serviceId}` && body.action === "orientation.set") {
        detail.orientation = body.completed
          ? [
              {
                entryId: orientationId,
                siteId,
                rotation: String(body.rotation),
                revision: 1,
                completedAt: "2026-09-23T00:00:00Z",
              },
            ]
          : [];
        return json({ ok: true });
      }
      if (url === "/api/on-call/services" || url === "/api/on-call/services/join")
        return json({ message: "Synthetic request refusal" }, 503);
      throw new Error(`Unexpected synthetic mutation: ${url}`);
    }
    if (url === "/api/on-call/services") return json({ services: [summary] });
    if (url.startsWith(`/api/on-call/services/${serviceId}?`)) return json(detail);
    throw new Error(`Unexpected request blocked in offline test: ${url}`);
  });
  return { fetcher, writes };
}
async function openService() {
  await act(async () => {
    render(<ServicePage initialServiceId={serviceId} initialSiteId={siteId} initialRotation="Term 1 2027" />);
  });
  await screen.findByTestId(`service-entry-${contactId}`);
}
beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "false");
  auth.useAuthSession.mockReturnValue({ status: "authenticated", authEpoch: 1, session: { user: { id: ownerId } } });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("Invited service handbook through the actual UI", () => {
  it("loads authenticated service/site/role context and wires local contact, source and explicit learning actions", async () => {
    const api = mockServiceApi();
    await openService();
    expect(screen.getByTestId("service-context-banner")).toHaveTextContent(
      "Synthetic invited service · Synthetic site · Member · Term 1 2027",
    );
    expect(api.fetcher).toHaveBeenCalledWith("/api/on-call/services", expect.objectContaining({ cache: "no-store" }));
    expect(api.fetcher).toHaveBeenCalledWith(
      `/api/on-call/services/${serviceId}?siteId=${siteId}&rotation=Term+1+2027`,
      expect.objectContaining({ cache: "no-store" }),
    );
    const contact = within(screen.getByTestId(`service-entry-${contactId}`));
    // One formatter (kit 1.2): the hospital's own list writes the number short,
    // the link still dials 08, and its name speaks the digits one by one.
    const call = contact.getByRole("link", { name: /^Call 5555 0100 \(5 5 5 5, 0 1 0 0\), / });
    expect(call).toHaveAttribute("href", "tel:0855550100");
    expect(call).toHaveTextContent("Call 5555 0100");
    expect(contact.getByRole("link", { name: "Official local source" })).toHaveAttribute(
      "href",
      "https://example.org/local-source",
    );
    const learning = new URL(
      contact.getByRole("link", { name: "Log this learning" }).getAttribute("href")!,
      "https://example.invalid",
    );
    expect(learning.pathname).toBe("/cme/new");
    expect(learning.searchParams.get("title")).toBe("Synthetic local contact");
    expect(learning.searchParams.get("sourceUrl")).toBe("https://example.org/local-source");
    expect([...learning.searchParams.keys()].sort()).toEqual(["sourceUrl", "title"]);
    expect(api.writes).toEqual([]);
  });
  it("searches teaching and administration entries without recording learning or hiding the selected context", async () => {
    const user = userEvent.setup();
    const api = mockServiceApi();
    await openService();
    const search = screen.getByRole("searchbox", { name: "Search service handbook" });
    await user.type(search, "teaching meeting");
    expect(screen.getByTestId(`service-entry-${teachingId}`)).toBeInTheDocument();
    expect(screen.queryByTestId(`service-entry-${contactId}`)).toBeNull();
    expect(screen.queryByTestId(`service-entry-${adminId}`)).toBeNull();
    await user.clear(search);
    await user.type(search, "roster");
    expect(screen.getByTestId(`service-entry-${adminId}`)).toBeInTheDocument();
    expect(screen.queryByTestId(`service-entry-${teachingId}`)).toBeNull();
    expect(screen.getByTestId("service-context-banner")).toHaveTextContent("Synthetic site");
    expect(api.writes).toEqual([]);
  });
  it("copies all four blank heading structures and offers no patient-entry inputs", async () => {
    const user = userEvent.setup();
    const api = mockServiceApi();
    await openService();
    const blank = screen.getByRole("region", { name: "Blank documentation structures" });
    expect(blank.querySelectorAll("input,textarea,[contenteditable=true]")).toHaveLength(0);
    expect(blank).toHaveTextContent("Do not type or store patient details");
    const structures = [
      [
        "Telephone advice structure",
        "Date and time\nCaller and service\nReason for call\nInformation provided\nAdvice given\nAgreed actions\nEscalation\nFollow-up responsibility",
      ],
      [
        "Assessment structure",
        "Reason for assessment\nSources of information\nHistory\nMental state examination\nPhysical health\nRisk assessment\nImpression\nPlan\nReview and follow-up",
      ],
      [
        "Transfer structure",
        "Reason for transfer\nReferring and receiving teams\nClinical summary\nOutstanding tasks\nDocuments and communication\nTransfer arrangements\nHandover confirmation",
      ],
      [
        "Handover structure",
        "Situation\nBackground\nAssessment\nRecommendation\nOutstanding tasks\nResponsible clinician\nReview timeframe",
      ],
    ] as const;
    expect(within(blank).getAllByRole("button", { name: "Copy blank structure" })).toHaveLength(4);
    for (const [title, text] of structures) {
      const block = within(blank).getByText(title).parentElement!;
      await user.click(within(block).getByRole("button", { name: "Copy blank structure" }));
      await waitFor(() => expect(within(block).getByRole("status")).toHaveTextContent(`${title} copied.`));
      expect(await navigator.clipboard.readText()).toBe(text);
    }
    expect(api.writes).toEqual([]);
  });
  it("toggles the published orientation revision on and off while a newer draft awaits review", async () => {
    const user = userEvent.setup();
    const api = mockServiceApi(true);
    await openService();
    await user.click(
      within(screen.getByRole("navigation", { name: "Service handbook sections" })).getByRole("button", {
        name: "Orientation",
      }),
    );
    expect(screen.getByTestId("service-orientation")).toHaveTextContent("Completion is private to your account");
    expect(screen.getByTestId("service-orientation")).toHaveTextContent("Collect the synthetic handset");
    expect(screen.getByTestId("service-orientation")).not.toHaveTextContent("Unpublished revised handset checklist");
    expect(api.writes).toEqual([]);
    await user.click(screen.getByRole("button", { name: "Mark complete" }));
    await screen.findByRole("button", { name: "Completed" });
    expect(api.writes).toEqual([
      {
        url: `/api/on-call/services/${serviceId}`,
        body: { action: "orientation.set", entryId: orientationId, siteId, rotation: "Term 1 2027", completed: true },
      },
    ]);
    await user.click(screen.getByRole("button", { name: "Completed" }));
    await screen.findByRole("button", { name: "Mark complete" });
    expect(screen.queryByRole("button", { name: "Completed" })).toBeNull();
    expect(api.writes).toEqual([
      {
        url: `/api/on-call/services/${serviceId}`,
        body: { action: "orientation.set", entryId: orientationId, siteId, rotation: "Term 1 2027", completed: true },
      },
      {
        url: `/api/on-call/services/${serviceId}`,
        body: { action: "orientation.set", entryId: orientationId, siteId, rotation: "Term 1 2027", completed: false },
      },
    ]);
  });
  it("sends bounded create/join bodies and retains form fields when those requests fail", async () => {
    const user = userEvent.setup();
    const api = mockServiceApi();
    await openService();
    await user.click(
      within(screen.getByRole("navigation", { name: "Service handbook sections" })).getByRole("button", {
        name: "Services",
      }),
    );
    await user.type(screen.getByRole("textbox", { name: "Service name" }), "  Synthetic new service  ");
    await user.type(screen.getByRole("textbox", { name: "First site" }), "  Synthetic new site  ");
    await user.click(screen.getByRole("button", { name: "Create service" }));
    await screen.findByText("Synthetic request refusal");
    expect(api.writes[0]).toEqual({
      url: "/api/on-call/services",
      body: { name: "Synthetic new service", siteName: "Synthetic new site" },
    });
    expect(screen.getByRole("textbox", { name: "Service name" })).toHaveValue("  Synthetic new service  ");
    await user.type(screen.getByRole("textbox", { name: "Invitation code" }), `  ${"a".repeat(64)}  `);
    await user.click(screen.getByRole("button", { name: "Join service" }));
    await waitFor(() => expect(api.writes).toHaveLength(2));
    expect(api.writes[1]).toEqual({ url: "/api/on-call/services/join", body: { code: "a".repeat(64) } });
  });
  it("describes the report box with its no-patient-details hint", async () => {
    const user = userEvent.setup();
    mockServiceApi();
    await openService();
    await user.click(
      within(screen.getByTestId(`service-entry-${contactId}`)).getByRole("button", { name: "Flag incorrect entry" }),
    );
    const box = screen.getByLabelText("What needs correcting?");
    const describedBy = box.getAttribute("aria-describedby") ?? "";
    expect(describedBy).not.toBe("");
    const hint = describedBy
      .split(" ")
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" ");
    expect(hint).toMatch(/Do not include patient details/);
  });
  it("shows Import and Needs checking to editors only", async () => {
    mockServiceApi();
    await openService();
    const memberTabs = within(screen.getByRole("navigation", { name: "Service handbook sections" }));
    expect(memberTabs.queryByRole("button", { name: "Import" })).toBeNull();
    expect(memberTabs.queryByRole("button", { name: "Needs checking" })).toBeNull();
    cleanup();
    vi.restoreAllMocks();
    const user = userEvent.setup();
    mockServiceApi(true);
    await openService();
    const editorTabs = within(screen.getByRole("navigation", { name: "Service handbook sections" }));
    await user.click(editorTabs.getByRole("button", { name: "Import" }));
    expect(screen.getByLabelText("Choose a CSV file")).toBeInTheDocument();
    await user.click(editorTabs.getByRole("button", { name: "Needs checking" }));
    expect(screen.getByRole("heading", { name: "What needs checking" })).toBeInTheDocument();
    expect(screen.getByTestId(`service-checking-row-${contactId}`)).toBeInTheDocument();
  });
});
