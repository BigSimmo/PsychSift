"use client";

import { ChevronDown, Search, X } from "lucide-react";
import { useId, useMemo, useState } from "react";

import { focusRing } from "@/components/card-recipes";
import { onCallChipShape, onCallChipTap } from "@/components/on-call/kit/calm";
import { modeSecondaryText } from "@/components/mode-kit/type";
import { Sheet } from "@/components/ui/sheet";
import { cn, eyebrowText } from "@/components/ui-primitives";
import { normalizeCode } from "@/lib/form-register";
import {
  onCallHandoverLegalGroups,
  onCallHandoverLegalStatusesMatching,
  onCallHandoverLegalTitle,
} from "@/lib/on-call/handover";

/*
 * LEGAL: a field that opens a bottom sheet of every form in the app's official
 * forms register (codes, titles and groups copied from it, nothing shortened),
 * with the two plain statuses a handover needs and the values already used this
 * shift. One tap picks and closes.
 */

/** The groups shown open first, as the owner's design does; every other category folds under "More forms". */
const OPEN_GROUPS = ["Inpatient treatment orders", "Referral and detention"] as const;

const codeBadge =
  "inline-flex min-h-7 min-w-9 shrink-0 items-center justify-center rounded-sm border border-[color:var(--border-strong)] px-1.5 text-xs font-semibold text-[color:var(--text-heading)] forced-colors:border";

function same(a: string, b: string): boolean {
  return normalizeCode(a) === normalizeCode(b);
}

/** The recent legal values as chips: one tap sets the field. */
export function OnCallLegalRecentChips({
  recent,
  value,
  onPick,
  testId,
}: {
  readonly recent: readonly string[];
  readonly value: string;
  readonly onPick: (value: string) => void;
  readonly testId: string;
}) {
  if (recent.length === 0) return null;
  return (
    <div
      className="flex min-w-0 flex-wrap items-center gap-x-1.5"
      role="group"
      aria-label="Recent"
      data-testid={testId}
    >
      <span aria-hidden="true" className={cn(eyebrowText, "mr-1")}>
        Recent
      </span>
      {recent.map((item) => (
        <button
          key={item}
          type="button"
          aria-pressed={same(item, value)}
          onClick={() => onPick(item)}
          className={cn(onCallChipTap, focusRing)}
        >
          <span className={onCallChipShape}>{item}</span>
        </button>
      ))}
    </div>
  );
}

/** The Legal field: the chosen code and its official title, or a prompt. Opens the picker. */
export function OnCallLegalField({
  value,
  recent,
  bedLabel,
  number,
  onChange,
}: {
  readonly value: string;
  readonly recent: readonly string[];
  /** "Bed 9", for the sheet's eyebrow. */
  readonly bedLabel: string;
  readonly number: number;
  readonly onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const labelId = useId();
  const title = onCallHandoverLegalTitle(value);
  return (
    <div className="grid min-w-0 gap-1.5">
      <FieldLabel number={number} id={labelId}>
        Legal
      </FieldLabel>
      <button
        type="button"
        aria-labelledby={labelId}
        aria-describedby={`${labelId}-value`}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className={cn(
          focusRing,
          "flex min-h-12 w-full min-w-0 items-center gap-3 rounded-md border border-[color:var(--border)] bg-[color:var(--surface-raised)] px-3 py-2 text-left forced-colors:border",
        )}
        data-testid="on-call-handover-legal"
      >
        <span id={`${labelId}-value`} className="flex min-w-0 flex-1 items-center gap-3">
          {value ? (
            <>
              {title ? <span className={codeBadge}>{value}</span> : null}
              <span className="min-w-0 flex-1 break-words text-base-minus text-[color:var(--text-heading)]">
                {title ?? value}
              </span>
            </>
          ) : (
            <span className="min-w-0 flex-1 text-base-minus text-[color:var(--text-muted)]">Choose legal status</span>
          )}
        </span>
        <ChevronDown aria-hidden="true" className="size-icon-sm shrink-0 text-[color:var(--text-muted)]" />
      </button>
      <OnCallLegalRecentChips recent={recent} value={value} onPick={onChange} testId="on-call-handover-legal-recent" />
      <OnCallLegalSheet
        open={open}
        onClose={() => setOpen(false)}
        value={value}
        recent={recent}
        eyebrow={[String(number), "Legal", bedLabel].filter(Boolean).join(" · ")}
        onPick={(next) => {
          onChange(next);
          setOpen(false);
        }}
      />
    </div>
  );
}

/** A numbered field label: "1  Bed & Ward", with an optional note at the right. */
export function FieldLabel({
  number,
  id,
  htmlFor,
  note,
  children,
}: {
  readonly number: number;
  readonly id?: string;
  readonly htmlFor?: string;
  readonly note?: string | null;
  readonly children: string;
}) {
  const Tag = htmlFor ? "label" : "span";
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-3">
      <Tag id={id} htmlFor={htmlFor} className="flex min-w-0 items-baseline gap-2.5">
        <span aria-hidden="true" className="nums w-3 shrink-0 text-xs text-[color:var(--text-muted)]">
          {number}
        </span>
        <span className="text-sm font-semibold text-[color:var(--text-heading)]">{children}</span>
      </Tag>
      {note ? <span className="shrink-0 text-xs font-medium text-[color:var(--text-muted)]">{note}</span> : null}
    </div>
  );
}

