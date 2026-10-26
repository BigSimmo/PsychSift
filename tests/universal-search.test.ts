import { afterEach, describe, expect, it, vi } from "vitest";

let resetModulesAfterTest = false;
const mockedModuleSpecifiers = [
  "@/lib/demo-data",
  "@/lib/differentials",
  "@/lib/env",
  "@/lib/formulation",
  "@/lib/rag/rag",
  "@/lib/specifiers",
  "@/lib/supabase/admin",
  "@/lib/therapies",
  "@/lib/tools-catalog",
  "@/lib/universal-search",
  "@/lib/site-content/site-content-publication",
  "@/lib/medication-seed",
  "@/lib/registry-seed",
] as const;

function isolateNextModuleImport() {
  vi.resetModules();
  resetModulesAfterTest = true;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  if (resetModulesAfterTest) {
    for (const specifier of mockedModuleSpecifiers) vi.doUnmock(specifier);
    vi.resetModules();
    resetModulesAfterTest = false;
  }
});

async function loadUniversalSearch() {
  return import("../src/lib/universal-search");
}

describe("runUniversalSearch (demo/fixtures path)", () => {
  // 60s timeout: the first test in this file pays the one-off vite transform cost of the large
  // universal-search module graph (~15s on a cold, loaded worker — right at the global 15s
  // limit), which made this the suite's most frequent first-test timeout flake.
  it("returns groups in the fixed domain order without touching Supabase", { timeout: 60000 }, async () => {
    const { runUniversalSearch, universalSearchDomains } = await loadUniversalSearch();
    const response = await runUniversalSearch({ query: "clinical", limitPerDomain: 5, demo: true });

    expect(response.groups.map((group) => group.kind)).toEqual(universalSearchDomains);
    for (const group of response.groups) {
      expect(group.error).toBeUndefined();
      expect(group.items.length).toBeLessThanOrEqual(5);
    }
  });

  it("finds fixture records per domain with working hrefs", async () => {
    const { runUniversalSearch } = await loadUniversalSearch();
    const response = await runUniversalSearch({ query: "acamprosate", limitPerDomain: 5, demo: true });
    const medications = response.groups.find((group) => group.kind === "medications");
    expect(medications?.items[0]?.title.toLowerCase()).toContain("acamprosate");
    expect(medications?.items[0]?.href).toBe("/medications/acamprosate");

    const differentialResponse = await runUniversalSearch({ query: "delirium", limitPerDomain: 5, demo: true });
    const differentials = differentialResponse.groups.find((group) => group.kind === "differentials");
    expect(differentials?.items.length ?? 0).toBeGreaterThan(0);
    expect(differentials?.items[0]?.href).toContain("/differentials/diagnoses/");

    const toolsResponse = await runUniversalSearch({ query: "forms", limitPerDomain: 5, demo: true });
    const forms = toolsResponse.groups.find((group) => group.kind === "forms");
    const tools = toolsResponse.groups.find((group) => group.kind === "tools");
    expect(tools?.items.some((item) => item.id === "forms")).toBe(true);
    expect(forms?.items.every((item) => item.href.startsWith("/forms/"))).toBe(true);

    const dsmResponse = await runUniversalSearch({ query: "major depressive disorder", limitPerDomain: 5, demo: true });
    const dsm = dsmResponse.groups.find((group) => group.kind === "dsm");
    expect(dsm?.items[0]?.title.toLowerCase()).toContain("major depressive disorder");
    expect(dsm?.items[0]?.href).toBe("/dsm/diagnoses/major-depressive-disorder");

    const formulationResponse = await runUniversalSearch({
      query: "avoidance",
      limitPerDomain: 5,
      demo: true,
    });
    const formulation = formulationResponse.groups.find((group) => group.kind === "formulation");
    expect(formulation?.items[0]?.title).toBe("Avoidance");
    expect(formulation?.items[0]?.href).toBe("/formulation/avoidance");

    const specifierResponse = await runUniversalSearch({
      query: "depressed but racing thoughts",
      limitPerDomain: 5,
      demo: true,
    });
    const specifiers = specifierResponse.groups.find((group) => group.kind === "specifiers");
    expect(specifiers?.items[0]?.title).toBe("With mixed features");
    expect(specifiers?.items[0]?.href).toBe("/specifiers/with-mixed-features");

    const therapyResponse = await runUniversalSearch({
      query: "acceptance and commitment therapy",
      limitPerDomain: 5,
      demo: true,
    });
    const therapies = therapyResponse.groups.find((group) => group.kind === "therapies");
    expect(therapies?.items[0]?.title.toLowerCase()).toContain("acceptance");
    expect(therapies?.items[0]?.href).toBe("/therapy-compass/acceptance-and-commitment-therapy-act");
  });

  it("keeps view-all destinations separate for specifiers, formulation, and therapies", async () => {
    const { universalSearchViewAllHref } = await loadUniversalSearch();

    expect(universalSearchViewAllHref("specifiers", "mixed features")).toBe(
      "/specifiers/search?q=mixed%20features&run=1",
    );
    expect(universalSearchViewAllHref("formulation", "rumination")).toBe("/formulation/search?q=rumination&run=1");
    expect(universalSearchViewAllHref("therapies", "grounding")).toBe("/therapy-compass/search?q=grounding&run=1");
  });

  // Five domains used to build "See all" on the bare mode path, which the proxy 307s to
  // `<mode>/search` (consolidatedModeHomeTarget). That hop costs a server round-trip and, on
  // phones, a frame of the wrong route shell before the second navigation settles
  // (2026-09-02 audit, L112). Every consolidated domain must name its final path directly.
  it("targets the consolidated search route directly, with no redirect hop", async () => {
    const { universalSearchViewAllHref } = await loadUniversalSearch();
    const { consolidatedModeHomeTarget, consolidatedModeSearchPath } =
      await import("@/lib/consolidated-mode-home-redirect");

    const expected: Record<string, string> = {
      services: "/services/search?q=transport&run=1",
      forms: "/forms/search?q=transport&run=1",
      differentials: "/differentials/search?q=transport&run=1",
      presentations: "/differentials/search?q=transport&run=1",
      specifiers: "/specifiers/search?q=transport&run=1",
      formulation: "/formulation/search?q=transport&run=1",
      dsm: "/dsm/search?q=transport&run=1",
    };

    for (const [domain, href] of Object.entries(expected)) {
      expect(universalSearchViewAllHref(domain as Parameters<typeof universalSearchViewAllHref>[0], "transport")).toBe(
        href,
      );
      // The destination is a real route, not another redirect: feeding its own path back
      // through the proxy's consolidated map must produce no further target.
      const [pathname] = href.split("?");
      expect(consolidatedModeHomeTarget(pathname, new URLSearchParams("q=transport&run=1"))).toBeNull();
    }

    // The paths come from the same map the proxy redirects through, so the two cannot drift.
    expect(consolidatedModeSearchPath("services")).toBe("/services/search");
    expect(consolidatedModeSearchPath("differentials")).toBe("/differentials/search");
  });

  it("filters to requested domains only", async () => {
    const { runUniversalSearch } = await loadUniversalSearch();
    const response = await runUniversalSearch({
      query: "monitoring",
      limitPerDomain: 3,
      domains: ["tools", "differentials"],
      demo: true,
    });
    expect(response.groups.map((group) => group.kind)).toEqual(
      [
        "documents",
        "medications",
        "services",
        "forms",
        "differentials",
        "presentations",
        "dsm",
        "specifiers",
        "formulation",
        "therapies",
        "tools",
      ].filter((domain) => ["tools", "differentials"].includes(domain)),
    );
  });

  it("isolates a failing domain instead of blanking the response", async () => {
    isolateNextModuleImport();
    vi.doMock("@/lib/tools-catalog", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../src/lib/tools-catalog")>();
      return {
        ...actual,
        rankToolRecords: () => {
          throw new Error("tools adapter exploded");
        },
      };
    });
    const { runUniversalSearch } = await loadUniversalSearch();
    const response = await runUniversalSearch({ query: "monitoring", limitPerDomain: 3, demo: true });

    const tools = response.groups.find((group) => group.kind === "tools");
    expect(tools?.error).toBe(true);
    expect(tools?.items).toEqual([]);
    const differentials = response.groups.find((group) => group.kind === "differentials");
    expect(differentials?.error).toBeUndefined();
  });

  it("isolates a failing presentations adapter without touching the differentials group", async () => {
    isolateNextModuleImport();
    vi.doMock("@/lib/differentials", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../src/lib/differentials")>();
      return {
        ...actual,
        rankPresentationWorkflows: () => {
          throw new Error("presentations adapter exploded");
        },
      };
    });
    const { runUniversalSearch } = await loadUniversalSearch();
    const response = await runUniversalSearch({ query: "confusion", limitPerDomain: 3, demo: true });

    const presentations = response.groups.find((group) => group.kind === "presentations");
    expect(presentations?.error).toBe(true);
    expect(presentations?.items).toEqual([]);
    const differentials = response.groups.find((group) => group.kind === "differentials");
    expect(differentials?.error).toBeUndefined();
    expect(differentials?.items.length ?? 0).toBeGreaterThan(0);
  });

  it("uses demo document search when no Supabase client is supplied", async () => {
    const { runUniversalSearch } = await loadUniversalSearch();
    const response = await runUniversalSearch({ query: "clozapine monitoring", limitPerDomain: 4, demo: true });
    const documents = response.groups.find((group) => group.kind === "documents");
    expect(documents?.items.length ?? 0).toBeGreaterThan(0);
    expect(documents?.items[0]?.href).toContain("/documents/");
  });

  it("returns ranked chunk previews directly while preserving registry hrefs", async () => {
    isolateNextModuleImport();
    const searchChunksWithTelemetry = vi.fn(async () => ({
      results: [
        {
          id: "registry-chunk",
          document_id: "registry-doc",
          title: "Crisis service",
          file_name: "service-crisis-service.registry.json",
          page_number: 1,
          hybrid_score: 0.92,
          similarity: 0.9,
          images: [],
          source_metadata: {
            source_kind: "registry_record",
            registry_record_kind: "service",
            registry_record_slug: "crisis-service",
          },
        },
      ],
    }));
    vi.doMock("@/lib/rag/rag", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../src/lib/rag/rag")>();
      return {
        ...actual,
        searchChunksWithTelemetry,
      };
    });
    const { runUniversalSearch } = await loadUniversalSearch();
    const response = await runUniversalSearch({
      query: "crisis service",
      limitPerDomain: 5,
      domains: ["documents"],
      demo: false,
      supabase: {} as Parameters<typeof runUniversalSearch>[0]["supabase"],
    });

    expect(response.groups[0]?.items[0]).toMatchObject({
      id: "registry-doc",
      href: "/services/crisis-service",
      score: 0.92,
      meta: "service-crisis-service.registry.json",
    });
    expect(searchChunksWithTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("keeps the short document timeout for federated search but allows a focused document search to finish", async () => {
    isolateNextModuleImport();
    const searchChunksWithTelemetry = vi.fn(
      ({ signal }: { signal?: AbortSignal }) =>
        new Promise<{ results: Array<Record<string, unknown>> }>((resolve, reject) => {
          const timer = setTimeout(
            () =>
              resolve({
                results: [
                  {
                    id: "focused-document-chunk",
                    document_id: "focused-document",
                    title: "Focused document",
                    file_name: "focused-document.pdf",
                    page_number: 1,
                    hybrid_score: 0.9,
                    similarity: 0.9,
                    images: [],
                  },
                ],
              }),
            1000,
          );
          signal?.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              reject(signal.reason ?? new DOMException("The operation was aborted.", "AbortError"));
            },
            { once: true },
          );
        }),
    );
    vi.doMock("@/lib/rag/rag", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../src/lib/rag/rag")>();
      return { ...actual, searchChunksWithTelemetry };
    });
    const { runUniversalSearch } = await loadUniversalSearch();
    vi.useFakeTimers();
    const supabase = {} as Parameters<typeof runUniversalSearch>[0]["supabase"];

    const focusedPromise = runUniversalSearch({
      query: "focused document",
      limitPerDomain: 3,
      domains: ["documents"],
      demo: false,
      supabase,
    });
    await vi.advanceTimersByTimeAsync(1000);
    const focused = await focusedPromise;
    expect(focused.groups[0]).toMatchObject({ kind: "documents", total: 1 });
    expect(focused.groups[0]?.error).toBeUndefined();

    const federatedPromise = runUniversalSearch({
      query: "focused document",
      limitPerDomain: 3,
      domains: ["documents", "tools"],
      demo: false,
      supabase,
    });
    await vi.advanceTimersByTimeAsync(751);
    const federated = await federatedPromise;
    expect(federated.groups.find((group) => group.kind === "documents")).toMatchObject({
      error: true,
      total: 0,
    });
    expect(federated.groups.find((group) => group.kind === "tools")?.error).toBeUndefined();
  });
});

