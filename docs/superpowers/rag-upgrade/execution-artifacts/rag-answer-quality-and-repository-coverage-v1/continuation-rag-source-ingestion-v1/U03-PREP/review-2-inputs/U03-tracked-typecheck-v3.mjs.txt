// Unexecuted U03 review candidate. This is not the repository-wide tsc CLI gate.
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, basename, isAbsolute, relative, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const OUT = 'C:/Users/joshs/Codex-Handoffs/Ingestion/Execution/20260907-continuation';
const generatorPath = resolve(OUT, 'U03-generate-next-ambient.mjs');
const GENERATOR_SHA256 = '5e030753100ff2c7fbc51a5893ba751e806f7b5a0a9b80a505a936a68b78caf4';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

async function main() {
  if (digest(readFileSync(generatorPath)) !== GENERATOR_SHA256) throw new Error('Reviewed generator/helper changed.');
  // Import-safe: the helper's CLI only runs when its own path is invoked directly.
  const { ROOT, MANIFEST_SHA256, hash, pathKey, within, git, readReviewedInputs, verifyContext, verifyPins, readRouteInventory, writeNewEvidence } = await import(pathToFileURL(generatorPath).href);
  const args = process.argv.slice(2);
  if (args.length > 1 || (args[0] && !/^--attempt=[a-z0-9][a-z0-9-]{0,39}$/.test(args[0]))) throw new Error('Use at most one --attempt=<short-lowercase-label>.');
  const attempt = args[0]?.slice('--attempt='.length) ?? 'initial';
  for (const suffix of ['inputs', 'result']) {
    if (existsSync(resolve(OUT, `U03-tracked-typecheck-v3-${attempt}-${suffix}.json`))) throw new Error('Attempt evidence already exists; choose a new --attempt label and preserve prior output.');
  }
  if (process.env.GATE_RECEIPTS !== 'off' || process.env.GATE_ARBITER !== 'off') throw new Error('Set process-local GATE_RECEIPTS=off and GATE_ARBITER=off; retain coordinator.');
  const input = readReviewedInputs();
  const startHead = verifyContext(input);
  verifyPins(input);
  readRouteInventory(input);
  const require = createRequire(resolve(ROOT, 'package.json'));
  const ts = require('typescript');
  if (ts.version !== input.typescriptVersion) throw new Error('Reviewed TypeScript version changed.');
  const { acquireHeavyRunLock } = await import(pathToFileURL(resolve(ROOT, 'scripts/test-run-lock.mjs')).href);
  const realRoot = realpathSync(ROOT);
  const lease = acquireHeavyRunLock({ projectRoot: ROOT, command: `U03 tracked source-health typecheck v3 (${attempt})`, mode: 'shared' });
  try {
    const readTracked = () => git(['ls-files', '--cached', '-z', '--', '.', ':(top,exclude)1', ':(top,exclude)1/**']).split('\0').filter(Boolean).sort();
    const tracked = readTracked();
    const trackedIdentity = hash(tracked.join('\n') + '\n');
    const violations = new Set();
    const forbidden = p => {
      if (!within(resolve(ROOT, '1'), p) && !within(resolve(realRoot, '1'), p)) return false;
      violations.add('Attempted protected repository path');
      return true;
    };
    const safeRelative = p => {
      if (typeof p !== 'string' || isAbsolute(p)) throw new Error('Compiler input must be repository-relative.');
      const normalized = relative(ROOT, resolve(ROOT, p)).replaceAll('\\', '/');
      if (!normalized || normalized !== p || normalized.startsWith('../') || isAbsolute(normalized) || forbidden(resolve(ROOT, normalized))) throw new Error('Disallowed exact compiler input.');
      return normalized;
    };
    const explicit = [...input.futureSourceFiles, ...input.generatedAmbient.files].map(safeRelative);
    const files = [...new Set([...tracked, ...explicit].map(safeRelative))];
    const allowedFiles = new Set(files.flatMap(p => [pathKey(resolve(ROOT, p)), pathKey(resolve(realRoot, p))]));
    const repoDirs = new Set();
    const children = new Map();
    for (const p of files) for (const base of [ROOT, realRoot]) {
      let d = dirname(resolve(base, p));
      while (within(base, d)) {
        repoDirs.add(pathKey(d));
        if (pathKey(d) === pathKey(base)) break;
        const parent = dirname(d);
        if (!children.has(pathKey(parent))) children.set(pathKey(parent), new Set());
        children.get(pathKey(parent)).add(basename(d));
        d = parent;
      }
    }
    // Preserve original and canonical-ancestry package/@types discovery. Probe only
    // exact node_modules roots; never enumerate their parent directories.
    const dependencyCandidates = new Set();
    for (const start of [ROOT, realRoot]) {
      let d = resolve(start);
      for (;;) {
        dependencyCandidates.add(resolve(d, 'node_modules'));
        const parent = dirname(d);
        if (parent === d) break;
        d = parent;
      }
    }
    const dependencyRoots = new Set();
    for (const p of dependencyCandidates) {
      if (forbidden(p)) throw new Error('Protected dependency root.');
      if (!ts.sys.directoryExists(p)) continue;
      const actual = realpathSync(p);
      if (forbidden(actual)) throw new Error('Dependency root resolves into protected content.');
      dependencyRoots.add(p);
      dependencyRoots.add(actual);
    }
    const inDependencies = p => [...dependencyRoots].some(base => within(base, p));
    const permittedFile = p => allowedFiles.has(pathKey(p)) || inDependencies(p);
    const permittedDirectory = p => repoDirs.has(pathKey(p)) || inDependencies(p);
    function canonicalExisting(p, directory = false) {
      if (forbidden(p)) return undefined;
      if (!(directory ? permittedDirectory(p) : permittedFile(p))) return undefined;
      if (!(directory ? ts.sys.directoryExists(p) : ts.sys.fileExists(p))) return undefined;
      let actual;
      try { actual = realpathSync(p); } catch (error) {
        if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return undefined;
        throw error;
      }
      if (forbidden(actual)) return undefined;
      if (!(directory ? permittedDirectory(actual) : permittedFile(actual))) {
        violations.add('Permitted path resolves outside tracked/explicit/dependency scope');
        return undefined;
      }
      return actual;
    }
    const readHashes = new Map();
    const safeRead = p => {
      const actual = canonicalExisting(p);
      if (actual === undefined) return undefined;
      const text = ts.sys.readFile(actual);
      if (text === undefined) return undefined;
      const identity = hash(text);
      const prior = readHashes.get(pathKey(actual));
      if (prior && prior.sha256 !== identity) violations.add('A compiler input changed while being read');
      readHashes.set(pathKey(actual), { path: actual, sha256: identity });
      return text;
    };
    const safeExists = p => canonicalExisting(p) !== undefined;
    const safeDirectoryExists = p => {
      if (forbidden(p)) return false;
      if (repoDirs.has(pathKey(p))) return true; // virtual tracked directories
      return inDependencies(p) && canonicalExisting(p, true) !== undefined;
    };
    const safeDirectories = p => {
      if (forbidden(p)) return [];
      if (repoDirs.has(pathKey(p))) return [...(children.get(pathKey(p)) ?? [])].sort();
      const actual = inDependencies(p) ? canonicalExisting(p, true) : undefined;
      return actual === undefined ? [] : ts.sys.getDirectories(actual);
    };
    const safeRealpath = p => canonicalExisting(p) ?? resolve(p);
    for (const p of [...explicit, ...input.requiredExistingRoots]) {
      if (!safeExists(resolve(ROOT, p))) throw new Error(`Required exact compiler input is absent: ${p}`);
    }
    const evidence = JSON.parse(readFileSync(resolve(OUT, input.generatedAmbient.evidenceFile), 'utf8'));
    if (evidence.schema !== 'u03-next-ambient-generation-v3' || evidence.inputManifestSha256 !== MANIFEST_SHA256 || evidence.generatorSha256 !== GENERATOR_SHA256 || evidence.identitiesUnchanged !== true) throw new Error('Ambient output lacks matching generation evidence.');
    if (JSON.stringify(Object.keys(evidence.outputs ?? {}).sort()) !== JSON.stringify([...input.generatedAmbient.files].sort())) throw new Error('Ambient evidence must bind all and only the three generated files.');
    for (const p of input.generatedAmbient.files) {
      const actual = canonicalExisting(resolve(ROOT, p));
      if (!actual || hash(readFileSync(actual)) !== evidence.outputs[p]) throw new Error(`Generated ambient bytes changed: ${p}`);
    }
    const rootConfigs = new Set([...input.rootConfigFiles, input.generatedAmbient.root]);
    const forcedRoots = new Set(input.forcedRoots);
    const roots = files.filter(p => /\.(?:ts|tsx|mts)$/.test(p) && (
      forcedRoots.has(p) || rootConfigs.has(p) || (input.rootPrefixes.some(prefix => p.startsWith(prefix)) && !p.startsWith('scripts/archive/'))
    )).sort().map(p => resolve(ROOT, p));
    for (const p of [...input.futureSourceFiles, ...input.requiredExistingRoots, input.generatedAmbient.root]) {
      if (!roots.some(r => pathKey(r) === pathKey(resolve(ROOT, p)))) throw new Error(`Required caller/new source omitted from roots: ${p}`);
    }
    if (roots.some(p => pathKey(p) === pathKey(resolve(ROOT, 'next-env.d.ts')))) throw new Error('Stale generated Next root must not be combined with its replacement.');
    const configPath = resolve(ROOT, 'tsconfig.typecheck.json');
    const configText = safeRead(configPath);
    if (configText === undefined) throw new Error('Original source-health config unavailable.');
    const decoded = ts.parseConfigFileTextToJson(configPath, configText);
    if (decoded.error) throw new Error('Original config parse error.');
    const effectiveText = JSON.stringify({ ...decoded.config, files: roots, include: [] });
    const parseHost = {
      ...ts.sys, getCurrentDirectory: () => ROOT,
      readFile: p => pathKey(p) === pathKey(configPath) ? effectiveText : safeRead(p),
      fileExists: safeExists, directoryExists: safeDirectoryExists, getDirectories: safeDirectories, realpath: safeRealpath,
      readDirectory: () => { throw new Error('Forbidden config glob discovery.'); },
      onUnRecoverableConfigFileDiagnostic: d => { throw new Error(ts.flattenDiagnosticMessageText(d.messageText, '\n')); },
    };
    const parsed = ts.getParsedCommandLineOfConfigFile(configPath, {}, parseHost);
    if (!parsed) throw new Error('Compiler configuration failed to parse.');
    if (parsed.errors.length) throw new Error(ts.formatDiagnostics(parsed.errors, { getCanonicalFileName: p => p, getCurrentDirectory: () => ROOT, getNewLine: () => '\n' }));
    if (violations.size) throw new Error(`Compiler configuration/input safety failed: ${[...violations].join('; ')}`);
    if (pathKey(parsed.options.configFilePath) !== pathKey(configPath) || !parsed.options.noEmit) throw new Error('Original compiler origin/noEmit semantics changed.');
    const inputRecord = {
      schema: 'u03-tracked-typecheck-inputs-v3', attempt, head: startHead,
      scope: 'Tracked application/worker/script/test source health, explicit archive caller and pure shared attempt root, framework-generated Next ambient replacement; not repository-wide/native Edge proof.',
      inputManifestSha256: MANIFEST_SHA256, generatorSha256: GENERATOR_SHA256,
      compilerWrapperSha256: hash(readFileSync(fileURLToPath(import.meta.url))), configOrigin: configPath,
      configSha256: input.pins['tsconfig.typecheck.json'], typescriptVersion: ts.version,
      roots: parsed.fileNames, forcedRoots: input.forcedRoots, dependencyRoots: [...dependencyRoots],
      configuredTypes: parsed.options.types ?? null, configuredTypeRoots: parsed.options.typeRoots ?? null,
      ambientOutputs: evidence.outputs,
    };
    writeNewEvidence(`U03-tracked-typecheck-v3-${attempt}-inputs.json`, inputRecord);
    const host = ts.createCompilerHost(parsed.options);
    Object.assign(host, {
      getCurrentDirectory: () => ROOT, readFile: safeRead, fileExists: safeExists,
      directoryExists: safeDirectoryExists, getDirectories: safeDirectories, realpath: safeRealpath,
      readDirectory: () => { violations.add('Forbidden compiler glob discovery'); return []; },
      writeFile: () => { violations.add('Forbidden compiler emit'); throw new Error('No emit/buildinfo write permitted.'); },
    });
    // Keep native getSourceFile: pinned TS dynamically reads through host.readFile
    // and preserves languageVersionOrOptions/implied module-format semantics.
    const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options, projectReferences: parsed.projectReferences, host });
    const diagnostics = ts.getPreEmitDiagnostics(program);
    const sourceFiles = program.getSourceFiles().map(f => f.fileName);
    for (const p of input.generatedAmbient.files) {
      const actual = canonicalExisting(resolve(ROOT, p));
      if (!actual || !sourceFiles.some(f => pathKey(f) === pathKey(actual) || pathKey(f) === pathKey(resolve(ROOT, p)))) violations.add(`Required ambient declaration not in program: ${p}`);
    }
    // Bind actual read inputs and detect mutation after a cached compiler read.
    for (const item of readHashes.values()) {
      const actual = canonicalExisting(item.path);
      if (!actual || hash(ts.sys.readFile(actual) ?? '') !== item.sha256) violations.add('Compiler input changed or disappeared before completion');
    }
    verifyPins(input);
    readRouteInventory(input);
    if (verifyContext(input) !== startHead || hash(readTracked().join('\n') + '\n') !== trackedIdentity) violations.add('HEAD/index membership changed during compilation');
    if (diagnostics.length) process.stderr.write(ts.formatDiagnostics(diagnostics, { getCanonicalFileName: p => p, getCurrentDirectory: () => ROOT, getNewLine: () => '\n' }));
    writeNewEvidence(`U03-tracked-typecheck-v3-${attempt}-result.json`, {
      ...inputRecord, diagnostics: diagnostics.length, ioViolations: [...violations],
      sourceFiles, sourceTextHashes: [...readHashes.values()],
      outcome: diagnostics.length || violations.size ? 'failed' : 'passed',
    });
    process.exitCode = diagnostics.length || violations.size ? 1 : 0;
    process.stdout.write(`U03 tracked source-health compilation: ${diagnostics.length} diagnostics; ${violations.size} input/I/O violations.\n`);
  } finally {
    lease.release();
  }
}

main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
