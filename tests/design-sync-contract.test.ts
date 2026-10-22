import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import ts from "@typescript/typescript6";
import { describe, expect, it, vi } from "vitest";

import { previewTypeFailures } from "../scripts/check-design-sync-contract.mjs";
import { deriveDesignSyncProps } from "../scripts/generate-design-sync-contract.mjs";

const root = path.resolve(__dirname, "..");

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
  it("resolves inherited options and imported props without enumerating unrelated project roots", () => {
    withPreviewCompilerFixture({ extends: "./compiler-base.json", include: ["**/*.ts", "**/*.tsx"] }, (fixtureRoot) => {
      fs.writeFileSync(
        path.join(fixtureRoot, "compiler-base.json"),
        JSON.stringify({
          compilerOptions: {
            strict: true,
            noLib: true,
            types: [],
            module: "esnext",
            moduleResolution: "bundler",
            paths: { "@fixture/*": ["./contracts/*"] },
          },
        }),
      );
      fs.mkdirSync(path.join(fixtureRoot, "contracts"));
      fs.writeFileSync(
        path.join(fixtureRoot, "contracts", "props.ts"),
        "export interface SharedProps { label: string; disabled?: boolean }\n",
      );
      fs.writeFileSync(
        path.join(fixtureRoot, ".design-sync", "previews", "Fixture.tsx"),
        'import type { SharedProps } from "@fixture/props";\n' +
          'export type FixtureProps = SharedProps & { variant: "plain" | "compact" };\n' +
          "export function Fixture(props: FixtureProps) { return null; }\n",
      );
      fs.mkdirSync(path.join(fixtureRoot, "unrelated"));
      fs.writeFileSync(path.join(fixtureRoot, "unrelated", "generated.ts"), "export const unrelated = 1;\n");
      const directoryScan = vi.spyOn(ts.sys, "readDirectory");
      try {
        expect(
          deriveDesignSyncProps({
            root: fixtureRoot,
            config: { componentSrcMap: { Fixture: ".design-sync/previews/Fixture.tsx" } },
          }),
        ).toEqual({ Fixture: 'disabled?: boolean; label: string; variant: "plain" | "compact";' });
        expect(directoryScan).not.toHaveBeenCalled();
      } finally {
        directoryScan.mockRestore();
      }
    });
  });

  /**
   * An explicit timeout, because the global 30 s one is a whole-suite hazard for
   * this test rather than a generous ceiling for it.
   *
   * Measured 2026-09-01 on this worktree: the child process this spawns finishes
   * in ~7 s standalone and the test itself takes ~9 s, so 30 s looks like ample
   * headroom in isolation. It is not, under the full run: the node suite is
   * CPU-bound on two workers across 900+ files, and on 2026-09-01 this exact test
   * exceeded 30 000 ms inside `npm run test` and failed a gate for a diff that
   * touched nothing under `.design-sync/**`. A ~3x stretch is ordinary contention
   * on a loaded machine, so the budget has to absorb it.
   *
   * Not quarantined, and it must not be: it did not fail on its assertion, and a
   * wrong time budget is a different defect from an unstable test. 60 s keeps a
   * genuine hang detectable while surviving realistic load.
   */
  it("keeps sources, entry exports, previews and published props in parity", { timeout: 60_000 }, () => {
    expect(() =>
      execFileSync(process.execPath, ["scripts/check-design-sync-contract.mjs"], { cwd: root, stdio: "pipe" }),
    ).not.toThrow();
  });

  it("publishes source-derived answer and EmptyState contracts", () => {
    const config = JSON.parse(fs.readFileSync(path.join(root, ".design-sync/config.json"), "utf8"));
    expect(config.dtsPropsFor.AnswerCard).toContain("DegradedAnswerState");
    expect(config.dtsPropsFor.VerificationNotice).toContain("attribution?:");
    expect(config.dtsPropsFor.VerificationNotice).toContain("presentation?:");
    expect(config.dtsPropsFor.EmptyState).toContain("headingLevel?: 2 | 3 | 4 | 5 | 6");
    expect(config.dtsPropsFor.EmptyState).toContain("testId?: string");
    expect(config.dtsPropsFor.EmptyState).toContain('live?: "off" | "assertive" | "polite"');
    expect(config.componentSrcMap.AsyncButton).toBe("src/components/ui-primitives.tsx");
    expect(config.componentSrcMap.EmptyState).toBe("src/components/ui-primitives.tsx");
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

  /** ~10 s measured the same way, and exposed to exactly the same stretch. */
  it("passes the actual configured preview TypeScript project", { timeout: 60_000 }, () => {
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
  });

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
