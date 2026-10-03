"use client";

import { ClipboardList, FileText, GraduationCap, Hash, Users, type LucideIcon } from "lucide-react";
import Link from "next/link";

import { focusRing } from "@/components/card-recipes";
import { modePressable } from "@/components/mode-kit/recipes";
import { cn, eyebrowText } from "@/components/ui-primitives";

const ACTIONS: readonly { id: string; label: string; note: string; href: string; icon: LucideIcon }[] = [
  {
    id: "call",
    label: "Log a call",
    note: "Call log",
    href: "/on-call/call#on-call-call-log-heading",
    icon: ClipboardList,
  },
  {
    id: "handover",
    label: "Handover",
    note: "ISBAR builder",
    href: "/on-call/call#on-call-handover-heading",
    icon: FileText,
  },
  { id: "whos-on", label: "Who’s on", note: "Tonight’s team", href: "/on-call/whos-on", icon: Users },
  { id: "cpd", label: "Log CPD", note: "New entry", href: "/cme/new", icon: GraduationCap },
  { id: "numbers", label: "Numbers", note: "Pinned", href: "/admin/help", icon: Hash },
];

/**
 * Five quick actions in a sliding row of wide tiles, so each label fits on one
 * line: a tinted icon square, the label and a small note. The call log and
 * handover builder have no routes of their own, so those link to their headings
 * on the Call page. Static links; nothing is read or fetched.
 */
export function MyDayQuickActions() {
  return (
    <section className="grid min-w-0 gap-2" data-testid="my-day-module-quick-actions">
      <div className="flex items-baseline justify-between gap-3 px-3">
        <h2 className={eyebrowText}>Quick actions</h2>
        <span aria-hidden="true" className="text-xs text-[color:var(--text-muted)]">
          Slide for more ›
        </span>
      </div>
      <nav aria-label="Quick actions">
        <ul
          role="list"
          className="flex snap-x snap-mandatory gap-2 overflow-x-auto px-0.5 pb-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {ACTIONS.map(({ id, label, note, href, icon: Icon }) => (
            <li key={id} className="shrink-0 snap-start">
              <Link
                href={href}
                data-testid={`my-day-quick-${id}`}
                className={cn(
                  modePressable,
                  focusRing,
                  "flex min-h-13 items-center gap-2.5 whitespace-nowrap rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] py-2 pl-2 pr-3.5 text-sm-minus font-medium text-[color:var(--text-heading)] no-underline",
                )}
              >
                <span
                  aria-hidden="true"
                  className="grid size-9 shrink-0 place-items-center rounded-lg bg-[color:var(--mode-identity-soft)]"
                >
                  <Icon aria-hidden="true" className="size-icon-md text-[color:var(--mode-identity)]" />
                </span>
                <span className="grid">
                  {label}
                  <span className="text-xs font-normal text-[color:var(--text-muted)]">{note}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </section>
  );
}
