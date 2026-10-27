import type { applyPeopleChange } from "@/lib/work-roles/people";

/*
 * A small in-memory stand-in for the service-role client that the work-roles code uses. It applies
 * eq, is and in filters, updates and inserts, the one unique rule the migration keeps on hospitals
 * (no two open hospitals share a name, whatever the case), the database-owned revocation of
 * whole-team supervisors when a team moves hospital, and the `work_move_team_v1` and
 * `roster_set_manager` RPCs. Accounts in
 * `administrators` carry the site administrator claim. Synthetic ids only.
 */

type Row = Record<string, unknown>;
export type Tables = Record<string, Row[]>;
type QueryResult = { data: unknown; error: { code: string } | null };

export function fakeWorkRolesDb(tables: Tables, administrators: readonly string[]) {
  const state = { rpcUnavailable: false };
  const writes: { table: string; kind: "update" | "insert"; values: Row }[] = [];

  function nameTaken(table: string, values: Row, self: Row | null): boolean {
    if (table !== "work_hospitals" || typeof values.name !== "string") return false;
    const key = values.name.trim().toLowerCase();
    return (tables[table] ?? []).some(
      (row) => row !== self && row.archived_at == null && String(row.name).trim().toLowerCase() === key,
    );
  }

  function from(table: string) {
    const filters: ((row: Row) => boolean)[] = [];
    let mode: { kind: "select" } | { kind: "update"; values: Row } | { kind: "insert"; values: Row } = {
      kind: "select",
    };
    let single = false;
    let max = Infinity;

    function run(): QueryResult {
      const rows = (tables[table] ??= []);
      if (mode.kind === "insert") {
        if (nameTaken(table, mode.values, null)) return { data: null, error: { code: "23505" } };
        const row = { id: `new-${rows.length + 1}`, archived_at: null, ...mode.values };
        rows.push(row);
        writes.push({ table, kind: "insert", values: mode.values });
        return { data: single ? row : [row], error: null };
      }
      const matched = rows.filter((row) => filters.every((keep) => keep(row))).slice(0, max);
      if (mode.kind === "update") {
        for (const row of matched) {
          if (nameTaken(table, mode.values, row)) return { data: null, error: { code: "23505" } };
        }
        for (const row of matched) {
          const oldHospital = row.hospital_id;
          Object.assign(row, mode.values);
          // Model the database-owned atomic move/revocation contract. Actual trigger SQL
          // failure and concurrency are exercised separately on PostgreSQL.
          if (table === "work_hospital_teams" && oldHospital !== row.hospital_id) {
            for (const grant of tables.work_role_grants ?? []) {
              if (
                grant.role === "supervisor" &&
                grant.service_id === row.service_id &&
                grant.subject_user_id == null &&
                grant.revoked_at == null
              ) {
                grant.revoked_at = row.linked_at;
                grant.revoked_by = row.linked_by;
              }
            }
          }
        }
        writes.push({ table, kind: "update", values: mode.values });
      }
      return { data: single ? (matched[0] ?? null) : matched.map((row) => ({ ...row })), error: null };
    }

    const query = {
      select: () => query,
      order: () => query,
      limit: (n: number) => {
        max = n;
        return query;
      },
      eq: (column: string, value: unknown) => {
        filters.push((row) => row[column] === value);
        return query;
      },
      is: (column: string, value: unknown) => {
        filters.push((row) => (row[column] ?? null) === value);
        return query;
      },
      in: (column: string, values: unknown[]) => {
        filters.push((row) => values.includes(row[column]));
        return query;
      },
      update: (values: Row) => {
        mode = { kind: "update", values };
        return query;
      },
      insert: (values: Row) => {
        mode = { kind: "insert", values };
        return query;
      },
      single: () => {
        single = true;
        return query;
      },
      then: (resolve: (value: QueryResult) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve(run()).then(resolve, reject),
    };
    return query;
  }

  const client = {
    from,
    auth: {
      admin: {
        getUserById: async (id: string) => ({
          data: {
            user: {
              id,
              email: null,
              user_metadata: {},
              app_metadata: administrators.includes(id) ? { site_role: "administrator" } : {},
            },
          },
          error: null,
        }),
      },
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (state.rpcUnavailable) return { data: null, error: { code: "PGRST202", message: "Missing move RPC" } };
      if (name === "roster_set_manager") {
        // The RPC's own rules: the person must be an active member of the team, then upsert their role.
        const active = (tables.on_call_service_members ?? []).some(
          (row) => row.service_id === args.p_service_id && row.user_id === args.p_user_id && row.revoked_at == null,
        );
        if (!active) return { data: null, error: { code: "P0001", message: "roster_not_found" } };
        const rows = (tables.roster_member_roles ??= []);
        const role = args.p_manager === true ? "manager" : "member";
        const existing = rows.find((row) => row.service_id === args.p_service_id && row.user_id === args.p_user_id);
        if (existing) Object.assign(existing, { role, granted_by: args.p_actor_id, revoked_at: null });
        else rows.push({ service_id: args.p_service_id, user_id: args.p_user_id, role, granted_by: args.p_actor_id });
        return { data: { ok: true }, error: null };
      }
      if (name !== "work_move_team_v1") throw new Error("Unexpected RPC");
      const result = await from("work_hospital_teams")
        .update({ hospital_id: args.p_to_hospital_id, linked_by: args.p_actor_id, linked_at: new Date().toISOString() })
        .eq("service_id", args.p_service_id)
        .eq("hospital_id", args.p_expected_hospital_id)
        .select();
      return result.error ? result : { data: args.p_expected_hospital_id, error: null };
    },
  };
  return { client: client as unknown as Parameters<typeof applyPeopleChange>[0], tables, writes, state };
}
