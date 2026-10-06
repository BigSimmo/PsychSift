"use client";

/**
 * Design-scratch: the recommended Show all chip (soft fill + compact well)
 * plus two polished alternatives. Shared mockup chrome is suppressed so each
 * frame’s own top bar is the only header.
 */

import { Calculator, ChevronDown, Menu, MessageSquarePlus, Plus, Search, type LucideIcon } from "lucide-react";
import { type FormEvent, useState } from "react";

import { cn } from "@/components/ui-primitives";

import { calculators } from "./calculator-fixtures";

const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]";

type ButtonStyle = "recommended" | "soft" | "quiet";

const shortcuts = calculators.slice(0, 8).map((calc) => ({
  id: calc.id,
  label: calc.abbrev === "AUDIT-C" ? "AUDIT" : calc.abbrev === "SAD PERSONS" ? "SAD" : calc.abbrev,
  icon: calc.icon,
}));

const styles: Array<{ id: ButtonStyle; number: string; name: string; note: string }> = [
  { id: "recommended", number: "01", name: "Recommended", note: "Soft tint + hairline well · 36px capsule · 48px tap" },
  { id: "soft", number: "02", name: "Soft capsule", note: "Option 2 polished · no well · optical padding" },
  { id: "quiet", number: "03", name: "Quiet well", note: "Option 3 polished · well only · no pill fill" },
];

function ShowAllButton({ style, pressed, onPress }: { style: ButtonStyle; pressed: boolean; onPress: () => void }) {
  const label = "Show all";
  const hitArea = cn(
    "group inline-flex min-h-tap items-center justify-center text-[color:var(--clinical-accent)]",
    focusRing,
  );

  if (style === "soft") {
    return (
      <button
        type="button"
        onClick={onPress}
        aria-pressed={pressed}
        aria-label="Show all calculators"
        className={hitArea}
      >
        <span
          className={cn(
            "inline-flex h-9 items-center justify-center gap-1.5 rounded-full bg-[color:color-mix(in_srgb,var(--clinical-accent)_14%,var(--surface))] pl-3.5 pr-4 text-xs font-semibold tracking-[-0.01em]",
            pressed && "bg-[color:color-mix(in_srgb,var(--clinical-accent)_22%,var(--surface))]",
          )}
        >
          <Calculator className="size-icon-sm" strokeWidth={1.75} aria-hidden="true" />
          {label}
        </span>
      </button>
    );
  }

  if (style === "quiet") {
    return (
      <button
        type="button"
        onClick={onPress}
        aria-pressed={pressed}
        aria-label="Show all calculators"
        className={hitArea}
      >
        <span
          className={cn(
            "inline-flex h-9 items-center gap-2 rounded-full pr-1 text-xs font-semibold tracking-[-0.01em]",
            pressed && "text-[color:var(--clinical-accent)]",
          )}
        >
          <span
            className={cn(
              "grid size-7 shrink-0 place-items-center rounded-full bg-[color:var(--clinical-accent-soft)]",
              pressed && "bg-[color:color-mix(in_srgb,var(--clinical-accent-soft)_78%,var(--clinical-accent))]",
            )}
          >
            <Calculator className="size-icon-sm" strokeWidth={1.75} aria-hidden="true" />
          </span>
          {label}
        </span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onPress}
      aria-pressed={pressed}
      aria-label="Show all calculators"
      className={hitArea}
    >
      <span
        className={cn(
          "inline-flex h-9 items-center gap-1.5 rounded-full border border-[color:var(--clinical-accent-border)] bg-[color:color-mix(in_srgb,var(--clinical-accent)_14%,var(--surface))] pl-1 pr-3 text-xs font-semibold tracking-[-0.01em]",
          pressed && "bg-[color:color-mix(in_srgb,var(--clinical-accent)_22%,var(--surface))]",
        )}
      >
        <span className="grid size-7 shrink-0 place-items-center rounded-full border border-[color:var(--clinical-accent-border)] bg-[color:var(--surface)] shadow-[var(--shadow-inset)]">
          <Calculator className="size-icon-sm" strokeWidth={1.75} aria-hidden="true" />
        </span>
        {label}
      </span>
    </button>
  );
}

function PhoneChrome() {
  return (
    <header className="grid h-12 shrink-0 grid-cols-[2.5rem_minmax(0,1fr)_2.5rem] items-center gap-2 border-b border-[color:var(--border)] bg-[color:var(--surface-lux)] px-3">
      <span className="grid size-10 place-items-center text-[color:var(--text-heading)]">
        <Menu className="size-icon-lg" strokeWidth={1.75} aria-hidden="true" />
      </span>
      <span className="inline-flex h-9 min-w-0 items-center justify-center gap-1.5 rounded-full border border-[color:var(--border)] bg-[color:var(--surface)] px-3 text-xs font-semibold text-[color:var(--text)]">
        <Calculator
          className="size-icon-sm text-[color:var(--clinical-accent)]"
          strokeWidth={1.75}
          aria-hidden="true"
        />
        <span className="truncate">Calculators</span>
        <ChevronDown className="size-icon-sm shrink-0 text-[color:var(--text-soft)]" aria-hidden="true" />
      </span>
      <span className="grid size-10 place-items-center text-[color:var(--text-muted)]">
        <MessageSquarePlus className="size-icon-lg" strokeWidth={1.75} aria-hidden="true" />
      </span>
    </header>
  );
}

