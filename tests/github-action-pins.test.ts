import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { validateActionReference } from "../scripts/github-action-pins.mjs";
import { yamlBlock } from "../scripts/yaml-contract.mjs";

describe("GitHub Action pin validation", () => {
  it.each([
    ["actions/setup-node", "949feb2413d6458794dcd2491c4babbbce0c15c1", "v7.1.0"],
    ["actions/upload-artifact", "cf430e030ddbb5b0abf93d22962f4752f3646cd9", "v7.0.2"],
    ["actions/download-artifact", "9000827ccba6bdab643e8b6fd33ac0654aef8333", "v8.0.2"],
    ["anthropics/claude-code-action", "1d6de8cb0c237e7c15e9e1bdf973826ebae490cc", "v1.0.248"],
  ])("accepts the reviewed %s release and rejects mismatched annotations", (action, sha, version) => {
    expect(validateActionReference(`uses: ${action}@${sha} # ${version}`)).toBeNull();
    expect(validateActionReference(`uses: ${action}@${sha} # v0.0.0`)).toContain("exact reviewed release comment");
    expect(validateActionReference(`uses: ${action}@${sha}`)).toContain("exact reviewed release comment");
    expect(validateActionReference(`uses: ${action}@${"1".repeat(40)} # ${version}`)).toContain(
      "not a reviewed commit SHA",
    );
  });


  it("accepts a reviewed immutable action reference with its exact version comment", () => {
    expect(
      validateActionReference("        uses: actions/setup-node@a0853c24544627f65ddf259abe73b1d18a591444 # v5.0.0"),
    ).toBeNull();
  });

  it("rejects mutable major tags", () => {
    expect(validateActionReference("        uses: actions/setup-node@v5")).toContain("is mutable");
  });

  it("validates inline list-style action steps", () => {
    expect(validateActionReference("      - uses: actions/setup-node@v5")).toContain("is mutable");
    expect(
      validateActionReference("      - uses: actions/setup-node@a0853c24544627f65ddf259abe73b1d18a591444 # v5.0.0"),
    ).toBeNull();
  });

  it("rejects an unreviewed commit SHA", () => {
    expect(
      validateActionReference("        uses: actions/setup-node@1111111111111111111111111111111111111111 # v5.0.0"),
    ).toContain("is not a reviewed commit SHA");
  });

  it("rejects a misleading or unsupported version annotation", () => {
    expect(
      validateActionReference("        uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v6.0.3"),
    ).toContain("# v7.0.0");
  });

  it("allows repository-local actions", () => {
    expect(validateActionReference("        uses: ./.github/actions/example@v1")).toBeNull();
  });

  it("accepts the reviewed autofix.ci action pin", () => {
    expect(
      validateActionReference("      - uses: autofix-ci/action@c5b2d67aa2274e7b5a18224e8171550871fc7e4a # v1.3.4"),
    ).toBeNull();
  });

  describe("bundle-budget-refresh workflow validation (#8TKTV6)", () => {
    it("pins actions, sets ubuntu-24.04 runner, and contains valid syntax in bundle-budget-refresh.yml", () => {
      const workflowPath = path.join(process.cwd(), ".github/workflows/bundle-budget-refresh.yml");
      const content = readFileSync(workflowPath, "utf8");

      expect(content).toContain("runs-on: ubuntu-24.04");
      expect(content).not.toContain("ubuntu-latest");

      const lines = content.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.includes("uses:")) {
          const failure = validateActionReference(line);
          expect(failure, `Line ${i + 1}: ${line} failed pin validation`).toBeNull();
        }
      }

      expect(yamlBlock(content, "name: Bundle Budget Refresh", 0)).toContain("Bundle Budget Refresh");
      expect(yamlBlock(content, "on:", 0)).toContain("workflow_dispatch:");
      expect(yamlBlock(content, "permissions:", 0)).toContain("contents: read");
      expect(yamlBlock(content, "jobs:", 0)).toContain("bundle-budget-refresh:");
    });
  });
});
