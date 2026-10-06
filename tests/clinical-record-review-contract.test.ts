import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { PassThrough } from "node:stream";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { checkProblems } from "../scripts/build-mha-act-sections.mjs";
import { removePathSync } from "../scripts/retryable-fs.mjs";
import {
  FORM_ATTESTED_CATALOG_FIELDS,
  RECOMMENDED_FORM_ORDER,
  SIGN_OFF_QUESTIONS,
  applyClinicalReview,
  attestedContent,
  clinicalReviewConfirmation,
  collectionOf,
  finalizeClinicalReview,
  recordKinds,
  recordPinState,
  reviewProblems,
  renderedFormGuidance,
  renderedPriorityCards,
  reviewedContentSha256,
  signOffQueue,
} from "../scripts/lib/clinical-record-review-contract.mjs";
import {
  conductClinicalReview,
  loadFormatter,
  main,
  parseClinicalReviewArgs,
  writeDataFileAtomically,
} from "../scripts/review-clinical-record.mjs";

import formsCatalog from "../data/forms-catalog.json";
import formsContentReview from "../data/forms-content-review.json";

import { priorityFactBody } from "@/components/forms/form-priority-facts-section";
import { formCatalogDetails, formContentReviewStatus } from "@/lib/form-catalog";
import { formRecords } from "@/lib/forms";

/**
 * The clinical sign-off tool is how the clinical owner attests clinical content. These
 * tests pin the four ways a sign-off can go wrong: a partial attestation that reads as
 * reviewed, an attribution that is a placeholder or a private identifier, a timestamp that
 * has not happened yet, and -- the one that matters most -- a sign-off that silently
 * survives a later edit to the text it attested. Every record here is an in-memory
 * fixture; no test writes a reviewer into real data.
 */

const ROOT = process.cwd();
const SCRIPT = join(ROOT, "scripts", "review-clinical-record.mjs");
const NOW = new Date("2026-09-25T00:00:00.000Z");
const REVIEWED_AT = "2026-09-24T12:34:56.000Z";
const REVIEWER = "Dr Alex Morgan";
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) removePathSync(directory, { recursive: true });
});

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

function catalogFixture() {
  return {
    forms: [
      {
        id: "form-3c",
        form: "3C",
        name: "Continuation of detention",
        purpose: "Continue detention to enable a further examination.",
        maker: "Psychiatrist.",
        involved: "Authorised hospital.",
        threshold: "Further examination needed.",
        clock: "Cannot extend beyond 72 hours from the original start.",
        destination: "Authorised hospital.",
        authorises: "Continued detention for further examination.",
        doesNotAuthorise: "Treatment.",
        boundaries: ["Signing Form 3C does not start a fresh 72-hour period."],
        before: ["3A"],
        parallel: [],
        after: ["6A"],
        copies: "File on the record.",
        documentationStem: "Further examination needed because [reason].",
        traps: ["Treating the ceiling as resetting."],
        safetyPearl: "The ceiling does not reset.",
        legalNote: "Confirm the original start.",
        practicePearls: ["Record the original start time."],
        preUseChecks: ["Confirm the original reception time."],
        priorityFacts: { clock: { title: "72-hour ceiling", body: "Runs from the original start." } },
        sourceFacts: {
          documentTitle: "Continuation Of Detention",
          fileName: "Form 3C.pdf",
          pages: 2,
          timings: ["72 hours"],
          sectionCue: "sections 55, 56",
          indexedAt: "Official form PDF indexed locally",
        },
        aliases: ["continuation"],
        searchTerms: ["ceiling"],
        indexedTerms: ["detention"],
        riskLevel: "high",
        actSections: [{ section: "55", title: "Title", summary: "Reviewed separately." }],
      },
    ],
  };
}

function formRow(overrides: Record<string, unknown> = {}) {
  return {
    code: "3C",
    status: "drafted",
    sections: ["55", "56"],
    contextualSections: ["52"],
    basis: "Drafted from Mental Health Act 2014 (WA) s 55 and s 56 and the approved Form 3C.",
    reviewedBy: null,
    reviewedAt: null,
    ...overrides,
  };
}

