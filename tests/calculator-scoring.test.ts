import { describe, expect, it } from "vitest";

import {
  allCalculatorFixtures,
  calculators,
  type CalculatorFixture,
  type CalculatorItem,
} from "@/components/calculators/calculator-fixtures";
import {
  deriveCalculator,
  formatResultSummary,
  itemScore,
  progressLabel,
  type AnswerMap,
} from "@/components/calculators/calculator-ui";

/*
 * Scoring guard for the active calculator catalogue and quarantined MDQ fixture.
 *
 * `calculator-ui.tsx` held the band lookup, the MDQ three-criterion rule and the
 * band-suppression rules with no executing test — the only calculator test in the
 * repo asserted mockup import boundaries. A wrong band is a clinical
 * misclassification that renders as a normal result, so the floor belongs here
 * rather than in a Playwright journey: these are pure functions, so the whole
 * file costs about as much as one browser navigation.
 *
 * Everything below drives the exported pure functions only. No DOM, no mocks.
 */

function fixture(id: string): CalculatorFixture {
  const calc = allCalculatorFixtures.find((entry) => entry.id === id);
  if (!calc) throw new Error(`calculator fixture "${id}" not found`);
  return calc;
}

function lowestOptionIndex(item: CalculatorItem): number {
  const options = item.options ?? [];
  let lowest = 0;
  for (let index = 1; index < options.length; index += 1) {
    if (options[index].points < options[lowest].points) lowest = index;
  }
  return lowest;
}

/** Every item at its floor: the minimum score the instrument can report. */
function baselineAnswers(calc: CalculatorFixture): AnswerMap {
  const answers: AnswerMap = {};
  for (const item of calc.items) {
    answers[item.id] = item.kind === "options" ? lowestOptionIndex(item) : 0;
  }
  return answers;
}

/** Every item at its ceiling: the maximum score the instrument can report. */
function maximalAnswers(calc: CalculatorFixture): AnswerMap {
  const answers: AnswerMap = {};
  for (const item of calc.items) {
    if (item.kind !== "options") {
      answers[item.id] = 1;
      continue;
    }
    const options = item.options ?? [];
    let highest = 0;
    for (let index = 1; index < options.length; index += 1) {
      if (options[index].points > options[highest].points) highest = index;
    }
    answers[item.id] = highest;
  }
  return answers;
}

/**
 * Build a complete answer map scoring exactly `target`. Starts from the floor and
 * raises one item at a time. Every caller asserts the resulting score, so a helper
 * that cannot reach the target fails loudly instead of weakening the assertion.
 */
function answersForScore(calc: CalculatorFixture, target: number): AnswerMap {
  const answers = baselineAnswers(calc);
  let remaining = target - deriveCalculator(calc, answers).score;

  for (const item of calc.items) {
    if (remaining <= 0) break;
    if (item.kind === "options") {
      const options = item.options ?? [];
      const currentIndex = answers[item.id] ?? 0;
      const currentPoints = options[currentIndex]?.points ?? 0;
      let best = currentIndex;
      for (let index = 0; index < options.length; index += 1) {
        const delta = options[index].points - currentPoints;
        if (delta > 0 && delta <= remaining && options[index].points > options[best].points) best = index;
      }
      remaining -= (options[best]?.points ?? 0) - currentPoints;
      answers[item.id] = best;
    } else {
      const points = item.points ?? 0;
      if (points > 0 && points <= remaining) {
        answers[item.id] = 1;
        remaining -= points;
      }
    }
  }

  return answers;
}

