#!/usr/bin/env node
/**
 * Duration-balanced file groups for the `release-browser-matrix` legs.
 *
 * Playwright `--shard=i/N` cuts by test COUNT in alphabetical file order and, with
 * `fullyParallel: false`, gives a whole file to the shard its first test lands in. The slow
 * files sit next to each other alphabetically (ui-phone-scroll*, ui-smoke, ui-tools), so one
 * leg per project carried most of the time. Measured on main (runs 37357747260-37392532551,
 * 5-6 October 2026): mobile-webkit legs ran 7.3/4.5/27.0/2.4/7.5 min and
 * mobile-pwa-standalone 9.1/3.9/18.9/2.6/5.6 min; the matrix took as long as its worst leg.
 *
 * Here every leg derives the same deterministic split from the committed per-file costs below:
 * files longest first, each onto the currently lightest group (ties go to the lower group).
 * Every production spec runs exactly once per project, on one worker, with zero retries, as
 * before; only which leg runs it changes. The split fails closed when the production spec list and
 * the timing table disagree (a new spec with no cost, or a cost for a spec that no longer exists):
 * guessing a cost could silently unbalance a leg past its timeout, and a stale entry means the
 * table no longer describes the suite. `tests/playwright-release-shards.test.ts` (a PR-time unit
 * test) fails on the same drift first, and on a gap, a duplicate, or a filter that could select a
 * second file.
 *
 * Refresh the table from the `release-ui-timings-*` artifacts of recent main runs when a leg
 * drifts well above the others. The costs guide grouping only, never test selection.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";

import { childProcessExitCode } from "./child-process-result.mjs";
import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";
import { listProductionSpecFiles } from "./playwright-pr-shards.mjs";

/**
 * Seconds each production spec took per project: the median of its summed test durations across
 * the `release-ui-timings-*` reports of main runs 37354741390, 37357747260, 37377273346,
 * 37390483207, 37392532551 and 37397799287 (5-6 October 2026, 4-6 reports per file).
 */
