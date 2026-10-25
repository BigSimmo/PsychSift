// Regression pins for the curated interaction lexicon.
//
// The lexicon is hand-maintained, so the failure it invites is silent decay: an
// edit that narrows a selector, or a catalogue refresh that renames a subclass,
// quietly turns resolved rows into unresolved ones. Unresolved rows render grey
// rather than green, so decay is fail-safe — but it is still a loss of function
// nobody would notice without a pin.
//
// The counts below are therefore RATCHETS, not exact expectations: resolution
// may improve freely, and any regression has to be justified by editing this
// file deliberately.

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { INTERACTION_LEXICON, selectCatalogueSlugs, type LexiconTerm } from "@/lib/medication-interaction-lexicon";
import { loadMedicationSnapshot } from "@/lib/medication-snapshot";
import { missedClassMembers, substringTraps } from "../scripts/build-medication-lexicon-report";

type IndexRow = {
  rowKey: string;
  rowIndex: number;
  severity: string;
  counterparties: string[];
  termIds: string[];
  resolved: boolean;
  note: string;
};

const index = JSON.parse(
  readFileSync(path.resolve(process.cwd(), "data/medication-interaction-index.json"), "utf8"),
) as {
  sourceRowCount: number;
  stats: { resolvedRows: number; unresolvedRows: number; rowsWithCatalogueTarget: number };
  bySlug: Record<string, { rows: IndexRow[]; unresolvedRowCount: number }>;
};

const records = loadMedicationSnapshot();

function term(id: string): LexiconTerm {
  const found = INTERACTION_LEXICON.find((item) => item.id === id);
  if (!found) throw new Error(`Lexicon term "${id}" not found`);
  return found;
}

function slugsFor(id: string): string[] {
  const found = term(id);
  return found.select ? selectCatalogueSlugs(found.select, records) : [];
}

describe("interaction lexicon coverage", () => {
  it("does not regress the number of resolved rows", () => {
    // Ratchet, but read it carefully: `resolvedRows` moves for TWO reasons, and
    // only one of them is coverage.
    //
    // It fell from 400 to 355 when a row containing any unenumerated mechanism
    // term became unresolved even if it also matched a named drug. Previously
    // "CYP3A4 inhibitors (Clarithromycin, Ketoconazole)" resolved on
    // clarithromycin and counted as fully read, quietly implying the whole
    // mechanism class had been checked. Fewer resolved rows there means more
    // medications held at grey — a tightening, not a loss.
    //
    // So: a drop is only acceptable alongside a deliberate semantics change,
    // recorded here and in the PR. Track raw drug-matching separately, which
    // rose 381 → 417 over the same period and is the number that must never
    // fall without explanation.
    expect(index.stats.resolvedRows).toBeGreaterThanOrEqual(392);
    expect(index.stats.rowsWithCatalogueTarget).toBeGreaterThanOrEqual(440);
    expect(index.sourceRowCount).toBeGreaterThanOrEqual(525);
  });

  it("keeps every unresolved row visible rather than dropping it", () => {
    const rowTotal = Object.values(index.bySlug).reduce((total, entry) => total + entry.rows.length, 0);
    expect(index.stats.resolvedRows + index.stats.unresolvedRows).toBe(rowTotal);
    expect(rowTotal).toBe(index.sourceRowCount);
  });

  it("marks a row unresolved when its only counterparty is an unenumerable mechanism", () => {
    const mechanismIds = new Set(
      INTERACTION_LEXICON.filter((item) => item.kind === "mechanism").map((item) => item.id),
    );
    const mechanismOnly = Object.values(index.bySlug)
      .flatMap((entry) => entry.rows)
      .filter(
        (row) =>
          row.termIds.length > 0 && row.counterparties.length === 0 && row.termIds.every((id) => mechanismIds.has(id)),
      );
    expect(mechanismOnly.length).toBeGreaterThan(0);
    expect(mechanismOnly.every((row) => !row.resolved)).toBe(true);
  });

  it("addresses a real catalogue row from every rowIndex it emits", () => {
    // `note` is intentionally not duplicated into the index; the UI recovers the
    // verbatim text by indexing into the record. That only works if every
    // emitted rowIndex still addresses a real row, so pin it for all 523.
    for (const [slug, entry] of Object.entries(index.bySlug)) {
      const record = records.find((item) => item.slug === slug);
      const sourceRows = record?.sections.find((section) => section.type === "inter")?.rows ?? [];
      for (const row of entry.rows) {
        const source = sourceRows[row.rowIndex];
        expect(source, `${slug} row ${row.rowIndex} does not address a catalogue row`).toBeDefined();
        expect(source?.key).toBe(row.rowKey);
        expect((source?.val ?? "").trim().length).toBeGreaterThan(0);
      }
    }
  });
});

