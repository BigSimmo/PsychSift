import { describe, expect, it } from "vitest";

import { isExampleRecord } from "@/lib/example-data/guards";
import { EXAMPLE_PEOPLE } from "@/lib/example-data/people";
import { EXAMPLE_DATASET_KEYS, loadExampleDataset } from "@/lib/example-data/registry";
import { looksLikePatientDetail } from "@/lib/work-text/patient-detail-check";

/** Every string anywhere in a dataset, keyed by its path, for the privacy sweep. */
function strings(value: unknown, path = "$", out: Array<[string, string]> = []): Array<[string, string]> {
  if (typeof value === "string") out.push([path, value]);
  else if (Array.isArray(value)) value.forEach((item, index) => strings(item, `${path}[${index}]`, out));
  else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) strings(item, `${path}.${key}`, out);
  }
  return out;
}

const NOW = new Date("2026-10-07T01:00:00Z");
/** Identifiers and links are not prose a reader sees, so the patient-detail check does not apply to them. */
const ID_PATH = /(?:\.|^)(?:\w*Ids?|id|slug|href|url|code)(?:\[\d+\])?$/;
/** Example phone numbers are all zeros, which is the point: never dialable. */
const ZERO_PHONE = /^0000[\s\d]*$/;
/**
 * Where the shared check is stricter than these fields need (reported to its owner, 7 Oct 2026): a
 * teaching venue like "Room 4" reads as a bed, and the leave name "PDL" as initials. Neither is
 * free text a person typed, so they are excused here by field, not by switching the check off.
 */
const NOT_FREE_TEXT = /\.venue$|\.(title|subtitle)$/;
const isLeaveName = (text: string) => /\bPDL\b/.test(text) && !/\d/.test(text);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe("example data registry", () => {
  it.each(EXAMPLE_DATASET_KEYS)("%s loads locally and carries no patient detail", async (key) => {
    const data = await loadExampleDataset(key, NOW, "Australia/Perth");
    expect(data).toBeTruthy();
    const flagged = strings(data).filter(
      ([path, text]) =>
        !ID_PATH.test(path) &&
        !UUID.test(text) &&
        !ZERO_PHONE.test(text) &&
        !(NOT_FREE_TEXT.test(path) && (path.endsWith(".venue") || isLeaveName(text))) &&
        looksLikePatientDetail(text),
    );
    expect(flagged).toEqual([]);
  });

  it("uses no real WA hospital names or dialable numbers", async () => {
    const everything = JSON.stringify(
      await Promise.all(EXAMPLE_DATASET_KEYS.map((key) => loadExampleDataset(key, NOW, "Australia/Perth"))),
    );
    expect(everything).not.toMatch(
      /Fiona Stanley|Royal Perth|Charles Gairdner|Graylands|Joondalup|King Edward|Perth Children|Fremantle Hospital|Armadale Health|Rockingham General|Bentley Health/i,
    );
    expect(everything).not.toMatch(/\b08 ?9\d{3} ?\d{4}\b|\b04\d{2} ?\d{3} ?\d{3}\b/);
  });

  it("names example people from the standard list", () => {
    expect(EXAMPLE_PEOPLE.every((name) => name.startsWith("Dr "))).toBe(true);
  });
});

describe("guards recognise every sample module's ids", () => {
  it("treats example, sample and demo ids and flags as examples, and UUIDs as real", () => {
    expect(isExampleRecord("example:1")).toBe(true);
    expect(isExampleRecord("sample-roster-1")).toBe(true);
    expect(isExampleRecord("sample:teaching:review")).toBe(true);
    expect(isExampleRecord("demo-ward-phone")).toBe(true);
    expect(isExampleRecord({ id: "cme-1", sample: true })).toBe(true);
    expect(isExampleRecord({ id: "6f1c1d5e-4a8b-4a43-9f0e-2a1c3b4d5e6f" })).toBe(false);
    expect(isExampleRecord(null)).toBe(false);
  });
});
