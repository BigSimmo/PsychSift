"use client";

import Link from "next/link";
import { BookOpenText, ClipboardList, Clock3, Languages, MapPin, Scale, UserRound } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

import { inPageAnchor } from "@/components/in-page-nav/in-page-nav-classes";
import { cn, textMuted } from "@/components/ui-primitives";
import { Sheet } from "@/components/ui/sheet";
import {
  ACT_SECTION_CHIP_LIMIT,
  formCatalogDetails,
  PRIORITY_FACT_CARD_LABELS,
  type FormRecord,
} from "@/lib/form-catalog";
import {
  CULTURAL_NOTE_LABELS,
  culturalNoteReviewer,
  culturalNotesForForm,
  type FormCulturalNoteKind,
} from "@/lib/forms-cultural-notes";
import type { FormActSection, FormPriorityFactCard } from "@/lib/form-ranker";
import { mhaActMetadata } from "@/lib/mha-act-sections";
import { signOffDisplay } from "@/lib/sign-off-label";
import type { ServiceSummaryCard } from "@/lib/service-ranker";

function hasText(value: string | null | undefined): value is string {
  return Boolean(value && value.trim().length > 0);
}

const PRIORITY_FACT_ICONS = {
  clock: Clock3,
  authority: UserRound,
  criteria: Scale,
  "act-sections": BookOpenText,
} as const;

function summaryIcon(card: ServiceSummaryCard) {
  // Match the card id before the prose. The old heuristic searched the title too, so
  // Form 4C's authority card — whose title reads "Check the official form signature block
  // and Act sections." — drew the Act-sections book instead of the person.
  const known = PRIORITY_FACT_ICONS[card.id as keyof typeof PRIORITY_FACT_ICONS];
  if (known) {
    const KnownIcon = known;
    return <KnownIcon className="h-5 w-5" aria-hidden />;
  }
  const label = `${card.id} ${card.label} ${card.title}`.toLowerCase();
  const Icon =
    label.includes("act-section") || label.includes("act section")
      ? BookOpenText
      : label.includes("clock")
        ? Clock3
        : label.includes("destination") || label.includes("place") || label.includes("route")
          ? MapPin
          : label.includes("authority") || label.includes("maker")
            ? UserRound
            : label.includes("criteria") || label.includes("threshold")
              ? Scale
              : ClipboardList;
  return <Icon className="h-5 w-5" aria-hidden />;
}

/**
 * The longer wording behind a Priority-facts card.
 *
 * Every form can produce one: a curated `priorityFacts` entry supplies its own `body`,
 * and otherwise the canonical catalogue prose is composed. Whether that body is worth
 * an affordance is decided by the caller, not here — see `hasExtraDetail`.
 */
export function priorityFactBody(
  form: FormRecord,
  cardId: string,
): { title: string; body: string; detail?: string } | null {
  const details = formCatalogDetails(form);
  if (!details) return null;

  const fromCard = (fact: FormPriorityFactCard | undefined, fallbackBody: string, fallbackDetail?: string) => {
    if (!fact && !fallbackBody.trim()) return null;
    const body = fact?.body?.trim() || fallbackBody.trim();
    if (!body) return null;
    return {
      title:
        fact?.title?.trim() || PRIORITY_FACT_CARD_LABELS[cardId as keyof typeof PRIORITY_FACT_CARD_LABELS] || cardId,
      detail: fact?.detail?.trim() || fallbackDetail,
      body,
    };
  };

  if (cardId === "clock") {
    return fromCard(details.priorityFacts?.clock, details.clock, details.indexedClock);
  }
  if (cardId === "authority") {
    return fromCard(
      details.priorityFacts?.authority,
      [details.maker, details.authorises, details.doesNotAuthorise].filter(Boolean).join(" "),
      details.authorises,
    );
  }
  if (cardId === "criteria") {
    return fromCard(details.priorityFacts?.criteria, details.threshold, details.doesNotAuthorise);
  }
  return null;
}

/**
 * Whether a card should offer "Tap for detail".
 *
 * This used to be gated on the form having a curated `priorityFacts` block, which is
 * why only Form 1A had working popups. The honest test is whether the sheet would show
 * anything the card face does not already say: on a form whose catalogue row is
 * boilerplate, the clock card's title IS its whole body, so it stays inert rather than
 * promising detail that does not exist. The authority card composes maker + authorises
 * + does-not-authorise, which is strictly more than its title on every form.
 */
