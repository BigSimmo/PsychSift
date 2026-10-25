import "server-only";

import { CME_MAX_ENTRIES, cmeRepositoryError } from "@/lib/cme/repository";
import { rowToCmePlanGoal, type CmePlanGoal } from "@/lib/cme/plan-goals";
import type { Json } from "@/lib/supabase/database.types";

type AdminClient = ReturnType<typeof import("@/lib/supabase/admin").createAdminClient>;

/**
 * Reads and writes for the development plan. Every read carries the owner
 * predicate on the same chain as `.from()` (`npm run check:owner-scope`), and
 * both writes go through database functions that take the owner lock and
 * refuse a closed year.
 */

export async function fetchOwnerCmePlanGoals(
  supabase: AdminClient,
  ownerId: string,
  yearId: string,
): Promise<CmePlanGoal[]> {
  if (!ownerId) throw new Error("Missing CME owner.");
  const { data, error } = await supabase
    .from("cme_plan_goals")
    .select("id, goal, sort_order")
    .eq("owner_id", ownerId)
    .eq("year_id", yearId)
    .order("sort_order", { ascending: true })
    .limit(CME_MAX_ENTRIES);
  if (error) throw cmeRepositoryError(error);
  return (data ?? []).map(rowToCmePlanGoal);
}

/**
 * Entry ids per lookup. Each id goes into the request URL, and a year may hold up to
 * `CME_MAX_ENTRIES` activities, so one filter for all of them could pass a gateway's URL limit.
 */
const ENTRY_GOAL_ID_BATCH_SIZE = 100;

/** Entry id -> goal id, for the given entries. */
export async function fetchOwnerCmeEntryGoals(
  supabase: AdminClient,
  ownerId: string,
  entryIds: readonly string[],
): Promise<Record<string, string>> {
  if (!ownerId) throw new Error("Missing CME owner.");
  if (entryIds.length === 0) return {};
  const batches: string[][] = [];
  for (let index = 0; index < entryIds.length; index += ENTRY_GOAL_ID_BATCH_SIZE) {
    batches.push(entryIds.slice(index, index + ENTRY_GOAL_ID_BATCH_SIZE));
  }
  const results = await Promise.all(
    batches.map((batch) =>
      supabase
        .from("cme_entry_goals")
        .select("entry_id, goal_id")
        .eq("owner_id", ownerId)
        .in("entry_id", batch)
        .limit(CME_MAX_ENTRIES),
    ),
  );
  const links: Record<string, string> = {};
  for (const { data, error } of results) {
    if (error) throw cmeRepositoryError(error);
    for (const row of data ?? []) links[row.entry_id] = row.goal_id;
  }
  return links;
}

export async function saveOwnerCmePlanGoals(
  supabase: AdminClient,
  ownerId: string,
  yearId: string,
  goals: readonly { id?: string; goal: string }[],
  expectedGoals: readonly { id: string; goal: string }[],
): Promise<CmePlanGoal[]> {
  if (!ownerId) throw new Error("Missing CME owner.");
  const params = {
    p_owner_id: ownerId,
    p_year_id: yearId,
    p_goals: goals.map((goal) => (goal.id ? { id: goal.id, goal: goal.goal } : { goal: goal.goal })) as Json,
  };
  const { data, error } = await supabase.rpc("cme_save_plan_goals_checked", {
    ...params,
    p_expected_goals: expectedGoals.map(({ id, goal }) => ({ id, goal })) as Json,
  });
  if (error) throw cmeRepositoryError(error);
  return ((data ?? []) as { id: string; goal: string; sortOrder: number }[]).map((goal) => ({
    id: goal.id,
    goal: goal.goal,
    sortOrder: goal.sortOrder,
  }));
}

/** Append one source-year goal to the confirmed next year without replacing its other goals. */
export async function carryOwnerCmePlanGoal(
  supabase: AdminClient,
  ownerId: string,
  sourceYear: number,
  goalId: string,
): Promise<{ goals: CmePlanGoal[]; carried: boolean }> {
  if (!ownerId) throw new Error("Missing CME owner.");
  const { data, error } = await supabase.rpc("cme_carry_plan_goal", {
    p_owner_id: ownerId,
    p_source_year: sourceYear,
    p_goal_id: goalId,
  });
  if (error) throw cmeRepositoryError(error);
  const result = data as { goals: { id: string; goal: string; sortOrder: number }[]; carried: boolean };
  return { goals: result.goals, carried: result.carried };
}

export async function setOwnerCmeEntryGoal(
  supabase: AdminClient,
  ownerId: string,
  entryId: string,
  goalId: string | null,
): Promise<void> {
  if (!ownerId) throw new Error("Missing CME owner.");
  const { error } = await supabase.rpc("cme_set_entry_goal", {
    p_owner_id: ownerId,
    p_entry_id: entryId,
    p_goal_id: goalId,
  });
  if (error) throw cmeRepositoryError(error);
}
