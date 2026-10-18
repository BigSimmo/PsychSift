import { vi } from "vitest";

type Row = Record<string, unknown>;

/** Statement fake: applies scope predicates and the API row cap before JS filtering. */
export function documentMetadataFixture(
  tables: Record<string, Row[]>,
  options: { failedTable?: string; error?: unknown; onRead?: (table: string) => void } = {},
) {
  const queries: Array<{ table: string; filters: Array<[string, unknown]>; ranges: number[][] }> = [];
  const from = vi.fn((table: string) => {
    const filters: Array<[string, unknown]> = [];
    const ranges: number[][] = [];
    queries.push({ table, filters, ranges });
    let start = 0;
    let end = 999;
    let signal: AbortSignal | undefined;
    const orders: Array<{ column: string; ascending: boolean }> = [];
    const query = {
      select: () => query,
      in: (column: string, values: unknown[]) => {
        filters.push([`in:${column}`, values]);
        return query;
      },
      eq: (column: string, value: unknown) => {
        filters.push([column, value]);
        return query;
      },
      is: (column: string, value: unknown) => {
        filters.push([column, value]);
        return query;
      },
      or: (value: string) => {
        filters.push(["or", value]);
        return query;
      },
      order: (column: string, args?: { ascending?: boolean }) => {
        if (!orders.some((entry) => entry.column === column))
          orders.push({ column, ascending: args?.ascending !== false });
        return query;
      },
      range: (a: number, b: number) => {
        start = a;
        end = b;
        ranges.push([a, b]);
        return query;
      },
      abortSignal: (value: AbortSignal) => {
        signal = value;
        return query;
      },
      then: (resolve: (result: { data: Row[] | null; error: unknown }) => unknown) => {
        options.onRead?.(table);
        if (signal?.aborted) return Promise.resolve({ data: null, error: new Error("aborted") }).then(resolve);
        if (options.failedTable === table) return Promise.resolve({ data: null, error: options.error }).then(resolve);
        const rows = (tables[table] ?? [])
          .filter((row) =>
            filters.every(([column, value]) => {
              if (column.startsWith("in:")) return (value as unknown[]).includes(row[column.slice(3)]);
              if (column === "or") {
                const owner = String(value).match(/owner_id.eq.([^,]+)/)?.[1];
                return (
                  row.owner_id === owner ||
                  (row.owner_id === null &&
                    (!String(value).includes("public_corpus") || (row.metadata as Row)?.public_corpus === true))
                );
              }
              if (column === "metadata->>public_corpus") return String((row.metadata as Row)?.public_corpus) === value;
              return row[column] === value;
            }),
          )
          .sort((a, b) => {
            for (const { column, ascending } of orders) {
              const comparison = String(a[column] ?? "").localeCompare(String(b[column] ?? ""));
              if (comparison) return ascending ? comparison : -comparison;
            }
            return 0;
          });
        return Promise.resolve({ data: rows.slice(start, Math.min(end + 1, start + 1000)), error: null }).then(resolve);
      },
    };
    return query;
  });
  return { from, queries };
}
