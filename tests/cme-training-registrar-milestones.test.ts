import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { PublicApiError } from "@/lib/http";
import { buildOwnerTrainingAssessments } from "@/lib/cme/training-assessments";
import {
  CME_TRAINING_MAX_ROWS,
  createOwnerRegistrarMilestone,
  createOwnerTrainingMilestone,
  deleteOwnerRegistrarMilestone,
  deleteOwnerTrainingMilestone,
  fetchOwnerRegistrarMilestones,
  inferRegistrarStage,
  mergeTrainingAndRegistrarMilestones,
  registrarMilestoneToTrainingMilestone,
  updateOwnerRegistrarMilestone,
  updateOwnerTrainingMilestone,
} from "@/lib/cme/training-repository";

type ChainStep = { method: string; args: unknown[] };
type QueuedResponse = { data?: unknown; error?: { message: string; code?: string } | null; count?: number | null };

function fakeClient(responses: QueuedResponse[], options?: { registrarSync?: boolean }) {
  const chains: { table: string; steps: ChainStep[] }[] = [];
  let index = 0;
  const next = (): QueuedResponse => responses[index++] ?? { data: [], error: null };

  const from = (table: string) => {
    const steps: ChainStep[] = [];
    chains.push({ table, steps });
    const record =
      (method: string) =>
      (...args: unknown[]) => {
        steps.push({ method, args });
        return builder;
      };
    const builder = {
      select: record("select"),
      insert: record("insert"),
      update: record("update"),
      delete: record("delete"),
      eq: record("eq"),
      order: record("order"),
      limit: record("limit"),
      single: () => Promise.resolve(next()),
      maybeSingle: () => Promise.resolve(next()),
      then: (resolve: (value: QueuedResponse) => unknown) => Promise.resolve(next()).then(resolve),
    };
    return builder;
  };

  return {
    supabase: (options?.registrarSync ? { from, registrarSync: true } : { from }) as never,
    chains,
  };
}

const OWNER_A = "11111111-1111-4111-8111-111111111111";

const sampleRegistrarRow = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  registrar_id: OWNER_A,
  milestone_code: "st2-psychotherapy-case",
  milestone_title: "Stage 2 psychotherapy written case",
  stage: "stage_2" as const,
  achieved_at: "2026-09-14T00:00:00Z",
  evidence_summary: "Due date: 2026-10-01",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-09-14T00:00:00Z",
};

