import { describe, expect, it } from "vitest";

import formulationContent from "@/data/formulation-content.json";
import { formulationMechanisms, formulationSourceLibrary } from "@/lib/formulation";
import {
  findFormulationConcept,
  formulationConceptGroups,
  formulationConcepts,
  formulationGuides,
  heldFormulationConcepts,
  linkableEvidence,
  publishedFormulationConcepts,
  publishedFormulationGuides,
  publishedFormulationRecord,
} from "@/lib/formulation-concepts";
import {
  formulationConceptDomainsInUse,
  formulationConceptIndex,
  formulationConceptIndexGroups,
  searchFormulationConcepts,
} from "@/lib/formulation-concept-search";

/**
 * The Formulation content handover of 2026-09-16 added 46 contextual concepts
 * and six guide modules beside the 12 existing mechanisms. These regressions
 * pin the parts that are easy to lose in a bulk content import: the native
 * mechanism identities, the review state that keeps unsigned material out of
 * clinical use, and the rule that a citation must resolve to a real source.
 */
describe("formulation concept library", () => {
  it("keeps the 12 native mechanism identities and never duplicates them as concepts", () => {
    const mechanismIds = formulationMechanisms.map((mechanism) => mechanism.id);
    expect(mechanismIds).toEqual([
      "avoidance",
      "splitting",
      "shame",
      "emotional-dysregulation",
      "reassurance-seeking",
      "attachment-avoidance",
      "negative-core-beliefs",
      "projection",
      "rumination",
      "worry",
      "dissociation",
      "perfectionism",
    ]);

    for (const concept of formulationConcepts) {
      expect(mechanismIds).not.toContain(concept.id);
    }
    const conceptIds = formulationConcepts.map((concept) => concept.id);
    expect(new Set(conceptIds).size).toBe(conceptIds.length);
  });

  it("carries the whole supplied concept and guide payload", () => {
    expect(formulationConcepts).toHaveLength(46);
    expect(formulationGuides).toHaveLength(6);
    for (const concept of formulationConcepts) {
      expect(concept.title).toBeTruthy();
      expect(concept.summary).toBeTruthy();
      expect(concept.packageContentId).toMatch(/^psychsift\.formulation\.content\./);
      expect(concept.review.status).toBeTruthy();
    }
  });

  it("resolves every citation to a real source and never invents a link", () => {
    const all = [...formulationConcepts, ...formulationGuides];
    for (const record of all) {
      for (const evidence of record.evidence) {
        expect(evidence.label).toMatch(/^S\d{2}$/);
        expect(evidence.title).toBeTruthy();
        if (evidence.nativeSourceId) {
          expect(formulationSourceLibrary[evidence.nativeSourceId]).toBeTruthy();
        }
        if (evidence.url) {
          expect(evidence.urlStatus).toBe("governed");
          expect(evidence.url).toMatch(/^https:\/\//);
        } else {
          expect(evidence.urlStatus).not.toBe("governed");
        }
      }
    }
  });

  it("strips chat-only source labels out of every display string", () => {
    const displayed = [...formulationConcepts, ...formulationGuides].flatMap((record) => [
      record.title,
      record.summary,
      record.qualification ?? "",
      record.whenApplies ?? "",
      record.whenDoesNotApply ?? "",
    ]);
    for (const value of displayed) {
      expect(value).not.toMatch(/\bS\d{2}\b/);
      expect(value).not.toMatch(/\[S\d{2}\]\(/);
    }
  });

  it("holds Aboriginal and Torres Strait Islander content until First Nations governance signs it off", () => {
    const sewb = findFormulationConcept("first-nations-sewb");
    expect(sewb).toBeTruthy();
    expect(sewb?.release).toBe("held");
    expect(sewb?.releaseNote).toMatch(/First Nations|Aboriginal/i);
    expect(publishedFormulationConcepts.map((concept) => concept.id)).not.toContain("first-nations-sewb");
    expect(heldFormulationConcepts.map((concept) => concept.id)).toContain("first-nations-sewb");
  });

  it("never returns a held record from search", () => {
    for (const concept of heldFormulationConcepts) {
      const hits = searchFormulationConcepts(concept.title);
      expect(hits.map((hit) => hit.concept.id)).not.toContain(concept.id);
    }
  });

  it("never links or catalogues held admissions", () => {
    for (const record of [...publishedFormulationConcepts, ...publishedFormulationGuides]) {
      for (const entry of record.evidence) {
        if (entry.admission !== "held") continue;
        expect(linkableEvidence([entry])).toEqual([]);
      }
      expect(linkableEvidence(record.evidence).every((entry) => entry.admission !== "held")).toBe(true);
    }
  });

  it("matches contextual factors the mechanism catalogue cannot answer", () => {
    expect(searchFormulationConcepts("housing")[0]?.concept.id).toBe("housing-financial");
    expect(searchFormulationConcepts("delirium")[0]?.concept.id).toBe("cognitive-impairment");
    expect(searchFormulationConcepts("loneliness")[0]?.concept.id).toBe("social-isolation");
  });

  it("fills the biological, social and cultural domains the mechanism set leaves empty", () => {
    const declared = new Set(formulationContent.domains);
    for (const domain of ["Biological", "Social", "Cultural"]) {
      expect(declared.has(domain)).toBe(true);
      expect(formulationMechanisms.some((mechanism) => mechanism.domains.includes(domain))).toBe(false);
      // Carried by a concept record. Every Cultural concept is held pending sign-off
      // (#R8HED2), so this counts held records too.
      expect(formulationConcepts.some((concept) => concept.domains.includes(domain))).toBe(true);
    }
    for (const concept of formulationConcepts) {
      for (const domain of concept.domains) expect(declared.has(domain)).toBe(true);
    }
  });

  it("offers every declared domain as a filter once the concepts carry the last three", () => {
    const carried = new Set([
      ...formulationMechanisms.flatMap((mechanism) => mechanism.domains),
      ...publishedFormulationConcepts.flatMap((concept) => concept.domains),
    ]);
    const heldOnly = new Set(
      heldFormulationConcepts.flatMap((concept) => concept.domains).filter((domain) => !carried.has(domain)),
    );
    // Before the concept import this was 9 of 12: Biological, Social and
    // Cultural were declared and carried by nothing, so the filter derived them
    // away. They are now reachable, and the filter must not hide content the
    // same page lists. A domain whose only records are held (Cultural, #R8HED2)
    // is the exception: it has nothing to reach, so it must not be offered.
    for (const domain of formulationContent.domains) expect(carried.has(domain) || heldOnly.has(domain)).toBe(true);
    for (const domain of heldOnly) expect(formulationConceptDomainsInUse).not.toContain(domain);
    expect(carried.size + heldOnly.size).toBe(formulationContent.domains.length);
  });

  it("groups every published concept under a named browse group", () => {
    const groupIds = new Set(formulationConceptGroups.map((group) => group.id));
    for (const concept of publishedFormulationConcepts) {
      expect(groupIds.has(concept.group)).toBe(true);
    }
    // A group may be wholly held (cultural, #R8HED2), but never empty.
    for (const group of formulationConceptGroups) {
      expect(formulationConcepts.some((concept) => concept.group === group.id)).toBe(true);
    }
  });

  it("keeps the client search index in step with the full records", () => {
    // The index exists so the search page does not download guide bodies,
    // evidence locators and review metadata. Drift between the two would show
    // a card that no longer matches the record it opens. Published guides share
    // the same index so they are reachable from /formulation/search.
    const published = [...publishedFormulationConcepts, ...publishedFormulationGuides];
    expect(formulationConceptIndex).toHaveLength(published.length);
    expect(formulationConceptIndexGroups.map((group) => group.id)).toEqual([
      ...formulationConceptGroups.map((group) => group.id),
      "guides",
    ]);
    for (const entry of formulationConceptIndex) {
      const full = publishedFormulationRecord(entry.id);
      expect(full).toBeTruthy();
      expect(full?.release).toBe("published");
      expect(entry.title).toBe(full?.title);
      expect(entry.summary).toBe(full?.summary);
      expect(entry.kind).toBe(full?.kind);
      expect(entry.group).toBe(full?.group);
      expect(entry.domains).toEqual(full?.domains);
      expect(entry.searchTerms).toEqual(full?.searchTerms);
      // Nothing server-only may leak into the client index.
      for (const field of ["evidence", "warnings", "review", "claimIds", "packageContentId", "blocks"]) {
        expect(entry).not.toHaveProperty(field);
      }
    }
    for (const held of heldFormulationConcepts) {
      expect(formulationConceptIndex.map((entry) => entry.id)).not.toContain(held.id);
    }
  });

  it("makes every published guide reachable from search and drops stop-word-only noise", () => {
    for (const guide of publishedFormulationGuides) {
      const hits = searchFormulationConcepts(guide.title);
      expect(
        hits.some((hit) => hit.concept.id === guide.id),
        `${guide.id} missing from title search`,
      ).toBe(true);
    }
    // "What should I ask about housing?" must surface housing, not all 45+ records
    // from substring hits on a/i/about.
    const housing = searchFormulationConcepts("What should I ask about housing?", {
      interpretNaturalLanguage: true,
    });
    expect(housing[0]?.concept.id).toBe("housing-financial");
    expect(housing.length).toBeLessThan(publishedFormulationConcepts.length);
  });

  it("keeps guide bodies as structured blocks rather than raw markdown", () => {
    for (const guide of formulationGuides) {
      expect(guide.blocks.length).toBeGreaterThan(0);
      for (const block of guide.blocks) {
        if (block.kind === "heading") {
          expect(block.text).not.toMatch(/^#|\*\*/);
          continue;
        }
        const spans = block.kind === "paragraph" ? block.spans : block.items.flat();
        for (const span of spans) {
          expect(span.text).not.toMatch(/\*\*|\[S\d{2}\]\(/);
        }
      }
    }
  });

  it("never marks unreviewed content as clinically approved", () => {
    // A record is either awaiting review with no reviewer, or signed off by a named
    // reviewer through npm run clinical:review, whose content pin
    // tests/clinical-signoff-kinds.test.ts keeps current.
    for (const record of [...formulationConcepts, ...formulationGuides]) {
      if (record.review.status === "reviewed") {
        expect(record.review.reviewer?.trim()).toBeTruthy();
        expect(record.review.reviewedContentSha256).toMatch(/^[a-f0-9]{64}$/);
      } else {
        expect(record.review.reviewer).toBeNull();
        expect(record.review.status).toBe("clinical_review_required");
      }
    }
  });
});
