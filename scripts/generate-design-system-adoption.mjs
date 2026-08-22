import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { inflateSync } from "node:zlib";
import ts from "@typescript/typescript6";
import prettier from "prettier";

const ROOT = process.cwd();
const CONTRACT_PATH = "docs/design-system/adoption-contract.json";
const MANIFEST_PATH = "docs/design-system/adoption-manifest.json";
const CONFIG_PATH = ".design-sync/config.json";
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);
const TEXT_CACHE = new Map();
const SOURCE_FILE_CACHE = new Map();
const IMPORT_FACT_CACHE = new Map();
const SOURCE_IMPORT_CACHE = new Map();
const TRACKED_FILE_CACHE = new Map();
const CANONICAL_GLOBAL_SHELL_ROOT = Object.freeze({ file: "src/app/layout.tsx", element: "html" });
const PROOF_APPLICABILITY = new Set(["required", "not-applicable"]);
const V2_MOUNT_MODES = new Set(["none", "inherited-global-root", "direct-literal"]);
const CANONICAL_DEFAULT_PROOF_APPLICABILITY = "required";
const CANONICAL_PROOF_EVIDENCE_POLICY = Object.freeze({
  testFileSuffixes: [".test.ts", ".test.tsx", ".spec.ts", ".spec.tsx"],
  evidenceDirectory: "docs/design-system/evidence/",
  evidenceExtensions: [".json", ".md"],
});
const CANONICAL_VISUAL_BASELINE_POLICY = Object.freeze({
  requiredPrefix: "tests/__screenshots__/linux/",
  allowedExtensions: [".png"],
  provenanceFile: "tests/__screenshots__/linux/provenance.json",
  provenanceSchemaVersion: 2,
  requiredPlatform: "linux",
  requiredRunnerImage: "ubuntu-24.04",
  requiredReviewStatus: "approved",
  requiredCandidateCount: 6,
  canonicalCandidates: [
    { id: "dashboard-shell", path: "tests/__screenshots__/linux/dashboard-shell.png" },
    { id: "dashboard-shell-phone", path: "tests/__screenshots__/linux/dashboard-shell-phone.png" },
    { id: "search-results-band", path: "tests/__screenshots__/linux/search-results-band.png" },
    { id: "search-results-band-phone", path: "tests/__screenshots__/linux/search-results-band-phone.png" },
    { id: "document-viewer", path: "tests/__screenshots__/linux/document-viewer.png" },
    { id: "therapy-compass-home", path: "tests/__screenshots__/linux/therapy-compass-home.png" },
  ],
  sourceBinding: {
    visualSuiteFile: "tests/ui-visual-baseline.spec.ts",
    allowedChangedPaths: [
      ".github/workflows/ci.yml",
      "docs/branch-review-ledger.md",
      "docs/design-system/ADOPTION.md",
      "docs/design-system/COMPONENTS.md",
      "docs/design-system/adoption-contract.json",
      "docs/design-system/adoption-manifest.json",
      "lighthouse-budget.json",
      "scripts/generate-design-system-adoption.mjs",
      "tests/__screenshots__/linux/provenance.json",
      // First adoption also ships the fixture fix that makes emptying AWAITING_BASELINE
      // testable; keep it allowlisted so candidateSourceHead can stay on an existing
      // main commit (required for shallow CI checkouts and squash-merge survival).
      "tests/design-system-adoption.test.ts",
    ],
  },
});
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const NEXT_UI_ENTRY_BASENAMES = new Set([
  "page",
  "layout",
  "template",
  "loading",
  "error",
  "global-error",
  "not-found",
  "default",
  "forbidden",
  "unauthorized",
]);
const CANONICAL_NON_VISUAL_ROUTES = Object.freeze({
  "documents-source-legacy-redirect": {
    route: "src/app/(search-app)/documents/source/page.tsx",
    kind: "next-redirect-only",
  },
  "ward-management-constellation-legacy-redirect": {
    route: "src/app/ward-management/constellation/page.tsx",
    kind: "next-redirect-only",
  },
});

const toPosix = (value) => value.split(path.sep).join("/");
const read = (relativePath, root = ROOT) => {
  const key = `${root}:${relativePath}`;
  if (!TEXT_CACHE.has(key)) TEXT_CACHE.set(key, fs.readFileSync(path.join(root, relativePath), "utf8"));
  return TEXT_CACHE.get(key);
};
const exists = (relativePath, root = ROOT) => fs.existsSync(path.join(root, relativePath));

function trackedFilesForRoot(root = ROOT) {
  if (!TRACKED_FILE_CACHE.has(root)) {
    const output = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" });
    TRACKED_FILE_CACHE.set(root, new Set(output.split("\0").filter(Boolean).map(toPosix)));
  }
  return TRACKED_FILE_CACHE.get(root);
}

const CRC32_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) value = CRC32_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

export function inspectPng(buffer) {
  const failures = [];
  if (!Buffer.isBuffer(buffer) || buffer.length < PNG_SIGNATURE.length || !buffer.subarray(0, 8).equals(PNG_SIGNATURE))
    return { valid: false, width: 0, height: 0, failures: ["must contain a PNG file signature"] };

  let offset = PNG_SIGNATURE.length;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colourType = -1;
  let interlace = -1;
  let sawIhdr = false;
  let sawIend = false;
  const idatChunks = [];
  const allowedBitDepths = new Map([
    [0, new Set([1, 2, 4, 8, 16])],
    [2, new Set([8, 16])],
    [3, new Set([1, 2, 4, 8])],
    [4, new Set([8, 16])],
    [6, new Set([8, 16])],
  ]);
  const channelsByColourType = new Map([
    [0, 1],
    [2, 3],
    [3, 1],
    [4, 2],
    [6, 4],
  ]);

  while (offset < buffer.length) {
    if (offset + 12 > buffer.length) {
      failures.push("PNG chunk header is truncated");
      break;
    }
    const length = buffer.readUInt32BE(offset);
    const typeStart = offset + 4;
    const dataStart = typeStart + 4;
    const dataEnd = dataStart + length;
    const chunkEnd = dataEnd + 4;
    if (chunkEnd > buffer.length) {
      failures.push("PNG chunk data is truncated");
      break;
    }
    const type = buffer.toString("ascii", typeStart, dataStart);
    const data = buffer.subarray(dataStart, dataEnd);
    const expectedCrc = buffer.readUInt32BE(dataEnd);
    const actualCrc = crc32(buffer.subarray(typeStart, dataEnd));
    if (expectedCrc !== actualCrc) failures.push(`PNG ${type} chunk has an invalid CRC`);

    if (!sawIhdr) {
      if (type !== "IHDR" || length !== 13) failures.push("PNG must begin with a 13-byte IHDR chunk");
      else {
        sawIhdr = true;
        width = data.readUInt32BE(0);
        height = data.readUInt32BE(4);
        bitDepth = data[8];
        colourType = data[9];
        interlace = data[12];
        if (width < 16 || height < 16 || width > 20_000 || height > 20_000 || width * height > 100_000_000)
          failures.push("PNG dimensions must be between 16 and 20000 pixels with a sane total area");
        if (!allowedBitDepths.get(colourType)?.has(bitDepth))
          failures.push("PNG colour type and bit depth are invalid");
        if (data[10] !== 0 || data[11] !== 0) failures.push("PNG compression and filter methods must be standard");
        if (interlace !== 0) failures.push("PNG visual baselines must be non-interlaced");
      }
    } else if (type === "IHDR") {
      failures.push("PNG contains more than one IHDR chunk");
    }

    if (type === "IDAT") idatChunks.push(data);
    if (type === "IEND") {
      if (length !== 0) failures.push("PNG IEND chunk must be empty");
      sawIend = true;
      offset = chunkEnd;
      break;
    }
    offset = chunkEnd;
  }

  if (!sawIhdr) failures.push("PNG is missing IHDR");
  if (idatChunks.length === 0) failures.push("PNG is missing image data");
  if (!sawIend) failures.push("PNG is missing IEND");
  if (sawIend && offset !== buffer.length) failures.push("PNG contains trailing bytes after IEND");

  if (failures.length === 0) {
    try {
      const channels = channelsByColourType.get(colourType);
      const rowBytes = Math.ceil((width * channels * bitDepth) / 8);
      const expectedBytes = (rowBytes + 1) * height;
      const decoded = inflateSync(Buffer.concat(idatChunks), { maxOutputLength: expectedBytes + 1 });
      if (decoded.length !== expectedBytes) failures.push("PNG decoded byte length does not match its dimensions");
      else {
        for (let row = 0; row < height; row += 1) {
          if (decoded[row * (rowBytes + 1)] > 4) {
            failures.push("PNG contains an invalid row filter");
            break;
          }
        }
      }
    } catch {
      failures.push("PNG image data cannot be decoded");
    }
  }

  return { valid: failures.length === 0, width, height, failures };
}

export function validateAdoptionArtifactPath(
  relativePath,
  { root = ROOT, trackedFiles = trackedFilesForRoot(root), kind },
) {
  const failures = [];
  if (
    typeof relativePath !== "string" ||
    !relativePath ||
    path.isAbsolute(relativePath) ||
    relativePath.includes("\\")
  ) {
    return ["must be a non-empty repository-relative POSIX path"];
  }
  const normalized = path.posix.normalize(relativePath);
  const absolutePath = path.resolve(root, normalized);
  const relativeToRoot = path.relative(root, absolutePath);
  if (
    normalized !== relativePath ||
    relativeToRoot === ".." ||
    relativeToRoot.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeToRoot)
  ) {
    return ["must stay within the repository root"];
  }
  let regularFile = false;
  try {
    regularFile = fs.statSync(absolutePath).isFile();
  } catch {
    // Report the same stable failure for missing paths and non-files.
  }
  if (!regularFile) failures.push("must reference an existing regular file");
  if (regularFile) {
    const realRoot = fs.realpathSync(root);
    const realFile = fs.realpathSync(absolutePath);
    const realRelative = path.relative(realRoot, realFile);
    if (realRelative === ".." || realRelative.startsWith(`..${path.sep}`) || path.isAbsolute(realRelative))
      failures.push("must resolve to a file within the repository root");
  }
  if (!trackedFiles.has(normalized)) failures.push("must reference a Git-tracked file");

  if (kind === "proof") {
    const testEvidence =
      normalized.startsWith("tests/") &&
      CANONICAL_PROOF_EVIDENCE_POLICY.testFileSuffixes.some((suffix) => normalized.endsWith(suffix));
    const evidenceDocument =
      normalized.startsWith(CANONICAL_PROOF_EVIDENCE_POLICY.evidenceDirectory) &&
      CANONICAL_PROOF_EVIDENCE_POLICY.evidenceExtensions.includes(path.posix.extname(normalized));
    if (!testEvidence && !evidenceDocument) failures.push("must be a test/spec or a design-system evidence document");
  } else if (kind === "visual-baseline") {
    if (!normalized.startsWith(CANONICAL_VISUAL_BASELINE_POLICY.requiredPrefix))
      failures.push("must be a Linux visual baseline under tests/__screenshots__/linux/");
    if (!CANONICAL_VISUAL_BASELINE_POLICY.allowedExtensions.includes(path.posix.extname(normalized)))
      failures.push("must be a PNG visual baseline");
    if (/(?:^|[-_.])(win32|windows|darwin|macos)(?:[-_.]|$)/i.test(path.posix.basename(normalized)))
      failures.push("visual baseline filename must not claim a non-Linux platform");
    if (regularFile) {
      failures.push(...inspectPng(fs.readFileSync(absolutePath)).failures);
    }
  } else if (kind === "baseline-provenance") {
    if (normalized !== CANONICAL_VISUAL_BASELINE_POLICY.provenanceFile)
      failures.push(`must use ${CANONICAL_VISUAL_BASELINE_POLICY.provenanceFile}`);
    if (path.posix.extname(normalized) !== ".json") failures.push("must be a JSON provenance manifest");
  } else {
    failures.push(`has unknown artifact kind: ${String(kind)}`);
  }
  return failures;
}

