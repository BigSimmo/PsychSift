import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import DifferentialDiagnosisRoute, {
  dynamicParams as diagnosisDynamicParams,
  generateMetadata as generateDiagnosisMetadata,
} from "../src/app/(search-app)/differentials/diagnoses/[slug]/page";
import DifferentialPresentationRoute, {
  dynamicParams as presentationDynamicParams,
  generateMetadata as generatePresentationMetadata,
} from "../src/app/(search-app)/differentials/presentations/[slug]/page";
import { getDifferentialDetailContext, getDifferentialRecord, getPresentationWorkflow } from "@/lib/differentials";

const authSession = vi.hoisted(() => ({
  authorizationHeader: { Authorization: "Bearer differential-release-page-test" } as Record<string, string>,
  markSessionExpired: vi.fn(),
  session: { user: { id: "release-page-user" } },
  status: "authenticated" as const,
}));

vi.mock("@/lib/supabase/client", () => ({
  useAuthSession: () => authSession,
}));

vi.mock("@/components/account-data-provider", () => ({
  useAccountData: () => ({
    isSaved: () => false,
    setFavourite: vi.fn(async () => true),
    isAuthenticated: true,
  }),
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  usePathname: () => "/differentials/presentations/release-only-presentation",
  useRouter: () => ({ back: vi.fn(), replace: vi.fn(), push: vi.fn() }),
}));

const bundledDiagnosis = getDifferentialRecord("delirium")!;
const bundledPresentation = getPresentationWorkflow("acute-confusion-encephalopathy")!;
const releaseDiagnosis = {
  ...bundledDiagnosis,
  slug: "release-only-diagnosis",
  title: "Release-only diagnosis trap",
  subtitle: "Loaded atomically from the active public release.",
};
const releaseDetailContext = {
  ...getDifferentialDetailContext(bundledDiagnosis),
  comparePresentation: {
    slug: "release-only-presentation",
    title: "Release-only presentation trap",
  },
};
const releasePresentation = {
  ...bundledPresentation,
  id: "release-only-presentation",
  title: "Release-only presentation trap",
  subtitle: "Loaded from the active public release.",
  selectedCount: 1,
  totalCount: 1,
  candidates: [
    {
      ...bundledPresentation.candidates[0]!,
      slug: releaseDiagnosis.slug,
      selected: true,
    },
  ],
};
const releaseCandidates = [
  {
    ...releasePresentation.candidates[0]!,
    record: releaseDiagnosis,
  },
];

