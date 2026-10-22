import { describe, expect, it } from "vitest";
import {
  coverageGaps,
  implementedApiRouteGaps,
  schemaTableGaps,
  trackedRootDirectoryNames,
} from "../scripts/check-codebase-index-coverage.mjs";

const index = `
## Top-level layout

Roots: \`src/\`, \`docs/\`, \`.agents/\`.

## Application architecture

### Product pages (\`src/app/\`)

Routes: \`/documents\`, \`/reference/colour-coding\`.

### API routes (\`src/app/api/\`)

Routes: \`/api/answer\`.

## \`src/lib/\` module map

Modules: \`observability/\`, \`validation/\`, \`extractors/document.ts\`.

## Supabase

### Schema tables

\`documents\`, \`document_chunks\`

### Migration themes
`;

describe("coverageGaps", () => {
  it("reports a module whose name is absent from the index", () => {
    const gaps = coverageGaps(index, [{ kind: "lib", dir: "src/lib", name: "ingestion" }]);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].full).toBe("src/lib/ingestion");
  });

  it("treats section-scoped path code spans as covered", () => {
    const gaps = coverageGaps(index, [
      { kind: "lib", dir: "src/lib", name: "observability" },
      { kind: "lib", dir: "src/lib", name: "validation" },
      { kind: "route", dir: "src/app", name: "documents" },
      { kind: "route", dir: "src/app", name: "reference" },
      { kind: "lib", dir: "src/lib", name: "extractors" },
    ]);
    expect(gaps).toEqual([]);
  });

  it("does not count a bare name that appears only in prose", () => {
    const withProse = index.replace("## `src/lib/` module map", "## `src/lib/` module map\n\nIngestion is important.");
    const gaps = coverageGaps(withProse, [{ kind: "lib", dir: "src/lib", name: "ingestion" }]);
    expect(gaps.map((gap) => gap.full)).toEqual(["src/lib/ingestion"]);
  });

  it("does not let a product route satisfy an API route", () => {
    const withProductRoute = index.replace("`/documents`", "`/documents`, `/medications`");
    const gaps = coverageGaps(withProductRoute, [{ kind: "api", dir: "src/app/api", name: "medications" }]);
    expect(gaps.map((gap) => gap.full)).toEqual(["src/app/api/medications"]);
  });

  it("honours the allowlist", () => {
    const gaps = coverageGaps(index, [{ kind: "route", dir: "src/app", name: "icons" }], new Set(["src/app/icons"]));
    expect(gaps).toEqual([]);
  });

  it("checks tracked repository-root directories in the top-level layout section", () => {
    expect(
      coverageGaps(index, [
        { kind: "root", dir: ".", name: "src" },
        { kind: "root", dir: ".", name: ".agents" },
      ]),
    ).toEqual([]);
    expect(coverageGaps(index, [{ kind: "root", dir: ".", name: "plugins" }])).toEqual([
      { full: "./plugins", kind: "root", tried: ["plugins/"] },
    ]);
  });

  it("derives unique root directories from tracked paths only", () => {
    expect(
      trackedRootDirectoryNames([
        "src/app/page.tsx",
        "src/lib/env.ts",
        "docs/codebase-index.md",
        ".agents/skills/task/SKILL.md",
        "README.md",
      ]),
    ).toEqual([".agents", "docs", "src"]);
  });

  it("reports missing and stale schema-table entries", () => {
    const schema = `
      create table public.documents (id uuid primary key);
      create table if not exists public.rag_queries (id uuid primary key);
    `;
    expect(schemaTableGaps(index, schema)).toEqual({
      missing: ["rag_queries"],
      stale: ["document_chunks"],
    });
  });
});

function apiTable(endpoints: string[]) {
  return `
### API routes (\`src/app/api/\`)

| Area | Implemented endpoints |
| --- | --- |
| Example | ${endpoints.map((endpoint) => `\`${endpoint}\``).join(", ")} |

## \`src/lib/\` module map
`;
}

describe("implementedApiRouteGaps", () => {
  it("accepts nested and dynamic endpoints with exact local route handlers", () => {
    expect(
      implementedApiRouteGaps(
        apiTable(["/api/answer", "/api/documents/bulk/reindex", "/api/cme/entries/[id]/evidence/[evidenceId]"]),
        [
          "src/app/api/answer/route.ts",
          "src/app/api/documents/bulk/reindex/route.ts",
          "src\\app\\api\\cme\\entries\\[id]\\evidence\\[evidenceId]\\route.ts",
        ],
      ),
    ).toEqual([]);
  });

  it("rejects an invented endpoint even when its API family exists", () => {
    expect(
      implementedApiRouteGaps(
        apiTable(["/api/documents", "/api/documents/[id]/summary", "/api/documents/[id]/summary"]),
        ["src/app/api/documents/route.ts", "src/app/api/documents/[id]/summarize/route.ts"],
      ),
    ).toEqual(["/api/documents/[id]/summary"]);
  });

  it("preserves case when matching dynamic route segment names", () => {
    expect(
      implementedApiRouteGaps(apiTable(["/api/images/[imageid]"]), ["src/app/api/images/[imageId]/route.ts"]),
    ).toEqual(["/api/images/[imageid]"]);
  });

  it("skips placeholders, wildcard and query/hash examples", () => {
    expect(
      implementedApiRouteGaps(
        apiTable([
          "/api/calendar/feed/<token>.ics",
          "/api/documents/{id}",
          "/api/documents/*",
          "/api/search?q=example",
          "/api/documents#example",
        ]),
        [],
      ),
    ).toEqual([]);
  });

  it("limits implementation claims to table rows inside the API section", () => {
    const examples = `
| Cookie example outside the API section | \`/api/cookie/path\` |
${apiTable(["/api/answer"]).replace("| Area |", "Example: `/api/proposed/example`.\n\n| Area |")}
| Source note in the module section | \`/api/not-an-endpoint\` |
`;
    expect(implementedApiRouteGaps(examples, ["src/app/api/answer/route.ts"])).toEqual([]);
  });
});
