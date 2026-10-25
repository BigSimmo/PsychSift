import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import owners from "@/lib/site-content/site-content-change-owners.json";
import { siteContentProducerRegistry } from "@/lib/site-content/site-content-registry";

function classify(file: string): string {
  return execFileSync("node", ["scripts/ci-change-scope.mjs", "--files", file], { encoding: "utf8" });
}

function runSelectorWithInjectedOwner(owner: string, cwd = process.cwd()): void {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "site-content-ci-owner-"));
  const temporaryScript = join(temporaryDirectory, "ci-change-scope.mjs");
  // Main derives advisory owners from the checked-in Playwright config.
  if (cwd !== process.cwd()) writeFileSync(join(cwd, "playwright.config.ts"), readFileSync("playwright.config.ts"));
  try {
    const source = readFileSync("scripts/ci-change-scope.mjs", "utf8");
    const injected = source.replace(
      /const siteContentOwnerManifest = JSON\.parse\([\s\S]*?\);\r?\nconst siteContentProducerOwners/,
      `const siteContentOwnerManifest = ${JSON.stringify({
        version: "site-content-change-owners-v1",
        producers: { injected: [owner] },
      })};\nconst siteContentProducerOwners`,
    );
    expect(injected).not.toBe(source);
    writeFileSync(temporaryScript, injected, "utf8");
    writeFileSync(join(temporaryDirectory, "browser-inputs.mjs"), readFileSync("scripts/browser-inputs.mjs"));
    execFileSync("node", [temporaryScript, "--files", "docs/ordinary-note.md"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}

describe("site-content CI owner contract", () => {
  it("covers every registry mode, canonical owner, and declared transitive owner", () => {
    expect(owners.version).toBe("site-content-change-owners-v1");
    expect(Object.keys(owners.producers).sort()).toEqual(
      siteContentProducerRegistry.map((entry) => entry.modeId).sort(),
    );
    for (const producer of siteContentProducerRegistry) {
      expect(producer.changeOwners).toEqual(owners.producers[producer.modeId]);
      expect(producer.changeOwners).toContain(producer.canonicalOwner);
      expect(producer.changeOwners).toEqual([...new Set(producer.changeOwners)].sort());
      for (const owner of producer.changeOwners) expect(owner).not.toMatch(/^(?:data|src)\/\*\*$/);
    }
    expect(execFileSync("node", ["scripts/ci-change-scope.mjs", "--self-test"], { encoding: "utf8" })).toContain(
      "CI change scope self-test passed.",
    );
  });

  it("classifies shared owners and the full-run sentinel without widening unrelated files", () => {
    for (const owner of [
      "src/lib/site-content/site-content-health.ts",
      "src/lib/retrieval-selection.ts",
      "supabase/migrations/20260824123000_add_site_content_health_probe.sql",
      "tests/fixtures/site-content/release-evidence-current.json",
      "src/components/__ci_full_run__.tsx",
    ]) {
      expect(classify(owner)).toContain("site_content_changed=true");
    }
    for (const unrelated of ["docs/ordinary-note.md", "src/components/ordinary-card.tsx", "data/unrelated.json"]) {
      expect(classify(unrelated)).toContain("site_content_changed=false");
    }
  });

  it("classifies each current dynamic registry transitive input independently", () => {
    expect(classify("src/lib/registry-corpus-links.ts")).toContain("site_content_changed=true");
    expect(classify("src/lib/registry-records.ts")).toContain("site_content_changed=true");
    expect(classify("src/lib/medication-records.ts")).toContain("site_content_changed=true");
    expect(classify("src/lib/differential-records.ts")).toContain("site_content_changed=true");
    expect(classify("src/lib/differential-presentation-display.ts")).toContain("site_content_changed=true");
  });

  it("classifies each remaining canonical transitive input independently", () => {
    expect(classify("src/components/calculators/calculator-routes.ts")).toContain("site_content_changed=true");
    expect(classify("src/lib/catalog-search.ts")).toContain("site_content_changed=true");
    expect(classify("src/lib/form-ranker.ts")).toContain("site_content_changed=true");
    expect(classify("src/lib/service-ranker.ts")).toContain("site_content_changed=true");
    expect(classify("src/lib/specifiers.ts")).toContain("site_content_changed=true");
  });

  it("classifies each specialist-proven dynamic value-flow input independently", () => {
    expect(classify("src/lib/registry-fixtures.ts")).toContain("site_content_changed=true");
    expect(classify("src/lib/service-catalog.ts")).toContain("site_content_changed=true");
    expect(classify("src/lib/service-catalog-mapper.ts")).toContain("site_content_changed=true");
    expect(classify("src/lib/compact-best-use-title.ts")).toContain("site_content_changed=true");
    expect(classify("src/lib/form-catalog.ts")).toContain("site_content_changed=true");
    expect(classify("src/lib/mha-act-sections.ts")).toContain("site_content_changed=true");
    expect(classify("data/mha-2014-sections.json")).toContain("site_content_changed=true");
    expect(classify("src/lib/differential-fixtures.ts")).toContain("site_content_changed=true");
    expect(classify("src/lib/differential-seed.ts")).toContain("site_content_changed=true");
    expect(classify("src/lib/medications.ts")).toContain("site_content_changed=true");
    expect(classify("src/lib/medication-fixtures.ts")).toContain("site_content_changed=true");

    expect(owners.producers.services).toContain("src/lib/registry-fixtures.ts");
    expect(owners.producers.forms).toContain("src/lib/registry-fixtures.ts");
  });

  it("keeps manifest validation fail-closed in the selector self-test", () => {
    const source = readFileSync("scripts/ci-change-scope.mjs", "utf8");
    expect(source).toContain("validateSiteContentChangeOwners");
    expect(source).toContain("site-content-owner-manifest-malformed");
    expect(source).toContain("site-content-owner-manifest-broad-path");
    expect(source).toContain("site-content-owner-manifest-empty-owner");
    expect(source).toContain("site-content-owner-manifest-missing-owner");
    expect(source).toContain("site-content-owner-manifest-unknown-root");
    expect(source).toContain("site-content-owner-manifest-malformed-glob");
  });

  it.each([
    ["exact duplicate separator", "src/lib//dictionary-data.ts"],
    ["exact internal dot segment", "src/lib/./dictionary-data.ts"],
    ["glob duplicate separator", "public/therapy-compass-data//**"],
    ["glob internal dot segment", "public/therapy-compass-data/./**"],
  ])("rejects the %s alias before filesystem existence checks", (_name, owner) => {
    expect(() => runSelectorWithInjectedOwner(owner)).toThrow(/site-content-owner-manifest-noncanonical-owner/);
  });

  it.each(["data/**", "public/**", "src/**"])("rejects the broad %s root owner glob", (owner) => {
    expect(() => runSelectorWithInjectedOwner(owner)).toThrow(/site-content-owner-manifest-broad-path/);
  });

  it("rejects an exact owner escaping through a linked ancestor while allowing a narrow real subtree", () => {
    const repositoryDirectory = mkdtempSync(join(tmpdir(), "site-content-owner-repository-"));
    const outsideDirectory = mkdtempSync(join(tmpdir(), "site-content-owner-outside-"));
    const publicDirectory = join(repositoryDirectory, "public");
    const realDirectory = join(publicDirectory, "real-subtree");
    const linkedDirectory = join(publicDirectory, "linked-subtree");
    try {
      mkdirSync(realDirectory, { recursive: true });
      writeFileSync(join(realDirectory, "owner.json"), "{}\n", "utf8");
      writeFileSync(join(outsideDirectory, "owner.json"), "{}\n", "utf8");
      symlinkSync(outsideDirectory, linkedDirectory, process.platform === "win32" ? "junction" : "dir");

      expect(() => runSelectorWithInjectedOwner("public/real-subtree/owner.json", repositoryDirectory)).not.toThrow();
      expect(() => runSelectorWithInjectedOwner("public/linked-subtree/owner.json", repositoryDirectory)).toThrow(
        /site-content-owner-manifest-escaping-owner/,
      );
    } finally {
      if (existsSync(linkedDirectory)) unlinkSync(linkedDirectory);
      rmSync(repositoryDirectory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      rmSync(outsideDirectory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });

  it("rejects exact and glob owners through an internal linked ancestor while allowing the real subtree", () => {
    const repositoryDirectory = mkdtempSync(join(tmpdir(), "site-content-owner-repository-"));
    const publicDirectory = join(repositoryDirectory, "public");
    const realDirectory = join(publicDirectory, "real-subtree");
    const linkedDirectory = join(publicDirectory, "linked-subtree");
    try {
      mkdirSync(realDirectory, { recursive: true });
      writeFileSync(join(realDirectory, "owner.json"), "{}\n", "utf8");
      symlinkSync(realDirectory, linkedDirectory, process.platform === "win32" ? "junction" : "dir");

      expect(() => runSelectorWithInjectedOwner("public/real-subtree/owner.json", repositoryDirectory)).not.toThrow();
      expect(() => runSelectorWithInjectedOwner("public/real-subtree/**", repositoryDirectory)).not.toThrow();
      const linkedOwnerResults = ["public/linked-subtree/owner.json", "public/linked-subtree/**"].map((owner) => {
        try {
          runSelectorWithInjectedOwner(owner, repositoryDirectory);
          return "accepted";
        } catch (error) {
          expect(String(error)).toMatch(
            owner.endsWith("/**")
              ? /site-content-owner-manifest-missing-owner/
              : /site-content-owner-manifest-escaping-owner/,
          );
          return "rejected";
        }
      });
      expect(linkedOwnerResults).toEqual(["rejected", "rejected"]);
    } finally {
      if (existsSync(linkedDirectory)) unlinkSync(linkedDirectory);
      rmSync(repositoryDirectory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });

  it("still triggers for canonical exact and glob owner paths", () => {
    expect(classify("src/lib/dictionary-data.ts")).toContain("site_content_changed=true");
    expect(classify("public/therapy-compass-data/therapies.16552a934ddd9846.json")).toContain(
      "site_content_changed=true",
    );
  });
});

describe("CI change scope output safety", () => {
  it("refuses a changed path that would inject extra GITHUB_OUTPUT keys", () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), "ci-scope-output-"));
    const outputFile = join(temporaryDirectory, "github-output");
    try {
      expect(() =>
        execFileSync("node", ["scripts/ci-change-scope.mjs", "--", "docs/x\ndb_changed=false"], {
          encoding: "utf8",
          env: { ...process.env, GITHUB_OUTPUT: outputFile },
          stdio: ["ignore", "pipe", "pipe"],
        }),
      ).toThrow(/contains a control character/);
      expect(existsSync(outputFile)).toBe(false);
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });
});
