"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CalendarPlus, ChevronRight, Copy, ExternalLink, Search, TriangleAlert, WifiOff, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { useAccountData } from "@/components/account-data-provider";
import { AdminLoadFailed } from "@/components/admin/admin-load-failed";
import { ContractEndEntryLink } from "@/components/admin/contract/contract-entry-link";
import {
  copyLabel,
  createEntry,
  deleteEntry,
  errorWords,
  JuniorFootNote,
  JuniorNotice,
  JuniorSectionLabel,
  JuniorUndoBar,
  PatientDetailCatch,
  slugSuffix,
  useCopy,
  useOnline,
} from "@/components/admin/junior/junior-shared";
import { ReadyForDayOneEntryLink } from "@/components/admin/ready/ready-entry-link";
import { StarterDateSheet } from "@/components/admin/starter/starter-date-sheet";
import { cardSurface, focusRing } from "@/components/card-recipes";
import { AccountSetupDialog } from "@/components/clinical-dashboard/account-setup-dialog";
import { InformationPageShell } from "@/components/information-page-shell";
import { PageTitleUnderBand } from "@/components/mode-band/mode-band";
import { ModeFeaturedModule } from "@/components/mode-kit/featured-module";
import { ModeModuleSkeleton } from "@/components/mode-kit/module-skeleton";
import { Button } from "@/components/ui/button";
import { cn, fieldControlPlain, textMuted } from "@/components/ui-primitives";
import { adminLoadState, selectAdminOwnEntries } from "@/lib/admin/own-entries";
import { formatDateEcho, formatRelativeDate } from "@/lib/admin/renewal-dates";
import { ADMIN_REQUIREMENTS_CATALOGUE } from "@/lib/admin/requirements";
import {
  buildStarterDateBody,
  ESCALATION_LADDER,
  LOCAL_WORD_GROUP_LABELS,
  LOCAL_WORDS,
  searchLocalWords,
  selectStarterDates,
  STARTER_OFFICES,
  starterKindInfo,
  starterSavedLine,
  starterWordSuggestion,
  STARTER_SUGGEST_LIMIT,
  visaContractClash,
  type LocalWordGroup,
  type StarterDateInput,
  type StarterDateKind,
} from "@/lib/admin/starter-pack";
import { perthCalendarDate } from "@/lib/cme/cpd-year";
import { cacheOnCallEntries, useOnCallEntries } from "@/lib/on-call/entry-store";
import { checkPatientDetail } from "@/lib/work-text/patient-detail-check";

type Undo = { id: number; label: string; run: () => Promise<void> };

const WORDS_SHOWN = 12;
const GROUPS: readonly (LocalWordGroup | "all")[] = ["all", "hospital", "training", "pay-and-leave", "everyday"];
const VISA_SOURCE = ADMIN_REQUIREMENTS_CATALOGUE.find((item) => item.id === "img-visa-requirements");

const chipClass = (on: boolean) =>
  cn(
    focusRing,
    "inline-flex min-h-12 shrink-0 items-center rounded-full border px-3 text-sm font-medium",
    on
      ? "border-[color:var(--clinical-accent)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]"
      : "border-[color:var(--border)] bg-[color:var(--surface-raised)] text-[color:var(--text)]",
  );

const JUMPS = [
  { href: "#starter-how", label: "How it works" },
  { href: "#starter-words", label: "Local words" },
  { href: "#starter-dates", label: "Your dates" },
  { href: "#starter-ask", label: "Who to ask" },
] as const;

