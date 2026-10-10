"use client";

import { onCallEntryAnchorId } from "@/components/on-call/on-call-page-anchors";

import { Info, Pencil } from "lucide-react";

import { cardPadding, cardSurface } from "@/components/card-recipes";
import { OnCallVerifyButton } from "@/components/on-call/on-call-verify-button";
import { OnCallStaleFlag } from "@/components/on-call/on-call-freshness-badge";
import { OnCallGroupSection } from "@/components/on-call/on-call-group-section";
import { allocateOnCallGroupSlug } from "@/components/on-call/on-call-page-anchors";
import { ON_CALL_COMPLIANCE_BANDS } from "@/components/on-call/on-call-page-sections";
import { OnCallPrivateFlag } from "@/components/on-call/on-call-private-flag";
import { ON_CALL_VIEW_ICONS } from "@/components/on-call/on-call-section-identity";
import { OnCallEmptyState } from "@/components/on-call/kit/empty-state";
import { ExternalTextLink } from "@/components/ui/link";
import { cn, metadataPillDensity, textMuted, toolbarButton } from "@/components/ui-primitives";
import {
  complianceConsequence,
  complianceExpiresOn,
  partitionLogisticsEntries,
  recordedExpiryHasPassed,
  sortComplianceEntries,
} from "@/lib/on-call/compliance";
import {
  ON_CALL_COMPLIANCE_PROVENANCE,
  isOnCallHttpUrl,
  onCallDetailsSchemaFor,
  onCallEntryFreshness,
  type OnCallComplianceConsequence,
  type OnCallComplianceProvenance,
  type OnCallEntry,
  onCallEntryIsEditable,
} from "@/lib/on-call/entry-model";
import { onCallTeachingDateParts } from "@/lib/on-call/teaching-schedule";
import { useOnlineStatus } from "@/lib/use-online-status";

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS PAGE NEVER RENDERS A VERDICT. Read this before changing any string here.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Nothing on this page is checked with the body that issues the requirement.
 * Every date shown is one the holder recorded, and the app cannot know about a
 * condition on a registration, a notification, a failed payment or a revoked
 * certificate. So no string, glyph or colour here may assert that the reader
 * IS anything — "compliant", "valid", "current", "up to date", or a tick that
 * stands in for one of those words.
 *
 * A clinical-governance review rejected an earlier design for exactly this, and
 * the wording is the control that keeps it rejected. Every line therefore reads
 * as a record of what was entered, when, and on whose word: "Recorded as
 * expiring 12 Mar 2027 · as you entered it". The judgement stays with the
 * person reading it, and `ComplianceScopeNote` below says so on the page
 * itself rather than leaving it implied.
 *
 * The one tick-shaped control on a row is On Call's existing "Still correct"
 * freshness stamp, which is a statement about when a HUMAN last looked at the
 * record — never about the requirement's standing. There is deliberately no
 * BULK version of it here: the mode's "Mark all as still correct" is withheld
 * from this page by `offersBulkVerify` in `on-call-section-page.tsx`, because
 * one tap clearing the "Never checked" warning off every requirement at once
 * is an assertion about a set of regulatory records the reader has not read.
 * See `src/lib/on-call/compliance.ts`, which owns the same rule for the data
 * layer.
 */

export interface OnCallComplianceSectionProps {
  entries: readonly OnCallEntry[];
  /** Injectable for deterministic tests; defaults to the real clock. */
  now?: Date;
  testId?: string;
  /** Opens the entry editor for this row. Omitted when the viewer cannot edit. */
  onEditEntry?: (entry: OnCallEntry) => void;
  /** One-tap "still correct today"; shown only on a stale entry. */
  onVerified?: (entry: OnCallEntry) => void;
  /** Whether to render a fallback badge for rows with missing or unreadable details. */
  fallbackBadge?: boolean;
}

