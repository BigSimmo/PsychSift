import { globSync, readFileSync } from "node:fs";

import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * CPD copy contract (spec 2026-09-26, sections 1.4 and 5).
 *
 * CPD states plain facts ("Reached", "3 h to go", "4 of 11 done") and never a
 * verdict on the doctor. This reads every user-facing string in the CPD screens
 * and the four CPD library files that write status words, and fails on:
 *
 * - a verdict word: Met, ready, on track, Required, complete, compliant;
 * - "CME": the mode is called CPD wherever a user can read it. The code id
 *   `cme` in routes, file names and API paths is lowercase and never matches.
 *
 * "User-facing" means JSX text, plus string and template literals that are not
 * code: import paths, type literals, object keys, comparison operands, `case`
 * labels, class names (`className`, `cn(...)`), test ids, `href` and route
 * strings, and single lowercase identifier-like tokens such as the load state
 * `"ready"` are skipped. Comments are never read.
 */

const root = new URL("../", import.meta.url);

const CPD_FILES = [
  ...globSync("src/components/cme/**/*.tsx", { cwd: root }).map((file) => file.replaceAll("\\", "/")),
  ...globSync("src/app/(search-app)/cme/**/*.tsx", { cwd: root }).map((file) => file.replaceAll("\\", "/")),
  "src/lib/cme/evaluate.ts",
  "src/lib/cme/year-check.ts",
  "src/lib/cme/year-close.ts",
  "src/lib/cme/calendar-events.ts",
  "src/lib/cme/pace.ts",
].sort();

/** Files outside the CPD screens that name the mode to a reader. Checked for "CME" only. */
const MODE_NAME_FILES = [
  "src/components/calendar/calendar-subscribe.tsx",
  "src/components/clinical-dashboard/settings-reminders.tsx",
  "scripts/generate-site-map.ts",
];

const VERDICT_WORDS = /\b(Met|ready|on track|Required|complete|compliant)\b/i;
const OLD_MODE_NAME = /\bCME\b/;

/**
 * Deliberate exceptions, each as `file` + a substring of the flagged string + why.
 * Empty on purpose. An entry must name a real string (the last test fails on a
 * stale entry), and "the test was in the way" is not a reason.
 */
const ALLOWED: readonly { readonly file: string; readonly text: string; readonly reason: string }[] = [];

/** JSX attributes whose values are code, never read by a person. */
const CODE_ATTRIBUTES = new Set([
  "className",
  "id",
  "key",
  "href",
  "htmlFor",
  "type",
  "name",
  "role",
  "rel",
  "target",
  "method",
  "variant",
  "tone",
  "size",
  "state",
  "testId",
  "autoComplete",
  "inputMode",
  "aria-labelledby",
  "aria-describedby",
  "aria-controls",
]);
const CLASS_HELPERS = new Set(["cn", "clsx", "cva"]);
/** One lowercase token with no spaces, such as "ready" or "load-failed": a state value, not a sentence. */
const IDENTIFIER_LIKE = /^[a-z][A-Za-z0-9_.:-]*$/;
const EQUALITY = new Set([
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
]);
const PASS_THROUGH = new Set([
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken,
  ts.SyntaxKind.AmpersandAmpersandToken,
]);

function templateText(node: ts.TemplateExpression | ts.NoSubstitutionTemplateLiteral): string {
  if (ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return [node.head.text, ...node.templateSpans.map((span) => `{x}${span.literal.text}`)].join("");
}

function isCodeString(node: ts.Node): boolean {
  const parent = node.parent;
  if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent) || ts.isExternalModuleReference(parent)) {
    return true;
  }
  if (ts.isLiteralTypeNode(parent)) return true;
  if (
    (ts.isPropertyAssignment(parent) || ts.isPropertySignature(parent) || ts.isPropertyDeclaration(parent)) &&
    parent.name === node
  ) {
    return true;
  }
  if (ts.isElementAccessExpression(parent) && parent.argumentExpression === node) return true;
  if (ts.isCaseClause(parent)) return true;
  if (ts.isBinaryExpression(parent) && EQUALITY.has(parent.operatorToken.kind)) return true;

  // Climb through `{ … }`, `a ? "x" : "y"`, `a ?? "x"` and parentheses to see which attribute holds the string.
  let cursor: ts.Node = node;
  while (
    ts.isConditionalExpression(cursor.parent) ||
    ts.isParenthesizedExpression(cursor.parent) ||
    ts.isJsxExpression(cursor.parent) ||
    (ts.isBinaryExpression(cursor.parent) && PASS_THROUGH.has(cursor.parent.operatorToken.kind))
  ) {
    cursor = cursor.parent;
  }
  if (ts.isJsxAttribute(cursor.parent)) {
    const attribute = cursor.parent.name.getText();
    if (CODE_ATTRIBUTES.has(attribute) || attribute.startsWith("data-")) return true;
  }

  for (let up: ts.Node | undefined = parent; up; up = up.parent) {
    if (ts.isCallExpression(up) && ts.isIdentifier(up.expression) && CLASS_HELPERS.has(up.expression.text)) return true;
    if (ts.isStatement(up) || ts.isJsxElement(up) || ts.isJsxSelfClosingElement(up)) break;
  }
  return false;
}

