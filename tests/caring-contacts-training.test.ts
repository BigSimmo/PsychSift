import { describe, expect, it } from "vitest";

import { actorId } from "@/lib/caring-contacts/ids";
import {
  TRAINING_COMPETENCIES,
  emptyTrainingRecord,
  recordCompetency,
  trainingComplete,
  workspacesMayShareData,
} from "@/lib/caring-contacts/training";

describe("training mode", () => {
  it("names the seven required competencies", () => {
    expect(TRAINING_COMPETENCIES).toHaveLength(7);
    expect(new Set(TRAINING_COMPETENCIES).size).toBe(7);
  });

  it("is complete only when every competency is recorded", () => {
    let record = emptyTrainingRecord(actorId("A"));
    for (const competency of TRAINING_COMPETENCIES.slice(0, 6)) record = recordCompetency(record, competency);
    expect(trainingComplete(record)).toBe(false);
    record = recordCompetency(record, TRAINING_COMPETENCIES[6]);
    expect(trainingComplete(record)).toBe(true);
  });

  it("records a competency idempotently", () => {
    const once = recordCompetency(emptyTrainingRecord(actorId("A")), "activation");
    expect(recordCompetency(once, "activation").completed).toEqual(["activation"]);
  });

  it("never lets training data join a live query", () => {
    expect(workspacesMayShareData("live", "live")).toBe(true);
    expect(workspacesMayShareData("training", "live")).toBe(false);
    expect(workspacesMayShareData("live", "training")).toBe(false);
    expect(workspacesMayShareData("training", "training")).toBe(false);
  });
});
