import { afterEach, describe, expect, it, vi } from "vitest";

import { differentialPresentations, differentialRecords } from "../src/lib/differentials";
import { formRecords } from "../src/lib/forms";
import { defaultMedicationRecords } from "../src/lib/medication-fixtures";
import { serviceRecords } from "../src/lib/services";

const releaseId = "11111111-1111-4111-8111-111111111111";
const secondReleaseId = "22222222-2222-4222-8222-222222222222";
const identities = [undefined, "Bearer reader", "Bearer administrator"];

function publicationRecord(domain: string, kind: string, payload: object) {
  const slug = "slug" in payload ? String(payload.slug) : String((payload as { id?: string }).id);
  return {
    logical_id: domain === "differentials" ? `differential:${kind}:${slug}` : `${domain}:${kind}:${slug}`,
    domain,
    record_kind: kind,
    slug,
    payload,
    governance: { sourceStatus: "current", validationStatus: "locally_reviewed" },
    publication_version: "2026-08-24T00:00:00.000Z",
    content_hash: `sha256:${"a".repeat(64)}`,
    source_lineage_digest: `sha256:${"b".repeat(64)}`,
  };
}

function partitionRecords(domain: string) {
  if (domain === "services") return [publicationRecord(domain, "service", serviceRecords[0]!)];
  if (domain === "forms") return [publicationRecord(domain, "form", formRecords[0]!)];
  if (domain === "medications") {
    return [publicationRecord(domain, "medication", defaultMedicationRecords()[0]!)];
  }
  return [
    ...differentialRecords.map((record) =>
      publicationRecord(domain, "diagnosis", { ...record, title: `Release ${record.title}` }),
    ),
    ...differentialPresentations().map((workflow) =>
      publicationRecord(domain, "presentation", { ...workflow, title: `Release ${workflow.title}` }),
    ),
  ];
}

type PartitionQuery = { domain: string; recordKind?: string; slug?: string };

