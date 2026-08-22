import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = "docs/superpowers/rag-upgrade";

const sharedFiles = [
  [
    "docs/superpowers/specs/2026-08-20-rag-answer-and-australian-sources-design.md",
    "specs/2026-08-20-rag-answer-and-australian-sources-design.md",
  ],
  [
    "docs/superpowers/specs/2026-08-21-trusted-admin-document-ingestion-design.md",
    "specs/2026-08-21-trusted-admin-document-ingestion-design.md",
  ],
  ["docs/superpowers/plans/2026-08-20-rag-adaptive-answer.md", "plans/2026-08-20-rag-adaptive-answer.md"],
  [
    "docs/superpowers/plans/2026-08-20-rag-australian-source-governance.md",
    "plans/2026-08-20-rag-australian-source-governance.md",
  ],
  ["docs/superpowers/plans/2026-08-20-rag-evaluation-rollout.md", "plans/2026-08-20-rag-evaluation-rollout.md"],
  ["docs/superpowers/plans/2026-08-20-rag-ingestion-reindex.md", "plans/2026-08-20-rag-ingestion-reindex.md"],
  ["docs/superpowers/plans/2026-08-20-rag-retrieval-composition.md", "plans/2026-08-20-rag-retrieval-composition.md"],
  [
    "docs/superpowers/plans/2026-08-20-rag-verified-incremental-delivery.md",
    "plans/2026-08-20-rag-verified-incremental-delivery.md",
  ],
  [
    "docs/superpowers/plans/2026-08-21-rag-repository-content-sync.md",
    "plans/2026-08-21-rag-repository-content-sync.md",
  ],
  [
    "docs/superpowers/plans/2026-08-21-trusted-admin-document-ingestion.md",
    "plans/2026-08-21-trusted-admin-document-ingestion.md",
  ],
  ["docs/superpowers/rag-upgrade/canonical/programme-manifest.json", "programme-manifest.json"],
  ["docs/superpowers/rag-upgrade/canonical/execution-order.md", "execution-order.md"],
  ["docs/superpowers/rag-upgrade/canonical/approval-matrix.md", "approval-matrix.md"],
  ["docs/superpowers/rag-upgrade/canonical/sdd-execution.md", "sdd-execution.md"],
  ["docs/superpowers/rag-upgrade/canonical/phase-receipt.schema.json", "phase-receipt.schema.json"],
  ["docs/superpowers/rag-upgrade/canonical/phase-receipt.template.json", "phase-receipt.template.json"],
  ["docs/superpowers/rag-upgrade/canonical/programme-receipt.schema.json", "programme-receipt.schema.json"],
  ["docs/superpowers/rag-upgrade/canonical/programme-receipt.template.json", "programme-receipt.template.json"],
  ["docs/superpowers/rag-upgrade/canonical/task-verification-matrix.json", "task-verification-matrix.json"],
];

const variants = {
  local: "docs/superpowers/rag-upgrade/canonical/START-HERE.local.md",
  cloud: "docs/superpowers/rag-upgrade/canonical/START-HERE.cloud.md",
};

