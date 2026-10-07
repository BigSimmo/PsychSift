import type { OnCallEntry } from "@/lib/on-call/entry-model";

let counter = 0;

/** One valid entry, owned by the reader unless the test says otherwise. */
export function onCallEntryFixture(overrides: Partial<OnCallEntry> & Pick<OnCallEntry, "section">): OnCallEntry {
  counter += 1;
  return {
    // Outside the On Call demo corpus's fixed range (00000000-0000-4000-8000-), which the example data guards treat as made up.
    id: `00000000-0000-4000-9000-${String(counter).padStart(12, "0")}`,
    slug: `entry-${counter}`,
    title: `Entry ${counter}`,
    subtitle: null,
    body: null,
    details: {},
    linkedDocumentIds: [],
    tags: [],
    isPersonal: true,
    includeOnCard: false,
    sortOrder: 0,
    lastVerifiedAt: null,
    isOwn: true,
    ...overrides,
  };
}

/** A compliance requirement: a `logistics` row with `details.kind = "compliance"`. */
export function complianceFixture(
  title: string,
  details: Record<string, unknown>,
  overrides: Partial<OnCallEntry> = {},
): OnCallEntry {
  return onCallEntryFixture({ section: "logistics", title, details: { kind: "compliance", ...details }, ...overrides });
}
