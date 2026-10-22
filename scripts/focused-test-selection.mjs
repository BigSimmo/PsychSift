import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const moduleExtension = /\.[cm]?[jt]sx?$/i;
const testExtension = /(?:\.test\.ts|\.dom\.test\.tsx)$/;
const opaqueRuntime = /^(?:node:)?(?:fs(?:\/promises)?|child_process|vm|module)$/;

function testFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory()
      ? testFiles(file)
      : testExtension.test(entry.name) && !entry.name.endsWith(".live.test.ts")
        ? [realpathSync(file)]
        : [];
  });
}

export function normalizeFocusedInput(root, input) {
  const absolute = path.resolve(root, input.replaceAll("\\", "/"));
  const relative = path.relative(root, absolute).replaceAll("\\", "/");
  if (!relative || relative.startsWith("../") || path.isAbsolute(relative)) {
    throw new Error(`path is outside the repository (${input})`);
  }
  if (!existsSync(absolute)) throw new Error(`deleted or missing path (${relative})`);
  const resolved = realpathSync(absolute);
  const resolvedRelative = path.relative(realpathSync(root), resolved);
  if (resolvedRelative.startsWith(`..${path.sep}`) || path.isAbsolute(resolvedRelative)) {
    throw new Error(`path resolves outside the repository (${relative})`);
  }
  return { absolute: resolved, relative: resolvedRelative.replaceAll("\\", "/") };
}

/**
 * Imports alone cannot describe tests that read source files or launch scripts.
 * Include every such consumer conservatively alongside the actual import owners.
 * Every input must still have an import owner: unrelated inputs cannot borrow
 * another file's mapping or the broad filesystem-consumer safety net.
 */
export function selectFocusedTests({ root, files }) {
  root = realpathSync(root);
  const inputs = files.map((file) => normalizeFocusedInput(root, file));
  if (!inputs.length) throw new Error("no changed files were found");
  for (const { relative } of inputs) {
    if (!/^(?:src|worker)\//.test(relative) || !moduleExtension.test(relative) || /\.d\.[cm]?ts$/.test(relative)) {
      throw new Error(`non-module, test or configuration input requires the full suite (${relative})`);
    }
  }

  const configPath = ts.findConfigFile(root, ts.sys.fileExists, "tsconfig.json");
  const options = configPath
    ? ts.parseJsonConfigFileContent(ts.readConfigFile(configPath, ts.sys.readFile).config, ts.sys, root).options
    : { moduleResolution: ts.ModuleResolutionKind.Bundler };
  const resolutionCache = ts.createModuleResolutionCache(root, (file) => file, options);
  const graph = new Map();
  function visit(file) {
    if (graph.has(file)) return;
    const info = { dependencies: new Set(), opaque: false };
    graph.set(file, info);
    const source = readFileSync(file, "utf8");
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    if (ast.parseDiagnostics.length) info.opaque = true;
    const imports = new Set(ts.preProcessFile(source, true, true).importedFiles.map((entry) => entry.fileName));
    function walk(node) {
      if (
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) && node.expression.text === "require")) &&
        (!node.arguments[0] || !ts.isStringLiteralLike(node.arguments[0]))
      ) {
        info.opaque = true;
      }
      ts.forEachChild(node, walk);
    }
    walk(ast);
    for (const name of imports) {
      if (opaqueRuntime.test(name)) info.opaque = true;
      const resolved = ts.resolveModuleName(name, file, options, ts.sys, resolutionCache).resolvedModule;
      if (!resolved) {
        if (name.startsWith(".") || name.startsWith("@/")) info.opaque = true;
        continue;
      }
      if (resolved.isExternalLibraryImport || !moduleExtension.test(resolved.resolvedFileName)) continue;
      const dependency = realpathSync(resolved.resolvedFileName);
      if (path.relative(root, dependency).startsWith(`..${path.sep}`)) {
        info.opaque = true;
        continue;
      }
      info.dependencies.add(dependency);
      visit(dependency);
    }
  }

  const tests = testFiles(path.join(root, "tests"));
  for (const test of tests) visit(test);
  function closure(file, seen = new Set()) {
    if (seen.has(file)) return seen;
    seen.add(file);
    for (const dependency of graph.get(file)?.dependencies ?? []) closure(dependency, seen);
    return seen;
  }
  const closures = new Map(tests.map((test) => [test, closure(test)]));
  for (const input of inputs) {
    if (![...closures.values()].some((dependencies) => dependencies.has(input.absolute))) {
      throw new Error(`no import-based test ownership for ${input.relative}; run the full suite`);
    }
  }
  const selected = tests.filter((test) => {
    const dependencies = closures.get(test);
    return (
      inputs.some((input) => dependencies.has(input.absolute)) ||
      [...dependencies].some((dependency) => graph.get(dependency)?.opaque)
    );
  });
  return {
    inputs: inputs.map((input) => input.relative),
    tests: selected.map((file) => path.relative(root, file).replaceAll("\\", "/")).sort(),
  };
}
