"use client";

/**
 * The walkthrough's one seam onto the settings the "Example data, setup and
 * time zone" thread owns. Every step reads them through here, so the walkthrough
 * never keeps a second copy of either setting.
 */

import { useWorkTimeZoneControl } from "@/components/work-time/use-work-time-zone";
import { useExampleData } from "@/lib/example-data/store";
import { DEFAULT_WORK_TIME_ZONE, type WorkTimeZoneOption } from "@/lib/work-time/zones";

export type WorkSetupZone = WorkTimeZoneOption;

export const DEFAULT_SETUP_ZONE = DEFAULT_WORK_TIME_ZONE;

export type SetupExampleData = {
  readonly available: boolean;
  readonly on: boolean;
  readonly turnOn: () => void;
  readonly turnOff: () => void;
};

export type SetupTimeZone = {
  readonly available: boolean;
  readonly zone: string;
  readonly setZone: (id: string) => void;
  readonly zones: readonly WorkSetupZone[];
  readonly deviceZone: string | null;
  readonly differsFromDevice: boolean;
};

export function useSetupExampleData(): SetupExampleData {
  const { on, turnOn, turnOff } = useExampleData();
  return { available: true, on, turnOn, turnOff };
}

export function useSetupTimeZone(): SetupTimeZone {
  const { zone, setZone, zones, deviceZone, differsFromDevice } = useWorkTimeZoneControl();
  return { available: true, zone, setZone, zones, deviceZone, differsFromDevice };
}

export function setupZoneLabel(zones: readonly WorkSetupZone[], id: string): string {
  return zones.find((zone) => zone.id === id)?.label ?? id.replace(/^.*\//, "").replace(/_/g, " ");
}