let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  authSession.authorizationHeader = { Authorization: "Bearer differential-release-page-test" };
  authSession.session.user.id = "release-page-user";
  authSession.markSessionExpired.mockReset();
  fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("differential active-release production pages", () => {
  it("marks generic client-resolved release metadata as non-indexable", async () => {
    await expect(
      generateDiagnosisMetadata({ params: Promise.resolve({ slug: "db-only-diagnosis" }) }),
    ).resolves.toMatchObject({ robots: { index: false, follow: false } });
    await expect(
      generatePresentationMetadata({ params: Promise.resolve({ slug: "db-only-presentation" }) }),
    ).resolves.toMatchObject({ robots: { index: false, follow: false } });
  });

  it("keeps the workflow renderer server-usable behind a dedicated release client loader", () => {
    const rendererSource = readFileSync(
      resolve(process.cwd(), "src/components/differentials/differential-presentation-workflow-page.tsx"),
      "utf8",
    );
    const loaderSource = readFileSync(
      resolve(process.cwd(), "src/components/differentials/differential-presentation-release-page-client.tsx"),
      "utf8",
    );

    expect(rendererSource).not.toMatch(/^\s*["']use client["'];/);
    expect(rendererSource).not.toContain("useDifferentialPresentation");
    expect(loaderSource).toMatch(/^\s*["']use client["'];/);
    expect(loaderSource).toContain("useDifferentialPresentation");
    expect(loaderSource).toContain("DifferentialPresentationWorkflowPage");
  });

  it("routes a DB-only presentation slug and renders the API workflow with its release-bound candidate", async () => {
    expect(presentationDynamicParams).toBe(true);
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        workflow: releasePresentation,
        candidates: releaseCandidates,
        governance: { sourceStatus: "current", validationStatus: "approved" },
        release: { id: "release-trap", epoch: 7, state: "current" },
      }),
    );

    render(
      await DifferentialPresentationRoute({
        params: Promise.resolve({ slug: releasePresentation.id }),
        searchParams: Promise.resolve({}),
      }),
    );

    expect(await screen.findByRole("heading", { name: releasePresentation.title })).toBeInTheDocument();
    expect(screen.getAllByText(releaseDiagnosis.title).length).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/differentials/presentations/${releasePresentation.id}`,
      expect.objectContaining({ headers: authSession.authorizationHeader }),
    );
  });

  it("routes a DB-only diagnosis slug and renders record and detail context from one API response", async () => {
    expect(diagnosisDynamicParams).toBe(true);
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        record: releaseDiagnosis,
        detailContext: releaseDetailContext,
        governance: { sourceStatus: "current", validationStatus: "approved" },
        release: { id: "release-trap", epoch: 7, state: "current" },
      }),
    );

    render(
      await DifferentialDiagnosisRoute({
        params: Promise.resolve({ slug: releaseDiagnosis.slug }),
      }),
    );

    expect(await screen.findByRole("heading", { name: releaseDiagnosis.title })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Compare" }));
    expect(screen.getByText(/Release-only presentation trap/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/differentials/${releaseDiagnosis.slug}?kind=diagnosis`,
      expect.objectContaining({ headers: authSession.authorizationHeader }),
    );
  });

  it("never paints a parsed diagnosis response after its slug and auth identity are invalidated", async () => {
    let resolveOldJson!: (value: unknown) => void;
    const oldJson = new Promise<unknown>((resolveJson) => {
      resolveOldJson = resolveJson;
    });
    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => oldJson } as Response)
      .mockImplementationOnce(() => new Promise<Response>(() => undefined));

    const view = render(
      await DifferentialDiagnosisRoute({
        params: Promise.resolve({ slug: releaseDiagnosis.slug }),
      }),
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    authSession.authorizationHeader = { Authorization: "Bearer replacement-release-page-test" };
    authSession.session.user.id = "replacement-release-page-user";
    view.rerender(
      await DifferentialDiagnosisRoute({
        params: Promise.resolve({ slug: "replacement-release-diagnosis" }),
      }),
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    await act(async () => {
      resolveOldJson({
        record: releaseDiagnosis,
        detailContext: releaseDetailContext,
        governance: { sourceStatus: "current", validationStatus: "approved" },
      });
      await oldJson;
    });

    expect(screen.getByRole("status")).toHaveTextContent("Loading differential diagnosis");
    expect(screen.queryByRole("heading", { name: releaseDiagnosis.title })).not.toBeInTheDocument();
    expect(screen.queryByText(releaseDiagnosis.subtitle)).not.toBeInTheDocument();
  });

  it.each([
    [401, "Sign in to view this differential"],
    [404, "Differential diagnosis not found"],
    [503, "Differential content unavailable"],
    [500, "Could not load differential diagnosis"],
  ])("never renders bundled diagnosis content for a %s response", async (status, expectedMessage) => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "release response" }, status));

    render(
      await DifferentialDiagnosisRoute({
        params: Promise.resolve({ slug: bundledDiagnosis.slug }),
      }),
    );

    expect(screen.queryByRole("heading", { name: bundledDiagnosis.title })).not.toBeInTheDocument();
    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Loading differential diagnosis");
    expect(await screen.findByRole("alert")).toHaveTextContent(expectedMessage);
    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: bundledDiagnosis.title })).not.toBeInTheDocument();
  });

  it("never renders the bundled workflow while an active release is unavailable", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: "Public site content is unavailable.", release: { state: "updating" } }, 503),
    );

    render(
      await DifferentialPresentationRoute({
        params: Promise.resolve({ slug: bundledPresentation.id }),
        searchParams: Promise.resolve({}),
      }),
    );

    expect(screen.queryByRole("heading", { name: bundledPresentation.title })).not.toBeInTheDocument();
    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Loading differential presentation");
    expect(await screen.findByRole("alert")).toHaveTextContent("Differential content unavailable");
    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: bundledPresentation.title })).not.toBeInTheDocument();
  });

  it.each([
    ["demo/local", true],
    ["missing-RPC 42883 fallback", false],
  ])("renders a successful %s presentation API payload", async (_source, demoMode) => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        workflow: releasePresentation,
        candidates: releaseCandidates,
        governance: { sourceStatus: "current", validationStatus: "approved" },
        demoMode,
      }),
    );

    render(
      await DifferentialPresentationRoute({
        params: Promise.resolve({ slug: releasePresentation.id }),
        searchParams: Promise.resolve({}),
      }),
    );

    await waitFor(() => expect(screen.getByRole("heading", { name: releasePresentation.title })).toBeInTheDocument());
    expect(screen.getAllByText(releaseDiagnosis.title).length).toBeGreaterThan(0);
  });

  it.each([
    [401, "Sign in to view this differential"],
    [404, "Differential presentation not found"],
    [500, "Could not load differential presentation"],
  ])("renders an explicit presentation state for a %s response", async (status, expectedMessage) => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "release response" }, status));

    render(
      await DifferentialPresentationRoute({
        params: Promise.resolve({ slug: bundledPresentation.id }),
        searchParams: Promise.resolve({}),
      }),
    );

    expect(screen.queryByRole("heading", { name: bundledPresentation.title })).not.toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent(expectedMessage);
    expect(screen.queryByRole("heading", { name: bundledPresentation.title })).not.toBeInTheDocument();
  });
});
