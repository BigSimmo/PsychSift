import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  cmeEntryCreateSchema,
  cmeEntryUpdateSchema,
  cmeListQuerySchema,
  cmeYearConfirmSchema,
} from "@/lib/cme/schemas";

const routePaths = [
  "src/app/api/cme/entries/route.ts",
  "src/app/api/cme/entries/[id]/route.ts",
  "src/app/api/cme/year/route.ts",
  "src/app/api/cme/year/close/route.ts",
] as const;

const routes = routePaths.map((path) => ({ path, source: readFileSync(path, "utf8").replace(/\r\n/g, "\n") }));
const repository = readFileSync("src/lib/cme/repository.ts", "utf8").replace(/\r\n/g, "\n");
const list = routes[0]!.source;
const detail = routes[1]!.source;
const year = routes[2]!.source;

/** Drop one key, without a destructured binding the linter then calls unused. */
function without<T extends object, K extends keyof T>(value: T, key: K): Omit<T, K> {
  const copy = { ...value };
  delete copy[key];
  return copy;
}

describe("the CME API", () => {
  for (const { path, source } of routes) {
    it(`${path} takes the owner from the session, never the request`, () => {
      expect(source).toMatch(/requireAuthenticatedUser\(/);
      expect(source).not.toMatch(/body\.(owner_id|ownerId)/);
      expect(source).not.toMatch(/searchParams\.get\("owner/);
    });

    it(`${path} refuses writes in demo mode rather than faking them`, () => {
      if (!/export async function (POST|PATCH|DELETE|PUT)/.test(source)) return;
      expect(source).toMatch(/isDemoMode\(\)/);
      expect(source).toMatch(/demo_mode_unavailable/);
    });

    it(`${path} rate-limits under the "cme" bucket, never a copy-pasted "on_call" one`, () => {
      if (!/consumeSubjectApiRateLimit/.test(source)) return;
      expect(source).toMatch(/bucket:\s*"cme"/);
      expect(source).not.toMatch(/bucket:\s*"on_call"/);
    });

    it(`${path} exports only names Next.js's App Router recognises on a route file`, () => {
      // The full recognised set for a route.ts (node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md):
      // the seven HTTP method handlers, the route-segment-config scalars, and generateStaticParams.
      // Anything else — a schema, a helper, a type — must live in a separate module: an extra
      // export here is exactly the shape of mistake that would make `cmeYearConfirmSchema` (or a
      // future helper) importable straight from a route file instead of from `@/lib/cme/schemas.ts`.
      const NEXT_ROUTE_EXPORTS = new Set([
        "GET",
        "POST",
        "PUT",
        "PATCH",
        "DELETE",
        "HEAD",
        "OPTIONS",
        "dynamic",
        "dynamicParams",
        "revalidate",
        "fetchCache",
        "runtime",
        "preferredRegion",
        "maxDuration",
        "generateStaticParams",
      ]);

      const exportedNames = new Set<string>();
      for (const match of source.matchAll(/^export\s+(?:async\s+)?function\s+(\w+)/gm)) {
        exportedNames.add(match[1]!);
      }
      for (const match of source.matchAll(/^export\s+const\s+(\w+)/gm)) {
        exportedNames.add(match[1]!);
      }
      for (const match of source.matchAll(/^export\s*\{([^}]+)\}/gm)) {
        for (const entry of match[1]!.split(",")) {
          const name = entry
            .trim()
            .split(/\s+as\s+/)[0]
            ?.trim();
          if (name) exportedNames.add(name);
        }
      }

      // Fails closed: every one of these three route files exports at least `runtime` plus one
      // HTTP method today. If a refactor ever left a file with no top-level export at all, this
      // stops silently passing on an empty set.
      expect(exportedNames.size).toBeGreaterThan(0);
      for (const name of exportedNames) {
        expect(
          NEXT_ROUTE_EXPORTS.has(name),
          `${path} exports "${name}", which Next.js does not recognise on a route file`,
        ).toBe(true);
      }
    });
  }

  /**
   * Every `cme_*` table access in every route is scoped by `owner_id`, on the same query chain
   * as its `.from()` call — either an `.eq("owner_id", …)` filter (a read/update/delete) or an
   * inline `owner_id: …` key in the write payload (an insert/upsert) — so a query can never be
   * misread by looking at the `.from()` call alone without also seeing how it is scoped.
   *
   * Allocation replace lives in `@/lib/cme/repository` (owner stamped on each inserted row).
   */
  it("scopes every cme_* query in every route by owner_id, on the same chain as .from()", () => {
    const chains = routes.flatMap(({ path, source }) =>
      [...source.matchAll(/\.from\("cme_\w+"\)([\s\S]*?)(?:;\n|\n\n)/g)].map((match) => ({
        path,
        chainTail: match[1]!,
      })),
    );
    // Fails closed: if every `.from("cme_...")` call in these routes ever moved into the
    // repository, this would stop testing anything without anyone noticing.
    expect(chains.length).toBeGreaterThan(0);

    const chainsRequiringInlineScope = chains.filter(({ chainTail }) => !/\.insert\(allocationRows\)/.test(chainTail));
    expect(chainsRequiringInlineScope.length).toBeGreaterThan(0);
    for (const { path, chainTail } of chainsRequiringInlineScope) {
      const scoped = /\.eq\(\s*["']owner_id["']/.test(chainTail) || /\bowner_id\s*:/.test(chainTail);
      expect(scoped, `${path}: a .from("cme_...") chain has no owner_id scope: ${chainTail.slice(0, 160)}`).toBe(true);
    }
  });

  it("scopes allocation writes through the repository row payload (owner_id on each insert)", () => {
    expect(repository).toMatch(/owner_id: ownerId/);
    expect(repository).toMatch(/\.from\("cme_allocations"\)[\s\S]*?\.insert\(/);
    expect(detail).toMatch(/saveCmeEntry\(/);
    expect(repository).toMatch(/rpc\("cme_save_entry_v2",\s*\{\s*p_owner_id: ownerId/);
    expect(repository).toMatch(/rpc\("cme_confirm_year",\s*\{\s*p_owner_id:\s*ownerId/);
  });
});

describe("CME entry [id] route", () => {
  it("returns 404 identically for a missing id and an id owned by someone else", () => {
    expect(detail).toContain("CPD entry not found.");
    // Three not-found branches — the PATCH pre-check, the PATCH update, and the DELETE — each
    // fed by a query already scoped by id AND owner_id on the same chain. None of them ever
    // learns whether the id was missing or just belongs to another owner, so none of them can
    // leak that distinction to the caller as a 403-vs-404 oracle.
    expect(detail.match(/CPD entry not found\./g)?.length).toBe(1);
    expect(detail).toContain("setCmeEntryArchived(supabase, user.id, id");
    expect(repository).toContain("cme_entry_not_found");
  });

  it("never carries a 403 or a wrong-owner-specific status a caller could use to tell the two cases apart", () => {
    expect(detail).not.toMatch(/\b403\b/);
    expect(detail).not.toMatch(/forbidden/i);
  });

  it("rejects linked routine/document IDs the caller does not own before writing", () => {
    for (const source of [list, detail]) {
      expect(source).toMatch(/assertValidCmeLinkedIds\(/);
    }
  });

  it("persists transcribed_at through a narrow PATCH and replaces allocations transactionally", () => {
    expect(detail).toMatch(/markCmeEntryTranscribed\(/);
    expect(detail).toMatch(/clearCmeEntryTranscribed\(/);
    expect(detail).toMatch(/Object\.keys\(rawBody as object\)\.length === 1/);
    expect(detail).toMatch(/saveCmeEntry\(/);
    expect(repository).toMatch(/rpc\("cme_save_entry_v2"/);
  });
});

describe("CME entry PATCH schema (cmeEntryUpdateSchema)", () => {
  const completeBody = {
    formalPeerReviewHours: 0,
    date: "2026-03-01",
    title: "Grand round: catatonia",
    allocations: [{ category: "educational" as const, hours: 1.5 }],
    reflection: "Reviewed diagnostic criteria and bedside screening.",
    costCents: 0,
    routineId: null,
    documentId: null,
    buckets: [] as string[],
  };

  it("accepts a complete PATCH body", () => {
    const result = cmeEntryUpdateSchema.safeParse(completeBody);
    expect(result.success).toBe(true);
  });

  it("rejects a PATCH body that omits reflection instead of silently defaulting it to empty", () => {
    const withoutReflection: Record<string, unknown> = { ...completeBody };
    delete withoutReflection.reflection;
    const result = cmeEntryUpdateSchema.safeParse(withoutReflection);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.join(".") === "reflection")).toBe(true);
    }
  });

  it("rejects a PATCH body that omits any other defaulted field, not only reflection", () => {
    // This is exactly the bug Fix 1 closes: `cmeEntryCreateSchema` on its own would silently
    // default every one of these fields, discarding the owner's reflection text, recorded cost,
    // routine/document link, and buckets on a partial save. `cmeEntryUpdateSchema` must reject
    // instead.
    for (const field of ["costCents", "routineId", "documentId", "buckets"] as const) {
      const partial: Record<string, unknown> = { ...completeBody };
      delete partial[field];
      const result = cmeEntryUpdateSchema.safeParse(partial);
      expect(result.success, `omitting ${field} should be rejected`).toBe(false);
      if (!result.success) {
        expect(
          result.error.issues.some((issue) => issue.path.join(".") === field),
          `${field} should be the failing path`,
        ).toBe(true);
      }
    }
  });

  it("still rejects the same shape violations cmeEntryCreateSchema rejects", () => {
    expect(cmeEntryUpdateSchema.safeParse({ ...completeBody, title: "" }).success).toBe(false);
    expect(cmeEntryUpdateSchema.safeParse({ ...completeBody, date: "01-03-2026" }).success).toBe(false);
    expect(cmeEntryUpdateSchema.safeParse({ ...completeBody, allocations: [] }).success).toBe(false);
  });
});

describe("CME entry POST/PATCH shared schema (cmeEntryCreateSchema)", () => {
  const minimal = {
    date: "2026-01-15",
    title: "Journal club",
    allocations: [{ category: "reviewing" as const, hours: 1 }],
  };

  it("accepts a minimal create body and defaults every field a caller omitted", () => {
    const result = cmeEntryCreateSchema.safeParse(minimal);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.reflection).toBe("");
      expect(result.data.costCents).toBeNull();
      expect(result.data.routineId).toBeNull();
      expect(result.data.documentId).toBeNull();
      expect(result.data.buckets).toEqual([]);
    }
  });

  it("rejects a body missing a required field", () => {
    expect(cmeEntryCreateSchema.safeParse(without(minimal, "title")).success).toBe(false);
    expect(cmeEntryCreateSchema.safeParse(without(minimal, "date")).success).toBe(false);
  });

  it("rejects a date that is not a Perth calendar date", () => {
    expect(cmeEntryCreateSchema.safeParse({ ...minimal, date: "15/01/2026" }).success).toBe(false);
    expect(cmeEntryCreateSchema.safeParse({ ...minimal, date: "2026-1-15" }).success).toBe(false);
  });

  it("rejects zero and more-than-three category allocations", () => {
    expect(cmeEntryCreateSchema.safeParse({ ...minimal, allocations: [] }).success).toBe(false);
    expect(
      cmeEntryCreateSchema.safeParse({
        ...minimal,
        allocations: [
          { category: "educational", hours: 1 },
          { category: "reviewing", hours: 1 },
          { category: "measuring", hours: 1 },
          { category: "educational", hours: 1 },
        ],
      }).success,
    ).toBe(false);
  });

  it("rejects non-positive allocation hours and an unknown category", () => {
    expect(
      cmeEntryCreateSchema.safeParse({ ...minimal, allocations: [{ category: "reviewing", hours: 0 }] }).success,
    ).toBe(false);
    expect(
      cmeEntryCreateSchema.safeParse({ ...minimal, allocations: [{ category: "unknown", hours: 1 }] }).success,
    ).toBe(false);
  });

  it("rejects a negative cost and a non-UUID routine or document id", () => {
    expect(cmeEntryCreateSchema.safeParse({ ...minimal, costCents: -1 }).success).toBe(false);
    expect(cmeEntryCreateSchema.safeParse({ ...minimal, routineId: "not-a-uuid" }).success).toBe(false);
    expect(cmeEntryCreateSchema.safeParse({ ...minimal, documentId: "not-a-uuid" }).success).toBe(false);
  });

  it("rejects more than eight buckets and an empty bucket string", () => {
    expect(
      cmeEntryCreateSchema.safeParse({ ...minimal, buckets: Array.from({ length: 9 }, (_, i) => `bucket-${i}`) })
        .success,
    ).toBe(false);
    expect(cmeEntryCreateSchema.safeParse({ ...minimal, buckets: [""] }).success).toBe(false);
  });
});

describe("CME list query schema (cmeListQuerySchema, shared by GET on entries and year)", () => {
  it("accepts an absent year and a valid year coerced from a query string", () => {
    expect(cmeListQuerySchema.safeParse({}).success).toBe(true);
    const result = cmeListQuerySchema.safeParse({ year: "2026" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.year).toBe(2026);
  });

  it("rejects a year outside 2000-2100 and a non-numeric year", () => {
    expect(cmeListQuerySchema.safeParse({ year: "1999" }).success).toBe(false);
    expect(cmeListQuerySchema.safeParse({ year: "2101" }).success).toBe(false);
    expect(cmeListQuerySchema.safeParse({ year: "not-a-year" }).success).toBe(false);
  });
});

describe("CME complete year confirmation schema", () => {
  const validBody = {
    year: 2026,
    totalHours: 50,
    confirmedOn: "2026-01-01",
    confirmedSource: "Owner reviewed standard",
    requirements: [
      { id: "plan", label: "Development plan", source: "national", spec: { shape: "task" }, completedOn: null },
    ],
  };
  it("uses the shared complete confirmation schema in the year route", () => {
    expect(year).toContain("cmeYearConfirmSchema");
    expect(year).toContain("confirmCmeYear(supabase, user.id, body)");
  });
  it("accepts a complete confirmation body", () => {
    expect(cmeYearConfirmSchema.safeParse(validBody).success).toBe(true);
  });
  it("rejects invalid values and partial requirement confirmations", () => {
    for (const change of [
      { year: 1999 },
      { totalHours: 0 },
      { totalHours: 501 },
      { confirmedOn: "2026-02-30" },
      { confirmedSource: "" },
      { requirements: [] },
      { requirements: undefined },
    ])
      expect(cmeYearConfirmSchema.safeParse({ ...validBody, ...change }).success).toBe(false);
  });
});

describe("finishing a draft and replacing a missed session from the entry POST", () => {
  const minimal = {
    date: "2026-01-15",
    title: "Journal club",
    allocations: [{ category: "reviewing" as const, hours: 1 }],
  };
  const id = "7f3c1a52-3c0e-4b8a-9a55-2f6b0a1d9c11";

  it("accepts an optional draft and missed-session id, and only as uuids", () => {
    expect(cmeEntryCreateSchema.safeParse({ ...minimal, draftId: id, missedSessionId: id }).success).toBe(true);
    expect(cmeEntryCreateSchema.safeParse({ ...minimal, draftId: "not-a-uuid" }).success).toBe(false);
    expect(cmeEntryCreateSchema.safeParse({ ...minimal, missedSessionId: "not-a-uuid" }).success).toBe(false);
  });

  it("deletes the draft and links the missed session only after the entry is saved, owner-scoped", () => {
    const insertAt = list.indexOf("await insertCmeEntry(");
    expect(insertAt).toBeGreaterThan(-1);
    expect(list.indexOf("deleteOwnerCmeDraft(supabase, user.id, body.draftId)")).toBeGreaterThan(insertAt);
    expect(
      list.indexOf("setOwnerCmeMissedSessionReplacement(supabase, user.id, body.missedSessionId, created.id)"),
    ).toBeGreaterThan(insertAt);
    // A failed follow-up never undoes or fails the save.
    expect(list).toContain("Promise.allSettled(");
  });
});