/**
 * The compliance-bearing fields of `logisticsDetails` that this page paints.
 *
 * Narrowed by hand rather than inferred from the Zod schema because the page
 * reads four of that object's twelve keys, and naming them is what makes it
 * obvious at review time that nothing else on the row reaches the screen.
 *
 * Two keys the page DOES paint are deliberately absent, because they are read
 * per field instead of out of this object — see `parseComplianceDetails`.
 * `expiresOn` comes from `complianceExpiresOn`, so the date the page prints
 * and the date the sort ranks by can never come from two different readings of
 * the same row; `provenance` comes from `readProvenance`, so the qualifier can
 * never be separated from the date it qualifies.
 */
interface OnCallComplianceDetails {
  category: string;
  leadTimeDays?: number;
  issuingBody?: string;
  evidenceUrl?: string;
}

/**
 * The whole details object, or `null` when it does not satisfy the schema.
 *
 * All or nothing, and that is a real cost worth understanding before reading
 * anything off the result. `logisticsDetails` is `.strict()` and `category` is
 * required, so ONE bad or missing field invalidates the object entire: the
 * issuing body, the lead time and the evidence link all disappear together
 * from a row where eleven of twelve keys are perfectly good.
 *
 * Two fields are therefore read per field rather than from here — the expiry
 * and its provenance — because each validates itself (a `YYYY-MM-DD` match, an
 * enum membership test) and neither has any business depending on whether some
 * unrelated key parsed. That is not a convenience. A row that printed
 * "Recorded as expiring 12 Mar 2027" and silently dropped "· as you entered
 * it" would be this page asserting a date on nobody's authority, in exactly
 * the case where the stored row is least trustworthy.
 *
 * What a caller must NOT do is paper over a `null` with a plausible default.
 * The category pill used to fall back to "General" here, which invented a
 * filing the app had not read; the row now says it could not be read instead.
 */
function parseComplianceDetails(details: unknown): OnCallComplianceDetails | null {
  // Compliance rows ARE `logistics` rows — the discriminator is `details.kind`,
  // not the section — so the logistics schema is the right validator here.
  const result = onCallDetailsSchemaFor("logistics").safeParse(details);
  return result.success ? (result.data as OnCallComplianceDetails) : null;
}

/**
 * How the recorded date came to be believed, read straight off the row.
 *
 * The sibling of `complianceExpiresOn`, and written the same way for the same
 * reason: the date and the qualifier that makes it sayable have to travel
 * together, so neither may depend on the other eleven keys parsing. Membership
 * of the stored enum is the whole validation — an unrecognised value returns
 * `undefined` rather than being printed at the reader.
 *
 * It lives here rather than in `src/lib/on-call/compliance.ts` only because
 * that module was not in this change's scope; beside `complianceExpiresOn` is
 * where it belongs, and moving it there is the tidier end state.
 */
function readProvenance(details: unknown): OnCallComplianceProvenance | undefined {
  if (typeof details !== "object" || details === null) return undefined;
  const value = (details as { provenance?: unknown }).provenance;
  return ON_CALL_COMPLIANCE_PROVENANCE.find((candidate) => candidate === value);
}

/**
 * One line saying what a band actually means.
 *
 * The heading and the glyph are NOT here: `ON_CALL_COMPLIANCE_BANDS` owns
 * those, because the in-page header declares a jump target per band and one
 * character of difference between the heading rendered here and the heading
 * declared there is an anchor that does not exist. Only the sentence under the
 * heading is local, and it is local because it is prose the jump list has no
 * room for — "Stops part of your work" on its own invites the question "which
 * part?".
 *
 * Three lengths of the same idea, deliberately. The bar gets one word
 * (`band.barLabel`, "Partial"), the page gets the phrase (`band.heading`,
 * "Stops part of your work"), and the reader who has arrived gets the sentence
 * below. Only the shortest of the three is a navigation label; the page never
 * loses the phrase, because the phrase is the page's meaning.
 *
 * Keyed by the stored enum plus `null`, exactly as the declaration is, so the
 * two lists stay walkable side by side.
 */
const BAND_BLURBS: Record<OnCallComplianceConsequence, string> = {
  "stops-work": "Let one of these lapse and you cannot practise at all.",
  "stops-part": "You could still practise, but particular things would become unavailable.",
  chased: "Administrative. Nothing stops, but somebody will email.",
};

