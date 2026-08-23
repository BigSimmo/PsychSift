import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { appModeDefinition } from "@/lib/app-modes";
import {
  buildAllSiteContentRecords,
  buildDynamicSiteContentSeedRecords,
  buildStaticSiteContentRecords,
  siteContentAdapterDefinitions,
} from "@/lib/site-content/adapters";
import {
  buildRegistryPublicReconciliationReport,
  registryEntriesToSiteContentRecords,
} from "@/lib/site-content/adapters/registry";
import {
  buildStaticSiteContentManifest,
  createSiteContentRecord,
  diffStaticSiteContentManifests,
} from "@/lib/site-content/site-content-manifest";
import type { StaticSiteContentManifest } from "@/lib/site-content/site-content-manifest";
import {
  siteContentProducerDefinitions,
  siteContentRegistryVersion,
  siteContentRetrievalMetadata,
} from "@/lib/site-content/site-content-registry";
import type { SiteContentRecord } from "@/lib/site-content/site-content-contracts";
import type { RegistryCorpusEntry } from "@/lib/registry-corpus";
import { toolCatalogRecords } from "@/lib/tools-catalog";

import staticManifestBaselineJson from "./fixtures/site-content/static-manifest-baseline.json";

function staticRecord(overrides: Partial<SiteContentRecord> = {}) {
  return createSiteContentRecord({
    logicalId: "tools:services",
    producerClass: "static_repository",
    domain: "tools",
    route: "/tools/services",
    title: "  Services  ",
    body: "Open source-backed service records.\r\n\r\n  Public metadata only. ",
    sourceRole: "tool_reference",
    access: "public",
    validationStatus: "approved",
    sourceStatus: "current",
    publicationVersion: "tools-v1",
    sourceLineage: [],
    ...overrides,
  });
}

const metadata = { gitSha: "03d5af81fdec526595df6dd6ba5a0250de859bdd", registryVersion: siteContentRegistryVersion };

describe("static site-content manifest", () => {
  it("canonicalizes whitespace and produces stable sorted identities and digests", () => {
    const first = staticRecord();
    const second = staticRecord({
      logicalId: "tools:differentials",
      route: "/tools/differentials",
      title: "Differentials",
      body: "Compare diagnostic possibilities.",
    });

    expect(first.title).toBe("Services");
    expect(first.body).toBe("Open source-backed service records.\n\nPublic metadata only.");

    const left = buildStaticSiteContentManifest([first, second], metadata, {
      generatedAt: "2026-08-23T00:00:00.000Z",
    });
    const right = buildStaticSiteContentManifest([second, first], metadata, {
      generatedAt: "2026-08-23T01:00:00.000Z",
    });

    expect(left.records.map((record) => record.logicalId)).toEqual(["tools:differentials", "tools:services"]);
    expect(left.staticManifestDigest).toBe(right.staticManifestDigest);
    expect(left.records).toEqual(right.records);
    expect(left.generatedAt).not.toBe(right.generatedAt);
  });

  it("keeps unrelated repository commits outside the registered static content digest", () => {
    const baseline = buildStaticSiteContentManifest([staticRecord()], metadata);
    const uiOnlyCommit = buildStaticSiteContentManifest([staticRecord()], {
      ...metadata,
      gitSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });

    expect(uiOnlyCommit.gitSha).not.toBe(baseline.gitSha);
    expect(uiOnlyCommit.staticManifestDigest).toBe(baseline.staticManifestDigest);
  });

  it("changes only the edited static record hash and the manifest digest", () => {
    const first = staticRecord();
    const second = staticRecord({
      logicalId: "tools:differentials",
      route: "/tools/differentials",
      title: "Differentials",
      body: "Compare diagnostic possibilities.",
    });
    const baseline = buildStaticSiteContentManifest([first, second], metadata);
    const candidate = buildStaticSiteContentManifest(
      [first, createSiteContentRecord({ ...second, body: "Compare diagnostic possibilities safely." })],
      metadata,
    );
    const diff = diffStaticSiteContentManifests(baseline, candidate);

    expect(diff).toMatchObject({ added: [], removed: [], changed: ["tools:differentials"] });
    expect(candidate.records.find((record) => record.logicalId === "tools:services")?.contentHash).toBe(
      baseline.records.find((record) => record.logicalId === "tools:services")?.contentHash,
    );
    expect(candidate.staticManifestDigest).not.toBe(baseline.staticManifestDigest);
  });

  it("validates dynamic records but never folds them into the deployment static digest", () => {
    const dynamic = createSiteContentRecord({
      ...staticRecord(),
      logicalId: "service:public-service",
      producerClass: "dynamic_registry",
      domain: "services",
      route: "/services/public-service",
      sourceRole: "service_directory",
    });
    const staticOnly = buildStaticSiteContentManifest([staticRecord()], metadata);
    const mixed = buildStaticSiteContentManifest([dynamic, staticRecord()], metadata);

    expect(mixed.staticManifestDigest).toBe(staticOnly.staticManifestDigest);
    expect(mixed.records).toEqual(staticOnly.records);
  });

  it("rejects duplicate logical IDs, invalid routes, private rows, and actor identifiers", () => {
    expect(() => buildStaticSiteContentManifest([staticRecord(), staticRecord()], metadata)).toThrow(/duplicate/i);
    expect(() => createSiteContentRecord({ ...staticRecord(), route: "tools/services" })).toThrow(/route/i);
    expect(() =>
      buildStaticSiteContentManifest(
        [{ ...staticRecord(), access: "private" } as unknown as SiteContentRecord],
        metadata,
      ),
    ).toThrow(/public/i);
    expect(() =>
      buildStaticSiteContentManifest(
        [{ ...staticRecord(), ownerId: "editor-123" } as SiteContentRecord & { ownerId: string }],
        metadata,
      ),
    ).toThrow(/owner|actor|audit/i);
    expect(() => createSiteContentRecord({ ...staticRecord(), body: "Published by administrator-123." })).toThrow(
      /owner|actor|administrator/i,
    );
  });
});

