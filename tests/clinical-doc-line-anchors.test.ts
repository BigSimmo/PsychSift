import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

type Anchor = {
  docPath: string;
  docLineNum: number;
  label: string;
  targetRel: string;
  resolvedPath: string;
  lineNumbers: number[];
  associatedSymbol?: string;
  contextText: string;
};

// Known symbol aliases between call sites / imports and definitions
const SYMBOL_ALIASES: Record<string, string[]> = {
  resultCitation: ["citationFromResult", "resultCitation"],
};

function parseAnchorsFromDoc(docRelPath: string): Anchor[] {
  const fullDocPath = path.resolve(process.cwd(), docRelPath);
  const docContent = fs.readFileSync(fullDocPath, "utf-8");
  const docLines = docContent.split("\n");
  const anchors: Anchor[] = [];

  for (let idx = 0; idx < docLines.length; idx++) {
    const line = docLines[idx];
    // Match markdown links: [label](target)
    const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    let match: RegExpExecArray | null;

    while ((match = linkRegex.exec(line)) !== null) {
      const label = match[1];
      const targetRel = match[2];

      // Only check links that point to source code in src/
      if (!targetRel.includes("/src/") && !targetRel.startsWith("../src/") && !targetRel.startsWith("src/")) {
        continue;
      }

      // Check if the label contains line numbers, e.g., ":123", "file.ts:123", ":123,456", ":123-145"
      const colonIdx = label.lastIndexOf(":");
      if (colonIdx === -1) {
        continue;
      }

      const linePart = label.slice(colonIdx + 1);
      const digits = linePart.match(/\d+/g);
      if (!digits) {
        continue;
      }

      const lineNumbers = digits.map((d) => parseInt(d, 10));
      const resolvedPath = path.resolve(path.dirname(fullDocPath), targetRel);

      // Find any associated backticked symbol immediately preceding this anchor
      // Avoid matching across table cells (|) or distinct list clauses (;)
      const textBefore = line.slice(0, match.index);
      const symbolMatches = [...textBefore.matchAll(/`([A-Za-z0-9_$.]+)`/g)];
      let associatedSymbol: string | undefined;

      if (symbolMatches.length > 0) {
        const lastMatch = symbolMatches[symbolMatches.length - 1];
        const candidate = lastMatch[1];
        const symbolEndPos = lastMatch.index! + lastMatch[0].length;
        const textBetween = textBefore.slice(symbolEndPos);

        // Only pair if separator is short (<= 40 chars) and does not cross item boundaries (;, |)
        if (
          textBetween.length <= 40 &&
          !textBetween.includes(";") &&
          !textBetween.includes("|") &&
          !candidate.endsWith(".ts") &&
          !candidate.endsWith(".tsx") &&
          !candidate.includes(":")
        ) {
          associatedSymbol = candidate;
        }
      }

      anchors.push({
        docPath: docRelPath,
        docLineNum: idx + 1,
        label,
        targetRel,
        resolvedPath,
        lineNumbers,
        associatedSymbol,
        contextText: line.trim(),
      });
    }
  }

  return anchors;
}

describe("clinical doc line anchors", () => {
  const docs = ["docs/clinical-hazard-analysis.md", "docs/rag-injection-threat-model.md"];

  for (const doc of docs) {
    describe(`anchors in ${doc}`, () => {
      const anchors = parseAnchorsFromDoc(doc);

      it("finds line anchors in the document", () => {
        expect(anchors.length).toBeGreaterThan(10);
      });

      for (const anchor of anchors) {
        const testName = `L${anchor.docLineNum}: ${anchor.label} -> ${anchor.targetRel}`;

        it(`resolves valid target file and line bounds for ${testName}`, () => {
          expect(
            fs.existsSync(anchor.resolvedPath),
            `Target file does not exist: ${anchor.resolvedPath} (from ${anchor.docPath}:${anchor.docLineNum})`,
          ).toBe(true);

          const targetContent = fs.readFileSync(anchor.resolvedPath, "utf-8");
          const targetLines = targetContent.split("\n");
          const totalLines = targetLines.length;

          for (const lineNum of anchor.lineNumbers) {
            expect(
              lineNum,
              `Line number ${lineNum} out of bounds (1..${totalLines}) in ${anchor.targetRel} (from ${anchor.docPath}:${anchor.docLineNum})`,
            ).toBeGreaterThanOrEqual(1);

            expect(
              lineNum,
              `Line number ${lineNum} out of bounds (1..${totalLines}) in ${anchor.targetRel} (from ${anchor.docPath}:${anchor.docLineNum})`,
            ).toBeLessThanOrEqual(totalLines);
          }
        });

        if (anchor.associatedSymbol) {
          it(`verifies associated symbol '${anchor.associatedSymbol}' within ±25 lines of target for ${testName}`, () => {
            const targetContent = fs.readFileSync(anchor.resolvedPath, "utf-8");
            const targetLines = targetContent.split("\n");
            const totalLines = targetLines.length;

            const baseSymbol = anchor.associatedSymbol!.split(".")[0];
            const fullSymbol = anchor.associatedSymbol!;
            const targetSymbols = SYMBOL_ALIASES[fullSymbol] ?? SYMBOL_ALIASES[baseSymbol] ?? [fullSymbol, baseSymbol];

            // Check each referenced line number in anchor
            const symbolFound = anchor.lineNumbers.some((lineNum) => {
              const start = Math.max(0, lineNum - 26);
              const end = Math.min(totalLines, lineNum + 25);
              const windowLines = targetLines.slice(start, end);
              const windowText = windowLines.join("\n");

              return targetSymbols.some((sym) => windowText.includes(sym));
            });

            expect(
              symbolFound,
              `Symbol '${anchor.associatedSymbol}' (or alias) not found within ±25 lines of [${anchor.lineNumbers.join(", ")}] in ${anchor.targetRel} (from ${anchor.docPath}:${anchor.docLineNum})`,
            ).toBe(true);
          });
        }
      }
    });
  }
});
