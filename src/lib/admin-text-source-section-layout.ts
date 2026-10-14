/** Private, independently frozen layout; it declares source slices, never clinical authority. */
export type ManagedAdminTextSourceSectionLayout = Readonly<{
  sourceSha256: string;
  units: readonly Readonly<{
    sourceUnitId: string;
    headingByteStart: number | null;
    headingByteEnd: number | null;
  }>[];
}>;
