#!/usr/bin/env node
/**
 * Duration-aware Production UI shard groups for required Chromium PR journeys.
 *
 * Playwright `--shard=i/N` balances by test *count* in collection (alphabetical)
 * order, which packs the slow phone-scroll family into one shard. Explicit
 * groups mix slow-per-test and faster mega-specs so wall time is closer across
 * runners. Every production `test:e2e:pr` file must appear in exactly one group
 * — `tests/playwright-pr-shards.test.ts` fails closed on orphans/duplicates.
 *
 * Do not rename specs to game alphabetical sharding. Re-measure after suite
 * growth before changing group membership.
 */
import { readdirSync } from "node:fs";
import path from "node:path";

import { spawnSync } from "node:child_process";
import { childProcessExitCode } from "./child-process-result.mjs";
import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";

/** Same matcher as playwright.config.ts `productionSpecPattern` (keep in sync). */
export const productionSpecFilePattern =
  /^(?:api-csrf-proxy|adaptive-answer-ui|answer-progress-ui-smoke|dsm-ui-smoke|ui-(?:admin|smoke|stress|accessibility|clinical-ask|cme-phone|dictionary|document-canvas|tools|tools-show-all|overlap|universal-search|specifiers|sources|formulation(?:-result-cards)?|forms-section-nav|chrome-scroll|therapy-nav-scroll|therapy-pathways|mode-nav-density|on-call-(?:boards|call|now|service)|teaching|patient-number-field|phone-motion|phone-scroll(?:-[a-z0-9-]+)?|pwa|roster-team|route-coverage|style-contract|token-layer-resolution|visual-artifacts|hydration))\.spec\.ts$/;

/**
 * Timings: mean of the successful post-critical production Chromium reports from
 * PR CI runs 36113010077 and 36135682519 (2026-09-25, the `production-ui-timings-*`
 * artifacts), plus each file's criticalSeconds, which those runs exclude. Files
 * absent from both reports (critical-only) keep their 2026-09-22 values from run
 * 35737796786. Group longest files first by their post-critical duration.
 * Regrouped 2026-09-26 by three moves (mode-nav-density, formulation, tools) after the retired
 * Caring Contacts specs left shard 3; no timing value was re-measured.
 * Teaching's estimated spec was added to shard 3; move the 2.3s formulation-result-cards
 * spec to shard 2 to keep both full and post-critical groups within their balance limits.
 * These measurements guide grouping, never test omission or passing status.
 */
