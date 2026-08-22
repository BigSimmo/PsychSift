import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { appModeDefinitions } from "@/lib/app-modes";
import { removePathSync } from "../scripts/retryable-fs.mjs";
import {
  buildDocumentationSection,
  buildReviewStateSection,
  buildRoutesSection,
  buildTestHealthSection,
  listDocumentPaths,
  readFlakeLedger,
  readReviewRecordRows,
  type SiteMapInput,
} from "../scripts/generate-repo-awareness-snapshot";

const SITE_MAP: SiteMapInput = {
  pageRoutes: [
    { route: "/dsm", file: "src/app/(search-app)/dsm/page.tsx" },
    { route: "/mockups/development", file: "src/app/mockups/development/page.tsx" },
    { route: "/tools", file: "src/app/tools/page.tsx" },
  ],
  apiRoutes: [{ route: "/api/answer", file: "src/app/api/answer/route.ts" }],
  redirects: [{ route: "/tools", file: "src/app/tools/page.tsx", target: "/" }],
};

describe("buildRoutesSection", () => {
  it("separates product pages from mockup pages", () => {
    const section = buildRoutesSection(SITE_MAP);
    expect(section.pages).toEqual([
      { path: "/dsm", file: "src/app/(search-app)/dsm/page.tsx", area: "product" },
      { path: "/mockups/development", file: "src/app/mockups/development/page.tsx", area: "mockup" },
    ]);
  });

  it("moves a redirect out of pages so it is listed once, under redirects", () => {
    const section = buildRoutesSection(SITE_MAP);
    expect(section.pages.map((page) => page.path)).not.toContain("/tools");
    expect(section.redirects).toEqual([{ path: "/tools", file: "src/app/tools/page.tsx", target: "/" }]);
  });

  it("carries every app mode with a home href", () => {
    const section = buildRoutesSection(SITE_MAP);
    expect(section.modes).toHaveLength(appModeDefinitions.length);
    for (const mode of section.modes) {
      expect(mode.home).toMatch(/^\//);
      expect(mode.label.length).toBeGreaterThan(0);
      expect(typeof mode.dev_only).toBe("boolean");
    }
  });

  it("computes counts from the arrays it emits, so a count cannot disagree with its list", () => {
    const section = buildRoutesSection(SITE_MAP);
    expect(section.counts).toEqual({
      modes: section.modes.length,
      pages: 2,
      product_pages: 1,
      mockup_pages: 1,
      redirects: 1,
      api: 1,
    });
  });

  it("sorts every array by path so filesystem ordering cannot make the gate fire", () => {
    const shuffled: SiteMapInput = {
      ...SITE_MAP,
      pageRoutes: [...SITE_MAP.pageRoutes].reverse(),
      apiRoutes: [{ route: "/api/zeta", file: "z.ts" }, ...SITE_MAP.apiRoutes],
    };
    const section = buildRoutesSection(shuffled);
    expect(section.pages.map((page) => page.path)).toEqual(["/dsm", "/mockups/development"]);
    expect(section.api.map((route) => route.path)).toEqual(["/api/answer", "/api/zeta"]);
  });
});

describe("listDocumentPaths", () => {
  function withTemporaryRepository(callback: (repoRoot: string) => void) {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "repo-awareness-docs-"));
    try {
      execFileSync("git", ["init", "--quiet", repoRoot]);
      mkdirSync(path.join(repoRoot, "docs"));
      writeFileSync(path.join(repoRoot, "docs", "tracked.md"), "# Tracked\n");
      execFileSync("git", ["add", "docs/tracked.md"], { cwd: repoRoot });
      callback(repoRoot);
    } finally {
      removePathSync(repoRoot, { recursive: true });
    }
  }

  it("fails closed when a non-ignored Markdown document has not been staged", () => {
    withTemporaryRepository((repoRoot) => {
      writeFileSync(path.join(repoRoot, "docs", "new.md"), "# New\n");

      expect(() => listDocumentPaths(repoRoot)).toThrow(
        "Untracked Markdown documents would be omitted from the repo-awareness snapshot: docs/new.md. Stage intended documents or add scratch notes to .gitignore before generating.",
      );
    });
  });

  it("continues to exclude ignored scratch notes", () => {
    withTemporaryRepository((repoRoot) => {
      writeFileSync(path.join(repoRoot, ".gitignore"), "docs/scratch.md\n");
      writeFileSync(path.join(repoRoot, "docs", "scratch.md"), "# Scratch\n");

      expect(listDocumentPaths(repoRoot)).toEqual(["docs/tracked.md"]);
    });
  });
});

