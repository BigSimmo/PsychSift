/*
 * CPD work screens add no made-up records of their own: the demo year stays in `src/lib/cme/demo-year.ts`.
 * This file is the one door the shared example-data registry will replace: anything CPD builds from a
 * list to leave the page (the year's CSV) goes through `withoutExampleRecords` first.
 */

export const EXAMPLE_ID_PREFIX = "example:";

export function isExampleRecord(record: { readonly id: string }): boolean {
  return record.id.startsWith(EXAMPLE_ID_PREFIX);
}

/** Drops records whose id starts "example:" from anything that leaves the page. */
export function withoutExampleRecords<T extends { readonly id: string }>(records: readonly T[]): T[] {
  return records.filter((record) => !isExampleRecord(record));
}
