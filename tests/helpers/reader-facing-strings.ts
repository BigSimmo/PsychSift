import { readFileSync } from "node:fs";

import ts from "typescript";

/**
 * The reader-facing string scanner shared by the On Call wording guards
 * (`tests/on-call-compliance.test.ts`, `tests/on-call-hub-wording.test.ts`):
 * every string in a file that could reach a reader, and the verdict vocabulary
 * those pages may never use. Extracted unchanged from the compliance test.
 */

/**
 * JSX attributes whose value is machinery rather than something a reader reads.
 *
 * Deliberately short, and deliberately not a list of exceptions: every entry is
 * an attribute that can only ever carry a class name, a test hook, a URL or an
 * element id. Prose-bearing attributes (`title`, `body`, `label`, `aria-label`,
 * `placeholder`) are absent on purpose — those are read, so they are scanned.
 */
export const NON_PROSE_ATTRIBUTES = new Set([
  "className",
  "class",
  "data-testid",
  "testId",
  "id",
  "key",
  "href",
  "type",
  "role",
  "htmlFor",
  "slug",
  "aria-hidden",
]);

/**
 * The vocabulary, with the reason each entry is banned kept beside it so a
 * failure explains itself.
 *
 * "Lapse" and "lapsing" are absent, and that is not an oversight: "Let one of
 * these lapse" describes what the REQUIREMENT would do, which is the page's
 * whole organising idea. Only "lapsed" — a claim about the reader's present
 * standing — is out. The same distinction keeps "expiring" and "expiry" (a
 * property of a recorded date) while banning "expired" (a verdict on the
 * holder).
 */
export type VerdictPattern = { pattern: RegExp; why: string };

export const FORBIDDEN_VERDICTS: readonly VerdictPattern[] = [
  { pattern: /\bcompliant\b/i, why: "a verdict on the holder; nothing here is checked with the issuing body" },
  { pattern: /\bnoncompliant\b/i, why: "the same verdict, spelled shut" },
  { pattern: /\bvalid(ity)?\b/i, why: "a verdict on a credential this app has never seen" },
  // The one word here this app is sometimes entitled to use, and the exception
  // is narrow enough to state exactly. It may judge a thing it PRODUCED — the
  // JSON its own save request came back with, a URL the form just parsed —
  // because it can see that thing; "Save response was invalid" is a report on
  // the app's own machinery and says nothing about a certificate. It may never
  // judge a credential it has never seen, so the ban lifts only where the
  // string itself names the app's artefact as the subject.
  //
  // Every noun below widens that hole by one. Add one only for something the
  // app genuinely produced, and never to quiet a failure: "Your registration
  // is invalid" must stay red, and it does, because `registration` is not here.
  {
    pattern: /(?<!\b(?:response|request|payload|url|link|file|date)\s(?:is|was|were|are)\s)\binvalid\b/i,
    why: "a verdict on a credential this app has never seen",
  },
  { pattern: /\bexpired\b/i, why: "a state claim; the record's date passing is not the same fact" },
  { pattern: /\blapsed\b/i, why: "a state claim; they may have renewed last week and not edited the row" },
  { pattern: /\bup[- ]to[- ]date\b/i, why: "a verdict, in four words instead of one" },
  { pattern: /\bin good standing\b/i, why: "a verdict, in the register's own language" },
  // A status pill is the rejected design in one word, and the governed-verb
  // patterns below cannot see it: "Current" alone has no verb to govern and no
  // preposition to follow. Anchored to the start of a string so it catches the
  // pill and the "Current · 12 Mar 2027" chip while leaving every sentence
  // that merely contains the word — "what you keep current" — alone.
  //
  // This one entry is also the honest limit of the whole list. "Cleared",
  // "In force", "All requirements met", "No action needed" are each one
  // synonym away and none is caught. Enumeration will always be a step behind,
  // so this gate is a tripwire and the review is the control; do not read a
  // green run as a page that has been checked.
  { pattern: /^\s*current\b/i, why: "a bare status word is the verdict in one word" },
  // "Current" only where it is a predicate about the reader. "The requirements
  // you keep current" describes the obligation and is allowed; "your
  // registration is current" and "current to 12 Mar 2027" are the rejected
  // design, and `compliance.ts` names "current to" specifically.
  //
  // The line between the two is grammatical, and it is worth naming because
  // getting it wrong in either direction is fatal. A VERDICT is a finite
  // indicative predicate — "is current", "was current", "remains current",
  // "still current" — which asserts a state that holds right now, on this
  // app's authority, about something it has never checked. An OBLIGATION is
  // the same verb under an infinitive or a modal — "what has to stay current",
  // "you need to stay current", "these must remain current" — which describes
  // what the REQUIREMENT demands and asserts nothing about whether it is met.
  // The second is what this whole page is for, so a pattern that caught it
  // would be telling the page not to say what it is.
  //
  // Hence the lookbehind: the verb is a verdict only when nothing governs it.
  // It is narrow on purpose. "Continues to stay current" would slip through,
  // and that is the accepted cost of not banning the page's own subject.
  {
    pattern: /(?<!\b(?:to|must|should|shall)\s)\b(is|are|was|were|still|remains?|stays?)\s+current\b/i,
    why: "a verdict on the reader's standing",
  },
  { pattern: /\bcurrent\s+(to|until|through)\b/i, why: "a verdict with an expiry attached" },
  // A bare label is the verdict. Case-sensitive, so an internal token such as
  // the sign-off denylist entry "reviewed" is not the chip. "Reviewed by a
  // second editor, 12 Aug 2026" names a person and a date. "Met" as a
  // clinician's own DSM tick lives outside these surfaces.
  { pattern: /^\s*Reviewed\s*$/, why: "a bare review verdict; name who checked it and when" },
  { pattern: /^\s*Met\s*$/, why: "a bare status word; a recorded date is not a requirement being met" },
  { pattern: /\brequirements?\s+met\b/i, why: "a verdict that this app has not checked with anyone" },
];

