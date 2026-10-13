import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import sourceAcquisitions from "@/data/source-acquisitions.json";
import { getMedicationRecord } from "@/lib/medication-snapshot";
import type { MedicationSection, MedicationSectionRow } from "@/lib/medications";

/**
 * Proves the clozapine "wa" quoted reference block (task 6b): the section
 * exists, every row cites a `source:` tag, every cited id is a registered
 * source (either in this task's pre-integration fragment,
 * `.superpowers/sdd/plan/sources-t6b.json`, or already merged into the real
 * ledger at `src/data/source-acquisitions.json` — this test works in both
 * states so it survives the integrator's merge), and none of them cite the
 * rejected Rockingham Peel Group (RKPG) clozapine guideline (outstanding
 * issue #7VQ5RC — the document mislabels ANC thresholds as WBC).
 */

const TEST_FILE_DIR = path.dirname(fileURLToPath(import.meta.url));

/**
 * The builders' `sources-<task>.json` fragments are per-session scratch
 * files under `.superpowers/sdd/plan/`, which is not part of the git
 * history (see `.superpowers/sdd/plan/merge-sources.mjs`'s own header). A
 * worktree checkout nests a few directories below the location that holds
 * it, so this walks up from the test file looking for it rather than
 * assuming a fixed depth.
 */
function findSourcesFragment(): string | null {
  let dir = TEST_FILE_DIR;
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, ".superpowers", "sdd", "plan", "sources-t6b.json");
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

type AcquisitionFragmentRecord = {
  id: string;
  disposition: "adopted" | "candidate" | "rejected";
};

function loadFragmentEntries(): AcquisitionFragmentRecord[] {
  const fragmentPath = findSourcesFragment();
  if (!fragmentPath) return [];
  const raw = readFileSync(fragmentPath, "utf8");
  return JSON.parse(raw) as AcquisitionFragmentRecord[];
}

function extractSourceIds(row: MedicationSectionRow): string[] {
  return (row.tags ?? []).filter((tag) => tag.startsWith("source:")).map((tag) => tag.slice("source:".length));
}

function findWaSection(): MedicationSection {
  const record = getMedicationRecord("clozapine");
  expect(record, "clozapine record must exist in the medications snapshot").toBeTruthy();
  const section = record!.sections.find((candidate) => candidate.type === "wa");
  expect(section, "clozapine record must carry a 'wa' section").toBeTruthy();
  return section!;
}