function LocalWords({ initialQuery }: { initialQuery: string }) {
  const [query, setQuery] = useState(initialQuery);
  const [group, setGroup] = useState<LocalWordGroup | "all">("all");
  const [showAll, setShowAll] = useState(false);
  const matches = useMemo(() => searchLocalWords(query, group), [query, group]);
  const searching = query.trim().length > 0;
  const shown = searching || showAll ? matches : matches.slice(0, WORDS_SHOWN);
  const countWords = matches.length === 1 ? "1 word" : `${matches.length} words`;

  return (
    <section aria-labelledby="starter-words-heading" id="starter-words" className="grid scroll-mt-24 gap-2">
      <JuniorSectionLabel id="starter-words-heading" count={`${LOCAL_WORDS.length} words`}>
        Local words
      </JuniorSectionLabel>
      <div className="relative">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 size-icon-sm -translate-y-1/2 text-[color:var(--text-muted)]"
        />
        <label htmlFor="starter-word-search" className="sr-only">
          Search local words, or a word from home
        </label>
        <input
          id="starter-word-search"
          type="search"
          value={query}
          placeholder="Search, or type a word from home"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && query) {
              event.preventDefault();
              setQuery("");
            }
          }}
          autoComplete="off"
          className={cn(fieldControlPlain, "min-h-12 pl-9 pr-12")}
          data-testid="admin-starter-word-search"
        />
        {query ? (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label="Clear search"
            className={cn(
              focusRing,
              "absolute right-0 top-0 grid size-12 place-items-center text-[color:var(--text-muted)]",
            )}
          >
            <X aria-hidden="true" className="size-icon-sm" />
          </button>
        ) : null}
      </div>
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" role="group" aria-label="Word groups">
        {GROUPS.map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={group === value}
            onClick={() => setGroup(value)}
            className={chipClass(group === value)}
            data-testid={`admin-starter-group-${value}`}
          >
            {value === "all" ? "All" : LOCAL_WORD_GROUP_LABELS[value]}
          </button>
        ))}
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        {searching ? `${countWords} found` : ""}
      </p>
      {matches.length === 0 ? (
        <div className={cn(cardSurface, "grid gap-1 p-3")} data-testid="admin-starter-words-empty">
          <p className="text-sm font-semibold text-[color:var(--text-heading)]">No word matches “{query.trim()}”</p>
          <p className="text-sm text-[color:var(--text)]">Try the word you would use at home, or ask your registrar.</p>
        </div>
      ) : (
        <dl className={cn(cardSurface, "overflow-hidden")} data-testid="admin-starter-words">
          {shown.map(({ word, fromHome }) => (
            <div
              key={word.term}
              className="grid gap-0.5 border-b border-[color:var(--border)] px-3 py-2.5 last:border-b-0"
            >
              <dt className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold text-[color:var(--text-heading)]">
                {word.term}
                {fromHome ? (
                  <span className="rounded-md bg-[color:var(--surface-subtle)] px-1.5 py-0.5 text-xs font-medium text-[color:var(--text)]">
                    You searched “{fromHome}”
                  </span>
                ) : null}
                {word.differsBySite ? (
                  <span className="rounded-md border border-dashed border-[color:var(--border-strong)] px-1.5 py-0.5 text-xs font-medium text-[color:var(--text-muted)]">
                    Differs by site
                  </span>
                ) : null}
              </dt>
              <dd className="text-sm leading-5 text-[color:var(--text)]">{word.meaning}</dd>
              {word.example ? <dd className={cn(textMuted, "text-xs")}>{word.example}</dd> : null}
              {word.fromHome && !fromHome ? (
                <dd className={cn(textMuted, "text-xs")}>At home you may say: {word.fromHome.join(", ")}</dd>
              ) : null}
            </div>
          ))}
        </dl>
      )}
      <SuggestWord initial={matches.length === 0 ? query.trim() : ""} />
      {!searching && matches.length > WORDS_SHOWN ? (
        <Button
          variant="ghost"
          onClick={() => setShowAll((value) => !value)}
          aria-expanded={showAll}
          testId="admin-starter-words-more"
        >
          {showAll ? "Show fewer" : `Show all ${matches.length}`}
        </Button>
      ) : null}
    </section>
  );
}

/**
 * "Suggest a word": a note the doctor copies to their Medical Education
 * Unit. Nothing is sent or kept. The patient-detail catch runs first, and
 * Copy stays off until the words read as safe.
 */
