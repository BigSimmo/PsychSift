import { createHash } from "node:crypto";

export function reviewPackageDigest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function packageIdentityErrors(receipt, p00Receipt, label) {
  const errors = [];
  for (const field of ["packageVariant", "packageHash", "packageBaseSha", "packageHeadSha"]) {
    if (receipt[field] !== p00Receipt[field]) {
      errors.push(`${label}: ${field} differs from the immutable P00 package`);
    }
  }
  return errors;
}

export function p00AnchorErrors(receipt) {
  if (
    receipt.programmeImplementationBase !== receipt.phaseStartSha ||
    receipt.phaseStartSha !== receipt.packageHeadSha
  ) {
    return ["P00 requires programmeImplementationBase = phaseStartSha = packageHeadSha"];
  }
  return [];
}

export function taskChainErrors(receipt, expectedKeys, accepted) {
  const errors = [];
  const actualKeys = receipt.tasks.map((task) => task.globalTaskKey);
  if (accepted && JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
    errors.push(`accepted task keys must equal ${expectedKeys.join(", ")}`);
  }
  let expectedBase = receipt.phaseStartSha;
  for (const [index, task] of receipt.tasks.entries()) {
    if (task.taskBaseSha !== expectedBase) {
      errors.push(`${receipt.phaseId}/tasks/${index}: task base must equal preceding accepted head`);
    }
    expectedBase = task.taskHeadSha;
  }
  if (accepted && expectedBase !== receipt.phaseEndSha) errors.push("final task head must equal phaseEndSha");
  return errors;
}

export function resumeStateErrors(receipt, expectedKeys, currentHead) {
  const errors = [];
  if (receipt.status !== "draft") errors.push(`${receipt.phaseId}: --resume requires a draft receipt`);
  const actualKeys = receipt.tasks.map((task) => task.globalTaskKey);
  const expectedPrefix = expectedKeys.slice(0, actualKeys.length);
  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedPrefix)) {
    errors.push(`${receipt.phaseId}: completed tasks are not an exact manifest prefix`);
  }
  const expectedHead = receipt.tasks.at(-1)?.taskHeadSha ?? receipt.phaseStartSha;
  if (currentHead !== expectedHead) {
    errors.push(`${receipt.phaseId}: current HEAD must equal the last completed task head`);
  }
  return errors;
}

export function agentReuseErrors(currentAgentIds, priorAgentIds, label) {
  const errors = [];
  for (const id of currentAgentIds) {
    if (priorAgentIds.has(id)) errors.push(`${label}: agent ${id} was already used by an earlier phase`);
  }
  return errors;
}

export function acceptedHistoryAgentReuseErrors(phases) {
  const errors = [];
  const reserved = new Set();
  for (const phase of phases) {
    errors.push(...agentReuseErrors(phase.agentIds, reserved, phase.label));
    for (const id of phase.agentIds) reserved.add(id);
  }
  return errors;
}

export function acceptedHistoryContinuityErrors(phases) {
  const errors = [];
  const p00 = phases.find((phase) => phase.phaseId === "P00");
  if (!p00) return ["accepted history is missing P00"];
  const byId = new Map(phases.map((phase) => [phase.phaseId, phase]));
  for (const phase of phases) {
    errors.push(...packageIdentityErrors(phase.receipt, p00.receipt, phase.phaseId));
    if (phase.executionPredecessor) {
      errors.push(
        ...predecessorStartErrors(
          phase.receipt.phaseStartSha,
          byId.get(phase.executionPredecessor)?.commit,
          phase.phaseId,
        ),
      );
    }
  }
  return errors;
}

export function phaseAcceptanceContinuityErrors(receipt, p00Receipt, currentAgentIds, priorAgentIds, label) {
  return [
    ...packageIdentityErrors(receipt, p00Receipt, label),
    ...agentReuseErrors(currentAgentIds, priorAgentIds, label),
  ];
}

export function acceptanceStatusErrors(status, label) {
  return status === "accepted" ? [] : [`${label}: acceptance requires status accepted`];
}

export function predecessorStartErrors(phaseStartSha, predecessorReceiptCommit, label) {
  return phaseStartSha === predecessorReceiptCommit
    ? []
    : [`${label}: phaseStartSha must equal the execution-predecessor receipt commit`];
}

export function programmeFinalHeadErrors(finalHeadSha, finalPhaseReceiptCommit) {
  return finalHeadSha === finalPhaseReceiptCommit
    ? []
    : ["programme finalHeadSha must equal the accepted P17 receipt commit"];
}

