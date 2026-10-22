import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  classifyRepositoryPath,
  placeUnplacedFiles,
  readOrganisationReport,
  refreshDocPins,
  parseCliArgs,
  runDocsMaintain,
} from "../scripts/maintain-docs-system.mjs";

describe("maintain-docs-system pipeline", () => {
  const tempDirs: string[] = [];

  function makeTempFixture(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "psychsift-docs-maintain-"));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir && fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      }
    }
  });

  it("forwards the explicit development base through maintenance to the actual hazard child", () => {
    const root = makeTempFixture();
    const base = "a".repeat(40);
    const scripts = [
      "check-organisation.mjs",
      "check-codebase-index-coverage.mjs",
      "check-docs-script-refs.mjs",
      "check-docs-links.mjs",
      "check-outstanding-issues-snapshot.mjs",
      "check-clinical-hazard-controls.mjs",
      "organisation/check-instructions.mjs",
      "organisation/decisions.mjs",
      "list-database-skills.mjs",
      "generate-branch-review-index.mjs",
    ];
    for (const script of scripts) {
      const file = path.join(root, "scripts", script);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(
        file,
        script === "check-organisation.mjs"
          ? "console.log(JSON.stringify({totals:{unplaced:0}}));"
          : script === "check-clinical-hazard-controls.mjs"
            ? 'import fs from "node:fs"; fs.writeFileSync("hazard-args.json", JSON.stringify(process.argv.slice(2)));'
            : "// synthetic offline fixture\n",
      );
    }
    const options = parseCliArgs(["node", "maintenance", "--check", "--development", "--base", base]);
    expect(runDocsMaintain({ ...options, root })).toMatchObject({ mode: "check" });
    expect(JSON.parse(fs.readFileSync(path.join(root, "hazard-args.json"), "utf8"))).toEqual([
      "--development",
      "--base",
      base,
    ]);
  });

  describe("classifyRepositoryPath", () => {
    it("classifies paths deterministically across all 7 system areas", () => {
      const cases = [
        {
          input: "src/lib/rag/hybrid-retriever.ts",
          expectedSystem: "search-and-answers",
          expectedSystemFile: "docs/organisation/systems/search-and-answers.json",
          expectedResolved: "answer-engine",
        },
        {
          input: "docs/answer-grounding-contract.md",
          expectedSystem: "search-and-answers",
          expectedSystemFile: "docs/organisation/systems/search-and-answers.json",
          expectedResolved: "answer-engine",
        },
        {
          input: "src/lib/ingest/pdf-worker.ts",
          expectedSystem: "sources-and-ingestion",
          expectedSystemFile: "docs/organisation/systems/sources-and-ingestion.json",
          expectedResolved: "source-intake",
        },
        {
          input: "src/lib/sources/registry.ts",
          expectedSystem: "clinical-modes",
          expectedSystemFile: "docs/organisation/systems/clinical-modes.json",
          expectedResolved: "clinical-content",
        },
        {
          input: "docs/source-governance.md",
          expectedSystem: "sources-and-ingestion",
          expectedSystemFile: "docs/organisation/systems/sources-and-ingestion.json",
          expectedResolved: "source-intake",
        },
        {
          input: "src/app/workspace/page.tsx",
          expectedSystem: "personal-practice",
          expectedSystemFile: "docs/organisation/systems/personal-practice.json",
          expectedResolved: "personal-practice",
        },
        {
          input: "docs/diary-workflow.md",
          expectedSystem: "personal-practice",
          expectedSystemFile: "docs/organisation/systems/personal-practice.json",
          expectedResolved: "personal-practice",
        },
        {
          input: "src/app/psychiatry/page.tsx",
          expectedSystem: "clinical-modes",
          expectedSystemFile: "docs/organisation/systems/clinical-modes.json",
          expectedResolved: "clinical-content",
        },
        {
          input: "docs/medications-dosing-guide.md",
          expectedSystem: "clinical-modes",
          expectedSystemFile: "docs/organisation/systems/clinical-modes.json",
          expectedResolved: "clinical-content",
        },
        {
          input: "src/components/MasterSearchHeader.tsx",
          expectedSystem: "shell-and-design",
          expectedSystemFile: "docs/organisation/systems/shell-and-design.json",
          expectedResolved: "app-experience",
        },
        {
          input: "docs/search-chrome-behaviour.md",
          expectedSystem: "shell-and-design",
          expectedSystemFile: "docs/organisation/systems/shell-and-design.json",
          expectedResolved: "app-experience",
        },
        {
          input: "scripts/maintain-docs-system.mjs",
          expectedSystem: "knowledge",
          expectedSystemFile: "docs/organisation/systems/knowledge.json",
          expectedResolved: "knowledge",
        },
        {
          input: "docs/DOCS-SYSTEM.md",
          expectedSystem: "knowledge",
          expectedSystemFile: "docs/organisation/systems/knowledge.json",
          expectedResolved: "knowledge",
        },
        {
          input: "scripts/production-readiness.ts",
          expectedSystem: "operations-and-governance",
          expectedSystemFile: "docs/organisation/systems/operations-and-governance.json",
          expectedResolved: "delivery",
        },
        {
          input: "docs/disaster-recovery-runbook.md",
          expectedSystem: "operations-and-governance",
          expectedSystemFile: "docs/organisation/systems/operations-and-governance.json",
          expectedResolved: "data-platform",
        },
        {
          input: "docs/privacy-new-retention.md",
          expectedSystem: "operations-and-governance",
          expectedSystemFile: "docs/organisation/systems/operations-and-governance.json",
          expectedResolved: "data-platform",
        },
        {
          input: "src/lib/authorization-new.ts",
          expectedSystem: "operations-and-governance",
          expectedSystemFile: "docs/organisation/systems/operations-and-governance.json",
          expectedResolved: "data-platform",
        },
      ];

      for (const tc of cases) {
        const result = classifyRepositoryPath(tc.input);
        expect(result.system).toBe(tc.expectedSystem);
        expect(result.systemFile).toBe(tc.expectedSystemFile);
        expect(result.resolvedSystem).toBe(tc.expectedResolved);
        expect(result.reason.length).toBeGreaterThan(10);
      }
    });

    it("aligns with docs/organisation/systems/*.json ownership for representative existing files", () => {
      const existingCases = [
        { path: "src/lib/sources/index.ts", expectedResolved: "clinical-content" },
        { path: "src/lib/authorization.ts", expectedResolved: "data-platform" },
        { path: "docs/privacy-impact-assessment.md", expectedResolved: "data-platform" },
        { path: "docs/source-acquisition-protocol.md", expectedResolved: "clinical-content" },
        { path: "src/components/MasterSearchHeader.tsx", expectedResolved: "app-experience" },
      ];

      for (const tc of existingCases) {
        const result = classifyRepositoryPath(tc.path);
        expect(result.resolvedSystem).toBe(tc.expectedResolved);
        expect(result.resolvedSystemFile).toBe(`docs/organisation/systems/${tc.expectedResolved}.json`);
      }
    });

    it("normalizes Windows backslashes and leading ./ prefixes", () => {
      const result = classifyRepositoryPath(".\\src\\lib\\rag\\reranker.ts");
      expect(result.path).toBe("src/lib/rag/reranker.ts");
      expect(result.system).toBe("search-and-answers");
      expect(result.systemFile).toBe("docs/organisation/systems/search-and-answers.json");
    });

    it("routes new domain-specific tests/* paths to their owning system area instead of falling through to delivery", () => {
      const testCases = [
        { path: "tests/query-classification-new.test.ts", expectedResolved: "answer-engine" },
        { path: "tests/xlsx-sheet-dictionary-projection-new.test.ts", expectedResolved: "source-intake" },
        { path: "tests/cme-accreditation-summary-new.test.ts", expectedResolved: "personal-practice" },
        { path: "tests/calculators-lithium-toxicity-new.test.ts", expectedResolved: "clinical-content" },
        { path: "tests/branch-review-ledger-new.test.ts", expectedResolved: "knowledge" },
        { path: "tests/design-system-token-new.test.ts", expectedResolved: "design-system" },
        { path: "tests/phone-chrome-scroll-new.test.ts", expectedResolved: "app-experience" },
      ];

      for (const tc of testCases) {
        const result = classifyRepositoryPath(tc.path);
        expect(result.resolvedSystem).toBe(tc.expectedResolved);
        expect(result.resolvedSystemFile).toBe(`docs/organisation/systems/${tc.expectedResolved}.json`);
      }
    });
  });

  it("leaves an unmatched work-* test with the generic delivery owner rather than auto-claiming it for personal practice", () => {
    // Work tests span several systems, so the bare prefix cannot identify the owner.
    expect(classifyRepositoryPath("tests/work-side-nav-scroll.test.ts").resolvedSystem).toBe("delivery");
    // Exact manifest rules still decide existing Work tests.
    expect(classifyRepositoryPath("tests/work-side-nav.test.ts").resolvedSystem).toBe("app-experience");
    expect(classifyRepositoryPath("tests/work-calendar-entries.test.ts").resolvedSystem).toBe("personal-practice");
  });

  it("keeps the recorded Roster and Open shifts page exceptions in Personal practice", () => {
    // docs/organisation/README.md records these two page folders as Personal practice exceptions.
    expect(classifyRepositoryPath("src/app/(search-app)/roster/page.tsx").resolvedSystem).toBe("personal-practice");
    expect(classifyRepositoryPath("src/app/(search-app)/open-shifts/page.tsx").resolvedSystem).toBe(
      "personal-practice",
    );
    // Every other page stays with App experience.
    expect(classifyRepositoryPath("src/app/(search-app)/my-day/page.tsx").resolvedSystem).toBe("app-experience");
  });

  it("lets explicit manifest globs win over the domain test prefixes for new tests", () => {
    // app-experience owns tests/search-* and tests/document-* by glob; source-intake owns
    // tests/document-enrichment-*. The classifier prefixes deliberately do not compete with them.
    expect(classifyRepositoryPath("tests/search-new-widget.test.ts").resolvedSystem).toBe("app-experience");
    expect(classifyRepositoryPath("tests/document-new-viewer.test.ts").resolvedSystem).toBe("app-experience");
    expect(classifyRepositoryPath("tests/document-enrichment-new.test.ts").resolvedSystem).toBe("source-intake");
    expect(classifyRepositoryPath("tests/calculators-new-score.test.ts").resolvedSystem).toBe("clinical-content");
  });

  it("owns ingestion tests under source-intake even where app-experience's document-* glob would claim them", () => {
    // The code under test is source-intake's (src/lib/extractors/**, worker/**, src/lib/document-detail.ts),
    // so explicit source-intake entries beat app-experience's broad tests/document-* glob.
    for (const testPath of [
      "tests/document-extraction-source-fidelity.test.ts",
      "tests/document-detail-demo-window.test.ts",
    ]) {
      expect(classifyRepositoryPath(testPath).resolvedSystem).toBe("source-intake");
    }
    // Document viewer and search UI tests stay with app-experience.
    for (const testPath of ["tests/document-viewer-shell.dom.test.tsx", "tests/search-pins.test.ts"]) {
      expect(classifyRepositoryPath(testPath).resolvedSystem).toBe("app-experience");
    }
  });

  describe("placeUnplacedFiles", () => {
    it("places unplaced files into matching system manifests, deduplicating and sorting files[]", () => {
      const root = makeTempFixture();
      const systemsDir = path.join(root, "docs", "organisation", "systems");
      const outputDir = path.join(root, "output", "organisation");
      fs.mkdirSync(systemsDir, { recursive: true });
      fs.mkdirSync(outputDir, { recursive: true });

      fs.writeFileSync(
        path.join(systemsDir, "search-and-answers.json"),
        JSON.stringify(
          {
            id: "search-and-answers",
            files: ["docs/rag-architecture.md", "src/lib/rag/existing.ts"],
          },
          null,
          2,
        ),
        "utf8",
      );

      fs.writeFileSync(
        path.join(systemsDir, "knowledge.json"),
        JSON.stringify(
          {
            id: "knowledge",
            files: ["docs/knowledge-overview.md"],
          },
          null,
          2,
        ),
        "utf8",
      );

      const reportFile = "report-test.json";
      fs.writeFileSync(
        path.join(outputDir, "latest.json"),
        JSON.stringify({ json: reportFile, checkedAt: "2026-10-14T00:00:00.000Z" }),
        "utf8",
      );
      fs.writeFileSync(
        path.join(outputDir, reportFile),
        JSON.stringify({
          totals: { unplaced: 2 },
          findings: [
            { key: "unplaced:docs/answer-new-guide.md", subject: "docs/answer-new-guide.md" },
            { key: "unplaced:docs/library-index.md", subject: "docs/library-index.md" },
          ],
          placement: {
            "docs/answer-new-guide.md": "(unplaced)",
            "docs/library-index.md": "(unplaced)",
            "src/lib/rag/existing.ts": "(unplaced)",
          },
        }),
        "utf8",
      );

      const { unplacedCount, unplacedFiles } = readOrganisationReport(root);
      expect(unplacedCount).toBe(2);
      expect(unplacedFiles).toEqual(["docs/answer-new-guide.md", "docs/library-index.md", "src/lib/rag/existing.ts"]);

      const placement = placeUnplacedFiles(root, { runCheckFirst: false });
      expect(placement.updatedSystemFiles).toEqual([
        "docs/organisation/systems/knowledge.json",
        "docs/organisation/systems/search-and-answers.json",
      ]);

      const updatedSearch = JSON.parse(fs.readFileSync(path.join(systemsDir, "search-and-answers.json"), "utf8"));
      expect(updatedSearch.files).toEqual([
        "docs/answer-new-guide.md",
        "docs/rag-architecture.md",
        "src/lib/rag/existing.ts",
      ]);

      const updatedKnowledge = JSON.parse(fs.readFileSync(path.join(systemsDir, "knowledge.json"), "utf8"));
      expect(updatedKnowledge.files).toEqual(["docs/knowledge-overview.md", "docs/library-index.md"]);
    });
  });

  describe("refreshDocPins", () => {
    it("updates reviewed commit pins only for explicitly specified paths that exist on disk", () => {
      const root = makeTempFixture();
      const orgDir = path.join(root, "docs", "organisation");
      fs.mkdirSync(orgDir, { recursive: true });

      const existingDoc = path.join(root, "docs", "DOCS-SYSTEM.md");
      const untouchedDoc = path.join(root, "docs", "README.md");
      fs.writeFileSync(existingDoc, "# Docs System\n", "utf8");
      fs.writeFileSync(untouchedDoc, "# Docs Index\n", "utf8");

      const pinsPath = path.join(orgDir, "pins.json");
      fs.writeFileSync(
        pinsPath,
        JSON.stringify(
          {
            version: 1,
            pins: {
              "docs/DOCS-SYSTEM.md": "0000000000000000000000000000000000000000",
              "docs/README.md": "2222222222222222222222222222222222222222",
              "docs/missing-file.md": "1111111111111111111111111111111111111111",
            },
          },
          null,
          2,
        ),
        "utf8",
      );

      const newSha = "abcdef1234567890abcdef1234567890abcdef12";

      // Without explicit paths, refreshDocPins is a no-op and never overwrites pins.
      const noOpRes = refreshDocPins(root, { headSha: newSha });
      expect(noOpRes.updated).toBe(false);
      expect(noOpRes.updatedPaths).toEqual([]);

      const res = refreshDocPins(root, {
        headSha: newSha,
        paths: ["docs/DOCS-SYSTEM.md", "docs/missing-file.md"],
      });

      expect(res.updated).toBe(true);
      expect(res.headSha).toBe(newSha);
      expect(res.updatedPaths).toEqual(["docs/DOCS-SYSTEM.md"]);

      const updatedPins = JSON.parse(fs.readFileSync(pinsPath, "utf8"));
      expect(updatedPins.pins["docs/DOCS-SYSTEM.md"]).toBe(newSha);
      expect(updatedPins.pins["docs/README.md"]).toBe("2222222222222222222222222222222222222222");
      expect(updatedPins.pins["docs/missing-file.md"]).toBe("1111111111111111111111111111111111111111");
    });
  });
});
