"use client";

/**
 * The walkthrough's one seam onto the settings the "Example data, setup and
 * time zone" thread owns. Every step reads them through here, so the walkthrough
 * never keeps a second copy of either setting.
 *
 * TEMPORARY until claude/example-data-setup-gy7wvd is merged under this branch:
 * `available: false` hides the example data choices (no dead control) and the
 * time zone step shows the default zone read-only. At merge this file becomes a
 * straight re-export of `useExampleData` (src/lib/example-data/store.ts) and
 * `useWorkTimeZone` (src/components/work-time/use-work-time-zone.ts).
 */

export type WorkSetupZone = { readonly id: string; readonly label: string; readonly short: string };

/** Mirrors WORK_TIME_ZONES in src/lib/work-time/zones.ts. */
const ZONES: readonly WorkSetupZone[] = [
  { id: "Australia/Perth", label: "Perth", short: "AWST" },
  { id: "Australia/Darwin", label: "Darwin", short: "ACST" },
  { id: "Australia/Adelaide", label: "Adelaide", short: "ACST" },
  { id: "Australia/Brisbane", label: "Brisbane", short: "AEST" },
  { id: "Australia/Sydney", label: "Sydney and Canberra", short: "AEST" },
  { id: "Australia/Melbourne", label: "Melbourne", short: "AEST" },
  { id: "Australia/Hobart", label: "Hobart", short: "AEST" },
];

export const DEFAULT_SETUP_ZONE = "Australia/Perth";

export type SetupExampleData = {
  /** False while the shared switch is not in this build: every example data choice stays hidden. */
  readonly available: boolean;
  readonly on: boolean;
  readonly turnOn: () => void;
  readonly turnOff: () => void;
};

export type SetupTimeZone = {
  /** False while the shared setting is not in this build: the zone is shown, not offered. */
  readonly available: boolean;
  readonly zone: string;
  readonly setZone: (id: string) => void;
  readonly zones: readonly WorkSetupZone[];
  readonly deviceZone: string | null;
  readonly differsFromDevice: boolean;
};

const noop = () => undefined;

export function useSetupExampleData(): SetupExampleData {
  return { available: false, on: false, turnOn: noop, turnOff: noop };
}

function deviceZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

export function useSetupTimeZone(): SetupTimeZone {
  const device = typeof window === "undefined" ? null : deviceZone();
  return {
    available: false,
    zone: DEFAULT_SETUP_ZONE,
    setZone: noop,
    zones: ZONES,
    deviceZone: device,
    differsFromDevice: device !== null && device !== DEFAULT_SETUP_ZONE,
  };
}

export function setupZoneLabel(zones: readonly WorkSetupZone[], id: string): string {
  return zones.find((zone) => zone.id === id)?.label ?? id.replace(/^.*\//, "").replace(/_/g, " ");
}