export const releaseSpecSeconds = Object.freeze({
  firefox: Object.freeze({
    "tests/adaptive-answer-ui.spec.ts": 20.1,
    "tests/answer-progress-ui-smoke.spec.ts": 33.9,
    "tests/api-csrf-proxy.spec.ts": 0.0,
    "tests/dsm-ui-smoke.spec.ts": 2.7,
    "tests/ui-accessibility.spec.ts": 25.3,
    "tests/ui-admin.spec.ts": 4.0,
    "tests/ui-chrome-scroll.spec.ts": 63.3,
    "tests/ui-clinical-ask.spec.ts": 18.6,
    "tests/ui-cme-phone.spec.ts": 24.4,
    "tests/ui-dictionary.spec.ts": 23.2,
    "tests/ui-document-canvas.spec.ts": 0.5,
    "tests/ui-forms-section-nav.spec.ts": 11.8,
    "tests/ui-formulation-result-cards.spec.ts": 2.2,
    "tests/ui-formulation.spec.ts": 14.6,
    "tests/ui-hydration.spec.ts": 2.0,
    "tests/ui-mode-nav-density.spec.ts": 56.7,
    "tests/ui-on-call-boards.spec.ts": 48.2,
    "tests/ui-on-call-call.spec.ts": 7.7,
    "tests/ui-on-call-now.spec.ts": 14.5,
    "tests/ui-on-call-service.spec.ts": 10.8,
    "tests/ui-overlap.spec.ts": 39.4,
    "tests/ui-patient-number-field.spec.ts": 9.3,
    "tests/ui-phone-motion.spec.ts": 18.0,
    "tests/ui-phone-scroll-document-rail.spec.ts": 4.4,
    "tests/ui-phone-scroll-page-owned.spec.ts": 49.2,
    "tests/ui-phone-scroll-routes.spec.ts": 162.5,
    "tests/ui-phone-scroll-submitted-root.spec.ts": 1.1,
    "tests/ui-phone-scroll.spec.ts": 215.0,
    "tests/ui-pwa.spec.ts": 1.8,
    "tests/ui-roster-team.spec.ts": 13.5,
    "tests/ui-route-coverage.spec.ts": 26.7,
    "tests/ui-smoke.spec.ts": 266.8,
    "tests/ui-sources.spec.ts": 16.5,
    "tests/ui-specifiers.spec.ts": 30.3,
    "tests/ui-stress.spec.ts": 9.4,
    "tests/ui-style-contract.spec.ts": 0.0,
    "tests/ui-teaching.spec.ts": 12.6,
    "tests/ui-therapy-nav-scroll.spec.ts": 4.2,
    "tests/ui-therapy-pathways.spec.ts": 4.6,
    "tests/ui-token-layer-resolution.spec.ts": 0.0,
    "tests/ui-tools-show-all.spec.ts": 1.7,
    "tests/ui-tools.spec.ts": 164.1,
    "tests/ui-universal-search.spec.ts": 37.0,
    "tests/ui-user-journeys.spec.ts": 3.5,
    "tests/ui-visual-artifacts.spec.ts": 9.7,
  }),
  webkit: Object.freeze({
    "tests/adaptive-answer-ui.spec.ts": 36.1,
    "tests/answer-progress-ui-smoke.spec.ts": 37.2,
    "tests/api-csrf-proxy.spec.ts": 0.1,
    "tests/dsm-ui-smoke.spec.ts": 6.8,
    "tests/ui-accessibility.spec.ts": 45.3,
    "tests/ui-admin.spec.ts": 7.2,
    "tests/ui-chrome-scroll.spec.ts": 224.6,
    "tests/ui-clinical-ask.spec.ts": 26.6,
    "tests/ui-cme-phone.spec.ts": 35.2,
    "tests/ui-dictionary.spec.ts": 32.9,
    "tests/ui-document-canvas.spec.ts": 1.0,
    "tests/ui-forms-section-nav.spec.ts": 24.1,
    "tests/ui-formulation-result-cards.spec.ts": 3.8,
    "tests/ui-formulation.spec.ts": 31.6,
    "tests/ui-hydration.spec.ts": 4.3,
    "tests/ui-mode-nav-density.spec.ts": 95.9,
    "tests/ui-on-call-boards.spec.ts": 79.7,
    "tests/ui-on-call-call.spec.ts": 9.3,
    "tests/ui-on-call-now.spec.ts": 20.4,
    "tests/ui-on-call-service.spec.ts": 17.0,
    "tests/ui-overlap.spec.ts": 47.2,
    "tests/ui-patient-number-field.spec.ts": 17.1,
    "tests/ui-phone-motion.spec.ts": 19.6,
    "tests/ui-phone-scroll-document-rail.spec.ts": 9.1,
    "tests/ui-phone-scroll-page-owned.spec.ts": 81.5,
    "tests/ui-phone-scroll-routes.spec.ts": 186.0,
    "tests/ui-phone-scroll-submitted-root.spec.ts": 1.2,
    "tests/ui-phone-scroll.spec.ts": 241.3,
    "tests/ui-pwa.spec.ts": 5.5,
    "tests/ui-roster-team.spec.ts": 22.9,
    "tests/ui-route-coverage.spec.ts": 47.3,
    "tests/ui-smoke.spec.ts": 407.7,
    "tests/ui-sources.spec.ts": 24.1,
    "tests/ui-specifiers.spec.ts": 51.2,
    "tests/ui-stress.spec.ts": 14.9,
    "tests/ui-style-contract.spec.ts": 0.0,
    "tests/ui-teaching.spec.ts": 18.8,
    "tests/ui-therapy-nav-scroll.spec.ts": 8.1,
    "tests/ui-therapy-pathways.spec.ts": 7.5,
    "tests/ui-token-layer-resolution.spec.ts": 0.0,
    "tests/ui-tools-show-all.spec.ts": 1.2,
    "tests/ui-tools.spec.ts": 240.6,
    "tests/ui-universal-search.spec.ts": 50.8,
    "tests/ui-user-journeys.spec.ts": 3.5,
    "tests/ui-visual-artifacts.spec.ts": 13.1,
  }),
  "mobile-webkit": Object.freeze({
    "tests/adaptive-answer-ui.spec.ts": 34.1,
    "tests/answer-progress-ui-smoke.spec.ts": 39.4,
    "tests/api-csrf-proxy.spec.ts": 0.1,
    "tests/dsm-ui-smoke.spec.ts": 8.6,
    "tests/ui-accessibility.spec.ts": 54.1,
    "tests/ui-admin.spec.ts": 7.0,
    "tests/ui-chrome-scroll.spec.ts": 29.5,
    "tests/ui-clinical-ask.spec.ts": 20.3,
    "tests/ui-cme-phone.spec.ts": 38.9,
    "tests/ui-dictionary.spec.ts": 33.3,
    "tests/ui-document-canvas.spec.ts": 1.2,
    "tests/ui-forms-section-nav.spec.ts": 27.6,
    "tests/ui-formulation-result-cards.spec.ts": 4.1,
    "tests/ui-formulation.spec.ts": 29.9,
    "tests/ui-hydration.spec.ts": 3.4,
    "tests/ui-mode-nav-density.spec.ts": 101.8,
    "tests/ui-on-call-boards.spec.ts": 122.7,
    "tests/ui-on-call-call.spec.ts": 14.5,
    "tests/ui-on-call-now.spec.ts": 31.4,
    "tests/ui-on-call-service.spec.ts": 22.8,
    "tests/ui-overlap.spec.ts": 65.8,
    "tests/ui-patient-number-field.spec.ts": 44.0,
    "tests/ui-phone-motion.spec.ts": 45.8,
    "tests/ui-phone-scroll-document-rail.spec.ts": 18.3,
    "tests/ui-phone-scroll-page-owned.spec.ts": 146.2,
    "tests/ui-phone-scroll-routes.spec.ts": 217.1,
    "tests/ui-phone-scroll-submitted-root.spec.ts": 1.8,
    "tests/ui-phone-scroll.spec.ts": 358.3,
    "tests/ui-pwa.spec.ts": 6.3,
    "tests/ui-roster-team.spec.ts": 25.2,
    "tests/ui-route-coverage.spec.ts": 61.4,
    "tests/ui-smoke.spec.ts": 674.0,
    "tests/ui-sources.spec.ts": 32.9,
    "tests/ui-specifiers.spec.ts": 71.9,
    "tests/ui-stress.spec.ts": 27.7,
    "tests/ui-style-contract.spec.ts": 0.0,
    "tests/ui-teaching.spec.ts": 35.2,
    "tests/ui-therapy-nav-scroll.spec.ts": 14.9,
    "tests/ui-therapy-pathways.spec.ts": 15.6,
    "tests/ui-token-layer-resolution.spec.ts": 0.0,
    "tests/ui-tools-show-all.spec.ts": 1.7,
    "tests/ui-tools.spec.ts": 372.7,
    "tests/ui-universal-search.spec.ts": 31.5,
    "tests/ui-user-journeys.spec.ts": 3.5,
    "tests/ui-visual-artifacts.spec.ts": 19.7,
  }),
  "mobile-pwa-standalone": Object.freeze({
    "tests/adaptive-answer-ui.spec.ts": 38.8,
    "tests/answer-progress-ui-smoke.spec.ts": 42.1,
    "tests/api-csrf-proxy.spec.ts": 0.1,
    "tests/dsm-ui-smoke.spec.ts": 11.6,
    "tests/ui-accessibility.spec.ts": 70.4,
    "tests/ui-admin.spec.ts": 9.4,
    "tests/ui-chrome-scroll.spec.ts": 35.6,
    "tests/ui-clinical-ask.spec.ts": 25.9,
    "tests/ui-cme-phone.spec.ts": 49.0,
    "tests/ui-dictionary.spec.ts": 41.4,
    "tests/ui-document-canvas.spec.ts": 1.7,
    "tests/ui-forms-section-nav.spec.ts": 35.6,
    "tests/ui-formulation-result-cards.spec.ts": 5.1,
    "tests/ui-formulation.spec.ts": 40.1,
    "tests/ui-hydration.spec.ts": 4.4,
    "tests/ui-mode-nav-density.spec.ts": 131.3,
    "tests/ui-on-call-boards.spec.ts": 126.0,
    "tests/ui-on-call-call.spec.ts": 15.0,
    "tests/ui-on-call-now.spec.ts": 33.1,
    "tests/ui-on-call-service.spec.ts": 24.4,
    "tests/ui-overlap.spec.ts": 69.9,
    "tests/ui-patient-number-field.spec.ts": 37.7,
    "tests/ui-phone-motion.spec.ts": 43.6,
    "tests/ui-phone-scroll-document-rail.spec.ts": 15.5,
    "tests/ui-phone-scroll-page-owned.spec.ts": 127.3,
    "tests/ui-phone-scroll-routes.spec.ts": 199.8,
    "tests/ui-phone-scroll-submitted-root.spec.ts": 1.5,
    "tests/ui-phone-scroll.spec.ts": 315.1,
    "tests/ui-pwa.spec.ts": 5.6,
    "tests/ui-roster-team.spec.ts": 21.1,
    "tests/ui-route-coverage.spec.ts": 50.4,
    "tests/ui-smoke.spec.ts": 550.2,
    "tests/ui-sources.spec.ts": 37.2,
    "tests/ui-specifiers.spec.ts": 55.2,
    "tests/ui-stress.spec.ts": 21.5,
    "tests/ui-style-contract.spec.ts": 0.0,
    "tests/ui-teaching.spec.ts": 28.3,
    "tests/ui-therapy-nav-scroll.spec.ts": 10.8,
    "tests/ui-therapy-pathways.spec.ts": 11.3,
    "tests/ui-token-layer-resolution.spec.ts": 0.0,
    "tests/ui-tools-show-all.spec.ts": 1.1,
    "tests/ui-tools.spec.ts": 264.2,
    "tests/ui-universal-search.spec.ts": 25.3,
    "tests/ui-user-journeys.spec.ts": 3.5,
    "tests/ui-visual-artifacts.spec.ts": 14.4,
  }),
});