const README = `
# Clinical KB Documentation Index

- [testing.md](testing.md) — how tests run
- [design-system/SPEC.md](design-system/SPEC.md) — the design system
- [an external link](https://example.com/testing.md) — not a repo doc
Referenced in prose as \`docs/rag-behaviour/README.md\` too.
`;

const DOC_PATHS = [
  "docs/testing.md",
  "docs/design-system/SPEC.md",
  "docs/design-system/GATES.md",
  "docs/rag-behaviour/README.md",
  "docs/uncatalogued.md",
];

describe("buildDocumentationSection", () => {
  it("marks a document catalogued when README links it relative to docs/", () => {
    const section = buildDocumentationSection(DOC_PATHS, README);
    const byPath = new Map(section.documents.map((document) => [document.path, document]));
    expect(byPath.get("docs/testing.md")?.catalogued).toBe(true);
    expect(byPath.get("docs/design-system/SPEC.md")?.catalogued).toBe(true);
  });

  it("marks a document catalogued when README names its full repo path in prose", () => {
    const section = buildDocumentationSection(DOC_PATHS, README);
    expect(section.documents.find((document) => document.path === "docs/rag-behaviour/README.md")?.catalogued).toBe(
      true,
    );
  });

  it("marks a document uncatalogued when README never names it", () => {
    const section = buildDocumentationSection(DOC_PATHS, README);
    expect(section.documents.find((document) => document.path === "docs/uncatalogued.md")?.catalogued).toBe(false);
    expect(section.documents.find((document) => document.path === "docs/design-system/GATES.md")?.catalogued).toBe(
      false,
    );
  });

  it("is not fooled by a repository URL that contains a doc path", () => {
    // Removing the URL strip in `catalogueTargets` makes this red: the bare
    // regex would match `docs/only-external.md` inside the blob URL and mark a
    // document catalogued that the index never lists.
    const readme = "See the source at https://github.com/BigSimmo/Database/blob/main/docs/only-external.md for detail.";
    const section = buildDocumentationSection(["docs/only-external.md"], readme);
    expect(section.documents[0].catalogued).toBe(false);
    expect(section.counts.uncatalogued).toBe(1);
  });

  it("does not catalogue a full doc path inside an external Markdown link", () => {
    // This is the external-link form reported in PR #2292. Without URL
    // stripping, the prose matcher would see its `docs/testing.md` suffix.
    const readme = "See [external guidance](https://example.com/docs/testing.md) for detail.";
    const section = buildDocumentationSection(["docs/testing.md"], readme);
    expect(section.documents[0].catalogued).toBe(false);
  });

  it("still catalogues a document named in ordinary prose", () => {
    // The guard against URLs must not cost us the real prose case, which is the
    // reason the second scan exists at all.
    const section = buildDocumentationSection(["docs/testing.md"], "Read `docs/testing.md` before changing a test.");
    expect(section.documents[0].catalogued).toBe(true);
  });

  it("assigns a section from the first directory under docs/, or root", () => {
    const section = buildDocumentationSection(DOC_PATHS, README);
    const sections = new Map(section.documents.map((document) => [document.path, document.section]));
    expect(sections.get("docs/testing.md")).toBe("root");
    expect(sections.get("docs/design-system/SPEC.md")).toBe("design-system");
  });

  it("summarises each section and computes counts from its own arrays", () => {
    const section = buildDocumentationSection(DOC_PATHS, README);
    expect(section.sections).toEqual([
      { name: "design-system", documents: 2, uncatalogued: 1 },
      { name: "rag-behaviour", documents: 1, uncatalogued: 0 },
      { name: "root", documents: 2, uncatalogued: 1 },
    ]);
    expect(section.counts).toEqual({ documents: 5, catalogued: 3, uncatalogued: 2, sections: 3 });
  });

  it("sorts documents by path so listing order cannot make the gate fire", () => {
    const section = buildDocumentationSection([...DOC_PATHS].reverse(), README);
    expect(section.documents.map((document) => document.path)).toEqual([...DOC_PATHS].sort());
  });
});

