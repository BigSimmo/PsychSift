import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import ts from "typescript";

export const ROOT = process.cwd();

export function repoRelative(file: string): string {
  return relative(ROOT, file).replaceAll("\\", "/");
}

/**
 * Recursively collects source files under one or more repository-relative or
 * absolute directories matching the requested extensions.
 */
export function sourceFiles(
  target: string | readonly string[],
  extensions: readonly string[] = [".ts", ".tsx"],
): string[] {
  const targets = typeof target === "string" ? [target] : target;
  const out: string[] = [];

  for (const item of targets) {
    const absolute = resolve(ROOT, item);
    if (!existsSync(absolute)) continue;
    if (statSync(absolute).isFile()) {
      if (extensions.some((extension) => absolute.endsWith(extension))) {
        out.push(absolute);
      }
      continue;
    }
    for (const entry of readdirSync(absolute, { recursive: true, encoding: "utf8" })) {
      const full = join(absolute, entry);
      if (extensions.some((extension) => full.endsWith(extension)) && statSync(full).isFile()) {
        out.push(full);
      }
    }
  }

  return out.sort();
}

export function relativeSourceFiles(
  roots: readonly string[],
  extensions: readonly string[] = [".ts", ".tsx"],
): string[] {
  return sourceFiles(roots, extensions).map(repoRelative);
}

export function sourceFileEntries(
  roots: readonly string[],
  extensions: readonly string[] = [".ts", ".tsx"],
): Array<readonly [relativePath: string, absolutePath: string]> {
  return sourceFiles(roots, extensions).map((file) => [repoRelative(file), file] as const);
}

export function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
}

export function readWithoutComments(filePath: string): string {
  return stripComments(readFileSync(filePath, "utf8"));
}

export interface ScanOffendingLinesOptions {
  readonly format?: "colon" | "space";
  readonly useRepoRelative?: boolean;
}

/**
 * Scans files line-by-line for matches against `pattern` and returns human-readable
 * `file:line: content` diagnostics.
 */
export function scanOffendingLines(
  files: readonly string[],
  pattern: RegExp,
  options: ScanOffendingLinesOptions = {},
): string[] {
  const separator = options.format === "space" ? " " : ": ";
  const useRelative = options.useRepoRelative ?? true;

  return files.flatMap((file) => {
    const label = useRelative ? repoRelative(file) : file;
    return readFileSync(file, "utf8")
      .split("\n")
      .flatMap((line, index) => (pattern.test(line) ? [`${label}:${index + 1}${separator}${line.trim()}`] : []));
  });
}

export const DEFAULT_RECIPE_SOURCES: Readonly<Record<string, readonly string[]>> = {
  "@/components/ui-primitives": ["src/components/primitive-recipes"],
  "@/components/card-recipes": ["src/components/card-recipes.ts"],
  // Imported per file (`@/components/mode-kit/type`); scopeFor maps every `@/components/mode-kit/*` here.
  "@/components/mode-kit": ["src/components/mode-kit"],
};

const WEIGHT = /^font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)$/;
const TOO_HEAVY_FOR_A_NUMBER = new Set(["medium", "semibold", "bold", "extrabold", "black"]);

type Scope = ReadonlyMap<string, ts.Expression>;
type Context = { readonly weight: string | null; readonly upper: boolean };
export type Finding = string;

