import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { validateJsonSchema } from "./lib/json-schema-contract-validator.mjs";
import {
  acceptedHistoryAgentReuseErrors,
  acceptedHistoryContinuityErrors,
  acceptanceStatusErrors,
  agentReuseErrors,
  atomicMetadataCommitErrors,
  buildReviewPackageBytes,
  connectedMetadataPaths,
  connectedOperationAcceptanceErrors,
  packageIdentityErrors,
  phaseAcceptanceContinuityErrors,
  predecessorStartErrors,
  finalReviewRoutingErrors,
  programmeFinalHeadErrors,
  p00AnchorErrors,
  operationalMetadataPaths,
  phaseMetadataPaths,
  programmeMetadataPaths,
  programmeVerificationErrors,
  resumeStateErrors,
  reviewPackageEvidenceErrors,
  reviewPackageDigest,
  requiredResidualGateErrors,
  taskChainErrors,
  tddEvidenceErrors,
  trackedBytesErrors,
  verificationOnlyEvidenceErrors,
} from "./lib/rag-receipt-contracts.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const programmeId = "rag-answer-quality-and-repository-coverage-v1";
const upgradeRoot = join(repositoryRoot, "docs", "superpowers", "rag-upgrade");
const canonicalRoot = join(upgradeRoot, "canonical");
const receiptRoot = join(upgradeRoot, "execution-receipts", programmeId);
const artifactRoot = join(upgradeRoot, "execution-artifacts", programmeId);
const manifest = readJson(join(canonicalRoot, "programme-manifest.json"));
const routeEvidenceSchema = readJson(join(canonicalRoot, "route-evidence.schema.json"));
const phaseSchema = readJson(join(canonicalRoot, "phase-receipt.schema.json"));
const programmeSchema = readJson(join(canonicalRoot, "programme-receipt.schema.json"));
const connectedPhaseSchema = readJson(join(canonicalRoot, "connected-phase-receipt.schema.json"));
const operationalSchema = readJson(join(canonicalRoot, "operational-receipt.schema.json"));
const verificationMatrix = readJson(join(canonicalRoot, "task-verification-matrix.json"));
const shaPattern = /^[0-9a-f]{40}$/;

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function readWorkingOrHeadJson(path, errors, requireTracked) {
  const relativePath = relative(repositoryRoot, path).split(sep).join("/");
  if (requireTracked) validateTrackedReceipt(path, errors);
  try {
    const raw = requireTracked ? runGit(["show", `HEAD:${relativePath}`]) : readFileSync(path, "utf8");
    return JSON.parse(raw);
  } catch {
    errors.push(`${relativePath}: receipt is not valid JSON${requireTracked ? " at HEAD" : ""}`);
    return null;
  }
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : (process.argv[index + 1] ?? null);
}

function runGit(args, encoding = "utf8") {
  return execFileSync("git", args, {
    cwd: repositoryRoot,
    encoding,
    stdio: ["ignore", "pipe", "ignore"],
  });
}

function listFiles(root, base = root) {
  if (!existsSync(root)) return [];
  const files = [];
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    if (statSync(path).isDirectory()) files.push(...listFiles(path, base));
    else files.push(relative(base, path).split(sep).join("/"));
  }
  return files.sort();
}