function PhoneHome({ style }: { style: ButtonStyle }) {
  const [query, setQuery] = useState("");
  const [pressed, setPressed] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const meta = styles.find((item) => item.id === style);

  return (
    <figure className="m-0 w-full max-w-[24.375rem]">
      <figcaption className="mb-2 grid gap-0.5">
        <span className="text-3xs font-extrabold uppercase tracking-[0.12em] text-[color:var(--text-soft)]">
          {meta?.number} {meta?.name}
        </span>
        <span className="text-2xs font-medium text-[color:var(--text-muted)]">{meta?.note}</span>
      </figcaption>
      <div
        data-testid={`calculators-show-all-frame-${style}`}
        className="flex h-[44rem] flex-col overflow-hidden rounded-[1.35rem] border border-[color:var(--border-lux)] bg-[color:var(--background)] shadow-[var(--e2)]"
      >
        <PhoneChrome />
        <div className="grid justify-items-center gap-2.5 overflow-y-auto px-4 pb-6 pt-5">
          <div className="grid justify-items-center gap-2.5 text-center">
            <span className="grid size-hero-medallion place-items-center rounded-2xl border border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)] shadow-[var(--shadow-inset)]">
              <Calculator className="size-icon-xl" strokeWidth={1.75} aria-hidden="true" />
            </span>
            <div className="grid gap-1">
              <h2 className="text-balance text-hero font-semibold leading-display tracking-normal text-[color:var(--text-heading)]">
                Calculators
              </h2>
              <p className="text-pretty text-sm font-medium leading-5 text-[color:var(--text-muted)]">
                Scores, screening, risk.
              </p>
            </div>
          </div>

          <ShowAllButton style={style} pressed={pressed} onPress={() => setPressed((value) => !value)} />

          <form
            role="search"
            onSubmit={(event: FormEvent<HTMLFormElement>) => event.preventDefault()}
            className="grid min-h-13 w-full grid-cols-[var(--spacing-tap)_minmax(0,1fr)_var(--spacing-tap)] items-center rounded-full border border-[color:var(--border)] bg-[color:var(--surface-lux)] shadow-[var(--e2)]"
          >
            <span className="grid h-tap w-tap place-items-center text-[color:var(--clinical-accent)]">
              <Plus className="size-icon-lg" aria-hidden="true" />
            </span>
            <label className="min-w-0">
              <span className="sr-only">Search calculators</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search calculators…"
                className="w-full min-w-0 bg-transparent text-sm font-medium text-[color:var(--text)] placeholder:text-[color:var(--text-placeholder)] focus:outline-none"
              />
            </label>
            <button
              type="submit"
              aria-label="Search calculators"
              className={cn(
                "grid h-tap w-tap place-items-center rounded-full bg-[color:var(--clinical-accent)] text-[color:var(--clinical-accent-contrast)]",
                focusRing,
              )}
            >
              <Search className="size-icon-lg" aria-hidden="true" />
            </button>
          </form>

          <div className="grid w-full grid-cols-4 gap-2" aria-label="Calculator shortcuts">
            {shortcuts.map((tile) => {
              const Icon: LucideIcon = tile.icon;
              const selected = selectedId === tile.id;
              return (
                <button
                  key={tile.id}
                  type="button"
                  aria-pressed={selected}
                  aria-label={`Open ${tile.label}`}
                  onClick={() => setSelectedId(tile.id)}
                  className={cn(
                    "grid h-14 min-w-0 place-items-center gap-0.5 rounded-lg border px-1 py-1.5 text-center shadow-[var(--shadow-inset)]",
                    focusRing,
                    selected
                      ? "border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)]"
                      : "border-[color:var(--border)] bg-[color:var(--surface-lux)]",
                  )}
                >
                  <span className="grid size-7 place-items-center rounded-lg border border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]">
                    <Icon className="size-icon-md" aria-hidden="true" />
                  </span>
                  <span className="w-full truncate text-2xs font-semibold text-[color:var(--text-heading)]">
                    {tile.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </figure>
  );
}

export function CalculatorsShowAllDirectionsMockup() {
  return (
    <main
      data-testid="calculators-show-all-study"
      className="min-h-full bg-[color:var(--background)] px-4 py-8 text-[color:var(--text)] sm:px-6"
    >
      <h1 className="sr-only">Calculators Show all button styles</h1>
      <div className="mx-auto grid max-w-[80rem] justify-items-center gap-8 lg:grid-cols-3 lg:items-start">
        {styles.map((style) => (
          <PhoneHome key={style.id} style={style.id} />
        ))}
      </div>
    </main>
  );
}
