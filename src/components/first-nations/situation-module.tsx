"use client";
import { ArrowLeft, ArrowRight, ChevronRight, Clipboard, Phone } from "lucide-react";
import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { FnButton, ModeActionButton, ModeNotice, ModeUpdatedLine } from "@/components/first-nations/kit";
import { resolveScrollBehavior } from "@/lib/scroll-behavior";
import { ModuleHeader } from "@/components/first-nations/module-header";
import { TickList, toggleIn } from "@/components/first-nations/tick-list";
import { SpokenWords } from "@/components/first-nations/voice";
import { Sheet } from "@/components/ui/sheet";
import { cn, eyebrowText } from "@/components/ui-primitives";
import { copyTextToClipboard } from "@/lib/copy-to-clipboard";
import { telHref } from "@/lib/first-nations/contact-format";
import type { ContactView, PhraseView, SituationView } from "@/lib/first-nations/view-model";

type Ctx = {
  situations: readonly SituationView[];
  index: number;
  select: (i: number) => void;
  liaison: ContactView | null;
};
const SituationContext = createContext<Ctx | null>(null);

function useSituation(): Ctx {
  const ctx = useContext(SituationContext);
  if (!ctx) throw new Error("SituationProvider is missing");
  return ctx;
}

/**
 * Holds the chosen situation in component state only: never stored, never in
 * the URL, never sent. It clears when the page is left.
 */
export function SituationProvider({
  situations,
  liaison,
  children,
}: {
  situations: readonly SituationView[];
  liaison: ContactView | null;
  children: ReactNode;
}) {
  const [index, setIndex] = useState(0); // opens on New admission (owner decision)
  const value = useMemo(
    () => ({
      situations,
      index,
      liaison,
      select: (i: number) => setIndex((i + situations.length) % situations.length),
    }),
    [situations, index, liaison],
  );
  return <SituationContext.Provider value={value}>{children}</SituationContext.Provider>;
}

const planText = (s: SituationView) =>
  [s.label, ...s.plan.map((p, i) => `${i + 1}. ${p.title}${p.detail ? ` — ${p.detail}` : ""}`)].join("\n");

const sourceOf = (item: { source: { title: string; url: string } }) => [
  { label: item.source.title, url: item.source.url },
];

function PlanActions({ situation, allowFilled }: { situation: SituationView; allowFilled: boolean }) {
  const { liaison } = useSituation();
  const [note, setNote] = useState<string | null>(null);
  const call = situation.plan.find((p) => p.contact)?.contact ?? liaison;
  const callHref = call ? telHref(call.number) : undefined;
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-2">
        {call && callHref ? (
          <FnButton
            icon={Phone}
            filled={allowFilled}
            href={callHref}
            label={`Call ${call === liaison ? "liaison" : call.name}`}
          />
        ) : null}
        <FnButton
          icon={Clipboard}
          label="Copy steps"
          onClick={() => {
            copyTextToClipboard(planText(situation)).then(
              () => setNote("Copied"),
              () => setNote("Copying isn't available on this phone"),
            );
          }}
        />
      </div>
      {note ? (
        <p role="status" className="text-sm-minus text-[color:var(--text-muted)]">
          {note}
        </p>
      ) : null}
    </div>
  );
}

function PlanTicks({ situation }: { situation: SituationView }) {
  const [ticked, setTicked] = useState<ReadonlySet<string>>(() => new Set());
  return <TickList steps={situation.plan} ticked={ticked} onToggle={(id) => setTicked((t) => toggleIn(t, id))} />;
}

function PhraseStepper({ phrases }: { phrases: readonly PhraseView[] }) {
  const [i, setI] = useState(0);
  const phrase = phrases[i];
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between">
        <span className={eyebrowText}>Try saying</span>
        <span className="flex items-center gap-1 text-2xs text-[color:var(--text-muted)]">
          <span className="nums">{`${i + 1} of ${phrases.length}`}</span>
          <ModeActionButton
            icon={ArrowRight}
            label="Next phrase"
            onClick={() => setI((n) => (n + 1) % phrases.length)}
          />
        </span>
      </div>
      <SpokenWords>{phrase.say}</SpokenWords>
      <ModeUpdatedLine updatedAt={phrase.checkedAt} verb="Checked" sources={sourceOf(phrase)} />
    </div>
  );
}