function hasExtraDetail(card: ServiceSummaryCard, detail: { body: string } | null) {
  const body = detail?.body?.trim();
  if (!body) return false;
  return body !== (card.title ?? "").trim();
}

/**
 * The four cards sit in one stretched grid row, so the card with the most to say sets the
 * height for all of them. Left alone that reads as three ragged boxes beside a full one:
 * a two-line clock card printed its text at the top and left 150px of dead space below,
 * while an interactive card's text floated to the middle because a `<button>` centres its
 * own content. So the anatomy is fixed in three zones rather than flowed:
 *
 *   header    pinned to the top, identical on every card
 *   body      centred in whatever height the tallest sibling imposes
 *   footnote  pinned to the bottom, and always occupying a line even when a card has no
 *             hint to show, so the four baselines agree
 *
 * Text stays left-aligned inside that: these are clinical sentences to be read, not stat
 * tiles to be glanced at, and centred ragged prose is harder to scan.
 */
function DetailCardShell({
  card,
  children,
  footer,
}: {
  card: ServiceSummaryCard;
  children?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <article className="flex min-h-[5.75rem] flex-col rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-lux)] p-1.5 shadow-[var(--shadow-inset)] sm:min-h-[7rem] sm:p-3">
      <div className="mb-1 flex items-start gap-1.5 sm:mb-2 sm:gap-2">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)] sm:h-9 sm:w-9">
          {summaryIcon(card)}
        </span>
        <p className="min-w-0 pt-0.5 text-2xs font-bold uppercase leading-4 text-[color:var(--text-muted)]">
          {hasText(card.label) ? card.label.trim() : "Priority fact"}
        </p>
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-center">{children}</div>
      <CardFootnote>{footer}</CardFootnote>
    </article>
  );
}

/**
 * The bottom line of a card. It renders even with nothing to say, because a card that
 * drops the line is 1rem shorter in its body zone than its neighbours and the row stops
 * lining up. The blank stays out of the accessibility tree.
 */
function CardFootnote({ children }: { children?: ReactNode }) {
  return (
    <p className={cn("mt-auto pt-1 text-2xs font-medium leading-4 sm:pt-1.5", textMuted)}>
      {children ?? <span aria-hidden>&nbsp;</span>}
    </p>
  );
}

function DetailCard({
  card,
  onOpenDetail,
  hasDetail,
}: {
  card: ServiceSummaryCard;
  onOpenDetail?: () => void;
  hasDetail?: boolean;
}) {
  const label = hasText(card.label) ? card.label.trim() : "Priority fact";
  const title = hasText(card.title) ? card.title.trim() : "";
  const isInteractive = Boolean(hasDetail && onOpenDetail);

  const titleNode = isInteractive ? (
    <span className="block text-xs font-semibold leading-tight text-[color:var(--text-heading)] sm:text-sm sm:leading-5">
      {title}
    </span>
  ) : (
    <h3 className="text-xs font-semibold leading-tight text-[color:var(--text-heading)] sm:text-sm sm:leading-5">
      {title}
    </h3>
  );

  const content = (
    <>
      {titleNode}
      {/* Rendered only when there is a sub-line. The 34 forms with no indexed clock cue
          used to print "Not listed" here, which reads as a fact about the form rather
          than an absence of one, and there is no honest substitute in the catalogue. */}
      {hasText(card.detail) ? (
        <p className={cn("mt-0.5 text-2xs font-medium leading-4 sm:mt-1 sm:text-xs sm:leading-5", textMuted)}>
          {card.detail.trim()}
        </p>
      ) : null}
    </>
  );

  if (!isInteractive || !onOpenDetail) {
    return <DetailCardShell card={card}>{content}</DetailCardShell>;
  }

  return (
    <DetailCardShell card={card} footer="Tap for detail">
      {/* `block`, not `flex-1`: a stretched button centres its own content under the UA
          stylesheet, which is what made this card's text sit lower than its neighbours'.
          The shell owns the centring now, so every card resolves it the same way. */}
      <button
        type="button"
        onClick={onOpenDetail}
        aria-haspopup="dialog"
        className="block w-full min-w-0 rounded-md text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
        aria-label={`${label}: ${title}${hasText(card.detail) ? ` — ${card.detail.trim()}` : ""}. Open detail.`}
      >
        {content}
      </button>
    </DetailCardShell>
  );
}

