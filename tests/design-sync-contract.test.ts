import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { previewTypeFailures } from "../scripts/check-design-sync-contract.mjs";

const root = path.resolve(__dirname, "..");
const subprocessTestTimeoutMs = 120_000;

function withPreviewCompilerFixture(tsconfig: object, run: (fixtureRoot: string) => void) {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "design-sync-compiler-"));
  try {
    fs.mkdirSync(path.join(fixtureRoot, ".design-sync", "previews"), { recursive: true });
    fs.writeFileSync(path.join(fixtureRoot, ".design-sync", "previews", "Fixture.tsx"), "export const Fixture = 1;\n");
    fs.writeFileSync(path.join(fixtureRoot, "tsconfig.json"), `${JSON.stringify(tsconfig, null, 2)}\n`);
    run(fixtureRoot);
  } finally {
    fs.rmSync(fixtureRoot, { force: true, recursive: true, maxRetries: 5, retryDelay: 100 });
  }
}

describe("design-sync public contract", () => {
  it(
    "keeps sources, entry exports, previews and published props in parity",
    () => {
      expect(() =>
        execFileSync(process.execPath, ["scripts/check-design-sync-contract.mjs"], { cwd: root, stdio: "pipe" }),
      ).not.toThrow();
    },
    subprocessTestTimeoutMs,
  );

  it("publishes source-derived answer and EmptyState contracts", () => {
    const config = JSON.parse(fs.readFileSync(path.join(root, ".design-sync/config.json"), "utf8"));
    expect(config.dtsPropsFor.AnswerCard).toContain("DegradedAnswerState");
    expect(config.dtsPropsFor.VerificationNotice).toContain("attribution?:");
    expect(config.dtsPropsFor.VerificationNotice).toContain("presentation?:");
    expect(config.dtsPropsFor.EmptyState).toContain("headingLevel?: 2 | 3 | 4 | 5 | 6");
    expect(config.dtsPropsFor.EmptyState).toContain("testId?: string");
    expect(config.dtsPropsFor.EmptyState).toContain('live?: "off" | "assertive" | "polite"');
  });

  it("commits the preview compiler alias used by the publication tool", () => {
    const config = JSON.parse(fs.readFileSync(path.join(root, ".design-sync/config.json"), "utf8"));
    const previewTsconfig = JSON.parse(fs.readFileSync(path.join(root, config.tsconfig), "utf8"));
    expect(config.tsconfig).toBe(".design-sync/tsconfig.previews.json");
    expect(previewTsconfig.extends).toBe("../tsconfig.json");
    expect(previewTsconfig.compilerOptions).not.toHaveProperty("baseUrl");
    expect(previewTsconfig.compilerOptions.types).toEqual(["node", "react", "react-dom"]);
    expect(previewTsconfig.compilerOptions.paths["@/*"]).toEqual(["../src/*"]);
    expect(previewTsconfig.compilerOptions.paths[config.pkg]).toEqual(["./entry.tsx"]);
  });

  it(
    "passes the actual configured preview TypeScript project",
    () => {
      expect(() =>
        execFileSync(
          process.execPath,
          [
            path.join(root, "node_modules/typescript/bin/tsc"),
            "--project",
            ".design-sync/tsconfig.previews.json",
            "--noEmit",
            "--pretty",
            "false",
          ],
          { cwd: root, stdio: "pipe" },
        ),
      ).not.toThrow();
    },
    subprocessTestTimeoutMs,
  );

  it("reports configured compiler-option diagnostics instead of passing green", () => {
    withPreviewCompilerFixture(
      {
        compilerOptions: { moduleResolution: "not-a-resolution", noEmit: true },
        include: [".design-sync/previews/**/*.tsx"],
      },
      (fixtureRoot) => {
        expect(
          previewTypeFailures(["Fixture"], { tsconfig: "tsconfig.json" }, { root: fixtureRoot }).join("\n"),
        ).toContain("moduleResolution");
      },
    );
  });

  it("reports no-file global diagnostics instead of filtering them out", () => {
    withPreviewCompilerFixture(
      {
        compilerOptions: { module: "esnext", moduleResolution: "bundler", noEmit: true, noLib: true, types: [] },
        include: [".design-sync/previews/**/*.tsx"],
      },
      (fixtureRoot) => {
        expect(
          previewTypeFailures(["Fixture"], { tsconfig: "tsconfig.json" }, { root: fixtureRoot }).join("\n"),
        ).toContain("Cannot find global type 'Array'");
      },
    );
  });

  it("publishes ISO provenance examples and all five answer states", () => {
    const answerCardPreview = fs.readFileSync(path.join(root, ".design-sync/previews/AnswerCard.tsx"), "utf8");
    const answerFooterPreview = fs.readFileSync(path.join(root, ".design-sync/previews/AnswerFooter.tsx"), "utf8");
    for (const state of ["ready", "stale_evidence", "partial_retrieval", "ungrounded", "source_only"]) {
      expect(answerCardPreview).toContain(`state: "${state}"`);
    }
    expect(answerCardPreview).toContain('reviewDate: "2026-05-18"');
    expect(answerCardPreview).toContain('generatedAt: "2026-07-31T13:04:00+08:00"');
    expect(answerFooterPreview).toContain('reviewDate="2026-05-18"');
    expect(answerFooterPreview).toContain('generatedAt="2026-07-31T13:04:00+08:00"');
    expect(answerFooterPreview).toContain("Missing metadata renders explicit MissingValue phrases");
    expect(answerFooterPreview).not.toContain("Missing segments are dropped");
    expect(`${answerCardPreview}\n${answerFooterPreview}`).not.toMatch(/\b\d{2}\/\d{2}\/\d{4}\b/);
  });
});
