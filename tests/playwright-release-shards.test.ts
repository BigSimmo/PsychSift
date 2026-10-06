import { describe, expect, it } from "vitest";

import { listProductionSpecFiles } from "../scripts/playwright-pr-shards.mjs";
import {
  RELEASE_SHARDED_PROJECTS,
  fileFilter,
  releaseShardArgs,
  releaseShardGroups,
  releaseSpecSeconds,
} from "../scripts/playwright-release-shards.mjs";

/*
 * The release-browser-matrix legs each compute their own file group from the same committed
 * per-file costs. These cases prove the split is a partition: every production spec runs on
 * exactly one leg of each project, and each leg's arguments select only its own files. They use
 * Playwright's own matching rule for positional filters (a case-insensitive RegExp tested against
 * the absolute file path), so a filter that also caught a sibling file fails here, not on main.
 */

const specs = listProductionSpecFiles();
const counts = [2, 3, 4, 5];

function matchesLikePlaywright(filter: string, file: string) {
  return new RegExp(filter, "i").test(`/home/runner/work/PsychSift/PsychSift/${file}`);
}

describe("release-browser-matrix duration shards", () => {
  it("has measured costs for every production spec in every split project", () => {
    expect([...RELEASE_SHARDED_PROJECTS].sort()).toEqual([
      "firefox",
      "mobile-pwa-standalone",
      "mobile-webkit",
      "webkit",
    ]);
    for (const project of RELEASE_SHARDED_PROJECTS) {
      const table = releaseSpecSeconds[project as keyof typeof releaseSpecSeconds];
      const unmeasured = specs.filter((file) => !(file in table));
      expect(unmeasured, `${project}: refresh releaseSpecSeconds from release-ui-timings`).toEqual([]);
      const stale = Object.keys(table).filter((file) => !specs.includes(file));
      expect(stale, `${project}: remove specs that no longer exist`).toEqual([]);
    }
  });

  it.each(RELEASE_SHARDED_PROJECTS.flatMap((project) => counts.map((count) => [project, count] as const)))(
    "%s over %i legs runs every spec exactly once",
    (project, count) => {
      const groups = releaseShardGroups(project, count);
      const dealt = groups.flatMap((group) => group.files);
      expect(new Set(dealt).size).toBe(dealt.length);
      expect([...dealt].sort()).toEqual([...specs].sort());
      for (const group of groups) expect(group.files.length).toBeGreaterThan(0);
    },
  );

  it("keeps the slowest leg near the larger of the average and the slowest single file", () => {
    for (const project of RELEASE_SHARDED_PROJECTS) {
      const table = releaseSpecSeconds[project as keyof typeof releaseSpecSeconds] as Record<string, number>;
      const slowestFile = Math.max(...Object.values(table));
      for (const count of counts) {
        const totals = releaseShardGroups(project, count).map((group) => group.seconds);
        const average = totals.reduce((sum, total) => sum + total, 0) / count;
        expect(Math.max(...totals), `${project} over ${count}`).toBeLessThanOrEqual(
          Math.max(average, slowestFile) + 60,
        );
      }
    }
  });

  it("selects exactly the leg's own files with Playwright's filter semantics", () => {
    for (const project of RELEASE_SHARDED_PROJECTS) {
      for (const count of counts) {
        const seen: string[] = [];
        for (let index = 1; index <= count; index += 1) {
          const args = releaseShardArgs([`--project=${project}`, `--shard=${index}/${count}`]);
          const filters = args.filter((arg: string) => !arg.startsWith("--"));
          const selected = specs.filter((file) =>
            filters.some((filter: string) => matchesLikePlaywright(filter, file)),
          );
          expect(selected).toEqual(releaseShardGroups(project, count)[index - 1].files);
          seen.push(...selected);
        }
        expect([...seen].sort()).toEqual([...specs].sort());
      }
    }
  });

  it("anchors each filter so a file never selects a sibling that ends with its name", () => {
    expect(matchesLikePlaywright(fileFilter("tests/ui-smoke.spec.ts"), "tests/dsm-ui-smoke.spec.ts")).toBe(false);
    expect(
      matchesLikePlaywright(fileFilter("tests/ui-phone-scroll.spec.ts"), "tests/ui-phone-scroll-routes.spec.ts"),
    ).toBe(false);
    expect(matchesLikePlaywright(fileFilter("tests/ui-smoke.spec.ts"), "tests/ui-smoke.spec.ts")).toBe(true);
    expect(new RegExp(fileFilter("tests/ui-smoke.spec.ts"), "i").test("C:\\work\\tests\\ui-smoke.spec.ts")).toBe(true);
  });

  it("does not depend on the order specs were discovered in", () => {
    for (const project of RELEASE_SHARDED_PROJECTS) {
      expect(releaseShardGroups(project, 4, { files: [...specs].reverse() })).toEqual(releaseShardGroups(project, 4));
    }
  });

  it("fails closed on a new spec with no timing or a timing for a removed spec", () => {
    expect(() => releaseShardGroups("mobile-webkit", 5, { files: [...specs, "tests/ui-brand-new.spec.ts"] })).toThrow(
      /no timing for: tests\/ui-brand-new\.spec\.ts/,
    );
    expect(() => releaseShardGroups("mobile-webkit", 5, { files: specs.slice(1) })).toThrow(
      /timing for a spec that no longer exists/,
    );
    expect(() => releaseShardGroups("mobile-webkit", 5, { files: [...specs, specs[0]] })).toThrow(/repeats a file/);
  });

  it("keeps the committed leg counts within the measured balance", () => {
    // The matrix keeps firefox 3, webkit 2 and five legs per iPhone project.
    const expectedMaxMinutes = {
      firefox: [3, 9],
      webkit: [2, 20],
      "mobile-webkit": [5, 12],
      "mobile-pwa-standalone": [5, 10],
    };
    for (const [project, [count, minutes]] of Object.entries(expectedMaxMinutes)) {
      const slowest = Math.max(...releaseShardGroups(project, count).map((group) => group.seconds));
      expect(slowest / 60, project).toBeLessThanOrEqual(minutes);
    }
  });

  it("passes one-leg runs straight through and refuses an ambiguous split", () => {
    expect(releaseShardArgs(["--project=chromium-mockups", "--shard=1/1", "--global-timeout=1800000"])).toEqual([
      "--project=chromium-mockups",
      "--global-timeout=1800000",
    ]);
    expect(releaseShardArgs(["--project=chromium", "--project=chromium-mockups", "--shard=1/1"])).toEqual([
      "--project=chromium",
      "--project=chromium-mockups",
    ]);
    expect(() => releaseShardArgs(["--project=firefox", "--project=webkit", "--shard=1/2"])).toThrow(/exactly one/);
    expect(() => releaseShardArgs(["--project=chromium-mockups", "--shard=1/2"])).toThrow(/no release shard timings/);
    expect(() => releaseShardArgs(["--project=firefox", "--shard=3/2"])).toThrow(/--shard must be/);
    // Playwright's own --shard is never forwarded alongside the file group.
    expect(
      releaseShardArgs(["--project=firefox", "--shard=1/2"]).some((arg: string) => arg.startsWith("--shard")),
    ).toBe(false);
  });
});
