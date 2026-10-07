// Set up Work's progress model: what is stored, which steps a doctor sees, and
// how Continue, Skip, Back, Not now and Start again move the record. The model
// is pure, so these tests pin its behaviour without any browser.

import { describe, expect, it } from "vitest";

import {
  completeWorkSetupStep,
  countedWorkSetupSteps,
  dismissWorkSetup,
  goToWorkSetupStep,
  INITIAL_WORK_SETUP_PROGRESS,
  nextWorkSetupStep,
  parseWorkSetupProgress,
  previousWorkSetupStep,
  resolveWorkSetupStep,
  restartWorkSetup,
  serialiseWorkSetupProgress,
  setWorkSetupAreas,
  skipWorkSetupStep,
  visibleWorkSetupSteps,
  WORK_SETUP_AREAS,
  WORK_SETUP_STEPS,
  workSetupCount,
  workSetupCountLabel,
  workSetupPromptVisible,
  type WorkSetupProgress,
} from "@/lib/work-setup/progress";

function progress(overrides: Partial<WorkSetupProgress> = {}): WorkSetupProgress {
  return { ...INITIAL_WORK_SETUP_PROGRESS, status: "in-progress", ...overrides };
}

describe("parseWorkSetupProgress", () => {
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["empty string", ""],
    ["invalid JSON", "{not json"],
    ["JSON null", "null"],
    ["a number", "42"],
    ["a string", '"welcome"'],
    ["an array", "[1,2,3]"],
    ["no version", JSON.stringify({ status: "done", step: "alerts" })],
    ["a future version", JSON.stringify({ v: 2, status: "done", step: "alerts" })],
    ["a version as a string", JSON.stringify({ v: "1", status: "done", step: "alerts" })],
  ])("reads %s as a fresh start", (_label, raw) => {
    expect(parseWorkSetupProgress(raw)).toEqual(INITIAL_WORK_SETUP_PROGRESS);
  });

  it("replaces an unknown status and step with the defaults", () => {
    const parsed = parseWorkSetupProgress(
      JSON.stringify({ v: 1, status: "finished", step: "billing", areas: ["rost"], completed: [], skipped: [] }),
    );
    expect(parsed.status).toBe("new");
    expect(parsed.step).toBe("welcome");
    expect(parsed.areas).toEqual(["rost"]);
  });

  it("drops unknown areas and steps, removes repeats and puts them in walkthrough order", () => {
    const parsed = parseWorkSetupProgress(
      JSON.stringify({
        v: 1,
        status: "in-progress",
        step: "roster",
        areas: ["call", "rost", "billing", 7, "rost", null],
        completed: ["alerts", "stage", "nonsense", "stage", 3],
        skipped: ["roster", "areas", { step: "x" }],
      }),
    );
    expect(parsed.areas).toEqual(["rost", "call"]);
    expect(parsed.completed).toEqual(["stage", "alerts"]);
    expect(parsed.skipped).toEqual(["areas", "roster"]);
  });

  it("keeps every area when areas is missing or not a list, and none when it is an empty list", () => {
    expect(parseWorkSetupProgress(JSON.stringify({ v: 1, status: "in-progress" })).areas).toEqual(WORK_SETUP_AREAS);
    expect(parseWorkSetupProgress(JSON.stringify({ v: 1, areas: "rost" })).areas).toEqual(WORK_SETUP_AREAS);
    expect(parseWorkSetupProgress(JSON.stringify({ v: 1, areas: [] })).areas).toEqual([]);
  });

  it("treats non-list completed and skipped as empty", () => {
    const parsed = parseWorkSetupProgress(JSON.stringify({ v: 1, completed: "stage", skipped: { 0: "areas" } }));
    expect(parsed.completed).toEqual([]);
    expect(parsed.skipped).toEqual([]);
  });

  it("round-trips through serialiseWorkSetupProgress", () => {
    const original = progress({
      status: "in-progress",
      step: "rotation",
      areas: ["rost", "teach", "cpd"],
      completed: ["stage", "areas"],
      skipped: ["time-zone", "roster"],
    });
    const raw = serialiseWorkSetupProgress(original);
    expect(JSON.parse(raw)).toMatchObject({ v: 1 });
    expect(parseWorkSetupProgress(raw)).toEqual(original);
  });

  it("round-trips the initial record and a finished record", () => {
    expect(parseWorkSetupProgress(serialiseWorkSetupProgress(INITIAL_WORK_SETUP_PROGRESS))).toEqual(
      INITIAL_WORK_SETUP_PROGRESS,
    );
    const finished = progress({ status: "done", step: "done", completed: ["stage", "alerts"] });
    expect(parseWorkSetupProgress(serialiseWorkSetupProgress(finished))).toEqual(finished);
  });
});