export function visualBaselineTargetIds(sourceText, relativePath = "tests/ui-visual-baseline.spec.ts") {
  const source = ts.createSourceFile(relativePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let targetArray = null;
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === "targets" && declaration.initializer) {
        const initializer = unwrapExpression(declaration.initializer);
        if (ts.isArrayLiteralExpression(initializer)) targetArray = initializer;
      }
    }
  }
  if (!targetArray) return null;
  const ids = [];
  for (const element of targetArray.elements) {
    const target = unwrapExpression(element);
    if (!ts.isObjectLiteralExpression(target)) return null;
    const name = target.properties.find(
      (property) =>
        ts.isPropertyAssignment(property) &&
        ((ts.isIdentifier(property.name) && property.name.text === "name") ||
          (ts.isStringLiteral(property.name) && property.name.text === "name")),
    );
    if (!name || !ts.isPropertyAssignment(name)) return null;
    const value = unwrapExpression(name.initializer);
    if (!ts.isStringLiteral(value) && !ts.isNoSubstitutionTemplateLiteral(value)) return null;
    ids.push(value.text);
  }
  return ids.sort();
}

export function visualBaselineAwaitingIds(sourceText, relativePath = "tests/ui-visual-baseline.spec.ts") {
  const source = ts.createSourceFile(relativePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declarations = [];
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === "AWAITING_BASELINE")
        declarations.push({ declaration, declarationList: statement.declarationList });
    }
  }
  if (declarations.length !== 1)
    return { valid: false, ids: [], arrayStart: null, arrayEnd: null, failure: "must have exactly one declaration" };
  const { declaration, declarationList } = declarations[0];
  if (!(declarationList.flags & ts.NodeFlags.Const))
    return { valid: false, ids: [], arrayStart: null, arrayEnd: null, failure: "must be declared const" };
  const initializer = declaration.initializer ? unwrapExpression(declaration.initializer) : null;
  if (
    !initializer ||
    !ts.isNewExpression(initializer) ||
    !ts.isIdentifier(initializer.expression) ||
    initializer.expression.text !== "Set" ||
    initializer.arguments?.length !== 1
  ) {
    return { valid: false, ids: [], arrayStart: null, arrayEnd: null, failure: "must be a literal Set" };
  }
  const values = unwrapExpression(initializer.arguments[0]);
  if (!ts.isArrayLiteralExpression(values))
    return { valid: false, ids: [], arrayStart: null, arrayEnd: null, failure: "must use a literal array" };
  const ids = [];
  for (const element of values.elements) {
    if (ts.isSpreadElement(element))
      return { valid: false, ids: [], arrayStart: null, arrayEnd: null, failure: "must not use spread values" };
    const value = unwrapExpression(element);
    if (!ts.isStringLiteral(value) && !ts.isNoSubstitutionTemplateLiteral(value))
      return { valid: false, ids: [], arrayStart: null, arrayEnd: null, failure: "must contain only string literals" };
    ids.push(value.text);
  }
  if (new Set(ids).size !== ids.length)
    return { valid: false, ids: [], arrayStart: null, arrayEnd: null, failure: "must not contain duplicate ids" };
  return {
    valid: true,
    ids: ids.sort(),
    arrayStart: values.getStart(source),
    arrayEnd: values.end,
    failure: null,
  };
}

function normalizeVisualSuiteAwaitingValues(sourceText, analysis) {
  if (!analysis.valid || analysis.arrayStart === null || analysis.arrayEnd === null) return null;
  return `${sourceText.slice(0, analysis.arrayStart)}[]${sourceText.slice(analysis.arrayEnd)}`;
}