describe("GET /api/search/universal (demo mode)", () => {
  it("serves fixture-backed groups with demoMode flagged", async () => {
    isolateNextModuleImport();
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    const { GET } = await import("../src/app/api/search/universal/route");
    const response = await GET(new Request("http://localhost/api/search/universal?q=acamprosate&limit=3"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const payload = (await response.json()) as {
      demoMode?: boolean;
      groups: Array<{ kind: string; items: Array<{ title: string }> }>;
    };
    expect(payload.demoMode).toBe(true);
    const medications = payload.groups.find((group) => group.kind === "medications");
    expect(medications?.items[0]?.title.toLowerCase()).toContain("acamprosate");
  });

  it("rejects queries under the minimum length", async () => {
    isolateNextModuleImport();
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    const { GET } = await import("../src/app/api/search/universal/route");
    const response = await GET(new Request("http://localhost/api/search/universal?q=a"));
    expect(response.status).toBe(400);
  });

  it("refuses a query that looks like it holds a patient detail", async () => {
    isolateNextModuleImport();
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    const { GET } = await import("../src/app/api/search/universal/route");
    const response = await GET(
      new Request(`http://localhost/api/search/universal?q=${encodeURIComponent("Mr Smith lithium level 1.4")}`),
    );
    expect(response.status).toBe(400);
    expect(((await response.json()) as { code?: string }).code).toBe("patient_detail_in_question");
  });

  it("ignores unknown domains in the CSV filter", async () => {
    isolateNextModuleImport();
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    const { GET } = await import("../src/app/api/search/universal/route");
    const response = await GET(new Request("http://localhost/api/search/universal?q=monitoring&domains=tools,bogus"));
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { groups: Array<{ kind: string }> };
    expect(payload.groups.map((group) => group.kind)).toEqual(["tools"]);
  });

  it("serves the presentations domain through the CSV filter", async () => {
    isolateNextModuleImport();
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    const { GET } = await import("../src/app/api/search/universal/route");
    const response = await GET(
      new Request("http://localhost/api/search/universal?q=confusion&domains=presentations,bogus"),
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { groups: Array<{ kind: string; items: Array<{ href: string }> }> };
    expect(payload.groups.map((group) => group.kind)).toEqual(["presentations"]);
    expect(payload.groups[0]?.items[0]?.href).toContain("/differentials/presentations/");
  });

  it("accepts a mode context and rejects unknown modes", async () => {
    isolateNextModuleImport();
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    const { GET } = await import("../src/app/api/search/universal/route");
    const response = await GET(
      new Request("http://localhost/api/search/universal?q=transport&mode=forms&domains=forms,services"),
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      contextMode?: string;
      preferredDomains?: string[];
      domainOrder?: string[];
    };
    expect(payload.contextMode).toBe("forms");
    expect(payload.preferredDomains).toEqual(["forms"]);
    expect(payload.domainOrder?.[0]).toBe("forms");

    const invalid = await GET(new Request("http://localhost/api/search/universal?q=transport&mode=bogus"));
    expect(invalid.status).toBe(400);
  });

  it("streams ready groups as NDJSON and finishes with the canonical response", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    const { GET } = await import("../src/app/api/search/universal/route");
    const response = await GET(
      new Request(
        "http://localhost/api/search/universal?q=acamprosate&limit=3&domains=medications,tools&stream=ndjson",
      ),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("application/x-ndjson");
    const events = (await response.text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const groupEvents = events.filter((event) => event.type === "group") as Array<{
      query: string;
      group: { kind: string };
    }>;
    const complete = events.at(-1) as {
      type: string;
      response: { query: string; groups: Array<{ kind: string }>; demoMode?: boolean };
    };

    expect(groupEvents).toHaveLength(2);
    expect(groupEvents.every((event) => event.query === "acamprosate")).toBe(true);
    expect(complete.type).toBe("complete");
    expect(complete.response.demoMode).toBe(true);
    expect(complete.response.groups.map((group) => group.kind)).toEqual(["medications", "tools"]);
    expect(new Set(groupEvents.map((event) => event.group.kind))).toEqual(new Set(["medications", "tools"]));
  });
});

describe("runUniversalSearch (query intelligence & ranking)", () => {
  it("keeps groups in canonical order but exposes an intent-aware domainOrder", async () => {
    const { runUniversalSearch, universalSearchDomains } = await loadUniversalSearch();
    const response = await runUniversalSearch({ query: "clozapine dose", limitPerDomain: 5, demo: true });
    // The groups array is unchanged (canonical order); only the separate domainOrder reorders.
    expect(response.groups.map((group) => group.kind)).toEqual(universalSearchDomains);
    expect(response.domainOrder?.[0]).toBe("medications");
  });

  it("leads normal groups with the active mode but still allows an exact external Best match", async () => {
    const { runUniversalSearch } = await loadUniversalSearch();
    const response = await runUniversalSearch({
      query: "avoidance",
      limitPerDomain: 5,
      contextMode: "documents",
      demo: true,
    });

    expect(response.contextMode).toBe("documents");
    expect(response.preferredDomains).toEqual(["documents"]);
    expect(response.domainOrder?.[0]).toBe("documents");
    expect(response.topHit?.kind).toBe("formulation");
    expect(response.topHit?.title).toBe("Avoidance");
  });

  it("applies the active Smart mode's expansions to universal catalogue ranking", async () => {
    const { runUniversalSearch } = await loadUniversalSearch();
    const response = await runUniversalSearch({
      query: "Which diagnoses involve elevated mood?",
      limitPerDomain: 5,
      domains: ["dsm"],
      contextMode: "dsm",
      demo: true,
    });

    expect(response.interpretation?.appliedExpansions).toEqual(
      expect.arrayContaining(["mania", "hypomania", "bipolar"]),
    );
    expect(response.groups.find((group) => group.kind === "dsm")?.items[0]?.title).toContain("Bipolar I");
  });

  it("keeps generic facet words out of the catalogue expansion lane", async () => {
    // "sertraline dose" used to expand to "route", "oral", "IM" and "PRN", which listed
    // Ziprasidone IM beside sertraline and imagery rescripting as the top therapy.
    const { runUniversalSearch } = await loadUniversalSearch();
    const response = await runUniversalSearch({
      query: "sertraline dose",
      limitPerDomain: 3,
      domains: ["medications", "therapies"],
      demo: true,
    });

    expect(response.interpretation?.appliedExpansions).toEqual(["zoloft"]);
    const medications = response.groups.find((group) => group.kind === "medications")?.items ?? [];
    expect(medications[0]?.title).toBe("Sertraline");
    expect(medications.map((item) => item.title)).not.toContain("Ziprasidone IM");
    const therapies = response.groups.find((group) => group.kind === "therapies")?.items ?? [];
    expect(therapies.map((item) => item.title)).not.toContain("Imagery rescripting");
  });

  it("forwards the capped Smart expansion lane to every non-registry catalogue adapter", async () => {
    isolateNextModuleImport();
    const forwardedSpecifierExpansions: Array<readonly string[] | undefined> = [];
    const forwardedFormulationExpansions: Array<readonly string[] | undefined> = [];
    const forwardedTherapyExpansions: Array<readonly string[] | undefined> = [];
    const searchSpecifiers = vi.fn((_query: string, options?: { expansions?: readonly string[] }) => {
      forwardedSpecifierExpansions.push(options?.expansions);
      return [];
    });
    const searchFormulationMechanisms = vi.fn((_query: string, options?: { expansions?: readonly string[] }) => {
      forwardedFormulationExpansions.push(options?.expansions);
      return [];
    });
    const searchTherapyRecords = vi.fn((_query: string, expansions?: readonly string[]) => {
      forwardedTherapyExpansions.push(expansions);
      return [];
    });
    vi.doMock("@/lib/specifiers", async (importOriginal) => ({
      ...(await importOriginal<typeof import("../src/lib/specifiers")>()),
      searchSpecifiers,
    }));
    vi.doMock("@/lib/formulation", async (importOriginal) => ({
      ...(await importOriginal<typeof import("../src/lib/formulation")>()),
      searchFormulationMechanisms,
    }));
    vi.doMock("@/lib/therapies", async (importOriginal) => ({
      ...(await importOriginal<typeof import("../src/lib/therapies")>()),
      searchTherapyRecords,
    }));
    const { runUniversalSearch } = await loadUniversalSearch();

    await runUniversalSearch({
      query: "Which specifier describes anxiety symptoms?",
      limitPerDomain: 5,
      domains: ["specifiers"],
      contextMode: "specifiers",
      demo: true,
    });
    await runUniversalSearch({
      query: "Which formulation names someone who cannot stop thinking?",
      limitPerDomain: 5,
      domains: ["formulation"],
      contextMode: "formulation",
      demo: true,
    });
    await runUniversalSearch({
      query: "Which therapy helps after trauma?",
      limitPerDomain: 5,
      domains: ["therapies"],
      contextMode: "therapy-compass",
      demo: true,
    });

    expect(searchSpecifiers).toHaveBeenCalledTimes(1);
    expect(searchFormulationMechanisms).toHaveBeenCalledTimes(1);
    expect(searchTherapyRecords).toHaveBeenCalledTimes(1);
    expect(forwardedSpecifierExpansions[0]).toEqual(expect.arrayContaining(["anxious distress"]));
    expect(forwardedFormulationExpansions[0]).toEqual(expect.arrayContaining(["rumination"]));
    expect(forwardedTherapyExpansions[0]).toEqual(expect.arrayContaining(["trauma-focused", "ptsd"]));
    for (const expansions of [
      forwardedSpecifierExpansions[0],
      forwardedFormulationExpansions[0],
      forwardedTherapyExpansions[0],
    ]) {
      expect(expansions).toBeDefined();
      expect(expansions!.length).toBeLessThanOrEqual(16);
    }
  });

  it("typo-corrects the base query so a misspelled drug still finds the record", async () => {
    const { runUniversalSearch } = await loadUniversalSearch();
    const response = await runUniversalSearch({ query: "clozapin", limitPerDomain: 5, demo: true });
    // Interpretation surfaces the correction for the "Showing results for…" affordance.
    expect(response.interpretation?.correctedQuery).toBe("clozapine");
    expect(response.interpretation?.typoCorrections).toContainEqual({ from: "clozapin", to: "clozapine" });
    // The corrected base query drives the registry ranker, so Clozapine now surfaces.
    const medications = response.groups.find((group) => group.kind === "medications");
    expect(medications?.items.some((item) => item.title.toLowerCase().includes("clozapine"))).toBe(true);
  });

  it("keeps shared clinical-search typo corrections for the medications domain", async () => {
    const { runUniversalSearch } = await loadUniversalSearch();
    // "monitring" is corrected by analyzeClinicalQuery, not the catalog-local map.
    // Medications must rank against the shared corrected base query, not the raw typo.
    const response = await runUniversalSearch({ query: "monitring", limitPerDomain: 8, demo: true });
    expect(response.interpretation?.correctedQuery).toBe("monitoring");
    const medications = response.groups.find((group) => group.kind === "medications");
    expect((medications?.items.length ?? 0) > 0).toBe(true);
    const monitoringHits = await runUniversalSearch({ query: "monitoring", limitPerDomain: 8, demo: true });
    const monitoringMeds = monitoringHits.groups.find((group) => group.kind === "medications");
    expect(medications?.items.length ?? 0).toBeGreaterThanOrEqual(1);
    expect(monitoringMeds?.items.length ?? 0).toBeGreaterThanOrEqual(1);
  });

  it("pins a confident best-bet as topHit and omits it when nothing is near-exact", async () => {
    const { runUniversalSearch } = await loadUniversalSearch();
    const hit = await runUniversalSearch({ query: "acamprosate", limitPerDomain: 5, demo: true });
    expect(hit.topHit).toBeDefined();
    expect(hit.topHit?.title.toLowerCase()).toContain("acamprosate");

    const vague = await runUniversalSearch({ query: "monitoring overview summary", limitPerDomain: 5, demo: true });
    expect(vague.topHit).toBeUndefined();
  });

  it("offers an Answer-mode bridge for question-like queries only", async () => {
    const { runUniversalSearch } = await loadUniversalSearch();
    const question = await runUniversalSearch({
      query: "how do i manage clozapine toxicity",
      limitPerDomain: 5,
      demo: true,
    });
    expect(question.answerAction?.href).toContain("/?mode=answer");
    expect(question.answerAction?.href).toContain("run=1");

    const bareTerm = await runUniversalSearch({ query: "acamprosate", limitPerDomain: 5, demo: true });
    expect(bareTerm.answerAction).toBeUndefined();
  });

  it("passes the ORIGINAL (uncorrected) query to the documents domain", async () => {
    const captured: string[] = [];
    isolateNextModuleImport();
    vi.doMock("@/lib/demo-data", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../src/lib/demo-data")>();
      return {
        ...actual,
        demoSearch: (query: string, limit?: number) => {
          captured.push(query);
          return actual.demoSearch(query, limit);
        },
      };
    });
    const { runUniversalSearch } = await loadUniversalSearch();
    await runUniversalSearch({
      query: "clozapin monitoring",
      limitPerDomain: 3,
      domains: ["documents", "medications"],
      demo: true,
    });
    // Documents self-analyse in retrieval, so they must receive the raw query — not the
    // typo-corrected base query the registry rankers use — to avoid double expansion.
    expect(captured).toContain("clozapin monitoring");
  });

  it("threads expansions into a registry ranker's low-weight lane", async () => {
    const { defaultMedicationRecords } = await import("../src/lib/medication-seed");
    const { rankMedicationRecords } = await import("../src/lib/medications");
    const records = defaultMedicationRecords();
    // A nonsense base query matches nothing on its own…
    expect(rankMedicationRecords(records, "zzznotarealterm", 5)).toHaveLength(0);
    // …but an expansion term surfaces the matching record via the content (expanded) lane.
    const expanded = rankMedicationRecords(records, "zzznotarealterm", 5, ["clozapine"]);
    expect(expanded.some((match) => match.medication.name.toLowerCase() === "clozapine")).toBe(true);
  });

  it("surfaces both the presentation and its candidate differentials for a symptom query", async () => {
    const { runUniversalSearch } = await loadUniversalSearch();
    const response = await runUniversalSearch({
      query: "confusion",
      limitPerDomain: 5,
      domains: ["differentials", "presentations"],
      demo: true,
    });
    const presentations = response.groups.find((group) => group.kind === "presentations");
    expect(presentations?.items[0]?.id).toBe("acute-confusion-encephalopathy");
    expect(presentations?.items[0]?.href).toBe("/differentials/presentations/acute-confusion-encephalopathy");
    expect(presentations?.items[0]?.badge).toBe("Emergent");
    // The reverse link lane surfaces the presentation's candidate differentials for the same
    // symptom vocabulary even though their own titles never contain "confusion".
    const differentials = response.groups.find((group) => group.kind === "differentials");
    const candidateSlugs = new Set([
      "delirium",
      "substance-intoxication",
      "substance-withdrawal",
      "post-ictal-confusion",
      "dementia-with-superimposed-delirium",
      "wernicke-encephalopathy",
      "hepatic-encephalopathy",
    ]);
    expect(differentials?.items.some((item) => candidateSlugs.has(item.id))).toBe(true);
  });

  it("leads with the presentation for a symptom phrase that whole-phrase-matches its title", async () => {
    const { runUniversalSearch } = await loadUniversalSearch();
    const response = await runUniversalSearch({
      query: "acute confusion",
      limitPerDomain: 5,
      domains: ["differentials", "presentations"],
      demo: true,
    });
    // No diagnosis title contains the phrase, so only the presentations group is confident and
    // it is promoted to lead + Best match.
    expect(response.domainOrder?.[0]).toBe("presentations");
    expect(response.topHit?.kind).toBe("presentations");
    expect(response.topHit?.href).toBe("/differentials/presentations/acute-confusion-encephalopathy");
  });

  it("prefers the exact diagnosis over the umbrella presentation when both titles match", async () => {
    const { runUniversalSearch } = await loadUniversalSearch();
    const response = await runUniversalSearch({
      query: "substance intoxication",
      limitPerDomain: 5,
      domains: ["differentials", "presentations"],
      demo: true,
    });
    // Both kinds hold a confident whole-phrase title match ("Substance intoxication" is a
    // diagnosis and an umbrella presentation); canonical order pins Best match to the precise
    // diagnosis page ahead of the umbrella.
    expect(response.topHit?.kind).toBe("differentials");
    expect(response.domainOrder?.slice(0, 2)).toEqual(["differentials", "presentations"]);
  });
});

describe("runUniversalSearch (canonical catalogue authority)", () => {
  it("re-reads canonical publications across prefixes without consulting owner drafts", async () => {
    isolateNextModuleImport();
    const fetchOwnerMedicationRowsWithSeed = vi.fn<
      (supabase: unknown, ownerId: string, limit: number, options: { select?: string }) => Promise<unknown[]>
    >(async () => [
      {
        slug: "clozapine",
        name: "Clozapine",
        class: "Antipsychotic",
        subclass: "Second generation",
        category: "Psychosis",
        tag: "High monitoring",
        schedule: "S4",
        stats: [],
        sections: [],
        quick: [],
      },
    ]);
    const fetchOwnerRegistryRows = vi.fn<
      (
        supabase: unknown,
        ownerId: string,
        kind: string,
        limit: number,
        options: { select?: string },
      ) => Promise<unknown[]>
    >(async () => [
      {
        slug: "clozapine-clinic",
        title: "Clozapine clinic",
        subtitle: null,
        status_chips: [],
        primary_contact: null,
        contacts: [],
        route: null,
        eligibility: null,
        cost: null,
        referral: null,
        location: null,
        summary_cards: [],
        referral_info: [],
        best_use: null,
        criteria: [],
        verification: {},
        tags: [],
        catchments: [],
        catalogue_label: null,
        navigator_query: null,
        source: {},
        catalog_payload: {},
      },
    ]);
    vi.doMock("@/lib/medication-seed", async (importOriginal) => ({
      ...(await importOriginal<typeof import("../src/lib/medication-seed")>()),
      fetchOwnerMedicationRowsWithSeed,
    }));
    vi.doMock("@/lib/registry-seed", async (importOriginal) => ({
      ...(await importOriginal<typeof import("../src/lib/registry-seed")>()),
      fetchOwnerRegistryRows,
    }));

    const readCanonicalSiteContentRecords = vi.fn(async () => ({
      records: [],
      source: "canonical_public",
      snapshot: null,
    }));
    vi.doMock("@/lib/site-content/site-content-publication", () => ({ readCanonicalSiteContentRecords }));
    const { runUniversalSearch } = await loadUniversalSearch();
    const args = {
      limitPerDomain: 3,
      domains: ["medications", "services"] as Array<"medications" | "services">,
      demo: false,
      ownerId: "owner-a",
      supabase: {} as never,
    };
    await runUniversalSearch({ ...args, query: "clo" });
    await runUniversalSearch({ ...args, query: "cloz" });

    expect(fetchOwnerMedicationRowsWithSeed).not.toHaveBeenCalled();
    expect(fetchOwnerRegistryRows).not.toHaveBeenCalled();
    expect(readCanonicalSiteContentRecords).toHaveBeenCalledTimes(4);
    expect(readCanonicalSiteContentRecords).toHaveBeenCalledWith(
      expect.objectContaining({
        supabase: args.supabase,
        kind: "medication",
        slug: null,
        signal: expect.any(AbortSignal),
      }),
    );
    expect(readCanonicalSiteContentRecords).toHaveBeenCalledWith(
      expect.objectContaining({
        supabase: args.supabase,
        kind: "service",
        slug: null,
        signal: expect.any(AbortSignal),
      }),
    );
  });
});

// Regression guard: outside an explicit demo/local deploy, no caller — including an anonymous,
// no-cookie live visitor — may be served the synthetic demo corpus. The documents domain must
// reach the real retrieval pipeline (demo:false + supabase), scoped to the public corpus for
// anonymous callers, and the anonymous path must be rate limited.
describe("GET /api/search/universal (live public/owner path)", () => {
  const userId = "11111111-1111-4111-8111-111111111111";
  const token = "session-token";

  type RunArgs = { demo: boolean; ownerId?: string; supabase?: unknown };
  const createRunMock = () =>
    vi.fn<(args: RunArgs) => Promise<{ query: string; groups: unknown[]; tookMs: number }>>(async () => ({
      query: "clozapine",
      groups: [],
      tookMs: 1,
    }));

  function createSupabaseMock(options: { limited?: boolean } = {}) {
    const rpc = vi.fn(async () => ({
      data: [
        {
          limited: Boolean(options.limited),
          limit_value: 120,
          remaining: options.limited ? 0 : 119,
          retry_after_seconds: 60,
          reset_at: new Date(Date.now() + 60_000).toISOString(),
        },
      ],
      error: null,
    }));
    const getUser = vi.fn(async (receivedToken?: string) =>
      receivedToken === token
        ? { data: { user: { id: userId } }, error: null }
        : { data: { user: null }, error: { message: "Invalid token" } },
    );
    return { rpc, auth: { getUser } };
  }

  function mockRuntime(
    client: ReturnType<typeof createSupabaseMock>,
    runUniversalSearch: ReturnType<typeof createRunMock>,
  ) {
    isolateNextModuleImport();
    // env:{} keeps isDemoMode false (forcing the live path) while leaving the Supabase public
    // keys unset, so the cookie-session probe resolves anonymous without a network call.
    vi.doMock("@/lib/env", () => ({
      env: {},
      isDemoMode: () => false,
      isLocalNoAuthMode: () => false,
      requireOpenAIEnv: () => undefined,
      requireServerEnv: () => undefined,
    }));
    vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient: () => client }));
    // Replace only the entrypoint; the schema still needs the real domain list.
    vi.doMock("@/lib/universal-search", () => ({
      runUniversalSearch,
      universalSearchDomains: [
        "documents",
        "medications",
        "services",
        "forms",
        "differentials",
        "presentations",
        "dsm",
        "specifiers",
        "formulation",
        "therapies",
        "tools",
      ],
    }));
  }

  // #3728: universal search needs sign-in from 1 November 2026, so a signed-out live request
  // is refused before the limiter or any search pipeline runs, and never falls back to demo.
  it("refuses an unauthenticated live request with 401 and never runs a pipeline", async () => {
    const client = createSupabaseMock();
    const runUniversalSearch = createRunMock();
    mockRuntime(client, runUniversalSearch);
    const { GET } = await import("../src/app/api/search/universal/route");

    const response = await GET(new Request("http://localhost/api/search/universal?q=clozapine"));

    expect(response.status).toBe(401);
    expect(runUniversalSearch).not.toHaveBeenCalled();
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("rate limits the signed-in universal-search path instead of leaving it unthrottled", async () => {
    const client = createSupabaseMock({ limited: true });
    const runUniversalSearch = createRunMock();
    mockRuntime(client, runUniversalSearch);
    const { GET } = await import("../src/app/api/search/universal/route");

    const response = await GET(
      new Request("http://localhost/api/search/universal?q=clozapine", {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );

    expect(response.status).toBe(429);
    // A throttled request must never fall through to any search pipeline.
    expect(runUniversalSearch).not.toHaveBeenCalled();
  });

  it("serves an authenticated owner their own records with demo:false and no public flag", async () => {
    const client = createSupabaseMock();
    const runUniversalSearch = createRunMock();
    mockRuntime(client, runUniversalSearch);
    const { GET } = await import("../src/app/api/search/universal/route");

    const response = await GET(
      new Request("http://localhost/api/search/universal?q=clozapine", {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
    const payload = (await response.json()) as { demoMode?: boolean; publicAccess?: boolean };

    expect(response.status).toBe(200);
    expect(payload.publicAccess).toBeUndefined();
    expect(payload.demoMode).toBeUndefined();
    const args = runUniversalSearch.mock.calls[0]![0];
    expect(args.demo).toBe(false);
    expect(args.ownerId).toBe(userId);
  });

  it("ends a rejected NDJSON search with a redacted error event", async () => {
    const client = createSupabaseMock();
    const runUniversalSearch = createRunMock();
    runUniversalSearch.mockRejectedValue(new Error("private dependency failure"));
    mockRuntime(client, runUniversalSearch);
    const { GET } = await import("../src/app/api/search/universal/route");

    const response = await GET(
      new Request("http://localhost/api/search/universal?q=clozapine&stream=ndjson", {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
    const events = (await response.text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);

    expect(response.status).toBe(200);
    expect(events).toEqual([{ type: "error", code: "universal_search_failed" }]);
    expect(JSON.stringify(events)).not.toContain("private dependency failure");
  });
});
