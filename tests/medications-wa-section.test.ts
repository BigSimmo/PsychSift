// The WA prescribing rules added to the Medications catalogue (task t6a): a new
// `wa` section type on the psychostimulant, S8-benzodiazepine, opioid-substitution
// and gabapentinoid records, plus two corrections (the pregabalin "now Schedule 8"
// claim and the alprazolam "S8 permit" pearl).
//
// Three things this guards against, each a real way this content could go wrong
// silently:
//
// 1. A `wa` row citing a source id nobody captured. Every row's `val` ends with
//    `(<title>; source: <id>)`, and every `<id>` must resolve to a real captured
//    source — either in the shared register (`src/data/source-acquisitions.json`)
//    or in this builder's own capture fragment
//    (`.superpowers/sdd/plan/sources-t6a.json`, read from the session's plan
//    directory, not the worktree — the plan directory is gitignored and does not
//    exist in CI, so the fragment lookup is best-effort and the register lookup
//    alone must hold once the fragment is merged in at integration).
// 2. A new section `type` that `tabSectionTypes` (medication-nav-header.tsx)
//    doesn't know about, which the task brief calls out by name: it "silently
//    won't render" because `medicationSectionsByTab` simply drops any section
//    whose type matches no tab's set.
// 3. The pregabalin record still claiming, anywhere, that pregabalin is Schedule 8
//    in WA — it is Schedule 4, and the "now Schedule 8" clause was never sourced.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  medicationSectionsByTab,
  medicationTabForSectionType,
} from "@/components/clinical-dashboard/medication-nav-header";
import { getMedicationRecord } from "@/lib/medication-snapshot";
import type { MedicationRecord, MedicationSectionRow } from "@/lib/medications";

const repoRoot = path.resolve(process.cwd());

/** WA Monitored Medicines Prescribing Code sections each Status row names; all were read in full (register note). */
const WA_CODE_SECTIONS: Record<string, string> = {
  dexamfetamine: "§3.4–3.5.4",
  lisdexamfetamine: "§3.4–3.5.4",
  methylphenidate: "§3.4–3.5.4",
  alprazolam: "Part 6 (§6.2, §6.5–6.5.2.1)",
  gabapentin: "Part 8 / §8.5",
  pregabalin: "Part 8 / §8.5",
  "buprenorphine-naloxone": "§7.4–7.4.3.1",
  "buprenorphine-sl-depot": "§7.4–7.4.3.1",
};

// The records this task adds a `wa` section to, plus how many rows each should
// carry (pinned so a future accidental row deletion/duplication is caught, not
// just "at least one row"). Each count includes the leading "Status" row
// (added 2026-09-25) that says the section is drafted and awaiting review.
const WA_SECTION_RECORDS: { slug: string; rowCount: number }[] = [
  { slug: "methylphenidate", rowCount: 10 },
  { slug: "dexamfetamine", rowCount: 10 },
  { slug: "lisdexamfetamine", rowCount: 10 },
  { slug: "alprazolam", rowCount: 4 },
  { slug: "methadone", rowCount: 6 },
  { slug: "buprenorphine-sl-depot", rowCount: 7 },
  { slug: "buprenorphine-naloxone", rowCount: 6 },
  { slug: "gabapentin", rowCount: 4 },
  { slug: "pregabalin", rowCount: 4 },
];

const STIMULANT_SLUGS = ["methylphenidate", "dexamfetamine", "lisdexamfetamine"] as const;
const OST_SLUGS = ["methadone", "buprenorphine-sl-depot", "buprenorphine-naloxone"] as const;

/** Round-1 fix regulatory doses per drug (Monitored Medicines Prescribing Code,
 * Dec 2024, Part 3 Figure 3 and its dose table — verified against the PDF's word
 * coordinates, not just its linearised text, because the table's columns
 * (Dexamfetamine / Methylphenidate / Lisdexamfetamine) print out of row order in
 * plain extraction). */
const STIMULANT_MAX_DOSE_MG: Record<(typeof STIMULANT_SLUGS)[number], number> = {
  dexamfetamine: 60,
  methylphenidate: 120,
  lisdexamfetamine: 70,
};

/** `(<title>; source: <id>)` — the citation convention every `wa` row's `val` ends
 * with. Chosen over a `tags` entry: `medicationRowBadges` (`src/lib/medication-badges.ts`)
 * renders every tag as a literal, visible badge pill (`TAG_TONES[tag] ?? "info"` —
 * there is no filter for an unrecognised tag), and each row's badge cluster is
 * capped at 3–4 slots. A `source:<id>` tag would show a raw id string as a chip
 * and would crowd out a real clinical badge (PBS/TGA/OFF, a patient-context flag)
 * on every one of these rows. Citing the source in `val` — where a title already
 * has to appear per the task brief — costs no extra visible surface. */