function PickRow({
  code,
  title,
  note,
  selected,
  onPick,
}: {
  readonly code?: string;
  readonly title: string;
  readonly note?: string;
  readonly selected: boolean;
  readonly onPick: () => void;
}) {
  return (
    <li className="border-b border-[color:var(--border)] last:border-b-0">
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        onClick={onPick}
        className={cn(
          focusRing,
          "flex min-h-12 w-full min-w-0 items-center gap-3 rounded-sm px-3 py-2 text-left",
          selected && "bg-[color:var(--surface-wash)]",
        )}
        data-testid="on-call-handover-legal-option"
      >
        {code ? <span className={codeBadge}>{code}</span> : null}
        <span className="grid min-w-0 flex-1">
          <span className="break-words text-sm font-semibold text-[color:var(--text-heading)]">{title}</span>
          {note ? <span className="text-xs text-[color:var(--text-muted)]">{note}</span> : null}
        </span>
        <span
          aria-hidden="true"
          className={cn(
            "grid size-5 shrink-0 place-items-center rounded-full border forced-colors:border",
            selected
              ? "border-[color:var(--text-heading)] bg-[color:var(--surface-raised)]"
              : "border-[color:var(--border-strong)]",
          )}
        >
          {selected ? <span className="size-2.5 rounded-full bg-[color:var(--text-heading)]" /> : null}
        </span>
      </button>
    </li>
  );
}

function GroupHeading({ children, count }: { readonly children: string; readonly count?: number }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-3 px-1 pb-1 pt-4">
      <h3 className={eyebrowText}>{children}</h3>
      {count !== undefined ? <span className={cn(eyebrowText, "nums")}>{count}</span> : null}
    </div>
  );
}

