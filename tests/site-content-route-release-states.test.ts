import { afterEach, describe, expect, it, vi } from "vitest";

import { differentialPresentations, differentialRecords } from "../src/lib/differentials";
import { formRecords } from "../src/lib/forms";
import { defaultMedicationRecords } from "../src/lib/medication-fixtures";
import { serviceRecords } from "../src/lib/services";

const releaseId = "11111111-1111-4111-8111-111111111111";
const identities = [undefined, "Bearer reader", "Bearer administrator"];

function recordFor(domain: string, kind: string | undefined) {
  if (domain === "services") return serviceRecords[0]!;
  if (domain === "forms") return formRecords[0]!;
  if (domain === "medications") return defaultMedicationRecords()[0]!;
  return kind === "presentation" ? differentialPresentations()[0]! : differentialRecords[0]!;
}

async function loadRoutes(state: "current" | "updating" | "unavailable") {
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
  vi.doMock("@/lib/site-content/public-site-content", () => ({
    readPublicSiteContentPartition: vi.fn(async (_client: unknown, query: { domain: string; recordKind?: string }) => {
      const payload = recordFor(query.domain, query.recordKind);
      const slug = "slug" in payload ? String(payload.slug) : String((payload as { id?: string }).id);
      return {
        changeEpoch: 7,
        activeReleaseId: state === "unavailable" ? null : releaseId,
        state,
        records:
          state === "unavailable"
            ? []
            : [
                {
                  logical_id: `${query.domain}:${slug}`,
                  domain: query.domain,
                  record_kind: query.recordKind ?? "record",
                  slug,
                  payload,
                  governance: { sourceStatus: "current", validationStatus: "locally_reviewed" },
                  publication_version: "2026-08-24T00:00:00.000Z",
                  content_hash: `sha256:${"a".repeat(64)}`,
                  source_lineage_digest: `sha256:${"b".repeat(64)}`,
                },
              ],
      };
    }),
  }));
  return {
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
        (auth?: string) => routes.registryCollection.GET(request("/api/registry/records?kind=service", auth)),
        (auth?: string) =>
          routes.registryDetail.GET(request(`/api/registry/records/${form.slug}?kind=form`, auth), {
            params: Promise.resolve({ slug: form.slug }),
          }),
        (auth?: string) => routes.medicationCollection.GET(request("/api/medications", auth)),
        (auth?: string) =>
          routes.medicationDetail.GET(request(`/api/medications/${medication.slug}`, auth), {
            params: Promise.resolve({ slug: medication.slug }),
          }),
        (auth?: string) => routes.differentialCollection.GET(request("/api/differentials?kind=diagnosis", auth)),
        (auth?: string) =>
          routes.differentialDetail.GET(request(`/api/differentials/${differential.slug}?kind=diagnosis`, auth), {
            params: Promise.resolve({ slug: differential.slug }),
          }),
        (auth?: string) =>
          routes.presentationDetail.GET(request(`/api/differentials/presentations/${presentation.id}`, auth), {
            params: Promise.resolve({ slug: presentation.id }),
          }),
      ];
      expect(service.slug).toBeTruthy();
      for (const call of calls) {
        const responses = [];
        for (const identity of identities) responses.push(await call(identity));
        expect(new Set(await Promise.all(responses.map((response) => response.clone().text()))).size).toBe(1);
        expect(responses.map((response) => response.status)).toEqual(
          state === "unavailable" ? [503, 503, 503] : [200, 200, 200],
        );
        const payload = (await responses[0]!.json()) as { release?: { state?: string } };
        expect(payload.release?.state).toBe(state);
      }
    },
  );
});