export const prUiSpecProfiles = Object.freeze([
  { file: "tests/ui-admin.spec.ts", shard: 1, fullSeconds: 24, criticalSeconds: 0 },
  {
    file: "tests/adaptive-answer-ui.spec.ts",
    shard: 3,
    fullSeconds: 19,
    criticalSeconds: 0,
  },
  {
    file: "tests/ui-smoke.spec.ts",
    shard: 3,
    fullSeconds: 167,
    criticalSeconds: 17.7,
  },
  {
    file: "tests/ui-mode-nav-density.spec.ts",
    shard: 2,
    fullSeconds: 45.5,
    criticalSeconds: 0,
  },
  {
    file: "tests/ui-cme-phone.spec.ts",
    shard: 3,
    fullSeconds: 15.6,
    criticalSeconds: 0,
  },
  {
    file: "tests/ui-on-call-boards.spec.ts",
    shard: 1,
    fullSeconds: 34.8,
    criticalSeconds: 0,
  },
  {
    file: "tests/ui-on-call-service.spec.ts",
    shard: 1,
    fullSeconds: 4.2,
    criticalSeconds: 0,
  },
  {
    file: "tests/ui-on-call-call.spec.ts",
    shard: 1,
    fullSeconds: 20,
    criticalSeconds: 0,
  },
  {
    // Board 01 Home is Now (v6 rebuild, plan C25). Ten tests (four journeys x
    // light/dark, plus the dark-only bright-surface check and the Who's on
    // redirect), estimated at ~3s each; no timing report yet, so criticalSeconds
    // stays 0 until one exists. Rebalanced with the two moves below (added
    // 2026-09-26).
    file: "tests/ui-on-call-now.spec.ts",
    shard: 1,
    fullSeconds: 30,
    criticalSeconds: 0,
  },
  {
    // Estimate from four page loads (Today, Week, Session, the On Call redirect
    // backstop) — no PR CI report yet to measure against. The plan's own 20s
    // estimate does not fit: with today's recorded timings it would push
    // whichever shard holds it past the excludeCritical <=10s balance ceiling
    // (tests/playwright-pr-shards.test.ts), regardless of which of the three
    // shards takes it, because none of this file's page loads are `@critical`.
    // Shard 3 has the most headroom (its critical-tagged specs give it the
    // largest excludeCritical margin), so it lands there with a smaller,
    // still-conservative estimate. Re-measure and correct once a PR CI report
    // exists — say so in the PR body.
    file: "tests/ui-teaching.spec.ts",
    shard: 3,
    fullSeconds: 10,
    criticalSeconds: 0,
  },
  {
    file: "tests/ui-phone-scroll-page-owned.spec.ts",
    shard: 2,
    fullSeconds: 34.8,
    criticalSeconds: 0,
  },
  {
    file: "tests/ui-accessibility.spec.ts",
    shard: 2,
    fullSeconds: 22.9,
    criticalSeconds: 0,
  },
  {
    file: "tests/ui-route-coverage.spec.ts",
    shard: 2,
    fullSeconds: 18,
    criticalSeconds: 0,
  },
  {
    file: "tests/ui-formulation.spec.ts",
    shard: 3,
    fullSeconds: 12,
    criticalSeconds: 0,
  },
  {
    file: "tests/ui-dictionary.spec.ts",
    shard: 2,
    fullSeconds: 19.8,
    criticalSeconds: 0,
  },
  {
    file: "tests/ui-sources.spec.ts",
    shard: 2,
    fullSeconds: 28,
    criticalSeconds: 4.9,
  },
  {
    file: "tests/ui-token-layer-resolution.spec.ts",
    shard: 3,
    fullSeconds: 2.4,
    criticalSeconds: 0,
  },
  {
    file: "tests/ui-tools-show-all.spec.ts",
    shard: 2,
    fullSeconds: 0.5,
    criticalSeconds: 0,
  },
  {
    file: "tests/ui-clinical-ask.spec.ts",
    shard: 2,
    fullSeconds: 16.5,
    criticalSeconds: 16.5,
  },
  {
    file: "tests/api-csrf-proxy.spec.ts",
    shard: 2,
    fullSeconds: 0.2,
    criticalSeconds: 0,
  },
  {
    file: "tests/ui-phone-motion.spec.ts",
    shard: 3,
    fullSeconds: 14.9,
    criticalSeconds: 0,
  },
  {
    file: "tests/ui-therapy-pathways.spec.ts",
    shard: 3,
    fullSeconds: 3.9,
    criticalSeconds: 0,
  },
  {
    file: "tests/ui-patient-number-field.spec.ts",
    shard: 2,
    fullSeconds: 5.9,
    criticalSeconds: 0,
  },
  {
    file: "tests/ui-phone-scroll-routes.spec.ts",
    shard: 2,
    fullSeconds: 151.8,
    criticalSeconds: 0,
  },
  {
    file: "tests/ui-phone-scroll.spec.ts",
    shard: 1,
    fullSeconds: 178.2,
    criticalSeconds: 0,
  },
  {
    file: "tests/ui-universal-search.spec.ts",
    shard: 2,
    fullSeconds: 25.2,
    criticalSeconds: 0,
  },
  {
    file: "tests/dsm-ui-smoke.spec.ts",
    shard: 3,
    fullSeconds: 3,
    criticalSeconds: 0,
  },
  {
    file: "tests/answer-progress-ui-smoke.spec.ts",
    shard: 3,
    fullSeconds: 32,
    criticalSeconds: 0,
  },
  {
    file: "tests/ui-tools.spec.ts",
    shard: 3,
    fullSeconds: 97.1,
    criticalSeconds: 4,
  },
  {
    file: "tests/ui-chrome-scroll.spec.ts",
    shard: 1,
    fullSeconds: 64.8,
    criticalSeconds: 0,
  },
  {
    file: "tests/ui-overlap.spec.ts",
    shard: 2,
    fullSeconds: 19.7,
    criticalSeconds: 0,
  },
  {
    file: "tests/ui-stress.spec.ts",
    shard: 2,
    fullSeconds: 7.2,
    criticalSeconds: 0,
  },
  {
    file: "tests/ui-specifiers.spec.ts",
    shard: 1,
    fullSeconds: 19.5,
    criticalSeconds: 0,
  },
  {
    file: "tests/ui-formulation-result-cards.spec.ts",
    shard: 2,
    fullSeconds: 2.3,
    criticalSeconds: 0,
  },
  {
    file: "tests/ui-style-contract.spec.ts",
    shard: 3,
    fullSeconds: 11.4,
    criticalSeconds: 0,
  },
  {
    file: "tests/ui-hydration.spec.ts",
    shard: 2,
    fullSeconds: 3.6,
    criticalSeconds: 0,
  },
  {
    file: "tests/ui-pwa.spec.ts",
    shard: 3,
    fullSeconds: 9.1,
    criticalSeconds: 0,
  },
  {
    // Unmeasured (new in Roster release two); estimated until a CI timing report exists.
    file: "tests/ui-roster-team.spec.ts",
    shard: 1,
    fullSeconds: 4,
    criticalSeconds: 0,
  },
  {
    file: "tests/ui-phone-scroll-document-rail.spec.ts",
    shard: 1,
    fullSeconds: 3.3,
    criticalSeconds: 0,
  },
  {
    file: "tests/ui-visual-artifacts.spec.ts",
    shard: 1,
    fullSeconds: 3.7,
    criticalSeconds: 0,
  },
  {
    file: "tests/ui-forms-section-nav.spec.ts",
    shard: 3,
    fullSeconds: 9,
    criticalSeconds: 0,
  },
  {
    file: "tests/ui-therapy-nav-scroll.spec.ts",
    shard: 2,
    fullSeconds: 3.2,
    criticalSeconds: 0,
  },
  {
    file: "tests/ui-phone-scroll-submitted-root.spec.ts",
    shard: 2,
    fullSeconds: 0.6,
    criticalSeconds: 0.6,
  },
  {
    file: "tests/ui-document-canvas.spec.ts",
    shard: 3,
    fullSeconds: 4.6,
    criticalSeconds: 0,
  },
]);

