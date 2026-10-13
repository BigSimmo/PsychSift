"use client";

import { buttonFaceClass } from "@/components/ui/button-face";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Search } from "lucide-react";

import type { CompareStarterChip } from "@/components/compare/types";

export function CompareEmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
  chips,
}: {
  icon?: LucideIcon;
  title: string;
  description: string;
  actionLabel: string;
  onAction: () => void;
  chips?: readonly CompareStarterChip[];
}) {
  const EmptyIcon = Icon ?? Search;
  return (
    <section className="mt-5 grid justify-items-center rounded-xl border border-dashed border-[color:var(--border-strong)] bg-[color:var(--surface-inset)] px-4 py-12 text-center">
      <EmptyIcon className="size-icon-xl text-[color:var(--decoration-soft)]" aria-hidden="true" />
      <h2 className="mt-3 text-lg font-extrabold text-[color:var(--text-heading)]">{title}</h2>
      <p className="mt-1 max-w-lg text-sm text-[color:var(--text-muted)]">{description}</p>
      <button type="button" onClick={onAction} className={`mt-4 ${buttonFaceClass({ variant: "primary" })}`}>
        <Search className="size-icon-sm" aria-hidden="true" />
        {actionLabel}
      </button>
      {chips?.length ? (
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {chips.map((chip) => (
            <Link
              key={chip.id}
              href={chip.href}
              className="inline-flex min-h-tap items-center rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-3 text-xs font-bold"
            >
              {chip.label}
            </Link>
          ))}
        </div>
      ) : null}
    </section>
  );
}