describe("visible and counted steps", () => {
  it("shows every step when every area is chosen", () => {
    expect(visibleWorkSetupSteps(WORK_SETUP_AREAS)).toEqual(WORK_SETUP_STEPS);
  });

  it("hides the roster step without Roster", () => {
    const visible = visibleWorkSetupSteps(["teach", "cpd"]);
    expect(visible).not.toContain("roster");
    expect(visible).toContain("other-areas");
  });

  it("hides the other-areas step without CPD, Admin or On Call", () => {
    expect(visibleWorkSetupSteps(["rost", "teach", "assess"])).not.toContain("other-areas");
    for (const area of ["cpd", "admin", "call"] as const) {
      expect(visibleWorkSetupSteps([area])).toContain("other-areas");
    }
  });

  it("always shows rotation, and the framing steps, even with no areas", () => {
    expect(visibleWorkSetupSteps([])).toEqual(["welcome", "stage", "areas", "time-zone", "rotation", "alerts", "done"]);
  });

  it("counts only the steps between welcome and done", () => {
    expect(countedWorkSetupSteps(WORK_SETUP_AREAS)).toEqual([
      "stage",
      "areas",
      "time-zone",
      "roster",
      "rotation",
      "other-areas",
      "alerts",
    ]);
    expect(countedWorkSetupSteps([])).toEqual(["stage", "areas", "time-zone", "rotation", "alerts"]);
  });
});

describe("resolveWorkSetupStep", () => {
  it("keeps a visible step", () => {
    expect(resolveWorkSetupStep(progress({ step: "roster", areas: ["rost"] }))).toBe("roster");
  });

  it("moves a hidden step forward to the next visible one", () => {
    expect(resolveWorkSetupStep(progress({ step: "roster", areas: ["teach"] }))).toBe("rotation");
    expect(resolveWorkSetupStep(progress({ step: "other-areas", areas: ["rost"] }))).toBe("alerts");
  });
});

describe("next and previous", () => {
  it("skips hidden steps both ways", () => {
    const areas = ["teach"] as const;
    expect(nextWorkSetupStep("time-zone", areas)).toBe("rotation");
    expect(nextWorkSetupStep("rotation", areas)).toBe("alerts");
    expect(previousWorkSetupStep("rotation", areas)).toBe("time-zone");
    expect(previousWorkSetupStep("alerts", areas)).toBe("rotation");
  });

  it("ends at done and starts at welcome", () => {
    expect(nextWorkSetupStep("alerts", WORK_SETUP_AREAS)).toBe("done");
    expect(nextWorkSetupStep("done", WORK_SETUP_AREAS)).toBe("done");
    expect(previousWorkSetupStep("welcome", WORK_SETUP_AREAS)).toBeNull();
    expect(previousWorkSetupStep("stage", WORK_SETUP_AREAS)).toBe("welcome");
  });
});

describe("Continue and Skip", () => {
  it("Start on welcome moves to the first counted step without counting welcome", () => {
    const next = completeWorkSetupStep(INITIAL_WORK_SETUP_PROGRESS, "welcome");
    expect(next.step).toBe("stage");
    expect(next.status).toBe("in-progress");
    expect(next.completed).toEqual([]);
  });

  it("Continue marks the step completed and advances to the next visible step", () => {
    const next = completeWorkSetupStep(progress({ step: "time-zone", areas: ["teach"] }), "time-zone");
    expect(next.completed).toEqual(["time-zone"]);
    expect(next.step).toBe("rotation");
    expect(next.status).toBe("in-progress");
  });

  it("Skip marks the step skipped and advances to the next visible step", () => {
    const next = skipWorkSetupStep(progress({ step: "time-zone", areas: ["teach"] }), "time-zone");
    expect(next.skipped).toEqual(["time-zone"]);
    expect(next.completed).toEqual([]);
    expect(next.step).toBe("rotation");
  });

  it("finishing the last step sets status done", () => {
    expect(completeWorkSetupStep(progress({ step: "alerts" }), "alerts").status).toBe("done");
    expect(skipWorkSetupStep(progress({ step: "alerts" }), "alerts").status).toBe("done");
  });

  it("Continue on a skipped step moves it out of skipped", () => {
    const skipped = skipWorkSetupStep(progress({ step: "stage" }), "stage");
    const completed = completeWorkSetupStep(goToWorkSetupStep(skipped, "stage"), "stage");
    expect(completed.completed).toContain("stage");
    expect(completed.skipped).not.toContain("stage");
  });

  it("Skip on a completed step leaves it completed and not skipped", () => {
    const completed = completeWorkSetupStep(progress({ step: "stage" }), "stage");
    const skipped = skipWorkSetupStep(goToWorkSetupStep(completed, "stage"), "stage");
    expect(skipped.completed).toContain("stage");
    expect(skipped.skipped).not.toContain("stage");
  });

  it("a step is never both completed and skipped, whatever the sequence", () => {
    let state = progress();
    const actions = [
      (p: WorkSetupProgress) => skipWorkSetupStep(p, "stage"),
      (p: WorkSetupProgress) => completeWorkSetupStep(p, "stage"),
      (p: WorkSetupProgress) => skipWorkSetupStep(p, "stage"),
      (p: WorkSetupProgress) => skipWorkSetupStep(p, "areas"),
      (p: WorkSetupProgress) => skipWorkSetupStep(p, "areas"),
      (p: WorkSetupProgress) => completeWorkSetupStep(p, "areas"),
      (p: WorkSetupProgress) => completeWorkSetupStep(p, "areas"),
    ];
    for (const act of actions) {
      state = act(state);
      const both = state.completed.filter((step) => state.skipped.includes(step));
      expect(both).toEqual([]);
    }
    expect(state.completed).toEqual(["stage", "areas"]);
  });

  it("completing and skipping keep the lists in walkthrough order with no repeats", () => {
    let state = progress();
    state = completeWorkSetupStep(state, "alerts");
    state = completeWorkSetupStep(state, "stage");
    state = completeWorkSetupStep(state, "stage");
    state = skipWorkSetupStep(state, "rotation");
    state = skipWorkSetupStep(state, "areas");
    expect(state.completed).toEqual(["stage", "alerts"]);
    expect(state.skipped).toEqual(["areas", "rotation"]);
  });

  it("never records welcome or done as completed or skipped", () => {
    let state = completeWorkSetupStep(progress(), "welcome");
    state = skipWorkSetupStep(state, "welcome");
    state = completeWorkSetupStep(state, "done");
    state = skipWorkSetupStep(state, "done");
    expect(state.completed).toEqual([]);
    expect(state.skipped).toEqual([]);
  });
});