export const prUiShardGroups = Object.freeze(
  Object.fromEntries(
    [1, 2, 3].map((shard) => [
      shard,
      prUiSpecProfiles.filter((profile) => profile.shard === shard).map((profile) => profile.file),
    ]),
  ),
);

export function estimatedPrUiShardSeconds({ excludeCritical = false, profiles = prUiSpecProfiles } = {}) {
  const totals = { 1: 0, 2: 0, 3: 0 };
  for (const profile of profiles) {
    totals[profile.shard] += profile.fullSeconds - (excludeCritical ? profile.criticalSeconds : 0);
  }
  return totals;
}

export function listProductionSpecFiles(testsDir = path.join(process.cwd(), "tests")) {
  return readdirSync(testsDir)
    .filter((file) => productionSpecFilePattern.test(file))
    .map((file) => `tests/${file}`)
    .sort();
}

/** Every spec the required Production UI shards must cover. */
export function listPrUiSpecFiles(testsDir = path.join(process.cwd(), "tests")) {
  return listProductionSpecFiles(testsDir);
}

export function validatePrUiShardGroups(groups = prUiShardGroups, { listFiles = listPrUiSpecFiles } = {}) {
  const onDisk = listFiles();
  const assigned = [];
  const duplicates = [];
  for (const shard of Object.keys(groups).sort((a, b) => Number(a) - Number(b))) {
    const files = groups[shard];
    if (!Array.isArray(files) || files.length === 0) {
      throw new Error(`PR UI shard ${shard} is empty — empty shards fail test:e2e:pr (no --pass-with-no-tests).`);
    }
    for (const file of files) {
      if (assigned.includes(file)) duplicates.push(file);
      assigned.push(file);
    }
  }
  const assignedSorted = [...assigned].sort();
  const missing = onDisk.filter((file) => !assigned.includes(file));
  const extra = assignedSorted.filter((file) => !onDisk.includes(file));
  return {
    ok: missing.length === 0 && extra.length === 0 && duplicates.length === 0,
    onDisk,
    assigned: assignedSorted,
    missing,
    extra,
    duplicates: [...new Set(duplicates)].sort(),
    shardCount: Object.keys(groups).length,
  };
}