const UNRECORDED_BAND_BLURB =
  "Nobody has said what lapsing these costs, so they cannot be ranked against the bands above.";

/**
 * The tint a band's glyph carries.
 *
 * Reinforcement only. Every band already carries its own words and its own
 * glyph, so deleting every class in this map leaves all four exactly as
 * distinguishable — which is what the design-system rule that status is never
 * signalled by colour alone actually requires. The tint grades how bad the
 * LAPSE would be, which is a property of the requirement; it is never a
 * statement about whether the reader currently holds it.
 */
const BAND_TONES: Record<OnCallComplianceConsequence, string> = {
  "stops-work": "text-[color:var(--danger)]",
  "stops-part": "text-[color:var(--warning)]",
  chased: textMuted,
};

function bandBlurb(consequence: OnCallComplianceConsequence | null): string {
  return consequence ? BAND_BLURBS[consequence] : UNRECORDED_BAND_BLURB;
}

function bandTone(consequence: OnCallComplianceConsequence | null): string {
  return consequence ? BAND_TONES[consequence] : textMuted;
}

/**
 * How the recorded date came to be believed, in words.
 *
 * Every one of these is a statement about the reader's own act, never about
 * the requirement's standing — "as you confirmed it", not "confirmed". The
 * difference is the whole feature: the first describes something a person did,
 * the second would be the app vouching for a register it has never contacted.
 */
const PROVENANCE_PHRASES: Record<OnCallComplianceProvenance, string> = {
  confirmed: "as you confirmed it",
  typed: "as you entered it",
  "read-from-certificate": "read from a certificate",
};

/**
 * `YYYY-MM-DD` as "12 Mar 2027".
 *
 * The mode's own formatter, reused rather than reinvented: a second one here
 * would let two On Call pages write the same stored date two different ways,
 * and this string sits next to teaching dates in the same reader's week.
 * `formatClinicalDate` is deliberately not it — "12/03/2027" beside a
 * registration is exactly the ambiguity a compliance page cannot afford.
 */
function formatExpiry(date: string): string {
  const { day, month, year } = onCallTeachingDateParts(date);
  if (!day || !month) return date;
  return `${day} ${month} ${year}`;
}

/**
 * The sentence that keeps this page honest, stated on the page rather than
 * buried in a help sheet.
 *
 * It is rendered unconditionally — above the empty state as well as above a
 * full list — because a reader who has just added their first requirement is
 * precisely the reader who has not yet been told what this page does and does
 * not know.
 *
 * `Info` rather than a shield carrying a tick: set beside the sentence
 * "nothing here is checked", that is a glyph arguing with its own caption, and
 * on a page whose one rule is that it renders no verdict a tick is the last
 * mark this note should wear. The view's own glyph is checkmark-free for the
 * same reason (`ON_CALL_VIEW_ICONS`), but this note keeps `Info` because it is
 * a note rather than the page's identity.
 *
 * ## The second sentence, and why it is conditional
 *
 * `allPrivate` adds one line saying the whole page is withheld. It is the
 * page-level replacement for a "Private" pill on every single row: once every
 * requirement is private by construction, eight identical pills are noise, and
 * a fact true of the whole page belongs in the note that already says what
 * this page is.
 *
 * It is conditional for the same reason Admin's group note is
 * (`on-call-logistics-section.tsx`): a blanket privacy claim over a page that
 * holds even one shared row is false, and false in the direction that matters
 * most here. So the sentence appears only when every row on the page really is
 * private, and any row that is not brings its own pill back.
 */