export function finalReviewRoutingErrors(routing, plannedModel, plannedReasoning) {
  if (!routing) return ["programme finalReviewRouting is required"];
  const errors = [];
  if (routing.plannedModel !== plannedModel) errors.push(`final review plannedModel must be ${plannedModel}`);
  if (routing.plannedReasoning !== plannedReasoning)
    errors.push(`final review plannedReasoning must be ${plannedReasoning}`);
  if (routing.actualReasoning !== plannedReasoning)
    errors.push(`final review actualReasoning must be ${plannedReasoning}`);
  if (routing.capabilityClass !== "frontier-high") errors.push("final review capability must be frontier-high");
  if (routing.fallbackUsed !== false) errors.push("final review fallbackUsed must remain false");
  if (routing.escalationUsed !== false) errors.push("final review escalationUsed must remain false");
  if (routing.runtimeHost !== "codex-cloud") errors.push("final review runtimeHost must be codex-cloud");
  if (routing.provider !== "codex") errors.push("final review provider must be codex");
  if (routing.providerMappingUsed) errors.push("Codex final review cannot claim a provider mapping");
  if (routing.actualModel !== plannedModel) errors.push("Codex final review actual model must match the plan");
  if (
    !routing.routeEvidence ||
    !["codex-host-runtime-metadata", "codex-dispatch-metadata"].includes(routing.routeEvidence.source)
  ) {
    errors.push("final review requires authoritative route evidence");
  }
  return errors;
}

export function requiredResidualGateErrors(residualGates, requiredGateIds) {
  const actual = residualGates.map((gate) => gate.gateId);
  const missing = requiredGateIds.filter((gateId) => !actual.includes(gateId));
  const unexpected = actual.filter((gateId) => !requiredGateIds.includes(gateId));
  const duplicates = actual.filter((gateId, index) => actual.indexOf(gateId) !== index);
  const errors = missing.map((gateId) => `programme residualGates is missing ${gateId}`);
  if (unexpected.length > 0)
    errors.push(`programme residualGates has unexpected IDs: ${[...new Set(unexpected)].join(", ")}`);
  if (duplicates.length > 0)
    errors.push(`programme residualGates has duplicate IDs: ${[...new Set(duplicates)].join(", ")}`);
  return errors;
}

export function verificationOnlyEvidenceErrors(globalTaskKey, evidence, contract) {
  const errors = [];
  if (
    !evidence.precondition.some(
      (item) =>
        item.command === contract.preCommand &&
        item.expected === contract.preExpected &&
        ["passed", "reused"].includes(item.outcome),
    )
  ) {
    errors.push(`${globalTaskKey}: verification precondition command or expected result differs from the matrix`);
  }
  for (const acceptance of contract.acceptanceCommands) {
    if (
      !evidence.acceptance.some(
        (item) =>
          item.command === acceptance.command &&
          item.expected === acceptance.expected &&
          ["passed", "reused"].includes(item.outcome),
      )
    ) {
      errors.push(`${globalTaskKey}: missing acceptance evidence ${acceptance.command}`);
    }
  }
  return errors;
}

export function atomicMetadataCommitErrors({
  commits,
  metadataCommit,
  receiptExistedAtBase,
  changes,
  expectedPaths,
  label,
}) {
  const errors = [];
  if (commits.length !== 1 || commits[0] !== metadataCommit) {
    errors.push(`${label}: metadata handoff must be exactly one commit after the reviewed head`);
  }
  if (receiptExistedAtBase) errors.push(`${label}: accepted receipt was rewritten instead of added once`);
  const expected = [...new Set(expectedPaths)].sort();
  const actual = changes.map((change) => change.path).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    errors.push(`${label}: metadata commit paths must equal the receipt and its exact referenced artifacts`);
  }
  for (const change of changes) {
    if (change.status !== "A") errors.push(`${label}: metadata path must be added atomically: ${change.path}`);
  }
  return errors;
}

