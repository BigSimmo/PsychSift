import type { Metadata } from "next";

import { PanelPageShell } from "@/components/developer-area/hub/panel-page-shell";
import { CARD_CLASS, CountTile, META_CLASS, PanelSection } from "@/components/developer-area/hub/panel-primitives";
import {
  resolveCorpusHealth,
  resolveQualitySpread,
  SAMPLE_LIMIT,
  type CorpusHealth,
  type QualitySpread,
} from "@/lib/developer-area/corpus-health";
import { resolveLiveFreshness } from "@/lib/developer-area/freshness";

export const metadata: Metadata = {
  title: "Corpus health · Developer · PsychSift",
  description: "Which documents finished indexing and produced nothing usable — read live from your own library.",
};

/**
 * A count that may not have been read. `CountTile` takes a `number`, and passing
 * it a `0` for a read that failed is the single mistake this whole panel is
 * built to avoid — on this page zero means "nothing is broken", which is the
 * reassuring answer. So an absent count renders as words instead of a digit.
 *
 * Deliberately local rather than added to `panel-primitives`: this is the only
 * panel whose numbers come from a live database read and can therefore be
 * missing. Promote it there the day a second page needs it, not before.
 */
function ReadingTile({ testId, value, label }: { testId: string; value: number | null; label: string }) {
  if (value !== null) return <CountTile testId={testId} value={value} label={label} />;

  return (
    <div data-testid={testId} className={CARD_CLASS}>
      <span data-testid={`${testId}-value`} className="text-sm font-extrabold text-[color:var(--text-muted)]">
        Not read
      </span>
      <span className={META_CLASS}>{label}</span>
    </div>
  );
}

/** `12` when the count was read, `not read` when it was not. Never `0` for the latter. */
function heading(label: string, count: number | null): string {
  return `${label} · ${count === null ? "not read" : count}`;
}

/**
 * The quality scores in one sentence, or the several sentences the awkward
 * readings need.
 *
 * The `uniform` branch is the point of the whole section. A column that defaults
 * to `0` and a scorer that never ran produce a perfectly tidy-looking
 * distribution, and a panel that renders it as though it measured something is
 * worse than a panel with no quality section at all.
 */
function QualitySpreadNote({ spread }: { spread: QualitySpread }) {
  return (
    <p data-testid="developer-corpus-health-quality-spread" className="text-sm leading-6 text-[color:var(--text)]">
      {spread.kind === "unreadable" ? (
        <>The quality scores could not be read, so nothing on this page describes them.</>
      ) : null}
      {spread.kind === "none" ? (
        <>
          No quality row exists for any document you own. That is a gap in what indexing recorded rather than a clean
          bill of health — there is nothing here to be good or bad.
        </>
      ) : null}
      {spread.kind === "single" ? (
        <>One document carries a quality score ({spread.score.toFixed(2)}). One row is not a distribution.</>
      ) : null}
      {spread.kind === "uniform" ? (
        <>
          <strong className="font-extrabold text-[color:var(--text-heading)]">
            All {spread.documents} scored documents carry the identical score {spread.score.toFixed(2)}.
          </strong>{" "}
          A single repeated value cannot rank or separate anything, so the quality figures on this page are not usable
          as a measure of any document. That is not by itself evidence that scoring is broken: the score starts at 1.00
          and only subtracts penalties, so a corpus that extracted cleanly can legitimately land on the same value for
          every document. Read the issues and metrics on the rows below before concluding anything about the scorer.
          {spread.score === 0 ? (
            <>
              {" "}
              Zero is also this column&rsquo;s default, so this reading is what a corpus that was never scored looks
              like.
            </>
          ) : null}
        </>
      ) : null}
      {spread.kind === "varied" ? (
        <>
          Scores run from {spread.lowest.toFixed(2)} to {spread.highest.toFixed(2)} across {spread.documents} scored
          documents.
        </>
      ) : null}
    </p>
  );
}