export function SituationModule() {
  const { situations, index, select, liaison } = useSituation();
  const situation = situations[index];
  const [planOpen, setPlanOpen] = useState(false);
  const dialRef = useRef<HTMLDivElement>(null);
  const call = situation.plan.find((p) => p.contact)?.contact ?? liaison;
  const callHref = call ? telHref(call.number) : undefined;

  function chooseSituation(i: number) {
    select(i);
    window.requestAnimationFrame(() => {
      const target = dialRef.current;
      if (!target) return;
      target.scrollIntoView({ block: "nearest", behavior: resolveScrollBehavior() });
      const focusable = target.querySelector<HTMLElement>("a[href^='tel:'], button");
      focusable?.focus({ preventScroll: true });
    });
  }

  return (
    <section
      aria-labelledby="fn-situation-title"
      data-fn-part="situation"
      className="grid min-w-0 gap-2 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-raised)] pb-3 shadow-[var(--e1)]"
    >
      <ModuleHeader
        id="fn-situation-title"
        icon="message"
        title="Situation"
        action={
          <button
            type="button"
            aria-haspopup="dialog"
            onClick={() => setPlanOpen(true)}
            className="relative inline-flex h-[2.125rem] items-center gap-1 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-raised)] pl-3 pr-2.5 text-sm-minus text-[color:var(--text-heading)] after:absolute after:-inset-x-1 after:-inset-y-[0.4375rem] lg:hidden"
          >
            {`Plan · ${situation.plan.length} steps`}
            <ChevronRight className="size-icon-xs" aria-hidden="true" />
          </button>
        }
      />
      <div className="flex flex-wrap gap-2 px-3">
        {situations.map((s, i) => (
          <button
            key={s.id}
            type="button"
            aria-pressed={i === index}
            onClick={() => chooseSituation(i)}
            className={cn(
              "relative h-9 rounded-full border px-3 text-sm-minus after:absolute after:inset-x-0 after:-inset-y-1.5",
              i === index
                ? "border-[color:var(--clinical-accent)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--text-heading)]"
                : "border-[color:var(--border)] bg-[color:var(--background)] text-[color:var(--text)]",
            )}
          >
            {s.label}
          </button>
        ))}
      </div>
      {/* The risk line arrives from the model only when its approval record matches; never written here. */}
      {situation.riskLine ? (
        <div className="px-3">
          <ModeNotice tone="warning">{situation.riskLine}</ModeNotice>
        </div>
      ) : null}
      <div className="grid gap-2 px-3">
        <PhraseStepper key={situation.id} phrases={situation.phrases} />
        <div className="grid gap-0.5 border-t border-[color:var(--border)] pt-2 lg:hidden">
          <span className={eyebrowText}>First step</span>
          <span className="text-sm-minus font-medium text-[color:var(--text-heading)]">
            {situation.firstStep.title}
          </span>
        </div>
        {call && callHref ? (
          <div ref={dialRef} id="fn-situation-dial" data-testid="fn-situation-dial" className="pt-1">
            <FnButton icon={Phone} filled href={callHref} label={`Call ${call === liaison ? "liaison" : call.name}`} />
          </div>
        ) : (
          <div ref={dialRef} id="fn-situation-dial" data-testid="fn-situation-dial" className="sr-only" />
        )}
      </div>
      <Sheet
        open={planOpen}
        onClose={() => setPlanOpen(false)}
        title={situation.label}
        description={`${situation.plan.length} steps · nothing is saved`}
      >
        <div className="grid gap-3">
          {situation.riskLine ? <ModeNotice tone="warning">{situation.riskLine}</ModeNotice> : null}
          <PlanTicks situation={situation} />
          <PlanActions situation={situation} allowFilled />
        </div>
      </Sheet>
    </section>
  );
}

/** Desktop only: the chosen situation's plan in a 360 px side panel, with previous and next. */
export function SituationSidePanel() {
  const { situations, index, select } = useSituation();
  const situation = situations[index];
  return (
    <aside
      aria-label="Situation plan"
      data-fn-part="plan-panel"
      className="hidden content-start gap-3 border-l border-[color:var(--border)] bg-[color:var(--background)] p-4 lg:grid"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="grid gap-0.5">
          <span className={eyebrowText}>Situation plan</span>
          <h2 className="text-lg-minus font-semibold text-[color:var(--text-heading)]">{situation.label}</h2>
          <p className="text-sm-minus text-[color:var(--text-muted)]">{`${situation.plan.length} steps · nothing is saved`}</p>
        </div>
        <div className="flex items-center">
          <ModeActionButton icon={ArrowLeft} label="Previous situation" onClick={() => select(index - 1)} />
          <span className="nums min-w-12 text-center text-sm-minus text-[color:var(--text-muted)]">{`${index + 1} of ${situations.length}`}</span>
          <ModeActionButton icon={ArrowRight} label="Next situation" onClick={() => select(index + 1)} />
        </div>
      </div>
      {situation.riskLine ? <ModeNotice tone="warning">{situation.riskLine}</ModeNotice> : null}
      <PlanTicks key={situation.id} situation={situation} />
      {/* Outlined here: on desktop the hero's call disc is this screen's one filled button. */}
      <PlanActions situation={situation} allowFilled={false} />
    </aside>
  );
}
