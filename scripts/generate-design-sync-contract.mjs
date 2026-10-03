import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";

import ts from "@typescript/typescript6";
import prettier from "prettier";

const ROOT = process.cwd();
const CONFIG_PATH = ".design-sync/config.json";

const read = (relativePath, root = ROOT) => fs.readFileSync(path.join(root, relativePath), "utf8");

function hasExportModifier(node) {
  return ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
}

function publicPropsDeclaration(source, componentName) {
  const typeName = `${componentName}Props`;
  return source.statements.find(
    (statement) =>
      (ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement)) &&
      statement.name.text === typeName &&
      hasExportModifier(statement),
  );
}

function publicComponentDeclaration(source, componentName) {
  return source.statements.find(
    (statement) =>
      ts.isFunctionDeclaration(statement) && statement.name?.text === componentName && hasExportModifier(statement),
  );
}

function toPosix(filePath) {
  return filePath.replaceAll("\\", "/");
}

function findProgramSourceFile(program, absolutePath) {
  return (
    program.getSourceFile(absolutePath) ??
    program.getSourceFile(toPosix(absolutePath)) ??
    program.getSourceFiles().find((file) => path.normalize(file.fileName) === path.normalize(absolutePath)) ??
    null
  );
}

function resolveExportStarTarget(fromSource, specifier, program, root) {
  let candidate;
  if (specifier.startsWith("@/")) candidate = path.join(root, "src", specifier.slice(2));
  else if (specifier.startsWith("."))
    candidate = path.normalize(path.join(path.dirname(fromSource.fileName), specifier));
  else return null;
  const candidates = path.extname(candidate)
    ? [candidate]
    : [`${candidate}.ts`, `${candidate}.tsx`, path.join(candidate, "index.ts"), path.join(candidate, "index.tsx")];
  for (const absolutePath of candidates) {
    const source = findProgramSourceFile(program, absolutePath);
    if (source) return source;
  }
  return null;
}

/**
 * Locate an exported function (and its source file) including barrel
 * `export * from "./module"` hops so componentSrcMap can stay on
 * `ui-primitives.tsx` after DS-P2-21.
 */
function resolveExportedFunction(source, componentName, program, root, seen = new Set()) {
  if (seen.has(source.fileName)) return null;
  seen.add(source.fileName);
  const local = publicComponentDeclaration(source, componentName);
  if (local) return { component: local, source };
  for (const statement of source.statements) {
    if (
      !ts.isExportDeclaration(statement) ||
      !statement.moduleSpecifier ||
      !ts.isStringLiteral(statement.moduleSpecifier)
    )
      continue;
    if (statement.exportClause) {
      if (!ts.isNamedExports(statement.exportClause)) continue;
      const aliases = statement.exportClause.elements.filter((element) => element.name.text === componentName);
      if (aliases.length === 0) continue;
    }
    const target = resolveExportStarTarget(source, statement.moduleSpecifier.text, program, root);
    if (!target) continue;
    const resolved = resolveExportedFunction(target, componentName, program, root, seen);
    if (resolved) return resolved;
  }
  return null;
}

function collectExportStarRoots(sourceMap, root) {
  const extras = [];
  for (const relativePath of new Set(Object.values(sourceMap))) {
    const absolutePath = path.join(root, relativePath);
    if (!fs.existsSync(absolutePath)) continue;
    const text = fs.readFileSync(absolutePath, "utf8");
    for (const match of text.matchAll(/export \* from ["'](\.[^"']+)["']/g)) {
      const candidate = path.normalize(path.join(path.dirname(absolutePath), match[1]));
      for (const withExt of [`${candidate}.ts`, `${candidate}.tsx`, candidate]) {
        if (fs.existsSync(withExt) && fs.statSync(withExt).isFile()) {
          extras.push(withExt);
          break;
        }
      }
    }
  }
  return extras;
}

function propertyName(name) {
  return /^[A-Za-z_$][\w$]*$/.test(name) ? name : JSON.stringify(name);
}

function normalizeType(typeText, declaration) {
  let normalized = typeText.replace(/\s+/g, " ").trim();
  if (normalized.endsWith(" | undefined")) normalized = normalized.slice(0, -" | undefined".length);
  for (const parameter of declaration.typeParameters ?? []) {
    const replacement = parameter.constraint?.getText(declaration.getSourceFile()) ?? "unknown";
    normalized = normalized.replace(new RegExp(`\\b${parameter.name.text}\\b`, "g"), replacement);
  }
  return normalized;
}