async function loadRoutes(
  state: "current" | "updating" | "unavailable",
  options: {
    malformedDifferentialSlug?: string;
    omitDifferential?: { kind: "diagnosis" | "presentation"; slug: string };
    flipReleaseOnSecondRead?: boolean;
  } = {},
) {
  vi.resetModules();
  vi.doMock("@/lib/env", () => ({
    isDemoMode: () => false,
    isLocalNoAuthMode: () => false,
  }));
  vi.doMock("@/lib/supabase/admin", () => ({
    createAdminClient: () => ({
      rpc: vi.fn(async () => ({
        data: [{ limited: false, limit_value: 100, remaining: 99, retry_after_seconds: 60 }],
        error: null,
      })),
    }),
  }));
  vi.doMock("@/lib/public-api-access", () => ({
    publicAccessContext: vi.fn(async (request: Request) =>
      request.headers.has("authorization")
        ? {
            authenticated: true,
            ownerId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            rateLimitSubject: { kind: "owner", ownerId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
          }
        : {
            authenticated: false,
            ownerId: undefined,
            rateLimitSubject: { kind: "anonymous", subjectKey: "anon:synthetic" },
          },
    ),
  }));
  const readPublicSiteContentPartition = vi.fn(async (_client: unknown, query: PartitionQuery) => {
    const records = partitionRecords(query.domain)
      .filter(
        (record) =>
          (!query.recordKind || record.record_kind === query.recordKind) &&
          (!query.slug || record.slug === query.slug) &&
          !(
            query.domain === "differentials" &&
            record.record_kind === options.omitDifferential?.kind &&
            record.slug === options.omitDifferential.slug
          ),
      )
      .map((record) =>
        query.domain === "differentials" && record.slug === options.malformedDifferentialSlug
          ? { ...record, logical_id: `differential:wrong:${record.slug}` }
          : record,
      );
    const activeReleaseId =
      options.flipReleaseOnSecondRead && readPublicSiteContentPartition.mock.calls.length > 1
        ? secondReleaseId
        : releaseId;
    return {
      changeEpoch: 7,
      activeReleaseId: state === "unavailable" ? null : activeReleaseId,
      state,
      records: state === "unavailable" ? [] : records,
    };
  });
  vi.doMock("@/lib/site-content/public-site-content", () => ({
    readPublicSiteContentPartition,
  }));
  return {
    readPublicSiteContentPartition,
    registryCollection: await import("../src/app/api/registry/records/route"),
    registryDetail: await import("../src/app/api/registry/records/[slug]/route"),
    medicationCollection: await import("../src/app/api/medications/route"),
    medicationDetail: await import("../src/app/api/medications/[slug]/route"),
    differentialCollection: await import("../src/app/api/differentials/route"),
    differentialDetail: await import("../src/app/api/differentials/[slug]/route"),
    presentationDetail: await import("../src/app/api/differentials/presentations/[slug]/route"),
  };
}

function request(path: string, authorization?: string) {
  return new Request(`http://local${path}`, authorization ? { headers: { authorization } } : undefined);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("seven public route release-state matrix", () => {
  it.each(["current", "updating", "unavailable"] as const)(
    "serves byte-equivalent %s partitions to anonymous, authenticated, and administrator readers",
    async (state) => {
      const routes = await loadRoutes(state);
      const service = serviceRecords[0]!;
      const form = formRecords[0]!;
      const medication = defaultMedicationRecords()[0]!;
      const differential = differentialRecords[0]!;
      const presentation = differentialPresentations()[0]!;
      const calls = [
        {
          call: (auth?: string) => routes.registryCollection.GET(request("/api/registry/records?kind=service", auth)),
        },
        {
          call: (auth?: string) =>
            routes.registryDetail.GET(request(`/api/registry/records/${form.slug}?kind=form`, auth), {
              params: Promise.resolve({ slug: form.slug }),
            }),
        },
        { call: (auth?: string) => routes.medicationCollection.GET(request("/api/medications", auth)) },
        {
          call: (auth?: string) =>
            routes.medicationDetail.GET(request(`/api/medications/${medication.slug}`, auth), {
              params: Promise.resolve({ slug: medication.slug }),
            }),
        },
        {
          call: (auth?: string) =>
            routes.differentialCollection.GET(request("/api/differentials?kind=diagnosis", auth)),
        },
        {
          kind: "diagnosis" as const,
          call: (auth?: string) =>
            routes.differentialDetail.GET(request(`/api/differentials/${differential.slug}?kind=diagnosis`, auth), {
              params: Promise.resolve({ slug: differential.slug }),
            }),
        },
        {
          kind: "presentation" as const,
          call: (auth?: string) =>
            routes.presentationDetail.GET(request(`/api/differentials/presentations/${presentation.id}`, auth), {
              params: Promise.resolve({ slug: presentation.id }),
            }),
        },
      ];
      expect(service.slug).toBeTruthy();
      for (const entry of calls) {
        const readCount = routes.readPublicSiteContentPartition.mock.calls.length;
        const responses = [];
        for (const identity of identities) responses.push(await entry.call(identity));
        expect(routes.readPublicSiteContentPartition.mock.calls.length - readCount).toBe(identities.length);
        if (entry.kind) {
          expect(routes.readPublicSiteContentPartition.mock.calls.slice(readCount).map(([, query]) => query)).toEqual(
            identities.map(() => ({ domain: "differentials" })),
          );
        }
        expect(new Set(await Promise.all(responses.map((response) => response.clone().text()))).size).toBe(1);
        expect(responses.map((response) => response.status)).toEqual(
          state === "unavailable" ? [503, 503, 503] : [200, 200, 200],
        );
        const payload = (await responses[0]!.json()) as {
          release?: { state?: string };
          record?: { title?: string };
          detailContext?: { knownRelatedSlugs?: string[] };
          workflow?: { title?: string };
          candidates?: Array<{ slug?: string; record?: { slug?: string; title?: string } }>;
        };
        expect(payload.release?.state).toBe(state);
        if (state !== "unavailable" && entry.kind === "diagnosis") {
          expect(payload.record?.title).toMatch(/^Release /);
          expect(payload.detailContext?.knownRelatedSlugs?.length).toBeGreaterThan(0);
        }
        if (state !== "unavailable" && entry.kind === "presentation") {
          expect(payload.workflow?.title).toMatch(/^Release /);
          expect(payload.candidates?.length).toBeGreaterThan(0);
          expect(payload.candidates?.every((candidate) => candidate.record?.slug === candidate.slug)).toBe(true);
          expect(payload.candidates?.every((candidate) => candidate.record?.title?.startsWith("Release "))).toBe(true);
        }
      }
    },
  );

  it("uses one differential partition snapshot even when a second read would observe another release", async () => {
    const target = differentialRecords.find((record) => record.related.length > 0)!;
    const routes = await loadRoutes("current", { flipReleaseOnSecondRead: true });

    const response = await routes.differentialDetail.GET(request(`/api/differentials/${target.slug}?kind=diagnosis`), {
      params: Promise.resolve({ slug: target.slug }),
    });
    const payload = (await response.json()) as {
      record?: { title?: string };
      release?: { id?: string };
      detailContext?: {
        relatedMapDetails?: Record<string, { title?: string }>;
        comparePresentation?: { title?: string } | null;
        source?: { version?: string; sourceTitle?: string };
      };
    };

    expect(response.status).toBe(200);
    expect(routes.readPublicSiteContentPartition).toHaveBeenCalledTimes(1);
    expect(routes.readPublicSiteContentPartition).toHaveBeenCalledWith(expect.anything(), {
      domain: "differentials",
    });
    expect(payload.release?.id).toBe(releaseId);
    expect(payload.record?.title).toMatch(/^Release /);
    expect(Object.values(payload.detailContext?.relatedMapDetails ?? {})[0]?.title).toMatch(/^Release /);
    if (payload.detailContext?.comparePresentation) {
      expect(payload.detailContext.comparePresentation.title).toMatch(/^Release /);
    }
    expect(payload.detailContext?.source).toEqual(
      expect.objectContaining({
        version: "2026-08-24T00:00:00.000Z",
        sourceTitle: "Canonical public differential release",
      }),
    );
  });

  it.each([
    ["diagnosis", "delirium", "records", "record", "delirium"],
    ["presentation", "acute confusion", "presentations", "workflow", "acute-confusion-encephalopathy"],
  ] as const)(
    "ranks and limits active-release %s search results",
    async (kind, query, collectionKey, matchKey, expectedSlug) => {
      const routes = await loadRoutes("current");

      const response = await routes.differentialCollection.GET(
        request(`/api/differentials?kind=${kind}&q=${encodeURIComponent(query)}&limit=1`),
      );
      const payload = (await response.json()) as {
        records?: Array<{ slug?: string; id?: string; title: string }>;
        presentations?: Array<{ slug?: string; id?: string; title: string }>;
        matches?: Array<{
          record?: { slug?: string; id?: string; title: string };
          workflow?: { slug?: string; id?: string; title: string };
          score: number;
          reasons: string[];
        }>;
        release?: { id?: string; state?: string };
      };
      const collection = payload[collectionKey];
      const match = payload.matches?.[0]?.[matchKey];

      expect(response.status).toBe(200);
      expect(payload.release).toEqual(expect.objectContaining({ id: releaseId, state: "current" }));
      expect(collection).toHaveLength(1);
      expect(payload.matches).toHaveLength(1);
      expect(collection?.[0]?.slug ?? collection?.[0]?.id).toBe(expectedSlug);
      expect(match?.slug ?? match?.id).toBe(expectedSlug);
      expect(collection?.[0]?.title).toMatch(/^Release /);
      expect(match?.title).toBe(collection?.[0]?.title);
      expect(payload.matches?.[0]?.score ?? 0).toBeGreaterThan(0);
    },
  );

  it.each(["current", "updating"] as const)(
    "fails closed for a %s diagnosis whose related release dependency is pending",
    async (state) => {
      const target = differentialRecords.find((record) =>
        record.related.some((related) => differentialRecords.some((candidate) => candidate.slug === related.id)),
      )!;
      const relatedSlug = target.related.find((related) =>
        differentialRecords.some((candidate) => candidate.slug === related.id),
      )!.id;
      const routes = await loadRoutes(state, { omitDifferential: { kind: "diagnosis", slug: relatedSlug } });

      const response = await routes.differentialDetail.GET(
        request(`/api/differentials/${target.slug}?kind=diagnosis`),
        { params: Promise.resolve({ slug: target.slug }) },
      );
      const payload = (await response.json()) as { release?: { state?: string } };

      expect(response.status).toBe(503);
      expect(payload.release?.state).toBe(state);
      expect(routes.readPublicSiteContentPartition).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["current", "updating"] as const)(
    "fails closed for a %s presentation whose candidate release dependency is pending",
    async (state) => {
      const target = differentialPresentations().find((workflow) => workflow.candidates.length > 0)!;
      const routes = await loadRoutes(state, {
        omitDifferential: { kind: "diagnosis", slug: target.candidates[0]!.slug },
      });

      const response = await routes.presentationDetail.GET(request(`/api/differentials/presentations/${target.id}`), {
        params: Promise.resolve({ slug: target.id }),
      });
      const payload = (await response.json()) as { release?: { state?: string } };

      expect(response.status).toBe(503);
      expect(payload.release?.state).toBe(state);
      expect(routes.readPublicSiteContentPartition).toHaveBeenCalledTimes(1);
    },
  );

  it("serves an updating diagnosis when an omitted pending record is unrelated to its aggregate", async () => {
    const target = differentialRecords.find((record) => record.related.length > 0)!;
    const dependencies = new Set([target.slug, ...target.related.map((related) => related.id)]);
    const unrelated = differentialRecords.find((record) => !dependencies.has(record.slug))!;
    const routes = await loadRoutes("updating", {
      omitDifferential: { kind: "diagnosis", slug: unrelated.slug },
    });

    const response = await routes.differentialDetail.GET(request(`/api/differentials/${target.slug}?kind=diagnosis`), {
      params: Promise.resolve({ slug: target.slug }),
    });
    const payload = (await response.json()) as {
      record?: { slug?: string };
      release?: { state?: string };
      detailContext?: { knownRelatedSlugs?: string[] };
    };

    expect(response.status).toBe(200);
    expect(payload.release?.state).toBe("updating");
    expect(payload.record?.slug).toBe(target.slug);
    expect(payload.detailContext?.knownRelatedSlugs).toEqual(target.related.map((related) => related.id));
    expect(routes.readPublicSiteContentPartition).toHaveBeenCalledTimes(1);
  });

  it("fails closed when a required active-release record has malformed projection metadata", async () => {
    const target = differentialRecords.find((record) => record.related.length > 0)!;
    const routes = await loadRoutes("current", { malformedDifferentialSlug: target.slug });

    const response = await routes.differentialDetail.GET(request(`/api/differentials/${target.slug}?kind=diagnosis`), {
      params: Promise.resolve({ slug: target.slug }),
    });
    const payload = (await response.json()) as { release?: { state?: string } };

    expect(response.status).toBe(503);
    expect(payload.release?.state).toBe("current");
    expect(routes.readPublicSiteContentPartition).toHaveBeenCalledTimes(1);
  });
});