function SuggestWord({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial);
  const [seenInitial, setSeenInitial] = useState(initial);
  if (initial !== seenInitial) {
    setSeenInitial(initial);
    setValue(initial);
  }
  const { copy, stateFor } = useCopy();
  const word = value.trim();
  const tooLong = word.length > STARTER_SUGGEST_LIMIT;
  // Words from home are often capitals ("SHO", "RMO").
  const problem = word && !tooLong ? checkPatientDetail(word, { allowCapitals: true }) : null;
  const blocked = !word || tooLong || Boolean(problem);
  return (
    <div className={cn(cardSurface, "grid gap-2 p-3")} data-testid="admin-starter-suggest">
      <label htmlFor="admin-starter-suggest-word" className="text-sm font-semibold text-[color:var(--text-heading)]">
        Suggest a word
      </label>
      <p className={cn(textMuted, "text-xs")}>A word you heard and did not know. No patient details.</p>
      <input
        id="admin-starter-suggest-word"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        maxLength={STARTER_SUGGEST_LIMIT + 20}
        aria-invalid={problem || tooLong ? true : undefined}
        className={cn(fieldControlPlain, "min-h-12")}
        data-testid="admin-starter-suggest-word"
      />
      {tooLong ? (
        <p className="text-sm text-[color:var(--text)]">Keep it to {STARTER_SUGGEST_LIMIT} characters.</p>
      ) : null}
      {problem ? (
        <PatientDetailCatch
          problem={{ ...problem, body: "Suggestions here cannot hold patient details." }}
          onUseSuggestion={(safer) => setValue(safer)}
          testId="admin-starter-suggest-problem"
        />
      ) : null}
      <Button
        variant="secondary"
        icon={Copy}
        disabled={blocked}
        onClick={() =>
          void copy(starterWordSuggestion(word), "suggest", "Note copied. Send it to your Medical Education Unit.")
        }
        testId="admin-starter-suggest-copy"
      >
        {copyLabel(stateFor("suggest"), "Copy a note for Medical Education")}
      </Button>
    </div>
  );
}

/**
 * Starter pack for overseas-trained doctors, `/admin/new-job/starter`
 * (junior feature #14). How WA hospitals work, local words searchable by the
 * word from home, the doctor's own visa and registration dates beside their
 * contract end, and who to ask. Never visa or registration advice.
 */
