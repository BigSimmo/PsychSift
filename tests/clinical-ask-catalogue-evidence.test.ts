import { describe, expect, it } from "vitest";

import { retrieveCatalogueEvidence } from "@/lib/clinical-ask/catalogue-evidence";
import { isSpecifierClinicianReviewed, specifierCatalogItems } from "@/lib/specifiers-content";
import { clinicalAskCases } from "./fixtures/clinical-ask-cases";

describe("retrieveCatalogueEvidence", () => {
  it.each(clinicalAskCases)("normalizes ranked $mode catalogue records", async (request) => {
    const evidence = await retrieveCatalogueEvidence(request, new AbortController().signal);

    expect(evidence.length).toBeGreaterThan(0);
    expect(evidence.length).toBeLessThanOrEqual(12);
    for (const item of evidence) {
      expect(item).toMatchObject({
        id: expect.stringMatching(`^catalogue:${request.mode}:`),
        tier: "catalogue",
        title: expect.any(String),
        publisher: expect.any(String),
        href: expect.stringMatching(/^\//),
        extract: expect.any(String),
        reviewState: expect.stringMatching(/^(reviewed|needs_review|unknown)$/),
      });
      expect(item.title.trim()).not.toBe("");
      expect(item.publisher.trim()).not.toBe("");
      expect(item.extract.trim()).not.toBe("");
      expect(item.extract.length).toBeLessThanOrEqual(2_000);
    }
  });

  it.each(clinicalAskCases)(
    "returns no $mode evidence when nothing matches instead of the whole catalogue",
    async (request) => {
      // A question that matches no catalogue record must reach the orchestrator as
      // an empty tier so its evidence-gap path fires before any provider call (L16).
      const evidence = await retrieveCatalogueEvidence(
        { ...request, question: "zqxvblorp qwxzk" },
        new AbortController().signal,
      );

      expect(evidence).toEqual([]);
    },
  );

  it("preserves Therapy governance without ranking needs-review records upward", async () => {
    const request = clinicalAskCases.find(({ mode }) => mode === "therapy-compass")!;
    const evidence = await retrieveCatalogueEvidence({ ...request, question: "" }, new AbortController().signal);

    const needsReview = evidence.find((item) => item.reviewState === "needs_review");
    expect(needsReview).toBeDefined();
    expect(evidence.map((item) => item.id)).toEqual(
      [...evidence].sort((left, right) => left.title.localeCompare(right.title)).map((item) => item.id),
    );
  });

  it("never sends an unsigned specifier definition to synthesis", async () => {
    const unsigned = specifierCatalogItems().find(
      (item) => item.definition?.meaning && !isSpecifierClinicianReviewed(item.review),
    );
    expect(unsigned).toBeDefined();
    const request = clinicalAskCases.find(({ mode }) => mode === "specifiers")!;
    const evidence = await retrieveCatalogueEvidence(
      { ...request, question: unsigned!.label },
      new AbortController().signal,
    );

    const match = evidence.find((item) => item.href === `/specifiers/${unsigned!.slug}`);
    expect(match).toBeDefined();
    expect(match!.reviewState).toBe("needs_review");
    expect(match!.extract).not.toContain(unsigned!.definition!.meaning);
  });

  it("fails with AbortError before catalogue work", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(retrieveCatalogueEvidence(clinicalAskCases[0], controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
  });
});
