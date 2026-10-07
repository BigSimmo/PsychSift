import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";

const src = join(process.cwd(), "src");
const roots = ["lib/roster", "components/roster", "app/api/roster", "app/(search-app)/roster"].map((path) =>
  join(src, path),
);
const sourceFile = /\.(?:ts|tsx)$/;

function parsed(path: string): ts.SourceFile {
  return ts.createSourceFile(
    path,
    readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

/** Follow actual runtime imports, not `import type` or `type T = import("...").T`. */
function runtimeImports(source: string): string[] {
  const file = ts.createSourceFile("roster-imports.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const imports: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      const named = clause?.namedBindings;
      const onlyNamedTypes =
        named &&
        ts.isNamedImports(named) &&
        named.elements.length > 0 &&
        named.elements.every((element) => element.isTypeOnly) &&
        !clause?.name;
      if (!clause?.isTypeOnly && !onlyNamedTypes) imports.push(node.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const named = node.exportClause;
      const onlyNamedTypes =
        named &&
        ts.isNamedExports(named) &&
        named.elements.length > 0 &&
        named.elements.every((element) => element.isTypeOnly);
      if (!node.isTypeOnly && !onlyNamedTypes) imports.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      imports.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return imports;
}

function files(path: string): string[] {
  if (!existsSync(path)) return [];
  return readdirSync(path).flatMap((name) => {
    const item = join(path, name);
    return statSync(item).isDirectory() ? files(item) : sourceFile.test(name) ? [item] : [];
  });
}

function resolved(from: string, specifier: string): string | null {
  const base = specifier.startsWith("@/")
    ? join(src, specifier.slice(2))
    : specifier.startsWith(".")
      ? resolve(dirname(from), specifier)
      : null;
  if (!base) return null;
  return (
    [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")].find(
      (candidate) => existsSync(candidate) && statSync(candidate).isFile(),
    ) ?? null
  );
}

function prohibited(specifier: string, path: string | null): boolean {
  const normalized = (path ? relative(src, path) : "").replaceAll("\\", "/");
  return (
    specifier === "openai" ||
    specifier.startsWith("openai/") ||
    /^lib\/openai(?:\/|\.|$)/.test(normalized) ||
    /^lib\/rag(?:\/|\.|$)/.test(normalized) ||
    /^app\/api\/speech(?:\/|$)/.test(normalized) ||
    /^@\/lib\/(?:openai|rag)(?:\/|$)/.test(specifier) ||
    /^@\/app\/api\/speech(?:\/|$)/.test(specifier)
  );
}

it("distinguishes runtime AI imports from erased type references", () => {
  expect(
    runtimeImports(`
    import type { R } from "@/lib/rag/types";
    import { type T } from "@/lib/rag/more-types";
    type U = import("@/lib/rag/inline-types").U;
    import { value } from "@/lib/roster/team/model";
    void import("@/lib/openai");
  `),
  ).toEqual(["@/lib/roster/team/model", "@/lib/openai"]);
});

it("keeps the shared sign-out cleanup of the answer thread to storage removal, with no imports", () => {
  const auth = parsed(join(src, "lib/supabase/client.tsx"));
  const specifiers = auth.statements
    .filter(
      (statement): statement is ts.ImportDeclaration =>
        ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier),
    )
    .map((statement) => (statement.moduleSpecifier as ts.StringLiteral).text);
  // Sign-out clears the thread through the small keys module, never the answer storage code.
  expect(specifiers).toContain("@/lib/answer-thread-storage-keys");
  expect(specifiers).not.toContain("@/lib/answer-thread-storage");

  const keys = parsed(join(src, "lib/answer-thread-storage-keys.ts"));
  expect(keys.statements.filter(ts.isImportDeclaration)).toEqual([]);
  const keyDeclaration = keys.statements
    .filter(ts.isVariableStatement)
    .flatMap((statement) => [...statement.declarationList.declarations])
    .find((declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === "answerThreadStorageKey");
  expect(keyDeclaration?.initializer && ts.isStringLiteral(keyDeclaration.initializer)).toBe(true);
  const cleanup = keys.statements.find(
    (statement): statement is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(statement) && statement.name?.text === "clearPersistedAnswerThread",
  );
  expect(cleanup?.body).toBeDefined();
  const calls: string[] = [];
  const unexpectedConstructs: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) calls.push(node.expression.getText(keys));
    if (ts.isNewExpression(node) || ts.isAwaitExpression(node)) unexpectedConstructs.push(node.getText(keys));
    ts.forEachChild(node, visit);
  };
  visit(cleanup!.body!);
  const allowedCalls = new Set([
    "window.sessionStorage.removeItem",
    "window.localStorage.removeItem",
    "window.sessionStorage.key",
    "key?.startsWith",
  ]);
  expect(calls.filter((call) => !allowedCalls.has(call))).toEqual([]);
  expect(unexpectedConstructs).toEqual([]);
});

it("keeps Roster's runtime imports away from AI and speech", () => {
  const seen = new Set<string>();
  const queue = roots.flatMap(files).map((path) => ({ path, chain: [relative(src, path)] }));
  const violations: string[] = [];
  while (queue.length) {
    const current = queue.shift()!;
    if (seen.has(current.path)) continue;
    seen.add(current.path);
    const content = readFileSync(current.path, "utf8");
    for (const specifier of runtimeImports(content)) {
      const next = resolved(current.path, specifier);
      if (prohibited(specifier, next)) violations.push([...current.chain, specifier].join(" → "));
      else if (next && !seen.has(next)) queue.push({ path: next, chain: [...current.chain, relative(src, next)] });
    }
  }
  expect(violations).toEqual([]);
});