const FLAKE = {
  id: "ui-smoke-composer",
  title: "phone composer stays docked @quarantine",
  spec: "tests/ui-smoke.spec.ts",
  reason: "Sub-pixel rounding on the dock reserve",
  owner: "frontend",
  reproduction: "npm run verify:ui -- --grep composer",
  firstSeen: "2026-08-01",
  lastSeen: "2026-08-03",
  expires: "2026-09-01",
  tracking: "docs/process-hardening.md#known-flakes",
};

describe("buildTestHealthSection", () => {
  it("carries the ledger's own comment so an empty panel can say why in words", () => {
    const section = buildTestHealthSection({ $comment: "intentionally empty", flakes: [] });
    expect(section.note).toBe("intentionally empty");
    expect(section.quarantined).toEqual([]);
    expect(section.counts).toEqual({ quarantined: 0 });
  });

  it("uses a null note when the ledger carries no comment", () => {
    expect(buildTestHealthSection({ flakes: [] }).note).toBeNull();
  });

  it("maps every required ledger field, renaming the dates to snake case", () => {
    const section = buildTestHealthSection({ flakes: [FLAKE] });
    expect(section.quarantined).toEqual([
      {
        id: "ui-smoke-composer",
        title: "phone composer stays docked @quarantine",
        spec: "tests/ui-smoke.spec.ts",
        reason: "Sub-pixel rounding on the dock reserve",
        owner: "frontend",
        reproduction: "npm run verify:ui -- --grep composer",
        first_seen: "2026-08-01",
        last_seen: "2026-08-03",
        expires: "2026-09-01",
        tracking: "docs/process-hardening.md#known-flakes",
      },
    ]);
    expect(section.counts.quarantined).toBe(1);
  });

  it("emits exactly the ten mapped fields, so no time-derived flag can be added quietly", () => {
    // Expiry is arithmetic against the current date. Storing it under ANY name
    // would change the snapshot's bytes daily and fail the staleness gate on an
    // unchanged repository. A `not.toHaveProperty("expired")` check pins one
    // spelling; this pins the rule, and goes red for `isExpired` or `lapsed` too.
    const section = buildTestHealthSection({ flakes: [FLAKE] });
    expect(Object.keys(section.quarantined[0]).sort()).toEqual([
      "expires",
      "first_seen",
      "id",
      "last_seen",
      "owner",
      "reason",
      "reproduction",
      "spec",
      "title",
      "tracking",
    ]);
    expect(Object.keys(section.counts)).toEqual(["quarantined"]);
  });

  it("fails loudly and names the entry when a required field is missing or blank", () => {
    expect(() => buildTestHealthSection({ flakes: [{ ...FLAKE, owner: "" }] })).toThrow(/ui-smoke-composer.*owner/);
    expect(() => buildTestHealthSection({ flakes: [{ ...FLAKE, tracking: undefined }] })).toThrow(
      /ui-smoke-composer.*tracking/,
    );
  });

  it("sorts by expiry then id so ledger ordering cannot make the gate fire", () => {
    const later = { ...FLAKE, id: "b-later", expires: "2026-09-10" };
    const sameDay = { ...FLAKE, id: "a-same" };
    const section = buildTestHealthSection({ flakes: [later, FLAKE, sameDay] });
    expect(section.quarantined.map((entry) => entry.id)).toEqual(["a-same", "ui-smoke-composer", "b-later"]);
  });

  it("names the file when the ledger is malformed, rather than emptying the panel", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "flake-ledger-malformed-"));
    try {
      const bad = path.join(dir, "flake-ledger.json");
      writeFileSync(bad, JSON.stringify({ $comment: "no flakes key" }), "utf8");
      expect(() => readFlakeLedger(bad)).toThrow(/flake-ledger\.json: expected a "flakes" array/);
    } finally {
      removePathSync(dir, { recursive: true });
    }
  });
});