/** A string the parser saw, and where it saw it. */
export interface ReaderFacingString {
  file: string;
  line: number;
  text: string;
}

export function isStringShaped(
  node: ts.Node,
): node is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral | ts.TemplateHead {
  return (
    ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    ts.isTemplateHead(node) ||
    ts.isTemplateMiddle(node) ||
    ts.isTemplateTail(node)
  );
}

/** The name of the JSX attribute this literal is the value of, if it is one. */
function enclosingJsxAttribute(node: ts.Node): string | undefined {
  let current: ts.Node | undefined = node.parent;
  while (current && !ts.isSourceFile(current)) {
    if (ts.isJsxAttribute(current)) return current.name.getText();
    // A literal inside an element's CHILDREN is not an attribute value, and
    // walking past the element would wrongly attribute it to the parent tag.
    if (ts.isJsxElement(current) || ts.isJsxSelfClosingElement(current) || ts.isJsxFragment(current)) return undefined;
    current = current.parent;
  }
  return undefined;
}

/** Whether this literal is plumbing that cannot reach the screen as prose. */
export function isMachinery(node: ts.Node): boolean {
  const parent = node.parent;
  if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent) || ts.isImportTypeNode(parent)) return true;
  // The "use client" directive, and any other bare string statement.
  if (ts.isExpressionStatement(parent)) return true;
  // An object KEY ("stops-work"), never the value beside it.
  if (ts.isPropertyAssignment(parent) && parent.name === node) return true;
  // Tailwind class lists assembled by the shared `cn` helper.
  if (ts.isCallExpression(parent) && ts.isIdentifier(parent.expression) && parent.expression.text === "cn") return true;
  const attribute = enclosingJsxAttribute(node);
  return attribute !== undefined && NON_PROSE_ATTRIBUTES.has(attribute);
}

/**
 * Every string in one file that could reach a reader: JSX text, plus string and
 * template literals that are not plumbing.
 *
 * Not the plain literal scanner the retired Ward Flow tests used, which answered
 * a different question — "does this file contain this known string" — and so
 * deliberately took every literal including class names and test ids. This one has to
 * decide what a reader SEES, which needs the literal's position as well as its
 * text, and it needs JSX text, which a literal scanner cannot return.
 */
export function readerFacingStrings(file: string): ReaderFacingString[] {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: ReaderFacingString[] = [];
  const record = (node: ts.Node, raw: string): void => {
    const text = raw.replace(/\s+/g, " ").trim();
    if (!text) return;
    found.push({ file, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, text });
  };
  const visit = (node: ts.Node): void => {
    if (ts.isJsxText(node)) record(node, node.text);
    else if (isStringShaped(node) && !isMachinery(node)) record(node, node.text);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

export function verdictsIn(
  strings: readonly ReaderFacingString[],
  patterns: readonly VerdictPattern[] = FORBIDDEN_VERDICTS,
): string[] {
  return strings.flatMap(({ file, line, text }) =>
    patterns
      .filter(({ pattern }) => pattern.test(text))
      .map(({ pattern, why }) => `${file}:${line} matches ${pattern} (${why}) in ${JSON.stringify(text)}`),
  );
}
