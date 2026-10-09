"use client";

import { useCallback, useEffect, useState } from "react";

import { useWorkTimeZone } from "@/components/work-time/use-work-time-zone";
import { loadExampleDataset, type ExampleDatasetKey, type ExampleDatasets } from "@/lib/example-data/registry";

export type RegistryDatasetRead<K extends ExampleDatasetKey> =
  | { readonly status: "off" }
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly data: ExampleDatasets[K] }
  | { readonly status: "error"; readonly retry: () => void };

/**
 * One example dataset from the shared registry, for a work screen. Nothing loads (and nothing ships
 * to the reader) unless `active` is true, which is the area's example data switch. The registry's
 * loaders are local dynamic imports, so the only way this fails is a file that did not download
 * (offline before it was cached), which the screen offers to retry.
 */
export function useRegistryDataset<K extends ExampleDatasetKey>(key: K, active: boolean): RegistryDatasetRead<K> {
  const { zone } = useWorkTimeZone();
  const [attempt, setAttempt] = useState(0);
  const [read, setRead] = useState<{ key: string; data?: ExampleDatasets[K]; failed?: boolean } | null>(null);
  const token = `${key}:${zone}:${attempt}`;
  useEffect(() => {
    if (!active) return;
    let current = true;
    loadExampleDataset(key, new Date(), zone).then(
      (data) => {
        if (current) setRead({ key: token, data });
      },
      () => {
        if (current) setRead({ key: token, failed: true });
      },
    );
    return () => {
      current = false;
    };
  }, [active, key, zone, token]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  if (!active) return { status: "off" };
  if (read?.key !== token) return { status: "loading" };
  if (read.failed || read.data === undefined) return { status: "error", retry };
  return { status: "ready", data: read.data };
}
