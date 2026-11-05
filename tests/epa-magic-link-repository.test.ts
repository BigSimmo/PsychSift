import { describe, expect, it } from "vitest";

import { hashEpaMagicToken } from "@/lib/teaching/assessments/magic-link";
import {
  DurableEpaMagicLinkRepository,
  EPA_MAGIC_LINK_MAX_PENDING,
  type EpaMagicLinkRow,
} from "@/lib/teaching/assessments/magic-link-repository";

/** A tiny stand-in for the service-role client: filters rows the way PostgREST would. */
function fakeClient() {
  const rows: EpaMagicLinkRow[] = [];
  let nextId = 1;
  const query = (op: { kind: "select" | "update"; values?: Partial<EpaMagicLinkRow>; head?: boolean }) => {
    const filters: Array<(row: EpaMagicLinkRow) => boolean> = [];
    let limit = Infinity;
    let single = false;
    const ordering: { column: keyof EpaMagicLinkRow; ascending: boolean }[] = [];
    const run = () => {
      const matched = rows
        .filter((row) => filters.every((f) => f(row)))
        .sort((left, right) => {
          for (const { column, ascending } of ordering) {
            const a = String(left[column]),
              b = String(right[column]);
            const compared = a.localeCompare(b);
            if (compared) return ascending ? compared : -compared;
          }
          return 0;
        })
        .slice(0, limit);
      if (op.kind === "update") for (const row of matched) Object.assign(row, op.values);
      const data = single ? (matched[0] ? { ...matched[0] } : null) : matched.map((row) => ({ ...row }));
      return { data: op.head ? null : data, error: null, count: matched.length };
    };
    const builder = {
      eq: (column: keyof EpaMagicLinkRow, value: string) => (filters.push((r) => r[column] === value), builder),
      gt: (column: keyof EpaMagicLinkRow, value: string) => (filters.push((r) => String(r[column]) > value), builder),
      order: (column: keyof EpaMagicLinkRow, options?: { ascending?: boolean }) => (
        ordering.push({ column, ascending: options?.ascending ?? true }),
        builder
      ),
      or: (filter: string) => {
        const match = /^created_at\.lt\.([^,]+),and\(created_at\.eq\.([^,]+),id\.lt\.([^)]+)\)$/.exec(filter);
        if (!match) throw new Error("Unexpected cursor predicate");
        filters.push((row) => row.created_at < match[1]! || (row.created_at === match[2]! && row.id < match[3]!));
        return builder;
      },
      limit: (count: number) => ((limit = count), builder),
      select: () => builder,
      maybeSingle: () => ((single = true), builder),
      single: () => ((single = true), builder),
      then: (resolve: (value: ReturnType<typeof run>) => unknown) => Promise.resolve(run()).then(resolve),
    };
    return builder;
  };
  const client = {
    rpc: async (name: string, args: { p_registrar_id: string; p_link: Partial<EpaMagicLinkRow> }) => {
      if (name !== "teaching_create_epa_magic_link_v1") throw new Error("Unexpected RPC");
      const at = String(args.p_link.updated_at);
      if (
        rows.filter(
          (row) => row.registrar_id === args.p_registrar_id && row.status === "pending" && row.expires_at > at,
        ).length >= EPA_MAGIC_LINK_MAX_PENDING
      ) {
        return { data: null, error: { code: "P0001", message: "magic_link_limit_reached" } };
      }
      return client
        .from()
        .insert({ ...args.p_link, registrar_id: args.p_registrar_id } as never)
        .select()
        .single();
    },
    from: () => ({
      select: (_columns?: string, options?: { head?: boolean }) => query({ kind: "select", head: options?.head }),
      update: (values: Partial<EpaMagicLinkRow>) => query({ kind: "update", values }),
      insert: (values: Omit<EpaMagicLinkRow, "id" | "created_at" | "completed_at" | "revoked_at" | "response">) => ({
        select: () => ({
          single: () => {
            const row: EpaMagicLinkRow = {
              ...values,
              id: `00000000-0000-4000-8000-${String(nextId++).padStart(12, "0")}`,
              created_at: values.updated_at,
              completed_at: null,
              revoked_at: null,
              response: null,
            };
            rows.push(row);
            return Promise.resolve({ data: { ...row }, error: null });
          },
        }),
      }),
    }),
  };
  return { client, rows };
}

const NOW = new Date("2026-10-21T04:00:00Z");
const DOCTOR = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const input = { epaCode: 2, traineeName: "Dr Trainee Example", supervisorName: "Dr Visiting Example" } as const;
const answer = {
  level: "proximal",
  observed: "direct",
  strengths: "Clear formulation.",
  improvements: "Tighter risk summary.",
} as const;

