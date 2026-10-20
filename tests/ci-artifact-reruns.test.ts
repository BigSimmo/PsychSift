import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));
const load = createRequire(import.meta.url)("js-yaml").load;
type Step = { uses?: string; with?: { name?: string; path?: string; archive?: boolean | string; overwrite?: boolean } };
type Definition = { jobs?: Record<string, { steps?: Step[] }>; runs?: { steps?: Step[] } };
const read = (file: string) => load(readFileSync(path.join(root, file), "utf8")) as Definition;
const discover = (directory: string): string[] =>
  readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? discover(file) : /\.ya?ml$/.test(entry.name) ? [file] : [];
  });
const uploads = (definition: Definition) =>
  [...Object.values(definition.jobs ?? {}).flatMap((job) => job.steps ?? []), ...(definition.runs?.steps ?? [])].filter(
    (step) => step.uses?.startsWith("actions/upload-artifact@"),
  );

describe("workflow artifact rerun contract", () => {
  it("inventories every workflow and composite upload for attempt-specific or replaceable names", () => {
    const files = [...discover(".github/workflows"), ...discover(".github/actions")];
    let count = 0;
    for (const file of files) {
      for (const upload of uploads(read(file))) {
        count += 1;
        const inputs = upload.with ?? {};
        const raw = inputs.archive === false || inputs.archive === "false";
        if (raw) {
          expect(inputs.path, `${file}: a raw upload requires a single file`).toBeTruthy();
          expect(inputs.path).not.toMatch(/[\r\n*?\[\]]/);
        }
        const effectiveName = raw ? path.posix.basename(inputs.path!.trim().replaceAll("\\", "/")) : inputs.name;
        expect(effectiveName, file).toBeTruthy();
        const attemptSpecific = effectiveName?.includes("${{ github.run_attempt }}");
        expect(attemptSpecific || inputs.overwrite === true, `${file}: ${effectiveName}`).toBe(true);
        if (attemptSpecific) {
          expect(effectiveName!.replaceAll("${{ github.run_attempt }}", "1")).not.toBe(
            effectiveName!.replaceAll("${{ github.run_attempt }}", "2"),
          );
          expect(inputs.overwrite, `${file}: preserve previous diagnostics`).not.toBe(true);
        }
      }
    }
    expect(count).toBeGreaterThan(0);
  });

  it("retains the canary name expected by the ranking snapshot consumer while replacing it on retry", () => {
    expect(uploads(read(".github/workflows/eval-canary.yml"))[0].with).toMatchObject({
      name: "eval-canary-output",
      overwrite: true,
    });
    const consumer = readFileSync(path.join(root, ".github/workflows/ranking-snapshot-refresh.yml"), "utf8");
    expect(consumer).toContain('artifact.name === "eval-canary-output"');
    expect(consumer).toContain("name: eval-canary-output");
  });

  it.each(["bundle-budget-refresh", "live-drift", "live-web-vitals", "preview-smoke", "staging-tenancy"])(
    "preserves %s diagnostic history from each attempt",
    (workflow) => {
      const evidence = uploads(read(`.github/workflows/${workflow}.yml`));
      expect(evidence).toHaveLength(1);
      expect(evidence[0].with?.name).toContain("${{ github.run_attempt }}");
      expect(evidence[0].with?.overwrite).not.toBe(true);
    },
  );
});