describe("calculator band tables", () => {
  it.each(calculators.map((calc) => [calc.id, calc] as const))(
    "%s declares contiguous bands spanning its full score range",
    (_id, calc) => {
      const bands = [...calc.bands].sort((left, right) => left.min - right.min);

      expect(bands.length).toBeGreaterThan(0);
      expect(bands[0].min).toBe(calc.minScore);
      expect(bands[bands.length - 1].max).toBe(calc.maxScore);

      for (let index = 1; index < bands.length; index += 1) {
        // A gap leaves a score with no band at all; an overlap makes the
        // reported severity depend on declaration order.
        expect(bands[index].min, `band ${index} of ${calc.id} must start one above the previous band`).toBe(
          bands[index - 1].max + 1,
        );
      }
    },
  );

  it.each(calculators.map((calc) => [calc.id, calc] as const))(
    "%s maps every reachable score to exactly one band",
    (_id, calc) => {
      for (let score = calc.minScore; score <= calc.maxScore; score += 1) {
        const matches = calc.bands.filter((band) => score >= band.min && score <= band.max);
        expect(matches, `${calc.id} score ${score} matched ${matches.length} bands`).toHaveLength(1);
      }
    },
  );

  it.each(calculators.map((calc) => [calc.id, calc] as const))(
    "%s items can actually reach its declared score range",
    (_id, calc) => {
      // A declared range the items cannot produce means either an unreachable
      // band or a score that falls off the end of the table.
      expect(deriveCalculator(calc, baselineAnswers(calc)).score).toBe(calc.minScore);
      expect(deriveCalculator(calc, maximalAnswers(calc)).score).toBe(calc.maxScore);
    },
  );
});

describe("itemScore", () => {
  const checkbox: CalculatorItem = { id: "x", text: "x", kind: "checkbox", points: 3 };
  const options: CalculatorItem = {
    id: "y",
    text: "y",
    kind: "options",
    options: [
      { label: "None", short: "None", points: 0 },
      { label: "Some", short: "Some", points: 2 },
    ],
  };

  it("scores an unanswered item as zero", () => {
    expect(itemScore(checkbox, undefined)).toBe(0);
    expect(itemScore(options, undefined)).toBe(0);
  });

  it("scores a checkbox only when explicitly ticked", () => {
    expect(itemScore(checkbox, 1)).toBe(3);
    expect(itemScore(checkbox, 0)).toBe(0);
  });

  it("scores an options item by the selected option's points", () => {
    expect(itemScore(options, 0)).toBe(0);
    expect(itemScore(options, 1)).toBe(2);
  });

  it("treats an out-of-range option index as zero rather than NaN", () => {
    expect(itemScore(options, 7)).toBe(0);
  });

  it("treats a checkbox with no declared points as zero", () => {
    expect(itemScore({ id: "z", text: "z", kind: "checkbox" }, 1)).toBe(0);
  });
});

describe("PHQ-9 severity banding", () => {
  const phq9 = fixture("phq9");

  // Boundary scores on both sides of every published PHQ-9 cut point. These map
  // to stepped treatment actions, so an off-by-one here changes clinical advice.
  const boundaries = [
    [0, "Minimal"],
    [4, "Minimal"],
    [5, "Mild"],
    [9, "Mild"],
    [10, "Moderate"],
    [14, "Moderate"],
    [15, "Moderately severe"],
    [19, "Moderately severe"],
    [20, "Severe"],
    [27, "Severe"],
  ] as const;

  it.each(boundaries)("scores %i as %s", (score, label) => {
    const state = deriveCalculator(phq9, answersForScore(phq9, score));
    expect(state.score).toBe(score);
    expect(state.band?.label).toBe(label);
    expect(state.result.label).toBe(label);
  });

  it("raises the item-9 self-harm flag only when that item scores above zero", () => {
    const flagged = deriveCalculator(phq9, { ...baselineAnswers(phq9), p9: 1 });
    expect(flagged.flags).toEqual([
      "Item 9 endorsed — directly assess suicidal thoughts, self-harm thoughts and immediate safety now.",
    ]);

    const unflagged = deriveCalculator(phq9, { ...baselineAnswers(phq9), p9: 0 });
    expect(unflagged.flags).toEqual([]);
  });

  it("withholds a PHQ-9 band while the scale is still filling in", () => {
    const partial = deriveCalculator(phq9, { p1: 3, p2: 3 });
    expect(partial.complete).toBe(false);
    expect(partial.started).toBe(true);
    expect(partial.band).toBeUndefined();
    expect(partial.result.label).toBe("Incomplete");
  });
});

describe("GAD-7 severity banding", () => {
  const gad7 = fixture("gad7");

  it.each([
    [0, "Minimal"],
    [4, "Minimal"],
    [5, "Mild"],
    [9, "Mild"],
    [10, "Moderate"],
    [14, "Moderate"],
    [15, "Severe"],
    [21, "Severe"],
  ] as const)("scores %i as %s", (score, label) => {
    const state = deriveCalculator(gad7, answersForScore(gad7, score));
    expect(state.score).toBe(score);
    expect(state.band?.label).toBe(label);
  });
});