export function phaseMetadataPaths(receipt, receiptPath) {
  const paths = new Set([receiptPath]);
  if (receipt.controllerRouting?.routeEvidence?.artifactPath)
    paths.add(receipt.controllerRouting.routeEvidence.artifactPath);
  for (const capability of receipt.capabilityEvidence ?? []) paths.add(capability.evidenceArtifactPath);
  for (const capability of receipt.capabilityEvidence ?? []) {
    if (capability.probeRouting?.routeEvidence?.artifactPath)
      paths.add(capability.probeRouting.routeEvidence.artifactPath);
  }
  for (const task of receipt.tasks ?? []) {
    paths.add(task.briefPath);
    paths.add(task.implementerReportPath);
    if (task.implementerRouting?.routeEvidence?.artifactPath)
      paths.add(task.implementerRouting.routeEvidence.artifactPath);
    for (const review of task.reviews ?? []) {
      paths.add(review.diffPackagePath);
      paths.add(review.reportPath);
      if (review.reviewerRouting?.routeEvidence?.artifactPath)
        paths.add(review.reviewerRouting.routeEvidence.artifactPath);
    }
  }
  for (const review of receipt.phaseReviews ?? []) {
    paths.add(review.diffPackagePath);
    paths.add(review.reportPath);
    if (review.reviewerRouting?.routeEvidence?.artifactPath)
      paths.add(review.reviewerRouting.routeEvidence.artifactPath);
  }
  return [...paths];
}

export function programmeMetadataPaths(receipt, receiptPath) {
  const paths = new Set([receiptPath]);
  if (receipt.finalReviewRouting?.routeEvidence?.artifactPath)
    paths.add(receipt.finalReviewRouting.routeEvidence.artifactPath);
  for (const review of receipt.reviews ?? []) {
    paths.add(review.diffPackagePath);
    paths.add(review.reportPath);
  }
  return [...paths];
}

export function connectedMetadataPaths(receipt, receiptPath) {
  const paths = new Set([receiptPath]);
  for (const routing of [receipt.controllerRouting, receipt.reviewerRouting]) {
    if (routing?.routeEvidence?.path) paths.add(routing.routeEvidence.path);
  }
  for (const capability of receipt.capabilityEvidence ?? []) paths.add(capability.evidenceArtifactPath);
  if (receipt.phaseReview?.diffPackagePath) paths.add(receipt.phaseReview.diffPackagePath);
  if (receipt.phaseReview?.reportPath) paths.add(receipt.phaseReview.reportPath);
  return [...paths];
}

export function operationalMetadataPaths(receipt, receiptPath) {
  return [
    receiptPath,
    receipt.finalReviewRouting?.routeEvidence?.path,
    receipt.review?.diffPackagePath,
    receipt.review?.reportPath,
  ].filter(Boolean);
}