function ComplianceScopeNote({ allPrivate }: { allPrivate: boolean }) {
  return (
    <p
      data-testid="on-call-compliance-scope-note"
      className={cn(
        "flex items-start gap-2 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-inset)] p-3 text-xs leading-5",
        textMuted,
      )}
    >
      <Info aria-hidden="true" className="mt-0.5 size-icon-sm shrink-0" />
      <span>
        <b className="text-[color:var(--text-heading)]">Nothing here is checked with the issuing body.</b> These are the
        dates you recorded, shown back to you with who you recorded them from. Whether you actually hold a requirement
        today is a question only Ahpra, your insurer or your health service can answer.
        {allPrivate ? (
          <>
            {" "}
            Every requirement on this page is private: it stays off the page other people read, and off the printed
            card.
          </>
        ) : null}
      </span>
    </p>
  );
}

/**
 * One requirement, as a record of what was entered.
 *
 * Deliberately NOT an `OnCallEntryRow`: that component makes the whole row a
 * single tap target pointing at a phone number, which is right for Contacts
 * and meaningless here. A requirement is read, not dialled, and the two things
 * a reader might actually tap — the evidence link and the edit control — are
 * separate controls rather than one row-sized one.
 */
function ComplianceRow({
  entry,
  now,
  onEditEntry,
  onVerified,
  privacyStatedOnPage,
  fallbackBadge,
}: {
  entry: OnCallEntry;
  now: Date;
  onEditEntry?: (entry: OnCallEntry) => void;
  onVerified?: (entry: OnCallEntry) => void;
  /**
   * Whether the scope note has already said the whole page is private. When it
   * has, the row drops its own pill — the fact is true of every row here, and
   * eight identical pills say it eight times.
   */
  privacyStatedOnPage: boolean;
  fallbackBadge?: boolean;
}) {
  const details = parseComplianceDetails(entry.details);
  const freshness = onCallEntryFreshness(entry, now);
  const showVerify = freshness.state === "stale" && Boolean(onVerified);
  // Read through the same helper the sort uses, so the row that renders the
  // prompt below is exactly the row the sort has put last.
  const consequence = complianceConsequence(entry);
  // Read through the shared helper rather than off `details`, so the page and
  // the sort agree about which rows have a usable date. The helper rejects a
  // malformed value; a row whose date it rejects says "No expiry recorded"
  // instead of printing something unparseable back at the reader.
  const expiresOn = complianceExpiresOn(entry);
  const expiryPassed = recordedExpiryHasPassed(entry, now);
  // Off the row, never off `details`. Both readings validate themselves, and
  // reading the qualifier out of the all-or-nothing parse is what let a date
  // appear here with no account of where it came from.
  const provenance = readProvenance(entry.details);
  // The details object exists and marks this row as a requirement — that is
  // how it reached this page at all — but it does not satisfy the schema.
  const detailsUnreadable = details === null;

  return (
    <article
      id={onCallEntryAnchorId(entry.id)}
      tabIndex={-1}
      className={cn(cardSurface, cardPadding.standard, "grid grid-cols-[minmax(0,1fr)] gap-2")}
      data-on-call-entry-card=""
      data-testid={`on-call-compliance-row-${entry.slug}`}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1 grid gap-0.5">
          <h4 className="text-base font-semibold text-[color:var(--text-heading)]">{entry.title}</h4>
          {/* The issuing body is the answer to "who do I chase?", which is the
              only useful next step this page can offer — it cannot chase them
              for you. */}
          {details?.issuingBody ? <p className={cn(textMuted, "text-xs")}>Issued by {details.issuingBody}</p> : null}
        </div>
        {/* Outside the text column rather than inside it, so a long
            requirement name wraps instead of squeezing the two controls, and
            so neither control can ever end up nested in the evidence link
            below — a `<button>` inside an `<a>` is invalid, duplicate-
            interactive markup. */}
        {onEditEntry || showVerify ? (
          <div className="flex shrink-0 items-center gap-1.5">
            {showVerify && onVerified ? <OnCallVerifyButton entry={entry} onVerified={onVerified} /> : null}
            {onEditEntry ? (
              <button
                type="button"
                onClick={() => onEditEntry(entry)}
                aria-label={`Edit ${entry.title}`}
                data-testid={`on-call-compliance-edit-${entry.slug}`}
                className={cn(toolbarButton, "shrink-0")}
              >
                <Pencil aria-hidden className="h-4 w-4" />
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* A row whose details the schema rejects says so, rather than looking
          complete while three fields are quietly missing.
          -------------------------------------------------------------------
          Measured on a row missing only the required `category`: the issuing
          body, the lead-time pill and the evidence link all vanished at once,
          and the category pill printed an invented "General". Nothing on the
          row said anything was wrong.

          What it does NOT do is withhold the date. That instinct is wrong
          here and this mode has already written down why — a manual dropped
          from Orientation for want of a folder is called "the mode's own
          worst failure: a manual withheld because of a missing field", and
          hiding a recorded registration expiry because an unrelated key is
          malformed is that failure on the page where being late costs most.
          The date and its provenance each validate themselves, so they are
          shown; what the page could not read, it says it could not read. */}
      {detailsUnreadable ? (
        <p data-testid={`on-call-compliance-unreadable-${entry.slug}`} className={cn(textMuted, "text-sm leading-6")}>
          <b className="text-[color:var(--text-heading)]">Part of this entry could not be read.</b> Some of what you
          recorded is missing from this row — open it to repair it.
        </p>
      ) : null}

      {/* The date, phrased as a record and never as a state. "Recorded as
          expiring" is a sentence about a row in a database; "expires" would be
          a sentence about the reader's legal standing, which this app has no
          way of knowing. The provenance rides in the same line so a date
          nobody has looked at since it was typed can never be read without
          that fact attached. */}
      <p className="text-sm leading-6 text-[color:var(--text)]">
        {expiresOn ? `Recorded as expiring ${formatExpiry(expiresOn)}` : "No expiry recorded"}
        {/* Still a sentence about the row, not about the reader. "That date
            has passed" is arithmetic on a stored string; "expired" or "lapsed"
            would be the app ruling on a standing it has never checked, and the
            reader may have renewed the thing last week without coming back to
            edit the row. Carried in words rather than a colour or a glyph,
            because a reader scanning eight requirements should not have to do
            date arithmetic on each one — which is the whole reason they opened
            this page. */}
        {expiryPassed ? (
          <span
            data-testid={`on-call-compliance-passed-${entry.slug}`}
            className="font-semibold text-[color:var(--text-heading)]"
          >
            {" — that date has passed"}
          </span>
        ) : null}
        {provenance ? <span className={cn(textMuted, "text-xs")}> · {PROVENANCE_PHRASES[provenance]}</span> : null}
      </p>

      {/* The prompt on an unranked row.
          -------------------------------------------------------------------
          `consequence` is optional and "Not recorded" is a real answer in the
          editor, so this is never a required field and never an error. But
          the page ranks by consequence, and a row with none sorts last — so
          the shipped demo puts a national police clearance, which in WA can
          genuinely stop somebody working, below three training modules whose
          own band says somebody will email. The band's prose is honest;
          its POSITION is a ranking, and the reader cannot see that the
          ranking is an absence rather than a judgement.

          One line, on the row, fixes that without touching the sort. It is a
          question to the reader about the REQUIREMENT, never a statement
          about the holder — this page may not say anyone is behind on
          anything — and the second half explains the position rather than
          warning about it.

          Suppressed on an unreadable row: the line above already asks the
          reader to open the entry, and two prompts to do one thing is how a
          row starts nagging. */}
      {consequence || detailsUnreadable ? null : (
        <p data-testid={`on-call-compliance-unranked-${entry.slug}`} className={cn(textMuted, "text-sm leading-6")}>
          What happens if this one lapses? Until that is recorded, the row sits last.
        </p>
      )}

      {/* `body` is the holder's own note about the requirement — what the
          renewal involves, which reference number it sits under. Owner-authored
          administrative fact; nothing here is app-authored. */}
      {entry.body ? <p className="text-sm leading-6 text-[color:var(--text)]">{entry.body}</p> : null}

      <div className="flex flex-wrap items-center gap-1.5">
        {/* Only a category the page actually read. The fallback that used to
            sit here printed "General" on a row whose filing the app had not
            managed to read — a pill the owner never typed, indistinguishable
            from one they did. */}
        {details?.category ? (
          <span className={cn(metadataPillDensity.standard, "rounded-full")}>{details.category}</span>
        ) : fallbackBadge ? (
          <span className={cn(metadataPillDensity.standard, "rounded-full")}>General Requirement</span>
        ) : null}
        {/* Lead time is per requirement because the real ones differ by
            months — a police check is not a form you submit the week it
            expires — so a uniform "renew 30 days out" would be wrong for most
            rows on the page. */}
        {typeof details?.leadTimeDays === "number" ? (
          <span className={cn(metadataPillDensity.standard, "nums rounded-full")}>
            {`Start ${details.leadTimeDays} ${details.leadTimeDays === 1 ? "day" : "days"} ahead`}
          </span>
        ) : null}
        {/* Only when the page has NOT already said it. Every compliance row
            is written private, so on a normal page this pill would repeat one
            fact on every row; the scope note says it once instead. A page
            holding even one shared row drops that blanket claim, and then the
            pill is back to mark which rows are withheld — the same rule
            Admin's group note follows. */}
        {entry.isPersonal && !privacyStatedOnPage ? <OnCallPrivateFlag compact /> : null}
        <OnCallStaleFlag freshness={freshness} />
      </div>

      {isOnCallHttpUrl(details?.evidenceUrl) ? (
        // A link the holder owns, not an upload: the default upload path
        // indexes a document and sends it to a provider, and a registration
        // certificate is identity data with no business in the clinical corpus.
        // Marked as leaving the app by `ExternalTextLink`, never a bare anchor.
        <ExternalTextLink href={details.evidenceUrl} className="min-h-tap items-center text-xs">
          Your evidence
        </ExternalTextLink>
      ) : null}
    </article>
  );
}

/**
 * Compliance — the requirements a doctor keeps current for themselves:
 * registration, indemnity, mandatory training, credentialing, CPD.
 *
 * These are `logistics` rows carrying `details.kind: "compliance"`, so they
 * need no new section value and therefore no migration — the same route Who's
 * who took out of `contacts`. `partitionLogisticsEntries` is the one place they
 * are separated from ordinary Admin rows, and `sortComplianceEntries` is the
 * one place their order is decided.
 *
 * The page groups by CONSEQUENCE, worst first, and never by date. Every
 * compliance tracker ever built is a list sorted by expiry, which puts a
 * lapsed fire-safety module and a lapsed registration in the same bucket when
 * only one of them stops you working. Ordering by what lapsing costs is what
 * keeps the page readable on the morning eleven things are overdue at once.
 */
export function OnCallComplianceSection({
  entries,
  now = new Date(),
  testId = "on-call-compliance-section",
  onEditEntry,
  onVerified,
  fallbackBadge = false,
}: OnCallComplianceSectionProps) {
  const { compliance } = partitionLogisticsEntries(entries);

  /**
   * Whether every row on this page is withheld from everyone but the owner.
   *
   * True by construction in normal use — a compliance requirement is written
   * private, because a named doctor's registration, indemnity, credentialing
   * and clearances are an identity record and not the ward numbers the shared
   * read was opened up for. Computed from the rows anyway rather than assumed,
   * so a row saved before that rule, or one the owner deliberately unticks,
   * cannot be swept under a page-level claim that would then be false.
   *
   * Empty page: no rows, so no claim. The scope note keeps only the sentence
   * about what this page does not know.
   */
  const allPrivate = compliance.length > 0 && compliance.every((entry) => entry.isPersonal);
  const isOffline = !useOnlineStatus();

  if (compliance.length === 0) {
    return (
      <div data-testid={testId} className="grid grid-cols-[minmax(0,1fr)] gap-3">
        <ComplianceScopeNote allPrivate={allPrivate} />
        {/* The view's own glyph, read from the one map that owns it rather
            than named again here — the loading state above this list and the
            nav rail read the same entry, and a second literal is how one
            surface keeps the old mark after the other is changed. That map's
            note explains why the mark carries no tick: a shield with a tick,
            twelve lines below a sentence reading "nothing here is checked",
            is a glyph arguing with its own caption. */}
        <OnCallEmptyState
          icon={ON_CALL_VIEW_ICONS.compliance}
          title={isOffline ? "Personal compliance records need a connection" : "No requirements recorded yet"}
          // `onEditEntry` is passed only to a signed-in reader, and compliance
          // rows are never shared, so a signed-out reader always lands here and
          // cannot add anything: tell them what would let them.
          body={
            isOffline
              ? "Your compliance records are private to your account and never cached offline. Connect to the internet to review or record them."
              : onEditEntry
                ? "Registration, indemnity, credentialing, mandatory training and CPD. Add one from this page and it appears here, grouped by what happens if it lapses — with the date you recorded, and where you recorded it from."
                : "Registration, indemnity, credentialing, mandatory training and CPD. These are private to your account, so sign in to record yours and see them here, grouped by what happens if it lapses."
          }
          testId="on-call-compliance-empty"
        />
      </div>
    );
  }

  const sorted = sortComplianceEntries(compliance);

  // Slugs allocated by walking `ON_CALL_COMPLIANCE_BANDS` in order and skipping
  // the empty bands — the identical walk `complianceGroups` makes to declare
  // the jump list. Same list, same order, same skip rule, same `taken` seeding,
  // same source string (`heading`), so the anchor a heading carries here is the
  // anchor the header declares for it. Anything cleverer on this side is a jump
  // list row that goes nowhere.
  //
  // Rows keep the order `sortComplianceEntries` put them in; filtering
  // preserves it, and re-sorting inside a band would quietly override the
  // expiry-then-title tiebreak that keeps the list stable between renders.
  const takenSlugs = new Set<string>();
  const groups = ON_CALL_COMPLIANCE_BANDS.map((band) => ({
    band,
    entries: sorted.filter((entry) => (complianceConsequence(entry) ?? null) === band.consequence),
  }))
    .filter((group) => group.entries.length > 0)
    // From `heading`, never from `barLabel`. The declaration slugs the heading
    // too, so the id is unchanged by the bar carrying a shorter word.
    .map((group) => ({ ...group, slug: allocateOnCallGroupSlug(group.band.heading, takenSlugs) }));

  return (
    <div data-testid={testId} className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <ComplianceScopeNote allPrivate={allPrivate} />
      {groups.map(({ band, entries: bandEntries, slug }) => {
        const BandIcon = band.icon;
        return (
          <OnCallGroupSection
            key={band.heading}
            // The full phrase, always. `barLabel` is for the 48px navigation
            // row and has no business being a heading — "Blocking" above a
            // registration renewal does not say what is blocked.
            label={band.heading}
            slug={slug}
            count={bandEntries.length}
            headingId={`on-call-compliance-${slug}-heading`}
            testId={`on-call-compliance-group-${slug}`}
          >
            {/* The glyph and the sentence sit under the heading rather than
                in it. `OnCallGroupSection` owns the heading, and it is the
                same eyebrow every other On Call group wears — a band must not
                end up looking like a different kind of thing from an Admin
                category. This line is body prose, so it is not dressed as a
                second kicker. */}
            <p className={cn(textMuted, "flex items-start gap-1.5 text-xs leading-5")}>
              <BandIcon aria-hidden="true" className={cn("mt-0.5 size-icon-sm shrink-0", bandTone(band.consequence))} />
              <span>{bandBlurb(band.consequence)}</span>
            </p>
            {bandEntries.map((entry) => (
              <ComplianceRow
                key={entry.id}
                entry={entry}
                now={now}
                onEditEntry={onCallEntryIsEditable(entry) ? onEditEntry : undefined}
                onVerified={onCallEntryIsEditable(entry) ? onVerified : undefined}
                privacyStatedOnPage={allPrivate}
                fallbackBadge={fallbackBadge}
              />
            ))}
          </OnCallGroupSection>
        );
      })}
    </div>
  );
}