describe("band suppression for scales that cannot read zero", () => {
  it("withholds a K10 band until every item is answered", () => {
    const k10 = fixture("k10");
    // K10 floors at 10, so a part-filled scale would otherwise fall below the
    // table and read as the lowest band on incomplete data.
    const partial = deriveCalculator(k10, { k1: 4, k2: 4 });
    expect(partial.complete).toBe(false);
    expect(partial.band).toBeUndefined();
    // The dash this used to assert was the incidental rendering of the same
    // withholding the line above pins; the phrase now says it in words, and is
    // read from the primitive so the two cannot drift apart.
    expect(partial.result.label).toBe("Incomplete");

    const complete = deriveCalculator(k10, answersForScore(k10, 30));
    expect(complete.complete).toBe(true);
    expect(complete.score).toBe(30);
    expect(complete.band?.label).toBe("Very high");
  });

  it("withholds a CAGE band until every yes/no item is recorded", () => {
    const cage = fixture("cage");
    // A half-ticked checkbox screen still has undefined items; reading it as
    // "low risk" would be a false negative.
    const partial = deriveCalculator(cage, { c1: 0, c2: 0 });
    expect(partial.complete).toBe(false);
    expect(partial.band).toBeUndefined();

    const allNegative = deriveCalculator(cage, { c1: 0, c2: 0, c3: 0, c4: 0 });
    expect(allNegative.complete).toBe(true);
    expect(allNegative.score).toBe(0);
    expect(allNegative.band?.label).toBeDefined();
  });
});

describe("MDQ three-criterion screen", () => {
  const mdq = fixture("mdq");

  /** `count` symptom items endorsed, plus the two criterion items. */
  function mdqAnswers(count: number, extras: AnswerMap = {}): AnswerMap {
    const answers: AnswerMap = {};
    for (let index = 1; index <= 13; index += 1) {
      answers[`m${index}`] = index <= count ? 1 : 0;
    }
    return { ...answers, ...extras };
  }

  it("returns a positive screen only when all three criteria are met", () => {
    const state = deriveCalculator(mdq, mdqAnswers(7, { mco: 1, mimp: 2 }));
    expect(state.score).toBe(7);
    expect(state.result.label).toBe("Positive screen");
    expect(state.result.tone).toBe("danger");
  });

  it("withholds a positive screen when co-occurrence is not confirmed", () => {
    const state = deriveCalculator(mdq, mdqAnswers(7, { mco: 0, mimp: 3 }));
    expect(state.result.label).toBe("Symptom threshold met");
    expect(state.result.guidance).toContain("co-occurrence");
  });

  it("withholds a positive screen when impairment is below moderate", () => {
    const state = deriveCalculator(mdq, mdqAnswers(9, { mco: 1, mimp: 1 }));
    expect(state.result.label).toBe("Symptom threshold met");
    expect(state.result.guidance).toContain("moderate-or-serious impairment");
  });

  it("names both unmet criteria when neither is confirmed", () => {
    const state = deriveCalculator(mdq, mdqAnswers(13, { mco: 0, mimp: 0 }));
    expect(state.result.guidance).toContain("co-occurrence and moderate-or-serious impairment");
  });

  it("returns a negative screen one symptom below the threshold", () => {
    const state = deriveCalculator(mdq, mdqAnswers(6, { mco: 1, mimp: 3 }));
    expect(state.score).toBe(6);
    expect(state.result.label).toBe("Negative screen");
    expect(state.result.tone).toBe("success");
  });

  it("scores the criterion items as zero points", () => {
    // `mco` and `mimp` record state but must never inflate the symptom count.
    const withCriteria = deriveCalculator(mdq, mdqAnswers(7, { mco: 1, mimp: 3 }));
    const withoutCriteria = deriveCalculator(mdq, mdqAnswers(7, { mco: 0, mimp: 0 }));
    expect(withCriteria.score).toBe(withoutCriteria.score);
  });
});