describe("goToWorkSetupStep", () => {
  it("moves without marking anything and starts a new walkthrough", () => {
    const moved = goToWorkSetupStep(INITIAL_WORK_SETUP_PROGRESS, "alerts");
    expect(moved.step).toBe("alerts");
    expect(moved.status).toBe("in-progress");
    expect(moved.completed).toEqual([]);
    expect(moved.skipped).toEqual([]);
  });

  it("reopens a dismissed walkthrough, but keeps a finished one finished", () => {
    expect(goToWorkSetupStep(progress({ status: "dismissed" }), "stage").status).toBe("in-progress");
    expect(goToWorkSetupStep(progress({ status: "done", step: "done" }), "stage").status).toBe("done");
  });

  it("going to done keeps the status as it was", () => {
    expect(goToWorkSetupStep(INITIAL_WORK_SETUP_PROGRESS, "done").status).toBe("new");
  });
});

describe("setWorkSetupAreas", () => {
  it("keeps only known areas, in the app's order, without repeats", () => {
    const next = setWorkSetupAreas(progress(), ["call", "rost", "call"]);
    expect(next.areas).toEqual(["rost", "call"]);
  });

  it("changes which steps count", () => {
    const next = setWorkSetupAreas(progress({ completed: ["stage", "roster"] }), ["teach"]);
    expect(workSetupCount(next)).toEqual({ done: 1, total: 5 });
  });
});

describe("workSetupCount", () => {
  it("counts finished steps, not skipped ones, out of the visible counted steps", () => {
    const state = progress({ areas: WORK_SETUP_AREAS, completed: ["stage", "roster"], skipped: ["areas"] });
    expect(workSetupCount(state)).toEqual({ done: 2, total: 7 });
  });

  it("labels the count in plain words", () => {
    expect(workSetupCountLabel(2, 7)).toBe("2 of 7 done");
  });

  it("ignores finished steps the doctor's areas now hide", () => {
    const state = progress({ areas: ["teach"], completed: ["stage", "roster", "other-areas"], skipped: [] });
    expect(workSetupCount(state)).toEqual({ done: 1, total: 5 });
  });

  it("is zero of total for a fresh start", () => {
    expect(workSetupCount(INITIAL_WORK_SETUP_PROGRESS)).toEqual({ done: 0, total: 7 });
  });
});

describe("the My Day prompt", () => {
  it("shows for new and in-progress, not for done or dismissed", () => {
    expect(workSetupPromptVisible(progress({ status: "new" }))).toBe(true);
    expect(workSetupPromptVisible(progress({ status: "in-progress" }))).toBe(true);
    expect(workSetupPromptVisible(progress({ status: "done" }))).toBe(false);
    expect(workSetupPromptVisible(progress({ status: "dismissed" }))).toBe(false);
  });

  it("Not now hides the prompt and keeps the place", () => {
    const state = progress({ step: "roster", completed: ["stage"] });
    const dismissed = dismissWorkSetup(state);
    expect(dismissed.status).toBe("dismissed");
    expect(dismissed.step).toBe("roster");
    expect(dismissed.completed).toEqual(["stage"]);
    expect(workSetupPromptVisible(dismissed)).toBe(false);
  });

  it("Not now leaves a finished walkthrough finished", () => {
    const finished = progress({ status: "done", step: "done" });
    expect(dismissWorkSetup(finished)).toBe(finished);
  });
});

describe("restartWorkSetup", () => {
  it("goes back to welcome with nothing marked, keeping the area choice", () => {
    const state = progress({
      status: "done",
      step: "done",
      areas: ["teach", "cpd"],
      completed: ["stage", "areas"],
      skipped: ["alerts"],
    });
    const restarted = restartWorkSetup(state);
    expect(restarted).toEqual({
      status: "in-progress",
      step: "welcome",
      areas: ["teach", "cpd"],
      completed: [],
      skipped: [],
    });
    expect(workSetupPromptVisible(restarted)).toBe(true);
  });
});
