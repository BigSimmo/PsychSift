// Server component: the titled modules of an inner page, drawn from the view-model.
import { ArrowUpRight, Ban, Check } from "lucide-react";
import type { ReactNode } from "react";
import { CopyNoteWording } from "@/components/first-nations/copy-note-wording";
import { ContactReviewLine } from "@/components/first-nations/review-line";
import { ReviewStamp } from "@/components/first-nations/review-stamp";
import type { ReviewStamp as ReviewStampData } from "@/lib/first-nations/review-stamp-text";
import { ModeDialRow, ModeFactTile, ModeFactTiles, ModeStateLabel, ModeUpdatedLine } from "@/components/first-nations/kit";
import { FnModule } from "@/components/first-nations/module-header";
import { ContactActions, NumberTile } from "@/components/first-nations/number-button";
import { dialNumber } from "@/lib/first-nations/contact-format";
import { PhraseDeck } from "@/components/first-nations/phrase-deck";
import { StateModule } from "@/components/first-nations/state-module";
import { QuotedLaw, SpokenWords } from "@/components/first-nations/voice";
import { WhereIsHomePanel } from "@/components/first-nations/where-is-home";
import { telHref } from "@/lib/first-nations/contact-format";
import { isOverdue } from "@/lib/first-nations/hours";
import type {
  BlockView,
  ContactView,
  InnerPageModel,
  ModuleView,
  PhraseView,
  SourceView,
} from "@/lib/first-nations/view-model";

const title = "text-base-minus font-medium text-[color:var(--text-heading)]";
const body = "text-sm-minus text-[color:var(--text-muted)]";
/** The kit's inset hairline (12 px from the edge, none above the first row), so our rows and its dial rows match. */
const row =
  "relative before:pointer-events-none before:absolute before:left-3 before:right-0 before:top-0 before:h-px before:bg-[color:var(--border)] before:content-[''] first:before:hidden";

/** A contact the phone can ring. "See website" and other words are never handed to the dialler. */
export const isDialable = (contact: ContactView): boolean => Boolean(telHref(contact.number));

function Source({
  source,
  checkedAt,
  days = 365,
  review,
}: {
  source: SourceView;
  checkedAt: string;
  days?: number;
  review?: ReviewStampData | undefined;
}) {
  return (
    <>
      <ModeUpdatedLine updatedAt={checkedAt} verb="Checked" sources={[{ label: source.title, url: source.url }]} />
      <ContactReviewLine checkedAt={checkedAt} days={days} />
      <ReviewStamp stamp={review} />
    </>
  );
}

function ContactRow({ contact }: { contact: ContactView }) {
  if (isDialable(contact)) {
    const overdue = isOverdue(contact.checkedAt, new Date());
    return (
      <ModeDialRow
        label={contact.name}
        subtitle={contact.detail || undefined}
        number={dialNumber(contact)}
        source={{ label: contact.source.title, url: contact.source.url }}
        checkedAt={contact.checkedAt}
        meta={overdue ? <ModeStateLabel tone="warning">Due for a check</ModeStateLabel> : undefined}
        testId={`fn-contact-${contact.id}`}
        sheetFooter={<ContactActions contact={contact} />}
      />
    );
  }
  // No number is recorded yet: the words stay as text, and the source says where to find one.
  return (
    <li className={`${row} grid gap-0.5 px-3 py-2.5`} data-testid={`fn-contact-${contact.id}`}>
      <span className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span className={title}>{contact.name}</span>
        <span className="text-sm-minus text-[color:var(--text-muted)]">{contact.number}</span>
      </span>
      {contact.detail ? <span className={body}>{contact.detail}</span> : null}
      <Source source={contact.source} checkedAt={contact.checkedAt} days={90} />
    </li>
  );
}

function Item({ children }: { children: ReactNode }) {
  return <li className={`${row} grid gap-1 px-3 py-2.5`}>{children}</li>;
}

