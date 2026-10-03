import { describe, expect, it } from "vitest";

import signableTherapySlugList from "@/data/therapy-signable-slugs.json";
import therapiesSource from "@/data/therapies-source.json";
import { curatedDifferentials } from "@/lib/differential-curated";

import {
  differentialOverlayWaitsForSignOff,
  loadSignOffQueue,
  type SignOffFamily,
  type SignOffQueue,
  type SignOffRow,
} from "@/lib/developer-area/sign-off-queue";
import {
  SIGN_OFF_TODAY_FAMILY_ORDER,
  SIGN_OFF_TODAY_SIZE,
  pickSignOffToday,
  signOffCommand,
  signOffTodayItem,
} from "@/lib/developer-area/sign-off-today";

function row(family: SignOffRow["family"], id: string, signable: boolean): SignOffRow {
  return {
    family,
    key: `${family}:${id}`,
    id,
    title: `Title ${id}`,
    nativeStatus: "drafted",
    statusLabel: "Drafted",
    requires: "A named reviewer signs it.",
    href: null,
    signOff: signable ? { script: "clinical:review", kind: "form", code: id } : null,
  };
}

function family(id: SignOffFamily["id"], rows: SignOffRow[]): SignOffFamily {
  return { id, name: `Family ${id}`, source: "x", nativeField: "status", note: "", unrouted: false, rows };
}

function queue(families: SignOffFamily[]): SignOffQueue {
  return { families, total: families.reduce((sum, item) => sum + item.rows.length, 0) };
}

describe("pickSignOffToday", () => {
  it("takes signable rows in the fixed family order, not the queue's order", () => {
    const today = pickSignOffToday(
      queue([
        family("therapy", [row("therapy", "t1", true)]),
        family("wa-mha-forms", [row("wa-mha-forms", "3C", true), row("wa-mha-forms", "4A", true)]),
      ]),
    );
    expect(today.rows.map((item) => item.id)).toEqual(["3C", "4A", "t1"]);
  });

  it("skips rows no tool can sign, and families outside the order", () => {
    const today = pickSignOffToday(
      queue([
        family("wa-mha-forms", [row("wa-mha-forms", "1A", false), row("wa-mha-forms", "1B", true)]),
        family("specifiers", [row("specifiers", "s1", true)]),
      ]),
    );
    expect(today.rows.map((item) => item.id)).toEqual(["1B"]);
    expect(today.waiting).toBe(3);
    expect(today.signable).toBe(1);
  });

  it("caps the list at the requested size but counts every signable row", () => {
    const rows = Array.from({ length: 12 }, (_, index) => row("wa-mha-forms", `F${index}`, true));
    const today = pickSignOffToday(queue([family("wa-mha-forms", rows)]));
    expect(today.rows).toHaveLength(SIGN_OFF_TODAY_SIZE);
    expect(today.signable).toBe(12);
    expect(pickSignOffToday(queue([family("wa-mha-forms", rows)]), 0).rows).toEqual([]);
  });
});

describe("signOffCommand", () => {
  it("builds the clinical:review command ending at --reviewed-by, so the tool stops until a name is typed", () => {
    expect(signOffCommand({ script: "clinical:review", kind: "form", code: "3C" })).toBe(
      'npm run clinical:review -- --write --kind form --code "3C" --reviewed-by',
    );
  });

  it("builds the therapy:review command by slug", () => {
    expect(signOffCommand({ script: "therapy:review", slug: "dbt" })).toBe(
      'npm run therapy:review -- --write --slug "dbt" --reviewed-by',
    );
  });
});

describe("signOffTodayItem", () => {
  it("is one count line linking to the owner panel, never record titles", () => {
    const today = pickSignOffToday(queue([family("wa-mha-forms", [row("wa-mha-forms", "3C", true)])]));
    const item = signOffTodayItem(today);
    expect(item).toMatchObject({ id: "my-work:sign-off:today", mode: "my-work", severity: "info", due: null });
    expect(item?.title).toBe("1 clinical record to sign off today");
    expect(item?.title).not.toContain("Title 3C");
    expect(item?.href.startsWith("/mockups/development")).toBe(true);
  });

  it("is absent when nothing can be signed", () => {
    expect(signOffTodayItem(pickSignOffToday(queue([])))).toBeNull();
  });
});

describe("the real queue", () => {
  const real = loadSignOffQueue();
  const today = pickSignOffToday(real);

  it("offers a command for every row it lists, and only from ordered families", () => {
    expect(today.rows.length).toBeGreaterThan(0);
    for (const item of today.rows) {
      expect(SIGN_OFF_TODAY_FAMILY_ORDER).toContain(item.family);
      expect(item.command).toContain("--write");
      expect(item.command.endsWith("--reviewed-by")).toBe(true);
    }
  });

  it("never offers a command for records with no sign-off tool", () => {
    const unsignable = real.families.flatMap((item) => item.rows).filter((item) => item.signOff === null);
    const keys = new Set(today.rows.map((item) => item.key));
    for (const item of unsignable) expect(keys.has(item.key)).toBe(false);
    // The exported differential records and the dictionary sense drafts have no tool.
    expect(unsignable.some((item) => item.key.startsWith("dictionary-sense:"))).toBe(true);
    expect(unsignable.some((item) => item.key.startsWith("differential-presentation:"))).toBe(true);
  });

  it("names the form code the sign-off tool expects", () => {
    const forms = real.families.find((item) => item.id === "wa-mha-forms")!;
    for (const form of forms.rows) {
      expect(form.signOff).toMatchObject({ script: "clinical:review", kind: "form" });
      expect(form.title).toContain(`Form ${(form.signOff as { code: string }).code} `);
    }
  });
});