function signedForm(catalog = catalogFixture()) {
  return finalizeClinicalReview(formRow(), "form", {
    reviewedBy: REVIEWER,
    reviewedAt: REVIEWED_AT,
    context: { catalog },
    now: NOW,
  });
}

function sectionFixtures() {
  const text = "A psychiatrist may continue the detention for a period not exceeding 72 hours.";
  const source = {
    exportMetadata: { actVersion: "v1", actAsAt: "2025-09-25" },
    sections: [
      { section: "55", heading: "Continuation", text, textSha256: sha256(text) },
      { section: "56", heading: "Further", text: "Other text.", textSha256: sha256("Other text.") },
    ],
  };
  const curated = {
    exportMetadata: {
      actVersion: "v1",
      actAsAt: "2025-09-25",
      counts: { sections: 2, reviewed: 0, drafted: 2, pending: 0 },
    },
    sections: [
      {
        section: "55",
        title: "Continuation",
        summary: "Detention may continue up to 72 hours.",
        status: "drafted",
        sourceTextSha256: sha256(text),
      },
      {
        section: "56",
        title: "Further",
        summary: "Other summary.",
        status: "drafted",
        sourceTextSha256: sha256("Other text."),
      },
    ],
  };
  const catalog = { forms: [{ form: "3C", sourceFacts: { sectionCue: "sections 55, 56" } }] };
  return { source, curated, catalog, supplemental: { forms: [] } };
}

function timeframeEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: "3C-ceiling",
    formCodes: ["3C"],
    trigger: "Continuation made (Form 3C)",
    section: "55",
    quote: "for a period not exceeding 72 hours",
    duration: { value: 72, unit: "hours" },
    anchor: "from the original reception",
    status: "drafted",
    reviewedBy: null,
    reviewedAt: null,
    reviewedContentSha256: null,
    ...overrides,
  };
}

function scriptedAsk(answers: string[]) {
  const asked: string[] = [];
  const ask = async (question: string) => {
    asked.push(question);
    const next = answers.shift();
    if (next === undefined) throw new Error(`Unexpected prompt: ${question}`);
    return next;
  };
  return { ask, asked };
}

const sink = () => {
  const chunks: string[] = [];
  return { write: (chunk: string) => chunks.push(chunk), text: () => chunks.join("") };
};