function gitOutput(root, args) {
  try {
    return execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
}

function gitSucceeds(root, args) {
  try {
    execFileSync("git", args, { cwd: root, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function validateCandidateSourceBinding(candidateSourceHead, { root, policy }) {
  const failures = [];
  if (!/^[0-9a-f]{40}$/.test(candidateSourceHead ?? "")) {
    return ["visual baseline provenance candidateSourceHead must be a full Git SHA"];
  }
  const currentHead = gitOutput(root, ["rev-parse", "--verify", "HEAD^{commit}"])?.trim();
  if (!currentHead) return ["visual baseline source binding requires a Git repository with a current HEAD"];
  if (!gitSucceeds(root, ["cat-file", "-e", `${candidateSourceHead}^{commit}`])) {
    return ["visual baseline provenance candidateSourceHead must identify an existing commit"];
  }
  if (!gitSucceeds(root, ["merge-base", "--is-ancestor", candidateSourceHead, currentHead])) {
    failures.push("visual baseline provenance candidateSourceHead must be an ancestor of current HEAD");
  }

  const visualSuiteFile = policy.sourceBinding.visualSuiteFile;
  const candidateSuite = gitOutput(root, ["show", `${candidateSourceHead}:${visualSuiteFile}`]);
  const currentSuite = exists(visualSuiteFile, root) ? fs.readFileSync(path.join(root, visualSuiteFile), "utf8") : null;
  const canonicalIds = policy.canonicalCandidates.map((candidate) => candidate.id).sort();
  const candidateIds = candidateSuite === null ? null : visualBaselineTargetIds(candidateSuite, visualSuiteFile);
  const currentIds = currentSuite === null ? null : visualBaselineTargetIds(currentSuite, visualSuiteFile);
  if (JSON.stringify(candidateIds) !== JSON.stringify(canonicalIds))
    failures.push("candidateSourceHead visual suite targets must exactly match the canonical six ids");
  if (JSON.stringify(currentIds) !== JSON.stringify(canonicalIds))
    failures.push("current visual suite targets must exactly match the canonical six ids");

  const candidateAwaiting = candidateSuite === null ? null : visualBaselineAwaitingIds(candidateSuite, visualSuiteFile);
  const currentAwaiting = currentSuite === null ? null : visualBaselineAwaitingIds(currentSuite, visualSuiteFile);
  // Two legitimate shapes, and the second is what makes updating the design possible.
  //
  //   FIRST ADOPTION — the capture head still declares the canonical six as awaiting,
  //   and the adopting commit empties that list.
  //   REFRESH — the list is already empty at both ends. Deliberately re-shooting a
  //   surface produces exactly this, and it is the ORDINARY case once baselines
  //   exist: the pixels move, the goldens are replaced, and the suite itself does
  //   not change at all.
  //
  // Requiring the six-to-empty transition alone made this binding satisfiable
  // exactly once. After the first adoption no commit declares the six again, so no
  // capture head could ever qualify and every later refresh was unprovable — the
  // goldens would go red on the first intentional design change with no supported
  // way to re-adopt them.
  const candidateAwaitingCanonical =
    candidateAwaiting?.valid && JSON.stringify(candidateAwaiting.ids) === JSON.stringify(canonicalIds);
  const candidateAwaitingEmpty = candidateAwaiting?.valid && candidateAwaiting.ids.length === 0;
  const candidateAwaitingAdoptable = candidateAwaitingCanonical || candidateAwaitingEmpty;
  const currentAwaitingEmpty = currentAwaiting?.valid && currentAwaiting.ids.length === 0;
  if (!candidateAwaiting?.valid) {
    failures.push(
      `candidateSourceHead AWAITING_BASELINE must be a static literal Set: ${candidateAwaiting?.failure ?? "missing suite"}`,
    );
  } else if (!candidateAwaitingAdoptable) {
    failures.push(
      "candidateSourceHead AWAITING_BASELINE must be either the canonical six ids (first adoption) or empty (refresh)",
    );
  }
  if (!currentAwaiting?.valid) {
    failures.push(
      `current AWAITING_BASELINE must be a static literal Set: ${currentAwaiting?.failure ?? "missing suite"}`,
    );
  } else if (!currentAwaitingEmpty) {
    failures.push("current AWAITING_BASELINE must be empty after committing all six baselines");
  }

  const normalizedCandidateSuite =
    candidateSuite === null || candidateAwaiting === null
      ? null
      : normalizeVisualSuiteAwaitingValues(candidateSuite, candidateAwaiting);
  const normalizedCurrentSuite =
    currentSuite === null || currentAwaiting === null
      ? null
      : normalizeVisualSuiteAwaitingValues(currentSuite, currentAwaiting);
  // Normalisation blanks the AWAITING_BASELINE values on both sides, so this stays
  // exact for a refresh (where the suite is byte-identical) as well as for the
  // first adoption (where only those values moved).
  const visualSuiteOnlyChangedAwaiting =
    candidateAwaitingAdoptable &&
    currentAwaitingEmpty &&
    normalizedCandidateSuite !== null &&
    normalizedCandidateSuite === normalizedCurrentSuite;
  if (!visualSuiteOnlyChangedAwaiting)
    failures.push("visual suite changed after candidate capture beyond the AWAITING_BASELINE declaration");

  const changedOutput = gitOutput(root, [
    "diff",
    "--no-ext-diff",
    "--no-renames",
    "--name-only",
    "-z",
    candidateSourceHead,
    "--",
  ]);
  const untrackedOutput = gitOutput(root, ["ls-files", "--others", "--exclude-standard", "-z"]);
  if (changedOutput === null || untrackedOutput === null) {
    failures.push("visual baseline source binding could not inspect post-candidate repository changes");
    return failures;
  }
  const changedPaths = new Set(
    [...changedOutput.split("\0"), ...untrackedOutput.split("\0")].filter(Boolean).map(toPosix),
  );
  const allowedPaths = new Set([
    ...policy.sourceBinding.allowedChangedPaths,
    ...policy.canonicalCandidates.map((candidate) => candidate.path),
  ]);
  if (visualSuiteOnlyChangedAwaiting) allowedPaths.add(visualSuiteFile);
  for (const changedPath of [...changedPaths].sort()) {
    if (!allowedPaths.has(changedPath))
      failures.push(`post-candidate repository change is not baseline-only: ${changedPath}`);
  }
  return failures;
}

export function validateLinuxVisualBaselineSet(
  baselinePaths,
  { root = ROOT, trackedFiles = trackedFilesForRoot(root) } = {},
) {
  const declaredPaths = [...new Set(baselinePaths)].sort();
  if (declaredPaths.length === 0) return [];
  const failures = [];
  const provenancePath = CANONICAL_VISUAL_BASELINE_POLICY.provenanceFile;
  for (const reason of validateAdoptionArtifactPath(provenancePath, {
    root,
    trackedFiles,
    kind: "baseline-provenance",
  }))
    failures.push(`visual baseline provenance ${provenancePath}: ${reason}`);
  if (!exists(provenancePath, root) || !fs.statSync(path.join(root, provenancePath)).isFile()) return failures;

  let provenance;
  try {
    provenance = JSON.parse(read(provenancePath, root));
  } catch {
    failures.push("visual baseline provenance must contain valid JSON");
    return failures;
  }
  if (provenance.schemaVersion !== CANONICAL_VISUAL_BASELINE_POLICY.provenanceSchemaVersion)
    failures.push("visual baseline provenance has an unsupported schema version");
  if (provenance.platform !== CANONICAL_VISUAL_BASELINE_POLICY.requiredPlatform)
    failures.push("visual baseline provenance platform must be linux");
  if (provenance.runnerImage !== CANONICAL_VISUAL_BASELINE_POLICY.requiredRunnerImage)
    failures.push("visual baseline provenance runnerImage must be ubuntu-24.04");
  failures.push(
    ...validateCandidateSourceBinding(provenance.candidateSourceHead, {
      root,
      policy: CANONICAL_VISUAL_BASELINE_POLICY,
    }),
  );
  if (
    provenance.review?.status !== CANONICAL_VISUAL_BASELINE_POLICY.requiredReviewStatus ||
    provenance.review?.reviewerType !== "human" ||
    provenance.review?.candidateSourceHead !== provenance.candidateSourceHead ||
    typeof provenance.review?.reviewedBy !== "string" ||
    provenance.review.reviewedBy.trim() === "" ||
    typeof provenance.review?.reviewedAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(provenance.review.reviewedAt) ||
    Number.isNaN(Date.parse(provenance.review.reviewedAt))
  ) {
    failures.push("visual baseline provenance requires an approved timestamped human review");
  }
  const runId = provenance.source?.runId;
  if (
    provenance.source?.kind !== "hosted-ci-artifact" ||
    provenance.source?.candidateSourceHead !== provenance.candidateSourceHead ||
    typeof runId !== "string" ||
    !/^\d+$/.test(runId) ||
    provenance.source?.artifactName !== `visual-baseline-${runId}`
  ) {
    failures.push("visual baseline provenance requires a matching hosted-CI artifact source");
  }

  const candidates = Array.isArray(provenance.candidates) ? provenance.candidates : [];
  if (candidates.length !== CANONICAL_VISUAL_BASELINE_POLICY.requiredCandidateCount)
    failures.push(
      `visual baseline provenance must contain exactly ${CANONICAL_VISUAL_BASELINE_POLICY.requiredCandidateCount} candidates`,
    );
  const candidatePaths = candidates.map((candidate) => candidate?.path).filter((entry) => typeof entry === "string");
  if (new Set(candidatePaths).size !== candidatePaths.length)
    failures.push("visual baseline provenance candidate paths must be unique");
  const candidateIds = candidates.map((candidate) => candidate?.id).filter((entry) => typeof entry === "string");
  if (new Set(candidateIds).size !== candidateIds.length)
    failures.push("visual baseline provenance candidate ids must be unique");
  const observedCandidateSet = candidates
    .filter((candidate) => candidate && typeof candidate.id === "string" && typeof candidate.path === "string")
    .map(({ id, path: candidatePath }) => ({ id, path: candidatePath }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const canonicalCandidateSet = [...CANONICAL_VISUAL_BASELINE_POLICY.canonicalCandidates].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  if (JSON.stringify(observedCandidateSet) !== JSON.stringify(canonicalCandidateSet))
    failures.push("visual baseline provenance candidates must exactly match the canonical six ids and paths");

  for (const candidate of candidates) {
    if (!candidate || typeof candidate.id !== "string" || typeof candidate.path !== "string") {
      failures.push("visual baseline provenance candidate is missing an id or path");
      continue;
    }
    const pathFailures = validateAdoptionArtifactPath(candidate.path, {
      root,
      trackedFiles,
      kind: "visual-baseline",
    });
    for (const reason of pathFailures)
      failures.push(`visual baseline provenance candidate ${candidate.path}: ${reason}`);
    if (pathFailures.length > 0) continue;
    const image = fs.readFileSync(path.join(root, candidate.path));
    const inspected = inspectPng(image);
    const sha256 = createHash("sha256").update(image).digest("hex");
    if (candidate.sha256 !== sha256)
      failures.push(`visual baseline provenance candidate ${candidate.path} has a SHA-256 mismatch`);
    if (candidate.width !== inspected.width || candidate.height !== inspected.height)
      failures.push(`visual baseline provenance candidate ${candidate.path} dimensions do not match the PNG`);
  }

  const sortedCandidatePaths = [...candidatePaths].sort();
  const canonicalPaths = CANONICAL_VISUAL_BASELINE_POLICY.canonicalCandidates.map((candidate) => candidate.path).sort();
  if (JSON.stringify(declaredPaths) !== JSON.stringify(canonicalPaths))
    failures.push("committed surface baselines must exactly match the canonical six Linux targets");
  if (JSON.stringify(sortedCandidatePaths) !== JSON.stringify(declaredPaths))
    failures.push("committed surface baselines must exactly match the six reviewed Linux provenance candidates");
  return failures;
}

function walk(directory, root = ROOT) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return walk(absolute, root);
    if (!SOURCE_EXTENSIONS.has(path.extname(entry.name))) return [];
    const relative = toPosix(path.relative(root, absolute));
    return relative.includes("/mockups/") || relative.includes("-mockup") ? [] : [relative];
  });
}

export function productionPageRoutes(root = ROOT) {
  return walk(path.join(root, "src", "app"), root)
    .filter(
      (relativePath) =>
        /\/page\.(?:ts|tsx)$/.test(relativePath) &&
        !relativePath.includes("/api/") &&
        !relativePath.includes("/mockups/"),
    )
    .sort();
}

export function productionNextUiEntries(root = ROOT) {
  return walk(path.join(root, "src", "app"), root)
    .filter(
      (relativePath) =>
        !relativePath.includes("/api/") &&
        !relativePath.includes("/mockups/") &&
        NEXT_UI_ENTRY_BASENAMES.has(path.posix.basename(relativePath).replace(/\.tsx?$/, "")),
    )
    .sort();
}

export function analyzeNextRedirectOnlyRoute(relativePath, sourceText) {
  const source = ts.createSourceFile(relativePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const redirectNames = new Set();
  let hasJsx = false;
  let defaultFunction = null;

  function hasModifier(node, kind) {
    return ts.canHaveModifiers(node) && ts.getModifiers(node)?.some((modifier) => modifier.kind === kind);
  }

  for (const statement of source.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === "next/navigation" &&
      statement.importClause?.namedBindings &&
      ts.isNamedImports(statement.importClause.namedBindings)
    ) {
      for (const element of statement.importClause.namedBindings.elements) {
        if ((element.propertyName ?? element.name).text === "redirect") redirectNames.add(element.name.text);
      }
    }
    if (
      ts.isFunctionDeclaration(statement) &&
      hasModifier(statement, ts.SyntaxKind.DefaultKeyword) &&
      hasModifier(statement, ts.SyntaxKind.ExportKeyword)
    ) {
      defaultFunction = statement;
    }
  }

  function collectJsx(node) {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) hasJsx = true;
    ts.forEachChild(node, collectJsx);
  }
  collectJsx(source);

  function isRedirectCall(expression) {
    const current = unwrapExpression(expression);
    return (
      ts.isCallExpression(current) && ts.isIdentifier(current.expression) && redirectNames.has(current.expression.text)
    );
  }

  function statementOutcomes(statement) {
    if (ts.isExpressionStatement(statement) && isRedirectCall(statement.expression)) return new Set(["redirect"]);
    if (ts.isReturnStatement(statement))
      return new Set([statement.expression && isRedirectCall(statement.expression) ? "redirect" : "other-terminal"]);
    if (ts.isThrowStatement(statement)) return new Set(["other-terminal"]);
    if (ts.isBlock(statement)) return statementsOutcomes(statement.statements);
    if (ts.isIfStatement(statement)) {
      const outcomes = statementOutcomes(statement.thenStatement);
      const otherwise = statement.elseStatement ? statementOutcomes(statement.elseStatement) : new Set(["continue"]);
      return new Set([...outcomes, ...otherwise]);
    }
    // Complex control flow is not accepted as redirect-only without a dedicated proof.
    if (
      ts.isSwitchStatement(statement) ||
      ts.isTryStatement(statement) ||
      ts.isForStatement(statement) ||
      ts.isForInStatement(statement) ||
      ts.isForOfStatement(statement) ||
      ts.isWhileStatement(statement) ||
      ts.isDoStatement(statement)
    ) {
      return new Set(["continue", "other-terminal"]);
    }
    return new Set(["continue"]);
  }

  function statementsOutcomes(statements) {
    let outcomes = new Set(["continue"]);
    for (const statement of statements) {
      const next = new Set();
      for (const outcome of outcomes) {
        if (outcome === "continue") for (const result of statementOutcomes(statement)) next.add(result);
        else next.add(outcome);
      }
      outcomes = next;
    }
    return outcomes;
  }

  const outcomes = defaultFunction?.body ? [...statementsOutcomes(defaultFunction.body.statements)].sort() : [];
  return {
    importsNextRedirect: redirectNames.size > 0,
    hasDefaultFunction: Boolean(defaultFunction?.body),
    hasJsx,
    terminalOutcomes: outcomes,
    redirectOnly:
      redirectNames.size > 0 &&
      Boolean(defaultFunction?.body) &&
      !hasJsx &&
      outcomes.length === 1 &&
      outcomes[0] === "redirect",
  };
}

function sourceFile(relativePath, root = ROOT) {
  const key = `${root}:${relativePath}`;
  if (!SOURCE_FILE_CACHE.has(key))
    SOURCE_FILE_CACHE.set(
      key,
      ts.createSourceFile(relativePath, read(relativePath, root), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX),
    );
  return SOURCE_FILE_CACHE.get(key);
}

function exportedNames(relativePath, root = ROOT) {
  if (!exists(relativePath, root)) return [];
  const source = sourceFile(relativePath, root);
  const names = new Set();
  for (const statement of source.statements) {
    const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined;
    const exported = modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
    if (exported && "name" in statement && statement.name && ts.isIdentifier(statement.name))
      names.add(statement.name.text);
    if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) names.add(element.name.text);
    }
  }
  return [...names].sort();
}

function resolveImport(importer, specifier, root = ROOT) {
  let candidate;
  if (specifier.startsWith("@/")) candidate = `src/${specifier.slice(2)}`;
  else if (specifier.startsWith(".")) candidate = toPosix(path.normalize(path.join(path.dirname(importer), specifier)));
  else return null;
  const candidates = path.extname(candidate)
    ? [candidate]
    : [`${candidate}.ts`, `${candidate}.tsx`, `${candidate}/index.ts`, `${candidate}/index.tsx`];
  return candidates.find((entry) => exists(entry, root)) ?? (path.extname(candidate) ? candidate : `${candidate}.tsx`);
}

function importFacts(relativePath, sourceMap, root = ROOT) {
  if (!exists(relativePath, root)) return [];
  const cacheKey = `${root}:${relativePath}`;
  if (IMPORT_FACT_CACHE.has(cacheKey)) return IMPORT_FACT_CACHE.get(cacheKey);
  const source = sourceFile(relativePath, root);
  const facts = [];
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const resolved = resolveImport(relativePath, statement.moduleSpecifier.text, root);
    const imported =
      statement.importClause?.namedBindings && ts.isNamedImports(statement.importClause.namedBindings)
        ? statement.importClause.namedBindings.elements.map((element) => element.name.text).sort()
        : [];
    for (const [component, componentSource] of Object.entries(sourceMap)) {
      const matchesSource = resolved === componentSource || resolved === componentSource.replace(/\.tsx$/, ".ts");
      if (matchesSource && (imported.length === 0 || imported.includes(component))) facts.push(component);
    }
  }
  const result = [...new Set(facts)].sort();
  IMPORT_FACT_CACHE.set(cacheKey, result);
  return result;
}