describe("lexicon deny-lists (the traps this module exists for)", () => {
  it("never resolves clozapine or olanzapine as a benzodiazepine", () => {
    // Their subclasses are "SGA / Dibenzodiazepine" and "SGA / Thienobenzodiazepine".
    const benzos = slugsFor("benzodiazepines");
    expect(benzos).toContain("diazepam");
    expect(benzos).not.toContain("clozapine");
    expect(benzos).not.toContain("olanzapine-wafer-odt");
    expect(benzos.every((slug) => !slug.startsWith("clozapine"))).toBe(true);
  });

  it("never resolves an opioid antagonist as an opioid", () => {
    const opioids = slugsFor("opioids");
    expect(opioids).toContain("methadone");
    expect(opioids).not.toContain("naltrexone");
    expect(opioids).not.toContain("naloxone");
  });

  it("never resolves a carbapenem antibiotic as an ARB", () => {
    // "ARB" is a substring of "C-arb-apenem". `subclassIncludes` is a substring
    // match, so it swept ertapenem and meropenem into the ARB class across 16
    // CRITICAL/HIGH rows until the review report surfaced it. The selector is
    // `subclassEquals` now; this pins the outcome by name.
    const arbs = slugsFor("arbs");
    expect(arbs).toContain("candesartan");
    expect(arbs).not.toContain("ertapenem");
    expect(arbs).not.toContain("meropenem");
    expect(arbs.every((slug) => records.find((item) => item.slug === slug)?.class !== "Antibiotic")).toBe(true);
  });

  it("never resolves atomoxetine as an SNRI", () => {
    // Atomoxetine is a selective noradrenaline reuptake inhibitor (NRI), not a
    // serotonergic drug. Its catalogue subclass read "SNRI (Non-stimulant)", so
    // `snris` put it in tramadol's CRITICAL serotonin-syndrome row. The label is
    // corrected in the snapshot (owner decision, 25 Oct 2026); this pins the outcome.
    expect(records.find((item) => item.slug === "atomoxetine")?.subclass).toBe("NRI (Non-stimulant)");
    const snris = slugsFor("snris");
    expect(snris).toContain("venlafaxine-xr");
    expect(snris).not.toContain("atomoxetine");
    const tramadolSerotonin = index.bySlug["tramadol-ir"]?.rows.find((row) => row.termIds.includes("snris"));
    expect(tramadolSerotonin?.counterparties).toContain("duloxetine");
    expect(tramadolSerotonin?.counterparties).not.toContain("atomoxetine");
  });

  it("keeps every subclass substring token a whole-word match", () => {
    // The systemic form of the ARB trap: a `subclassIncludes` token that only
    // appears inside a longer word is matching by accident. Legitimate uses —
    // "NSAID" inside "NSAID (COX-2 preferential)" — are whole words.
    const subclasses = Array.from(new Set(records.map((record) => record.subclass ?? "").filter(Boolean)));
    const accidental: string[] = [];
    for (const term of INTERACTION_LEXICON) {
      for (const token of term.select?.subclassIncludes ?? []) {
        const tokenWords = token
          .toLowerCase()
          .split(/[^a-z0-9]+/)
          .filter(Boolean);
        for (const subclass of subclasses) {
          if (!subclass.toLowerCase().includes(token.toLowerCase())) continue;
          const words = subclass
            .toLowerCase()
            .split(/[^a-z0-9]+/)
            .filter(Boolean);
          if (!tokenWords.every((part) => words.includes(part))) {
            accidental.push(`${term.id}: "${token}" inside "${subclass}"`);
          }
        }
      }
    }
    expect(accidental).toEqual([]);
  });

  it("surfaces a synthetic substring trap instead of reporting that check clean", () => {
    const traps = substringTraps(
      [
        {
          id: "synthetic-arb",
          kind: "catalogue",
          surfaces: ["ARBs"],
          select: { subclassIncludes: ["ARB"] },
        },
      ],
      [{ slug: "synthetic-carbapenem", name: "Synthetic carbapenem", subclass: "Carbapenem" }] as unknown as Parameters<
        typeof substringTraps
      >[1],
    );
    expect(traps).toHaveLength(1);
    expect(traps[0]).toContain("Carbapenem");
  });

  describe("missed class members (the direction that produces a MISSED alert)", () => {
    const synthetic = (records: Array<Record<string, string>>) =>
      records as unknown as Parameters<typeof missedClassMembers>[2];
    const term = (id: string, surfaces: string[]) => [{ id, kind: "catalogue" as const, surfaces, select: {} }];

    it("finds a three-letter class acronym instead of skipping the check", () => {
      // The `stem.length < 4` bail used to disable this check entirely for `tcas`
      // and `arbs`, so the sheet printed "checked, nothing found" for terms it had
      // never examined. That is how Dosulepin stayed invisible.
      const missed = missedClassMembers(
        term("tcas", ["tcas", "tca", "tricyclics"]),
        new Map([["tcas", ["amitriptyline"]]]),
        synthetic([{ slug: "dosulepin", name: "Dosulepin", class: "Antidepressant", subclass: "TCA", tag: "TCA" }]),
      );
      expect(missed).toHaveLength(1);
      expect(missed[0]).toContain("Dosulepin");
    });

    it("still refuses to reach a short acronym inside a longer word", () => {
      // The leading \b does this, not a tail anchor: `arb` must not find
      // `Carbapenem`, which is the trap substringTraps exists for.
      const missed = missedClassMembers(
        term("arbs", ["arbs", "arb"]),
        new Map([["arbs", ["candesartan"]]]),
        synthetic([{ slug: "meropenem", name: "Meropenem", class: "Antibiotic", subclass: "Carbapenem", tag: "" }]),
      );
      expect(missed).toEqual([]);
    });

    it("matches a pluralised subclass, so the acronym fix stays a prefix match", () => {
      // Pins the choice against anchoring the tail: `\btca\b` would miss a
      // subclass spelled "TCAs", and a missed member is the dangerous direction.
      const missed = missedClassMembers(
        term("tcas", ["tcas", "tca"]),
        new Map([["tcas", ["amitriptyline"]]]),
        synthetic([{ slug: "dosulepin", name: "Dosulepin", class: "Antidepressant", subclass: "TCAs", tag: "" }]),
      );
      expect(missed).toHaveLength(1);
      expect(missed[0]).toContain("Dosulepin");
    });

    it("reads the tag, not only class and subclass", () => {
      // Celecoxib is `COX-2 Inhibitor` by subclass but `NSAID` by tag, so the
      // catalogue does call it an NSAID — in the one field this check ignored.
      const missed = missedClassMembers(
        term("nsaids", ["nsaids", "nsaid"]),
        new Map([["nsaids", ["ibuprofen"]]]),
        synthetic([
          { slug: "celecoxib", name: "Celecoxib", class: "Analgesia", subclass: "COX-2 Inhibitor", tag: "NSAID" },
        ]),
      );
      expect(missed).toHaveLength(1);
      expect(missed[0]).toContain("Celecoxib");
    });

    it("does not report a drug the term already selects or deliberately denies", () => {
      const records = synthetic([
        { slug: "dosulepin", name: "Dosulepin", class: "Antidepressant", subclass: "TCA", tag: "TCA" },
      ]);
      expect(missedClassMembers(term("tcas", ["tcas"]), new Map([["tcas", ["dosulepin"]]]), records)).toEqual([]);
      expect(
        missedClassMembers(
          [{ id: "tcas", kind: "catalogue", surfaces: ["tcas"], select: { denySlugs: ["dosulepin"] } }],
          new Map(),
          records,
        ),
      ).toEqual([]);
    });
  });

  it("reaches lithium from the rows that name it", () => {
    // The catalogue record is "Lithium carbonate (IR/SR)", so the name-derived
    // surfaces never included the bare word every row actually uses. Lithium was
    // named in eight HIGH rows and reachable from none — the worst silence in a
    // psychiatry catalogue. Pinned by counterparty, not by resolved-row count,
    // because a count can be met by unrelated coverage elsewhere.
    const lithium = "lithium-carbonate-ir-sr";
    const reachedFrom = Object.entries(index.bySlug)
      .filter(([, entry]) => entry.rows.some((row) => row.counterparties.includes(lithium)))
      .map(([slug]) => slug);
    for (const slug of ["diclofenac", "meloxicam", "naproxen", "frusemide", "hydrochlorothiazide", "indapamide"]) {
      expect(reachedFrom, `${slug} should reach lithium`).toContain(slug);
    }
    expect(slugsFor("lithium")).toEqual([lithium]);
  });

  it("resolves every row that writes a drug's own name", () => {
    // The generalised lithium bug, and the one pin that would have caught it.
    //
    // Name-derived surfaces came from splitting the raw catalogue name, so a
    // parenthesised suffix swallowed the drug's own name: "Lithium carbonate
    // (IR/SR)" yielded "Lithium carbonate (IR" and "SR)". Nine rows across five
    // drugs named a counterparty in plain English and resolved none of it —
    // naloxone naming Buprenorphine, codeine and midazolam naming Morphine, the
    // carbapenems naming Sodium valproate, four rows naming Olanzapine.
    //
    // The invariant is deliberately about content that EXISTS: if a row writes a
    // catalogue drug's name, that row must resolve to that drug. It says nothing
    // about drugs the corpus never mentions — that is coverage, not a defect,
    // and is reported in the review sheet instead.
    const plainName = (name: string) => name.replace(/\s*\([^)]*\)\s*$/, "").trim();
    const names = (value: string, needle: string) =>
      new RegExp(`(^|[^A-Za-z0-9])${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9])`, "i").test(value);

    const rowsFor = (slug: string) =>
      records.find((item) => item.slug === slug)?.sections.find((section) => section.type === "inter")?.rows ?? [];

    const misses: string[] = [];
    for (const record of records) {
      const name = plainName(record.name);
      if (name.length < 4) continue;
      for (const [slug, entry] of Object.entries(index.bySlug)) {
        if (slug === record.slug) continue;
        const sourceRecord = records.find((item) => item.slug === slug);
        if (sourceRecord && plainName(sourceRecord.name) === name) continue;
        const sourceRows = rowsFor(slug);
        for (const row of entry.rows) {
          const text = sourceRows[row.rowIndex]?.val ?? "";
          if (!names(text, name)) continue;
          if (!row.counterparties.includes(record.slug)) {
            misses.push(`${slug} row ${row.rowIndex} writes "${name}" but does not resolve ${record.slug}`);
          }
        }
      }
    }
    expect(misses).toEqual([]);
  });

  it("reads a bare NONE row rather than reporting it unreadable", () => {
    // triamcinolone and riboflavin each carry one row whose entire text is
    // "NONE.". The severity parser wants a dash, so both parsed as `unknown`
    // and counted unresolved — the tool claiming it could not read a row that
    // says exactly one thing, and holding both drugs at "needs manual review"
    // over it. Safe direction, but still wrong.
    for (const slug of ["triamcinolone", "riboflavin"]) {
      const entry = index.bySlug[slug];
      expect(entry, slug).toBeDefined();
      expect(
        entry.rows.every((row) => row.resolved),
        `${slug} rows should resolve`,
      ).toBe(true);
      expect(
        entry.rows.some((row) => row.severity === "none"),
        `${slug} should carry severity none`,
      ).toBe(true);
      expect(entry.unresolvedRowCount, `${slug} should not be held at grey`).toBe(0);
    }
  });

  it("only lets a declaration of ABSENCE resolve without classifying anything", () => {
    // The guard on the rule above. Resolving a row that named no counterparty
    // and matched no term is only defensible when the row asserts there is
    // nothing to find. A bare "CRITICAL." names a severity without naming what
    // interacts — genuinely unreadable, and it must stay unresolved. This fails
    // if that carve-out is ever widened past absence.
    const bare = Object.entries(index.bySlug).flatMap(([slug, entry]) =>
      entry.rows
        .filter((row) => row.resolved && row.counterparties.length === 0 && row.termIds.length === 0)
        .map((row) => ({ slug, row })),
    );
    expect(bare.length).toBeGreaterThan(0);
    for (const { slug, row } of bare) {
      expect(["none", "safe"], `${slug} row ${row.rowIndex} resolved on severity "${row.severity}"`).toContain(
        row.severity,
      );
    }
  });

  it("has no lexicon term that can never fire", () => {
    // `z-drugs` was exactly this: a term whose phrasing appears nowhere in the
    // corpus, implying coverage the tool did not have. A dead term is not
    // dangerous on its own, but it makes the review sheet claim a class was
    // considered when nothing can ever match it.
    const fired = new Set(
      Object.values(index.bySlug)
        .flatMap((entry) => entry.rows)
        .flatMap((row) => row.termIds),
    );
    const dead = INTERACTION_LEXICON.filter((item) => !fired.has(item.id)).map((item) => item.id);
    expect(dead).toEqual([]);
  });

  it("keeps the duplicate Warfarin records reconciled with identical interaction rows", () => {
    // The catalogue holds two records named "Warfarin" (warfarin-vka and
    // warfarin-anticoagulant) representing the same drug. Both records carry
    // the identical, reconciled 4-row interaction union (CYP2C9 inhibitors,
    // CYP2C9 inducers, NSAIDs/Aspirin/SSRIs, and dietary Vitamin K) so opening
    // either record fires the complete verified interaction warnings.
    const duplicates = records.filter((record) => record.name === "Warfarin");
    expect(duplicates.map((record) => record.slug).sort()).toEqual(["warfarin-anticoagulant", "warfarin-vka"]);

    const rowSet = (slug: string) =>
      new Set(
        (
          records.find((record) => record.slug === slug)?.sections.find((section) => section.type === "inter")?.rows ??
          []
        ).map((row) => `${row.key}::${row.val}`),
      );
    const [a, b] = [rowSet("warfarin-vka"), rowSet("warfarin-anticoagulant")];
    expect(a.size).toBe(4);
    expect(b.size).toBe(4);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it("warfarin index entries do not include the other warfarin slug as a counterparty", () => {
    const interactionIndex = JSON.parse(
      readFileSync(path.join(__dirname, "../data/medication-interaction-index.json"), "utf-8"),
    ) as { bySlug: Record<string, { rows: Array<{ counterparties: string[] }> }> };
    const { bySlug } = interactionIndex;
    const warfarinSlugs = ["warfarin-vka", "warfarin-anticoagulant"] as const;
    // Both entries must exist — if either slug is renamed this test catches it.
    for (const slug of warfarinSlugs) {
      expect(bySlug[slug]).toBeDefined();
    }
    const warfarinPairs: [string, string][] = [
      ["warfarin-vka", "warfarin-anticoagulant"],
      ["warfarin-anticoagulant", "warfarin-vka"],
    ];
    for (const [slug, forbidden] of warfarinPairs) {
      const found = bySlug[slug]!.rows.some((row) => row.counterparties.includes(forbidden));
      expect(found).toBe(false);
    }
  });

  it("resolves beta blockers across both catalogue spellings", () => {
    const betaBlockers = slugsFor("beta-blockers");
    // "Beta Blocker" (metoprolol) and "Beta-Blocker" (propranolol).
    expect(betaBlockers).toContain("metoprolol");
    expect(betaBlockers).toContain("propranolol");
  });

  it("prefers the specific class over the generic one", () => {
    const thiazides = slugsFor("thiazide-diuretics");
    const loops = slugsFor("loop-diuretics");
    expect(thiazides.length).toBeGreaterThan(0);
    expect(loops.length).toBeGreaterThan(0);
    expect(thiazides.some((slug) => loops.includes(slug))).toBe(false);
  });
});

describe("non-drug and external terms", () => {
  const nonMatching = INTERACTION_LEXICON.filter(
    (item) => item.kind === "nonDrug" || item.kind === "external" || item.kind === "mechanism",
  );

  it("never resolves to a catalogue medication", () => {
    for (const item of nonMatching) {
      expect(item.select, `${item.id} must not carry a catalogue selector`).toBeUndefined();
    }
  });

  it("classifies alcohol, grapefruit and smoking as non-drug", () => {
    for (const id of ["alcohol", "grapefruit", "smoking", "acidic-drinks"]) {
      expect(term(id).kind).toBe("nonDrug");
    }
  });

  it("classifies bare CYP and P-gp classes as unenumerable mechanisms", () => {
    for (const id of ["cyp-inhibitors", "cyp-inducers", "pgp", "cns-depressants"]) {
      expect(term(id).kind).toBe("mechanism");
    }
  });

  it("produces no counterparties for a row whose only term is non-drug", () => {
    // Clozapine's CRITICAL smoking row.
    const smokingRows = (index.bySlug.clozapine?.rows ?? []).filter((row) => row.termIds.includes("smoking"));
    expect(smokingRows.length).toBeGreaterThan(0);
    expect(smokingRows.every((row) => row.counterparties.length === 0)).toBe(true);
  });

  it("resolves a non-drug-only row rather than leaving it for manual review", () => {
    // "Smoking" is fully understood — it just is not a medicine. That is a
    // different thing from "we could not read this row", and must not push the
    // medication into the grey needs-review state.
    const smokingRows = (index.bySlug.clozapine?.rows ?? []).filter((row) => row.termIds.includes("smoking"));
    expect(smokingRows.every((row) => row.resolved)).toBe(true);
  });
});

describe("lexicon hygiene", () => {
  it("has unique term ids", () => {
    const ids = INTERACTION_LEXICON.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has no duplicate surface across terms", () => {
    const surfaces = INTERACTION_LEXICON.flatMap((item) => item.surfaces.map((s) => s.toLowerCase()));
    expect(new Set(surfaces).size).toBe(surfaces.length);
  });

  it("gives every catalogue term a selector that actually matches something", () => {
    for (const item of INTERACTION_LEXICON.filter((entry) => entry.kind === "catalogue")) {
      expect(item.select, `${item.id} needs a selector`).toBeDefined();
      expect(slugsFor(item.id).length, `${item.id} resolved to nothing`).toBeGreaterThan(0);
    }
  });

  it("resolves every individual slug a selector names", () => {
    // The guard the `tcas` dead slug needed. The check above passes as long as a
    // term resolves to ANY drug, so `tcas` stayed green on five of its six slugs
    // while `dothiepin` — the pre-INN spelling of `dosulepin` — matched nothing,
    // and a TCA the catalogue marks FATAL in overdose fired none of that term's
    // 20 CRITICAL/HIGH rows. A slug that resolves to nothing is always a bug: it
    // is either a typo or a drug that left the catalogue.
    const known = new Set(records.map((record) => record.slug));
    for (const item of INTERACTION_LEXICON) {
      for (const slug of item.select?.slugs ?? []) {
        expect(known.has(slug), `${item.id} selects slug "${slug}", which is not in the catalogue`).toBe(true);
      }
      for (const slug of item.select?.denySlugs ?? []) {
        expect(known.has(slug), `${item.id} denies slug "${slug}", which is not in the catalogue`).toBe(true);
      }
      for (const slug of item.sourceDenySlugs ?? []) {
        expect(known.has(slug), `${item.id} source-denies slug "${slug}", which is not in the catalogue`).toBe(true);
        expect(
          item.sourceDenyRationales?.[slug]?.trim().length,
          `${item.id} source-denies slug "${slug}" without a clinical rationale`,
        ).toBeGreaterThan(0);
      }
      for (const slug of Object.keys(item.sourceDenyRationales ?? {})) {
        expect(
          (item.sourceDenySlugs ?? []).includes(slug),
          `${item.id} provides sourceDenyRationale for "${slug}" which is not in sourceDenySlugs`,
        ).toBe(true);
      }
    }
  });

  it("covers Dosulepin as a TCA", () => {
    // Regression pin for the dead slug. Dosulepin is dothiepin under its current
    // INN and the catalogue files it as subclass TCA, so the term must reach it.
    expect(slugsFor("tcas")).toContain("dosulepin");
  });

  it("covers Moclobemide under MAOI / RIMA lexicon term", () => {
    const maoiSlugs = slugsFor("maois");
    expect(maoiSlugs).toContain("moclobemide");
    expect(maoiSlugs).toContain("phenelzine");
    expect(maoiSlugs).toContain("tranylcypromine");
  });

  it("does not expand moclobemide's own name into a class-wide MAOI alert on its own rows", () => {
    // Moclobemide is a surface of the `maois` term. On moclobemide's own rows the
    // name refers to itself: "Cimetidine (doubles moclobemide levels)" must not
    // become a HIGH interaction with phenelzine and tranylcypromine.
    const cimetidineRow = index.bySlug.moclobemide?.rows.find((row) => /cimetidine/i.test(row.note));
    expect(cimetidineRow).toBeDefined();
    expect(cimetidineRow?.counterparties).not.toContain("phenelzine");
    expect(cimetidineRow?.counterparties).not.toContain("tranylcypromine");
    // Other drugs' MAOI warnings still reach moclobemide and the irreversible MAOIs.
    const reachesAllMaois = Object.entries(index.bySlug).some(
      ([slug, entry]) =>
        slug !== "moclobemide" &&
        entry.rows.some((row) =>
          ["moclobemide", "phenelzine", "tranylcypromine"].every((maoi) => row.counterparties.includes(maoi)),
        ),
    );
    expect(reachesAllMaois).toBe(true);
  });

  it("never lets a source medication appear as its own counterparty", () => {
    for (const [slug, entry] of Object.entries(index.bySlug)) {
      for (const row of entry.rows) {
        expect(
          row.counterparties.every((c) => c !== slug),
          `${slug} self-interacts`,
        ).toBe(true);
      }
    }
  });
});
