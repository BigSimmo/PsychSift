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
  packageIdentityErrors,
  phaseAcceptanceContinuityErrors,
  predecessorStartErrors,
  finalReviewRoutingErrors,
  programmeFinalHeadErrors,
  p00AnchorErrors,
  programmeVerificationErrors,
  resumeStateErrors,
  reviewPackageEvidenceErrors,
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
const phaseSchema = readJson(join(canonicalRoot, "phase-receipt.schema.json"));
const programmeSchema = readJson(join(canonicalRoot, "programme-receipt.schema.json"));
const verificationMatrix = readJson(join(canonicalRoot, "task-verification-matrix.json"));
const shaPattern = /^[0-9a-f]{40}$/;

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
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

function patchId(bytes) {
  const output = execFileSync("git", ["patch-id", "--stable"], {
    cwd: repositoryRoot,
    input: bytes,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "ignore"],
  }).trim();
  return output.split(/\s+/)[0] || "EMPTY";
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
  for (const task of receipt.tasks ?? []) {
    ids.add(task.implementerAgentId);
    for (const review of task.reviews ?? []) ids.add(review.reviewerAgentId);
  }
  for (const review of receipt.phaseReviews ?? []) ids.add(review.reviewerAgentId);
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

function validateModelRouting(receipt, phase, errors) {
  const routing = receipt.modelRouting;
  const plannedImplementationModel = phase.implementationModel ?? manifest.defaultAgentPolicy.implementationModel;
  const plannedReviewModel = phase.reviewModel ?? manifest.defaultAgentPolicy.reviewModel;
  const implementationReasoning = phase.implementationReasoning ?? manifest.defaultAgentPolicy.implementationReasoning;
  const reviewReasoning = phase.reviewReasoning ?? manifest.defaultAgentPolicy.reviewReasoning;
  if (routing.plannedImplementationModel !== plannedImplementationModel)
    errors.push(`plannedImplementationModel must be ${plannedImplementationModel}`);
  if (routing.plannedReviewModel !== plannedReviewModel)
    errors.push(`plannedReviewModel must be ${plannedReviewModel}`);
  if (routing.implementationReasoning !== implementationReasoning)
    errors.push(`implementationReasoning must be ${implementationReasoning}`);
  if (routing.reviewReasoning !== reviewReasoning) errors.push(`reviewReasoning must be ${reviewReasoning}`);
  if (routing.fallbackUsed !== false) errors.push("fallbackUsed must remain false");
  if (routing.provider === "codex") {
    if (routing.providerMappingUsed) errors.push("Codex routing cannot claim a provider mapping");
    const exact = routing.actualImplementationModel === plannedImplementationModel;
    const allowedEscalation =
      plannedImplementationModel === "gpt-5.6-terra" &&
      routing.actualImplementationModel === "gpt-5.6-sol" &&
      routing.implementationCapabilityClass === "frontier-high" &&
      Boolean(routing.escalationReason);
    if (!exact && !allowedEscalation) errors.push("Codex actual implementation model is an unapproved fallback");
    if (
      routing.actualImplementationModel === "gpt-5.6-terra" &&
      routing.implementationCapabilityClass !== "workhorse-high"
    ) {
      errors.push("Codex Terra execution must record workhorse-high capability");
    }
    if (
      routing.actualImplementationModel === "gpt-5.6-sol" &&
      routing.implementationCapabilityClass !== "frontier-high"
    ) {
      errors.push("Codex Sol execution must record frontier-high capability");
    }
    if (routing.actualReviewModel !== plannedReviewModel) errors.push("Codex actual review model must match the plan");
  } else if (!routing.providerMappingUsed) {
    errors.push("Claude routing must record providerMappingUsed=true");
  }
  const requiredImplementationClass = plannedImplementationModel === "gpt-5.6-sol" ? "frontier-high" : "workhorse-high";
  if (
    routing.implementationCapabilityClass !== requiredImplementationClass &&
    !(plannedImplementationModel === "gpt-5.6-terra" && routing.implementationCapabilityClass === "frontier-high")
  ) {
    errors.push(`implementationCapabilityClass cannot satisfy ${plannedImplementationModel}`);
  }
  if (routing.reviewCapabilityClass !== "frontier-high") errors.push("reviewCapabilityClass must be frontier-high");
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
    if (implementerIds.has(review.reviewerAgentId)) errors.push(`${reviewLabel}: reviewer must be fresh and distinct`);
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
            patchId(actualBytes),
            patchId(expectedBytes),
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
  const phase = manifest.phases.find((candidate) => candidate.id === receipt.phaseId);
  const accepted = receipt.status === "accepted";
  if (!phase) return [...errors, `unknown phaseId ${receipt.phaseId ?? "(missing)"}`];
  if (expectedPhaseId && receipt.phaseId !== expectedPhaseId) errors.push(`expected phase ${expectedPhaseId}`);
  if (receipt.executionPredecessor !== phase.executionPredecessor)
    errors.push(`executionPredecessor must be ${phase.executionPredecessor ?? "null"}`);
  if (receipt.packageBaseSha !== manifest.reconciledBase)
    errors.push(`packageBaseSha must equal reconciledBase ${manifest.reconciledBase}`);
  validateModelRouting(receipt, phase, errors);
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

  const phaseAgentIds = new Set();
  for (const [index, task] of receipt.tasks.entries()) {
    const label = `${receipt.phaseId}/tasks/${index}`;
    if (!isAncestor(task.taskBaseSha, task.taskHeadSha)) errors.push(`${label}: task head does not descend from base`);
    const actualCommits = commitList(task.taskBaseSha, task.taskHeadSha);
    if (JSON.stringify(task.commits) !== JSON.stringify(actualCommits))
      errors.push(`${label}: commits must exactly equal git rev-list --reverse taskBase..taskHead`);
    if (phaseAgentIds.has(task.implementerAgentId)) errors.push(`${label}: implementer was already used in this phase`);
    phaseAgentIds.add(task.implementerAgentId);
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
    const thisTaskReviewers = new Set(task.reviews.map((review) => review.reviewerAgentId));
    if (thisTaskReviewers.size !== 1) errors.push(`${label}: all attempts must use the one fresh task reviewer`);
    const taskReviewerId = [...thisTaskReviewers][0];
    if (taskReviewerId) {
      if (phaseAgentIds.has(taskReviewerId)) errors.push(`${label}: task reviewer was already used in this phase`);
      phaseAgentIds.add(taskReviewerId);
    }
  }
  if (accepted) {
    const phaseReviewerIds = new Set(receipt.phaseReviews.map((review) => review.reviewerAgentId));
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

function phaseMetadataPaths(receipt, receiptRelativePath) {
  const paths = new Set([receiptRelativePath]);
  for (const task of receipt.tasks) {
    paths.add(task.briefPath);
    paths.add(task.implementerReportPath);
    for (const review of task.reviews) {
      paths.add(review.diffPackagePath);
      paths.add(review.reportPath);
    }
  }
  for (const review of receipt.phaseReviews) {
    paths.add(review.diffPackagePath);
    paths.add(review.reportPath);
  }
  return [...paths];
}

function programmeMetadataPaths(receipt, receiptRelativePath) {
  const paths = new Set([receiptRelativePath]);
  for (const review of receipt.reviews) {
    paths.add(review.diffPackagePath);
    paths.add(review.reportPath);
  }
  return [...paths];
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
      manifest.defaultAgentPolicy.reviewModel,
      manifest.defaultAgentPolicy.finalReviewReasoning,
    ),
  );
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
      for (const task of result.receipt.tasks) {
        if (priorAgentIds.has(task.implementerAgentId))
          errors.push(`${task.globalTaskKey}: implementer agent was reused across phases`);
        priorAgentIds.add(task.implementerAgentId);
        const taskReviewerId = task.reviews[0]?.reviewerAgentId;
        if (taskReviewerId && priorAgentIds.has(taskReviewerId))
          errors.push(`${task.globalTaskKey}: reviewer agent was reused across tasks/phases`);
        if (taskReviewerId) priorAgentIds.add(taskReviewerId);
      }
      const phaseReviewerId = result.receipt.phaseReviews[0]?.reviewerAgentId;
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
errors.push(...validateJsonSchema(readJson(phaseTemplatePath), phaseSchema).map((error) => `phase template: ${error}`));
errors.push(
  ...validateJsonSchema(readJson(programmeTemplatePath), programmeSchema).map(
    (error) => `programme template: ${error}`,
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

if (errors.length > 0) {
  console.error("RAG execution receipt validation failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

for (const message of messages) console.log(message);
console.log("RAG execution receipt schemas and requested evidence validated.");
