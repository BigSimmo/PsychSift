import { ChevronRight, ExternalLink, FileSearch, Landmark, ReceiptText, type LucideIcon } from "lucide-react";
import Link from "next/link";

import { focusRing } from "@/components/card-recipes";
import { cn } from "@/components/ui-primitives";
import { appModeHomeHref } from "@/lib/app-modes";
import { WA_FORMULARY_HREF, pbsSearchHref } from "@/lib/medicines-references";

/**
 * "Where it stands" (Medicines mock-up, 5 Oct 2026): the three ward questions
 * about a medicine, answered by the publisher that owns each answer.
 *
 * PsychSift states none of the answers. Each row opens the place that does:
 * the WA Statewide Medicines Formulary (read through Formulary One), a PBS
 * Schedule search for this medicine, and a search of the clinician's own
 * document library. No formulary status or PBS listing type is written here,
 * so there is nothing to go stale or need sign-off. Blue and neutral only:
 * green, amber and red mean source status on clinical pages.
 */

interface StandRow {
  readonly id: string;
  readonly label: string;
  readonly action: string;
  readonly href: string;
  readonly external: boolean;
  readonly icon: LucideIcon;
}

function standRows(medicineName: string): readonly StandRow[] {
  return [
    {
      id: "formulary",
      label: "WA formulary",
      action: "Check in Formulary One",
      href: WA_FORMULARY_HREF,
      external: true,
      icon: Landmark,
    },
    {
      id: "pbs",
      label: "PBS listing",
      action: "Search the PBS Schedule",
      href: pbsSearchHref(medicineName),
      external: true,
      icon: ReceiptText,
    },
    {
      id: "local",
      label: "Local guideline",
      action: "Search your documents",
      href: appModeHomeHref("documents", { query: medicineName, run: true }),
      external: false,
      icon: FileSearch,
    },
  ];
}

const rowClass = cn(
  focusRing,
  "grid min-h-14 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2 text-[color:var(--text-heading)] no-underline",
);

function RowBody({ row }: { readonly row: StandRow }) {
  const RowIcon = row.icon;
  return (
    <>
      <span
        aria-hidden="true"
        className="grid size-9 shrink-0 place-items-center rounded-full bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)] forced-colors:border"
      >
        <RowIcon aria-hidden="true" className="size-icon-sm" />
      </span>
      <span className="grid min-w-0 gap-0.5">
        <span className="text-2xs font-semibold uppercase tracking-eyebrow text-[color:var(--text-muted)]">
          {row.label}
        </span>
        <span className="break-words text-sm font-semibold leading-snug">{row.action}</span>
      </span>
      {row.external ? (
        <>
          <ExternalLink aria-hidden="true" className="size-icon-sm text-[color:var(--text-muted)]" />
          <span className="sr-only">(opens in a new tab)</span>
        </>
      ) : (
        <ChevronRight aria-hidden="true" className="size-icon-sm text-[color:var(--text-muted)]" />
      )}
    </>
  );
}

export function MedicationWhereItStands({ medicineName }: { readonly medicineName: string }) {
  return (
    <section
      aria-labelledby="medication-where-it-stands-heading"
      data-testid="medication-where-it-stands"
      className="overflow-hidden rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-raised)] shadow-[var(--e2)]"
    >
      <h2
        id="medication-where-it-stands-heading"
        className="border-b border-[color:var(--border)] px-3 py-2 text-sm-minus font-semibold text-[color:var(--text-heading)]"
      >
        Where it stands
      </h2>
      <ul role="list" className="grid divide-y divide-[color:var(--border)] sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        {standRows(medicineName).map((row) => (
          <li key={row.id} className="min-w-0">
            {row.external ? (
              <a
                href={row.href}
                target="_blank"
                rel="noopener noreferrer"
                data-testid={`medication-stands-${row.id}`}
                className={rowClass}
              >
                <RowBody row={row} />
              </a>
            ) : (
              <Link href={row.href} data-testid={`medication-stands-${row.id}`} className={rowClass}>
                <RowBody row={row} />
              </Link>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