function packageHashFromWorktree(variant) {
  const root = join(upgradeRoot, variant);
  const hash = createHash("sha256");
  for (const file of listFiles(root)) {
    hash.update(file);
    hash.update("\0");
    hash.update(readFileSync(join(root, ...file.split("/"))));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function packageHashFromCommit(variant, commit) {
  const prefix = `docs/superpowers/rag-upgrade/${variant}/`;
  const paths = runGit(["ls-tree", "-r", "--name-only", commit, "--", prefix]).split(/\r?\n/).filter(Boolean).sort();
  if (paths.length === 0) throw new Error(`${commit} contains no ${variant} RAG package`);
  const hash = createHash("sha256");
  for (const path of paths) {
    hash.update(path.slice(prefix.length));
    hash.update("\0");
    hash.update(runGit(["show", `${commit}:${path}`], null));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function isAncestor(base, head) {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", base, head], {
      cwd: repositoryRoot,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function commitList(base, head) {
  return runGit(["rev-list", "--reverse", `${base}..${head}`])
    .split(/\r?\n/)
    .filter(Boolean);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function reviewPackageBytes(base, head) {
  const range = `${base}..${head}`;
  const diff = runGit(
    [
      "-c",
      "color.ui=false",
      "-c",
      "core.quotePath=true",
      "diff",
      "--no-color",
      "--no-ext-diff",
      "--no-textconv",
      "--no-renames",
      "--full-index",
      "--binary",
      "-U10",
      range,
      "--",
    ],
    null,
  );
  return buildReviewPackageBytes(base, head, commitList(base, head), diff);
}

function repositoryPath(path) {
  return join(repositoryRoot, ...path.split("/"));
}

function validateArtifact(path, expectedHash, label, errors, requireTracked) {
  const absolutePath = repositoryPath(path);
  if (!existsSync(absolutePath)) {
    errors.push(`${label}: artifact does not exist: ${path}`);
    return;
  }
  const bytes = readFileSync(absolutePath);
  if (sha256(bytes) !== expectedHash) errors.push(`${label}: artifact hash differs: ${path}`);
  if (!requireTracked) return;
  let trackedBytes;
  try {
    trackedBytes = runGit(["show", `HEAD:${path}`], null);
  } catch {
    errors.push(`${label}: artifact is not tracked at HEAD: ${path}`);
    return;
  }
  if (!bytes.equals(trackedBytes)) errors.push(`${label}: working artifact differs from HEAD: ${path}`);
}

function validateArtifactAtCommit(path, expectedHash, commit, label, errors) {
  let bytes;
  try {
    bytes = runGit(["show", `${commit}:${path}`], null);
  } catch {
    errors.push(`${label}: artifact must exist at phaseEndSha: ${path}`);
    return;
  }
  if (sha256(bytes) !== expectedHash) errors.push(`${label}: phaseEndSha artifact hash differs: ${path}`);
}

function validateFullRangeReview(review, base, head, reviewerId, label, errors, requireTracked, accepted) {
  if (!review) return;
  if (review.reviewerAgentId !== reviewerId) errors.push(`${label}: reviewer ID must match reviewer routing`);
  if (review.baseSha !== base || review.headSha !== head) {
    errors.push(`${label}: review must cover the exact immutable ${base}..${head} range`);
  }
  validateArtifact(review.diffPackagePath, review.diffPackageSha256, `${label}/diff`, errors, requireTracked);
  validateArtifact(review.reportPath, review.reportSha256, `${label}/report`, errors, requireTracked);
  const diffPath = repositoryPath(review.diffPackagePath);
  if (existsSync(diffPath) && shaPattern.test(base) && shaPattern.test(head)) {
    try {
      const actualBytes = readFileSync(diffPath);
      const expectedBytes = reviewPackageBytes(base, head);
      errors.push(
        ...reviewPackageEvidenceErrors(
          actualBytes,
          base,
          head,
          commitList(base, head),
          reviewPackageDigest(actualBytes),
          reviewPackageDigest(expectedBytes),
        ).map((error) => `${label}: ${error}`),
      );
    } catch (error) {
      errors.push(`${label}: could not reconstruct review package: ${error.message}`);
    }
  }
  if (accepted && (review.specVerdict !== "PASS" || review.qualityVerdict !== "PASS")) {
    errors.push(`${label}: accepted review requires PASS spec and quality verdicts`);
  }
}

function validateTrackedReceipt(path, errors) {
  const relativePath = relative(repositoryRoot, path).split(sep).join("/");
  let tracked = null;
  try {
    tracked = runGit(["show", `HEAD:${relativePath}`], null);
  } catch {}
  errors.push(...trackedBytesErrors(readFileSync(path), tracked, relativePath));
}

function packageIdentityDiff(receipt, p00Receipt, label, errors) {
  errors.push(...packageIdentityErrors(receipt, p00Receipt, label));
}

function agentIdsFromReceipt(receipt) {
  const ids = new Set();
  ids.add(receipt.controllerRouting?.agentId);
  for (const capability of receipt.capabilityEvidence ?? []) ids.add(capability.probeAgentId);
  for (const task of receipt.tasks ?? []) {
    ids.add(task.implementerRouting?.agentId);
    for (const review of task.reviews ?? []) ids.add(review.reviewerRouting?.agentId);
  }
  for (const review of receipt.phaseReviews ?? []) ids.add(review.reviewerRouting?.agentId);
  ids.delete(undefined);
  return ids;
}

function expectedTaskKeys(phase) {
  if (phase.phaseType === "operator-gate") return [];
  return phase.tasks.map((task) => `${phase.id}/${phase.plan}/task-${task}`);
}

function extractedTaskBody(planKey, taskNumber) {
  const planPath = repositoryPath(`docs/superpowers/${manifest.plans[planKey]}`);
  const markdown = readFileSync(planPath, "utf8");
  const headings = [...markdown.matchAll(/^### Task (\d+):[^\n]*$/gm)];
  const index = headings.findIndex((heading) => Number(heading[1]) === taskNumber);
  if (index === -1) throw new Error(`task body not found for ${planKey}/task-${taskNumber}`);
  return markdown.slice(headings[index].index, headings[index + 1]?.index ?? markdown.length);
}

const defaultGreenExpected = "The identical focused command passes after implementing the task contract.";

function literalTddContract(planKey, taskNumber) {
  const body = extractedTaskBody(planKey, taskNumber);
  const runs = [...body.matchAll(/Run:\s*(?:`([^`\r\n]+)`|\r?\n```(?:text|bash)?\r?\n([^\r\n]+))/g)];
  for (const [index, run] of runs.entries()) {
    const following = body.slice(run.index + run[0].length, runs[index + 1]?.index ?? body.length);
    const redExpected = following.match(/Expected:\s*(FAIL[^\r\n]*)/i)?.[1]?.trim();
    if (redExpected) {
      const command = run[1] ?? run[2];
      return {
        strategy: "tdd",
        redCommand: command,
        redExpected,
        greenCommand: command,
        greenExpected: defaultGreenExpected,
      };
    }
  }
  throw new Error(`${planKey}/task-${taskNumber} has no machine-readable RED command or matrix contract`);
}

function taskContract(globalTaskKey) {
  const [, plan, taskName] = globalTaskKey.split("/");
  const explicit = verificationMatrix.tasks[`${plan}/${taskName}`];
  if (explicit) {
    return explicit.strategy === "tdd" ? { ...explicit, greenExpected: defaultGreenExpected } : explicit;
  }
  const taskNumber = Number(taskName.slice("task-".length));
  return literalTddContract(plan, taskNumber);
}

function validateAgentRouting(routing, expected, label, receipt, errors, requireTracked) {
  if (!routing) return;
  const expectedHost = "codex-cloud";
  if (routing.runtimeHost !== expectedHost) errors.push(`${label}: runtimeHost must be ${expectedHost}`);
  if (routing.provider !== "codex" || routing.providerMappingUsed !== false) {
    errors.push(`${label}: only unmapped Codex routing is accepted`);
  }
  if (routing.plannedModel !== expected.model) errors.push(`${label}: plannedModel must be ${expected.model}`);
  if (routing.plannedReasoning !== expected.reasoning) {
    errors.push(`${label}: plannedReasoning must be ${expected.reasoning}`);
  }
  if (routing.actualReasoning !== expected.reasoning)
    errors.push(`${label}: actualReasoning must match the selected effort`);
  const exact = routing.actualModel === expected.model;
  const allowedEscalation =
    expected.allowTerraEscalation &&
    expected.model === "gpt-5.6-terra" &&
    routing.actualModel === "gpt-5.6-sol" &&
    routing.escalationUsed === true &&
    Boolean(routing.escalationReason);
  if (!exact && !allowedEscalation) errors.push(`${label}: actual model is an unapproved fallback`);
  if (routing.fallbackUsed !== false) errors.push(`${label}: fallbackUsed must remain false`);
  const requiredClass = routing.actualModel === "gpt-5.6-terra" ? "workhorse-high" : "frontier-high";
  if (routing.capabilityClass !== requiredClass) errors.push(`${label}: capabilityClass must be ${requiredClass}`);
  if (
    !routing.routeEvidence ||
    !manifest.capabilityContract.routeEvidenceSources.includes(routing.routeEvidence.source)
  ) {
    errors.push(`${label}: authoritative route evidence is required`);
  } else {
    validateRouteEvidenceArtifact(
      routing.routeEvidence,
      routing,
      `${label}/route`,
      errors,
      requireTracked,
      "artifactPath",
    );
  }
}

function validateRouteEvidenceArtifact(evidence, routing, label, errors, requireTracked, pathKey) {
  const path = evidence?.[pathKey];
  if (!path) return;
  validateArtifact(path, evidence.sha256, label, errors, requireTracked);
  const absolutePath = repositoryPath(path);
  if (!existsSync(absolutePath)) return;
  let payload;
  try {
    payload = readJson(absolutePath);
  } catch (error) {
    errors.push(`${label}: route evidence must be structured JSON: ${error.message}`);
    return;
  }
  errors.push(...validateJsonSchema(payload, routeEvidenceSchema).map((error) => `${label}: ${error}`));
  const expected = {
    source: evidence.source,
    agentId: routing.agentId,
    runtimeHost: routing.runtimeHost,
    provider: routing.provider,
    plannedModel: routing.plannedModel,
    actualModel: routing.actualModel,
    plannedReasoning: routing.plannedReasoning,
    actualReasoning: routing.actualReasoning,
    providerMappingUsed: routing.providerMappingUsed ?? false,
    fallbackUsed: routing.fallbackUsed,
    escalationUsed: routing.escalationUsed ?? false,
    capabilityClass:
      routing.capabilityClass ?? (routing.actualModel === "gpt-5.6-terra" ? "workhorse-high" : "frontier-high"),
  };
  for (const [field, value] of Object.entries(expected)) {
    if (payload[field] !== value) errors.push(`${label}: evidence ${field} must bind to receipt value ${value}`);
  }
}

function capabilitySubjectPath(capability) {
  if (capability === "rag-task-brief") return "scripts/rag-task-brief.mjs";
  if (capability === "rag-phase-launch-check") return "scripts/rag-phase-launch-check.mjs";
  const skillPath = `.agents/skills/${capability}/SKILL.md`;
  return existsSync(repositoryPath(skillPath)) ? skillPath : null;
}

function validateCapabilityEvidence(items, label, errors, requireTracked) {
  const seen = new Set();
  for (const item of items ?? []) {
    if (seen.has(item.capability)) errors.push(`${label}: duplicate capability ${item.capability}`);
    seen.add(item.capability);
    validateArtifact(
      item.evidenceArtifactPath,
      item.evidenceArtifactSha256,
      `${label}/${item.capability}`,
      errors,
      requireTracked,
    );
    const subjectPath = capabilitySubjectPath(item.capability);
    if (!subjectPath) continue;
    if (item.resolvedPathOrTool !== subjectPath) {
      errors.push(`${label}/${item.capability}: resolved path must be ${subjectPath}`);
      continue;
    }
    if (sha256(readFileSync(repositoryPath(subjectPath))) !== item.sha256) {
      errors.push(`${label}/${item.capability}: subject hash does not match the resolved file`);
    }
  }
}

function validateModelRouting(receipt, phase, errors, requireTracked) {
  const controllerReasoning = manifest.adaptiveEffortPolicy.highLaunchPhases.includes(phase.id) ? "high" : "xhigh";
  if (receipt.launchProfile !== controllerReasoning) errors.push(`launchProfile must be ${controllerReasoning}`);
  if (receipt.xhighConfirmed !== (controllerReasoning === "xhigh")) {
    errors.push(`xhighConfirmed must be ${controllerReasoning === "xhigh"}`);
  }
  validateAgentRouting(
    receipt.controllerRouting,
    { model: manifest.defaultAgentPolicy.controllerModel, reasoning: controllerReasoning },
    `${phase.id}/controller`,
    receipt,
    errors,
    requireTracked,
  );
  const requiredCapabilities = new Set([
    "rag-cloud-sdd",
    "rag-task-brief",
    "rag-phase-launch-check",
    "fresh-subagent-dispatch",
  ]);
  for (const profile of manifest.phaseSkillProfiles[phase.id] ?? []) {
    for (const skill of manifest.skillProfiles[profile] ?? []) requiredCapabilities.add(skill);
  }
  const actualCapabilities = new Set((receipt.capabilityEvidence ?? []).map((item) => item.capability));
  for (const capability of requiredCapabilities) {
    if (!actualCapabilities.has(capability)) errors.push(`${phase.id}: missing capability evidence for ${capability}`);
  }
  validateCapabilityEvidence(receipt.capabilityEvidence, `${phase.id}/capabilities`, errors, requireTracked);
  const probe = receipt.capabilityEvidence?.find((item) => item.capability === "fresh-subagent-dispatch");
  if (!probe?.probeAgentId || !probe.probeRouting) {
    errors.push(`${phase.id}: fresh-subagent-dispatch requires a non-null probeAgentId and probeRouting`);
  } else {
    if (probe.probeRouting.agentId !== probe.probeAgentId) {
      errors.push(`${phase.id}: probe routing agentId must match probeAgentId`);
    }
    if (probe.probeRouting.routeEvidence?.source !== "codex-dispatch-metadata") {
      errors.push(`${phase.id}: probe requires authoritative Codex dispatch metadata`);
    }
    if (probe.probeAgentId === receipt.controllerRouting?.agentId) {
      errors.push(`${phase.id}: probe agent must be fresh and distinct from the controller`);
    }
    validateAgentRouting(
      probe.probeRouting,
      {
        model: manifest.capabilityContract.subagentProbeModel,
        reasoning: manifest.capabilityContract.subagentProbeReasoning,
      },
      `${phase.id}/probe`,
      receipt,
      errors,
      requireTracked,
    );
  }
}

function validateReviewHistory(reviews, immutableBase, finalHead, label, implementerIds, errors, requireTracked) {
  for (const [index, review] of reviews.entries()) {
    const reviewLabel = `${label}/reviews/${index}`;
    if (review.baseSha !== immutableBase) errors.push(`${reviewLabel}: immutable review base must be ${immutableBase}`);
    if (!isAncestor(review.baseSha, review.headSha))
      errors.push(`${reviewLabel}: review head does not descend from base`);
    if (!isAncestor(review.headSha, finalHead))
      errors.push(`${reviewLabel}: review head is not in the final reviewed range`);
    if (review.specVerdict === "PENDING" || review.qualityVerdict === "PENDING")
      errors.push(`${reviewLabel}: completed review history cannot retain PENDING verdicts`);
    const reviewerId = review.reviewerRouting?.agentId ?? review.reviewerAgentId;
    if (implementerIds.has(reviewerId)) errors.push(`${reviewLabel}: reviewer must be fresh and distinct`);
    validateArtifact(review.diffPackagePath, review.diffPackageSha256, reviewLabel, errors, requireTracked);
    validateArtifact(review.reportPath, review.reportSha256, reviewLabel, errors, requireTracked);
    const diffPath = repositoryPath(review.diffPackagePath);
    if (existsSync(diffPath)) {
      try {
        const actualBytes = readFileSync(diffPath);
        const expectedBytes = reviewPackageBytes(review.baseSha, review.headSha);
        errors.push(
          ...reviewPackageEvidenceErrors(
            actualBytes,
            review.baseSha,
            review.headSha,
            commitList(review.baseSha, review.headSha),
            reviewPackageDigest(actualBytes),
            reviewPackageDigest(expectedBytes),
          ).map((error) => `${reviewLabel}: ${error}`),
        );
      } catch (error) {
        errors.push(`${reviewLabel}: could not reconstruct review package: ${error.message}`);
      }
    }
  }
  const finalReview = reviews.at(-1);
  if (!finalReview) {
    errors.push(`${label}: review history is empty`);
  } else if (
    finalReview.headSha !== finalHead ||
    finalReview.specVerdict !== "PASS" ||
    finalReview.qualityVerdict !== "PASS"
  ) {
    errors.push(`${label}: final review must cover the final head and PASS both verdicts`);
  }
}

function validateTaskEvidence(task, errors) {
  const contract = taskContract(task.globalTaskKey);
  if (task.strategy !== contract.strategy) {
    errors.push(`${task.globalTaskKey}: strategy must be ${contract.strategy}`);
    return;
  }
  if (task.strategy === "tdd") {
    errors.push(...tddEvidenceErrors(task.globalTaskKey, task.evidence, contract));
  } else {
    errors.push(...verificationOnlyEvidenceErrors(task.globalTaskKey, task.evidence, contract));
  }
}

function validatePhaseReceipt(receipt, expectedPhaseId = null, requireTracked = false) {
  const errors = validateJsonSchema(receipt, phaseSchema);
  if (errors.length > 0) return errors;
  const phase = manifest.phases.find((candidate) => candidate.id === receipt.phaseId);
  const accepted = receipt.status === "accepted";
  if (!phase) return [...errors, `unknown phaseId ${receipt.phaseId ?? "(missing)"}`];
  if (expectedPhaseId && receipt.phaseId !== expectedPhaseId) errors.push(`expected phase ${expectedPhaseId}`);
  if (receipt.executionPredecessor !== phase.executionPredecessor)
    errors.push(`executionPredecessor must be ${phase.executionPredecessor ?? "null"}`);
  if (receipt.packageBaseSha !== manifest.reconciledBase)
    errors.push(`packageBaseSha must equal reconciledBase ${manifest.reconciledBase}`);
  validateModelRouting(receipt, phase, errors, requireTracked);
  try {
    if (receipt.packageHash !== packageHashFromCommit(receipt.packageVariant, receipt.packageHeadSha))
      errors.push("packageHash does not match package blobs at packageHeadSha");
  } catch (error) {
    errors.push(`packageHeadSha package verification failed: ${error.message}`);
  }
  if (!isAncestor(receipt.packageBaseSha, receipt.packageHeadSha))
    errors.push("packageBaseSha is not an ancestor of packageHeadSha");
  if (!isAncestor(receipt.packageHeadSha, receipt.phaseStartSha))
    errors.push("packageHeadSha is not an ancestor of phaseStartSha");
  if (phase.id === "P00") errors.push(...p00AnchorErrors(receipt));
  errors.push(...taskChainErrors(receipt, expectedTaskKeys(phase), accepted));
  if (accepted) {
    if (!isAncestor(receipt.phaseStartSha, receipt.phaseEndSha))
      errors.push("phaseStartSha is not an ancestor of phaseEndSha");
    if (!receipt.completedAt || !receipt.acceptedAt) errors.push("accepted receipt requires completion timestamps");
  }

  const phaseAgentIds = new Set(
    [
      receipt.controllerRouting?.agentId,
      ...receipt.capabilityEvidence.map((capability) => capability.probeAgentId).filter(Boolean),
    ].filter(Boolean),
  );
  for (const [index, task] of receipt.tasks.entries()) {
    const label = `${receipt.phaseId}/tasks/${index}`;
    if (!isAncestor(task.taskBaseSha, task.taskHeadSha)) errors.push(`${label}: task head does not descend from base`);
    const actualCommits = commitList(task.taskBaseSha, task.taskHeadSha);
    if (JSON.stringify(task.commits) !== JSON.stringify(actualCommits))
      errors.push(`${label}: commits must exactly equal git rev-list --reverse taskBase..taskHead`);
    const implementerId = task.implementerRouting?.agentId;
    if (phaseAgentIds.has(implementerId)) errors.push(`${label}: implementer was already used in this phase`);
    phaseAgentIds.add(implementerId);
    validateAgentRouting(
      task.implementerRouting,
      {
        model: phase.implementationModel ?? manifest.defaultAgentPolicy.implementationModel,
        reasoning: phase.implementationReasoning ?? manifest.defaultAgentPolicy.implementationReasoning,
        allowTerraEscalation: ["P00", "P11"].includes(phase.id),
      },
      `${label}/implementer`,
      receipt,
      errors,
      requireTracked,
    );
    validateArtifact(task.briefPath, task.briefSha256, label, errors, requireTracked);
    validateArtifact(task.implementerReportPath, task.implementerReportSha256, label, errors, requireTracked);
    validateTaskEvidence(task, errors);
    validateReviewHistory(
      task.reviews,
      task.taskBaseSha,
      task.taskHeadSha,
      label,
      phaseAgentIds,
      errors,
      requireTracked,
    );
    const taskReviewReasoning = manifest.adaptiveEffortPolicy.taskReviewEscalations.includes(phase.id)
      ? "xhigh"
      : "high";
    for (const [reviewIndex, review] of task.reviews.entries()) {
      validateAgentRouting(
        review.reviewerRouting,
        { model: manifest.defaultAgentPolicy.taskReviewModel, reasoning: taskReviewReasoning },
        `${label}/reviews/${reviewIndex}/reviewer`,
        receipt,
        errors,
        requireTracked,
      );
    }
    const thisTaskReviewers = new Set(task.reviews.map((review) => review.reviewerRouting?.agentId));
    if (thisTaskReviewers.size !== 1) errors.push(`${label}: all attempts must use the one fresh task reviewer`);
    const taskReviewerId = [...thisTaskReviewers][0];
    if (taskReviewerId) {
      if (phaseAgentIds.has(taskReviewerId)) errors.push(`${label}: task reviewer was already used in this phase`);
      phaseAgentIds.add(taskReviewerId);
    }
  }
  if (accepted) {
    const phaseReviewReasoning = manifest.adaptiveEffortPolicy.phaseReviewEscalations.includes(phase.id)
      ? "xhigh"
      : "high";
    for (const [reviewIndex, review] of receipt.phaseReviews.entries()) {
      validateAgentRouting(
        review.reviewerRouting,
        { model: manifest.defaultAgentPolicy.phaseReviewModel, reasoning: phaseReviewReasoning },
        `${receipt.phaseId}/phase/reviews/${reviewIndex}/reviewer`,
        receipt,
        errors,
        requireTracked,
      );
    }
    const phaseReviewerIds = new Set(receipt.phaseReviews.map((review) => review.reviewerRouting?.agentId));
    if (phaseReviewerIds.size !== 1) errors.push("phase review attempts must use one fresh phase reviewer");
    const phaseReviewerId = [...phaseReviewerIds][0];
    if (phaseAgentIds.has(phaseReviewerId)) errors.push("phase reviewer must be distinct from all phase task agents");
    validateReviewHistory(
      receipt.phaseReviews,
      receipt.phaseStartSha,
      receipt.phaseEndSha,
      `${receipt.phaseId}/phase`,
      phaseAgentIds,
      errors,
      requireTracked,
    );
  }
  return errors;
}

function receiptPath(phaseId) {
  return join(receiptRoot, `${phaseId}.json`);
}

function receiptCommit(path) {
  const relativePath = relative(repositoryRoot, path).split(sep).join("/");
  return runGit(["log", "-1", "--format=%H", "HEAD", "--", relativePath]).trim();
}

function existsAtCommit(commit, path) {
  try {
    runGit(["cat-file", "-e", `${commit}:${path}`]);
    return true;
  } catch {
    return false;
  }
}

function commitChanges(commit) {
  return runGit(["diff-tree", "--no-commit-id", "--name-status", "--no-renames", "-r", `${commit}^`, commit])
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [status, ...pathParts] = line.split("\t");
      return { status, path: pathParts.join("\t") };
    });
}

function validateAtomicMetadataCommit(base, commit, receiptRelativePath, expectedPaths, label, errors) {
  errors.push(
    ...atomicMetadataCommitErrors({
      commits: commitList(base, commit),
      metadataCommit: commit,
      receiptExistedAtBase: existsAtCommit(base, receiptRelativePath),
      changes: commitChanges(commit),
      expectedPaths,
      label,
    }),
  );
}

function priorImplementationPhases(phaseId) {
  const index = manifest.phases.findIndex((phase) => phase.id === phaseId);
  return manifest.phases.slice(0, Math.max(index, 0)).filter((phase) => phase.phaseType !== "operator-gate");
}

function validatePriorPhaseReceipts(phaseId, currentHead, errors) {
  const results = [];
  for (const phase of priorImplementationPhases(phaseId)) {
    const result = validateRequiredReceipt(phase.id, currentHead, errors);
    if (result) results.push(result);
  }
  return results;
}

function priorAgentIds(results) {
  const ids = new Set();
  for (const result of results) {
    for (const id of agentIdsFromReceipt(result.receipt)) ids.add(id);
  }
  return ids;
}

function validatePriorAgentHistory(results, errors) {
  errors.push(
    ...acceptedHistoryAgentReuseErrors(
      results.map((result) => ({
        label: result.receipt.phaseId,
        agentIds: agentIdsFromReceipt(result.receipt),
      })),
    ),
  );
}

function validateAcceptedHistoryContinuity(results, errors) {
  errors.push(
    ...acceptedHistoryContinuityErrors(
      results.map((result) => {
        const phase = manifest.phases.find((candidate) => candidate.id === result.receipt.phaseId);
        return {
          phaseId: result.receipt.phaseId,
          executionPredecessor: phase?.executionPredecessor ?? null,
          receipt: result.receipt,
          commit: result.commit,
        };
      }),
    ),
  );
}

function validateRequiredReceipt(phaseId, currentHead, errors) {
  const path = receiptPath(phaseId);
  if (!existsSync(path)) {
    errors.push(`${phaseId}: missing accepted receipt`);
    return null;
  }
  const receipt = readJson(path);
  const relativePath = relative(repositoryRoot, path).split(sep).join("/");
  errors.push(...validatePhaseReceipt(receipt, phaseId, true).map((error) => `${phaseId}: ${error}`));
  validateTrackedReceipt(path, errors);
  if (receipt.status !== "accepted") errors.push(`${phaseId}: dependency receipt is not accepted`);
  const commit = receiptCommit(path);
  if (!shaPattern.test(commit) || !isAncestor(commit, currentHead))
    errors.push(`${phaseId}: receipt commit is not an ancestor of current HEAD`);
  if (!isAncestor(receipt.phaseEndSha, commit)) errors.push(`${phaseId}: receipt commit omits the accepted phase end`);
  if (shaPattern.test(commit)) {
    validateAtomicMetadataCommit(
      receipt.phaseEndSha,
      commit,
      relativePath,
      phaseMetadataPaths(receipt, relativePath),
      phaseId,
      errors,
    );
  }
  return { receipt, commit };
}

function validateProgrammeReceipt(receipt, requireTracked) {
  const errors = validateJsonSchema(receipt, programmeSchema);
  if (errors.length > 0) return errors;
  const accepted = receipt.status === "accepted";
  if (receipt.packageBaseSha !== manifest.reconciledBase)
    errors.push(`packageBaseSha must equal reconciledBase ${manifest.reconciledBase}`);
  try {
    if (receipt.packageHash !== packageHashFromCommit(receipt.packageVariant, receipt.packageHeadSha))
      errors.push("packageHash does not match package blobs at packageHeadSha");
  } catch (error) {
    errors.push(`package verification failed: ${error.message}`);
  }
  if (!isAncestor(receipt.packageBaseSha, receipt.packageHeadSha))
    errors.push("packageBaseSha is not an ancestor of packageHeadSha");
  if (!isAncestor(receipt.packageHeadSha, receipt.programmeImplementationBase))
    errors.push("packageHeadSha is not an ancestor of programmeImplementationBase");
  errors.push(
    ...finalReviewRoutingErrors(
      receipt.finalReviewRouting,
      manifest.defaultAgentPolicy.phaseReviewModel,
      manifest.defaultAgentPolicy.finalReviewReasoning,
    ),
  );
  if (receipt.finalReviewRouting?.routeEvidence) {
    validateRouteEvidenceArtifact(
      receipt.finalReviewRouting.routeEvidence,
      receipt.finalReviewRouting,
      "programme/final-review-route",
      errors,
      requireTracked,
      "artifactPath",
    );
  }
  if (accepted) {
    const requiredPhases = manifest.phases.filter((phase) => phase.phaseType !== "operator-gate");
    const priorAgentIds = new Set();
    const acceptedPhaseResults = new Map();
    let programmeBase = null;
    let p00Receipt = null;
    for (const phase of requiredPhases) {
      const result = validateRequiredReceipt(phase.id, receipt.finalHeadSha, errors);
      if (!result) continue;
      if (phase.executionPredecessor) {
        errors.push(
          ...predecessorStartErrors(
            result.receipt.phaseStartSha,
            acceptedPhaseResults.get(phase.executionPredecessor)?.commit,
            phase.id,
          ),
        );
      }
      acceptedPhaseResults.set(phase.id, result);
      if (phase.id === "P00") p00Receipt = result.receipt;
      programmeBase ??= result.receipt.programmeImplementationBase;
      if (result.receipt.programmeImplementationBase !== programmeBase)
        errors.push(`${phase.id}: programmeImplementationBase differs from earlier receipts`);
      const controllerId = result.receipt.controllerRouting?.agentId;
      if (priorAgentIds.has(controllerId)) errors.push(`${phase.id}: controller agent was reused`);
      if (controllerId) priorAgentIds.add(controllerId);
      for (const capability of result.receipt.capabilityEvidence ?? []) {
        const probeAgentId = capability.probeAgentId;
        if (probeAgentId && priorAgentIds.has(probeAgentId)) {
          errors.push(`${phase.id}: capability probe agent was reused`);
        }
        if (probeAgentId) priorAgentIds.add(probeAgentId);
      }
      for (const task of result.receipt.tasks) {
        if (priorAgentIds.has(task.implementerRouting?.agentId))
          errors.push(`${task.globalTaskKey}: implementer agent was reused across phases`);
        priorAgentIds.add(task.implementerRouting?.agentId);
        const taskReviewerId = task.reviews[0]?.reviewerRouting?.agentId;
        if (taskReviewerId && priorAgentIds.has(taskReviewerId))
          errors.push(`${task.globalTaskKey}: reviewer agent was reused across tasks/phases`);
        if (taskReviewerId) priorAgentIds.add(taskReviewerId);
      }
      const phaseReviewerId = result.receipt.phaseReviews[0]?.reviewerRouting?.agentId;
      if (phaseReviewerId && priorAgentIds.has(phaseReviewerId))
        errors.push(`${phase.id}: phase reviewer agent was reused`);
      if (phaseReviewerId) priorAgentIds.add(phaseReviewerId);
    }
    if (receipt.programmeImplementationBase !== programmeBase)
      errors.push("programmeImplementationBase differs from phase receipts");
    if (p00Receipt && programmeBase !== p00Receipt.phaseStartSha)
      errors.push("programmeImplementationBase must equal P00.phaseStartSha");
    if (p00Receipt) {
      for (const phase of requiredPhases) {
        if (!existsSync(receiptPath(phase.id))) continue;
        const phaseReceipt = readJson(receiptPath(phase.id));
        packageIdentityDiff(phaseReceipt, p00Receipt, phase.id, errors);
      }
      packageIdentityDiff(receipt, p00Receipt, "programme", errors);
    }
    validateAcceptedHistoryContinuity([...acceptedPhaseResults.values()], errors);
    errors.push(...programmeFinalHeadErrors(receipt.finalHeadSha, acceptedPhaseResults.get("P17")?.commit));
    validateReviewHistory(
      receipt.reviews,
      receipt.programmeImplementationBase,
      receipt.finalHeadSha,
      "programme",
      priorAgentIds,
      errors,
      requireTracked,
    );
    const programmeReviewerIds = new Set(receipt.reviews.map((review) => review.reviewerAgentId));
    if (programmeReviewerIds.size !== 1) errors.push("programme attempts must use one fresh final reviewer");
    if (!programmeReviewerIds.has(receipt.finalReviewRouting?.agentId)) {
      errors.push("programme finalReviewRouting agentId must match the fresh final reviewer");
    }
    errors.push(...programmeVerificationErrors(receipt.verificationEvidence, manifest.offlineCompletionCommands ?? []));
    errors.push(
      ...requiredResidualGateErrors(
        receipt.residualGates,
        (manifest.requiredResidualGates ?? []).map((gate) => gate.id),
      ),
    );
    if (!receipt.acceptedAt) errors.push("accepted programme requires acceptedAt");
  }
  return errors;
}

const connectedReceiptRoot = join(receiptRoot, "local");

function connectedReceiptPath(phaseId) {
  return join(connectedReceiptRoot, `${phaseId}.json`);
}

function validateLocalRouting(routing, expectedReasoning, label, errors, requireTracked) {
  if (!routing) return;
  if (routing.runtimeHost !== "codex-desktop" || routing.provider !== "codex") {
    errors.push(`${label}: local execution requires Codex Desktop routing`);
  }
  if (routing.plannedModel !== "gpt-5.6-sol" || routing.actualModel !== "gpt-5.6-sol") {
    errors.push(`${label}: local execution requires exact gpt-5.6-sol routing`);
  }
  if (routing.plannedReasoning !== expectedReasoning || routing.actualReasoning !== expectedReasoning) {
    errors.push(`${label}: reasoning must be ${expectedReasoning}`);
  }
  if (routing.fallbackUsed !== false) errors.push(`${label}: fallbackUsed must remain false`);
  const evidence = routing.routeEvidence;
  if (!evidence || !manifest.capabilityContract.routeEvidenceSources.includes(evidence.source)) {
    errors.push(`${label}: authoritative route evidence is required`);
  } else {
    validateRouteEvidenceArtifact(evidence, routing, `${label}/route`, errors, requireTracked, "path");
  }
}

function programmeReceiptIdentity(errors, requireTracked = false) {
  const path = join(receiptRoot, "PROGRAMME.json");
  if (!existsSync(path)) {
    errors.push("local execution requires accepted PROGRAMME.json");
    return null;
  }
  const receipt = readWorkingOrHeadJson(path, errors, requireTracked);
  if (!receipt) return null;
  if (receipt.status !== "accepted") errors.push("local execution requires accepted PROGRAMME.json status");
  const commit = receiptCommit(path);
  const relativePath = relative(repositoryRoot, path).split(sep).join("/");
  let bytes;
  try {
    bytes = requireTracked ? Buffer.from(runGit(["show", `HEAD:${relativePath}`])) : readFileSync(path);
  } catch {
    errors.push(`${relativePath}: programme receipt bytes are unavailable${requireTracked ? " at HEAD" : ""}`);
    return null;
  }
  return {
    path: relativePath,
    receipt,
    commit,
    sha256: sha256(bytes),
  };
}

function connectedAgentIds(receipt) {
  return new Set([receipt.controllerRouting?.agentId, receipt.reviewerRouting?.agentId].filter(Boolean));
}

function validateConnectedAgentHistory(receipts, errors, candidate = null) {
  const reserved = new Set();
  for (const receipt of receipts) {
    for (const agentId of connectedAgentIds(receipt)) {
      if (reserved.has(agentId)) errors.push(`${receipt.phaseId}: local controller/reviewer agent was reused`);
      reserved.add(agentId);
    }
  }
  if (candidate) {
    for (const agentId of connectedAgentIds(candidate)) {
      if (reserved.has(agentId))
        errors.push(`${candidate.phaseId}: agent ${agentId} was reused from prior local history`);
    }
  }
  return reserved;
}

function expectedRemainingGates(phaseId) {
  const phaseIndex = manifest.localPhases.findIndex((phase) => phase.id === phaseId);
  const closed = new Set(
    manifest.localPhases
      .slice(0, phaseIndex + 1)
      .map((phase) => phase.closesGate)
      .filter(Boolean),
  );
  return manifest.requiredResidualGates.map((gate) => gate.id).filter((gateId) => !closed.has(gateId));
}

function validateConnectedReceipt(receipt, expectedPhaseId = null, requireTracked = false) {
  const errors = validateJsonSchema(receipt, connectedPhaseSchema);
  if (errors.length > 0) return errors;
  const phase = manifest.localPhases.find((candidate) => candidate.id === receipt.phaseId);
  const accepted = receipt.status === "accepted";
  if (!phase) return [...errors, `unknown local phaseId ${receipt.phaseId ?? "(missing)"}`];
  if (expectedPhaseId && receipt.phaseId !== expectedPhaseId) errors.push(`expected local phase ${expectedPhaseId}`);
  if (receipt.executionPredecessor !== phase.executionPredecessor) {
    errors.push(`${phase.id}: executionPredecessor must be ${phase.executionPredecessor ?? "null"}`);
  }
  if (receipt.closesGate !== phase.closesGate) errors.push(`${phase.id}: closesGate must match the manifest`);
  const expectedRemaining = expectedRemainingGates(phase.id);
  if (JSON.stringify(receipt.remainingResidualGates) !== JSON.stringify(expectedRemaining)) {
    errors.push(`${phase.id}: remainingResidualGates must preserve the exact manifest closure order`);
  }
  validateLocalRouting(
    receipt.controllerRouting,
    phase.controllerReasoning,
    `${phase.id}/controller`,
    errors,
    requireTracked,
  );
  validateLocalRouting(receipt.reviewerRouting, phase.reviewReasoning, `${phase.id}/reviewer`, errors, requireTracked);
  if (receipt.controllerRouting?.agentId === receipt.reviewerRouting?.agentId) {
    errors.push(`${phase.id}: reviewer must be fresh and distinct from controller`);
  }
  validateFullRangeReview(
    receipt.phaseReview,
    receipt.phaseStartSha,
    receipt.phaseEndSha,
    receipt.reviewerRouting?.agentId,
    `${phase.id}/phase-review`,
    errors,
    requireTracked,
    accepted,
  );
  const capabilityNames = new Set((receipt.capabilityEvidence ?? []).map((item) => item.capability));
  for (const skill of phase.skills) {
    if (!capabilityNames.has(skill)) errors.push(`${phase.id}: missing capability evidence for ${skill}`);
  }
  validateCapabilityEvidence(receipt.capabilityEvidence, `${phase.id}/capabilities`, errors, requireTracked);
  const programme = programmeReceiptIdentity(errors, requireTracked);
  if (programme) {
    const binding = receipt.offlineProgrammeBinding;
    if (binding.programmeReceiptPath !== programme.path) errors.push(`${phase.id}: programme receipt path mismatch`);
    if (binding.programmeReceiptSha256 !== programme.sha256)
      errors.push(`${phase.id}: programme receipt hash mismatch`);
    if (binding.programmeReceiptCommit !== programme.commit)
      errors.push(`${phase.id}: programme receipt commit mismatch`);
    if (binding.packageHash !== programme.receipt.packageHash) errors.push(`${phase.id}: package hash mismatch`);
    if (binding.remoteTipSha !== programme.commit)
      errors.push(`${phase.id}: remote tip must equal PROGRAMME.json commit`);
    if (phase.id === "L00" && receipt.phaseStartSha !== programme.commit) {
      errors.push("L00: phaseStartSha must equal the atomic PROGRAMME.json commit");
    }
  }
  if (phase.executionPredecessor) {
    const predecessorPath = connectedReceiptPath(phase.executionPredecessor);
    if (!existsSync(predecessorPath)) errors.push(`${phase.id}: predecessor receipt is missing`);
    else {
      const predecessorCommit = receiptCommit(predecessorPath);
      if (receipt.phaseStartSha !== predecessorCommit) {
        errors.push(`${phase.id}: phaseStartSha must equal predecessor local receipt commit`);
      }
    }
  }
  if (accepted) {
    if (receipt.decision !== "GO") errors.push(`${phase.id}: accepted receipt requires GO`);
    if (!receipt.completedAt || !receipt.acceptedAt) errors.push(`${phase.id}: accepted receipt requires timestamps`);
    if (!isAncestor(receipt.phaseStartSha, receipt.phaseEndSha)) {
      errors.push(`${phase.id}: phaseEndSha must descend from phaseStartSha`);
    }
    if (receipt.capabilityEvidence.length === 0 || receipt.evidenceArtifacts.length === 0) {
      errors.push(`${phase.id}: accepted receipt requires capability and tracked evidence`);
    }
    if (phase.id !== "L00" && (receipt.approvals.length === 0 || receipt.operations.length === 0)) {
      errors.push(`${phase.id}: accepted connected phase requires approval-bound operations`);
    }
    errors.push(
      ...connectedOperationAcceptanceErrors(
        phase.id,
        phase.requiredOperationClasses,
        receipt.approvals,
        receipt.operations,
        receipt.acceptedAt,
      ),
    );
  }
  for (const artifact of receipt.evidenceArtifacts) {
    validateArtifact(artifact.path, artifact.sha256, `${phase.id}/evidence`, errors, requireTracked);
    if (accepted)
      validateArtifactAtCommit(artifact.path, artifact.sha256, receipt.phaseEndSha, `${phase.id}/evidence`, errors);
  }
  return errors;
}

function validateOperationalReceipt(receipt, requireTracked = false) {
  const errors = validateJsonSchema(receipt, operationalSchema);
  if (errors.length > 0) return errors;
  const programme = programmeReceiptIdentity(errors, requireTracked);
  const localReceipts = [];
  let l10Commit = null;
  for (const phase of manifest.localPhases) {
    const path = connectedReceiptPath(phase.id);
    if (!existsSync(path)) {
      errors.push(`operational acceptance requires ${phase.id} receipt`);
      continue;
    }
    const local = readWorkingOrHeadJson(path, errors, requireTracked);
    if (!local) continue;
    localReceipts.push(local);
    errors.push(...validateConnectedReceipt(local, phase.id, requireTracked).map((error) => `${phase.id}: ${error}`));
    if (local.status !== "accepted" || local.decision !== "GO") {
      errors.push(`operational acceptance requires accepted GO ${phase.id}`);
    }
    if (phase.id === "L10") {
      l10Commit = receiptCommit(path);
      if (local.remainingResidualGates.length !== 0) {
        errors.push("operational acceptance requires L10 with no residual gates");
      }
    }
  }
  const reservedAgents = validateConnectedAgentHistory(localReceipts, errors);
  validateLocalRouting(receipt.finalReviewRouting, "xhigh", "operational/final-reviewer", errors, requireTracked);
  if (reservedAgents.has(receipt.finalReviewRouting?.agentId)) {
    errors.push("operational final reviewer must be fresh across the complete local programme");
  }
  if (programme) {
    if (receipt.offlineProgrammeCommit !== programme.commit) errors.push("operational offlineProgrammeCommit mismatch");
    if (receipt.phaseStartSha !== programme.commit)
      errors.push("operational phaseStartSha must equal PROGRAMME commit");
  }
  if (l10Commit) {
    if (receipt.finalLocalReceiptCommit !== l10Commit) errors.push("operational finalLocalReceiptCommit mismatch");
    if (receipt.phaseEndSha !== l10Commit)
      errors.push("operational phaseEndSha must equal accepted L10 receipt commit");
  }
  validateFullRangeReview(
    receipt.review,
    receipt.phaseStartSha,
    receipt.phaseEndSha,
    receipt.finalReviewRouting?.agentId,
    "operational/full-review",
    errors,
    requireTracked,
    receipt.status === "accepted",
  );
  if (receipt.status === "accepted") {
    if (!receipt.acceptedAt) errors.push("accepted OPERATIONAL.json requires acceptedAt");
  }
  return errors;
}

const printVariant = argument("--print-package-hash");
if (printVariant) {
  if (!["local", "cloud"].includes(printVariant)) {
    console.error("--print-package-hash must be local or cloud");
    process.exit(2);
  }
  const at = argument("--at");
  console.log(at ? packageHashFromCommit(printVariant, at) : packageHashFromWorktree(printVariant));
  process.exit(0);
}

const artifactToHash = argument("--print-artifact-hash");
if (artifactToHash) {
  const path = resolve(repositoryRoot, artifactToHash);
  if (!existsSync(path)) {
    console.error(`artifact does not exist: ${artifactToHash}`);
    process.exit(2);
  }
  console.log(sha256(readFileSync(path)));
  process.exit(0);
}

const writeReviewIndex = process.argv.indexOf("--write-review-package");
if (writeReviewIndex !== -1) {
  const [base, head, output] = process.argv.slice(writeReviewIndex + 1, writeReviewIndex + 4);
  if (!shaPattern.test(base ?? "") || !shaPattern.test(head ?? "") || !output) {
    console.error("--write-review-package requires literal 40-character BASE HEAD and repository-relative OUT");
    process.exit(2);
  }
  const outputPath = resolve(repositoryRoot, output);
  const artifactPrefix = `${resolve(artifactRoot)}${sep}`;
  if (!outputPath.startsWith(artifactPrefix) || !outputPath.endsWith(".diff")) {
    console.error(`review package OUT must be a .diff file below ${relative(repositoryRoot, artifactRoot)}`);
    process.exit(2);
  }
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, reviewPackageBytes(base, head));
  console.log(
    `${relative(repositoryRoot, outputPath).split(sep).join("/")}: canonical full-range review package written`,
  );
  process.exit(0);
}

const errors = [];
const messages = [];
const phaseTemplatePath = join(canonicalRoot, "phase-receipt.template.json");
const programmeTemplatePath = join(canonicalRoot, "programme-receipt.template.json");
const connectedTemplatePath = join(canonicalRoot, "connected-phase-receipt.template.json");
const operationalTemplatePath = join(canonicalRoot, "operational-receipt.template.json");
errors.push(...validateJsonSchema(readJson(phaseTemplatePath), phaseSchema).map((error) => `phase template: ${error}`));
errors.push(
  ...validateJsonSchema(readJson(programmeTemplatePath), programmeSchema).map(
    (error) => `programme template: ${error}`,
  ),
);
errors.push(
  ...validateJsonSchema(readJson(connectedTemplatePath), connectedPhaseSchema).map(
    (error) => `connected phase template: ${error}`,
  ),
);
errors.push(
  ...validateJsonSchema(readJson(operationalTemplatePath), operationalSchema).map(
    (error) => `operational template: ${error}`,
  ),
);

const explicitReceipt = argument("--receipt");
if (explicitReceipt) {
  const path = resolve(repositoryRoot, explicitReceipt);
  if (!existsSync(path)) errors.push(`receipt does not exist: ${explicitReceipt}`);
  else {
    const requireTracked = process.argv.includes("--require-tracked");
    const receipt = readJson(path);
    errors.push(...validatePhaseReceipt(receipt, null, requireTracked));
    if (requireTracked) validateTrackedReceipt(path, errors);
    if (receipt.phaseId !== "P00" && existsSync(receiptPath("P00"))) {
      const p00 = readJson(receiptPath("P00"));
      packageIdentityDiff(receipt, p00, receipt.phaseId, errors);
    }
  }
}

const explicitConnectedReceipt = argument("--connected");
if (explicitConnectedReceipt) {
  const path = resolve(repositoryRoot, explicitConnectedReceipt);
  if (!existsSync(path)) errors.push(`connected receipt does not exist: ${explicitConnectedReceipt}`);
  else {
    const requireTracked = process.argv.includes("--require-tracked");
    const receipt = readJson(path);
    errors.push(...validateConnectedReceipt(receipt, null, requireTracked));
    if (requireTracked) validateTrackedReceipt(path, errors);
  }
}

const beforePhaseId = argument("--before");
if (beforePhaseId) {
  const phase = manifest.phases.find((candidate) => candidate.id === beforePhaseId);
  if (!phase) errors.push(`unknown --before phase ${beforePhaseId}`);
  else {
    const currentHead = runGit(["rev-parse", "HEAD"]).trim();
    const required = [...new Set([phase.executionPredecessor, ...phase.dependsOn].filter(Boolean))];
    const allPriorResults =
      beforePhaseId === "P00" ? [] : validatePriorPhaseReceipts(beforePhaseId, currentHead, errors);
    validatePriorAgentHistory(allPriorResults, errors);
    if (allPriorResults.length > 0) validateAcceptedHistoryContinuity(allPriorResults, errors);
    const results = required
      .map((phaseId) => allPriorResults.find((result) => result.receipt.phaseId === phaseId))
      .filter(Boolean);
    for (const requiredPhaseId of required) {
      if (!results.some((result) => result.receipt.phaseId === requiredPhaseId))
        errors.push(`${beforePhaseId}: required receipt ${requiredPhaseId} was not validated`);
    }
    const predecessor = results.find((result) => result.receipt.phaseId === phase.executionPredecessor);
    if (predecessor && currentHead !== predecessor.commit)
      errors.push(`${beforePhaseId}: current HEAD must equal the execution-predecessor receipt commit`);
    if (
      predecessor &&
      results.some(
        (result) => result.receipt.programmeImplementationBase !== predecessor.receipt.programmeImplementationBase,
      )
    ) {
      errors.push(`${beforePhaseId}: prerequisite receipts disagree on programmeImplementationBase`);
    }
    if (beforePhaseId !== "P00") {
      const p00 = allPriorResults.find((result) => result.receipt.phaseId === "P00");
      if (p00 && predecessor) {
        packageIdentityDiff(predecessor.receipt, p00.receipt, `${beforePhaseId}: predecessor`, errors);
      }
      const reserved = [...priorAgentIds(allPriorResults)].sort();
      messages.push(`${beforePhaseId}: reserved prior agent IDs: ${reserved.join(", ") || "none"}`);
    }
  }
}

const beforeLocalPhaseId = argument("--before-local");
if (beforeLocalPhaseId) {
  const phaseIndex = manifest.localPhases.findIndex((phase) => phase.id === beforeLocalPhaseId);
  if (phaseIndex === -1) errors.push(`unknown --before-local phase ${beforeLocalPhaseId}`);
  else {
    const currentHead = runGit(["rev-parse", "HEAD"]).trim();
    const programme = programmeReceiptIdentity(errors, true);
    if (programme) {
      errors.push(...validateProgrammeReceipt(programme.receipt, true).map((error) => `PROGRAMME: ${error}`));
    }
    const priorLocalReceipts = [];
    for (const phase of manifest.localPhases.slice(0, phaseIndex)) {
      const path = connectedReceiptPath(phase.id);
      if (!existsSync(path)) errors.push(`${beforeLocalPhaseId}: missing accepted local receipt ${phase.id}`);
      else {
        const receipt = readWorkingOrHeadJson(path, errors, true);
        if (!receipt) continue;
        priorLocalReceipts.push(receipt);
        errors.push(...validateConnectedReceipt(receipt, phase.id, true).map((error) => `${phase.id}: ${error}`));
        if (receipt.status !== "accepted" || receipt.decision !== "GO") {
          errors.push(`${beforeLocalPhaseId}: predecessor ${phase.id} is not accepted GO`);
        }
      }
    }
    validateConnectedAgentHistory(priorLocalReceipts, errors);
    const predecessorPath = phaseIndex === 0 ? null : connectedReceiptPath(manifest.localPhases[phaseIndex - 1].id);
    const expectedHead =
      phaseIndex === 0 ? programme?.commit : existsSync(predecessorPath) ? receiptCommit(predecessorPath) : null;
    if (expectedHead && currentHead !== expectedHead) {
      errors.push(`${beforeLocalPhaseId}: current HEAD must equal the exact predecessor metadata commit`);
    }
  }
}

const acceptPhaseId = argument("--accept-phase");
if (acceptPhaseId) {
  const currentHead = runGit(["rev-parse", "HEAD"]).trim();
  const result = validateRequiredReceipt(acceptPhaseId, currentHead, errors);
  if (result && result.commit !== currentHead) {
    errors.push(`${acceptPhaseId}: current HEAD must equal the atomic accepted-receipt commit`);
  }
  if (result && acceptPhaseId !== "P00") {
    const allPriorResults = validatePriorPhaseReceipts(acceptPhaseId, currentHead, errors);
    validatePriorAgentHistory(allPriorResults, errors);
    validateAcceptedHistoryContinuity(allPriorResults, errors);
    const p00 = allPriorResults.find((prior) => prior.receipt.phaseId === "P00");
    const phase = manifest.phases.find((candidate) => candidate.id === acceptPhaseId);
    const predecessor = allPriorResults.find((prior) => prior.receipt.phaseId === phase?.executionPredecessor);
    errors.push(...predecessorStartErrors(result.receipt.phaseStartSha, predecessor?.commit, acceptPhaseId));
    if (p00) {
      errors.push(
        ...phaseAcceptanceContinuityErrors(
          result.receipt,
          p00.receipt,
          agentIdsFromReceipt(result.receipt),
          priorAgentIds(allPriorResults),
          acceptPhaseId,
        ),
      );
    }
  }
}

const acceptLocalPhaseId = argument("--accept-local-phase");
if (acceptLocalPhaseId) {
  const path = connectedReceiptPath(acceptLocalPhaseId);
  if (!existsSync(path)) errors.push(`${acceptLocalPhaseId}: connected receipt does not exist`);
  else {
    const receipt = readJson(path);
    errors.push(...validateConnectedReceipt(receipt, acceptLocalPhaseId, true));
    if (receipt.status !== "accepted" || receipt.decision !== "GO") {
      errors.push(`${acceptLocalPhaseId}: acceptance requires accepted GO`);
    }
    const phaseIndex = manifest.localPhases.findIndex((phase) => phase.id === acceptLocalPhaseId);
    const priorLocalReceipts = [];
    for (const phase of manifest.localPhases.slice(0, Math.max(phaseIndex, 0))) {
      const priorPath = connectedReceiptPath(phase.id);
      if (!existsSync(priorPath)) continue;
      const prior = readWorkingOrHeadJson(priorPath, errors, true);
      if (prior) priorLocalReceipts.push(prior);
    }
    validateConnectedAgentHistory(priorLocalReceipts, errors, receipt);
    validateTrackedReceipt(path, errors);
    const commit = receiptCommit(path);
    if (commit !== runGit(["rev-parse", "HEAD"]).trim()) {
      errors.push(`${acceptLocalPhaseId}: current HEAD must equal the atomic connected-receipt commit`);
    }
    if (shaPattern.test(commit)) {
      const relativePath = relative(repositoryRoot, path).split(sep).join("/");
      validateAtomicMetadataCommit(
        receipt.phaseEndSha,
        commit,
        relativePath,
        connectedMetadataPaths(receipt, relativePath),
        acceptLocalPhaseId,
        errors,
      );
    }
  }
}

const resumePhaseId = argument("--resume");
if (resumePhaseId) {
  const path = receiptPath(resumePhaseId);
  if (!existsSync(path)) errors.push(`${resumePhaseId}: draft receipt does not exist`);
  else {
    const receipt = readJson(path);
    errors.push(...validatePhaseReceipt(receipt, resumePhaseId, false).map((error) => `${resumePhaseId}: ${error}`));
    const phase = manifest.phases.find((candidate) => candidate.id === resumePhaseId);
    const currentHead = runGit(["rev-parse", "HEAD"]).trim();
    errors.push(...resumeStateErrors(receipt, expectedTaskKeys(phase), currentHead));
    if (resumePhaseId !== "P00") {
      const allPriorResults = validatePriorPhaseReceipts(resumePhaseId, currentHead, errors);
      validatePriorAgentHistory(allPriorResults, errors);
      validateAcceptedHistoryContinuity(allPriorResults, errors);
      const p00 = allPriorResults.find((result) => result.receipt.phaseId === "P00");
      if (p00) packageIdentityDiff(receipt, p00.receipt, resumePhaseId, errors);
      const phasePredecessor = allPriorResults.find((result) => result.receipt.phaseId === phase?.executionPredecessor);
      errors.push(...predecessorStartErrors(receipt.phaseStartSha, phasePredecessor?.commit, resumePhaseId));
      const reserved = priorAgentIds(allPriorResults);
      errors.push(...agentReuseErrors(agentIdsFromReceipt(receipt), reserved, resumePhaseId));
      messages.push(`${resumePhaseId}: reserved prior agent IDs: ${[...reserved].sort().join(", ") || "none"}`);
    }
  }
}

const acceptedProgrammePath = argument("--accept-programme");
const programmeReceiptPath = argument("--programme") ?? acceptedProgrammePath;
if (programmeReceiptPath) {
  const path = resolve(repositoryRoot, programmeReceiptPath);
  const expectedPath = join(receiptRoot, "PROGRAMME.json");
  if (path !== expectedPath) errors.push(`programme receipt must use ${relative(repositoryRoot, expectedPath)}`);
  if (!existsSync(path)) errors.push(`programme receipt does not exist: ${programmeReceiptPath}`);
  else {
    const receipt = readJson(path);
    if (acceptedProgrammePath) errors.push(...acceptanceStatusErrors(receipt.status, "programme"));
    const requireTracked = process.argv.includes("--require-tracked") || Boolean(acceptedProgrammePath);
    errors.push(...validateProgrammeReceipt(receipt, requireTracked));
    if (requireTracked) {
      validateTrackedReceipt(path, errors);
      const commit = receiptCommit(path);
      if (!shaPattern.test(commit) || !isAncestor(receipt.finalHeadSha, commit))
        errors.push("programme receipt commit must descend from finalHeadSha");
      if (shaPattern.test(commit)) {
        const relativePath = relative(repositoryRoot, path).split(sep).join("/");
        validateAtomicMetadataCommit(
          receipt.finalHeadSha,
          commit,
          relativePath,
          programmeMetadataPaths(receipt, relativePath),
          "programme",
          errors,
        );
        if (acceptedProgrammePath && commit !== runGit(["rev-parse", "HEAD"]).trim()) {
          errors.push("programme: current HEAD must equal the atomic accepted-receipt commit");
        }
      }
    }
  }
}

const acceptedOperationalPath = argument("--accept-operational");
const operationalReceiptPath = argument("--operational") ?? acceptedOperationalPath;
if (operationalReceiptPath) {
  const path = resolve(repositoryRoot, operationalReceiptPath);
  const expectedPath = join(connectedReceiptRoot, "OPERATIONAL.json");
  if (path !== expectedPath) errors.push(`operational receipt must use ${relative(repositoryRoot, expectedPath)}`);
  if (!existsSync(path)) errors.push(`operational receipt does not exist: ${operationalReceiptPath}`);
  else {
    const receipt = readJson(path);
    if (acceptedOperationalPath && receipt.status !== "accepted") {
      errors.push("operational acceptance requires status accepted");
    }
    const requireTracked = process.argv.includes("--require-tracked") || Boolean(acceptedOperationalPath);
    errors.push(...validateOperationalReceipt(receipt, requireTracked));
    if (requireTracked) validateTrackedReceipt(path, errors);
    if (acceptedOperationalPath) {
      const commit = receiptCommit(path);
      if (commit !== runGit(["rev-parse", "HEAD"]).trim()) {
        errors.push("operational: current HEAD must equal the atomic OPERATIONAL.json commit");
      }
      if (shaPattern.test(commit) && shaPattern.test(receipt.finalLocalReceiptCommit)) {
        const relativePath = relative(repositoryRoot, path).split(sep).join("/");
        validateAtomicMetadataCommit(
          receipt.finalLocalReceiptCommit,
          commit,
          relativePath,
          operationalMetadataPaths(receipt, relativePath),
          "operational",
          errors,
        );
      }
    }
  }
}

if (errors.length > 0) {
  console.error("RAG execution receipt validation failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

for (const message of messages) console.log(message);
console.log("RAG execution receipt schemas and requested evidence validated.");