export function OnCallLegalSheet({
  open,
  onClose,
  value,
  recent,
  eyebrow,
  onPick,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly value: string;
  readonly recent: readonly string[];
  readonly eyebrow: string;
  readonly onPick: (value: string) => void;
}) {
  const [query, setQuery] = useState("");
  const searchId = useId();
  const statuses = useMemo(() => onCallHandoverLegalStatusesMatching(query), [query]);
  const groups = useMemo(() => onCallHandoverLegalGroups(query), [query]);
  const searching = query.trim() !== "";
  const openGroups = searching
    ? groups
    : OPEN_GROUPS.flatMap((name) => groups.filter((group) => group.category === name));
  const moreGroups = searching ? [] : groups.filter((group) => !OPEN_GROUPS.some((name) => name === group.category));
  const moreCount = moreGroups.reduce((total, group) => total + group.forms.length, 0);
  const close = () => {
    setQuery("");
    onClose();
  };
  const pick = (next: string) => {
    setQuery("");
    onPick(next);
  };
  const formRow = (form: { code: string; title: string }) => (
    <PickRow
      key={form.code}
      code={form.code}
      title={form.title}
      selected={same(form.code, value)}
      onPick={() => pick(form.code)}
    />
  );
  return (
    <Sheet
      open={open}
      onClose={close}
      title="Legal status"
      description={eyebrow}
      testId="on-call-handover-legal-sheet"
      mobileSize="viewport"
    >
      <div className="grid min-w-0 gap-1" data-mode-identity="on-call">
        <label htmlFor={searchId} className="sr-only">
          Search a code or words
        </label>
        <div className="relative">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 size-icon-sm -translate-y-1/2 text-[color:var(--text-muted)]"
          />
          <input
            id={searchId}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search a code or words"
            autoComplete="off"
            className={cn(
              focusRing,
              "min-h-12 w-full rounded-md border border-[color:var(--border)] bg-[color:var(--surface-wash)] pl-10 pr-3 text-base-minus text-[color:var(--text-heading)] placeholder:text-[color:var(--text-muted)] forced-colors:border",
            )}
            data-testid="on-call-handover-legal-search"
          />
        </div>
        {!searching ? (
          <div className="pt-1">
            <OnCallLegalRecentChips
              recent={recent}
              value={value}
              onPick={pick}
              testId="on-call-handover-legal-sheet-recent"
            />
          </div>
        ) : null}
        <div role="radiogroup" aria-label="Legal status" className="grid min-w-0">
          {statuses.length > 0 ? (
            <section aria-label="Status">
              <GroupHeading>Status</GroupHeading>
              <ul role="list">
                {statuses.map((status) => (
                  <PickRow key={status} title={status} selected={same(status, value)} onPick={() => pick(status)} />
                ))}
              </ul>
            </section>
          ) : null}
          {openGroups.map((group) => (
            <section key={group.category} aria-label={group.category}>
              <GroupHeading count={group.forms.length}>{group.category}</GroupHeading>
              <ul role="list">{group.forms.map(formRow)}</ul>
            </section>
          ))}
          {moreGroups.length > 0 ? (
            <section aria-label="More forms">
              <GroupHeading count={moreCount}>More forms</GroupHeading>
              <ul role="list">
                {moreGroups.map((group) => {
                  const holdsValue = group.forms.some((form) => same(form.code, value));
                  return (
                    <li key={group.category} className="border-b border-[color:var(--border)] last:border-b-0">
                      <details open={holdsValue || undefined} className="group/more">
                        <summary
                          className={cn(
                            focusRing,
                            "flex min-h-12 cursor-pointer list-none items-center gap-3 rounded-sm px-3 py-2 [&::-webkit-details-marker]:hidden",
                          )}
                        >
                          <span className="min-w-0 flex-1 text-sm text-[color:var(--text-heading)]">
                            {group.category}
                          </span>
                          <span className="nums text-xs font-semibold text-[color:var(--text-muted)]">
                            {group.forms.length}
                          </span>
                          <ChevronDown
                            aria-hidden="true"
                            className="size-icon-sm shrink-0 text-[color:var(--text-muted)] transition-transform group-open/more:rotate-180 motion-reduce:transition-none"
                          />
                        </summary>
                        <ul role="list" className="pl-2">
                          {group.forms.map(formRow)}
                        </ul>
                      </details>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}
          {searching && statuses.length === 0 && groups.length === 0 ? (
            <p className={cn(modeSecondaryText, "px-1 py-4")} role="status">
              No form or status matches &ldquo;{query.trim()}&rdquo;.
            </p>
          ) : null}
        </div>
        {value ? (
          <button
            type="button"
            onClick={() => pick("")}
            className={cn(
              focusRing,
              "mt-2 inline-flex min-h-12 items-center gap-2 justify-self-start rounded-sm px-1 text-sm font-semibold text-[color:var(--mode-identity)]",
            )}
            data-testid="on-call-handover-legal-clear"
          >
            <X aria-hidden="true" className="size-icon-sm" />
            Clear the legal status
          </button>
        ) : null}
        <p className={cn(modeSecondaryText, "px-1 pb-2 pt-3 text-center text-xs")}>
          Codes and titles from the app&apos;s official forms register
        </p>
      </div>
    </Sheet>
  );
}
