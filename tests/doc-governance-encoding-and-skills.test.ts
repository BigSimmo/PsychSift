import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const MOJIBAKE_LATIN1_PATTERN = /[\u00c2-\u00f4][\u0080-\u00bf]/;
const MOJIBAKE_CP1252_PATTERN = /â€|â†|â‰|â”|â–|âœ|Ã—|Â·|Â§/;

describe("documentation governance: UTF-8 encoding, skill contracts, and token audit accuracy", () => {
  it.each(["docs/privacy-impact-assessment.md", "docs/openai-cross-border-basis.md"])(
    "%s contains no UTF-8 BOM or double-encoded UTF-8 mojibake sequences",
    (relativePath) => {
      const content = readFileSync(path.join(repoRoot, relativePath), "utf8");

      expect(content.startsWith("\uFEFF")).toBe(false);
      expect(content).not.toMatch(MOJIBAKE_LATIN1_PATTERN);
      expect(content).not.toMatch(MOJIBAKE_CP1252_PATTERN);
    },
  );

  it("documents the RAG ranking-protection and canary-pair safeguards in .agents/skills/rag/SKILL.md", () => {
    const ragSkill = readFileSync(path.join(repoRoot, ".agents/skills/rag/SKILL.md"), "utf8");

    expect(ragSkill).toContain("scripts/pr-policy.mjs");
    expect(ragSkill).toContain("ragRanking");
    expect(ragSkill).toContain("src/lib/rag.ts");
    expect(ragSkill).toContain("src/lib/chunking.ts");
    expect(ragSkill).toContain("src/lib/clinical-search.ts");
    expect(ragSkill).toContain("src/lib/evidence-relevance.ts");
    expect(ragSkill).toContain("src/lib/answer-verification.ts");
    expect(ragSkill).toContain("supabase/migrations/*search*");
    expect(ragSkill).toContain("explicit owner approval");
    expect(ragSkill).toContain("canary pairs");
    expect(ragSkill).toContain("eval:rag:offline");
    expect(ragSkill).toContain("check:rag:fixtures");
  });

  it("documents ranking-protection, canary pairs, generation reaping, and storage cleanup in .agents/skills/reindex/SKILL.md", () => {
    const reindexSkill = readFileSync(path.join(repoRoot, ".agents/skills/reindex/SKILL.md"), "utf8");

    expect(reindexSkill).toContain("src/lib/chunking.ts");
    expect(reindexSkill).toContain("src/lib/reindex-pipeline.ts");
    expect(reindexSkill).toContain("canary pairs");
    expect(reindexSkill).toContain("most-recent generation");
    expect(reindexSkill).toContain("legacy unstamped documents");
    expect(reindexSkill).toContain("storage-bucket cleanup");
    expect(reindexSkill).toContain("explicit owner approval");
  });

  it("documents the deliberate !min-h-[48px] floor in account-setup-dialog.tsx in docs/redesign/07-token-adoption-audit.md", () => {
    const auditDoc = readFileSync(path.join(repoRoot, "docs/redesign/07-token-adoption-audit.md"), "utf8");

    expect(auditDoc).toContain("account-setup-dialog.tsx:246");
    expect(auditDoc).toContain("!min-h-[48px]");
    expect(auditDoc.match(/account-setup-dialog\.tsx:246/g)?.length).toBeGreaterThanOrEqual(2);
  });
});