describe("result summary text", () => {
  const phq9 = fixture("phq9");

  // This text leaves the app on the clipboard, so it is the one place a score can
  // be read with none of the interface around it. The caveat travels with it.
  const SCOPE_LINE =
    "Clinical reference — not validated decision support. Confirm scoring and interpretation against the source instrument.";

  it("reports score, maximum and band once the scale is complete", () => {
    const state = deriveCalculator(phq9, answersForScore(phq9, 12));
    expect(formatResultSummary(phq9, state)).toBe(`PHQ-9 12/27 — Moderate\n${SCOPE_LINE}`);
  });

  it("appends progress while the scale is incomplete", () => {
    const state = deriveCalculator(phq9, { p1: 3, p2: 3 });
    expect(state.complete).toBe(false);
    expect(formatResultSummary(phq9, state)).toBe(`PHQ-9 6/27 — Incomplete (2 of 9 answered)\n${SCOPE_LINE}`);
  });

  it("never yields a bare score line without its scope caveat", () => {
    // Guards the defect this replaced: a pasted "PHQ-9 18/27 — Moderately severe"
    // reads as an assessment result the software stands behind.
    for (const score of [0, 6, 12, 27]) {
      const state = deriveCalculator(phq9, answersForScore(phq9, score));
      const summary = formatResultSummary(phq9, state);
      // One line per active safety flag sits between the score and the caveat.
      expect(summary.split("\n")).toHaveLength(2 + state.flags.length);
      expect(summary.endsWith(SCOPE_LINE)).toBe(true);
    }
  });

  it("carries an endorsed PHQ-9 item 9 into the copied text", () => {
    const answers: AnswerMap = { p1: 1, p2: 1, p3: 1, p4: 1, p5: 1, p6: 0, p7: 0, p8: 0, p9: 1 };
    const state = deriveCalculator(phq9, answers);
    expect(state.score).toBe(6);
    const summary = formatResultSummary(phq9, state);
    expect(summary.split("\n")[0]).toBe("PHQ-9 6/27 — Mild");
    expect(summary).toContain("Flag: Item 9 endorsed");
    expect(summary.endsWith(SCOPE_LINE)).toBe(true);
  });

  it("labels a flag provisional while the scale is incomplete", () => {
    const summary = formatResultSummary(phq9, deriveCalculator(phq9, { p9: 2 }));
    expect(summary).toContain("Flag (provisional): Item 9 endorsed");
  });

  it("counts endorsements rather than answers for checkbox-only scales", () => {
    const cage = fixture("cage");
    const state = deriveCalculator(cage, { c1: 1, c2: 1, c3: 0, c4: 0 });
    expect(progressLabel(state)).toBe("4 of 4 answered · 2 endorsed");
  });
});

describe("Y-BOCS control item scoring", () => {
  const ybocs = fixture("ybocs");

  it("uses inverted control anchors where 0 is complete control and 4 is no control", () => {
    const controlItemIds = ["y5", "y10"];
    for (const itemId of controlItemIds) {
      const item = ybocs.items.find((i) => i.id === itemId);
      expect(item).toBeDefined();
      expect(item?.kind).toBe("options");
      const options = item?.options ?? [];
      expect(options).toHaveLength(5);
      expect(options[0]).toEqual({ label: "Complete control", short: "0", points: 0 });
      expect(options[1]).toEqual({ label: "Much control", short: "1", points: 1 });
      expect(options[2]).toEqual({ label: "Moderate control", short: "2", points: 2 });
      expect(options[3]).toEqual({ label: "Little control", short: "3", points: 3 });
      expect(options[4]).toEqual({ label: "No control", short: "4", points: 4 });
    }
  });

  it("gives the resistance items (4 and 9) their own effort-to-resist anchors", () => {
    for (const itemId of ["y4", "y9"]) {
      const options = ybocs.items.find((i) => i.id === itemId)?.options ?? [];
      expect(options.map((option) => [option.label, option.points])).toEqual([
        ["Always resists", 0],
        ["Resists most of the time", 1],
        ["Some effort to resist", 2],
        ["Yields, with some reluctance", 3],
        ["Completely yields", 4],
      ]);
    }
  });

  it("scores 0 when all symptoms are absent and control is complete", () => {
    const state = deriveCalculator(ybocs, baselineAnswers(ybocs));
    expect(state.score).toBe(0);
    expect(state.result.label).toBe("Subclinical");
  });

  it("scores 40 when all symptoms are extreme and control is absent", () => {
    const state = deriveCalculator(ybocs, maximalAnswers(ybocs));
    expect(state.score).toBe(40);
    expect(state.result.label).toBe("Extreme");
  });
});