describe("reviewedContentSha256", () => {
  it("is independent of key order and ignores the review metadata", () => {
    const a = { title: "T", summary: "S", status: "drafted" };
    const b = {
      summary: "S",
      title: "T",
      status: "reviewed",
      reviewedBy: REVIEWER,
      reviewedAt: REVIEWED_AT,
      reviewedContentSha256: "x",
    };
    expect(reviewedContentSha256(a)).toBe(reviewedContentSha256(b));
    expect(reviewedContentSha256(a)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("changes when any attested content changes", () => {
    expect(reviewedContentSha256({ summary: "72 hours" })).not.toBe(reviewedContentSha256({ summary: "24 hours" }));
  });
});

describe("recordKinds", () => {
  it("registers every sign-off kind against its data file", () => {
    expect(Object.keys(recordKinds).sort()).toEqual([
      "cultural-note",
      "dictionary-rewrite",
      "differential",
      "form",
      "formulation-concept",
      "formulation-guide",
      "formulation-mechanism",
      "section",
      "service",
      "source",
      "specifier",
      "standard",
      "timeframe",
    ]);
    expect(recordKinds.differential.path).toBe("data/differential-curated-review.json");
    expect(recordKinds["formulation-guide"].path).toBe("src/data/formulation-concepts.json");
    expect(recordKinds["formulation-concept"].path).toBe("src/data/formulation-concepts.json");
    expect(recordKinds["formulation-mechanism"].path).toBe("src/data/formulation-content.json");
    expect(recordKinds.form.path).toBe("data/forms-content-review.json");
    expect(recordKinds.section.path).toBe("data/mha-2014-sections.json");
    expect(recordKinds.timeframe.path).toBe("data/mha-timeframes.json");
  });

  it("starts the recommended form order with the highest-consequence clocks", () => {
    expect(RECOMMENDED_FORM_ORDER).toEqual(["3C", "10B", "10E", "11B", "11E", "6C"]);
  });

  it("asks exactly the three owner-approved questions for every kind", () => {
    expect(SIGN_OFF_QUESTIONS.map((check: { question: string }) => check.question)).toEqual([
      "The wording matches its source.",
      "The clinical meaning is correct.",
      "It is safe to show this as reviewed.",
    ]);
    // A source record carries no clinical wording, so its kind asks source-appropriate questions.
    for (const kind of Object.values(recordKinds) as unknown as Array<{
      kind: string;
      checklist: readonly unknown[];
    }>) {
      if (kind.kind === "source") expect(kind.checklist).toHaveLength(3);
      else expect(kind.checklist).toBe(SIGN_OFF_QUESTIONS);
    }
  });

  it("walks forms in the recommended order, then catalogue order, skipping signed ones", () => {
    const catalog = { forms: ["1A", "2", "3C", "6C", "10B", "10E", "11B", "11E", "13"].map((form) => ({ form })) };
    const rows = ["13", "11E", "2", "1A", "6C", "10E", "3C", "11B", "10B"].map((code) => formRow({ code }));
    expect(signOffQueue("form", rows, { catalog })).toEqual(["3C", "10B", "10E", "11B", "11E", "6C", "1A", "2", "13"]);
    const signed = signedForm();
    expect(signOffQueue("form", [signed, formRow({ code: "2" })], { catalog: catalogFixture() })).toEqual(["2"]);
  });

  it("walks the complete form catalogue in priority order before any sign-offs", () => {
    const queue = signOffQueue(
      "form",
      formsContentReview.forms.map((row) => ({
        ...row,
        status: "drafted",
        reviewedBy: null,
        reviewedAt: null,
        reviewedContentSha256: null,
      })),
      { catalog: formsCatalog },
    );
    expect(queue.slice(0, 6)).toEqual(["3C", "10B", "10E", "11B", "11E", "6C"]);
    expect(new Set(queue.map((code: string) => code.toLowerCase())).size).toBe(formsContentReview.forms.length);
  });

  it("pins the clinically attested catalogue fields and leaves search metadata out", () => {
    for (const field of ["clock", "priorityFacts", "authorises", "doesNotAuthorise", "traps", "documentationStem"]) {
      expect(FORM_ATTESTED_CATALOG_FIELDS).toContain(field);
    }
    for (const field of ["aliases", "searchTerms", "indexedTerms", "actSections"]) {
      expect(FORM_ATTESTED_CATALOG_FIELDS).not.toContain(field);
    }
  });
});

describe("form sign-off", () => {
  it("records status, reviewer, time and a content pin, and passes the check", () => {
    const signed = signedForm();
    expect(signed).toMatchObject({ code: "3C", status: "reviewed", reviewedBy: REVIEWER, reviewedAt: REVIEWED_AT });
    expect(signed.reviewedContentSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(reviewProblems([signed], "form", { catalog: catalogFixture(), now: NOW })).toEqual([]);
    expect(recordPinState(signed, "form", { catalog: catalogFixture() })).toBe("current");
    expect(formContentReviewStatus(signed)).toBe("reviewed");
  });

  it("reports content changed since sign-off when the guidance is edited afterwards", () => {
    const signed = signedForm();
    for (const edit of [
      (catalog: ReturnType<typeof catalogFixture>) => (catalog.forms[0].clock = "Up to 72 hours from signing."),
      (catalog: ReturnType<typeof catalogFixture>) => (catalog.forms[0].priorityFacts.clock.title = "72 hours"),
      (catalog: ReturnType<typeof catalogFixture>) => catalog.forms[0].traps.push("A new trap."),
      (catalog: ReturnType<typeof catalogFixture>) => (catalog.forms[0].documentationStem = "Changed stem."),
      (catalog: ReturnType<typeof catalogFixture>) => (catalog.forms[0].sourceFacts.timings = ["24 hours"]),
    ]) {
      const catalog = catalogFixture();
      edit(catalog);
      const problems = reviewProblems([signed], "form", { catalog, now: NOW });
      expect(problems.join("\n")).toContain("content changed since sign-off");
      expect(recordPinState(signed, "form", { catalog })).toBe("stale");
    }
    const editedRow = { ...signed, basis: "A different basis for the guidance." };
    expect(reviewProblems([editedRow], "form", { catalog: catalogFixture(), now: NOW }).join("\n")).toContain(
      "content changed since sign-off",
    );
  });

  it("does not invalidate a sign-off for search-index metadata the owner did not attest", () => {
    const signed = signedForm();
    const catalog = catalogFixture();
    catalog.forms[0].aliases.push("new alias");
    catalog.forms[0].searchTerms.push("new term");
    catalog.forms[0].sourceFacts.fileName = "Renamed.pdf";
    expect(reviewProblems([signed], "form", { catalog, now: NOW })).toEqual([]);
  });

  it("keeps a partial attestation drafted and reports it", () => {
    const signed = signedForm();
    for (const partial of [
      { ...signed, reviewedAt: null },
      { ...signed, reviewedBy: null },
      { ...signed, reviewedContentSha256: undefined },
    ]) {
      expect(reviewProblems([partial], "form", { catalog: catalogFixture(), now: NOW }).length).toBeGreaterThan(0);
    }
    expect(formContentReviewStatus({ ...signed, reviewedAt: null })).toBe("drafted");
    const stray = formRow({ reviewedBy: REVIEWER, reviewedAt: REVIEWED_AT });
    expect(formContentReviewStatus(stray)).toBe("drafted");
    expect(reviewProblems([stray], "form", { catalog: catalogFixture(), now: NOW }).join("\n")).toMatch(
      /drafted .*reviewedBy/,
    );
  });

  it("rejects an email or placeholder reviewer", () => {
    for (const reviewer of [
      "josh@example.com",
      "TBD",
      "Placeholder",
      "Dr Placeholder",
      "AHPRA MED0001234567",
      "<your name>",
      "Dr Your Name",
      "Dr <your surname>",
      "Dr J Smith",
      "Dr Jane Citizen",
      "jane citizen",
    ]) {
      expect(() =>
        finalizeClinicalReview(formRow(), "form", {
          reviewedBy: reviewer,
          reviewedAt: REVIEWED_AT,
          context: { catalog: catalogFixture() },
          now: NOW,
        }),
      ).toThrow(/reviewedBy/);
      const signed = { ...signedForm(), reviewedBy: reviewer };
      expect(reviewProblems([signed], "form", { catalog: catalogFixture(), now: NOW }).join("\n")).toContain(
        "reviewedBy",
      );
    }
  });

  it("rejects a future or non-UTC reviewedAt", () => {
    const signed = signedForm();
    for (const reviewedAt of ["2026-09-26T00:00:00.000Z", "2026-09-24", "2026-09-24T12:00:00+08:00"]) {
      expect(
        reviewProblems([{ ...signed, reviewedAt }], "form", { catalog: catalogFixture(), now: NOW }).join("\n"),
      ).toContain("reviewedAt");
    }
    expect(() =>
      finalizeClinicalReview(formRow(), "form", {
        reviewedBy: REVIEWER,
        reviewedAt: "2026-09-26T00:00:00.000Z",
        context: { catalog: catalogFixture() },
        now: NOW,
      }),
    ).toThrow(/future/);
  });

  it("reports a reviewed form whose code is missing from the catalogue", () => {
    const signed = signedForm();
    expect(reviewProblems([signed], "form", { catalog: { forms: [] }, now: NOW }).join("\n")).toContain("3C");
  });
});

describe("section sign-off", () => {
  it("passes the Act-section check once signed, and fails it after the summary is edited", () => {
    const fixtures = sectionFixtures();
    const signed = finalizeClinicalReview(fixtures.curated.sections[0], "section", {
      reviewedBy: REVIEWER,
      reviewedAt: REVIEWED_AT,
      now: NOW,
    });
    const curated = applyClinicalReview(fixtures.curated, "section", signed);
    expect(curated.exportMetadata.counts).toEqual({ sections: 2, reviewed: 1, drafted: 1, pending: 0 });
    expect(checkProblems({ ...fixtures, curated })).toEqual([]);

    const edited = structuredClone(curated);
    edited.sections[0].summary = "Detention may continue up to 96 hours.";
    expect(checkProblems({ ...fixtures, curated: edited }).join("\n")).toContain("content changed since sign-off");
  });

  it("fails the check when a reviewed section has no content pin", () => {
    const fixtures = sectionFixtures();
    const signed = finalizeClinicalReview(fixtures.curated.sections[0], "section", {
      reviewedBy: REVIEWER,
      reviewedAt: REVIEWED_AT,
      now: NOW,
    });
    const curated = applyClinicalReview(fixtures.curated, "section", { ...signed, reviewedContentSha256: undefined });
    expect(checkProblems({ ...fixtures, curated }).join("\n")).toContain("reviewedContentSha256");
  });

  it("refuses to sign off a pending section that has no summary yet", () => {
    expect(() =>
      finalizeClinicalReview({ section: "60", title: "T", status: "pending" }, "section", {
        reviewedBy: REVIEWER,
        reviewedAt: REVIEWED_AT,
        now: NOW,
      }),
    ).toThrow(/drafted/);
  });
});

describe("timeframe sign-off", () => {
  it("pins the quote, duration and anchor", () => {
    const signed = finalizeClinicalReview(timeframeEntry(), "timeframe", {
      reviewedBy: REVIEWER,
      reviewedAt: REVIEWED_AT,
      now: NOW,
    });
    expect(reviewProblems([signed], "timeframe", { now: NOW })).toEqual([]);
    for (const edited of [
      { ...signed, quote: "for a period not exceeding 96 hours" },
      { ...signed, duration: { value: 96, unit: "hours" } },
      { ...signed, anchor: "from signing" },
    ]) {
      expect(reviewProblems([edited], "timeframe", { now: NOW }).join("\n")).toContain(
        "content changed since sign-off",
      );
    }
  });

  it("reads the entries from either a bare array or an entries list", () => {
    const entry = timeframeEntry();
    expect(collectionOf("timeframe", [entry])).toEqual([entry]);
    expect(collectionOf("timeframe", { exportMetadata: {}, entries: [entry] })).toEqual([entry]);
  });
});

describe("renderedPriorityCards", () => {
  it("matches what the Forms page renders on every form's clock, authority and criteria cards", () => {
    const catalogByCode = new Map(
      formsCatalog.forms.map((entry) => [entry.form.trim().toLowerCase(), entry as Record<string, unknown>]),
    );
    expect(formRecords.length).toBe(54);
    for (const record of formRecords) {
      const code = formCatalogDetails(record)!.form;
      const rendered = renderedPriorityCards(catalogByCode.get(code.trim().toLowerCase()));
      for (const id of ["clock", "authority", "criteria"] as const) {
        const face = record.summaryCards?.find((card) => card.id === id);
        expect({ title: face?.title, detail: face?.detail }, `${code} ${id} face`).toEqual({
          title: rendered[id].title,
          detail: rendered[id].detail,
        });
        expect(priorityFactBody(record, id), `${code} ${id} sheet`).toEqual(rendered[id].sheet);
      }
    }
  });

  it("matches every guidance field the Forms page renders, fallback sentences included", () => {
    const catalogByCode = new Map(
      formsCatalog.forms.map((entry) => [entry.form.trim().toLowerCase(), entry as Record<string, unknown>]),
    );
    const fields = [
      "purpose",
      "maker",
      "involved",
      "threshold",
      "clock",
      "destination",
      "authorises",
      "doesNotAuthorise",
      "boundaries",
      "before",
      "parallel",
      "after",
      "copies",
      "documentationStem",
      "traps",
      "safetyPearl",
      "sourceNote",
      "legalNote",
      "practicePearls",
      "preUseChecks",
    ] as const;
    for (const record of formRecords) {
      const details = formCatalogDetails(record)!;
      const rendered = renderedFormGuidance(catalogByCode.get(details.form.trim().toLowerCase()));
      for (const field of fields) expect(rendered[field], `${details.form} ${field}`).toEqual(details[field]);
    }
  });

  it("pins the app's fallback sentences for a form whose catalogue field is empty", () => {
    const catalog = catalogFixture() as { forms: Record<string, unknown>[] };
    catalog.forms[0].authorises = "";
    const signed = finalizeClinicalReview(formRow(), "form", {
      reviewedBy: REVIEWER,
      reviewedAt: REVIEWED_AT,
      context: { catalog },
      now: NOW,
    });
    expect(attestedContent(signed, "form", { catalog }).rendered.authorises).toBe(
      "Only the action or record expressly described by Form 3C and the Mental Health Act 2014.",
    );
  });

  it("pins indexedClock, the Clock card's fallback detail line", () => {
    const signed = signedForm();
    const catalog = catalogFixture() as ReturnType<typeof catalogFixture> & { forms: { indexedClock?: string }[] };
    catalog.forms[0].indexedClock = "within 24 hours";
    expect(reviewProblems([signed], "form", { catalog, now: NOW }).join("\n")).toContain(
      "content changed since sign-off",
    );
  });
});

describe("attestedContent", () => {
  it("combines the review row with the pinned catalogue fields for a form", () => {
    const content = attestedContent(formRow(), "form", { catalog: catalogFixture() });
    expect(content).toMatchObject({ code: "3C", basis: expect.any(String) });
    expect(content.catalog.clock).toContain("72 hours");
    expect(content.catalog.aliases).toBeUndefined();
    expect(content.catalog.sourceFacts).toEqual({ timings: ["72 hours"], sectionCue: "sections 55, 56" });
  });
});

describe("conductClinicalReview", () => {
  const kind = "form";
  const context = { catalog: catalogFixture() };

  it("commits exactly once after every checklist answer is yes and the confirmation matches", async () => {
    const questions = recordKinds.form.checklist.length;
    const { ask } = scriptedAsk([...Array(questions).fill("yes"), clinicalReviewConfirmation("form", formRow())]);
    const committed: unknown[] = [];
    const result = await conductClinicalReview({
      kind,
      record: formRow(),
      context,
      reviewedBy: REVIEWER,
      ask,
      output: sink(),
      now: () => new Date(REVIEWED_AT),
      commit: async (record: unknown) => {
        committed.push(record);
      },
    });
    expect(result.status).toBe("reviewed");
    expect(committed).toHaveLength(1);
    expect(committed[0]).toMatchObject({ status: "reviewed", reviewedBy: REVIEWER, reviewedAt: REVIEWED_AT });
  });

  it("leaves the record drafted when any answer is no", async () => {
    const questions = recordKinds.form.checklist.length;
    const { ask } = scriptedAsk(["yes", "no", ...Array(questions - 2).fill("yes")]);
    let commits = 0;
    const record = formRow();
    const result = await conductClinicalReview({
      kind,
      record,
      context,
      reviewedBy: REVIEWER,
      ask,
      output: sink(),
      commit: async () => {
        commits += 1;
      },
    });
    expect(result.status).toBe("incomplete");
    expect(result.record.status).toBe("drafted");
    expect(commits).toBe(0);
  });

  it("re-asks on anything other than yes, no or quit, and cancels on a wrong confirmation", async () => {
    const questions = recordKinds.form.checklist.length;
    const { ask, asked } = scriptedAsk(["y", ...Array(questions).fill("yes"), "3D"]);
    let commits = 0;
    const result = await conductClinicalReview({
      kind,
      record: formRow(),
      context,
      reviewedBy: REVIEWER,
      ask,
      output: sink(),
      commit: async () => {
        commits += 1;
      },
    });
    expect(asked).toHaveLength(questions + 2);
    expect(result.status).toBe("cancelled");
    expect(commits).toBe(0);
  });

  it("stops without saving when the owner types quit at the code prompt", async () => {
    const questions = recordKinds.form.checklist.length;
    const { ask } = scriptedAsk([...Array(questions).fill("yes"), "quit"]);
    let commits = 0;
    const result = await conductClinicalReview({
      kind,
      record: formRow(),
      context,
      reviewedBy: REVIEWER,
      ask,
      output: sink(),
      commit: async () => {
        commits += 1;
      },
    });
    expect(result.status).toBe("quit");
    expect(commits).toBe(0);
  });

  it("refuses a placeholder reviewer before asking anything", async () => {
    const { ask, asked } = scriptedAsk([]);
    await expect(
      conductClinicalReview({
        kind,
        record: formRow(),
        context,
        reviewedBy: "TBD",
        ask,
        output: sink(),
        commit: async () => {},
      }),
    ).rejects.toThrow(/reviewedBy/);
    expect(asked).toEqual([]);
  });
});

describe("review-clinical-record CLI", () => {
  it("has no batch, yes or answer flags", () => {
    for (const flag of ["--yes", "-y", "--all", "--answers"]) {
      expect(() => parseClinicalReviewArgs([flag])).toThrow(/Unknown option/);
    }
    expect(() => parseClinicalReviewArgs(["--code", "3C", "--code", "10B"])).toThrow(/once/);
    expect(parseClinicalReviewArgs(["--kind", "form", "--code", "3C"])).toMatchObject({ kind: "form", code: "3C" });
    expect(parseClinicalReviewArgs(["--write", "--walk", "--kind", "form"])).toMatchObject({ walk: true });
    expect(() => parseClinicalReviewArgs(["--walk", "--kind", "form"])).toThrow(/--write/);
    expect(() => parseClinicalReviewArgs(["--write", "--walk", "--kind", "form", "--code", "3C"])).toThrow(/--code/);
    expect(parseClinicalReviewArgs(["--pack", "--kind", "form"])).toMatchObject({ pack: true, kind: "form" });
    expect(() => parseClinicalReviewArgs(["--pack"])).toThrow(/--kind/);
    expect(() => parseClinicalReviewArgs(["--pack", "--write", "--kind", "form"])).toThrow(/--pack/);
    expect(() => parseClinicalReviewArgs(["--batch", "--kind", "form"])).toThrow(/--write/);
    expect(() => parseClinicalReviewArgs(["--write", "--batch", "--walk", "--kind", "form"])).toThrow(/--batch/);
    expect(() => parseClinicalReviewArgs(["--write", "--walk", "--kind", "form", "--exclude", "3C"])).toThrow(
      /--exclude/,
    );
  });

  it("refuses --write --walk without an interactive TTY and exits non-zero", () => {
    const path = join(ROOT, "data", "forms-content-review.json");
    const before = readFileSync(path, "utf8");
    const refused = spawnSync(
      process.execPath,
      [SCRIPT, "--write", "--walk", "--kind", "form", "--reviewed-by", REVIEWER],
      { cwd: ROOT, encoding: "utf8", input: "yes\nyes\nyes\n3C\n" },
    );
    expect(refused.status).not.toBe(0);
    expect(refused.stderr).toContain("interactive TTY");
    expect(readFileSync(path, "utf8")).toBe(before);
  });

  it("walk mode saves each confirmed record at once, skips a no, and keeps saves after quit", async () => {
    const root = mkdtempSync(join(tmpdir(), "clinical-walk-"));
    temporaryDirectories.push(root);
    mkdirSync(join(root, "data"));
    const catalog = { forms: ["3C", "10B", "10E", "1A"].map((form) => ({ ...catalogFixture().forms[0], form })) };
    const reviewPath = join(root, "data", "forms-content-review.json");
    writeFileSync(reviewPath, JSON.stringify({ forms: ["1A", "10E", "10B", "3C"].map((code) => formRow({ code })) }));
    writeFileSync(join(root, "data", "forms-catalog.json"), JSON.stringify(catalog));

    // 3C: yes x3 + code (saved). 10B: a no (skipped). 10E: quit (stops; 1A never shown).
    const answers = ["yes", "yes", "yes", "3C", "yes", "no", "quit"];
    const input = Object.assign(new PassThrough(), { isTTY: true });
    const text: string[] = [];
    const output = Object.assign(new PassThrough(), { isTTY: true, columns: 80 });
    output.on("data", (chunk: Buffer) => {
      const value = chunk.toString();
      text.push(value);
      if (/(Type yes, no, or quit: |type its code \([^)]*\), or quit to stop: )$/.test(value)) {
        const next = answers.shift();
        if (next !== undefined) setImmediate(() => input.write(`${next}\n`));
      }
    });
    const code = await main(["--write", "--walk", "--kind", "form", "--reviewed-by", REVIEWER], {
      root,
      input,
      output,
      errorOutput: sink(),
    });
    expect(code).toBe(0);
    expect(answers).toEqual([]);
    const saved = JSON.parse(readFileSync(reviewPath, "utf8")).forms;
    const byCode = Object.fromEntries(saved.map((row: { code: string }) => [row.code, row]));
    expect(byCode["3C"]).toMatchObject({ status: "reviewed", reviewedBy: REVIEWER });
    expect(reviewProblems([byCode["3C"]], "form", { catalog })).toEqual([]);
    for (const unsigned of ["10B", "10E", "1A"]) expect(byCode[unsigned].status).toBe("drafted");
    expect(text.join("")).toContain("Signed off this session: 3C.");
    expect(text.join("")).not.toContain("Form 1A  (4 of 4)");
  });

  it("is report-only by default and lists the queue without changing any file", () => {
    const before = readFileSync(join(ROOT, "data", "forms-content-review.json"), "utf8");
    const report = spawnSync(process.execPath, [SCRIPT], { cwd: ROOT, encoding: "utf8" });
    expect(report.status).toBe(0);
    expect(report.stdout).toContain("Forms");
    expect(report.stdout).toContain("54 of 54 signed off");
    expect(report.stdout).toContain("Report only");
    expect(readFileSync(join(ROOT, "data", "forms-content-review.json"), "utf8")).toBe(before);
  });

  it("refuses --write without an interactive TTY and exits non-zero", () => {
    const paths = ["forms-content-review.json", "mha-2014-sections.json"].map((name) => join(ROOT, "data", name));
    const before = paths.map((path) => readFileSync(path, "utf8"));
    const refused = spawnSync(
      process.execPath,
      [SCRIPT, "--write", "--kind", "form", "--code", "3C", "--reviewed-by", REVIEWER],
      { cwd: ROOT, encoding: "utf8", input: "yes\nyes\nyes\nyes\nSIGN OFF 3C\n" },
    );
    expect(refused.status).not.toBe(0);
    expect(refused.stderr).toContain("interactive TTY");
    expect(paths.map((path) => readFileSync(path, "utf8"))).toEqual(before);
  });

  it("loads the project formatter it needs before asking anything", async () => {
    await expect(loadFormatter()).resolves.toHaveProperty("format");
  });

  it("clears a leftover lock from a finished session but respects a live one", () => {
    const root = mkdtempSync(join(tmpdir(), "clinical-lock-"));
    temporaryDirectories.push(root);
    const path = join(root, "records.json");
    writeFileSync(path, "{}\n");
    const notices: string[] = [];

    writeFileSync(`${path}.review.lock`, "2147483646\n");
    writeDataFileAtomically(path, '{"a":1}\n', "{}\n", { notice: (message: string) => notices.push(message) });
    expect(readFileSync(path, "utf8")).toBe('{"a":1}\n');
    expect(notices.join("")).toContain("leftover lock");

    writeFileSync(`${path}.review.lock`, `${process.pid}\n`);
    expect(() => writeDataFileAtomically(path, '{"a":2}\n', '{"a":1}\n')).toThrow(/Another sign-off/);
    expect(readFileSync(path, "utf8")).toBe('{"a":1}\n');
  });

  it("skips the timeframe kind cleanly while its data file does not exist", async () => {
    const root = mkdtempSync(join(tmpdir(), "clinical-review-"));
    temporaryDirectories.push(root);
    mkdirSync(join(root, "data"));
    writeFileSync(join(root, "data", "forms-content-review.json"), JSON.stringify({ forms: [formRow()] }));
    writeFileSync(join(root, "data", "forms-catalog.json"), JSON.stringify(catalogFixture()));
    const { source, curated } = sectionFixtures();
    writeFileSync(join(root, "data", "mha-2014-sections.json"), JSON.stringify(curated));
    writeFileSync(join(root, "data", "mha-2014-sections.source.json"), JSON.stringify(source));
    const output = sink();
    const code = await main([], { root, output, errorOutput: sink() });
    expect(code).toBe(0);
    expect(output.text()).toContain("data/mha-timeframes.json does not exist yet");
    expect(output.text()).toContain("Next: 3C");
  });
});