function BlockItem({ view }: { view: BlockView }) {
  const { block, source } = view;
  switch (block.kind) {
    case "tip":
      return (
        <Item>
          <p className={title}>{block.do}</p>
          <p className={body}>{block.why}</p>
          {block.say ? <SpokenWords size="md">{block.say}</SpokenWords> : null}
          <Source source={source} checkedAt={block.checkedAt} review={view.review} />
        </Item>
      );
    case "avoid":
      return (
        <Item>
          <p className="flex items-baseline gap-1.5 text-sm-minus text-[color:var(--text-muted)]">
            <Ban className="size-icon-xs shrink-0" aria-hidden="true" />
            <span>
              <span className="sr-only">Avoid: </span>
              {block.avoid}
            </span>
          </p>
          <p className="flex items-baseline gap-1.5 text-base-minus text-[color:var(--text-heading)]">
            <Check className="size-icon-xs shrink-0" aria-hidden="true" />
            <span>
              <span className="sr-only">Instead: </span>
              {block.instead}
            </span>
          </p>
          <Source source={source} checkedAt={block.checkedAt} review={view.review} />
        </Item>
      );
    case "contact":
      return view.contact ? <ContactRow contact={view.contact} /> : null;
    case "quote":
      return (
        <li className={`${row} px-3 py-2.5`}>
          <figure className="grid gap-2">
            <QuotedLaw>{block.text}</QuotedLaw>
            <figcaption className="text-2xs text-[color:var(--text-muted)]">{block.heading}</figcaption>
          </figure>
          <Source source={source} checkedAt={block.checkedAt} review={view.review} />
        </li>
      );
    case "steps":
      return (
        <Item>
          <p className={title}>{block.heading}</p>
          <ol className="grid gap-2">
            {block.items.map((item, i) => (
              <li key={item.title} className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-2">
                <span className="nums text-sm-minus text-[color:var(--text-muted)]">{i + 1}</span>
                <span className="grid">
                  <span className="text-sm-minus font-medium text-[color:var(--text-heading)]">{item.title}</span>
                  <span className={body}>{item.detail}</span>
                </span>
              </li>
            ))}
          </ol>
          <Source source={source} checkedAt={block.checkedAt} review={view.review} />
        </Item>
      );
    case "linkList":
      return (
        <Item>
          <p className={title}>{block.heading}</p>
          <ul className="grid">
            {block.items.map((item) => (
              <li key={item.href}>
                <a
                  href={item.href}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="flex min-h-12 items-center justify-between gap-3"
                >
                  <span className="grid">
                    <span className="text-sm-minus font-medium text-[color:var(--text-heading)]">{item.label}</span>
                    {item.detail ? <span className={body}>{item.detail}</span> : null}
                  </span>
                  <ArrowUpRight className="size-icon-sm shrink-0 text-[color:var(--text-muted)]" aria-hidden="true" />
                </a>
              </li>
            ))}
          </ul>
          <Source source={source} checkedAt={block.checkedAt} review={view.review} />
        </Item>
      );
    case "note":
      return (
        <Item>
          <p className={title}>{block.heading}</p>
          <p className={body}>{block.text}</p>
          <Source source={source} checkedAt={block.checkedAt} review={view.review} />
        </Item>
      );
    case "noteWording":
      // Only reaches here once approved: the view-model drops it before that (spec §4).
      return (
        <Item>
          <p className={title}>{block.heading}</p>
          <CopyNoteWording template={block.template} />
          <Source source={source} checkedAt={block.checkedAt} review={view.review} />
        </Item>
      );
  }
}

function deckPhrases(module: ModuleView): PhraseView[] {
  return module.blocks.flatMap(({ block, source }) =>
    block.kind === "tip" && block.say ? [{ say: block.say, why: block.why, checkedAt: block.checkedAt, source }] : [],
  );
}

/**
 * Whether a module has anything to show. Layouts that draw from the model (service
 * numbers, "Where is home?") always do: service numbers show the empty state when
 * there are none. Anything else with no blocks, or a deck with no phrases, shows nothing,
 * and a tab made only of such modules is not drawn at all.
 */
export function moduleHasContent(module: ModuleView): boolean {
  switch (module.layout) {
    case "service-contacts":
    case "where-is-home":
      return true;
    case "deck":
      return deckPhrases(module).length > 0;
    case "tiles":
      return module.blocks.some((b) => b.contact);
    default:
      return module.blocks.length > 0;
  }
}

export function ModuleBody({
  module,
  model,
  mapSource = null,
}: {
  module: ModuleView;
  model: InnerPageModel;
  mapSource?: SourceView | null;
}) {
  if (!moduleHasContent(module)) return null;
  const moduleId = `fn-module-${module.id}`;
  switch (module.layout) {
    case "tiles":
      return (
        <ModeFactTiles>
          {module.blocks.flatMap(({ block, contact }) =>
            !contact
              ? []
              : isDialable(contact)
                ? [<NumberTile key={block.id} contact={contact} label={contact.name} />]
                : [<ModeFactTile key={block.id} label={contact.name} value={contact.number} />],
          )}
        </ModeFactTiles>
      );
    case "deck":
      return <PhraseDeck id={moduleId} phrases={deckPhrases(module)} />;
    case "numbered":
      return (
        <FnModule id={moduleId} icon={module.icon} title={module.title}>
          <ol className="grid">
            {module.blocks.map((b, i) => (
              <li key={b.block.id} className={`${row} grid grid-cols-[2rem_minmax(0,1fr)]`}>
                <span className="nums pl-3 pt-3 text-2xs text-[color:var(--text-muted)]">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <ul className="grid">
                  <BlockItem view={b} />
                </ul>
              </li>
            ))}
          </ol>
        </FnModule>
      );
    case "service-contacts":
      return model.serviceContacts.length ? (
        <FnModule id={moduleId} icon={module.icon} title={module.title}>
          <ul className="grid">
            {model.serviceContacts.map((c) => (
              <ContactRow key={c.id} contact={c} />
            ))}
          </ul>
        </FnModule>
      ) : (
        <StateModule kind="empty" href={model.missingNumberHref ?? undefined} />
      );
    case "where-is-home":
      return (
        <WhereIsHomePanel
          regions={model.regions}
          map={model.map}
          interpreter={model.interpreter}
          mapSource={mapSource}
        />
      );
    default:
      return (
        <FnModule id={moduleId} icon={module.icon} title={module.title}>
          <ul className="grid">
            {module.blocks.map((b) => (
              <BlockItem key={b.block.id} view={b} />
            ))}
          </ul>
        </FnModule>
      );
  }
}
