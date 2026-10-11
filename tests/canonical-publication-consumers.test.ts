import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultMedicationRecords } from "@/lib/medication-seed";
import { serviceRecords } from "@/lib/services";
import { formRecords } from "@/lib/forms";
import { differentialRecords, differentialPresentations } from "@/lib/differentials";

const canonicalRead = vi.hoisted(() => vi.fn());
vi.mock("@/lib/site-content/site-content-publication", () => ({ readCanonicalSiteContentRecords: canonicalRead }));
vi.mock("@/lib/rag/rag", () => ({ searchChunksWithTelemetry: vi.fn() }));
vi.mock("@/lib/env", async (original) => ({
  ...(await original<typeof import("@/lib/env")>()),
  isDemoMode: () => false,
  isLocalNoAuthMode: () => false,
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("next/server", async (original) => ({
  ...(await original<typeof import("next/server")>()),
  connection: vi.fn(),
}));
vi.mock("@/components/differentials/differential-diagnosis-page-client", () => ({
  DifferentialDiagnosisPageClient: () => null,
}));
vi.mock("@/components/differentials/differential-presentation-workflow-page", () => ({
  DifferentialPresentationWorkflowPage: () => null,
}));

beforeEach(() => canonicalRead.mockReset());

describe("canonical publication consumers", () => {
  it.each([undefined, "signed-in-owner"])(
    "searches public records for owner %s and never owner drafts",
    async (ownerId) => {
      const records = {
        medication: { ...defaultMedicationRecords()[0], slug: "published-medication", name: "Publishedneedle" },
        service: { ...serviceRecords[0], slug: "published-service", title: "Publishedneedle" },
        form: { ...formRecords[0], slug: "published-form", title: "Publishedneedle" },
      };
      canonicalRead.mockImplementation(async ({ kind }: { kind: keyof typeof records }) => ({
        records: [records[kind]],
        source: "canonical_public",
        snapshot: null,
      }));
      const from = vi.fn(() => {
        throw new Error("Owner table must not be queried");
      });
      const { runUniversalSearch } = await import("@/lib/universal-search");
      const response = await runUniversalSearch({
        query: "Publishedneedle",
        domains: ["medications", "services", "forms"],
        limitPerDomain: 5,
        ownerId,
        supabase: { from } as never,
        demo: false,
      });
      expect(response.groups.map((group) => group.items[0]?.href)).toEqual([
        "/medications/published-medication",
        "/services/published-service",
        "/forms/published-form",
      ]);
      expect(from).not.toHaveBeenCalled();
      expect(canonicalRead).toHaveBeenCalledTimes(3);
      canonicalRead.mockResolvedValue({ records: [], source: "canonical_public", snapshot: null });
      const retired = await runUniversalSearch({
        query: "Publishedneedle",
        domains: ["medications", "services", "forms"],
        limitPerDomain: 5,
        ownerId,
        supabase: { from } as never,
        demo: false,
      });
      expect(retired.groups.every((group) => group.items.length === 0 && !group.error)).toBe(true);
    },
  );

  it("renders a newly published diagnosis missing from bundled slugs", async () => {
    const record = { ...differentialRecords[0], slug: "newly-published-diagnosis", title: "New public diagnosis" };
    canonicalRead.mockResolvedValue({ records: [record], source: "canonical_public", snapshot: null });
    const { default: Page, generateMetadata } = await import("@/app/(search-app)/differentials/diagnoses/[slug]/page");
    const props = { params: Promise.resolve({ slug: record.slug }) };
    expect((await Page(props)).props.fallbackRecord).toEqual(record);
    expect((await generateMetadata(props)).title).toContain(record.title);
    canonicalRead.mockResolvedValue({ records: [], source: "canonical_public", snapshot: null });
    await expect(Page(props)).rejects.toThrow();
  });

  it("passes the newly published presentation instead of substituting a bundled workflow", async () => {
    const workflow = {
      ...differentialPresentations()[0],
      id: "newly-published-presentation",
      title: "New public presentation",
      candidates: [{ ...differentialPresentations()[0]!.candidates[0]!, slug: "published-candidate" }],
    };
    const candidates = [{ ...differentialRecords[0], slug: "published-candidate" }];
    canonicalRead.mockImplementation(async ({ kind }: { kind: string }) => ({
      records: kind === "presentation" ? [{ workflow }] : candidates,
      source: "canonical_public",
      snapshot: null,
    }));
    const { default: Page, generateMetadata } =
      await import("@/app/(search-app)/differentials/presentations/[slug]/page");
    const props = { params: Promise.resolve({ slug: workflow.id }) };
    const page = await Page(props);
    expect(page.props.workflow).toEqual(workflow);
    expect(page.props.candidateRecords).toEqual(candidates);
    expect((await generateMetadata(props)).title).toContain(workflow.title);
    canonicalRead.mockResolvedValue({ records: [], source: "canonical_public", snapshot: null });
    await expect(Page(props)).rejects.toThrow();
  });

  it("falls back to the legacy presentation slug when hosted content predates the presentation- namespace", async () => {
    const workflow = { ...differentialPresentations[0], title: "Hosted legacy depression" };
    canonicalRead.mockImplementation(async (args?: { kind: string; slug: string | null }) => ({
      records: args?.kind === "presentation" && args.slug === "depression" ? [{ workflow }] : [],
      source: "canonical_public",
      snapshot: null,
    }));
    const { readPresentationPageRecord } = await import("@/lib/site-content/differential-page-records");
    const resolved = await readPresentationPageRecord("presentation-depression");
    expect(resolved?.title).toBe("Hosted legacy depression");
    expect(canonicalRead.mock.calls.map(([args]) => args?.slug)).toEqual(["presentation-depression", "depression"]);
  });
});