function sourceImports(relativePath, root = ROOT) {
  if (!exists(relativePath, root)) return [];
  const cacheKey = `${root}:${relativePath}`;
  if (SOURCE_IMPORT_CACHE.has(cacheKey)) return SOURCE_IMPORT_CACHE.get(cacheKey);
  const source = sourceFile(relativePath, root);
  const specifiers = [];
  function collect(node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      specifiers.push(node.arguments[0].text);
    }
    ts.forEachChild(node, collect);
  }
  collect(source);
  const result = [
    ...new Set(
      specifiers
        .map((specifier) => resolveImport(relativePath, specifier, root))
        .filter((resolved) => resolved && exists(resolved, root)),
    ),
  ].sort();
  SOURCE_IMPORT_CACHE.set(cacheKey, result);
  return result;
}

export function reachableSourceFiles(entryFiles, { root = ROOT } = {}) {
  const reachable = new Set();
  const pending = [...new Set(entryFiles)].filter((file) => exists(file, root));
  while (pending.length) {
    const file = pending.pop();
    if (reachable.has(file)) continue;
    reachable.add(file);
    for (const dependency of sourceImports(file, root)) if (!reachable.has(dependency)) pending.push(dependency);
  }
  return reachable;
}

const UNKNOWN_CLASS_FRAGMENT = "\u0000";
const CLASS_NAME_HELPERS = new Set(["cn", "clsx", "classnames", "classNames", "cx", "cva", "twMerge"]);
const MAX_CLASS_PATTERNS = 64;
const SURFACE_PROOF_STATUSES = new Set(["passed", "pending", "unverified", "not-applicable"]);
const BASELINE_STATUSES = new Set(["committed", "not-committed", "not-applicable"]);

function classTokenPresent(value) {
  return value.split(/\s+/).includes("ckb-v2");
}

function couldConstructCkbV2(value) {
  if (!value.includes(UNKNOWN_CLASS_FRAGMENT)) return classTokenPresent(value);
  const staticText = value.replaceAll(UNKNOWN_CLASS_FRAGMENT, "").toLowerCase();
  if (!staticText.includes("ckb") && !staticText.includes("v2")) return false;
  const replacements = ["", "ckb-v2", "ckb-", "v2", "-", " ", " ckb-v2 "];
  let candidates = [value];
  while (candidates.some((candidate) => candidate.includes(UNKNOWN_CLASS_FRAGMENT))) {
    const next = [];
    for (const candidate of candidates) {
      const marker = candidate.indexOf(UNKNOWN_CLASS_FRAGMENT);
      if (marker < 0) {
        next.push(candidate);
        continue;
      }
      for (const replacement of replacements) {
        next.push(`${candidate.slice(0, marker)}${replacement}${candidate.slice(marker + 1)}`);
        if (next.length >= MAX_CLASS_PATTERNS) break;
      }
      if (next.length >= MAX_CLASS_PATTERNS) break;
    }
    candidates = next;
    if (candidates.length >= MAX_CLASS_PATTERNS) break;
  }
  return candidates.some(classTokenPresent);
}

function unwrapExpression(expression) {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current) ||
    (ts.isSatisfiesExpression?.(current) ?? false)
  ) {
    current = current.expression;
  }
  return current;
}

function combineClassPatterns(groups, separator, constructed = false) {
  let combined = [{ value: "", constructed: false }];
  for (const group of groups) {
    const next = [];
    for (const left of combined) {
      for (const right of group) {
        next.push({
          value: left.value ? `${left.value}${separator}${right.value}` : right.value,
          constructed: constructed || left.constructed || right.constructed,
        });
        if (next.length >= MAX_CLASS_PATTERNS) break;
      }
      if (next.length >= MAX_CLASS_PATTERNS) break;
    }
    combined = next;
  }
  return combined;
}

/**
 * Parse only class-bearing expressions. A literal `ckb-v2` token is a normal
 * opt-in; any concatenation/template/join that can synthesize that token is a
 * dynamic opt-in and fails the adoption contract.
 *
 * @param {string} relativePath
 * @param {string} sourceText
 * @param {{ elementName?: string | null }} [options]
 */