describe("registrar_training_milestones repository & Training page integration (#XNAHY2)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("scopes fetchOwnerRegistrarMilestones to registrar_id", async () => {
    const { supabase, chains } = fakeClient([{ data: [sampleRegistrarRow], error: null }]);

    const rows = await fetchOwnerRegistrarMilestones(supabase, OWNER_A);

    expect(rows).toEqual([
      {
        id: sampleRegistrarRow.id,
        registrarId: OWNER_A,
        milestoneCode: "st2-psychotherapy-case",
        milestoneTitle: "Stage 2 psychotherapy written case",
        stage: "stage_2",
        achievedAt: "2026-09-14T00:00:00Z",
        evidenceSummary: "Due date: 2026-10-01",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-09-14T00:00:00Z",
      },
    ]);
    expect(chains).toHaveLength(1);
    expect(chains[0].table).toBe("registrar_training_milestones");
    expect(chains[0].steps).toContainEqual({ method: "eq", args: ["registrar_id", OWNER_A] });
    expect(chains[0].steps).toContainEqual({ method: "limit", args: [CME_TRAINING_MAX_ROWS] });
  });

  it("scopes create, update, and delete on registrar_training_milestones to registrar_id", async () => {
    const { supabase, chains } = fakeClient([
      // create count query
      { data: null, error: null, count: 0 },
      // create insert query
      { data: sampleRegistrarRow, error: null },
      // update query
      { data: { ...sampleRegistrarRow, achieved_at: "2026-10-01T00:00:00Z" }, error: null },
      // delete query
      { data: [{ id: sampleRegistrarRow.id }], error: null },
    ]);

    const created = await createOwnerRegistrarMilestone(supabase, OWNER_A, {
      milestoneCode: "st2-psychotherapy-case",
      milestoneTitle: "Stage 2 psychotherapy written case",
      stage: "stage_2",
      achievedAt: "2026-09-14T00:00:00Z",
      evidenceSummary: "Due date: 2026-10-01",
    });
    expect(created.stage).toBe("stage_2");

    const updated = await updateOwnerRegistrarMilestone(supabase, OWNER_A, sampleRegistrarRow.id, {
      milestoneCode: "st2-psychotherapy-case",
      milestoneTitle: "Stage 2 psychotherapy written case",
      stage: "stage_2",
      achievedAt: "2026-10-01T00:00:00Z",
      evidenceSummary: "Due date: 2026-10-01",
    });
    expect(updated.achievedAt).toBe("2026-10-01T00:00:00Z");

    await deleteOwnerRegistrarMilestone(supabase, OWNER_A, sampleRegistrarRow.id);

    expect(chains).toHaveLength(4);
    expect(chains[0].steps).toContainEqual({ method: "eq", args: ["registrar_id", OWNER_A] });
    expect(chains[1].steps).toContainEqual({
      method: "insert",
      args: [expect.objectContaining({ registrar_id: OWNER_A, stage: "stage_2" })],
    });
    expect(chains[2].steps).toContainEqual({ method: "eq", args: ["registrar_id", OWNER_A] });
    expect(chains[2].steps).toContainEqual({ method: "eq", args: ["id", sampleRegistrarRow.id] });
    expect(chains[3].steps).toContainEqual({ method: "eq", args: ["registrar_id", OWNER_A] });
    expect(chains[3].steps).toContainEqual({ method: "eq", args: ["id", sampleRegistrarRow.id] });
  });

  it("throws PublicApiError (404) when updating or deleting another registrar's milestone", async () => {
    const { supabase } = fakeClient([
      { data: null, error: null },
      { data: [], error: null },
    ]);

    await expect(
      updateOwnerRegistrarMilestone(supabase, OWNER_A, sampleRegistrarRow.id, {
        milestoneCode: "st2-psychotherapy-case",
        milestoneTitle: "Stage 2 psychotherapy written case",
        stage: "stage_2",
      }),
    ).rejects.toBeInstanceOf(PublicApiError);

    await expect(deleteOwnerRegistrarMilestone(supabase, OWNER_A, sampleRegistrarRow.id)).rejects.toMatchObject({
      status: 404,
    });
  });

  it("syncs cme_training_milestones writes into registrar_training_milestones with registrar_id scope", async () => {
    const cpdRow = {
      id: sampleRegistrarRow.id,
      owner_id: OWNER_A,
      label: "Stage 2 psychotherapy written case",
      due_kind: "date" as const,
      due_fte_months: null,
      due_on: "2026-10-01",
      completed_on: "2026-09-14",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-09-14T00:00:00Z",
    };

    const { supabase, chains } = fakeClient(
      [
        // createOwnerTrainingMilestone -> cme_training_milestones count
        { data: null, error: null, count: 0 },
        // createOwnerTrainingMilestone -> cme_training_milestones insert
        { data: cpdRow, error: null },
        // sync -> registrar_training_milestones insert
        { data: sampleRegistrarRow, error: null },
        // updateOwnerTrainingMilestone -> cme_training_milestones update
        { data: { ...cpdRow, completed_on: "2026-09-20" }, error: null },
        // sync -> registrar_training_milestones update
        { data: { ...sampleRegistrarRow, achieved_at: "2026-09-20T00:00:00.000Z" }, error: null },
        // deleteOwnerTrainingMilestone -> cme_training_milestones delete
        { data: [{ id: cpdRow.id }], error: null },
        // sync -> registrar_training_milestones delete
        { data: [{ id: cpdRow.id }], error: null },
      ],
      { registrarSync: true },
    );

    await createOwnerTrainingMilestone(supabase, OWNER_A, {
      label: cpdRow.label,
      dueKind: "date",
      dueFteMonths: null,
      dueOn: "2026-10-01",
      completedOn: "2026-09-14",
    });

    await updateOwnerTrainingMilestone(supabase, OWNER_A, cpdRow.id, {
      label: cpdRow.label,
      dueKind: "date",
      dueFteMonths: null,
      dueOn: "2026-10-01",
      completedOn: "2026-09-20",
    });

    await deleteOwnerTrainingMilestone(supabase, OWNER_A, cpdRow.id);

    const registrarChains = chains.filter((chain) => chain.table === "registrar_training_milestones");
    expect(registrarChains).toHaveLength(3);
    for (const chain of registrarChains) {
      const hasOwnerFilter = chain.steps.some(
        (step) => step.method === "eq" && step.args[0] === "registrar_id" && step.args[1] === OWNER_A,
      );
      expect(hasOwnerFilter).toBe(true);
    }
  });

  it("merges registrar_training_milestones with cme_training_milestones without duplicating matching items", () => {
    const registrarRecord = {
      id: sampleRegistrarRow.id,
      registrarId: OWNER_A,
      milestoneCode: "st2-psychotherapy-case",
      milestoneTitle: "Stage 2 psychotherapy written case",
      stage: "stage_2" as const,
      achievedAt: "2026-09-14T00:00:00Z",
      evidenceSummary: "Due date: 2026-10-01",
    };

    const converted = registrarMilestoneToTrainingMilestone(registrarRecord);
    expect(converted).toEqual({
      id: sampleRegistrarRow.id,
      label: "Stage 2 psychotherapy written case",
      dueKind: "date",
      dueFteMonths: null,
      dueOn: "2026-10-01",
      completedOn: "2026-09-14",
    });

    const merged = mergeTrainingAndRegistrarMilestones(
      [
        {
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          label: "Written examination",
          dueKind: "fte-months",
          dueFteMonths: 18,
          dueOn: null,
          completedOn: null,
        },
      ],
      [
        registrarRecord,
        {
          id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          registrarId: OWNER_A,
          milestoneCode: "written-exam",
          milestoneTitle: "Written examination",
          stage: "stage_2",
          achievedAt: null,
          evidenceSummary: null,
        },
      ],
    );

    expect(merged).toHaveLength(2);
    expect(merged.map((m) => m.label)).toEqual(["Written examination", "Stage 2 psychotherapy written case"]);
  });

  it("builds recorded registrar assessments from registrar_training_milestones and keeps not-recorded when empty", () => {
    expect(buildOwnerTrainingAssessments([], [], [])).toEqual({ status: "not-recorded" });

    const assessments = buildOwnerTrainingAssessments(
      [
        {
          id: "rot-1",
          kind: "rotation",
          label: "Adult inpatient",
          startsOn: "2026-08-03",
          endsOn: "2027-01-31",
          fte: 1,
        },
      ],
      [],
      [
        {
          id: sampleRegistrarRow.id,
          registrarId: OWNER_A,
          milestoneCode: "st2-epa-1",
          milestoneTitle: "ST2.A1 Acute inpatient care",
          stage: "stage_2",
          achievedAt: "2026-09-14T00:00:00Z",
          evidenceSummary: null,
        },
        {
          id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          registrarId: OWNER_A,
          milestoneCode: "st2-epa-2",
          milestoneTitle: "ST2.A2 Consultation-liaison assessment",
          stage: "stage_2",
          achievedAt: null,
          evidenceSummary: null,
        },
      ],
    );

    expect(assessments).toEqual({
      status: "recorded",
      view: "registrar",
      registrar: {
        rotationEndsOn: "2027-01-31",
        minimumEpas: 2,
        wbasPerEpa: 3,
        epas: [
          {
            id: sampleRegistrarRow.id,
            title: "ST2.A1 Acute inpatient care",
            wbasLogged: 3,
            assessor: null,
            attainedOn: "2026-09-14",
          },
          {
            id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            title: "ST2.A2 Consultation-liaison assessment",
            wbasLogged: 0,
            assessor: null,
            attainedOn: null,
          },
        ],
      },
    });
  });

  it("infers stage codes from milestone titles", () => {
    expect(inferRegistrarStage("Stage 1 orientation")).toBe("stage_1");
    expect(inferRegistrarStage("ST2 psychotherapy")).toBe("stage_2");
    expect(inferRegistrarStage("Stage 3 scholarly project")).toBe("stage_3");
    expect(inferRegistrarStage("Fellowship transition")).toBe("fellowship");
  });
});
