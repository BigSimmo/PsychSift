import fs from "node:fs";
import path from "node:path";
import { parse } from "@babel/parser";

// Shared static import-graph machinery for the repository's architecture guards.
//
// Lifted out of `tests/architecture-boundaries.test.ts` (unchanged behaviour) so
// `tests/rsc-boundary.test.ts` can reuse the exact same resolver. Two resolvers
// that drift apart are worse than one: a boundary guard is only as trustworthy
// as the graph it walks.
export const projectRoot = path.resolve(import.meta.dirname, "..", "..");
const sourceRoots = [path.join(projectRoot, "src"), path.join(projectRoot, "worker")];
const extensions = [".ts", ".tsx", ".mts", ".mjs", ".js", ".jsx"];

function sourceFiles() {
  const files: string[] = [];
  const visit = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const filePath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(filePath);
      else if (extensions.includes(path.extname(entry.name))) files.push(path.resolve(filePath));
    }
  };
  sourceRoots.forEach(visit);
  return files;
}

export function parseModuleSource(sourceText: string, filePath = "fixture.tsx") {
  return parse(sourceText, {
    sourceType: "module",
    // @babel/parser 8 parses import attributes by default; the standalone
    // "importAttributes" plugin was removed (and is now a type error).
    // Plain TypeScript permits generic arrows without TSX's trailing comma.
    // Match the file's language rather than parsing every .ts file as JSX.
    plugins: /\.(?:ts|mts|cts)$/i.test(filePath) ? ["typescript"] : ["jsx", "typescript"],
  });
}

export function moduleSpecifiersFromSource(filePath: string, sourceText: string) {
  const staticImports = new Set<string>();
  const dynamicImports = new Set<string>();
  const source = parseModuleSource(sourceText, filePath);

  for (const statement of source.program.body) {
    if (statement.type === "ImportDeclaration") {
      const typeOnly =
        statement.importKind === "type" ||
        Boolean(
          !statement.specifiers.some((specifier) => specifier.type === "ImportDefaultSpecifier") &&
          statement.specifiers.some((specifier) => specifier.type === "ImportSpecifier") &&
          statement.specifiers.every(
            (specifier) => specifier.type === "ImportSpecifier" && specifier.importKind === "type",
          ),
        );
      if (!typeOnly) staticImports.add(statement.source.value);
    }
    if (
      (statement.type === "ExportNamedDeclaration" || statement.type === "ExportAllDeclaration") &&
      statement.source
    ) {
      const typeOnly =
        statement.exportKind === "type" ||
        Boolean(
          statement.type === "ExportNamedDeclaration" &&
          statement.specifiers.length > 0 &&
          statement.specifiers.every((specifier) => "exportKind" in specifier && specifier.exportKind === "type"),
        );
      if (!typeOnly) staticImports.add(statement.source.value);
    }
  }

  const addDynamicSpecifier = (moduleSpecifier: Record<string, unknown> | undefined) => {
    if (!moduleSpecifier) return;
    if (moduleSpecifier.type === "StringLiteral" && typeof moduleSpecifier.value === "string") {
      dynamicImports.add(moduleSpecifier.value);
    } else if (
      moduleSpecifier.type === "TemplateLiteral" &&
      Array.isArray(moduleSpecifier.expressions) &&
      moduleSpecifier.expressions.length === 0 &&
      Array.isArray(moduleSpecifier.quasis) &&
      moduleSpecifier.quasis.length === 1
    ) {
      const cooked = ((moduleSpecifier.quasis[0] as Record<string, unknown>).value as Record<string, unknown>)?.cooked;
      if (typeof cooked === "string") dynamicImports.add(cooked);
    }
  };

  const visit = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const current = node as Record<string, unknown>;
    // @babel/parser 8 models dynamic `import(...)` as an ESTree-aligned
    // ImportExpression (specifier in `source`, import-attributes in `options`).
    // @babel/parser 7 modelled it as a CallExpression whose callee is an
    // `Import` node with the specifier in `arguments[0]`. Handle both shapes so
    // this boundary graph stays parser-major agnostic.
    if (current.type === "ImportExpression") {
      addDynamicSpecifier(current.source as Record<string, unknown> | undefined);
    }
    const argumentsList = Array.isArray(current.arguments) ? current.arguments : null;
    if (
      current.type === "CallExpression" &&
      current.callee &&
      argumentsList &&
      (argumentsList.length === 1 || argumentsList.length === 2)
    ) {
      const callee = current.callee as Record<string, unknown>;
      if (callee.type === "Import") {
        addDynamicSpecifier(argumentsList[0] as Record<string, unknown> | undefined);
      }
    }
    for (const value of Object.values(current)) {
      if (Array.isArray(value)) value.forEach(visit);
      else visit(value);
    }
  };
  visit(source);

  return { source, staticImports, dynamicImports };
}

function moduleSpecifiers(filePath: string) {
  return moduleSpecifiersFromSource(filePath, fs.readFileSync(filePath, "utf8"));
}

export function resolveModule(fromFile: string, specifier: string, fileSet: Set<string>) {
  let base: string;
  if (specifier.startsWith("@/")) base = path.join(projectRoot, "src", specifier.slice(2));
  else if (specifier.startsWith(".")) base = path.resolve(path.dirname(fromFile), specifier);
  else return null;

  const candidates = [
    base,
    ...extensions.map((extension) => `${base}${extension}`),
    ...extensions.map((extension) => path.join(base, `index${extension}`)),
  ];
  return candidates.map((candidate) => path.resolve(candidate)).find((candidate) => fileSet.has(candidate)) ?? null;
}

function buildRuntimeGraph() {
  const files = sourceFiles();
  const fileSet = new Set(files);
  const graph = new Map<string, string[]>();
  const parsed = new Map<string, ReturnType<typeof moduleSpecifiers>>();

  for (const file of files) {
    const modules = moduleSpecifiers(file);
    parsed.set(file, modules);
    const dependencies = [...modules.staticImports, ...modules.dynamicImports]
      .map((specifier) => resolveModule(file, specifier, fileSet))
      .filter((dependency): dependency is string => Boolean(dependency));
    graph.set(file, [...new Set(dependencies)]);
  }

  return { files, fileSet, graph, parsed };
}

let runtimeGraphCache: ReturnType<typeof buildRuntimeGraph> | undefined;

export function runtimeGraph() {
  runtimeGraphCache ??= buildRuntimeGraph();
  return runtimeGraphCache;
}

export function relative(filePath: string) {
  return path.relative(projectRoot, filePath).replaceAll("\\", "/");
}

/** True when a parsed module carries a top-level `"use client"` directive. */
export function hasUseClientDirective(source: ReturnType<typeof parseModuleSource>) {
  return Boolean(source.program.directives?.some((directive) => directive.value.value === "use client"));
}