const CITATION_PATTERN = /\(([^;()]+); source: ([a-z0-9-]+)\)$/;

function loadSourceAcquisitionIds(): Set<string> {
  const raw = readFileSync(path.join(repoRoot, "src/data/source-acquisitions.json"), "utf8");
  const records = JSON.parse(raw) as { id: string }[];
  return new Set(records.map((record) => record.id));
}

/** Best-effort: the plan directory is gitignored (`.superpowers/sdd/.gitignore`
 * excludes everything under `sdd/plan/`) and exists only on a builder's own
 * machine during this multi-agent sprint, never in CI or on a fresh checkout.
 * Once the integrator appends every `sources-*.json` fragment into
 * `src/data/source-acquisitions.json`, the register lookup alone covers these
 * ids and this glob simply finds nothing. */
function loadPlanFragmentIds(): Set<string> {
  const planDir = path.resolve(repoRoot, "..", "..", "..", ".superpowers", "sdd", "plan");
  const ids = new Set<string>();
  if (!existsSync(planDir)) return ids;
  for (const entry of readdirSync(planDir)) {
    if (!/^sources-.*\.json$/.test(entry)) continue;
    try {
      const records = JSON.parse(readFileSync(path.join(planDir, entry), "utf8")) as { id: string }[];
      for (const record of records) ids.add(record.id);
    } catch {
      // A fragment mid-write by another builder, or not valid JSON yet — not
      // this test's concern; the register lookup is the one that must hold.
    }
  }
  return ids;
}

const knownSourceIds = new Set([...loadSourceAcquisitionIds(), ...loadPlanFragmentIds()]);

function waSectionOf(record: MedicationRecord) {
  const sections = record.sections.filter((section) => section.type === "wa");
  expect(sections, `${record.slug} should have exactly one 'wa' section`).toHaveLength(1);
  return sections[0]!;
}

/** The rows that carry content, after the leading "Status" row. */
function contentRowsOf(record: MedicationRecord) {
  return waSectionOf(record).rows.slice(1);
}

function citationOf(row: MedicationSectionRow) {
  const match = CITATION_PATTERN.exec(row.val);
  expect(
    match,
    `row ${JSON.stringify(row.key)} val should end with "(<title>; source: <id>)", got: ${row.val}`,
  ).not.toBeNull();
  return { title: match![1]!, sourceId: match![2]! };
}