/*
 * The sign-off tools are the authority on what can be signed. Every command the
 * page prints must name a record the tool itself would offer, or the owner is
 * handed a command that is refused — or, worse, one for content that needs
 * Aboriginal governance review rather than a clinician sign-off.
 */
describe("every printed command names a record the tool would accept", () => {
  const rows = loadSignOffQueue()
    .families.flatMap((item) => item.rows)
    .filter((item) => item.signOff !== null);

  it("clinical:review rows are in the tool's own waiting list", async () => {
    const tool = await import("../scripts/review-clinical-record.mjs");
    const contract = await import("../scripts/lib/clinical-record-review-contract.mjs");
    const byKind = new Map<string, string[]>();
    for (const item of rows) {
      if (item.signOff?.script !== "clinical:review") continue;
      byKind.set(item.signOff.kind, [...(byKind.get(item.signOff.kind) ?? []), item.signOff.code]);
    }
    expect(byKind.size).toBeGreaterThan(0);
    for (const [kind, codes] of byKind) {
      const loaded = tool.loadKindDocument(kind);
      expect(loaded.status, kind).toBe("ok");
      const records = contract.collectionOf(kind, loaded.document);
      const waiting: string[] = contract.signOffQueue(kind, records, await tool.loadContext(kind, process.cwd()));
      const refused = codes.filter((code) => !waiting.some((id) => contract.sameRecordId(id, code)));
      expect(refused, `${kind} rows the tool would not offer`).toEqual([]);
    }
  });

  it("therapy:review rows are in the tool's own walk queue", async () => {
    const therapy = await import("../scripts/review-therapy.mjs");
    const source = (await import("@/data/therapies-source.json")).default;
    const walk = new Set(therapy.therapyWalkQueue(source));
    const refused = rows
      .flatMap((item) => (item.signOff?.script === "therapy:review" ? [item.signOff.slug] : []))
      .filter((slug) => !walk.has(slug));
    expect(refused).toEqual([]);
  });
});

describe("tool-order and pin-awareness", () => {
  it("lists every clinical:review kind's signable rows in the tool's own order", async () => {
    const tool = await import("../scripts/review-clinical-record.mjs");
    const contract = await import("../scripts/lib/clinical-record-review-contract.mjs");
    const today = pickSignOffToday(loadSignOffQueue(), 10_000);
    const byKind = new Map<string, string[]>();
    for (const item of today.rows) {
      if (item.signOff.script !== "clinical:review") continue;
      byKind.set(item.signOff.kind, [...(byKind.get(item.signOff.kind) ?? []), item.signOff.code]);
    }
    for (const [kind, codes] of byKind) {
      const loaded = tool.loadKindDocument(kind);
      const records = contract.collectionOf(kind, loaded.document);
      const waiting: string[] = contract.signOffQueue(kind, records, await tool.loadContext(kind, process.cwd()));
      const expected = waiting.filter((id) => codes.some((code) => contract.sameRecordId(id, code)));
      expect(
        codes.map((code) => expected.find((id) => contract.sameRecordId(id, code))),
        kind,
      ).toEqual(expected);
    }
  });

  it("differential eligibility equals the tool's pin-aware queue, including an edited signed overlay", async () => {
    const tool = await import("../scripts/review-clinical-record.mjs");
    const contract = await import("../scripts/lib/clinical-record-review-contract.mjs");
    const context = (await tool.loadContext("differential", process.cwd())) as { curated: Record<string, object> };
    const records = contract.collectionOf("differential", tool.loadKindDocument("differential").document);
    const waiting: string[] = contract.signOffQueue("differential", records, context);
    const mine = Object.keys(curatedDifferentials).filter((slug) =>
      differentialOverlayWaitsForSignOff(slug, curatedDifferentials[slug as keyof typeof curatedDifferentials]),
    );
    expect(mine.sort()).toEqual([...waiting].sort());
    // A reviewed overlay edited after sign-off is requeued, as the tool does.
    const reviewed = "delirium";
    expect(waiting).not.toContain(reviewed);
    const edited = { ...(curatedDifferentials as Record<string, object>)[reviewed], __edited: true };
    expect(differentialOverlayWaitsForSignOff(reviewed, edited)).toBe(true);
    const staleWaiting: string[] = contract.signOffQueue("differential", records, {
      ...context,
      curated: { ...context.curated, [reviewed]: edited },
    });
    expect(staleWaiting).toContain(reviewed);
  });

  it("the signable therapy projection matches the source and the tool's walk queue", async () => {
    const therapy = await import("../scripts/review-therapy.mjs");
    const records = therapiesSource as { slug: string; reviewStatus: string }[];
    const walk = new Set<string>(therapy.therapyWalkQueue(records));
    const projected = new Set<string>(signableTherapySlugList.slugs);
    for (const record of records.filter((item) => item.reviewStatus !== "reviewed")) {
      expect(projected.has(record.slug), record.slug).toBe(walk.has(record.slug));
    }
  });
});
