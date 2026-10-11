import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import DifferentialPresentationRoute, {
  generateMetadata,
  generateStaticParams,
} from "@/app/(search-app)/differentials/presentations/[slug]/page";
import { resolvePresentationSlug } from "@/lib/differentials";
import type { DifferentialSnapshot } from "@/lib/differential-snapshot";

const rawSnapshot = JSON.parse(readFileSync("data/differentials-snapshot.json", "utf8")) as DifferentialSnapshot;
const rawCrossModeIndex = JSON.parse(readFileSync("src/data/cross-mode-differentials-index.json", "utf8"));

describe("Challenger M2-2 Empirical: Differential Identifier Collisions (#HNJF5X)", () => {
  const diagnosisSlugs = rawSnapshot.diagnoses.map((d) => d.slug);
  const presentationIds = rawSnapshot.presentations.map((p) => p.id);

  it("asserts exact count of 201 diagnoses and 31 presentations (total 232)", () => {
    expect(diagnosisSlugs.length).toBe(201);
    expect(presentationIds.length).toBe(31);
    expect(diagnosisSlugs.length + presentationIds.length).toBe(232);
  });

  it("asserts 0 collisions between diagnosis slugs and presentation IDs in raw snapshot", () => {
    const diagSet = new Set(diagnosisSlugs);
    const collisions = presentationIds.filter((id) => diagSet.has(id));
    expect(collisions).toEqual([]);
  });

  it("asserts exactly 232 distinct identifiers when flattened into a single Set", () => {
    const flattened = new Set([...diagnosisSlugs, ...presentationIds]);
    expect(flattened.size).toBe(232);
  });

  it("verifies namespacing of previously colliding presentation IDs", () => {
    expect(presentationIds).toContain("presentation-depression");
    expect(presentationIds).toContain("presentation-substance-intoxication");
    expect(presentationIds).toContain("presentation-substance-withdrawal");

    // The legacy names must NOT be in presentation IDs
    expect(presentationIds).not.toContain("depression");
    expect(presentationIds).not.toContain("substance-intoxication");
    expect(presentationIds).not.toContain("substance-withdrawal");

    // But MUST still exist as diagnosis slugs
    expect(diagnosisSlugs).toContain("depression");
    expect(diagnosisSlugs).toContain("substance-intoxication");
    expect(diagnosisSlugs).toContain("substance-withdrawal");
  });

  it("asserts 0 collisions in cross-mode index static dataset", () => {
    const crossDiag = (rawCrossModeIndex.diagnoses ?? []).map((d: { slug: string }) => d.slug);
    const crossPres = (rawCrossModeIndex.presentations ?? []).map((p: { id: string }) => p.id);

    expect(crossDiag.length).toBe(201);
    expect(crossPres.length).toBe(31);

    const crossDiagSet = new Set(crossDiag);
    const crossCollisions = crossPres.filter((id: string) => crossDiagSet.has(id));
    expect(crossCollisions).toEqual([]);
  });
});