/** Every string in `source` that a person could read on screen, in source order. */
function userFacingStrings(source: string, fileName: string): string[] {
  const kind = fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isJsxText(node)) {
      const text = node.text.replace(/\s+/g, " ").trim();
      if (text) found.push(text);
      return;
    }
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) {
      const text = ts.isStringLiteral(node) ? node.text : templateText(node);
      if (!isCodeString(node) && !IDENTIFIER_LIKE.test(text) && !text.startsWith("/")) found.push(text);
      if (ts.isTemplateExpression(node)) for (const span of node.templateSpans) visit(span.expression);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

function read(file: string): string {
  return readFileSync(new URL(file, root), "utf8");
}

function violations(files: readonly string[], pattern: RegExp): string[] {
  const found: string[] = [];
  for (const file of files) {
    for (const text of userFacingStrings(read(file), file)) {
      if (!pattern.test(text)) continue;
      if (ALLOWED.some((entry) => entry.file === file && text.includes(entry.text))) continue;
      found.push(`${file}: ${JSON.stringify(text)}`);
    }
  }
  return found;
}

describe("CPD copy contract", () => {
  it("reads the CPD screens and status files it is meant to guard", () => {
    expect(CPD_FILES.length).toBeGreaterThan(40);
    expect(CPD_FILES).toContain("src/components/cme/cme-dashboard.tsx");
    expect(CPD_FILES).toContain("src/app/(search-app)/cme/learning/page.tsx");
  });

  it("finds user-facing strings and skips code strings", () => {
    const sample = `
      import { x } from "@/lib/cme/ready";
      type State = "ready" | "complete";
      const labels = { ready: "Reached" };
      function Row({ state }: { state: string }) {
        if (state === "Met") return null;
        return (
          <p className={cn("font-medium", state === "ready" && "complete")} data-testid="cme-met" data-ready="true">
            4 of 10 ready
            <span aria-label={\`Mark \${state} complete\`} title="On track">{state ? "Met" : "Required"}</span>
            <a href="/cme/check?ready=1">Year check</a>
          </p>
        );
      }
    `;
    expect(userFacingStrings(sample, "sample.tsx")).toEqual([
      "Reached",
      "4 of 10 ready",
      "Mark {x} complete",
      "On track",
      "Met",
      "Required",
      "Year check",
    ]);
  });

  it("uses no verdict word in any user-facing CPD string", () => {
    expect(violations(CPD_FILES, VERDICT_WORDS)).toEqual([]);
  });

  it("never calls the mode CME where a user can read it", () => {
    expect(violations([...CPD_FILES, ...MODE_NAME_FILES], OLD_MODE_NAME)).toEqual([]);
  });

  it("says MyCPD only where the year is known to be RANZCP's", () => {
    // Both are shown only when cmeReportingCloseDate() found RANZCP in the confirmed source:
    // the calendar's 1 March reporting event, and Today's reminder built from that same date.
    // The Report's "Close the year" row and the log's copy words (`cmeCpdHomeWords`) name MyCPD only
    // behind the same RANZCP-home test.
    const knownRanzcp = new Set([
      "src/lib/cme/calendar-events.ts",
      "src/components/cme/cme-dashboard.tsx",
      "src/components/cme/cme-year-check-page.tsx",
      "src/components/cme/cme-log-shared.ts",
    ]);
    const found = violations(CPD_FILES, /MyCPD/).filter((line) => !knownRanzcp.has(line.slice(0, line.indexOf(":"))));
    expect(found).toEqual([]);
  });

  it("does not say Learning is only for psychiatrists", () => {
    expect(read("src/app/(search-app)/cme/learning/page.tsx")).not.toMatch(/for psychiatrists/i);
  });

  it("keeps every allowlist entry pointed at a string that still exists", () => {
    for (const entry of ALLOWED) {
      expect(entry.reason.trim().length, `${entry.file}: give a reason`).toBeGreaterThan(10);
      expect(
        userFacingStrings(read(entry.file), entry.file).some((text) => text.includes(entry.text)),
        `${entry.file}: "${entry.text}" no longer appears; remove the entry`,
      ).toBe(true);
    }
  });
});