function absolute(path) {
  return join(repositoryRoot, ...path.split("/"));
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

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function taskBodies(markdown, sourcePath) {
  const matches = [];
  let offset = 0;
  let inFence = false;
  for (const rawLine of markdown.match(/.*(?:\r?\n|$)/g) ?? []) {
    const line = rawLine.replace(/\r?\n$/, "");
    if (line.startsWith("```")) {
      inFence = !inFence;
    } else if (!inFence) {
      const match = line.match(/^#+[ \t]+Task[ \t]+([0-9]+)([^0-9]|$)/);
      if (match) matches.push({ number: Number(match[1]), index: offset, line });
      else if (/^#+[ \t]+Task[ \t]+/.test(line)) {
        throw new Error(`${sourcePath}: non-extractable task heading '${line}'`);
      }
    }
    offset += rawLine.length;
  }
  if (matches.length === 0) throw new Error(`${sourcePath}: no numeric task headings found`);
  return matches.map((match, index) => ({
    number: match.number,
    body: markdown.slice(match.index, matches[index + 1]?.index ?? markdown.length),
  }));
}

function containsUnfencedPlanSection(markdown) {
  let inFence = false;
  for (const line of markdown.split(/\r?\n/)) {
    if (line.startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (!inFence && /^## /.test(line)) return true;
  }
  return false;
}

function literalTddContract(taskBody) {
  const runs = [...taskBody.matchAll(/Run:\s*(?:`([^`\r\n]+)`|\r?\n```(?:text|bash)?\r?\n([^\r\n]+))/g)];
  for (const [index, run] of runs.entries()) {
    const following = taskBody.slice(run.index + run[0].length, runs[index + 1]?.index ?? taskBody.length);
    const redExpected = following.match(/Expected:\s*(FAIL[^\r\n]*)/i)?.[1]?.trim();
    if (redExpected) return { redCommand: run[1] ?? run[2], redExpected };
  }
  return null;
}

function validateCanonicalBodies() {
  const errors = [];
  const requireOriginMain = process.argv.includes("--require-origin-main");
  const requireCurrentOriginMain = process.argv.includes("--require-current-origin-main");
  const manifest = JSON.parse(
    readFileSync(absolute(sharedFiles.find(([, target]) => target === "programme-manifest.json")[0]), "utf8"),
  );
  const residualGateIds = (manifest.requiredResidualGates ?? []).map((gate) => gate.id);
  if (residualGateIds.length === 0 || new Set(residualGateIds).size !== residualGateIds.length) {
    errors.push("programme-manifest.json: requiredResidualGates must contain unique stable IDs");
  }
  const programmeTemplate = JSON.parse(
    readFileSync(absolute(sharedFiles.find(([, target]) => target === "programme-receipt.template.json")[0]), "utf8"),
  );
  const templateResidualIds = programmeTemplate.residualGates.map((gate) => gate.gateId);
  if (JSON.stringify(templateResidualIds.sort()) !== JSON.stringify([...residualGateIds].sort())) {
    errors.push("programme-receipt.template.json: residual gate IDs must exactly match the manifest");
  }
  const tasksByPlan = new Map();
  const taskBodiesByPlan = new Map();
  const plannedMigrations = new Map();

  for (const [source, target] of sharedFiles) {
    const sourcePath = absolute(source);
    if (!existsSync(sourcePath)) {
      errors.push(`missing canonical file: ${source}`);
      continue;
    }
    const text = readFileSync(sourcePath, "utf8");
    if (/[A-Za-z]:\\/.test(text) || /(?:^|[\s(])\/(?:Users|home)\//m.test(text)) {
      errors.push(`${source}: shared body contains a machine-specific absolute path`);
    }
    if (text.includes("```powershell")) errors.push(`${source}: shared body contains a PowerShell-only fence`);
    if (target.startsWith("plans/") && /- \[[xX]\]/.test(text)) {
      errors.push(`${source}: executable task steps must not be pre-checked`);
    }
    if (/local implementation note|implemented in (?:an? )?(?:separate |isolated )?[^\n]*worktree/i.test(text)) {
      errors.push(`${source}: shared body claims machine-local implementation evidence`);
    }
    if (
      /<(?:changed paths|comma-separated|audit|plan|recovery|digest|project|expected|server-only)[^>]*>/i.test(text)
    ) {
      errors.push(`${source}: shared body contains an unresolved execution placeholder`);
    }
    for (const migration of text.matchAll(/supabase\/migrations\/(\d{14}_[a-z0-9_]+\.sql)/g)) {
      const basename = migration[1];
      const version = basename.slice(0, 14);
      const prior = plannedMigrations.get(version);
      if (prior && prior !== basename)
        errors.push(`planned migration version ${version} names both ${prior} and ${basename}`);
      plannedMigrations.set(version, basename);
    }
    if (!target.startsWith("plans/")) continue;
    try {
      const tasks = taskBodies(text, source);
      const seen = new Set();
      const bodies = new Map();
      for (const task of tasks) {
        if (seen.has(task.number)) errors.push(`${source}: duplicate Task ${task.number}`);
        seen.add(task.number);
        if (!task.body.includes("**Files:**")) errors.push(`${source}: Task ${task.number} has no Files contract`);
        if (!task.body.includes("**Interfaces:**"))
          errors.push(`${source}: Task ${task.number} has no Interfaces contract`);
        const interfacesSection = task.body.match(/\*\*Interfaces:\*\*([\s\S]*?)(?=\n(?:\*\*|---|- \[ \]))/)?.[1] ?? "";
        if (!/\bConsumes\b/i.test(interfacesSection) || !/\bProduces\b/i.test(interfacesSection)) {
          errors.push(`${source}: Task ${task.number} Interfaces must name both Consumes and Produces`);
        }
        if (/\(\.\.\.\)/.test(interfacesSection)) {
          errors.push(`${source}: Task ${task.number} Interfaces contains an unresolved function signature`);
        }
        if (!/Produces[\s\S]*?(?:`[^`]+`|no runtime interface)/i.test(interfacesSection)) {
          errors.push(`${source}: Task ${task.number} Interfaces must name a concrete produced contract`);
        }
        if (!task.body.includes("- [ ]")) errors.push(`${source}: Task ${task.number} has no executable checklist`);
        const filesSection = task.body.match(/\*\*Files:\*\*([\s\S]*?)(?=\n\*\*Interfaces:\*\*)/)?.[1] ?? "";
        const declaredPaths = new Set(
          [
            ...filesSection.matchAll(
              /^- (?:Create|Modify|Reuse|Inspect|Read|Revalidate|Delete|Assert absent): `([^`]+)`/gm,
            ),
          ].map((match) => match[1].replace(/\\/g, "/").replace(/\/$/, "")),
        );
        for (const command of task.body.matchAll(/^git add ([^\r\n]+)$/gm)) {
          for (const stagedPath of command[1].split(/\s+/).filter((path) => path && !path.startsWith("-"))) {
            const normalized = stagedPath.replace(/\\/g, "/").replace(/\/$/, "");
            if (!declaredPaths.has(normalized)) {
              errors.push(`${source}: Task ${task.number} git add exceeds Files contract: ${normalized}`);
            }
          }
        }
        if (containsUnfencedPlanSection(task.body)) {
          errors.push(`${source}: Task ${task.number} extraction includes a plan-level trailing section`);
        }
        bodies.set(task.number, task.body);
      }
      tasksByPlan.set(target, seen);
      taskBodiesByPlan.set(target, bodies);
    } catch (error) {
      errors.push(error.message);
    }
  }

  const scheduled = new Map();
  const seenPhaseIds = new Set();
  for (const [phaseIndex, phase] of manifest.phases.entries()) {
    if (seenPhaseIds.has(phase.id)) errors.push(`duplicate phase id ${phase.id}`);
    const expectedPredecessor = phaseIndex === 0 ? null : manifest.phases[phaseIndex - 1].id;
    if (phase.executionPredecessor !== expectedPredecessor) {
      errors.push(`${phase.id}: executionPredecessor must be ${expectedPredecessor ?? "null"}`);
    }
    for (const dependency of phase.dependsOn) {
      if (!seenPhaseIds.has(dependency)) errors.push(`${phase.id}: dependency ${dependency} is not an earlier phase`);
    }
    seenPhaseIds.add(phase.id);
    if (phase.phaseType !== "operator-gate" && (phase.tasks.length < 1 || phase.tasks.length > 4)) {
      errors.push(`${phase.id}: implementation phases must contain between one and four tasks`);
    }
    if (phase.implementationReasoning === "medium" && phase.reviewReasoning === "xhigh") {
      errors.push(`${phase.id}: high-risk review cannot be paired with a medium implementation effort`);
    }
    if (phase.phaseType === "operator-gate") continue;
    const planPath = manifest.plans[phase.plan];
    if (!planPath) {
      errors.push(`${phase.id}: unknown plan key ${phase.plan}`);
      continue;
    }
    for (const task of phase.tasks) {
      const key = `${planPath}#${task}`;
      if (scheduled.has(key)) errors.push(`${key} is scheduled by both ${scheduled.get(key)} and ${phase.id}`);
      scheduled.set(key, phase.id);
    }
  }

  for (const [planPath, tasks] of tasksByPlan) {
    for (const task of tasks) {
      const key = `${planPath}#${task}`;
      if (!scheduled.has(key)) errors.push(`${key} is not scheduled by the programme manifest`);
    }
  }
  for (const key of scheduled.keys()) {
    const [planPath, taskText] = key.split("#");
    if (!tasksByPlan.get(planPath)?.has(Number(taskText))) errors.push(`${key} is scheduled but absent from its plan`);
  }

  const verificationMatrix = JSON.parse(
    readFileSync(absolute("docs/superpowers/rag-upgrade/canonical/task-verification-matrix.json"), "utf8"),
  );
  const validTaskKeys = new Set();
  for (const phase of manifest.phases) {
    if (phase.phaseType === "operator-gate") continue;
    for (const task of phase.tasks) validTaskKeys.add(`${phase.plan}/task-${task}`);
  }
  const requiredVerificationSupplements = [
    "adaptive/task-0",
    "adaptive/task-6",
    "australian/task-6",
    "evaluation/task-3",
    "evaluation/task-5",
    "evaluation/task-6",
    "ingestion/task-3",
    "ingestion/task-4",
    "ingestion/task-5",
    "ingestion/task-6",
    "ingestion/task-9",
    "retrieval/task-5",
    "retrieval/task-3",
    "retrieval/task-6",
    "retrieval/task-7",
    "retrieval/task-8",
    "verifiedDelivery/task-5",
    "verifiedDelivery/task-6",
    "repositoryContent/task-2",
    "repositoryContent/task-3",
    "repositoryContent/task-4",
    "repositoryContent/task-5",
    "repositoryContent/task-6",
    "trustedIngestion/task-3",
    "trustedIngestion/task-0",
    "trustedIngestion/task-4",
    "trustedIngestion/task-5",
    "trustedIngestion/task-6",
    "trustedIngestion/task-7",
    "trustedIngestion/task-8",
  ];
  for (const key of requiredVerificationSupplements) {
    if (!verificationMatrix.tasks[key]) errors.push(`task-verification-matrix.json: missing required ${key}`);
  }
  for (const [key, contract] of Object.entries(verificationMatrix.tasks)) {
    if (!validTaskKeys.has(key)) errors.push(`task-verification-matrix.json: unknown task ${key}`);
    if (contract.strategy === "tdd") {
      if (!contract.redCommand || !contract.redExpected || !contract.greenCommand) {
        errors.push(`task-verification-matrix.json: ${key} lacks literal RED/GREEN evidence fields`);
      }
      if (contract.redCommand !== contract.greenCommand) {
        errors.push(`task-verification-matrix.json: ${key} must repeat the identical focused command for GREEN`);
      }
    } else if (contract.strategy === "verification-only") {
      if (!contract.preCommand || !contract.preExpected || !Array.isArray(contract.acceptanceCommands)) {
        errors.push(`task-verification-matrix.json: ${key} lacks exact verification-only acceptance fields`);
      }
      for (const [index, acceptance] of (contract.acceptanceCommands ?? []).entries()) {
        if (!acceptance || typeof acceptance.command !== "string" || typeof acceptance.expected !== "string") {
          errors.push(`task-verification-matrix.json: ${key} acceptanceCommands/${index} lacks command/expected`);
        }
      }
    } else {
      errors.push(`task-verification-matrix.json: ${key} has unsupported strategy ${contract.strategy}`);
    }
  }
  for (const phase of manifest.phases) {
    if (phase.phaseType === "operator-gate") continue;
    const planPath = manifest.plans[phase.plan];
    for (const taskNumber of phase.tasks) {
      const key = `${phase.plan}/task-${taskNumber}`;
      if (
        !verificationMatrix.tasks[key] &&
        !literalTddContract(taskBodiesByPlan.get(planPath)?.get(taskNumber) ?? "")
      ) {
        errors.push(`${key}: no exact matrix contract or machine-readable RED command in the task body`);
      }
    }
  }

  const existingMigrations = new Set();
  const otherPlannedMigrations = new Map();
  let originMainAvailable = false;
  let validationBaseAvailable = false;
  try {
    execFileSync("git", ["rev-parse", "--verify", "origin/main"], {
      cwd: repositoryRoot,
      stdio: ["ignore", "ignore", "ignore"],
    });
    originMainAvailable = true;
  } catch {
    if (requireOriginMain) errors.push("origin/main is unavailable; fetch and verify it before package execution");
  }
  try {
    execFileSync("git", ["rev-parse", "--verify", `${manifest.reconciledBase}^{commit}`], {
      cwd: repositoryRoot,
      stdio: ["ignore", "ignore", "ignore"],
    });
    validationBaseAvailable = true;
  } catch {
    errors.push(`manifest reconciledBase is unavailable locally: ${manifest.reconciledBase}`);
  }
  if (originMainAvailable && requireCurrentOriginMain) {
    const originMainSha = execFileSync("git", ["rev-parse", "origin/main"], {
      cwd: repositoryRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (manifest.reconciledBase !== originMainSha) {
      errors.push(
        `manifest reconciledBase ${manifest.reconciledBase} differs from current origin/main ${originMainSha}; reconcile and regenerate before publication or P00`,
      );
    }
  }
  if (validationBaseAvailable) {
    try {
      const trackedOutput = execFileSync("git", ["ls-tree", "-r", "--name-only", manifest.reconciledBase], {
        cwd: repositoryRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      const tracked = new Set(trackedOutput.split(/\r?\n/).filter(Boolean));
      const created = new Set();
      const deleted = new Set();
      const createOwner = new Map();
      const availableCandidates = () => [...tracked, ...created].filter((candidate) => !deleted.has(candidate));
      const matchesTracked = (path) => {
        const normalized = path.replace(/\\/g, "/").replace(/\/$/, "");
        if (normalized.endsWith("/**")) {
          const prefix = normalized.slice(0, -3).replace(/\/$/, "");
          return availableCandidates().some((candidate) => candidate === prefix || candidate.startsWith(`${prefix}/`));
        }
        if (normalized.includes("*")) {
          const expression = new RegExp(
            `^${normalized
              .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
              .replace(/\*\*/g, ".*")
              .replace(/\*/g, "[^/]*")}$`,
          );
          return availableCandidates().some((candidate) => expression.test(candidate));
        }
        return availableCandidates().some(
          (candidate) => candidate === normalized || candidate.startsWith(`${normalized}/`),
        );
      };
      const markDeleted = (path) => {
        const normalized = path
          .replace(/\\/g, "/")
          .replace(/\/\*\*$/, "")
          .replace(/\/$/, "");
        for (const candidate of [...tracked, ...created]) {
          if (candidate === normalized || candidate.startsWith(`${normalized}/`)) deleted.add(candidate);
        }
      };

      for (const phase of manifest.phases) {
        if (phase.phaseType === "operator-gate") continue;
        const planPath = manifest.plans[phase.plan];
        for (const taskNumber of phase.tasks) {
          const body = taskBodiesByPlan.get(planPath)?.get(taskNumber);
          if (!body) continue;
          const filesSection = body.match(/\*\*Files:\*\*([\s\S]*?)(?=\n\*\*Interfaces:\*\*)/)?.[1] ?? "";
          const lines = filesSection.split(/\r?\n/).filter((line) => line.startsWith("- "));
          for (const line of lines) {
            if (/only if|new or existing|reuse\/modify|new or reuse/i.test(line)) {
              errors.push(
                `${planPath}#${taskNumber}: conditional Files entry is not executable on the pinned base '${line}'`,
              );
            }
            const parsed = line.match(
              /^- (Create|Modify|Reuse|Inspect|Read|Revalidate|Delete|Assert absent): `([^`]+)`(?:.*)?$/,
            );
            if (!parsed) {
              if (line.includes("`")) errors.push(`${planPath}#${taskNumber}: unrecognized Files entry '${line}'`);
              continue;
            }
            const [, action, rawPath] = parsed;
            const path = rawPath.replace(/\\/g, "/").replace(/\/$/, "");
            const owner = `${phase.id}/${planPath}#${taskNumber}`;
            if (action === "Create") {
              if (matchesTracked(path)) errors.push(`${owner}: Create target already exists before this task: ${path}`);
              if (createOwner.has(path))
                errors.push(`${owner}: duplicate Create for ${path}; first created by ${createOwner.get(path)}`);
              created.add(path);
              createOwner.set(path, owner);
            } else if (action === "Delete") {
              if (!matchesTracked(path))
                errors.push(`${owner}: Delete target has no current/earlier-created owner: ${path}`);
              markDeleted(path);
            } else if (action === "Assert absent") {
              if (matchesTracked(path)) errors.push(`${owner}: expected-absent target is still present: ${path}`);
            } else if (!matchesTracked(path)) {
              errors.push(`${owner}: ${action} target is absent on origin/main and was not created earlier: ${path}`);
            }
          }
        }
      }
    } catch (error) {
      errors.push(`reconciled-base path-contract validation failed: ${error.message}`);
    }
  }
  const migrationDirectory = absolute("supabase/migrations");
  if (existsSync(migrationDirectory)) {
    for (const name of readdirSync(migrationDirectory)) {
      if (/^\d{14}_.+\.sql$/.test(name)) existingMigrations.add(name);
    }
  }
  try {
    if (!validationBaseAvailable) throw new Error("reconciled base unavailable");
    const names = execFileSync(
      "git",
      ["ls-tree", "-r", "--name-only", manifest.reconciledBase, "--", "supabase/migrations"],
      {
        cwd: repositoryRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
    for (const path of names.split(/\r?\n/)) {
      const name = path.split("/").at(-1);
      if (name && /^\d{14}_.+\.sql$/.test(name)) existingMigrations.add(name);
    }
  } catch {
    // A fresh local-only checkout may not have origin/main. Working-tree migrations still protect it;
    // START-HERE requires current-origin reconciliation before implementation.
  }
  try {
    if (!validationBaseAvailable) throw new Error("reconciled base unavailable");
    const references = execFileSync(
      "git",
      [
        "grep",
        "-h",
        "-o",
        "-E",
        "supabase/migrations/[0-9]{14}_[a-z0-9_]+\\.sql",
        manifest.reconciledBase,
        "--",
        "docs/superpowers/plans",
      ],
      {
        cwd: repositoryRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
    for (const reference of references.split(/\r?\n/)) {
      const name = reference.split("/").at(-1);
      if (!name) continue;
      const version = name.slice(0, 14);
      const names = otherPlannedMigrations.get(version) ?? new Set();
      names.add(name);
      otherPlannedMigrations.set(version, names);
    }
  } catch {
    // No other planned migrations, or no origin/main ref. Base reconciliation remains mandatory.
  }
  const existingByVersion = new Map([...existingMigrations].map((name) => [name.slice(0, 14), name]));
  for (const [version, name] of plannedMigrations) {
    if (existingByVersion.has(version)) {
      errors.push(`planned migration ${name} collides with existing ${existingByVersion.get(version)}`);
    }
    const otherPlanNames = [...(otherPlannedMigrations.get(version) ?? [])].filter((otherName) => otherName !== name);
    for (const otherPlanName of otherPlanNames) {
      errors.push(`planned migration ${name} collides with another reconciled-base plan: ${otherPlanName}`);
    }
  }

  return errors;
}

function writePackages() {
  for (const [variant, startSource] of Object.entries(variants)) {
    const targetRoot = absolute(`${packageRoot}/${variant}`);
    for (const [source, target] of sharedFiles) {
      const targetPath = join(targetRoot, ...target.split("/"));
      mkdirSync(dirname(targetPath), { recursive: true });
      writeFileSync(targetPath, readFileSync(absolute(source)));
    }
    writeFileSync(join(targetRoot, "START-HERE.md"), readFileSync(absolute(startSource)));
  }
}

function validatePackages() {
  const errors = validateCanonicalBodies();
  const expectedFiles = [...sharedFiles.map(([, target]) => target), "START-HERE.md"].sort();
  for (const variant of Object.keys(variants)) {
    const targetRoot = absolute(`${packageRoot}/${variant}`);
    const actualFiles = listFiles(targetRoot);
    if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
      errors.push(`${variant}: package file set differs from the required set`);
    }
    for (const [source, target] of sharedFiles) {
      const generated = join(targetRoot, ...target.split("/"));
      if (!existsSync(generated)) {
        errors.push(`${variant}: missing ${target}`);
        continue;
      }
      const sourceBytes = readFileSync(absolute(source));
      const generatedBytes = readFileSync(generated);
      if (!sourceBytes.equals(generatedBytes)) {
        errors.push(
          `${variant}: ${target} differs from canonical source (${sha256(sourceBytes)} != ${sha256(generatedBytes)})`,
        );
      }
    }
    const expectedStart = readFileSync(absolute(variants[variant]));
    const actualStartPath = join(targetRoot, "START-HERE.md");
    if (!existsSync(actualStartPath) || !expectedStart.equals(readFileSync(actualStartPath))) {
      errors.push(`${variant}: START-HERE.md differs from its environment runbook`);
    }
  }
  for (const [, target] of sharedFiles) {
    const localPath = absolute(`${packageRoot}/local/${target}`);
    const cloudPath = absolute(`${packageRoot}/cloud/${target}`);
    if (existsSync(localPath) && existsSync(cloudPath) && !readFileSync(localPath).equals(readFileSync(cloudPath))) {
      errors.push(`local/cloud parity failure: ${target}`);
    }
  }
  return errors;
}

const mode = process.argv.includes("--write") ? "--write" : process.argv.includes("--check") ? "--check" : null;
if (mode === "--write") writePackages();
else if (mode !== "--check") {
  console.error(
    "Usage: node scripts/build-rag-plan-packages.mjs --write|--check [--require-origin-main] [--require-current-origin-main]",
  );
  process.exit(2);
}

const errors = validatePackages();
if (errors.length > 0) {
  console.error("RAG plan package validation failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(
  `RAG plan packages ${mode === "--write" ? "synchronized" : "validated"}: local/cloud shared bodies are identical.`,
);