/** The projects split by file. `chromium-mockups` runs whole on one leg. */
export const RELEASE_SHARDED_PROJECTS = Object.freeze(Object.keys(releaseSpecSeconds));

export function parseShard(value) {
  const match = /^(\d+)\/(\d+)$/.exec(String(value ?? ""));
  const index = Number(match?.[1]);
  const count = Number(match?.[2]);
  if (!match || index < 1 || count < 1 || index > count || count > 16) {
    throw new Error(`--shard must be "<index>/<count>" with 1 <= index <= count <= 16, got "${value}".`);
  }
  return { index, count };
}

/**
 * Every group for one project: files longest first, each onto the lightest group. Deterministic
 * for a given file list, table and count, so the legs agree without talking to each other.
 */
export function releaseShardGroups(project, count, { files = listProductionSpecFiles(), seconds } = {}) {
  const table = seconds ?? releaseSpecSeconds[project];
  if (!table) throw new Error(`No release shard timings for project "${project}".`);
  const unique = [...new Set(files)];
  if (unique.length !== files.length) throw new Error(`${project}: the production spec list repeats a file.`);
  const unmeasured = unique.filter((file) => !Number.isFinite(table[file])).sort();
  const stale = Object.keys(table)
    .filter((file) => !unique.includes(file))
    .sort();
  if (unmeasured.length > 0 || stale.length > 0) {
    throw new Error(
      [
        `${project}: release shard timings do not match the production specs; refresh releaseSpecSeconds from the release-ui-timings artifacts.`,
        unmeasured.length ? `no timing for: ${unmeasured.join(", ")}` : null,
        stale.length ? `timing for a spec that no longer exists: ${stale.join(", ")}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
  const cost = (file) => table[file];
  const ordered = unique.sort((a, b) => cost(b) - cost(a) || (a < b ? -1 : a > b ? 1 : 0));
  const groups = Array.from({ length: count }, () => ({ files: [], seconds: 0 }));
  for (const file of ordered) {
    let lightest = 0;
    for (let index = 1; index < count; index += 1) {
      const candidate = groups[index];
      const best = groups[lightest];
      // A zero-cost file still counts once, so a run of them spreads instead of piling up.
      if (
        candidate.seconds < best.seconds ||
        (candidate.seconds === best.seconds && candidate.files.length < best.files.length)
      ) {
        lightest = index;
      }
    }
    groups[lightest].files.push(file);
    groups[lightest].seconds += cost(file);
  }
  for (const group of groups) group.files.sort();
  return groups;
}

/**
 * Playwright treats each positional argument as a case-insensitive regular expression matched
 * against absolute file paths. Escape the dots and anchor both ends on a path separator, so a
 * group selects exactly its own files and never a sibling such as dsm-ui-smoke.spec.ts.
 */
export function fileFilter(file) {
  const escaped = file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return `(^|[\\\\/])${escaped.replace(/\//g, "[\\\\/]")}$`;
}

export function releaseShardFiles(project, { index, count }, options) {
  const files = releaseShardGroups(project, count, options)[index - 1].files;
  if (files.length === 0) {
    throw new Error(`Release shard ${index}/${count} of ${project} has no files; lower the shard count.`);
  }
  return files;
}

/**
 * The run-playwright.mjs arguments for one leg. One project and a shard total above one selects
 * that leg's file group; anything else passes through unchanged (one leg runs everything).
 */
export function releaseShardArgs(args, options) {
  const projects = args.filter((arg) => arg.startsWith("--project="));
  const shardArg = args.find((arg) => arg.startsWith("--shard="));
  const rest = args.filter((arg) => !arg.startsWith("--shard="));
  if (!shardArg) return rest;
  const shard = parseShard(shardArg.slice("--shard=".length));
  if (shard.count === 1) return rest;
  if (projects.length !== 1) {
    throw new Error(`A split release leg runs exactly one --project=, got ${projects.length}.`);
  }
  const project = projects[0].slice("--project=".length);
  if (!RELEASE_SHARDED_PROJECTS.includes(project)) {
    throw new Error(`Project "${project}" has no release shard timings; add it to releaseSpecSeconds.`);
  }
  return [...rest, ...releaseShardFiles(project, shard, options).map(fileFilter)];
}

if (isDirectEntrypoint(import.meta.url)) {
  const args = process.argv.slice(2);
  let playwrightArgs;
  try {
    playwrightArgs = releaseShardArgs(args);
  } catch (error) {
    console.error(`::error::${error.message}`);
    process.exit(2);
  }
  const selected = playwrightArgs.filter((arg) => !args.includes(arg));
  if (selected.length > 0) {
    const shardArg = args.find((arg) => arg.startsWith("--shard="));
    console.log(
      `Release shard ${shardArg.slice("--shard=".length)}: ${selected.length} spec file(s) by measured duration.`,
    );
  }
  const result = spawnSync(
    process.execPath,
    [path.join(path.dirname(new URL(import.meta.url).pathname), "run-playwright.mjs"), ...playwrightArgs],
    { stdio: "inherit", env: process.env },
  );
  process.exit(childProcessExitCode(result));
}