function UnreadNotice() {
  return (
    <div
      data-testid="developer-corpus-health-unread"
      className="grid gap-2 rounded-xl border border-[color:var(--border)] p-4"
    >
      <p className="text-sm leading-6 text-[color:var(--text-heading)]">Nothing was read.</p>
      <p className={META_CLASS}>
        Either this environment has no Supabase configuration — the demo corpus, which has no document rows to report —
        or the request carried no signed-in session. Read this as an absence of information, never as a healthy library:
        a page that read nothing cannot tell you that nothing is broken.
      </p>
    </div>
  );
}

export default async function DeveloperCorpusHealthPage() {
  const health: CorpusHealth = await resolveCorpusHealth();
  const spread = resolveQualitySpread(health.quality);
  const { statuses, unsearchable, failures, quality } = health;

  return (
    <PanelPageShell
      testId="developer-corpus-health"
      title="Corpus health"
      /*
       * Live, like the ingestion panel and unlike the snapshot-backed panels:
       * every number below is read from the database on this request, so
       * stamping it with the build time would misdate it by however long ago
       * the deployment happened.
       */
      freshness={resolveLiveFreshness(null, new Date())}
      freshnessLabel="Your library"
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <ReadingTile testId="developer-corpus-health-count-indexed" value={statuses.indexed} label="indexed" />
        <ReadingTile testId="developer-corpus-health-count-failed" value={statuses.failed} label="failed" />
        <ReadingTile testId="developer-corpus-health-count-processing" value={statuses.processing} label="processing" />
        <ReadingTile testId="developer-corpus-health-count-queued" value={statuses.queued} label="queued" />
      </div>

      {/*
       * The scope statement is page content and sits above the evidence, not
       * under it. Everything below reports what indexing *produced*; a reader
       * who stops after the first healthy-looking section must already have
       * read what that does not prove.
       */}
      <p className={META_CLASS}>
        Read live from your own library: every query is scoped to the account you are signed in as via an explicit owner
        filter on the server-only admin path, so these are your documents rather than the database&rsquo;s. Every figure
        describes what indexing <em>produced</em> — whether a document finished, and whether it left anything behind.
        Nothing here reads answer quality, retrieval accuracy, or whether the extracted text is correct, so an empty
        page below means indexing ran to completion, not that the answers are good.
      </p>

      {health.read ? null : <UnreadNotice />}

      <PanelSection
        testId="developer-corpus-health-unsearchable"
        headingId="developer-corpus-health-unsearchable-heading"
        heading={heading("Finished but unsearchable", unsearchable.count)}
      >
        <p className={META_CLASS}>
          Documents whose status is <strong className="font-extrabold">indexed</strong> and whose chunk count is zero:
          they completed without leaving a single text chunk, which is the unit ordinary retrieval matches against.
          Other index units and page images may still exist for them, so read this as a strong signal of a broken
          extraction rather than proof that nothing about the document is reachable.
        </p>
        {unsearchable.count === null ? (
          <div className={CARD_CLASS}>
            <p className="text-sm leading-6 text-[color:var(--text-heading)]">This count could not be read.</p>
            <p className={META_CLASS}>Not the same as zero, and it must not be read as zero.</p>
          </div>
        ) : unsearchable.count === 0 ? (
          <div data-testid="developer-corpus-health-unsearchable-empty" className={CARD_CLASS}>
            <p className="text-sm leading-6 text-[color:var(--text-heading)]">
              No indexed document is missing its text chunks.
            </p>
            <p className={META_CLASS}>
              The test is chunk count alone. A document can hold chunks that are empty, mis-extracted, or unhelpful and
              still pass this one, so an empty list is the absence of the worst failure rather than proof of a good
              index.
            </p>
          </div>
        ) : (
          <ul className="grid gap-2">
            {unsearchable.sample.map((document) => (
              <li
                key={document.id}
                data-testid={`developer-corpus-health-unsearchable-${document.id}`}
                className={CARD_CLASS}
              >
                <p className="text-sm font-extrabold leading-6 text-[color:var(--text-heading)]">{document.title}</p>
                <p className={META_CLASS}>
                  {document.pageCount} {document.pageCount === 1 ? "page" : "pages"} · {document.imageCount}{" "}
                  {document.imageCount === 1 ? "image" : "images"} · no text chunks · {document.id}
                </p>
              </li>
            ))}
          </ul>
        )}
        {unsearchable.count !== null && unsearchable.count > SAMPLE_LIMIT ? (
          <p className={META_CLASS}>
            Showing the {SAMPLE_LIMIT} most recently updated of {unsearchable.count}.
          </p>
        ) : null}
      </PanelSection>

      <PanelSection
        testId="developer-corpus-health-failures"
        headingId="developer-corpus-health-failures-heading"
        heading={heading("Failed", failures.count)}
      >
        {failures.count === null ? (
          <div className={CARD_CLASS}>
            <p className="text-sm leading-6 text-[color:var(--text-heading)]">This count could not be read.</p>
            <p className={META_CLASS}>Not the same as zero, and it must not be read as zero.</p>
          </div>
        ) : failures.count === 0 ? (
          <div data-testid="developer-corpus-health-failures-empty" className={CARD_CLASS}>
            <p className="text-sm leading-6 text-[color:var(--text-heading)]">No document is in the failed state.</p>
            <p className={META_CLASS}>
              This is the current state, not a history: a document that failed and was later reindexed successfully
              leaves nothing behind here.
            </p>
          </div>
        ) : (
          <ul className="grid gap-2">
            {failures.sample.map((document) => (
              <li
                key={document.id}
                data-testid={`developer-corpus-health-failure-${document.id}`}
                className={CARD_CLASS}
              >
                <p className="text-sm font-extrabold leading-6 text-[color:var(--text-heading)]">{document.title}</p>
                <p className="text-sm leading-6 text-[color:var(--text)]">
                  {/*
                   * `error_message` is nullable, and an empty string reads as a
                   * blank line rather than as a missing reason. Both say so.
                   */}
                  {document.errorMessage?.trim() ? document.errorMessage : "No reason was recorded."}
                </p>
                <p className={META_CLASS}>{document.id}</p>
              </li>
            ))}
          </ul>
        )}
        {failures.count !== null && failures.count > SAMPLE_LIMIT ? (
          <p className={META_CLASS}>
            Showing the {SAMPLE_LIMIT} most recently updated of {failures.count}.
          </p>
        ) : null}
      </PanelSection>

      <PanelSection
        testId="developer-corpus-health-quality"
        headingId="developer-corpus-health-quality-heading"
        heading={heading("Extraction quality", quality.scored)}
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <ReadingTile testId="developer-corpus-health-quality-good" value={quality.extraction.good} label="good" />
          <ReadingTile
            testId="developer-corpus-health-quality-partial"
            value={quality.extraction.partial}
            label="partial"
          />
          <ReadingTile testId="developer-corpus-health-quality-poor" value={quality.extraction.poor} label="poor" />
          <ReadingTile
            testId="developer-corpus-health-quality-unknown"
            value={quality.extraction.unknown}
            label="unknown"
          />
        </div>

        <QualitySpreadNote spread={spread} />

        <p className={META_CLASS}>
          These rows come from the index-quality table, which the indexer writes one row per document into. Its score
          column defaults to <strong className="font-extrabold">0</strong> and its label to{" "}
          <strong className="font-extrabold">unknown</strong>, so a row carrying those values may never have been scored
          at all rather than having scored badly. Its owner column is also nullable while this panel filters on it, so a
          row written without an owner is invisible here — which is one honest reason this total can sit below the
          indexed count without anything being wrong.
        </p>

        {quality.lowest.length > 0 ? (
          <>
            <p className="text-xs font-bold text-[color:var(--text-muted)]">Lowest scoring, worst first</p>
            <ul className="grid gap-2">
              {quality.lowest.map((document) => (
                <li
                  key={document.documentId}
                  data-testid={`developer-corpus-health-low-${document.documentId}`}
                  className={CARD_CLASS}
                >
                  <p className="text-sm font-extrabold leading-6 text-[color:var(--text-heading)]">
                    {document.score.toFixed(2)} · {document.extractionQuality}
                  </p>
                  <p className={META_CLASS}>
                    {document.issues.length > 0 ? document.issues.join(", ") : "No issues recorded."}
                  </p>
                  <p className={META_CLASS}>{document.documentId}</p>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </PanelSection>
    </PanelPageShell>
  );
}