export function analyzeCkbV2ClassUsage(relativePath, sourceText, { elementName = null } = {}) {
  const source = ts.createSourceFile(relativePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const bindings = [];
  const classExpressions = [];
  const classSpreadExpressions = [];

  function propertyName(node) {
    if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) return node.text;
    return null;
  }

  function isFunctionScope(node) {
    return (
      ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isConstructorDeclaration(node) ||
      ts.isGetAccessorDeclaration(node) ||
      ts.isSetAccessorDeclaration(node)
    );
  }

  function isLexicalScope(node) {
    return (
      ts.isSourceFile(node) ||
      ts.isBlock(node) ||
      ts.isModuleBlock(node) ||
      ts.isCaseBlock(node) ||
      ts.isForStatement(node) ||
      ts.isForInStatement(node) ||
      ts.isForOfStatement(node)
    );
  }

  function bindingScope(declaration) {
    if (ts.isParameter(declaration) && isFunctionScope(declaration.parent)) return declaration.parent;
    const declarationList = declaration.parent;
    const blockScoped =
      ts.isVariableDeclarationList(declarationList) && (declarationList.flags & ts.NodeFlags.BlockScoped) !== 0;
    let current = declarationList.parent;
    while (current) {
      if (blockScoped && isLexicalScope(current)) return current;
      if (!blockScoped && (isFunctionScope(current) || ts.isSourceFile(current))) return current;
      current = current.parent;
    }
    return source;
  }

  function isWithinScope(node, scope) {
    let current = node;
    while (current) {
      if (current === scope) return true;
      current = current.parent;
    }
    return false;
  }

  function scopeDepth(scope) {
    let depth = 0;
    let current = scope;
    while (current.parent) {
      depth += 1;
      current = current.parent;
    }
    return depth;
  }

  function collect(node) {
    if ((ts.isVariableDeclaration(node) || ts.isParameter(node)) && ts.isIdentifier(node.name)) {
      const scope = bindingScope(node);
      bindings.push({ declaration: node, scope, depth: scopeDepth(scope) });
    }
    if (ts.isJsxAttribute(node) && ["class", "className"].includes(node.name.getText(source))) {
      const openingElement = node.parent.parent;
      const ownerName =
        ts.isJsxOpeningElement(openingElement) || ts.isJsxSelfClosingElement(openingElement)
          ? openingElement.tagName.getText(source)
          : null;
      if (elementName && ownerName !== elementName) {
        ts.forEachChild(node, collect);
        return;
      }
      if (node.initializer && ts.isStringLiteral(node.initializer)) classExpressions.push(node.initializer);
      if (node.initializer && ts.isJsxExpression(node.initializer) && node.initializer.expression)
        classExpressions.push(node.initializer.expression);
    }
    if (ts.isJsxSpreadAttribute(node)) {
      const openingElement = node.parent.parent;
      const ownerName =
        ts.isJsxOpeningElement(openingElement) || ts.isJsxSelfClosingElement(openingElement)
          ? openingElement.tagName.getText(source)
          : null;
      if (elementName && ownerName === elementName) classSpreadExpressions.push(node.expression);
    }
    if (!elementName && ts.isPropertyAssignment(node) && ["class", "className"].includes(propertyName(node.name))) {
      classExpressions.push(node.initializer);
    }
    ts.forEachChild(node, collect);
  }
  collect(source);

  function resolveBinding(identifier) {
    const referencePosition = identifier.getStart(source);
    const visible = bindings
      .filter(
        (binding) => binding.declaration.name.text === identifier.text && isWithinScope(identifier, binding.scope),
      )
      .sort((left, right) => {
        if (left.depth !== right.depth) return right.depth - left.depth;
        const leftPosition = left.declaration.getStart(source);
        const rightPosition = right.declaration.getStart(source);
        const leftPrecedes = leftPosition <= referencePosition;
        const rightPrecedes = rightPosition <= referencePosition;
        if (leftPrecedes !== rightPrecedes) return leftPrecedes ? -1 : 1;
        return leftPrecedes ? rightPosition - leftPosition : leftPosition - rightPosition;
      });
    return visible[0] ?? null;
  }

  function arrayElements(expression, seen) {
    const current = unwrapExpression(expression);
    if (ts.isArrayLiteralExpression(current)) return [...current.elements];
    if (
      ts.isCallExpression(current) &&
      ts.isPropertyAccessExpression(current.expression) &&
      current.expression.name.text === "filter"
    ) {
      return arrayElements(current.expression.expression, seen);
    }
    if (ts.isIdentifier(current)) {
      const binding = resolveBinding(current);
      if (binding?.declaration.initializer && !seen.has(binding.declaration)) {
        return arrayElements(binding.declaration.initializer, new Set(seen).add(binding.declaration));
      }
    }
    return null;
  }

  function unresolvedCallHasCkbV2Evidence(call) {
    const evidence = [];
    function collectEvidence(node) {
      if (ts.isStringLiteralLike(node) || ts.isIdentifier(node)) evidence.push(node.text.toLowerCase());
      ts.forEachChild(node, collectEvidence);
    }
    collectEvidence(call);
    const staticText = evidence.join(" ");
    return staticText.includes("ckb") && staticText.includes("v2");
  }

  function patternsFor(expression, seen = new Set()) {
    const current = unwrapExpression(expression);
    if (ts.isStringLiteralLike(current)) return [{ value: current.text, constructed: false }];
    if (ts.isNumericLiteral(current)) return [{ value: current.text, constructed: false }];
    if (current.kind === ts.SyntaxKind.TrueKeyword || current.kind === ts.SyntaxKind.FalseKeyword)
      return [{ value: "", constructed: false }];
    if (ts.isIdentifier(current)) {
      const binding = resolveBinding(current);
      if (!binding?.declaration.initializer || seen.has(binding.declaration))
        return [{ value: UNKNOWN_CLASS_FRAGMENT, constructed: false }];
      return patternsFor(binding.declaration.initializer, new Set(seen).add(binding.declaration));
    }
    if (ts.isTemplateExpression(current)) {
      let combined = [{ value: current.head.text, constructed: true }];
      for (const span of current.templateSpans) {
        combined = combineClassPatterns([combined, patternsFor(span.expression, seen)], "", true).map((entry) => ({
          value: `${entry.value}${span.literal.text}`,
          constructed: true,
        }));
      }
      return combined;
    }
    if (ts.isConditionalExpression(current)) {
      return [...patternsFor(current.whenTrue, seen), ...patternsFor(current.whenFalse, seen)].slice(
        0,
        MAX_CLASS_PATTERNS,
      );
    }
    if (ts.isBinaryExpression(current)) {
      if (current.operatorToken.kind === ts.SyntaxKind.PlusToken)
        return combineClassPatterns([patternsFor(current.left, seen), patternsFor(current.right, seen)], "", true);
      if (
        current.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
        current.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
        current.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
      ) {
        return [
          { value: "", constructed: false },
          ...patternsFor(current.left, seen),
          ...patternsFor(current.right, seen),
        ].slice(0, MAX_CLASS_PATTERNS);
      }
    }
    if (ts.isCallExpression(current)) {
      if (ts.isPropertyAccessExpression(current.expression) && current.expression.name.text === "replace") {
        const receivers = patternsFor(current.expression.expression, seen);
        const searches = current.arguments[0]
          ? patternsFor(current.arguments[0], seen)
          : [{ value: UNKNOWN_CLASS_FRAGMENT, constructed: false }];
        const replacements = current.arguments[1]
          ? patternsFor(current.arguments[1], seen)
          : [{ value: "undefined", constructed: false }];
        const results = [];
        for (const receiver of receivers) {
          for (const search of searches) {
            for (const replacement of replacements) {
              const resolvable = ![receiver.value, search.value, replacement.value].some((value) =>
                value.includes(UNKNOWN_CLASS_FRAGMENT),
              );
              results.push({
                value: resolvable
                  ? receiver.value.replace(search.value, replacement.value)
                  : unresolvedCallHasCkbV2Evidence(current)
                    ? "ckb-v2"
                    : UNKNOWN_CLASS_FRAGMENT,
                constructed: true,
              });
              if (results.length >= MAX_CLASS_PATTERNS) return results;
            }
          }
        }
        return results;
      }
      if (ts.isPropertyAccessExpression(current.expression) && current.expression.name.text === "join") {
        const elements = arrayElements(current.expression.expression, seen);
        if (elements) {
          const separators = current.arguments[0]
            ? patternsFor(current.arguments[0], seen)
            : [{ value: ",", constructed: false }];
          const results = [];
          for (const separator of separators) {
            results.push(
              ...combineClassPatterns(
                elements.map((element) => patternsFor(element, seen)),
                separator.value,
                true,
              ),
            );
            if (results.length >= MAX_CLASS_PATTERNS) break;
          }
          return results.slice(0, MAX_CLASS_PATTERNS);
        }
      }
      const helperName = ts.isIdentifier(current.expression)
        ? current.expression.text
        : ts.isPropertyAccessExpression(current.expression)
          ? current.expression.name.text
          : "";
      if (CLASS_NAME_HELPERS.has(helperName)) {
        return combineClassPatterns(
          current.arguments.map((argument) => patternsFor(argument, seen)),
          " ",
        );
      }
      return [
        {
          value: unresolvedCallHasCkbV2Evidence(current) ? "ckb-v2" : UNKNOWN_CLASS_FRAGMENT,
          constructed: unresolvedCallHasCkbV2Evidence(current),
        },
      ];
    }
    if (ts.isArrayLiteralExpression(current)) {
      return combineClassPatterns(
        current.elements.map((element) => patternsFor(element, seen)),
        " ",
      );
    }
    if (ts.isObjectLiteralExpression(current)) {
      const classKeys = current.properties.flatMap((property) => {
        if (ts.isPropertyAssignment(property)) {
          if (ts.isComputedPropertyName(property.name)) return patternsFor(property.name.expression, seen);
          const name = propertyName(property.name);
          return name ? [{ value: name, constructed: false }] : [];
        }
        if (ts.isShorthandPropertyAssignment(property)) return patternsFor(property.name, seen);
        return [];
      });
      return combineClassPatterns(classKeys, " ");
    }
    return [{ value: UNKNOWN_CLASS_FRAGMENT, constructed: false }];
  }

  function classExpressionsFromSpread(expression, seen = new Set()) {
    const current = unwrapExpression(expression);
    if (ts.isIdentifier(current)) {
      const binding = resolveBinding(current);
      if (!binding?.declaration.initializer || seen.has(binding.declaration))
        return { expressions: [], unresolved: true };
      return classExpressionsFromSpread(binding.declaration.initializer, new Set(seen).add(binding.declaration));
    }
    if (ts.isConditionalExpression(current)) {
      const whenTrue = classExpressionsFromSpread(current.whenTrue, seen);
      const whenFalse = classExpressionsFromSpread(current.whenFalse, seen);
      return {
        expressions: [...whenTrue.expressions, ...whenFalse.expressions],
        unresolved: whenTrue.unresolved || whenFalse.unresolved,
      };
    }
    if (!ts.isObjectLiteralExpression(current)) return { expressions: [], unresolved: true };

    const expressions = [];
    let unresolved = false;
    for (const property of current.properties) {
      if (ts.isSpreadAssignment(property)) {
        const nested = classExpressionsFromSpread(property.expression, seen);
        expressions.push(...nested.expressions);
        unresolved ||= nested.unresolved;
        continue;
      }
      const name = ts.isComputedPropertyName(property.name)
        ? ts.isStringLiteralLike(property.name.expression)
          ? property.name.expression.text
          : null
        : propertyName(property.name);
      if (name === null) {
        unresolved = true;
        continue;
      }
      if (!["class", "className"].includes(name)) continue;
      if (ts.isPropertyAssignment(property)) expressions.push(property.initializer);
      else if (ts.isShorthandPropertyAssignment(property)) expressions.push(property.name);
      else unresolved = true;
    }
    return { expressions, unresolved };
  }

  let literalCkbV2 = false;
  let dynamicCkbV2 = false;
  function classifyClassExpression(expression) {
    const directTemplateLiteral = (() => {
      const current = unwrapExpression(expression);
      if (!ts.isTemplateExpression(current)) return false;
      return (
        classTokenPresent(current.head.text) ||
        current.templateSpans.some((span) => classTokenPresent(span.literal.text))
      );
    })();
    if (directTemplateLiteral) literalCkbV2 = true;
    for (const pattern of patternsFor(expression)) {
      if (!pattern.constructed && classTokenPresent(pattern.value)) literalCkbV2 = true;
      // A complete token authored directly in a template's static text remains
      // a literal opt-in even when unrelated classes (for example `dark`) are
      // interpolated beside it. Calls/joins/replacements still count as dynamic.
      if (!directTemplateLiteral && pattern.constructed && couldConstructCkbV2(pattern.value)) dynamicCkbV2 = true;
    }
  }
  for (const expression of classExpressions) classifyClassExpression(expression);
  for (const spreadExpression of classSpreadExpressions) {
    const spread = classExpressionsFromSpread(spreadExpression);
    if (spread.unresolved) dynamicCkbV2 = true;
    for (const expression of spread.expressions) classifyClassExpression(expression);
  }
  return { literalCkbV2, dynamicCkbV2 };
}

export function deriveSurfaceV2Observation({ globalShell, roots }) {
  const directV2MountFiles = roots
    .filter((rootFact) => rootFact.literalCkbV2)
    .map((rootFact) => rootFact.file)
    .sort();
  const inheritsGlobalV2 = Boolean(globalShell.literalCkbV2);
  const v2ShellMounted = inheritsGlobalV2 || directV2MountFiles.length > 0;
  return {
    observedShellState: v2ShellMounted ? "v2" : "compatibility",
    v2ShellMounted,
    v2MountMode: inheritsGlobalV2 ? "inherited-global-root" : directV2MountFiles.length > 0 ? "direct-literal" : "none",
    inheritedFrom: inheritsGlobalV2 ? globalShell.file : null,
    directV2MountFiles,
  };
}