function parsedTimestamp(value) {
  if (typeof value !== "string" || value.trim() === "") return Number.NaN;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

export function connectedOperationAcceptanceErrors(phaseId, requiredClasses, approvals, operations, acceptedAt) {
  const errors = [];
  const acceptedAtMs = parsedTimestamp(acceptedAt);
  if (!Number.isFinite(acceptedAtMs)) {
    errors.push(`${phaseId}: acceptedAt is not a parseable timestamp`);
  }
  const approvalsById = new Map(approvals.map((approval) => [approval.authorizationId, approval]));
  const operationClasses = new Set(operations.map((operation) => operation.operationClass));
  for (const requiredClass of requiredClasses) {
    if (!operationClasses.has(requiredClass)) errors.push(`${phaseId}: missing required operation ${requiredClass}`);
  }
  for (const operation of operations) {
    const performedAt = parsedTimestamp(operation.performedAt);
    if (!Number.isFinite(performedAt)) {
      errors.push(`${phaseId}: operation ${operation.operationClass} has an unparseable performedAt`);
    } else if (Number.isFinite(acceptedAtMs) && performedAt > acceptedAtMs) {
      errors.push(`${phaseId}: operation ${operation.operationClass} must occur no later than acceptance`);
    }
    if (operation.outcome !== "passed") {
      errors.push(`${phaseId}: accepted GO operation ${operation.operationClass} must have outcome passed`);
    }
    if (phaseId === "L00") {
      if (operation.approvalId !== null) errors.push("L00: local drift classification must not invent approval");
      continue;
    }
    const approval = approvalsById.get(operation.approvalId);
    if (!approval) {
      errors.push(`${phaseId}: operation ${operation.operationClass} references unknown approval`);
      continue;
    }
    const approvedAt = parsedTimestamp(approval.approvedAt);
    const expiresAt = parsedTimestamp(approval.expiresAt);
    if (!Number.isFinite(approvedAt) || !Number.isFinite(expiresAt)) {
      errors.push(`${phaseId}: approval has an unparseable timestamp`);
    } else if (Number.isFinite(performedAt) && (approvedAt > performedAt || expiresAt < performedAt)) {
      errors.push(`${phaseId}: approval is not valid when operation ${operation.operationClass} was performed`);
    }
    if (!approval.actionClasses.includes(operation.operationClass)) {
      errors.push(`${phaseId}: approval does not authorize operation class ${operation.operationClass}`);
    }
    if (approval.service !== operation.service || approval.target !== operation.target) {
      errors.push(`${phaseId}: operation ${operation.operationClass} must match approval service and target`);
    }
    if (Array.isArray(approval.actions) && approval.actions.length > 0) {
      if (!approval.actions.includes(operation.commandOrAction)) {
        errors.push(
          `${phaseId}: command ${operation.commandOrAction ?? "(missing)"} is outside the approved action list`,
        );
      }
    }
  }
  if (phaseId === "L08") {
    const promotionApproval = operations.find(
      (operation) => operation.operationClass === "controlled-promotion",
    )?.approvalId;
    const rollbackApproval = operations.find((operation) => operation.operationClass === "rollback-proof")?.approvalId;
    if (!promotionApproval || !rollbackApproval || promotionApproval === rollbackApproval) {
      errors.push("L08: promotion and rollback proof require separate exact approvals");
    }
  }
  if (phaseId === "L10") {
    const cleanup = operations.find((operation) => operation.operationClass === "bounded-cleanup");
    if (!cleanup || approvalsById.get(cleanup.approvalId)?.destructive !== true) {
      errors.push("L10: bounded cleanup requires its own explicit destructive approval");
    }
  }
  return errors;
}

export function programmeVerificationErrors(evidence, requiredCommands) {
  const errors = [];
  for (const command of requiredCommands) {
    if (!evidence.some((item) => item.command === command && ["passed", "reused"].includes(item.outcome))) {
      errors.push(`programme verification is missing passing command: ${command}`);
    }
  }
  for (const item of evidence) {
    if (!["passed", "reused"].includes(item.outcome)) {
      errors.push(`programme verification evidence must pass or reuse a valid receipt: ${item.command}`);
    }
  }
  if (requiredCommands.length === 0) errors.push("manifest must define offlineCompletionCommands");
  return errors;
}

export function tddEvidenceErrors(globalTaskKey, evidence, contract) {
  const errors = [];
  if (!evidence.red.some((item) => item.outcome === "failed-as-expected")) {
    errors.push(`${globalTaskKey}: TDD RED must contain failed-as-expected product evidence`);
  }
  if (!evidence.green.some((item) => item.outcome === "passed")) {
    errors.push(`${globalTaskKey}: TDD GREEN must contain a fresh passed result`);
  }
  if (
    !evidence.red.some(
      (item) =>
        item.command === contract.redCommand &&
        item.expected === contract.redExpected &&
        item.outcome === "failed-as-expected",
    )
  ) {
    errors.push(`${globalTaskKey}: RED command or expected product failure differs from its contract`);
  }
  if (
    !evidence.green.some(
      (item) =>
        item.command === contract.greenCommand && item.expected === contract.greenExpected && item.outcome === "passed",
    )
  ) {
    errors.push(`${globalTaskKey}: GREEN command or passing contract differs from its contract`);
  }
  return errors;
}

export function trackedBytesErrors(workingBytes, trackedBytes, label) {
  if (trackedBytes === null) return [`${label}: accepted receipt is not tracked at HEAD`];
  return workingBytes.equals(trackedBytes) ? [] : [`${label}: working receipt differs from HEAD`];
}

export function reviewPackagePrefix(base, head, commits) {
  const commitLines = commits.length > 0 ? `${commits.join("\n")}\n` : "";
  return Buffer.from(`# Review package: ${base}..${head}\n\n## Commits\n${commitLines}\n## Diff\n`);
}

export function buildReviewPackageBytes(base, head, commits, diffBytes) {
  return Buffer.concat([reviewPackagePrefix(base, head, commits), diffBytes]);
}

export function reviewPackageEvidenceErrors(bytes, base, head, commits, actualPatchId, expectedPatchId) {
  const errors = [];
  if (
    !bytes.subarray(0, reviewPackagePrefix(base, head, commits).length).equals(reviewPackagePrefix(base, head, commits))
  ) {
    errors.push("review package header or full commit list differs from the recorded range");
  }
  if (actualPatchId !== expectedPatchId) errors.push("review package patch differs from the recorded full range");
  return errors;
}