// Full-width inside a three-column track rather than an intrinsically sized pill, so the
// tiles are one size and the block reads as a grid instead of a ragged wrap. The 48px
// production tap height is unchanged.
const actChipClass = cn(
  "inline-flex min-h-12 w-full min-w-0 items-center justify-center rounded-md border border-[color:var(--border)] bg-[color:var(--surface)] px-1 text-xs font-semibold text-[color:var(--text-heading)]",
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]",
);

/**
 * Column count for the tile block, chosen so the last row is never a lone tile: four
 * tiles read better as 2x2 than as 3 + 1, and a form citing one or two sections gets
 * tiles that fill the card rather than a stub against empty space.
 */
function actTileColumns(tiles: number) {
  if (tiles <= 1) return "grid-cols-1";
  if (tiles === 2 || tiles === 4) return "grid-cols-2";
  return "grid-cols-3";
}

function ActSectionsCard({
  card,
  sections,
  onOpenSection,
  onOpenIndex,
}: {
  card: ServiceSummaryCard;
  sections: FormActSection[];
  onOpenSection: (section: string) => void;
  onOpenIndex: () => void;
}) {
  const groupLabelId = useId();
  // ACT_SECTION_CHIP_LIMIT is the number of tiles the block may show, not the number of
  // sections: two full rows of three. Form 4A cites nine sections, which used to render
  // as six chips plus a "+3" — seven tiles, so a ragged third row of one that made this
  // card 56px taller than it needed to be and set that height for the whole row. When
  // there is an overflow the last tile is spent on the "+n" control instead.
  const visible = sections.length > ACT_SECTION_CHIP_LIMIT ? sections.slice(0, ACT_SECTION_CHIP_LIMIT - 1) : sections;
  const overflow = sections.length - visible.length;
  // Say on the card face, not only inside the sheet, that these summaries carry no
  // clinician sign-off yet — otherwise the card reads as reviewed authority to anyone who
  // never opens a section.
  const awaitingReview = sections.some((entry) => entry.reviewStatus === "drafted");

  return (
    <DetailCardShell
      card={card}
      footer={awaitingReview ? "Tap a section — awaiting clinical review" : "Tap a section for authority detail"}
    >
      <h3
        id={groupLabelId}
        className="text-xs font-semibold leading-tight text-[color:var(--text-heading)] sm:text-sm sm:leading-5"
      >
        {hasText(card.title) ? card.title.trim() : "Authority under the Act"}
      </h3>
      <div
        className={cn("mt-1 grid gap-1", actTileColumns(visible.length + (overflow > 0 ? 1 : 0)))}
        role="group"
        aria-labelledby={groupLabelId}
      >
        {visible.map((entry) => (
          <button
            key={entry.section}
            type="button"
            onClick={() => onOpenSection(entry.section)}
            aria-haspopup="dialog"
            className={actChipClass}
            aria-label={`Section ${entry.section}: ${entry.title}. Open detail.`}
          >
            {entry.section}
          </button>
        ))}
        {overflow > 0 ? (
          <button
            type="button"
            onClick={onOpenIndex}
            aria-haspopup="dialog"
            className={actChipClass}
            aria-label={`Show all ${sections.length} Act sections. Open detail.`}
          >
            {`+${overflow}`}
          </button>
        ) : null}
      </div>
    </DetailCardShell>
  );
}

/** Shown when a section's summary has been invalidated by an Act version bump. */
function PendingSectionBody({ formCode, pdfHref }: { formCode?: string; pdfHref?: string }) {
  return (
    <div className="space-y-3">
      <p className="text-sm leading-6 text-[color:var(--text)]">
        A plain-English summary for this section has not been written yet. Read the section in the current consolidated
        Act, and confirm the requirement on the current approved form.
      </p>
      <ul className="space-y-1.5 text-sm leading-6">
        <li>
          <a
            className="text-[color:var(--clinical-accent)] underline underline-offset-2"
            href={mhaActMetadata.sourceUrl}
            target="_blank"
            rel="noreferrer"
          >
            {`Mental Health Act 2014 (WA), version ${mhaActMetadata.actVersion} as at ${mhaActMetadata.actAsAt}`}
          </a>
        </li>
        {pdfHref ? (
          <li>
            <a
              className="text-[color:var(--clinical-accent)] underline underline-offset-2"
              href={pdfHref}
              target="_blank"
              rel="noreferrer"
            >
              {formCode ? `Official Form ${formCode} PDF` : "Official form PDF"}
            </a>
          </li>
        ) : null}
      </ul>
    </div>
  );
}