export function manifestSections(manifest) {
  const componentRows = manifest.components.map(
    (component) =>
      `| \`${component.name}\` | ${component.family} | ${component.built ? "yes" : "no"} | ${component.locallyRegistered ? "yes" : "no"} | ${component.v2ShellMounted ? component.v2MountMode : "no"} | ${component.proofDeclared ? "yes" : "no"} | ${component.baselineCommitted ? "yes" : "no"} | ${component.productImportFiles.length} |`,
  );
  const maturity = [
    "<!-- adoption-manifest:maturity:start -->",
    "## Generated maturity snapshot",
    "",
    `Registered public components: ${manifest.summary.registeredComponentCount}`,
    `Components with a valid design-sync preview: ${manifest.summary.previewCount}`,
    `Components with product imports: ${manifest.summary.productImportedComponentCount}`,
    "",
    "This generated snapshot is a local source-derived inventory. It does not assert remote design-project publication.",
    "",
    "| Component | Family | Built | Locally registered | Observed v2 mount | Proof declared | Baseline committed | Product imports |",
    "| --- | --- | --- | --- | --- | --- | --- | ---: |",
    ...componentRows,
    "<!-- adoption-manifest:maturity:end -->",
  ].join("\n");
  const surfaceRows = manifest.surfaces.map((surface) => {
    const proofStatuses = [...new Set(Object.values(surface.proof).map((declaration) => declaration.status))];
    return `| \`${surface.id}\` | ${surface.disposition} | ${surface.routes.length} | ${surface.roots.length} | ${surface.declaredShellState} | ${surface.observedShellState} (${surface.v2MountMode}) | ${proofStatuses.join(", ")} | ${surface.baseline.status} |`;
  });
  const adoption = [
    "<!-- adoption-manifest:adoption:start -->",
    "## Generated adoption truth",
    "",
    "`generate-design-system-adoption.mjs` discovers every production `src/app/**/page.tsx` and",
    "requires each route to appear exactly once in `adoption-contract.json`. Undeclared, missing, or",
    "multiply-owned routes fail the check. `src/app/api/**` and `src/app/mockups/**` are non-page",
    "product exclusions; the only route-only dispositions are the documented legacy-redirect",
    "surfaces. Shared shell/component roots carry their own explicit `shared-shell` disposition.",
    "",
    `Registered public components: ${manifest.summary.registeredComponentCount}`,
    `Declared product roots: ${manifest.summary.rootCount}`,
    `Roots with a literal \`.ckb-v2\` opt-in: ${manifest.adoption.literalCkbV2RootCount}`,
    `Roots inheriting \`.ckb-v2\` from the global \`<html>\`: ${manifest.adoption.inheritedCkbV2RootCount}`,
    `Production surfaces observed under v2: ${manifest.adoption.v2MountedSurfaceCount}/${manifest.surfaces.length}`,
    `Dynamic \`ckb-v2\` constructions: ${manifest.adoption.dynamicCkbV2RootCount}`,
    `Declared production page routes: ${manifest.routeCoverage.declared.length}/${manifest.routeCoverage.discovered.length}`,
    "",
    "Source observation and contract declaration are independent. A literal `ckb-v2` on the global `<html>` makes every production surface inherit v2, but it does not approve that adoption.",
    "The Proof column summarizes each surface's dark, forced-colours, 320px, print and browser declarations; exact statuses and evidence paths live in the manifest.",
    "Observed v2 under a compatibility declaration fails closed. A declared v2 shell also fails closed unless every proof is passed with evidence and its visual baseline is committed or explicitly not-committed (pending Linux screenshot approval).",
    "",
    "| Surface | Disposition | Routes | Roots | Declared shell | Observed shell (mount) | Proof | Baseline |",
    "| --- | --- | ---: | ---: | --- | --- | --- | --- |",
    ...surfaceRows,
    "<!-- adoption-manifest:adoption:end -->",
  ].join("\n");
  return { maturity, adoption };
}

function extractMarkedSection(document, start, end) {
  const match = document.match(new RegExp(`${start}[\\s\\S]*?${end}`));
  return match?.[0] ?? null;
}

function normalizeMarkedSection(section) {
  if (!section) return null;
  return section
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => (/^\|[\s|:-]+\|$/.test(line) ? line.replace(/-+/g, "---") : line))
    .join("\n")
    .replace(/\s+/g, " ")
    .trim();
}

export function checkGeneratedAdoptionDocuments(manifest, { componentsDocument, adoptionDocument }) {
  const sections = manifestSections(manifest);
  const failures = [];
  const componentSection = extractMarkedSection(
    componentsDocument,
    "<!-- adoption-manifest:maturity:start -->",
    "<!-- adoption-manifest:maturity:end -->",
  );
  const adoptionSection = extractMarkedSection(
    adoptionDocument,
    "<!-- adoption-manifest:adoption:start -->",
    "<!-- adoption-manifest:adoption:end -->",
  );
  if (normalizeMarkedSection(componentSection) !== normalizeMarkedSection(sections.maturity))
    failures.push("docs/design-system/COMPONENTS.md generated maturity section is out of date");
  if (normalizeMarkedSection(adoptionSection) !== normalizeMarkedSection(sections.adoption))
    failures.push("docs/design-system/ADOPTION.md generated adoption section is out of date");
  return failures;
}

function replaceMarkedSection(document, start, end, replacement) {
  const expression = new RegExp(`${start}[\\s\\S]*?${end}`);
  return expression.test(document)
    ? document.replace(expression, replacement)
    : `${document.trimEnd()}\n\n${replacement}\n`;
}

function surfaceRootFiles(surface) {
  return [...(surface.routeRoots ? surface.routes : []), ...(surface.roots ?? [])]
    .filter((rootFile, index, files) => files.indexOf(rootFile) === index)
    .sort();
}