describe("clozapine 'wa' quoted reference block (task 6b)", () => {
  it("adds exactly one 'wa' section titled 'Clozapine reference (quoted)'", () => {
    const record = getMedicationRecord("clozapine");
    expect(record).toBeTruthy();
    const waSections = record!.sections.filter((section) => section.type === "wa");
    expect(waSections).toHaveLength(1);
    expect(waSections[0]?.title).toBe("Clozapine reference (quoted)");
  });

  it("does not add a 'wa' section to another medication record", () => {
    // The clozapine record is this builder's only owned record; a light
    // sanity check that no neighbouring record picked one up by accident
    // (full snapshot count is pinned separately in tests/medications.test.ts).
    const record = getMedicationRecord("olanzapine-wafer-odt");
    expect(record).toBeTruthy();
    expect(record!.sections.some((section) => section.type === "wa")).toBe(false);
  });

  it("gives every row in the section a non-empty key and val", () => {
    const section = findWaSection();
    expect(section.rows.length).toBeGreaterThan(0);
    for (const row of section.rows) {
      expect(row.key.trim().length).toBeGreaterThan(0);
      expect(row.val.trim().length).toBeGreaterThan(0);
    }
  });

  it("cites a source id on every row, and every cited id is a registered source", () => {
    const section = findWaSection();
    const fragmentEntries = loadFragmentEntries();
    const registeredIds = new Set<string>([
      ...fragmentEntries.map((entry) => entry.id),
      ...(sourceAcquisitions as { id: string }[]).map((entry) => entry.id),
    ]);
    // At least one of the two sources (fragment or real ledger) must know
    // about ids at all, otherwise this assertion would pass vacuously.
    expect(
      registeredIds.size,
      "neither the sources-t6b.json fragment nor the real ledger could be loaded",
    ).toBeGreaterThan(0);

    for (const row of section.rows) {
      const sourceIds = extractSourceIds(row);
      expect(sourceIds.length, `row "${row.key}" must cite at least one source: tag`).toBeGreaterThan(0);
      for (const id of sourceIds) {
        expect(registeredIds.has(id), `row "${row.key}" cites unregistered source id "${id}"`).toBe(true);
      }
    }
  });

  it("cites only the accepted WA guideline, never the rejected RKPG source", () => {
    const section = findWaSection();
    const fragmentEntries = loadFragmentEntries();
    const rejectedIds = new Set(
      fragmentEntries.filter((entry) => entry.disposition === "rejected").map((entry) => entry.id),
    );

    for (const row of section.rows) {
      for (const id of extractSourceIds(row)) {
        expect(rejectedIds.has(id), `row "${row.key}" must not cite rejected source "${id}"`).toBe(false);
        expect(id, `row "${row.key}" must not cite the RKPG id by name`).not.toMatch(/rkpg/i);
      }
      // Belt and braces: no row's text may reference RKPG / Rockingham Peel by name either.
      expect(row.val, `row "${row.key}" text must not mention RKPG / Rockingham Peel`).not.toMatch(
        /RKPG|Rockingham Peel/i,
      );
    }
  });

  it("records the RKPG clozapine guideline as rejected somewhere in the source registers", () => {
    const fragmentEntries = loadFragmentEntries();
    const fromFragment = fragmentEntries.find(
      (entry) => entry.id === "rkpg-clozapine-policy-rejected-anc-wbc-mislabel",
    );
    const fromLedger = (sourceAcquisitions as { id: string; disposition: string }[]).find((entry) =>
      /rkpg/i.test(entry.id),
    );
    const recorded = fromFragment ?? fromLedger;
    expect(recorded, "RKPG rejection must be recorded in either sources-t6b.json or the real ledger").toBeTruthy();
    expect(recorded!.disposition).toBe("rejected");
  });

  it("covers all three requested sub-parts: titration, restart-after-missed-doses, and myocarditis monitoring", () => {
    const section = findWaSection();
    const keys = section.rows.map((row) => row.key);

    expect(keys.some((key) => /titration/i.test(key))).toBe(true);
    expect(keys.some((key) => /interruption:/i.test(key))).toBe(true);
    expect(keys.some((key) => /myocarditis/i.test(key))).toBe(true);
  });

  it("keeps every row's quote traceable to a bracketed source title", () => {
    const section = findWaSection();
    // The leading "Status" row is a review-state notice, not a quote; the test above pins it.
    for (const row of section.rows.slice(1)) {
      expect(row.val, `row "${row.key}" must end with a bracketed source title`).toMatch(/\[[^[\]]+\]\s*$/);
    }
  });

  it("pins all 28 Appendix 5 titration days in order, plus the ongoing row", () => {
    const section = findWaSection();
    const dayKeys = section.rows.map((row) => row.key).filter((key) => /^Community titration Day \d+$/.test(key));
    const expectedDayKeys = Array.from({ length: 28 }, (_, i) => `Community titration Day ${i + 1}`);
    expect(dayKeys).toEqual(expectedDayKeys);

    const ongoingRow = section.rows.find((row) => row.key === "Community titration Ongoing");
    expect(ongoingRow, "the 'Ongoing: As clinically indicated' row must be present").toBeTruthy();
    expect(ongoingRow!.val).toMatch(/As clinically indicated/i);
  });

  it("gives Day 10 and Day 24 (the two rows a previous pass omitted) their exact Appendix 5 doses", () => {
    const section = findWaSection();
    const byKey = new Map(section.rows.map((row) => [row.key, row.val]));

    const day10 = byKey.get("Community titration Day 10");
    expect(day10, "Community titration Day 10 row must exist").toBeTruthy();
    expect(day10).toMatch(/AM dose 25 mg, PM dose 25 mg\. Monitoring: A\./);

    const day24 = byKey.get("Community titration Day 24");
    expect(day24, "Community titration Day 24 row must exist").toBeTruthy();
    expect(day24).toMatch(/AM dose 75 mg, PM dose 75 mg\. Monitoring: A\./);
  });

  it("carries the Day 5 and Day 12 out-of-hours reminder notes verbatim", () => {
    const section = findWaSection();
    const byKey = new Map(section.rows.map((row) => [row.key, row.val]));
    expect(byKey.get("Community titration Day 5")).toMatch(
      /Check results from day 4\. Remind patient of out of hours arrangements and weekend\./,
    );
    expect(byKey.get("Community titration Day 12")).toMatch(
      /Check results from day 1\. Remind patient of out of hours arrangements and weekend\./,
    );
  });

  it("labels every Appendix 4 community-protocol row as such, distinct from the s5.3 rows", () => {
    const section = findWaSection();
    const appendix4Keys = section.rows.map((row) => row.key).filter((key) => key.startsWith("Community protocol"));
    expect(appendix4Keys.length).toBeGreaterThanOrEqual(4);
    for (const key of appendix4Keys) {
      expect(key).toMatch(/^Community protocol \(Appendix 4\):/);
    }

    // The two rows drawn from the main s5.3 text (not Appendix 4) keep their own naming.
    const s53Row = section.rows.find((row) => row.key === "Myocarditis monitoring - Days 7, 14, 21, 28");
    expect(s53Row).toBeTruthy();
    expect(s53Row!.key).not.toMatch(/Appendix 4/);
  });

  it("quotes the s5.1 chart-purpose sentence, the s5.2 community-vs-inpatient sentence, and the s5.3 inpatient vital-signs paragraph verbatim", () => {
    const section = findWaSection();
    const byKey = new Map(section.rows.map((row) => [row.key, row.val]));

    // The row must also name the chart via the preceding sentence, not just describe it.
    expect(byKey.get("Chart purpose (s5.1)")).toMatch(
      /The WA Clozapine Initiation and Titration Chart \(Appendix 1\.1\) facilitates clinical handover and prescription for the safe management of patients initiated or re-titrated on clozapine\. Decision support regarding titration is provided on the chart\./,
    );
    expect(byKey.get("Chart purpose (s5.1)")).toMatch(
      /intended to be used as a record of the prescribing, monitoring, and administration of clozapine titration for all patients in inpatient settings/,
    );
    expect(byKey.get("Community vs inpatient titration (s5.2)")).toMatch(
      /For inpatient settings, the WA Clozapine Initiation and Titration Chart outlines a suggested titration schedule, but slower titrations may be utilised\. Patients commenced in the community must follow a slower titration due to reduced monitoring\./,
    );
    expect(byKey.get("Inpatient vital signs (s5.3)")).toMatch(
      /hourly for six hours, and then 6-hourly for the first 24 hours.*at least twice daily for the first week/,
    );
  });

  it("quotes the s5.3 community vital-signs paragraph verbatim, as its own row, without reconciling it against Appendix 4/5 frequencies", () => {
    const section = findWaSection();
    const row = section.rows.find((row) => row.key === "Community vital signs (s5.3)");
    expect(row, "a 'Community vital signs (s5.3)' row must exist").toBeTruthy();
    expect(row!.val).toMatch(
      /Patients initiated on clozapine in the community should be monitored for the first 3 hours, then daily during clinic business hours when patients are reviewed for the first two weeks then twice weekly for the third week, then weekly from week 4 at weekly reviews and at each monthly review once the initial 18 weeks is finished \(increase monitoring if required\)\./,
    );

    // It must sit alongside, not merged into, the inpatient s5.3 paragraph or the Appendix 4/5 rows.
    const inpatientRow = section.rows.find((r) => r.key === "Inpatient vital signs (s5.3)");
    expect(inpatientRow).toBeTruthy();
    expect(inpatientRow!.val).not.toContain("first 3 hours");
    expect(row!.val).not.toMatch(/hourly for six hours/);
  });

  it("opens with a 'Status' row saying the block is drafted from the WA guideline and awaiting clinical review", () => {
    const [status] = findWaSection().rows;
    expect(status?.key).toBe("Status");
    expect(status?.val).toBe(
      "Drafted from Guidelines for the Safe and Quality Use of Clozapine Therapy in the WA health system (WA Department of Health, Version 2, June 2024); awaiting clinical review.",
    );
    expect(status?.tags).toEqual(["source:wa-health-clozapine-guideline-2024"]);
  });

  it("states up front that the block is quoted from the named WA guideline", () => {
    const section = findWaSection();
    const first = section.rows.find((row) => row.key === "Source statement");
    expect(first, "the section must carry a 'Source statement' row").toBeTruthy();
    // Straight after the Status row.
    expect(section.rows.indexOf(first!)).toBe(1);
    expect(first!.val).toMatch(
      /Guidelines for the Safe and Quality Use of Clozapine Therapy in the WA health system \(WA Department of Health, Version 2, June 2024\)/,
    );
  });

  it("includes the 'Commencement should take place early in the week' sentence in the titration principle row", () => {
    const section = findWaSection();
    const row = section.rows.find((row) => row.key === "Titration principle");
    expect(row).toBeTruthy();
    expect(row!.val).toMatch(
      /Commencement should take place early in the week to allow for adequate staffing and monitoring\./,
    );
  });

  it("adds a Table 3 pointer row covering all four interruption bands, matching the source's capitalisation", () => {
    const section = findWaSection();
    const row = section.rows.find((row) => row.key === "Blood monitoring after interruption (Table 3)");
    expect(row).toBeTruthy();
    const val = row!.val;

    // Band 1: <=48 hours.
    expect(val).toMatch(/Less than or equal to 48 hours: No change to monitoring frequency\./);
    // Band 2: >48 and <=72 hours (previously missing).
    expect(val).toMatch(
      /Greater than 48 hours and less than or equal to 72 hours: No change to monitoring frequency\./,
    );
    // Band 3: >72 hours and <=28 days — source capitalises "The six-week rule" as the start of the cell.
    expect(val).toMatch(/Greater than 72 hours and less than or equal to 28 days: The six-week rule applies\./);
    // Band 4: >28 days.
    expect(val).toMatch(
      /Greater than 28 days: Weekly monitoring for 18 weeks\. The patient must be re-registered with the monitoring service if the period of cessation is 3 months or greater\./,
    );
  });
});

describe("clozapine missed-dose rule", () => {
  it("shows the same missed-dose wording in the dosing section and the quick reference", () => {
    const record = getMedicationRecord("clozapine");
    expect(record).toBeTruthy();
    const row = record!.sections
      .flatMap((section) => section.rows ?? [])
      .find((candidate) => candidate.key === "Missed Dose Rule");
    expect(row?.val).toMatch(/^If more than 48 hours since the last dose/);
    const quick = record!.quick?.find((item) => item.label === "Key Indication Doses");
    expect(quick?.value).toContain(`Missed Dose Rule: ${row!.val}`);
    expect(quick?.value).not.toMatch(/CANNOT restart|exactly 48/i);
  });
});