describe("complete provider-free adapter coverage", () => {
  it("registers every producer exactly once and keeps dynamic seed families outside the static digest", () => {
    expect(siteContentAdapterDefinitions.map((adapter) => adapter.producerKey)).toEqual(
      siteContentProducerDefinitions.map((producer) => producer.key),
    );
    expect(new Set(siteContentAdapterDefinitions.map((adapter) => adapter.producerKey)).size).toBe(
      siteContentProducerDefinitions.length,
    );

    const dynamic = buildDynamicSiteContentSeedRecords();
    expect(new Set(dynamic.map((record) => record.domain))).toEqual(
      new Set(["services", "forms", "medications", "differentials"]),
    );
    expect(dynamic.every((record) => record.producerClass === "dynamic_registry")).toBe(true);

    const staticRecords = buildStaticSiteContentRecords();
    expect(new Set(staticRecords.map((record) => record.domain))).toEqual(
      new Set(["specifiers", "dsm", "formulation", "therapies", "dictionary", "factsheets", "calculators", "tools"]),
    );
    expect(siteContentAdapterDefinitions.every((adapter) => adapter.build().length > 0)).toBe(true);
    expect(
      siteContentAdapterDefinitions.every((adapter) =>
        adapter.build().every((record) => record.producerClass === adapter.producerClass),
      ),
    ).toBe(true);
    expect(buildAllSiteContentRecords()).toHaveLength(staticRecords.length + dynamic.length);
    expect(buildAllSiteContentRecords()).toEqual(buildAllSiteContentRecords());
    const manifest = buildStaticSiteContentManifest(buildAllSiteContentRecords(), metadata);
    expect(
      manifest.records.every(
        (record) => !["services", "forms", "medications", "differentials"].includes(record.domain),
      ),
    ).toBe(true);
  });

  it("keeps every current Healthdirect-bearing medication seed outside retrieval eligibility", () => {
    const healthdirectRecords = buildDynamicSiteContentSeedRecords()
      .filter((record) => /healthdirect/i.test(record.body))
      .sort((left, right) => left.logicalId.localeCompare(right.logicalId));
    expect(healthdirectRecords.map((record) => record.logicalId)).toEqual([
      "medication:glycerol-suppository",
      "medication:levothyroxine",
      "medication:nicotine-sublingual-tablet",
      "medication:osmolax",
      "medication:phenelzine",
    ]);

    const retrievalEligible = healthdirectRecords.filter((record) => {
      try {
        siteContentRetrievalMetadata(record);
        return true;
      } catch {
        return false;
      }
    });
    expect(retrievalEligible.map((record) => record.logicalId)).toEqual([]);
  });

  it("fails closed on forbidden source evidence in record bodies and lineage", () => {
    const amhBody = staticRecord({
      route: "/services",
      body: "AMH protected treatment content",
    });
    expect(() => siteContentRetrievalMetadata(amhBody)).toThrow(/excluded|link-only/i);
    expect(buildStaticSiteContentManifest([amhBody], metadata).records[0]).toMatchObject({
      eligible: false,
      exclusionReason: "record_not_eligible",
    });

    const etgLineage = staticRecord({
      route: "/services",
      sourceLineage: [
        {
          sourceId: "eTG complete",
          sourceHash: "sha256:protected-reference",
          relationship: "derived_from",
        },
      ],
    });
    expect(() => siteContentRetrievalMetadata(etgLineage)).toThrow(/excluded|link-only/i);
  });

  it("preserves reviewed ineligibility and only adopts safe primitive Tools descriptions", () => {
    const records = buildStaticSiteContentRecords();
    const manifest = buildStaticSiteContentManifest(records, metadata);
    for (const domain of [
      "factsheets",
      "dictionary",
      "specifiers",
      "calculators",
      "therapies",
      "formulation",
    ] as const) {
      const domainRecords = manifest.records.filter((record) => record.domain === domain);
      expect(domainRecords.length).toBeGreaterThan(0);
      expect(domainRecords.every((record) => !record.eligible && record.exclusionReason)).toBe(true);
    }

    const tools = records.filter((record) => record.domain === "tools");
    expect(tools.map((record) => record.logicalId)).toEqual(["tools:differentials", "tools:forms", "tools:services"]);
    expect(
      manifest.records
        .filter((record) => record.domain === "tools" && record.eligible)
        .map(({ logicalId, route }) => ({ logicalId, route })),
    ).toEqual([
      { logicalId: "tools:differentials", route: "/differentials" },
      { logicalId: "tools:forms", route: "/forms" },
      { logicalId: "tools:services", route: "/services" },
    ]);
    for (const record of tools) {
      const canonicalOwner = toolCatalogRecords.find((tool) => `tools:${tool.id}` === record.logicalId);
      expect(canonicalOwner).toBeDefined();
      expect(record.route).toBe(canonicalOwner?.href);
      expect(
        existsSync(resolve(import.meta.dirname, "../src/app/(search-app)", record.route.slice(1), "page.tsx")),
      ).toBe(true);
    }
    expect(JSON.stringify(tools)).not.toMatch(/icon|glyph|neededInput|checkFirst|question|points|score|owner|actor/i);
  });

  it("resolves every static manifest record to a canonical rendered app destination", () => {
    const manifest = buildStaticSiteContentManifest(buildStaticSiteContentRecords(), metadata);
    const appRoot = resolve(import.meta.dirname, "../src/app/(search-app)");
    const routeContracts = {
      calculators: { route: /^\/calculators$/, page: "calculators/page.tsx" },
      dictionary: { route: /^\/dictionary\/[^/]+$/, page: "dictionary/[slug]/page.tsx" },
      dsm: { route: /^\/dsm\/diagnoses\/[^/]+$/, page: "dsm/diagnoses/[slug]/page.tsx" },
      factsheets: { route: /^\/factsheets\/[^/]+$/, page: "factsheets/[slug]/page.tsx" },
      formulation: { route: /^\/formulation\/[^/]+$/, page: "formulation/[slug]/page.tsx" },
      specifiers: { route: /^\/specifiers\/[^/]+$/, page: "specifiers/[slug]/page.tsx" },
      therapies: { route: /^\/therapy-compass\/[^/]+$/, page: "therapy-compass/[slug]/page.tsx" },
      tools: { route: /^\/(?:differentials|forms|services)$/, page: null },
    } as const;

    expect(new Set(manifest.records.map((record) => record.domain))).toEqual(new Set(Object.keys(routeContracts)));
    expect(
      Object.values(routeContracts)
        .filter((contract) => contract.page)
        .every((contract) => existsSync(resolve(appRoot, contract.page!))),
    ).toBe(true);
    const invalidRoutes = manifest.records.filter((record) => {
      const contract = routeContracts[record.domain as keyof typeof routeContracts];
      const destinationExists =
        contract.page !== null || existsSync(resolve(appRoot, record.route.slice(1), "page.tsx"));
      return !contract.route.test(record.route) || !destinationExists;
    });
    expect({
      count: invalidRoutes.length,
      domains: [...new Set(invalidRoutes.map((record) => record.domain))].sort(),
      sample: invalidRoutes.slice(0, 3).map((record) => ({ logicalId: record.logicalId, route: record.route })),
    }).toEqual({ count: 0, domains: [], sample: [] });
    const calculatorMode = appModeDefinition("calculators");
    const calculatorDestination = "href" in calculatorMode ? calculatorMode.href : null;
    expect(calculatorDestination).toBe("/calculators");
    expect(
      new Set(manifest.records.filter((record) => record.domain === "calculators").map((record) => record.route)),
    ).toEqual(new Set([calculatorDestination]));
  });

  it("keeps the manifest CLI import-safe even when importer argv names an output", () => {
    const root = resolve(import.meta.dirname, "..");
    const temporaryRoot = mkdtempSync(join(tmpdir(), "site-content-manifest-import-"));
    const unexpectedOutput = join(temporaryRoot, "unexpected.json");
    const scriptUrl = pathToFileURL(resolve(root, "scripts/build-site-content-manifest.ts")).href;
    const importExpression = `import(${JSON.stringify(scriptUrl)}).catch((error) => { console.error(error); process.exitCode = 70; });`;

    try {
      const quietImport = spawnSync(process.execPath, ["scripts/run-tsx.mjs", "--eval", importExpression], {
        cwd: root,
        encoding: "utf8",
        timeout: 30_000,
      });
      const poisonedArgvImport = spawnSync(
        process.execPath,
        [
          "scripts/run-tsx.mjs",
          "--eval",
          `process.argv.push("--out", ${JSON.stringify(unexpectedOutput)}); ${importExpression}`,
        ],
        { cwd: root, encoding: "utf8", timeout: 30_000 },
      );

      for (const result of [quietImport, poisonedArgvImport]) {
        expect(result.error).toBeUndefined();
        expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
        expect(result.stdout).toBe("");
        expect(result.stderr).toBe("");
      }
      expect(existsSync(unexpectedOutput)).toBe(false);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it("matches the checked-in metadata-only static baseline", () => {
    const baseline = staticManifestBaselineJson as StaticSiteContentManifest;
    const current = buildStaticSiteContentManifest(buildAllSiteContentRecords(), {
      gitSha: baseline.gitSha,
      registryVersion: baseline.registryVersion,
    });

    expect(current.records).toEqual(baseline.records);
    expect(current.staticManifestDigest).toBe(baseline.staticManifestDigest);
    expect(Object.keys(baseline.records[0] ?? {}).sort()).toEqual(
      [
        "contentHash",
        "domain",
        "eligible",
        "exclusionReason",
        "lineageDigest",
        "logicalId",
        "route",
        "sourceStatus",
        "validationStatus",
      ].sort(),
    );
  });

  it("wraps existing registry text and IDs while emitting public metadata without actor identity", () => {
    const entry: RegistryCorpusEntry = {
      kind: "service",
      subkind: "service",
      ownerId: "editor-123",
      recordId: "11111111-1111-4111-8111-111111111111",
      slug: "crisis-service",
      title: "Crisis service",
      subtitle: "Urgent access",
      content: "Service: Crisis service\nUrgent access",
      searchText: "crisis service urgent access",
      sourceStatus: "current",
      validationStatus: "locally_reviewed",
      metadata: { publication_version: "2026-08-23T00:00:00.000Z" },
    };
    const [record] = registryEntriesToSiteContentRecords([entry]);
    expect(record).toMatchObject({
      logicalId: "service:crisis-service",
      body: entry.content,
      producerClass: "dynamic_registry",
      route: "/services/crisis-service",
    });
    expect(JSON.stringify(record)).not.toContain(entry.ownerId);
  });

  it("reports divergent owner-keyed public copies for administrator review without leaking actors", () => {
    const first = createSiteContentRecord({
      ...staticRecord(),
      logicalId: "service:public-service",
      producerClass: "dynamic_registry",
      domain: "services",
      route: "/services/public-service",
      sourceRole: "service_directory",
    });
    const report = buildRegistryPublicReconciliationReport([
      { record: first, publicationState: "published", renderedByPublicSite: true, ownerId: "editor-a" },
      {
        record: createSiteContentRecord({ ...first, publicationVersion: "v2", body: "Divergent public copy." }),
        publicationState: "published",
        renderedByPublicSite: true,
        ownerId: "editor-b",
      },
    ]);

    expect(report).toMatchObject({ ready: false, divergentLogicalIds: ["service:public-service"] });
    expect(JSON.stringify(report)).not.toMatch(/editor-a|editor-b|ownerId/i);
  });
});