describe("WA prescribing rules — medications catalogue (task t6a)", () => {
  it("clozapine's 'wa' section is owned by the wa-clozapine branch, not this one", () => {
    // Pre-integration, this branch (wa-prescribing) left clozapine untouched. Post-integration,
    // wa-clozapine has merged and added its own 'wa' section to the same record (a disjoint edit
    // to the same file, per the integration plan's hotspot note) — so clozapine now does carry a
    // 'wa' section, just not one this branch wrote. Coverage of its content lives in
    // tests/medications-clozapine-reference.test.ts.
    const clozapine = getMedicationRecord("clozapine");
    expect(clozapine).toBeDefined();
    expect(clozapine!.sections.some((section) => section.type === "wa")).toBe(true);
  });

  it("'wa' is registered in tabSectionTypes, in the safety tab group", () => {
    expect(medicationTabForSectionType("wa")).toBe("safety");
  });

  for (const { slug, rowCount } of WA_SECTION_RECORDS) {
    describe(slug, () => {
      const record = getMedicationRecord(slug);

      it("exists in the snapshot", () => {
        expect(record).toBeDefined();
      });

      it(`carries a 'wa' section with ${rowCount} row(s)`, () => {
        const section = waSectionOf(record!);
        expect(section.title).toBe("WA prescribing");
        expect(section.rows).toHaveLength(rowCount);
      });

      it("groups the 'wa' section into the safety tab, so it actually renders", () => {
        const byTab = medicationSectionsByTab(record!);
        expect(byTab.safety.some((section) => section.type === "wa")).toBe(true);
        // Not silently dropped into a tab nobody looks at, and not duplicated
        // into more than one tab.
        expect(byTab.summary.some((section) => section.type === "wa")).toBe(false);
        expect(byTab.dosing.some((section) => section.type === "wa")).toBe(false);
        expect(byTab.more.some((section) => section.type === "wa")).toBe(false);
      });

      it("opens with a 'Status' row saying it is drafted from the sources its rows cite and awaiting clinical review", () => {
        const [status, ...rows] = waSectionOf(record!).rows;
        expect(status!.key).toBe("Status");
        expect(status!.tags).toEqual([]);
        const titles = [...new Set(rows.map((row) => citationOf(row).title))];
        const joined = titles.length === 1 ? titles[0] : `${titles.slice(0, -1).join(", ")} and ${titles.at(-1)}`;
        // The Code may name the edition and the sections read (owner-approved 26 Oct 2026),
        // e.g. "Monitored Medicines Prescribing Code (Dec 2024) §3.4–3.5.4".
        const located = joined.replace(
          "Monitored Medicines Prescribing Code",
          `Monitored Medicines Prescribing Code${WA_CODE_SECTIONS[slug] ? ` (Dec 2024) ${WA_CODE_SECTIONS[slug]}` : ""}`,
        );
        expect(status!.val).toBe(`Drafted from ${located}; awaiting clinical review.`);
      });

      it("every 'wa' row cites a source id that was actually captured", () => {
        for (const row of contentRowsOf(record!)) {
          const { sourceId } = citationOf(row);
          expect(
            knownSourceIds.has(sourceId),
            `unrecorded source id ${JSON.stringify(sourceId)} cited by ${slug} / ${JSON.stringify(row.key)}`,
          ).toBe(true);
        }
      });

      it("every 'wa' row has non-empty key, val and tags", () => {
        const section = waSectionOf(record!);
        for (const row of section.rows) {
          expect(row.key.trim().length).toBeGreaterThan(0);
          expect(row.val.trim().length).toBeGreaterThan(0);
          expect(row.tags).toEqual([]);
        }
      });
    });
  }

  describe("round-1 fix: stimulant 'Approved Prescribers' names Table 3's specialty-to-diagnosis pairs (item 2)", () => {
    for (const slug of STIMULANT_SLUGS) {
      it(`${slug} states the specialty-specific diagnosis restrictions, not a blanket ADHD claim`, () => {
        const section = waSectionOf(getMedicationRecord(slug)!);
        const row = section.rows.find((r) => r.key === "Approved Prescribers")!;
        expect(row).toBeDefined();
        // Respiratory/sleep medicine and rehabilitation medicine are each
        // approved for exactly one diagnosis under Table 3 — the wording this
        // fix exists to correct implied any Approved Specialty covered ADHD.
        expect(row.val).toContain("Respiratory and Sleep Medicine for Narcolepsy only");
        expect(row.val).toContain(
          "Rehabilitation Medicine or Paediatric Rehabilitation Medicine for Acquired Brain Injury only",
        );
        expect(row.val).toContain("Psychiatry");
        expect(row.val).toContain("Neurology");
      });
    }
  });

  describe("round-1 fix: stimulant 'Shared Care Limits' quotes the GP/nurse-practitioner restriction (item 2)", () => {
    for (const slug of STIMULANT_SLUGS) {
      it(`${slug} states all four things a non-Approved-Specialist prescriber may not do`, () => {
        const section = waSectionOf(getMedicationRecord(slug)!);
        const row = section.rows.find((r) => r.key === "Shared Care Limits")!;
        expect(row).toBeDefined();
        expect(row.val).toContain("initiate an S8 stimulant medicine");
        expect(row.val).toContain("alter an S8 stimulant dose without the Approved Specialist's written authority");
        expect(row.val).toContain("an authority displayed on ScriptCheckWA");
        expect(row.val).toContain("alter the S8 stimulant type or formulation");
      });
    }
  });

  describe("round-1 fix: ScriptCheckWA rows carry the s1.2.3 new/unknown-patient rule (item 3)", () => {
    const cases: { slug: string; rowKey: string }[] = [
      { slug: "alprazolam", rowKey: "ScriptCheckWA" },
      { slug: "gabapentin", rowKey: "ScriptCheckWA Registration" },
      { slug: "pregabalin", rowKey: "ScriptCheckWA Registration" },
      { slug: "methylphenidate", rowKey: "ScriptCheckWA" },
      { slug: "dexamfetamine", rowKey: "ScriptCheckWA" },
      { slug: "lisdexamfetamine", rowKey: "ScriptCheckWA" },
    ];
    for (const { slug, rowKey } of cases) {
      it(`${slug} '${rowKey}' row requires a check for a new or unknown patient, and cites the Code for it`, () => {
        const section = waSectionOf(getMedicationRecord(slug)!);
        const row = section.rows.find((r) => r.key === rowKey)!;
        expect(row).toBeDefined();
        expect(row.val).toContain("new or unknown patient");
        expect(row.val).toContain("strongly recommended");
        const { sourceId } = citationOf(row);
        expect(sourceId).toBe("wa-monitored-medicines-prescribing-code");
      });
    }
  });

  describe("round-1 fix: opioid-substitution 'Continuing Treatment in Hospital' matches s7.4.1.6 (item 4)", () => {
    for (const slug of OST_SLUGS) {
      it(`${slug} names a medical practitioner, a current CPOP participant and a valid authorisation on admission`, () => {
        const section = waSectionOf(getMedicationRecord(slug)!);
        const row = section.rows.find((r) => r.key === "Continuing Treatment in Hospital")!;
        expect(row).toBeDefined();
        expect(row.val).toContain("A medical practitioner who is not an authorised CPOP prescriber");
        expect(row.val).toContain("current CPOP participant");
        expect(row.val).toContain("valid authorisation on admission");
      });
    }
  });

  describe("round-1 fix: stimulant patient exclusions, dose caps and review frequency (item 6)", () => {
    for (const slug of STIMULANT_SLUGS) {
      it(`${slug} 'Patient Exclusions' names every comorbidity/history exclusion in 3.5.2.iii`, () => {
        const section = waSectionOf(getMedicationRecord(slug)!);
        const row = section.rows.find((r) => r.key === "Patient Exclusions")!;
        expect(row).toBeDefined();
        expect(row.val).toContain("stimulant-induced psychosis");
        expect(row.val).toContain("psychosis or bipolar disorder");
        expect(row.val).toContain("previous 5 years");
        expect(row.val).toContain("Drug Dependence or Oversupply");
        expect(row.val).toContain("CPOP participant");
      });

      it(`${slug} 'Maximum Doses' states the verified regulatory dose cap (${STIMULANT_MAX_DOSE_MG[slug]} mg/day)`, () => {
        const section = waSectionOf(getMedicationRecord(slug)!);
        const row = section.rows.find((r) => r.key === "Maximum Doses")!;
        expect(row).toBeDefined();
        expect(row.val).toContain(`${STIMULANT_MAX_DOSE_MG[slug]} mg/day`);
        // Every one of the three stimulants shares the same combined-therapy
        // dexamfetamine-equivalent ceiling under Figure 3: 60 mg/day for an
        // adult, 1 mg/kg/day for a patient under 18.
        expect(row.val).toContain("1 mg/kg/day");
      });

      it(`${slug} 'Specialist Review Frequency' states the annual/3-year split`, () => {
        const section = waSectionOf(getMedicationRecord(slug)!);
        const row = section.rows.find((r) => r.key === "Specialist Review Frequency")!;
        expect(row).toBeDefined();
        expect(row.val).toContain("annual");
        expect(row.val).toContain("3 years");
      });
    }
  });

  describe("round-1 fix: alprazolam legacy lines (item 8)", () => {
    const record = getMedicationRecord("alprazolam")!;

    it("no longer claims ward prescribing is 'extremely restricted' (Part 6 excludes inpatient administration)", () => {
      expect(JSON.stringify(record)).not.toContain("Prescribing on the ward is extremely restricted");
    });

    it("no longer carries the unsourced 'Private script only in most states' line (owner ruling 2026-09-25: delete)", () => {
      const form = record.sections.find((section) => section.type === "form")!;
      const row = form.rows.find((r) => r.key === "Prescribing & PBS")!;
      expect(row.val).toBe("Highly Restricted (S8).");
      expect(JSON.stringify(record)).not.toContain("Private script only in most states");
    });
  });

  describe("pregabalin correction", () => {
    const record = getMedicationRecord("pregabalin")!;

    it("no longer claims Schedule 8 anywhere in the record", () => {
      expect(JSON.stringify(record)).not.toContain("Schedule 8");
    });

    it("keeps the 'Bottom Line' summary row grammatical", () => {
      const summary = record.sections.find((section) => section.type === "summary")!;
      const bottomLine = summary.rows.find((row) => row.key === "Bottom Line")!;
      expect(bottomLine.val).toBe(
        "Pregabalin is effective for neuropathic pain, generalised anxiety, and fibromyalgia, but causes significant dizziness and weight gain.",
      );
    });

    it("keeps the quick 'Best Uses' row in sync with the summary row", () => {
      const bestUses = record.quick.find((row) => row.label === "Best Uses")!;
      const summary = record.sections.find((section) => section.type === "summary")!;
      const bottomLine = summary.rows.find((row) => row.key === "Bottom Line")!;
      expect(bestUses.value).toBe(bottomLine.val);
    });

    it("schedule field is still S4", () => {
      expect(record.schedule).toBe("S4");
    });
  });

  describe("alprazolam pearl correction", () => {
    const record = getMedicationRecord("alprazolam")!;

    it("no longer makes the unsourced 'S8 permit' discharge claim", () => {
      const serialized = JSON.stringify(record);
      expect(serialized).not.toContain("S8 permit");
      expect(serialized).not.toContain("without an S8 permit");
    });

    it("the 'The S8 Status' pearl row cites a captured source", () => {
      const pearl = record.sections.find((section) => section.type === "pearl")!;
      const row = pearl.rows.find((r) => r.key === "The S8 Status")!;
      const { sourceId } = citationOf(row);
      expect(knownSourceIds.has(sourceId)).toBe(true);
    });
  });
});
