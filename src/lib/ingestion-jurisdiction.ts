/** Explicit source jurisdictions supported by administrator admission and inspection.
 * Country-level admission never establishes a state's catalogue authority. */
export const INGESTION_JURISDICTIONS = ["Australia", "Australia/WA"] as const;
export type IngestionJurisdiction = (typeof INGESTION_JURISDICTIONS)[number];

export function isIngestionJurisdiction(value: unknown): value is IngestionJurisdiction {
  return typeof value === "string" && INGESTION_JURISDICTIONS.some((jurisdiction) => jurisdiction === value);
}

export function matchesIngestionJurisdiction(declared: unknown, catalogue: unknown): boolean {
  return isIngestionJurisdiction(declared) && declared === catalogue;
}
