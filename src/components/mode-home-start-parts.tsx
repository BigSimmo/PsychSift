import { ChevronRight, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { type ReactNode } from "react";

import { cn, eyebrowText } from "@/components/ui-primitives";

/*
 * The row and group a Clinical mode home's start list is built from. Kept apart from the start
 * list itself so the lazily loaded favourites group can use them without an import cycle.
 */

const rowClass =
  "group grid min-h-12 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2 text-left text-[color:var(--text-heading)] transition-colors hover:bg-[color:var(--surface-subtle)] focus-visible:relative focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[color:var(--focus)] motion-reduce:transition-none";

/** One row: the record's icon, its own title and a chevron. 48 px tall at least. */
export function ModeHomeStartRow({ href, icon: Icon, title }: { href: string; icon: LucideIcon; title: string }) {
  return (
    <li className="min-w-0 border-t border-[color:var(--border)] first:border-t-0">
      <Link href={href} className={rowClass}>
        <Icon aria-hidden="true" className="size-icon-md shrink-0 text-[color:var(--text-muted)]" strokeWidth={2} />
        <span className="min-w-0 truncate text-sm font-medium leading-5">{title}</span>
        <ChevronRight aria-hidden="true" className="size-icon-sm shrink-0 text-[color:var(--decoration-soft)]" />
      </Link>
    </li>
  );
}

/** A labelled group: a quiet heading over a flat hairline card. */
export function ModeHomeStartGroup({
  id,
  title,
  testId,
  children,
}: {
  id: string;
  title: string;
  testId: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="grid min-w-0 content-start gap-2" data-testid={testId}>
      <h3 id={id} className={cn(eyebrowText, "px-1 text-left")}>
        {title}
      </h3>
      <ul
        role="list"
        className="grid min-w-0 overflow-hidden rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)]"
      >
        {children}
      </ul>
    </section>
  );
}