export function filesForPrUiShard(shard, groups = prUiShardGroups) {
  const key = String(shard);
  const files = groups[key] ?? groups[Number(key)];
  if (!files?.length) {
    throw new Error(`Unknown or empty PR UI shard: ${shard}`);
  }
  return files;
}

/**
 * The projects a shard must select, in a stable order.
 *
 * A file list alone is not enough: Playwright collects a file only in a project whose `testMatch`
 * accepts it, so a spec passed to a project that does not match it contributes ZERO tests and the
 * run still exits 0. A profile that names its own `project` adds that project alongside `chromium`,
 * and only for the shard that holds the file.
 */
export function projectsForPrUiShard(shard, groups = prUiShardGroups, profiles = prUiSpecProfiles) {
  const files = filesForPrUiShard(shard, groups);
  const projects = ["chromium"];
  for (const profile of profiles) {
    if (profile.project && files.includes(profile.file) && !projects.includes(profile.project)) {
      projects.push(profile.project);
    }
  }
  return projects;
}

export function playwrightArgsForPrUiShard(shard, { excludeCritical = false } = {}) {
  const grepInvert = excludeCritical ? "@critical|@quarantine|@mockup" : "@quarantine|@mockup";
  return [
    "scripts/run-playwright.mjs",
    ...filesForPrUiShard(shard),
    ...projectsForPrUiShard(shard).map((project) => `--project=${project}`),
    "--grep-invert",
    grepInvert,
  ];
}

function parseArgs(args) {
  const options = { shard: undefined, list: false, validate: false, excludeCritical: false };
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === "--list") {
      options.list = true;
      continue;
    }
    if (token === "--validate") {
      options.validate = true;
      continue;
    }
    if (token === "--exclude-critical") {
      options.excludeCritical = true;
      continue;
    }
    if (token === "--shard") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error("--shard requires a shard number (1..N).");
      options.shard = value;
      index += 1;
      continue;
    }
    if (token === "--help" || token === "-h") {
      console.log(
        "Usage: node scripts/playwright-pr-shards.mjs --validate | --list | --shard N [--exclude-critical]\n" +
          "  --validate  Assert every production e2e:pr spec is in exactly one group.\n" +
          "  --list      Print shard membership.\n" +
          "  --shard N   Run test:e2e:pr for that explicit file group.\n" +
          "  --exclude-critical  Exclude @critical tests already proved by the fail-fast job.",
      );
      process.exit(0);
    }
    throw new Error(`Unknown option: ${token}`);
  }
  return options;
}

function isDirectRun() {
  return isDirectEntrypoint(import.meta.url);
}

if (isDirectRun()) {
  const options = parseArgs(process.argv.slice(2));
  if (options.validate || options.list) {
    const result = validatePrUiShardGroups();
    if (options.list) {
      for (const [shard, files] of Object.entries(prUiShardGroups)) {
        console.log(`shard ${shard} (${files.length} files):`);
        for (const file of files) console.log(`  ${file}`);
      }
    }
    if (!result.ok) {
      console.error(
        [
          "PR UI shard groups are out of sync with production specs.",
          result.missing.length ? `missing from groups: ${result.missing.join(", ")}` : null,
          result.extra.length ? `unknown in groups: ${result.extra.join(", ")}` : null,
          result.duplicates.length ? `duplicated: ${result.duplicates.join(", ")}` : null,
        ]
          .filter(Boolean)
          .join("\n"),
      );
      process.exit(1);
    }
    console.log(`PR UI shard parity OK: ${result.onDisk.length} production specs across ${result.shardCount} groups.`);
    process.exit(0);
  }

  if (!options.shard) {
    console.error("Provide --shard N, --validate, or --list.");
    process.exit(2);
  }

  const result = spawnSync(process.execPath, playwrightArgsForPrUiShard(options.shard, options), {
    stdio: "inherit",
    env: process.env,
  });
  process.exit(childProcessExitCode(result));
}

export const playwrightPrShardsInternals = { productionSpecFilePattern, prUiSpecProfiles, prUiShardGroups };
