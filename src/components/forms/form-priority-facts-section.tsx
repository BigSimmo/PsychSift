"use client";

import Link from "next/link";
import { BookOpenText, Languages, UserRound } from "lucide-react";
import { useId, useState } from "react";

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
 * Whether the longer wording says anything the fact's title does not.
 *
 * On a form whose catalogue row is boilerplate, the clock fact's title IS its whole
 * body, so the body is not printed a second time. The authority fact composes maker +
 * authorises + does-not-authorise, which is strictly more than its title on every form.
 */
function hasExtraDetail(card: ServiceSummaryCard, detail: { body: string } | null) {
  const body = detail?.body?.trim();
  if (!body) return false;
  return body !== (card.title ?? "").trim();
}

/**
 * One label/value pair in the At a glance card, shown in full.
 *
 * The longer wording used to sit behind "Tap for detail" in a sheet; the shared record
 * layout shows it whole under the title instead, so nothing on the screen a clinician
 * reads first is cut short.
 */
function GlanceFact({ card, body }: { card: ServiceSummaryCard; body: string | null }) {
  const label = hasText(card.label) ? card.label.trim() : "Priority fact";
  const title = hasText(card.title) ? card.title.trim() : "";
  return (
    <div className={cn("flex min-w-0 flex-col gap-0.5", body && "@[15rem]:col-span-2")}>
      <dt className="text-xs text-[color:var(--text-muted)]">{label}</dt>
      <dd className="m-0 min-w-0 break-words">
        <h3 className="m-0 text-sm font-semibold leading-6 text-[color:var(--text-heading)]">{title}</h3>
        {/* Rendered only when there is a sub-line. The 34 forms with no indexed clock cue
            used to print "Not listed" here, which reads as a fact about the form rather
            than an absence of one, and there is no honest substitute in the catalogue. */}
        {hasText(card.detail) ? (
          <p className={cn("m-0 text-xs font-medium leading-5", textMuted)}>{card.detail.trim()}</p>
        ) : null}
        {body ? <p className="m-0 mt-1.5 text-sm leading-6 text-[color:var(--text)]">{body}</p> : null}
      </dd>
    </div>
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
    <div className="flex min-w-0 flex-col gap-0.5 @[15rem]:col-span-2">
      <dt className="text-xs text-[color:var(--text-muted)]">
        {hasText(card.label) ? card.label.trim() : "Act sections"}
      </dt>
      <dd className="m-0 min-w-0">
        <h3 id={groupLabelId} className="m-0 text-sm font-semibold leading-6 text-[color:var(--text-heading)]">
          {hasText(card.title) ? card.title.trim() : "Authority under the Act"}
        </h3>
        <div
          className={cn("mt-1.5 grid max-w-sm gap-1.5", actTileColumns(visible.length + (overflow > 0 ? 1 : 0)))}
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
        <p className={cn("m-0 mt-1.5 text-xs font-medium leading-5", textMuted)}>
          {awaitingReview ? "Tap a section — awaiting clinical review" : "Tap a section for authority detail"}
        </p>
      </dd>
    </div>
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
export function CulturalNotesSection({ formCode }: { formCode: string | undefined }) {
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
  const [actSheet, setActSheet] = useState<ActSheetState>(null);

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
        className={cn(
          inPageAnchor,
          "@container rounded-2xl border border-[color:var(--clinical-accent-border)] bg-[color:color-mix(in_srgb,var(--clinical-accent-soft)_55%,var(--surface))] p-5",
        )}
      >
        <h2 className="m-0 text-xs font-bold text-[color:var(--clinical-accent)]">At a glance</h2>
        {contentAwaitingReview ? (
          <p className={cn("m-0 mt-1 text-xs leading-5", textMuted)}>
            Drafted from the Act and the approved form, awaiting clinical review.
          </p>
        ) : null}
        <dl className="m-0 mt-3.5 grid grid-cols-1 gap-x-5 gap-y-4 @[15rem]:grid-cols-2">
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
            return <GlanceFact key={card.id} card={card} body={hasExtraDetail(card, detail) ? detail!.body : null} />;
          })}
        </dl>
        {contentAwaitingReview ? (
          // The full wording used to carry this caveat inside its detail sheet; it now
          // sits with the full wording on the card.
          <p className={cn("m-0 mt-4 text-xs leading-5", textMuted)}>
            Confirm against the current Act and approved form before clinical or legal use.
          </p>
        ) : null}
      </section>

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