describe("durable EPA feedback links (#MAAXAX)", () => {
  it("enforces the existing pending ceiling when concurrent preflights all observe room", async () => {
    const { client, rows } = fakeClient();
    const repo = new DurableEpaMagicLinkRepository(client);
    const results = await Promise.allSettled(
      Array.from({ length: EPA_MAGIC_LINK_MAX_PENDING + 1 }, () => repo.create(DOCTOR, input, NOW)),
    );
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(EPA_MAGIC_LINK_MAX_PENDING);
    expect(results.filter((result) => result.status === "rejected")).toEqual([
      expect.objectContaining({ reason: expect.objectContaining({ code: "magic_link_limit_reached" }) }),
    ]);
    expect(rows).toHaveLength(EPA_MAGIC_LINK_MAX_PENDING);
  });

  it("keeps older active links cancellable while owner history pages without loss or duplication", async () => {
    const { client, rows } = fakeClient();
    const repo = new DurableEpaMagicLinkRepository(client);
    const made = await repo.create(DOCTOR, input, NOW);
    const template = { ...rows[0]! };
    for (let index = 1; index <= 121; index += 1)
      rows.push({
        ...template,
        id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        token_hash: String(index).padStart(64, "0"),
        status: "completed",
        completed_at: NOW.toISOString(),
        response: { ...answer, complexity: null, assessorName: "Dr Synthetic Example", submittedAt: NOW.toISOString() },
        created_at: "2026-10-22T00:00:00.000Z",
      });
    rows.push({ ...template, id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", registrar_id: OTHER });
    const first = await repo.listForRegistrarPage(DOCTOR, NOW);
    expect(first.links).toContainEqual(expect.objectContaining({ id: made.link.id, status: "pending" }));
    expect(first.links.length).toBeLessThanOrEqual(51);
    expect(first.nextCursor).toEqual(expect.any(String));
    const found = new Map(first.links.map((link) => [link.id, link]));
    let cursor = first.nextCursor;
    while (cursor) {
      const page = await repo.listForRegistrarPage(DOCTOR, NOW, cursor);
      for (const link of page.links) found.set(link.id, link);
      cursor = page.nextCursor;
    }
    expect(found.size).toBe(122);
    expect(found.has("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee")).toBe(false);
    expect(JSON.stringify([...found.values()])).not.toContain("token_hash");
    expect(await repo.revoke(DOCTOR, made.link.id, NOW)).toBe(true);
  });

  it("rejects malformed history cursors before issuing a query", async () => {
    const { client } = fakeClient();
    await expect(
      new DurableEpaMagicLinkRepository(client).listForRegistrarPage(DOCTOR, NOW, "invalid,(filter)"),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("stores only the token's hash, expires in 14 days, and shows the link only to its doctor", async () => {
    const { client, rows } = fakeClient();
    const repo = new DurableEpaMagicLinkRepository(client);
    const made = await repo.create(DOCTOR, input, NOW);
    expect(made.urlPath).toBe(`/teaching/assessments/respond/${made.token}`);
    expect(rows[0]!.token_hash).toBe(hashEpaMagicToken(made.token));
    expect(JSON.stringify(rows)).not.toContain(made.token);
    expect(rows[0]!.expires_at).toBe("2026-11-04T04:00:00.000Z");
    expect(await repo.listForRegistrar(DOCTOR, NOW)).toHaveLength(1);
    expect(await repo.listForRegistrar(OTHER, NOW)).toEqual([]);
    expect(JSON.stringify(await repo.listForRegistrar(DOCTOR, NOW))).not.toContain(rows[0]!.token_hash);
  });

  it("gives the supervisor's page no ids, hash or account details", async () => {
    const { client, rows } = fakeClient();
    const repo = new DurableEpaMagicLinkRepository(client);
    const made = await repo.create(DOCTOR, input, NOW);
    const found = await repo.lookup(made.token, NOW);
    expect(found.ok).toBe(true);
    const shown = JSON.stringify(found.ok ? found.request : null);
    expect(shown).not.toContain(rows[0]!.token_hash);
    expect(shown).not.toContain(DOCTOR);
    expect(shown).not.toContain(rows[0]!.id);
  });

  it("accepts one answer only, and refuses patient details", async () => {
    const { client } = fakeClient();
    const repo = new DurableEpaMagicLinkRepository(client);
    const made = await repo.create(DOCTOR, input, NOW);
    const leaked = await repo.submit(made.token, { ...answer, strengths: "Saw Mr John Smith, URN 1234567" }, NOW);
    expect(leaked).toMatchObject({ ok: false, status: 400 });
    // The assessor's "how you know" declaration is required, never assumed to be "directly observed".
    const undeclared = { level: answer.level, strengths: answer.strengths, improvements: answer.improvements };
    expect(await repo.submit(made.token, undeclared, NOW)).toMatchObject({
      ok: false,
      status: 400,
      code: "invalid_submission",
    });
    expect(await repo.submit(made.token, answer, NOW)).toMatchObject({ ok: true });
    expect(await repo.submit(made.token, answer, NOW)).toMatchObject({ ok: false, code: "magic_link_already_used" });
    const [link] = await repo.listForRegistrar(DOCTOR, NOW);
    expect(link).toMatchObject({ status: "completed", submission: { level: "proximal" } });
  });

  it("refuses an expired, cancelled or unknown link, and only the owner can cancel", async () => {
    const { client } = fakeClient();
    const repo = new DurableEpaMagicLinkRepository(client);
    const made = await repo.create(DOCTOR, input, NOW);
    const later = new Date("2026-11-05T00:00:00Z");
    expect(await repo.submit(made.token, answer, later)).toMatchObject({ ok: false, code: "magic_link_expired" });
    expect(await repo.revoke(OTHER, made.link.id, NOW)).toBe(false);
    expect(await repo.revoke(DOCTOR, made.link.id, NOW)).toBe(true);
    expect(await repo.lookup(made.token, NOW)).toMatchObject({ ok: false, code: "magic_link_revoked" });
    expect(await repo.lookup("x".repeat(40), NOW)).toMatchObject({ ok: false, code: "magic_link_not_found" });
    expect(await repo.lookup("short", NOW)).toMatchObject({ ok: false, code: "magic_link_not_found" });
  });

  it(`caps a doctor at ${EPA_MAGIC_LINK_MAX_PENDING} waiting links`, async () => {
    const { client } = fakeClient();
    const repo = new DurableEpaMagicLinkRepository(client);
    for (let i = 0; i < EPA_MAGIC_LINK_MAX_PENDING; i += 1) await repo.create(DOCTOR, input, NOW);
    await expect(repo.create(DOCTOR, input, NOW)).rejects.toMatchObject({ code: "magic_link_limit_reached" });
    await expect(repo.create(OTHER, input, NOW)).resolves.toBeTruthy();
  });
});
