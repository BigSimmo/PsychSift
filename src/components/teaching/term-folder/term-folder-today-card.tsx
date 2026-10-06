"use client";

import Link from "next/link";

import { focusRing } from "@/components/card-recipes";
import { FolderMeter } from "@/components/teaching/term-folder/term-folder-parts";
import { useTermFolder } from "@/components/teaching/term-folder/use-term-folder";
import { cn } from "@/components/ui-primitives";
import { TERM_FOLDER_PATH } from "@/lib/teaching/term-folder";

/*
 * A compact Today card for the shared frame: the current term's folder meter and one line, linking to the
 * folder. It renders nothing until the folder is ready, and nothing when no term is set up, so a Today page
 * never shows an empty shell.
 */
export function TermFolderTodayCard({ demoMode }: { demoMode: boolean }) {
  const view = useTermFolder(demoMode, null);
  if (view.kind !== "ready") return null;
  const { folder } = view;
  const toFix = folder.counts.to_fix;
  return (
    <Link
      href={TERM_FOLDER_PATH}
      data-mode-identity="teaching"
      data-testid="term-folder-today-card"
      className={cn(
        "grid min-h-12 gap-2 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-raised)] p-3.5 no-underline",
        focusRing,
      )}
    >
      <span className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold text-[color:var(--text-heading)]">{`${folder.title} folder`}</span>
        <span className="text-xs text-[color:var(--text-muted)]">
          {toFix ? `${toFix} to fix` : folder.loading ? "Filling" : folder.headline}
        </span>
      </span>
      <FolderMeter parts={folder.parts} counts={folder.counts} label={folder.meterLabel} />
    </Link>
  );
}
