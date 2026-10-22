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

  it("uses one atomic RPC for production create, update and delete without separate table writes", async () => {
    const input = {
      label: "Written case",
      dueKind: "date" as const,
      dueFteMonths: null,
      dueOn: "2026-11-01",
      completedOn: null,
    };
    const rpc = vi.fn(async (_name: string, args: Record<string, unknown>) => ({
      data: args.p_operation === "delete" ? { deleted: true } : { id: args.p_id, ...(args.p_milestone as object) },
      error: null,
    }));
    const from = vi.fn();
    const client = { rpc, from } as never;
    const created = await createOwnerTrainingMilestone(client, OWNER_A, input);
    await updateOwnerTrainingMilestone(client, OWNER_A, created.id, input);
    await deleteOwnerTrainingMilestone(client, OWNER_A, created.id);
    expect(rpc.mock.calls.map(([, args]) => args.p_operation)).toEqual(["create", "update", "delete"]);
    expect(rpc.mock.calls.every(([, args]) => args.p_owner_id === OWNER_A)).toBe(true);
    expect(from).not.toHaveBeenCalled();
  });

  it("never falls back to separate writes after atomic mirror failure or an unapplied RPC", async () => {
    const from = vi.fn();
    const rpc = vi.fn(async () => ({ data: null, error: { message: "mirror failed", code: "23514" } }));
    await expect(
      createOwnerTrainingMilestone({ rpc, from } as never, OWNER_A, {
        label: "Written case",
        dueKind: "date",
        dueFteMonths: null,
        dueOn: "2026-11-01",
        completedOn: null,
      }),
    ).rejects.toThrow("CME storage operation failed");
    expect(from).not.toHaveBeenCalled();
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

    // Identity is the record id (CME writes mirror under the same id); a registrar record that only
    // shares a title is a different milestone and stays visible rather than being hidden.
    expect(merged).toHaveLength(3);
    expect(merged.map((m) => m.id)).toEqual([
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      sampleRegistrarRow.id,
      "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    ]);
    expect(
      mergeTrainingAndRegistrarMilestones([{ ...converted, label: "Renamed locally" }], [registrarRecord]),
    ).toHaveLength(1);
  });

  it("builds recorded registrar assessments from registrar_training_milestones and keeps not-recorded when empty", () => {
    expect(buildOwnerTrainingAssessments([], [])).toEqual({ status: "not-recorded" });

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
        {
          id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
          registrarId: OWNER_A,
          milestoneCode: "written-examination-eeeeeeee",
          milestoneTitle: "Written examination",
          stage: "stage_2",
          achievedAt: "2026-09-01T00:00:00Z",
          evidenceSummary: null,
        },
      ],
      "2026-10-17",
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
            wbasLogged: null,
            assessor: null,
            attainedOn: "2026-09-14",
          },
          {
            id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            title: "ST2.A2 Consultation-liaison assessment",
            wbasLogged: null,
            assessor: null,
            attainedOn: null,
          },
        ],
      },
    });
  });

  it("never shows generic milestones as EPAs and gives no deadline without a current rotation", () => {
    const generic = {
      id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      registrarId: OWNER_A,
      milestoneCode: "written-examination-eeeeeeee",
      milestoneTitle: "Written examination",
      stage: "stage_2" as const,
      achievedAt: "2026-09-01T00:00:00Z",
      evidenceSummary: null,
    };
    expect(buildOwnerTrainingAssessments([], [generic], "2026-10-17")).toEqual({ status: "not-recorded" });

    const epa = { ...generic, id: "ffffffff-ffff-4fff-8fff-ffffffffffff", milestoneCode: "st2-epa-3" };
    const past = {
      id: "rot-0",
      kind: "rotation" as const,
      label: "Old",
      startsOn: "2026-02-02",
      endsOn: "2026-08-02",
      fte: 1,
    };
    const result = buildOwnerTrainingAssessments([past], [generic, epa], "2026-10-17");
    expect(result).toMatchObject({ status: "recorded", registrar: { rotationEndsOn: null } });
    expect(result.status === "recorded" && result.view === "registrar" ? result.registrar.epas : []).toHaveLength(0);
  });

  it("counts only attainments inside the current rotation, including its start date", () => {
    const period = {
      id: "current",
      kind: "rotation" as const,
      label: "Current",
      startsOn: "2026-08-03",
      endsOn: "2027-01-31",
      fte: 1,
    };
    const dates = [
      "2026-08-02T12:00:00Z",
      "2026-08-03T00:00:00Z",
      "2026-10-18T00:00:00Z",
      null,
      "2026-08-02T20:00:00Z",
    ];
    const records = dates.map((achievedAt, i) => ({
      id: String(i),
      registrarId: OWNER_A,
      milestoneCode: `st2-epa-${i}`,
      milestoneTitle: "EPA",
      stage: "stage_2" as const,
      achievedAt,
      evidenceSummary: null,
    }));
    const result = buildOwnerTrainingAssessments([period], records, "2026-10-17");
    expect(result).toMatchObject({
      registrar: { epas: [{ id: "1" }, { id: "3" }, { id: "4", attainedOn: "2026-08-03" }] },
    });
  });

  it("edits and deletes a registrar-only milestone through the Training page's ID routes", async () => {
    const { supabase, chains } = fakeClient(
      [
        // update cme_training_milestones: no CME row
        { data: null, error: null },
        // update registrar_training_milestones in place
        { data: { ...sampleRegistrarRow, milestone_title: "Renamed", achieved_at: null }, error: null },
        // delete cme_training_milestones: no CME row
        { data: [], error: null },
        // delete registrar_training_milestones
        { data: [{ id: sampleRegistrarRow.id }], error: null },
      ],
      { registrarSync: true },
    );

    const updated = await updateOwnerTrainingMilestone(supabase, OWNER_A, sampleRegistrarRow.id, {
      label: "Renamed",
      dueKind: "date",
      dueFteMonths: null,
      dueOn: null,
      completedOn: null,
    });
    expect(updated).toMatchObject({ id: sampleRegistrarRow.id, label: "Renamed", completedOn: null });
    await expect(deleteOwnerTrainingMilestone(supabase, OWNER_A, sampleRegistrarRow.id)).resolves.toBeUndefined();

    const registrarChains = chains.filter((chain) => chain.table === "registrar_training_milestones");
    expect(registrarChains).toHaveLength(2);
    const updateStep = registrarChains[0]!.steps.find((step) => step.method === "update");
    expect(Object.keys(updateStep?.args[0] as object).sort()).toEqual([
      "achieved_at",
      "evidence_summary",
      "milestone_title",
    ]);
  });

  it("infers stage codes from milestone titles", () => {
    expect(inferRegistrarStage("Stage 1 orientation")).toBe("stage_1");
    expect(inferRegistrarStage("ST2 psychotherapy")).toBe("stage_2");
    expect(inferRegistrarStage("Stage 3 scholarly project")).toBe("stage_3");
    expect(inferRegistrarStage("Fellowship transition")).toBe("fellowship");
  });
});