export function parseTsxFile(file: string, text = readFileSync(file, "utf8")): ts.SourceFile {
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

/** Every `const name = <expression>` in a file, exported or not. */
function constants(sourceFile: ts.SourceFile): Map<string, ts.Expression> {
  const found = new Map<string, ts.Expression>();
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      found.set(node.name.text, node.initializer);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

function buildRecipeScopes(recipeSources: Readonly<Record<string, readonly string[]>>): Map<string, Scope> {
  return new Map<string, Scope>(
    Object.entries(recipeSources).map(([moduleName, targets]) => {
      const merged = new Map<string, ts.Expression>();
      for (const target of targets) {
        for (const file of sourceFiles(target, [".ts", ".tsx"])) {
          for (const [name, expression] of constants(parseTsxFile(file))) merged.set(name, expression);
        }
      }
      return [moduleName, merged] as const;
    }),
  );
}

let defaultRecipeScopes: Map<string, Scope> | null = null;

function getDefaultRecipeScopes(): Map<string, Scope> {
  defaultRecipeScopes ??= buildRecipeScopes(DEFAULT_RECIPE_SOURCES);
  return defaultRecipeScopes;
}

/** The file's own constants plus the recipe constants it imports by name. */
function scopeFor(sourceFile: ts.SourceFile, recipeScopes: Map<string, Scope>): Scope {
  const scope = new Map(constants(sourceFile));
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const specifier = statement.moduleSpecifier.text;
    const recipes =
      recipeScopes.get(specifier) ??
      (specifier.startsWith("@/components/mode-kit/") ? recipeScopes.get("@/components/mode-kit") : undefined);
    const named = statement.importClause?.namedBindings;
    if (!recipes || !named || !ts.isNamedImports(named)) continue;
    for (const element of named.elements) {
      const expression = recipes.get((element.propertyName ?? element.name).text);
      if (expression) scope.set(element.name.text, expression);
    }
  }
  return scope;
}

function classTokens(node: ts.Node | undefined, scope: Scope, seen = new Set<string>()): string[] {
  if (!node) return [];
  if (ts.isStringLiteralLike(node)) return node.text.split(/\s+/).filter(Boolean);
  if (ts.isTemplateExpression(node)) {
    return [
      ...node.head.text.split(/\s+/),
      ...node.templateSpans.flatMap((span) => [
        ...classTokens(span.expression, scope, seen),
        ...span.literal.text.split(/\s+/),
      ]),
    ].filter(Boolean);
  }
  if (ts.isIdentifier(node)) {
    const expression = scope.get(node.text);
    if (!expression || seen.has(node.text)) return [];
    return classTokens(expression, scope, new Set([...seen, node.text]));
  }
  if (ts.isCallExpression(node)) return node.arguments.flatMap((argument) => classTokens(argument, scope, seen));
  if (ts.isConditionalExpression(node)) {
    return [...classTokens(node.whenTrue, scope, seen), ...classTokens(node.whenFalse, scope, seen)];
  }
  if (ts.isBinaryExpression(node)) {
    return node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
      ? classTokens(node.right, scope, seen)
      : [...classTokens(node.left, scope, seen), ...classTokens(node.right, scope, seen)];
  }
  if (ts.isParenthesizedExpression(node) || ts.isJsxExpression(node)) return classTokens(node.expression, scope, seen);
  if (ts.isArrayLiteralExpression(node)) return node.elements.flatMap((element) => classTokens(element, scope, seen));
  return [];
}

/** `sm:font-semibold!` -> `font-semibold`. */
function utility(token: string): string {
  return (token.split(":").pop() ?? token).replace(/^!|!$/g, "");
}

function attribute(opening: ts.JsxOpeningLikeElement, name: string): ts.JsxAttribute | undefined {
  return opening.attributes.properties.find(
    (property): property is ts.JsxAttribute =>
      ts.isJsxAttribute(property) && ts.isIdentifier(property.name) && property.name.text === name,
  );
}

function testIdTail(opening: ts.JsxOpeningLikeElement): string {
  const initializer = (attribute(opening, "data-testid") ?? attribute(opening, "testId"))?.initializer;
  if (!initializer) return "";
  if (ts.isStringLiteral(initializer)) return initializer.text;
  const expression = ts.isJsxExpression(initializer) ? initializer.expression : undefined;
  if (expression && ts.isStringLiteralLike(expression)) return expression.text;
  if (expression && ts.isTemplateExpression(expression)) {
    return expression.templateSpans.at(-1)?.literal.text ?? expression.head.text;
  }
  return "";
}

/** Number-element findings for one source file. */
export function numberWeightFindings(
  sourceFile: ts.SourceFile,
  recipeSources?: Readonly<Record<string, readonly string[]>>,
): { findings: Finding[]; numbers: number } {
  const recipeScopes = recipeSources ? buildRecipeScopes(recipeSources) : getDefaultRecipeScopes();
  const scope = scopeFor(sourceFile, recipeScopes);
  const findings: Finding[] = [];
  let numbers = 0;
  const where = (node: ts.Node) =>
    `${repoRelative(sourceFile.fileName)}:${sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;

  const check = (opening: ts.JsxOpeningLikeElement, context: Context): Context => {
    const own = classTokens(attribute(opening, "className")?.initializer, scope).map(utility);
    const ownWeight =
      own
        .map((token) => WEIGHT.exec(token)?.[1])
        .filter(Boolean)
        .at(-1) ?? null;
    const lastCase = own.filter((token) => token === "uppercase" || token === "normal-case").at(-1);
    const next: Context = {
      weight: ownWeight ?? context.weight,
      upper: lastCase ? lastCase === "uppercase" : context.upper,
    };
    const isNumber =
      own.includes("nums") || own.includes("tabular-nums") || /-(?:hours|total)$/.test(testIdTail(opening));
    if (isNumber) {
      numbers += 1;
      if (next.weight && TOO_HEAVY_FOR_A_NUMBER.has(next.weight)) {
        findings.push(`${where(opening)} number at font-${next.weight}`);
      }
      if (next.upper) findings.push(`${where(opening)} number set in uppercase`);
    }
    return next;
  };

  const root: Context = { weight: null, upper: false };
  // JSX passed as a prop (`actions={<Button/>}`) renders somewhere else, so it
  // starts from nothing rather than inheriting from the element it is passed to.
  const visitAttributes = (opening: ts.JsxOpeningLikeElement) =>
    opening.attributes.properties.forEach((property) => visit(property, root));
  const visit = (node: ts.Node, context: Context): void => {
    if (ts.isJsxElement(node)) {
      const next = check(node.openingElement, context);
      visitAttributes(node.openingElement);
      node.children.forEach((child) => visit(child, next));
      return;
    }
    if (ts.isJsxSelfClosingElement(node)) {
      check(node, context);
      visitAttributes(node);
      return;
    }
    ts.forEachChild(node, (child) => visit(child, context));
  };
  visit(sourceFile, root);
  return { findings, numbers };
}