const ROW_A = {
  file: "docs/branch-review-records/aaa.record.md",
  line: "| 2026-08-15 | claude/one | 02d2e7fc839cf370b512f66b255d5f9e9b42f377 | ledger triage | Approved | ledger guards passed |",
};
const ROW_B = {
  file: "docs/branch-review-records/bbb.record.md",
  line: "| 2026-08-20 | claude/two | 639108f07aa1bcd2ee3344556677889900aabbcc | hub | Approved | 2 failed \\| 14 passed |",
};

describe("buildReviewStateSection", () => {
  it("parses the six columns of a record row", () => {
    const section = buildReviewStateSection([ROW_A]);
    expect(section.records).toEqual([
      {
        date: "2026-08-15",
        ref: "claude/one",
        head: "02d2e7fc839cf370b512f66b255d5f9e9b42f377",
        scope: "ledger triage",
        outcome: "Approved",
        checks: "ledger guards passed",
      },
    ]);
  });

  it("unescapes a markdown-escaped pipe, so no reader sees a literal backslash", () => {
    // The escape is a markdown-table artifact. Carrying it into JSON is how the
    // Phase 1 ledger page came to render "2 failed \\| 14 passed".
    const section = buildReviewStateSection([ROW_B]);
    expect(section.records[0].checks).toBe("2 failed | 14 passed");
  });

  it("orders newest first so the most recent review is the first thing read", () => {
    const section = buildReviewStateSection([ROW_A, ROW_B]);
    expect(section.records.map((record) => record.ref)).toEqual(["claude/two", "claude/one"]);
  });

  it("counts records and distinct refs", () => {
    const again = { file: "docs/branch-review-records/ccc.record.md", line: ROW_A.line };
    const section = buildReviewStateSection([ROW_A, ROW_B, again]);
    expect(section.counts).toEqual({ records: 3, refs: 2 });
  });

  it("fails loudly and names the file when a row has the wrong number of columns", () => {
    const short = { file: "docs/branch-review-records/ddd.record.md", line: "| 2026-08-15 | claude/one |" };
    expect(() => buildReviewStateSection([short])).toThrow(/ddd\.record\.md/);
  });

  it("keeps an abbreviated head verbatim rather than rejecting the record", () => {
    // Older records were written with abbreviated SHAs. Rejecting them would
    // drop real reviews from the panel, which is the failure mode the
    // no-silent-drop rule exists to prevent — loudly or otherwise.
    const abbreviated = {
      file: "docs/branch-review-records/eee.record.md",
      line: "| 2026-01-02 | r | 1a2b3c4 | s | o | c |",
    };
    expect(buildReviewStateSection([abbreviated]).records[0].head).toBe("1a2b3c4");
  });

  it("names the file when a record carries no parsable row", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "review-records-empty-"));
    try {
      writeFileSync(path.join(dir, "fff.record.md"), "# not a table row\n", "utf8");
      expect(() => readReviewRecordRows(dir)).toThrow(/fff\.record\.md: no review record row found/);
    } finally {
      removePathSync(dir, { recursive: true });
    }
  });
});

describe("the real review record corpus", () => {
  it("parses every committed record into six populated columns", async () => {
    // Real-data proof for the locally-owned splitter. A fixture-only test would
    // not have caught the escaped pipes that actually appear in the corpus.
    const { readReviewRecordRows, buildReviewStateSection: build } =
      await import("../scripts/generate-repo-awareness-snapshot");
    const section = build(readReviewRecordRows());
    expect(section.counts.records).toBeGreaterThan(400);
    for (const record of section.records) {
      expect(record.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(record.ref.length).toBeGreaterThan(0);
      expect(record.head).toMatch(/^[0-9a-f]{7,40}$/);
      expect(record.checks).not.toMatch(/\\\|/);
      expect(record.scope.length).toBeGreaterThan(0);
      expect(record.outcome.length).toBeGreaterThan(0);
    }
  });
});
