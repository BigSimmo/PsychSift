#!/usr/bin/env node
/**
 * Contract guard for .github/workflows/pr-mergeability.yml.
 * Mirrors the trusted pull_request_target shape used by pr-policy.yml so the
 * conflict signal never executes PR-head code or mutates branches. It also
 * requires the merge_group pass-through, so a required "PR mergeability" check
 * reports on merge queue entries instead of stalling the queue.
 */
import fs from "node:fs";

import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";
import { yamlBlock } from "./yaml-contract.mjs";

const workflowPath = ".github/workflows/pr-mergeability.yml";
const githubScriptPin = "3a2844b7e9c422d3c10d287c895573f7108da1b3";
const checkoutPin = "3d3c42e5aac5ba805825da76410c181273ba90b1";
const prTargetOnly = "github.event_name == 'pull_request_target'";
const mergeQueueOnly = "github.event_name == 'merge_group'";
const mergeabilityJobIf = `${prTargetOnly} || ${mergeQueueOnly}`;

function collectCheckoutRefs(block) {
  return block
    .split(/\r?\n/)
    .map((line) => line.match(/^\s+ref:\s*(.+?)\s*(?:#.*)?$/)?.[1]?.trim())
    .filter(Boolean);
}

/** The value of the `if:` written directly at `indent` inside a job or step block. */
function directIf(block, indent) {
  const pattern = new RegExp(`^ {${indent}}(?:- )?if:\\s*(.+?)\\s*$`);
  for (const line of block.split(/\r?\n/)) {
    const match = line.match(pattern);
    if (match) return match[1];
  }
  return "";
}

/**
 * Returns every contract violation in the given pr-mergeability.yml text. An empty array means the
 * workflow passes.
 */
export function checkPrMergeabilityWorkflow(workflow) {
  const failures = [];

  if (!/^on:\s*$/m.test(workflow) || !workflow.includes("pull_request_target:")) {
    failures.push("pr-mergeability.yml must trigger on pull_request_target.");
  }
  if (!/^\s{2}push:\s*$/m.test(workflow) || !workflow.includes('branches: [main, "release/**"]')) {
    failures.push("pr-mergeability.yml must retrigger on protected-base pushes.");
  }
  if (!/^\s{2}merge_group:\s*$/m.test(workflow)) {
    failures.push(
      "pr-mergeability.yml must trigger on merge_group, or a required PR mergeability check stalls the merge queue.",
    );
  }
  if ((workflow.match(/^ {4}name: PR mergeability$/gm) ?? []).length !== 1) {
    failures.push(
      'pr-mergeability.yml must have exactly one job named "PR mergeability", so no skipped duplicate can satisfy the required check.',
    );
  }
  if (/^\s*pull_request:\s*$/m.test(workflow)) {
    failures.push(
      "pr-mergeability.yml must not use pull_request (that event is skipped when the merge ref is missing).",
    );
  }
  if (
    !/^permissions:\s*$/m.test(workflow) ||
    !workflow.includes("contents: read") ||
    !workflow.includes("pull-requests: read")
  ) {
    failures.push("pr-mergeability.yml must declare read-only workflow permissions.");
  }
  if (/pull-requests:\s*write/.test(workflow) || /contents:\s*write/.test(workflow)) {
    failures.push("pr-mergeability.yml must not request write permissions.");
  }
  if ((workflow.match(/checks:\s*write/g) ?? []).length !== 1) {
    failures.push("pr-mergeability.yml must grant checks:write exactly once, on the base-push job.");
  }
  if (/updateBranch|update-branch|sync:pr-branches:apply|sync-open-pr-branches\.mjs\s+--apply/.test(workflow)) {
    failures.push("pr-mergeability.yml must not mutate PR branches.");
  }

  const job = yamlBlock(workflow, "mergeability:", 2);
  if (!job) {
    failures.push("pr-mergeability.yml is missing the mergeability job.");
  } else {
    // The job-level `if:` must admit merge_group. A job that skips on merge_group still reports a
    // "PR mergeability" check, but a skipped check never runs the pass-through, and leaving the
    // queue's required check to a skip is exactly the ambiguity this contract exists to close.
    if (directIf(job, 4) !== mergeabilityJobIf) {
      failures.push(
        `pr-mergeability job must run for pull_request_target and merge_group only (if: ${mergeabilityJobIf}).`,
      );
    }
    if (!/^ {4}name: PR mergeability$/m.test(job)) {
      failures.push('pr-mergeability job must keep the check name "PR mergeability".');
    }
    const queueStep = yamlBlock(job, "- name: Accept merge queue entry", 6);
    if (!queueStep) {
      failures.push("pr-mergeability job is missing the merge_group pass-through step.");
    } else {
      if (directIf(queueStep, 8) !== mergeQueueOnly) {
        failures.push(`merge_group pass-through step must run only for merge_group (if: ${mergeQueueOnly}).`);
      }
      if (!/^ {8}run:/m.test(queueStep)) {
        failures.push("merge_group pass-through step must be a plain run step.");
      }
      if (
        /^ {8}(?:uses|continue-on-error):/m.test(queueStep) ||
        /\$\{\{\s*(?:secrets|github\.event)\./.test(queueStep)
      ) {
        failures.push(
          "merge_group pass-through step must not check out, call actions, read secrets or interpolate event data.",
        );
      }
    }
    if (!/runs-on:\s*ubuntu-24\.04/.test(job)) {
      failures.push("pr-mergeability job must pin runs-on to ubuntu-24.04.");
    }
    const checkoutStep = yamlBlock(job, "- name: Checkout trusted classifier", 6);
    if (!checkoutStep) {
      failures.push("pr-mergeability job is missing the trusted checkout step.");
    } else {
      if (directIf(checkoutStep, 8) !== prTargetOnly) {
        failures.push(`pr-mergeability checkout must run only for pull_request_target (if: ${prTargetOnly}).`);
      }
      if (!checkoutStep.includes(`uses: actions/checkout@${checkoutPin}`)) {
        failures.push("pr-mergeability checkout must use the pinned actions/checkout SHA.");
      }
      const refs = collectCheckoutRefs(checkoutStep);
      if (!refs.includes("${{ github.workflow_sha }}")) {
        failures.push("pr-mergeability checkout must use github.workflow_sha.");
      }
      if (refs.some((ref) => /pull_request\.head|base_ref|pull_request\.base\.sha/.test(ref))) {
        failures.push("pr-mergeability checkout must not use untrusted PR refs.");
      }
      if (!/persist-credentials:\s*false/.test(checkoutStep) || /persist-credentials:\s*true/.test(checkoutStep)) {
        failures.push("pr-mergeability checkout must set persist-credentials: false.");
      }
    }

    const signalStep = yamlBlock(job, "- name: Signal real merge conflicts", 6);
    if (!signalStep) {
      failures.push("pr-mergeability job is missing the conflict signal step.");
    } else {
      if (directIf(signalStep, 8) !== prTargetOnly) {
        failures.push(`pr-mergeability signal step must run only for pull_request_target (if: ${prTargetOnly}).`);
      }
      if (!signalStep.includes(`uses: actions/github-script@${githubScriptPin} # v9.0.0`)) {
        failures.push("pr-mergeability signal step must use the pinned github-script action.");
      }
      if (!signalStep.includes("GITHUB_WORKSPACE}/scripts/pr-mergeability.mjs")) {
        failures.push("pr-mergeability signal step must import scripts/pr-mergeability.mjs from the trusted checkout.");
      }
      if (!signalStep.includes("github.rest.pulls.get")) {
        failures.push("pr-mergeability signal step must refresh PR metadata before classifying.");
      }
      if (!signalStep.includes("classifyMergeability")) {
        failures.push("pr-mergeability signal step must call classifyMergeability.");
      }
      for (const field of ["state: latestPr.state", "merged: latestPr.merged"]) {
        if (!signalStep.includes(field)) {
          failures.push(`pr-mergeability signal step must pass ${field} to classifyMergeability.`);
        }
      }
    }
  }

  const basePushJob = yamlBlock(workflow, "refresh-after-base-push:", 2);
  if (!basePushJob) {
    failures.push("pr-mergeability.yml is missing the protected-base refresh job.");
  } else {
    if (!/if:\s*github\.event_name == 'push'/.test(basePushJob)) {
      failures.push("protected-base refresh job must run only for push events.");
    }
    if (!/runs-on:\s*ubuntu-24\.04/.test(basePushJob)) {
      failures.push("protected-base refresh job must pin runs-on to ubuntu-24.04.");
    }
    if (!/permissions:[\s\S]*?contents:\s*read[\s\S]*?pull-requests:\s*read[\s\S]*?checks:\s*write/.test(basePushJob)) {
      failures.push("protected-base refresh job must scope checks:write to that job only.");
    }
    if (/contents:\s*write|pull-requests:\s*write/.test(basePushJob)) {
      failures.push("protected-base refresh job must not write contents or pull requests.");
    }

    const checkoutStep = yamlBlock(basePushJob, "- name: Checkout trusted base classifier", 6);
    if (!checkoutStep) {
      failures.push("protected-base refresh job is missing the trusted checkout step.");
    } else {
      if (!checkoutStep.includes(`uses: actions/checkout@${checkoutPin}`)) {
        failures.push("protected-base refresh checkout must use the pinned actions/checkout SHA.");
      }
      const refs = collectCheckoutRefs(checkoutStep);
      if (!refs.includes("${{ github.sha }}")) {
        failures.push("protected-base refresh checkout must use the pushed base SHA.");
      }
      if (refs.some((ref) => /pull_request\.head|head\.sha/.test(ref))) {
        failures.push("protected-base refresh checkout must not use a PR head ref.");
      }
      if (!/persist-credentials:\s*false/.test(checkoutStep)) {
        failures.push("protected-base refresh checkout must set persist-credentials: false.");
      }
    }

    const refreshStep = yamlBlock(basePushJob, "- name: Refresh unchanged PR heads", 6);
    if (!refreshStep) {
      failures.push("protected-base refresh job is missing the PR refresh step.");
    } else {
      for (const required of [
        `uses: actions/github-script@${githubScriptPin} # v9.0.0`,
        "github.rest.pulls.list",
        "github.rest.pulls.get",
        "classifyMergeability",
        "github.rest.checks.create",
        'name: "PR mergeability"',
        "head_sha: latestPr.head.sha",
        "state: latestPr.state",
        "merged: latestPr.merged",
      ]) {
        if (!refreshStep.includes(required)) {
          failures.push(`protected-base refresh step is missing ${JSON.stringify(required)}.`);
        }
      }
    }
  }

  return failures;
}

const invokedDirectly = isDirectEntrypoint(import.meta.url);
if (invokedDirectly) {
  const failures = checkPrMergeabilityWorkflow(fs.readFileSync(workflowPath, "utf8"));
  if (failures.length > 0) {
    console.error("PR mergeability workflow guard failed:");
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }
  console.log("PR mergeability workflow guard passed.");
}