type ActSheetState = { mode: "index" } | { mode: "section"; section: string } | null;

const CULTURAL_NOTE_ICONS: Record<FormCulturalNoteKind, typeof Languages> = {
  interpreter: Languages,
  "aboriginal-liaison": UserRound,
  statutory: BookOpenText,
};

/**
 * On a phone the notes are statutory quotes of 60–120 words each, and five of
 * them pushed the form's purpose and pathway about four screens down. Show the
 * first three lines with a "Show more" toggle there; wider screens show the full
 * text. The whole quote stays in the page for screen readers and find-in-page,
 * and no wording changes.
 */
function CulturalNoteText({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = text.trim().length > 160;
  return (
    <>
      <p
        className={cn(
          "mt-1 text-sm leading-6 text-[color:var(--text)]",
          !expanded && isLong ? "max-sm:line-clamp-3" : null,
        )}
      >
        {text}
      </p>
      {isLong ? (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
          className="-ml-1 inline-flex min-h-tap items-center px-1 text-sm font-semibold text-[color:var(--clinical-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)] sm:hidden"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      ) : null}
    </>
  );
}

/**
 * Interpreter and Aboriginal-liaison notes drafted for this form code, if any
 * exist in `data/forms-cultural-notes.json`. Deliberately plain rows rather
 * than another card grid or Sheet: there are at most a couple of notes per
 * form, so a heavier affordance would be decoration. While no note on the form
 * is signed off, one caption carries the "awaiting clinical review" caveat for
 * all of them; once any is signed, each note says for itself whether it was
 * reviewed (and by whom) or is still awaiting review.
 */
function CulturalNotesSection({ formCode }: { formCode: string | undefined }) {
  const notes = culturalNotesForForm(formCode);
  if (!notes.length) return null;
  // A note reads as signed off only when its sign-off names a real person and a date;
  // a product attribution ("PsychSift") keeps the awaiting-review wording.
  const signOffs = notes.map((note) => signOffDisplay(culturalNoteReviewer(note), note.reviewedAt));
  const anySigned = signOffs.some((signOff) => signOff.signedOff);

  return (
    <section
      id="form-cultural-notes"
      aria-label="Interpreter, Aboriginal liaison and Act notes"
      className={cn(inPageAnchor, "space-y-2")}
    >
      <h2 className="text-base-minus font-semibold leading-5 text-[color:var(--text-heading)] sm:text-base">
        Interpreter, Aboriginal liaison and Act notes
      </h2>
      <p className={cn("text-xs leading-5", textMuted)}>
        {anySigned
          ? "Drafted from the Mental Health Act 2014 and WA Health guidance."
          : "Drafted from the Mental Health Act 2014 and WA Health guidance — awaiting clinical review."}
      </p>
      <div className="grid gap-2">
        {notes.map((note, index) => {
          const Icon = CULTURAL_NOTE_ICONS[note.kind];
          return (
            <div
              key={`${note.kind}-${index}`}
              className="flex items-start gap-3 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-lux)] p-3"
            >
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]">
                <Icon className="h-4 w-4" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <p className="text-2xs font-bold uppercase leading-4 text-[color:var(--text-muted)]">
                  {CULTURAL_NOTE_LABELS[note.kind]}
                </p>
                <CulturalNoteText text={note.text} />
                {anySigned ? (
                  <p className={cn("mt-1 text-xs leading-5", textMuted)}>
                    {signOffs[index]?.signedOff ? `${signOffs[index].text}.` : "Awaiting clinical review."}
                  </p>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
      {notes.some((note) => note.kind === "aboriginal-liaison") ? (
        <Link
          href="/first-nations/mental-health"
          className="inline-flex min-h-12 items-center text-sm font-medium text-[color:var(--clinical-accent)] underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
        >
          Open First Nations mental health
        </Link>
      ) : null}
    </section>
  );
}

export function PriorityFactsSection({ form, cards }: { form: FormRecord; cards: ServiceSummaryCard[] }) {
  const details = formCatalogDetails(form);
  // catalogPayload arrives from the owner-record path as an unchecked cast, bypassing
  // the actSections() coercer, so a malformed stored entry must not render a bare chip.
  const actSections = (details?.actSections ?? []).filter((entry) => hasText(entry?.section) && hasText(entry?.title));
  const [activeFactId, setActiveFactId] = useState<string | null>(null);
  const [actSheet, setActSheet] = useState<ActSheetState>(null);

  const activeFact = activeFactId ? priorityFactBody(form, activeFactId) : null;
  const activeSection =
    actSheet?.mode === "section" ? (actSections.find((entry) => entry.section === actSheet.section) ?? null) : null;
  const pdfHref = details?.officialPdfUrl ?? details?.officialRegisterUrl;
  // Defaults to true for a payload with no review state: a missing status is a gap in the
  // record, not evidence of review, and an owner-seeded row can carry anything.
  const contentAwaitingReview = details?.contentReviewStatus !== "reviewed";

  return (
    <>
      <section
        id="form-priority-facts"
        aria-label="Priority facts"
        className={cn(inPageAnchor, "space-y-2.5 sm:space-y-3")}
      >
        <h2 className="text-base-minus font-semibold leading-5 text-[color:var(--text-heading)] sm:text-base">
          Priority facts
        </h2>
        {contentAwaitingReview ? (
          <p className={cn("text-xs leading-5", textMuted)}>
            Drafted from the Act and the approved form, awaiting clinical review.
          </p>
        ) : null}
        <div className="grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4">
          {cards.map((card) => {
            if (card.id === "act-sections" && actSections.length) {
              return (
                <ActSectionsCard
                  key={card.id}
                  card={card}
                  sections={actSections}
                  onOpenSection={(section) => setActSheet({ mode: "section", section })}
                  onOpenIndex={() => setActSheet({ mode: "index" })}
                />
              );
            }
            const detail = priorityFactBody(form, card.id);
            const hasDetail = hasExtraDetail(card, detail);
            return (
              <DetailCard
                key={card.id}
                card={card}
                hasDetail={hasDetail}
                onOpenDetail={hasDetail ? () => setActiveFactId(card.id) : undefined}
              />
            );
          })}
        </div>
      </section>

      <CulturalNotesSection formCode={details?.form} />

      <Sheet
        open={Boolean(activeFact)}
        onClose={() => setActiveFactId(null)}
        title={activeFact?.title?.trim() || "Priority fact"}
        description={activeFact?.detail}
        testId="form-priority-fact-sheet"
        mobilePlacement="bottom"
      >
        {activeFact ? (
          <div className="space-y-3">
            <p className="text-sm leading-6 text-[color:var(--text)]">{activeFact.body}</p>
            {contentAwaitingReview ? (
              <p className={cn("text-xs leading-5", textMuted)}>
                Drafted from the Act text and the approved form, and awaiting clinical review. Confirm against the
                current Act and approved form before clinical or legal use.
              </p>
            ) : null}
          </div>
        ) : null}
      </Sheet>

      <Sheet
        open={Boolean(actSheet)}
        onClose={() => setActSheet(null)}
        title={activeSection ? `Section ${activeSection.section}` : "Act sections"}
        description={
          activeSection?.title ??
          (details?.form ? `Form ${details.form} cites ${actSections.length} sections` : undefined)
        }
        testId="form-act-section-sheet"
        mobilePlacement="bottom"
      >
        {activeSection ? (
          <div className="space-y-3">
            {hasText(activeSection.summary) ? (
              <p className="text-sm leading-6 text-[color:var(--text)]">{activeSection.summary}</p>
            ) : (
              <PendingSectionBody formCode={details?.form} pdfHref={pdfHref} />
            )}
            {activeSection.reviewStatus === "drafted" ? (
              // The summary was written from the statutory text but carries no clinician
              // sign-off yet. Say so rather than let it read as reviewed clinical content.
              <p className={cn("text-xs leading-5", textMuted)}>
                Drafted from the Act text and awaiting clinical review.
              </p>
            ) : null}
            <p className={cn("text-xs leading-5", textMuted)}>
              Condensed reference from the Mental Health Act 2014 (WA). Confirm against the current Act and approved
              form before clinical or legal use.
            </p>
          </div>
        ) : actSheet?.mode === "index" ? (
          <ul className="space-y-1">
            {actSections.map((entry) => (
              <li key={entry.section}>
                <button
                  type="button"
                  onClick={() => setActSheet({ mode: "section", section: entry.section })}
                  className="w-full min-h-12 rounded-md px-2 py-1.5 text-left text-sm leading-6 text-[color:var(--text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
                >
                  <span className="font-semibold text-[color:var(--text-heading)]">{`Section ${entry.section}`}</span>
                  {` — ${entry.title}`}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </Sheet>
    </>
  );
}