function createProgram(sourceMap, root) {
  const configPath = path.join(root, "tsconfig.json");
  const parsed = ts.getParsedCommandLineOfConfigFile(configPath, {}, ts.sys);
  if (!parsed) throw new Error(`Unable to parse ${configPath}`);
  const mapped = [...new Set(Object.values(sourceMap))].map((relativePath) => path.join(root, relativePath));
  const rootNames = [...new Set([...mapped, ...collectExportStarRoots(sourceMap, root)])];
  return ts.createProgram({ rootNames, options: parsed.options });
}

export function deriveDesignSyncProps({ root = ROOT, config = JSON.parse(read(CONFIG_PATH, root)) } = {}) {
  const sourceMap = config.componentSrcMap ?? {};
  const program = createProgram(sourceMap, root);
  const checker = program.getTypeChecker();
  const generated = {};

  for (const [componentName, relativePath] of Object.entries(sourceMap).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const barrel = findProgramSourceFile(program, path.join(root, relativePath));
    if (!barrel) throw new Error(`${componentName} source is not in the TypeScript program: ${relativePath}`);
    const resolved = resolveExportedFunction(barrel, componentName, program, root);
    if (!resolved) throw new Error(`${componentName} is not an exported function in ${relativePath}`);
    const { component, source } = resolved;

    const declaration = publicPropsDeclaration(source, componentName);
    if (!declaration) {
      if (component.parameters.length === 0) {
        generated[componentName] = "";
        continue;
      }
      throw new Error(`${componentName} must expose an exported ${componentName}Props type in ${relativePath}`);
    }
    const parameterType = component.parameters[0]?.type?.getText(source) ?? "";
    if (!parameterType.includes(`${componentName}Props`))
      throw new Error(`${componentName} must consume its exported ${componentName}Props type in ${relativePath}`);

    const propsType = checker.getTypeAtLocation(declaration.name);
    const members = checker
      .getPropertiesOfType(propsType)
      .map((symbol) => {
        const location = symbol.valueDeclaration ?? symbol.declarations?.[0] ?? declaration;
        const type = checker.getTypeOfSymbolAtLocation(symbol, location);
        const typeText = normalizeType(
          checker.typeToString(type, declaration, ts.TypeFormatFlags.NoTruncation),
          declaration,
        );
        const optional = (symbol.flags & ts.SymbolFlags.Optional) !== 0;
        return {
          name: symbol.name,
          declaration: `${propertyName(symbol.name)}${optional ? "?" : ""}: ${typeText};`,
        };
      })
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((member) => member.declaration);
    const declarationText = members.join(" ");
    if (declarationText.includes(root) || /import\(["'][A-Za-z]:[\\/]/.test(declarationText))
      throw new Error(`${componentName} generated machine-specific dtsPropsFor metadata`);
    generated[componentName] = declarationText;
  }

  return generated;
}

export function generateDesignSyncConfig({ root = ROOT } = {}) {
  const config = JSON.parse(read(CONFIG_PATH, root));
  return { ...config, dtsPropsFor: deriveDesignSyncProps({ root, config }) };
}

async function formatConfig(config, root) {
  const absolutePath = path.join(root, CONFIG_PATH);
  const options = (await prettier.resolveConfig(absolutePath)) ?? {};
  return prettier.format(`${JSON.stringify(config, null, 2)}\n`, { ...options, filepath: absolutePath });
}

export async function writeOrCheckDesignSyncConfig({ root = ROOT, write = false } = {}) {
  const generated = generateDesignSyncConfig({ root });
  const formatted = await formatConfig(generated, root);
  const current = read(CONFIG_PATH, root);
  if (current === formatted) return [];
  if (write) {
    fs.writeFileSync(path.join(root, CONFIG_PATH), formatted);
    return [];
  }
  return [`${CONFIG_PATH} dtsPropsFor is out of date; run npm run design-system:design-sync:update`];
}

async function main() {
  const write = process.argv.includes("--write");
  const check = process.argv.includes("--check");
  if (write === check) throw new Error("Pass exactly one of --write or --check.");
  const failures = await writeOrCheckDesignSyncConfig({ write });
  if (failures.length) throw new Error(failures.join("\n"));
  const count = Object.keys(JSON.parse(read(CONFIG_PATH)).componentSrcMap ?? {}).length;
  process.stdout.write(`design-sync props ${write ? "updated" : "checked"}: ${count} visual components\n`);
}

if (isDirectEntrypoint(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