export function StarterPackPage({ now: nowProp }: { now?: Date } = {}) {
  const { isAuthenticated } = useAccountData();
  const searchParams = useSearchParams();
  const wordParam = searchParams?.get("word") ?? "";
  const state = useOnCallEntries();
  const mountedAt = useMemo(() => new Date(), []);
  const today = perthCalendarDate(nowProp ?? mountedAt);
  const loadState = adminLoadState(state);
  const own = useMemo(() => selectAdminOwnEntries(state), [state]);
  const rows = useMemo(() => selectStarterDates(own), [own]);
  const clash = visaContractClash(rows);
  const canWrite = loadState === "ready" && !state.demoMode && isAuthenticated;
  const readOnlyReason = state.demoMode
    ? "These are example records. Sign in to add your own dates."
    : !isAuthenticated
      ? "Sign in to add your dates."
      : null;
  const recordedKinds = useMemo(
    () =>
      new Set(
        rows.filter((row) => row.kind !== "contract" && row.kind !== "other").map((row) => row.kind as StarterDateKind),
      ),
    [rows],
  );

  const online = useOnline();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [undo, setUndo] = useState<Undo | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [signInOpen, setSignInOpen] = useState(false);
  const undoId = useRef(0);

  // A link from search lands on the words with the word already typed.
  useEffect(() => {
    if (!wordParam) return;
    document.getElementById("starter-words")?.scrollIntoView({ block: "start" });
  }, [wordParam]);

  async function saveDate(input: StarterDateInput): Promise<string | null> {
    const body = buildStarterDateBody(input, slugSuffix());
    if (!body) return "Check the date.";
    try {
      const saved = await createEntry(body);
      cacheOnCallEntries([...state.entries, saved]);
      setSheetOpen(false);
      const title = input.kind === "other" ? input.name.trim() : starterKindInfo(input.kind).label;
      undoId.current += 1;
      setUndo({
        id: undoId.current,
        label: starterSavedLine(title, input.date, input.leadTimeDays),
        run: async () => {
          await deleteEntry(saved.id);
          cacheOnCallEntries(state.entries.filter((entry) => entry.id !== saved.id));
        },
      });
      return null;
    } catch (error) {
      return errorWords(error, "Could not save the date.");
    }
  }

  async function runUndo() {
    if (!undo) return;
    const { run } = undo;
    setUndo(null);
    try {
      await run();
    } catch (error) {
      setFailure(errorWords(error, "Could not undo that change."));
    }
  }

  return (
    <>
      <InformationPageShell testId="admin-starter-main">
        <div className="grid gap-1">
          <PageTitleUnderBand className="text-2xl font-semibold text-[color:var(--text-heading)]">
            Starter pack
          </PageTitleUnderBand>
          <p className={cn(textMuted, "text-sm")}>For doctors new to WA hospitals</p>
        </div>

        {!online ? (
          <div
            className={cn(cardSurface, "flex items-start gap-2 p-3 text-sm")}
            role="status"
            data-testid="admin-starter-offline"
          >
            <WifiOff
              aria-hidden="true"
              strokeWidth={1.5}
              className="mt-0.5 size-icon-sm shrink-0 text-[color:var(--text-muted)]"
            />
            <span>
              <b className="font-semibold text-[color:var(--text-heading)]">You are offline.</b> The words and who to
              ask still work. Adding a date needs a connection.
            </span>
          </div>
        ) : null}

        <ModeFeaturedModule as="section" mode="my-work" className="grid min-w-0 gap-3 p-4" testId="admin-starter-hero">
          <h2 className="text-lg-minus font-semibold text-[color:var(--text-heading)]">Welcome to WA</h2>
          <p className="text-sm leading-6 text-[color:var(--text)]">
            How the hospital works, the words people use, your own dates in one place, and who to ask. General guidance:
            your hospital&apos;s orientation is the final word.
          </p>
          <nav aria-label="On this page" className="grid grid-cols-2 gap-2">
            {JUMPS.map((jump) => (
              <a
                key={jump.href}
                href={jump.href}
                className={cn(
                  focusRing,
                  "flex min-h-12 items-center justify-between gap-2 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-raised)] px-3 text-sm font-medium text-[color:var(--text-heading)]",
                )}
              >
                {jump.label}
                <ChevronRight aria-hidden="true" className="size-icon-sm shrink-0 text-[color:var(--text-muted)]" />
              </a>
            ))}
          </nav>
        </ModeFeaturedModule>

        {/* How it works */}
        <section aria-labelledby="starter-how-heading" id="starter-how" className="grid scroll-mt-24 gap-2">
          <JuniorSectionLabel id="starter-how-heading">How it works</JuniorSectionLabel>
          <div
            className={cn(cardSurface, "grid gap-1 border-[color:var(--border-strong)] p-3")}
            data-testid="admin-starter-worse"
          >
            <p className="flex items-center gap-2 text-sm font-semibold text-[color:var(--text-heading)]">
              <TriangleAlert aria-hidden="true" strokeWidth={1.5} className="size-icon-sm shrink-0" />
              Someone getting worse fast
            </p>
            <p className="text-sm leading-5 text-[color:var(--text)]">
              Call a MET call the way your hospital shows you at orientation. Do not wait to work up the list below.
            </p>
          </div>
          <div className={cn(cardSurface, "overflow-hidden")}>
            <p className="border-b border-[color:var(--border)] px-3 py-2 text-sm font-semibold text-[color:var(--text-heading)]">
              A clinical question: ask in this order
            </p>
            <ol className="grid" data-testid="admin-starter-ladder">
              {ESCALATION_LADDER.map((step, index) => (
                <li
                  key={step.who}
                  className="flex min-h-12 items-center gap-3 border-b border-[color:var(--border)] px-3 py-2 last:border-b-0"
                >
                  <span className="nums grid size-7 shrink-0 place-items-center rounded-full bg-[color:var(--surface-subtle)] text-xs font-semibold text-[color:var(--text-heading)]">
                    {index + 1}
                  </span>
                  <span className="grid min-w-0 flex-1">
                    <span className="text-sm font-medium text-[color:var(--text-heading)]">{step.who}</span>
                    <span className={cn(textMuted, "text-xs")}>{step.what}</span>
                  </span>
                  {step.when ? <span className={cn(textMuted, "shrink-0 text-xs")}>{step.when}</span> : null}
                </li>
              ))}
            </ol>
          </div>
          <div className={cn(cardSurface, "overflow-hidden")}>
            <p className="border-b border-[color:var(--border)] px-3 py-2 text-sm font-semibold text-[color:var(--text-heading)]">
              Not clinical: go to the right office
            </p>
            <ul data-testid="admin-starter-offices">
              {STARTER_OFFICES.map((office) => (
                <li
                  key={office.name}
                  className="flex min-h-12 items-center justify-between gap-3 border-b border-[color:var(--border)] px-3 py-2 last:border-b-0"
                >
                  <span className="text-sm font-medium text-[color:var(--text-heading)]">{office.name}</span>
                  <span className={cn(textMuted, "text-right text-xs")}>{office.what}</span>
                </li>
              ))}
            </ul>
          </div>
          <p className={cn(textMuted, "px-1 text-xs")}>
            Names and roles differ between hospitals. Ask at orientation how yours works.
          </p>
        </section>

        <LocalWords key={wordParam} initialQuery={wordParam} />

        {/* Your dates */}
        <section aria-labelledby="starter-dates-heading" id="starter-dates" className="grid scroll-mt-24 gap-2">
          <JuniorSectionLabel
            id="starter-dates-heading"
            action={
              canWrite ? (
                <Button
                  variant="ghost"
                  size="sm"
                  icon={CalendarPlus}
                  onClick={() => setSheetOpen(true)}
                  testId="admin-starter-add-date"
                >
                  Add a date
                </Button>
              ) : undefined
            }
          >
            Your dates
          </JuniorSectionLabel>
          {failure ? (
            <p role="alert" className="text-sm text-[color:var(--text)]" data-testid="admin-starter-error">
              {failure}
            </p>
          ) : null}
          {loadState === "failed" ? (
            <AdminLoadFailed reason={state.loadError} onRetry={state.retry} testId="admin-starter-load-failed" />
          ) : loadState === "loading" ? (
            <ModeModuleSkeleton rows={3} testId="admin-starter-dates-loading" />
          ) : loadState === "signed-out" ? (
            <JuniorNotice
              title="Sign in to keep your dates"
              testId="admin-starter-signed-out"
              action={
                <Button variant="secondary" onClick={() => setSignInOpen(true)}>
                  Sign in
                </Button>
              }
            >
              Visa, registration and contract dates are kept for your signed-in account only. Nothing is saved on this
              phone.
            </JuniorNotice>
          ) : (
            <>
              {clash ? (
                <div
                  className={cn(cardSurface, "grid gap-1 border-[color:var(--border-strong)] p-3")}
                  role="note"
                  data-testid="admin-starter-clash"
                >
                  <p className="flex items-center gap-2 text-sm font-semibold text-[color:var(--text-heading)]">
                    <TriangleAlert aria-hidden="true" strokeWidth={1.5} className="size-icon-sm shrink-0" />
                    Your visa date is before your contract end
                  </p>
                  <p className="text-sm leading-5 text-[color:var(--text)]">
                    Visa {formatDateEcho(clash.visaEnd)}, contract {formatDateEcho(clash.contractEnd)}. Talk to Medical
                    Workforce and a registered migration agent early. PsychSift only compares the dates you typed.
                  </p>
                </div>
              ) : null}
              {rows.length === 0 ? (
                <div className={cn(cardSurface, "grid gap-1 p-3")} data-testid="admin-starter-dates-empty">
                  <p className="text-sm font-semibold text-[color:var(--text-heading)]">No dates yet</p>
                  <p className="text-sm leading-5 text-[color:var(--text)]">
                    Add your visa end, registration renewal and supervised practice dates. Each one shows on Admin Today
                    before it comes up.
                  </p>
                  {canWrite ? (
                    <div className="pt-1">
                      <Button
                        variant="primary"
                        icon={CalendarPlus}
                        onClick={() => setSheetOpen(true)}
                        testId="admin-starter-add-first"
                      >
                        Add a date
                      </Button>
                    </div>
                  ) : (
                    <p className={cn(textMuted, "text-sm")} data-testid="admin-starter-read-only">
                      {readOnlyReason}
                    </p>
                  )}
                </div>
              ) : (
                <ul className={cn(cardSurface, "overflow-hidden")} data-testid="admin-starter-dates">
                  {rows.map((row) => (
                    <li key={row.key} className="border-b border-[color:var(--border)] last:border-b-0">
                      <Link
                        href={row.href}
                        className={cn(focusRing, "flex min-h-12 items-center gap-3 px-3 py-2")}
                        data-testid={`admin-starter-date-${row.kind}`}
                      >
                        <span className="grid min-w-0 flex-1">
                          <span className="text-sm font-medium text-[color:var(--text-heading)]">{row.title}</span>
                          <span className={cn(textMuted, "nums text-xs")}>
                            {formatDateEcho(row.date)}
                            {`, ${formatRelativeDate(row.date, today)}`}
                          </span>
                        </span>
                        <ChevronRight
                          aria-hidden="true"
                          className="size-icon-md shrink-0 text-[color:var(--text-muted)]"
                        />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              {rows.length > 0 && !canWrite && readOnlyReason ? (
                <p className={cn(textMuted, "text-xs")} data-testid="admin-starter-read-only">
                  {readOnlyReason}
                </p>
              ) : null}
            </>
          )}
          <ContractEndEntryLink />
          <ReadyForDayOneEntryLink line="What is recorded before you start" />
        </section>

        {/* Who to ask */}
        <section aria-labelledby="starter-ask-heading" id="starter-ask" className="grid scroll-mt-24 gap-2">
          <JuniorSectionLabel id="starter-ask-heading">Who to ask</JuniorSectionLabel>
          <ul className={cn(cardSurface, "overflow-hidden")} data-testid="admin-starter-ask">
            <li className="border-b border-[color:var(--border)]">
              <Link href="/admin/help" className={cn(focusRing, "flex min-h-12 items-center gap-3 px-3 py-2")}>
                <span className="grid min-w-0 flex-1">
                  <span className="text-sm font-medium text-[color:var(--text-heading)]">
                    Feeling overwhelmed or unsafe
                  </span>
                  <span className={cn(textMuted, "text-xs")}>Help and support, crisis lines first</span>
                </span>
                <ChevronRight aria-hidden="true" className="size-icon-md shrink-0 text-[color:var(--text-muted)]" />
              </Link>
            </li>
            <li className="border-b border-[color:var(--border)]">
              <Link href="/admin/new-job" className={cn(focusRing, "flex min-h-12 items-center gap-3 px-3 py-2")}>
                <span className="grid min-w-0 flex-1">
                  <span className="text-sm font-medium text-[color:var(--text-heading)]">Contacts for this job</span>
                  <span className={cn(textMuted, "text-xs")}>The people and offices you saved in New job</span>
                </span>
                <ChevronRight aria-hidden="true" className="size-icon-md shrink-0 text-[color:var(--text-muted)]" />
              </Link>
            </li>
            <li className="border-b border-[color:var(--border)]">
              <Link
                href="/teaching/assessments?view=help"
                className={cn(focusRing, "flex min-h-12 items-center gap-3 px-3 py-2")}
              >
                <span className="grid min-w-0 flex-1">
                  <span className="text-sm font-medium text-[color:var(--text-heading)]">Supervision and training</span>
                  <span className={cn(textMuted, "text-xs")}>Your Medical Education Unit, and when to ask them</span>
                </span>
                <ChevronRight aria-hidden="true" className="size-icon-md shrink-0 text-[color:var(--text-muted)]" />
              </Link>
            </li>
            <li className="grid gap-1 px-3 py-2.5" data-testid="admin-starter-visa">
              <span className="text-sm font-medium text-[color:var(--text-heading)]">Visa questions</span>
              <span className="text-sm leading-5 text-[color:var(--text)]">
                A registered migration agent, or the Department of Home Affairs. PsychSift cannot advise on visas.
              </span>
              {VISA_SOURCE ? (
                <a
                  href={VISA_SOURCE.sourceUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className={cn(
                    focusRing,
                    "inline-flex min-h-12 w-fit items-center gap-1 text-sm font-medium text-[color:var(--clinical-accent)]",
                  )}
                >
                  {VISA_SOURCE.sourceName}: visa page
                  <ExternalLink aria-hidden="true" className="size-icon-sm" />
                </a>
              ) : null}
            </li>
          </ul>
        </section>

        <JuniorFootNote testId="admin-starter-foot">
          General guidance for WA hospitals, not visa or registration advice. Your dates are kept in your account only.
        </JuniorFootNote>
      </InformationPageShell>

      <StarterDateSheet
        open={sheetOpen}
        today={today}
        recordedKinds={recordedKinds}
        onClose={() => setSheetOpen(false)}
        onSave={saveDate}
      />

      {loadState === "signed-out" ? (
        <AccountSetupDialog open={signInOpen} onClose={() => setSignInOpen(false)} />
      ) : null}

      {undo ? (
        <JuniorUndoBar
          key={undo.id}
          label={undo.label}
          onUndo={() => void runUndo()}
          onDismiss={() => setUndo(null)}
          testId="admin-starter-undo"
        />
      ) : null}
    </>
  );
}
