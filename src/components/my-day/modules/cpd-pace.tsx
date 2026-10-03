"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { focusRing } from "@/components/card-recipes";
import { formatCmeHours } from "@/components/cme/cme-dashboard-next-step";
import { cn } from "@/components/ui-primitives";
import { cpdYearOf } from "@/lib/cme/cpd-year";
import { evaluateYear } from "@/lib/cme/evaluate";
import type { CmeEntry, CmeRequirementSet } from "@/lib/cme/types";
import { useAuthSession } from "@/lib/supabase/client";

type Loaded = { epoch: number; year: number; logged: number; target: number } | null;

async function readJson(url: string, signal: AbortSignal): Promise<Record<string, unknown> | null> {
  try {
    const response = await fetch(url, { cache: "no-store", signal });
    if (!response.ok) return null;
    return (await response.json().catch(() => null)) as Record<string, unknown> | null;
  } catch {
    return null;
  }
}

/**
 * One tile: CPD hours logged against the year's target. Reads the same two
 * routes the CPD page reads, keyed on the sign-in epoch and the CPD year (never
 * the minute clock). Renders nothing unless the year is confirmed and both
 * reads succeeded. No pace judgement is made here.
 */
export function MyDayCpdPace({ now }: { readonly now: Date }) {
  const { authEpoch } = useAuthSession();
  const year = cpdYearOf(now);
  const [loaded, setLoaded] = useState<Loaded>(null);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      readJson(`/api/cme/entries?year=${year}`, controller.signal),
      readJson(`/api/cme/year?year=${year}`, controller.signal),
    ]).then(([entriesBody, yearBody]) => {
      if (controller.signal.aborted) return;
      const entries = entriesBody?.entries;
      const set = yearBody?.requirementSet as CmeRequirementSet | null | undefined;
      if (!Array.isArray(entries) || !set || !(set.totalHours > 0)) {
        setLoaded(null);
        return;
      }
      const { totalHours } = evaluateYear({ set, entries: entries as CmeEntry[] });
      setLoaded({ epoch: authEpoch, year, logged: totalHours, target: set.totalHours });
    });
    return () => controller.abort();
  }, [authEpoch, year]);

  // Another account's (or year's) numbers are never shown.
  if (!loaded || loaded.epoch !== authEpoch || loaded.year !== year) return null;
  const fraction = Math.min(1, Math.max(0, loaded.logged / loaded.target));
  const logged = formatCmeHours(loaded.logged);
  const target = formatCmeHours(loaded.target);
  return (
    <Link
      href="/cme"
      data-testid="my-day-module-cpd"
      className={cn(
        focusRing,
        "grid min-h-12 min-w-0 content-start gap-1 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-2.5 no-underline",
      )}
    >
      <span className="sr-only">{`CPD: ${logged} of ${target} h this year`}</span>
      <span
        aria-hidden="true"
        className="font-mono text-xl font-semibold nums leading-tight text-[color:var(--text-heading)]"
      >
        {`${logged} of ${target} h`}
      </span>
      <span aria-hidden="true" className="text-sm-minus text-[color:var(--text-muted)]">
        CPD this year
      </span>
      <span aria-hidden="true" className="mt-1 h-1.5 overflow-hidden rounded-full bg-[color:var(--border)]">
        <span
          className="block h-full rounded-full bg-[color:var(--mode-identity)]"
          style={{ width: `${Math.round(fraction * 100)}%` }}
        />
      </span>
    </Link>
  );
}