describe("Challenger M2-2 Empirical: Legacy Presentation Route Redirects (#HNJF5X)", () => {
  describe("resolvePresentationSlug()", () => {
    it("maps legacy aliases to namespaced presentation slugs", () => {
      expect(resolvePresentationSlug("depression")).toBe("presentation-depression");
      expect(resolvePresentationSlug("substance-intoxication")).toBe("presentation-substance-intoxication");
      expect(resolvePresentationSlug("substance-withdrawal")).toBe("presentation-substance-withdrawal");
    });

    it("handles casing and whitespace gracefully", () => {
      expect(resolvePresentationSlug("  depression  ")).toBe("presentation-depression");
      expect(resolvePresentationSlug("DEPRESSION")).toBe("presentation-depression");
      expect(resolvePresentationSlug("  Substance-Intoxication ")).toBe("presentation-substance-intoxication");
      expect(resolvePresentationSlug("Substance-Withdrawal")).toBe("presentation-substance-withdrawal");
    });

    it("passes canonical and unaliased slugs through unchanged", () => {
      expect(resolvePresentationSlug("presentation-depression")).toBe("presentation-depression");
      expect(resolvePresentationSlug("delirium")).toBe("delirium");
      expect(resolvePresentationSlug("psychosis")).toBe("psychosis");
      expect(resolvePresentationSlug("unknown-nonexistent-slug")).toBe("unknown-nonexistent-slug");
    });
  });

  describe("generateStaticParams()", () => {
    it("includes both canonical presentation slugs and legacy aliases for static site generation", () => {
      const params = generateStaticParams();
      const slugs = params.map((p) => p.slug);

      // Legacy aliases
      expect(slugs).toContain("depression");
      expect(slugs).toContain("substance-intoxication");
      expect(slugs).toContain("substance-withdrawal");

      // Canonical namespaced slugs
      expect(slugs).toContain("presentation-depression");
      expect(slugs).toContain("presentation-substance-intoxication");
      expect(slugs).toContain("presentation-substance-withdrawal");

      // Total count: 31 canonical + 3 legacy aliases = 34
      expect(params.length).toBe(34);
    });
  });

  describe("DifferentialPresentationRoute redirect behavior", () => {
    const catchRedirectUrl = async (promise: Promise<unknown>): Promise<string> => {
      try {
        await promise;
        throw new Error("Expected redirect to throw NEXT_REDIRECT");
      } catch (err: unknown) {
        const digest = String((err as { digest?: unknown }).digest ?? "");
        // next/navigation redirect digest is "NEXT_REDIRECT;<action>;<url>;<status>;..."
        const parts = digest.split(";");
        if (parts[0] === "NEXT_REDIRECT" && parts[2]) {
          return parts[2];
        }
        throw err;
      }
    };

    it("redirects /differentials/presentations/depression to /differentials/presentations/presentation-depression", async () => {
      const targetUrl = await catchRedirectUrl(
        DifferentialPresentationRoute({
          params: Promise.resolve({ slug: "depression" }),
        }),
      );
      expect(targetUrl).toBe("/differentials/presentations/presentation-depression");
    });

    it("preserves query parameters during redirect of legacy depression slug", async () => {
      const targetUrl = await catchRedirectUrl(
        DifferentialPresentationRoute({
          params: Promise.resolve({ slug: "depression" }),
          searchParams: Promise.resolve({
            q: "bipolar",
            ids: "bipolar-i,major-depressive",
          }),
        }),
      );
      expect(targetUrl).toBe(
        "/differentials/presentations/presentation-depression?q=bipolar&ids=bipolar-i%2Cmajor-depressive",
      );
    });

    it("preserves repeated/array search parameters during redirect", async () => {
      const targetUrl = await catchRedirectUrl(
        DifferentialPresentationRoute({
          params: Promise.resolve({ slug: "depression" }),
          searchParams: Promise.resolve({
            query: ["first", "second"],
          }),
        }),
      );
      expect(targetUrl).toBe("/differentials/presentations/presentation-depression?query=first&query=second");
    });

    it("redirects substance-intoxication and substance-withdrawal legacy slugs", async () => {
      const intoxTarget = await catchRedirectUrl(
        DifferentialPresentationRoute({
          params: Promise.resolve({ slug: "substance-intoxication" }),
        }),
      );
      expect(intoxTarget).toBe("/differentials/presentations/presentation-substance-intoxication");

      const withdrawTarget = await catchRedirectUrl(
        DifferentialPresentationRoute({
          params: Promise.resolve({ slug: "substance-withdrawal" }),
          searchParams: Promise.resolve({ query: "alcohol" }),
        }),
      );
      expect(withdrawTarget).toBe("/differentials/presentations/presentation-substance-withdrawal?query=alcohol");
    });

    it("does NOT redirect canonical presentation-depression slug", async () => {
      let threwRedirect = false;
      try {
        await DifferentialPresentationRoute({
          params: Promise.resolve({ slug: "presentation-depression" }),
        });
      } catch (err: unknown) {
        const digest = String((err as { digest?: unknown }).digest ?? "");
        if (digest.startsWith("NEXT_REDIRECT")) {
          threwRedirect = true;
        }
      }
      expect(threwRedirect).toBe(false);
    });
  });

  describe("generateMetadata() with legacy slug", () => {
    it("resolves metadata successfully for legacy depression slug without throwing not-found", async () => {
      const meta = await generateMetadata({
        params: Promise.resolve({ slug: "depression" }),
      });
      expect(meta.title).toBeDefined();
      expect(meta.title).not.toBe("Differential presentation not found - PsychSift");
      expect(meta.description).toBeDefined();
    });
  });
});
