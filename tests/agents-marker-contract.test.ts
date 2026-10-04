import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * AGENTS.md marker pairs are the always-loaded policy blocks. A second copy
 * pasted into a short pointer, or a safety block emptied down to a heading,
 * is how those markers drift.
 */
const AGENTS = readFileSync("AGENTS.md", "utf8");

const FULL_BLOCKS: Readonly<Record<string, readonly string[]>> = {
  "local-server-safety": ["# Local server safety", "Never assume `localhost:3000`"],
  "supabase-project-safety": ["# Supabase project safety", "MERGING TO `main` DEPLOYS TO PRODUCTION"],
  "rag-ranking-protection": ["# RAG ranking protection", "Flag it."],
  "railway-project-safety": ["# Railway project safety", "clinical-kb"],
  "api-confirmation-boundary": [
    "# API and provider confirmation boundary",
    "Never run, modify, test, or otherwise interact with OpenAI",
  ],
};

const POINTER_BLOCKS = [
  "dependency-shortcut",
  "bug-hunter-shortcut",
  "codex-review-throttling",
  "codex-desktop-worktree-setup",
  "page-and-button-wiring",
];

type MarkerBlock = { id: string; body: string };

function markerBlocks(text: string): MarkerBlock[] {
  const re = /<!-- BEGIN:([a-z0-9-]+) -->|<!-- END:([a-z0-9-]+) -->/g;
  const open: { id: string; index: number }[] = [];
  const pairs: MarkerBlock[] = [];
  for (const match of text.matchAll(re)) {
    if (match[1]) {
      open.push({ id: match[1], index: (match.index ?? 0) + match[0].length });
      continue;
    }
    const id = match[2];
    const last = open.pop();
    if (!id || !last || last.id !== id) {
      throw new Error(`AGENTS.md marker ${id ?? "(missing)"} does not close the block that is open`);
    }
    pairs.push({ id, body: text.slice(last.index, match.index) });
  }
  if (open.length > 0) throw new Error(`AGENTS.md leaves ${open.map((entry) => entry.id).join(", ")} unclosed`);
  return pairs;
}

describe("AGENTS.md marker contract", () => {
  const blocks = markerBlocks(AGENTS);

  it("keeps each marker pair balanced and unique", () => {
    const ids = blocks.map((block) => block.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining(["nextjs-agent-rules", ...Object.keys(FULL_BLOCKS), ...POINTER_BLOCKS]));
  });

  it("keeps the Next.js warning inside its marker", () => {
    expect(blocks.find((block) => block.id === "nextjs-agent-rules")?.body).toContain(
      "This is NOT the Next.js you know",
    );
  });

  it("keeps the full safety policy inside its markers", () => {
    const byId = new Map(blocks.map((block) => [block.id, block.body]));
    for (const [id, anchors] of Object.entries(FULL_BLOCKS)) {
      const body = byId.get(id) ?? "";
      for (const anchor of anchors) expect(body, id).toContain(anchor);
    }
  });

  it("keeps pointer blocks short and linked to a file that exists", () => {
    const byId = new Map(blocks.map((block) => [block.id, block.body]));
    for (const id of POINTER_BLOCKS) {
      const body = byId.get(id) ?? "";
      const lines = body.split("\n").filter((line) => line.trim().length > 0);
      expect(lines.length, id).toBeLessThanOrEqual(25);
      const paths = [...body.matchAll(/docs\/agents\/[a-z0-9./-]+\.md/g)].map((match) => match[0]);
      expect(paths.length, id).toBeGreaterThan(0);
      for (const path of paths) expect(existsSync(path), path).toBe(true);
    }
  });
});