export function buildAdoptionManifest({ root = ROOT } = {}) {
  const contract = JSON.parse(read(CONTRACT_PATH, root));
  const config = JSON.parse(read(CONFIG_PATH, root));
  const sourceMap = config.componentSrcMap ?? {};
  // Directory enumeration order differs between Windows and Linux. Sort the
  // scanner inputs before filtering so generated import/test evidence is
  // byte-identical on developer machines and hosted CI.
  const sourceFiles = walk(path.join(root, "src"), root).sort();
  const testFiles = walk(path.join(root, "tests"), root).sort();
  const entry = read(".design-sync/entry.tsx", root);
  const globalShellDeclaration = contract.globalShellRoot ?? {
    file: "src/app/layout.tsx",
    element: "html",
  };
  const globalShellSource = exists(globalShellDeclaration.file, root) ? read(globalShellDeclaration.file, root) : "";
  const globalShellUsage = analyzeCkbV2ClassUsage(globalShellDeclaration.file, globalShellSource, {
    elementName: globalShellDeclaration.element,
  });
  const globalShell = {
    file: globalShellDeclaration.file,
    element: globalShellDeclaration.element,
    exists: Boolean(globalShellSource),
    ...globalShellUsage,
    observedShellState: globalShellUsage.literalCkbV2 ? "v2" : "compatibility",
  };
  const productionReachableFiles = reachableSourceFiles(
    [globalShell.file, ...productionNextUiEntries(root), ...contract.productionSurfaces.flatMap(surfaceRootFiles)],
    { root },
  );
  const componentInventory = Object.keys(contract.componentFamilies)
    .sort()
    .map((name) => {
      const source = sourceMap[name] ?? null;
      const sourceExports = source ? exportedNames(source, root) : [];
      const directImportFiles = sourceFiles.filter((file) => importFacts(file, sourceMap, root).includes(name));
      const productImportFiles = directImportFiles.filter((file) => productionReachableFiles.has(file));
      const preview = `.design-sync/previews/${name}.tsx`;
      const previewValid =
        exists(preview, root) &&
        new RegExp(`import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from\\s*["']${config.pkg}["']`).test(
          read(preview, root),
        );
      const testMatches = testFiles.filter((file) => new RegExp(`\\b${name}\\b`).test(read(file, root)));
      const entryExported = source
        ? (source === "src/components/ui-primitives.tsx" &&
            /export \* from ["']@\/components\/ui-primitives["']/.test(entry)) ||
          new RegExp(`export\\s*\\{[^}]*\\b${name}\\b[^}]*\\}`).test(entry)
        : false;
      return {
        name,
        family: contract.componentFamilies[name],
        source,
        sourceExported: sourceExports.includes(name),
        entryExported,
        directImportFiles,
        productImportFiles,
        designSync: {
          listedInSourceMap: Boolean(source),
          listedInDtsProps: Object.hasOwn(config.dtsPropsFor ?? {}, name),
          preview,
          previewValid,
        },
        testFiles: testMatches,
        baseline: contract.baseline,
      };
    });
  const surfaces = contract.productionSurfaces.map((surface) => {
    const rootFiles = surfaceRootFiles(surface);
    const nonVisualContract = contract.nonVisualRouteContracts?.[surface.id] ?? null;
    const nonVisualSource =
      nonVisualContract?.route && exists(nonVisualContract.route, root)
        ? analyzeNextRedirectOnlyRoute(nonVisualContract.route, read(nonVisualContract.route, root))
        : null;
    const nonVisualTopologyMatches = Boolean(
      nonVisualContract &&
      nonVisualContract.kind === "next-redirect-only" &&
      surface.routes.length === 1 &&
      surface.routes[0] === nonVisualContract.route &&
      !surface.routeRoots &&
      (surface.roots ?? []).length === 0 &&
      nonVisualSource?.redirectOnly,
    );
    const roots = rootFiles.map((rootFile) => {
      const sourceText = exists(rootFile, root) ? read(rootFile, root) : "";
      const imports = importFacts(rootFile, sourceMap, root);
      const importedFamilies = [...new Set(imports.map((name) => contract.componentFamilies[name]))].sort();
      const { literalCkbV2, dynamicCkbV2 } = analyzeCkbV2ClassUsage(rootFile, sourceText);
      return {
        file: rootFile,
        exists: Boolean(sourceText),
        imports,
        importedFamilies,
        literalCkbV2,
        dynamicCkbV2,
        v2MountMode: literalCkbV2 ? "direct-literal" : globalShell.literalCkbV2 ? "inherited-global-root" : "none",
        sanctionedPatternsPresent: surface.sanctionedSpecialPatterns.filter((pattern) => sourceText.includes(pattern)),
      };
    });
    const observation = deriveSurfaceV2Observation({ globalShell, roots });
    return {
      id: surface.id,
      disposition: surface.disposition,
      documentedDisposition: surface.documentedDisposition ?? null,
      routes: [...surface.routes].sort(),
      routeRoots: Boolean(surface.routeRoots),
      proofApplicability: nonVisualTopologyMatches ? "not-applicable" : contract.defaultProofApplicability,
      nonVisualRoute: nonVisualContract
        ? {
            contract: nonVisualContract,
            source: nonVisualSource,
            topologyMatches: nonVisualTopologyMatches,
          }
        : null,
      declaredShellState: surface.expectedShellState,
      ...observation,
      proof: Object.fromEntries(
        Object.entries(surface.proof ?? {}).sort(([left], [right]) => left.localeCompare(right)),
      ),
      baseline: surface.baseline
        ? { status: surface.baseline.status, files: [...(surface.baseline.files ?? [])].sort() }
        : null,
      permittedComponentFamilies: [...surface.permittedComponentFamilies].sort(),
      sanctionedSpecialPatterns: [...surface.sanctionedSpecialPatterns].sort(),
      roots,
    };
  });
  const components = componentInventory.map((component) => {
    const built = Boolean(component.source && component.sourceExported);
    const locallyRegistered = Boolean(
      component.entryExported &&
      component.designSync.listedInSourceMap &&
      component.designSync.listedInDtsProps &&
      component.designSync.previewValid,
    );
    const inheritedGlobalMount = globalShell.literalCkbV2 && component.productImportFiles.length > 0;
    const directSurfaceMount = surfaces.some(
      (surface) =>
        surface.v2MountMode === "direct-literal" &&
        surface.roots.some((rootFact) => rootFact.literalCkbV2 && rootFact.imports.includes(component.name)),
    );
    const v2ShellMounted = inheritedGlobalMount || directSurfaceMount;
    return {
      ...component,
      built,
      locallyRegistered,
      v2ShellMounted,
      v2MountMode: inheritedGlobalMount ? "inherited-global-root" : directSurfaceMount ? "direct-surface" : "none",
      proofDeclared: component.testFiles.length > 0,
      baselineCommitted: component.baseline.visualBaselineStatus === "committed",
    };
  });
  const literalCkbV2RootCount = surfaces
    .flatMap((surface) => surface.roots)
    .filter((rootFact) => rootFact.literalCkbV2).length;
  const dynamicCkbV2RootCount = surfaces
    .flatMap((surface) => surface.roots)
    .filter((rootFact) => rootFact.dynamicCkbV2).length;
  const inheritedCkbV2RootCount = surfaces
    .flatMap((surface) => surface.roots)
    .filter((rootFact) => rootFact.v2MountMode === "inherited-global-root").length;
  const discoveredRoutes = productionPageRoutes(root);
  const routeOwners = new Map();
  for (const surface of contract.productionSurfaces) {
    for (const route of surface.routes) {
      const owners = routeOwners.get(route) ?? [];
      owners.push(surface.id);
      routeOwners.set(route, owners);
    }
  }
  const declaredRoutes = [...routeOwners.keys()].sort();
  const undeclaredRoutes = discoveredRoutes.filter((route) => !routeOwners.has(route));
  const duplicateRoutes = [...routeOwners.entries()]
    .filter(([, owners]) => owners.length > 1)
    .map(([route, owners]) => ({ route, owners }))
    .sort((left, right) => left.route.localeCompare(right.route));
  const missingRoutes = declaredRoutes.filter((route) => !discoveredRoutes.includes(route));
  return {
    schemaVersion: contract.schemaVersion,
    baseline: contract.baseline,
    globalShell,
    requiredProofCategories: [...contract.requiredProofCategories],
    proofPolicy: {
      defaultApplicability: contract.defaultProofApplicability,
      nonVisualRoutes: contract.nonVisualRouteContracts,
      evidence: contract.proofEvidencePolicy,
      visualBaseline: contract.visualBaselinePolicy,
    },
    components,
    surfaces,
    routeCoverage: {
      discovered: discoveredRoutes,
      declared: declaredRoutes,
      undeclared: undeclaredRoutes,
      missing: missingRoutes,
      duplicates: duplicateRoutes,
    },
    adoption: {
      literalCkbV2RootCount,
      inheritedCkbV2RootCount,
      dynamicCkbV2RootCount,
      v2MountedSurfaceCount: surfaces.filter((surface) => surface.v2ShellMounted).length,
      declaredV2SurfaceCount: surfaces.filter((surface) => surface.declaredShellState === "v2").length,
    },
    summary: {
      registeredComponentCount: components.length,
      previewCount: components.filter((component) => component.designSync.previewValid).length,
      productImportedComponentCount: components.filter((component) => component.productImportFiles.length > 0).length,
      rootCount: surfaces.flatMap((surface) => surface.roots).length,
      productionRouteCount: discoveredRoutes.length,
      nextUiEntryCount: productionNextUiEntries(root).length,
    },
  };
}

export function checkAdoptionManifest(manifest, { root = ROOT, trackedFiles = trackedFilesForRoot(root) } = {}) {
  const contract = JSON.parse(read(CONTRACT_PATH, root));
  const failures = [];
  const globalShellDeclaration = contract.globalShellRoot ?? {};
  if (JSON.stringify(globalShellDeclaration) !== JSON.stringify(CANONICAL_GLOBAL_SHELL_ROOT))
    failures.push("globalShellRoot must remain src/app/layout.tsx / html");
  if (contract.defaultProofApplicability !== CANONICAL_DEFAULT_PROOF_APPLICABILITY)
    failures.push("default proof applicability must remain required");
  if (JSON.stringify(contract.nonVisualRouteContracts) !== JSON.stringify(CANONICAL_NON_VISUAL_ROUTES))
    failures.push("non-visual route contracts drifted from the canonical redirect-only routes");
  if (JSON.stringify(contract.proofEvidencePolicy) !== JSON.stringify(CANONICAL_PROOF_EVIDENCE_POLICY))
    failures.push("proof evidence path policy drifted from the canonical contract");
  if (JSON.stringify(contract.visualBaselinePolicy) !== JSON.stringify(CANONICAL_VISUAL_BASELINE_POLICY))
    failures.push("Linux visual baseline path policy drifted from the canonical contract");
  const visualSuitePath = CANONICAL_VISUAL_BASELINE_POLICY.sourceBinding.visualSuiteFile;
  const visualSuiteIds = exists(visualSuitePath, root)
    ? visualBaselineTargetIds(read(visualSuitePath, root), visualSuitePath)
    : null;
  const canonicalVisualTargetIds = CANONICAL_VISUAL_BASELINE_POLICY.canonicalCandidates
    .map((candidate) => candidate.id)
    .sort();
  if (JSON.stringify(visualSuiteIds) !== JSON.stringify(canonicalVisualTargetIds))
    failures.push("visual baseline suite targets must exactly match the canonical six ids");
  const expectedProofPolicy = {
    defaultApplicability: contract.defaultProofApplicability,
    nonVisualRoutes: contract.nonVisualRouteContracts,
    evidence: contract.proofEvidencePolicy,
    visualBaseline: contract.visualBaselinePolicy,
  };
  if (JSON.stringify(manifest.proofPolicy) !== JSON.stringify(expectedProofPolicy))
    failures.push("generated proof policy drifted from the adoption contract");
  if (!manifest.globalShell || typeof manifest.globalShell !== "object") {
    failures.push("global shell observation is missing");
  } else {
    if (!manifest.globalShell.exists) failures.push(`global shell root is missing: ${globalShellDeclaration.file}`);
    if (manifest.globalShell.file !== globalShellDeclaration.file)
      failures.push("global shell root drifted from adoption contract");
    if (manifest.globalShell.element !== globalShellDeclaration.element)
      failures.push("global shell element drifted from adoption contract");
    if (manifest.globalShell.dynamicCkbV2)
      failures.push(`global shell dynamically constructs ckb-v2: ${manifest.globalShell.file}`);
  }
  for (const component of manifest.components) {
    for (const fact of ["built", "locallyRegistered", "v2ShellMounted", "proofDeclared", "baselineCommitted"])
      if (typeof component[fact] !== "boolean") failures.push(`${component.name} is missing boolean ${fact} fact`);
    if (!new Set(["none", "inherited-global-root", "direct-surface"]).has(component.v2MountMode))
      failures.push(`${component.name} has invalid v2 mount mode: ${String(component.v2MountMode)}`);
    if (component.v2ShellMounted !== (component.v2MountMode !== "none"))
      failures.push(`${component.name} v2 mount boolean and mode disagree`);
    if (!component.source || !component.sourceExported)
      failures.push(`${component.name} is not exported from its declared source`);
    if (!component.entryExported) failures.push(`${component.name} is missing from .design-sync/entry.tsx`);
    if (!component.designSync.listedInDtsProps) failures.push(`${component.name} is missing dtsPropsFor metadata`);
    if (!component.designSync.previewValid) failures.push(`${component.name} is missing a valid design-sync preview`);
    if (component.testFiles.length === 0) failures.push(`${component.name} has no direct test proof`);
  }
  const contractSurfacesById = new Map(contract.productionSurfaces.map((surface) => [surface.id, surface]));
  const manifestSurfaceIds = manifest.surfaces.map((surface) => surface.id);
  if (new Set(manifestSurfaceIds).size !== manifestSurfaceIds.length)
    failures.push("generated adoption surfaces contain duplicate ids");
  for (const contractSurface of contract.productionSurfaces)
    if (!manifestSurfaceIds.includes(contractSurface.id))
      failures.push(`generated adoption surface is missing: ${contractSurface.id}`);
  const committedBaselinePaths = [];
  for (const surface of manifest.surfaces) {
    const contractSurface = contractSurfacesById.get(surface.id);
    if (!contractSurface) {
      failures.push(`generated adoption surface is undeclared: ${surface.id}`);
    } else {
      if (surface.disposition !== contractSurface.disposition)
        failures.push(`${surface.id} disposition drifted from the adoption contract`);
      if (JSON.stringify(surface.routes) !== JSON.stringify([...contractSurface.routes].sort()))
        failures.push(`${surface.id} routes drifted from the adoption contract`);
      if (surface.routeRoots !== Boolean(contractSurface.routeRoots))
        failures.push(`${surface.id} route-root ownership drifted from the adoption contract`);
      const expectedRootFiles = surfaceRootFiles(contractSurface);
      const observedRootFiles = surface.roots.map((rootFact) => rootFact.file).sort();
      if (JSON.stringify(observedRootFiles) !== JSON.stringify(expectedRootFiles))
        failures.push(`${surface.id} roots drifted from the adoption contract`);
      if (surface.documentedDisposition !== (contractSurface.documentedDisposition ?? null))
        failures.push(`${surface.id} documented disposition drifted from the adoption contract`);
    }
    if (!new Set(["compatibility", "v2"]).has(surface.declaredShellState))
      failures.push(`${surface.id} has invalid declared shell state: ${String(surface.declaredShellState)}`);
    if (!new Set(["compatibility", "v2"]).has(surface.observedShellState))
      failures.push(`${surface.id} has invalid observed shell state: ${String(surface.observedShellState)}`);
    if (!V2_MOUNT_MODES.has(surface.v2MountMode))
      failures.push(`${surface.id} has invalid v2 mount mode: ${String(surface.v2MountMode)}`);
    if (surface.v2ShellMounted !== (surface.observedShellState === "v2"))
      failures.push(`${surface.id} observed shell state and mount boolean disagree`);
    if (surface.declaredShellState === "compatibility" && surface.v2ShellMounted) {
      const source =
        surface.v2MountMode === "inherited-global-root"
          ? `global root ${surface.inheritedFrom}`
          : `direct root ${surface.directV2MountFiles.join(", ")}`;
      failures.push(`${surface.id} declares compatibility but observes v2 through ${source}`);
    }
    if (surface.declaredShellState === "v2" && !surface.v2ShellMounted)
      failures.push(`${surface.id} declares v2 but no literal source mount was observed`);
    const nonVisualContract = contract.nonVisualRouteContracts?.[surface.id] ?? null;
    const nonVisualSource =
      nonVisualContract?.route && exists(nonVisualContract.route, root)
        ? analyzeNextRedirectOnlyRoute(nonVisualContract.route, read(nonVisualContract.route, root))
        : null;
    const nonVisualTopologyMatches = Boolean(
      contractSurface &&
      nonVisualContract &&
      nonVisualContract.kind === "next-redirect-only" &&
      contractSurface.routes.length === 1 &&
      contractSurface.routes[0] === nonVisualContract.route &&
      !contractSurface.routeRoots &&
      (contractSurface.roots ?? []).length === 0 &&
      nonVisualSource?.redirectOnly,
    );
    const expectedProofApplicability = nonVisualTopologyMatches
      ? "not-applicable"
      : CANONICAL_DEFAULT_PROOF_APPLICABILITY;
    if (!PROOF_APPLICABILITY.has(surface.proofApplicability))
      failures.push(`${surface.id} has invalid proof applicability: ${String(surface.proofApplicability)}`);
    if (surface.proofApplicability !== expectedProofApplicability)
      failures.push(`${surface.id} proof applicability disagrees with its source-derived route topology`);
    const proofNotApplicable = nonVisualTopologyMatches && surface.proofApplicability === "not-applicable";
    if (surface.proofApplicability === "not-applicable" && !nonVisualTopologyMatches)
      failures.push(`${surface.id} may omit visual proof only when the pinned route is statically redirect-only`);
    if (nonVisualContract && !nonVisualSource?.redirectOnly)
      failures.push(`${surface.id} non-visual route source is not statically redirect-only`);
    const proof = surface.proof && typeof surface.proof === "object" ? surface.proof : {};
    const requiredProofCategories = Array.isArray(contract.requiredProofCategories)
      ? contract.requiredProofCategories
      : [];
    for (const category of requiredProofCategories) {
      const declaration = proof[category];
      if (!declaration || typeof declaration !== "object") {
        failures.push(`${surface.id} surface proof is missing ${category}`);
        continue;
      }
      if (!SURFACE_PROOF_STATUSES.has(declaration.status))
        failures.push(`${surface.id} ${category} proof has invalid status: ${String(declaration.status)}`);
      const validEvidence =
        Array.isArray(declaration.evidence) && declaration.evidence.every((entry) => typeof entry === "string");
      if (!validEvidence) failures.push(`${surface.id} ${category} proof evidence must be a string array`);
      if (declaration.status === "passed" && (!validEvidence || declaration.evidence.length === 0))
        failures.push(`${surface.id} ${category} proof is passed without evidence`);
      if (declaration.status === "passed" && validEvidence) {
        for (const evidencePath of declaration.evidence) {
          for (const reason of validateAdoptionArtifactPath(evidencePath, { root, trackedFiles, kind: "proof" }))
            failures.push(`${surface.id} ${category} proof evidence ${evidencePath}: ${reason}`);
        }
      }
      if (
        proofNotApplicable &&
        (declaration.status !== "not-applicable" || !validEvidence || declaration.evidence.length !== 0)
      )
        failures.push(`${surface.id} ${category} proof must remain not-applicable without evidence`);
      if (!proofNotApplicable && declaration.status === "not-applicable")
        failures.push(`${surface.id} ${category} proof is required for its visual disposition`);
      if (surface.declaredShellState === "v2" && !proofNotApplicable && declaration.status !== "passed")
        failures.push(`${surface.id} v2 adoption requires passed ${category} proof`);
    }
    for (const category of Object.keys(proof)) {
      if (!requiredProofCategories.includes(category))
        failures.push(`${surface.id} declares unknown surface proof category: ${category}`);
    }
    if (!surface.baseline || typeof surface.baseline !== "object") {
      failures.push(`${surface.id} surface baseline declaration is missing`);
    } else {
      if (!BASELINE_STATUSES.has(surface.baseline.status))
        failures.push(`${surface.id} surface baseline has invalid status: ${String(surface.baseline.status)}`);
      const validBaselineFiles =
        Array.isArray(surface.baseline.files) && surface.baseline.files.every((entry) => typeof entry === "string");
      if (!validBaselineFiles) failures.push(`${surface.id} surface baseline files must be a string array`);
      if (surface.baseline.status === "committed" && (!validBaselineFiles || surface.baseline.files.length === 0))
        failures.push(`${surface.id} surface baseline is committed without files`);
      if (surface.baseline.status === "not-committed" && validBaselineFiles && surface.baseline.files.length !== 0)
        failures.push(
          `${surface.id} surface baseline is not-committed but lists files; keep files empty until screenshots are committed`,
        );
      if (surface.baseline.status === "committed" && validBaselineFiles) {
        committedBaselinePaths.push(...surface.baseline.files);
        for (const baselinePath of surface.baseline.files) {
          for (const reason of validateAdoptionArtifactPath(baselinePath, {
            root,
            trackedFiles,
            kind: "visual-baseline",
          }))
            failures.push(`${surface.id} surface baseline ${baselinePath}: ${reason}`);
        }
      }
      if (
        proofNotApplicable &&
        (surface.baseline.status !== "not-applicable" || !validBaselineFiles || surface.baseline.files.length !== 0)
      )
        failures.push(`${surface.id} surface baseline must remain not-applicable without files`);
      if (!proofNotApplicable && surface.baseline.status === "not-applicable")
        failures.push(`${surface.id} visual disposition requires a surface baseline`);
      // Draft/CI path: declared v2 may remain not-committed with empty files until
      // human-approved Linux screenshots + provenance are committed. Only
      // not-applicable is forbidden for visual v2 surfaces.
      if (surface.declaredShellState === "v2" && !proofNotApplicable && surface.baseline.status === "not-applicable")
        failures.push(`${surface.id} v2 adoption requires a visual baseline (committed or not-committed)`);
    }
    for (const rootFact of surface.roots) {
      if (!rootFact.exists) failures.push(`${surface.id} root is missing: ${rootFact.file}`);
      if (rootFact.dynamicCkbV2) failures.push(`${surface.id} root dynamically constructs ckb-v2: ${rootFact.file}`);
      for (const family of rootFact.importedFamilies) {
        if (!surface.permittedComponentFamilies.includes(family))
          failures.push(`${surface.id} imports an unpermitted ${family} component`);
      }
    }
    if (surface.disposition !== "owned" && !surface.documentedDisposition)
      failures.push(`${surface.id} ${surface.disposition} disposition is undocumented`);
  }
  failures.push(...validateLinuxVisualBaselineSet(committedBaselinePaths, { root, trackedFiles }));
  for (const route of manifest.routeCoverage.undeclared) failures.push(`production page route is undeclared: ${route}`);
  for (const route of manifest.routeCoverage.missing)
    failures.push(`declared production page route is missing: ${route}`);
  for (const duplicate of manifest.routeCoverage.duplicates)
    failures.push(`production page route has multiple owners: ${duplicate.route} (${duplicate.owners.join(", ")})`);
  const sourceMapNames = Object.keys(JSON.parse(read(CONFIG_PATH, root)).componentSrcMap ?? {}).sort();
  const familyNames = Object.keys(contract.componentFamilies).sort();
  if (JSON.stringify(sourceMapNames) !== JSON.stringify(familyNames))
    failures.push("adoption componentFamilies must match the design-sync visual component registry");
  if (manifest.requiredProofCategories.join("|") !== contract.requiredProofCategories.join("|"))
    failures.push("required proof categories drifted from adoption contract");
  return failures;
}

async function writeOrCheck(relativePath, content, write) {
  const absolutePath = path.join(ROOT, relativePath);
  const prettierOptions = (await prettier.resolveConfig(absolutePath)) ?? {};
  const formatted = await prettier.format(content, { ...prettierOptions, filepath: absolutePath });
  const current = exists(relativePath) ? read(relativePath) : "";
  if (current === formatted) return [];
  if (write) {
    fs.mkdirSync(path.dirname(path.join(ROOT, relativePath)), { recursive: true });
    fs.writeFileSync(path.join(ROOT, relativePath), formatted);
    return [];
  }
  return [`${relativePath} is out of date; run npm run design-system:adoption:update`];
}

async function main() {
  const write = process.argv.includes("--write");
  const check = process.argv.includes("--check");
  if (write === check) throw new Error("Pass exactly one of --write or --check.");
  const manifest = buildAdoptionManifest();
  const failures = checkAdoptionManifest(manifest);
  if (check) {
    failures.push(
      ...checkGeneratedAdoptionDocuments(manifest, {
        componentsDocument: read("docs/design-system/COMPONENTS.md"),
        adoptionDocument: read("docs/design-system/ADOPTION.md"),
      }),
    );
  }
  const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
  failures.push(...(await writeOrCheck(MANIFEST_PATH, serialized, write)));
  const sections = manifestSections(manifest);
  failures.push(
    ...(await writeOrCheck(
      "docs/design-system/COMPONENTS.md",
      replaceMarkedSection(
        read("docs/design-system/COMPONENTS.md"),
        "<!-- adoption-manifest:maturity:start -->",
        "<!-- adoption-manifest:maturity:end -->",
        sections.maturity,
      ),
      write,
    )),
  );
  failures.push(
    ...(await writeOrCheck(
      "docs/design-system/ADOPTION.md",
      replaceMarkedSection(
        read("docs/design-system/ADOPTION.md"),
        "<!-- adoption-manifest:adoption:start -->",
        "<!-- adoption-manifest:adoption:end -->",
        sections.adoption,
      ),
      write,
    )),
  );
  if (failures.length) throw new Error(failures.join("\n"));
  process.stdout.write(
    `design-system adoption ${write ? "updated" : "checked"}: ${manifest.summary.registeredComponentCount} components, ${manifest.summary.rootCount} roots\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    throw error;
  });
}
