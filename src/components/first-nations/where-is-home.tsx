"use client";
import { Clipboard, MapPin, MessageCircle, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { ContactActions } from "@/components/first-nations/number-button";
import {
  FnButton,
  ModeActionButton,
  ModeDialRow,
  ModeGroupedList,
  ModeRow,
  ModeStateLabel,
  ModeUpdatedLine,
} from "@/components/first-nations/kit";
import { FnModule, ModuleHeader } from "@/components/first-nations/module-header";
import { dialNumber } from "@/lib/first-nations/contact-format";
import { isOverdue } from "@/lib/first-nations/hours";
import { Sheet } from "@/components/ui/sheet";
import { cn, eyebrowText } from "@/components/ui-primitives";
import { copyTextToClipboard } from "@/lib/copy-to-clipboard";
import { telHref } from "@/lib/first-nations/contact-format";
import type { WaMap } from "@/lib/first-nations/content-schema";
import type { ContactView, RegionView, SourceView } from "@/lib/first-nations/view-model";

type Props = {
  regions: readonly RegionView[];
  map: WaMap;
  interpreter: ContactView | null;
  /** The map's own boundary source, once the view-model resolves `map.sourceId` to a title and link. */
  mapSource?: SourceView | null;
};

const MODE = "first-nations";

function DialRow({ contact }: { contact: ContactView }) {
  // Words such as "See website" are not a number: no dial sheet and no tel: link, just the text and its source.
  if (!telHref(contact.number)) {
    return (
      <ModeRow
        testId={`fn-home-${contact.id}`}
        title={contact.name}
        subtitle={contact.detail || undefined}
        meta={
          <ModeUpdatedLine
            updatedAt={contact.checkedAt}
            verb="Checked"
            sources={[{ label: contact.source.title, url: contact.source.url }]}
          />
        }
        trailing={<span className="px-2 text-sm-minus text-[color:var(--text-muted)]">{contact.number}</span>}
      />
    );
  }
  return (
    <ModeDialRow
      label={contact.name}
      subtitle={contact.detail || undefined}
      number={dialNumber(contact)}
      source={{ label: contact.source.title, url: contact.source.url }}
      checkedAt={contact.checkedAt}
      meta={
        isOverdue(contact.checkedAt, new Date()) ? (
          <ModeStateLabel tone="warning">Due for a check</ModeStateLabel>
        ) : undefined
      }
      testId={`fn-home-${contact.id}`}
      sheetFooter={<ContactActions contact={contact} />}
    />
  );
}

function WaLineMap({
  map,
  selectedId,
  onSelect,
  regionLabels,
}: {
  map: WaMap;
  selectedId: string | null;
  onSelect?: (id: string) => void;
  regionLabels?: Record<string, string>;
}) {
  return (
    <svg viewBox={map.viewBox} aria-label="Western Australia regions map" className="mx-auto h-48 w-full">
      {map.regions.map((r: WaMap["regions"][number]) => (
        <path
          key={r.id}
          d={r.path}
          vectorEffect="non-scaling-stroke"
          strokeWidth={1}
          role="button"
          tabIndex={0}
          aria-label={`${regionLabels?.[r.id] ?? r.id} on map`}
          aria-pressed={r.id === selectedId}
          data-testid={`fn-map-region-${r.id}`}
          onClick={() => onSelect?.(r.id)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onSelect?.(r.id);
            }
          }}
          className={cn(
            "cursor-pointer transition-colors duration-[var(--duration-quick)] outline-none focus-visible:stroke-[color:var(--clinical-accent)] focus-visible:stroke-2",
            r.id === selectedId
              ? "fill-[color:var(--clinical-accent-soft)] stroke-[color:var(--clinical-accent)]"
              : "fill-[color:var(--surface-subtle)] stroke-[color:var(--border-strong)] hover:fill-[color:var(--clinical-accent-soft)]/50",
          )}
        />
      ))}
    </svg>
  );
}

function regionLines(region: RegionView): string[] {
  return [
    ...region.services.map((c) => `${c.name} · ${c.number}`),
    ...(region.languages.length ? [`Interpreter: ${region.languages.join(" or ")}`] : []),
  ];
}

/**
 * The region lives in this component's state only: never stored, never in a
 * URL, never sent, never in the main search. It clears when the page is left.
 */
export function WhereIsHomePanel({ regions, map, interpreter, mapSource = null }: Props) {
  const [regionId, setRegionId] = useState<string | null>(null);
  const [letter, setLetter] = useState<string[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const region = regions.find((r) => r.id === regionId) ?? null;
  const copy = (text: string) =>
    copyTextToClipboard(text).then(
      () => setNote("Copied"),
      () => setNote("Copying isn't available on this phone"),
    );
  const regionLabels = useMemo(() => Object.fromEntries(regions.map((r) => [r.id, r.label])), [regions]);
  return (
    <div className="grid gap-3">
      <section
        aria-labelledby="fn-home-region"
        className="grid gap-2 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-raised)] p-3 shadow-[var(--e1)]"
      >
        <div className="flex items-center justify-between gap-2">
          <h3 id="fn-home-region" className={eyebrowText}>
            Home region
          </h3>
          <p className="inline-flex items-center gap-1 text-2xs text-[color:var(--text-muted)]">
            <ShieldCheck className="size-icon-xs" aria-hidden="true" />
            Never saved or sent
          </p>
        </div>
        <WaLineMap map={map} selectedId={regionId} onSelect={setRegionId} regionLabels={regionLabels} />
        <div role="group" aria-label="Home region" className="grid grid-cols-2 gap-x-2 gap-y-3">
          {regions.map((r) => (
            <button
              key={r.id}
              type="button"
              aria-pressed={r.id === regionId}
              onClick={() => {
                setRegionId(r.id);
                setNote(null);
              }}
              className={cn(
                "relative h-9 rounded-lg border px-3 text-sm-minus after:absolute after:inset-x-0 after:-inset-y-1.5",
                r.id === regionId
                  ? "border-[color:var(--clinical-accent)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--text-heading)]"
                  : "border-[color:var(--border)] bg-[color:var(--surface-raised)] text-[color:var(--text)]",
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
        <ModeUpdatedLine
          updatedAt={map.checkedAt}
          verb="Checked"
          sources={mapSource ? [{ label: mapSource.title, url: mapSource.url }] : undefined}
        />
      </section>
      {region ? (
        <>
          <ModeGroupedList eyebrow={`Near home · ${region.label}`} headerIcon={MapPin} mode={MODE}>
            {region.services.map((c) => (
              <DialRow key={c.id} contact={c} />
            ))}
          </ModeGroupedList>
          <ModeGroupedList eyebrow="Languages" headerIcon={MessageCircle} mode={MODE}>
            {region.languages.length ? (
              <li className="px-3 py-2">
                <ul className="flex flex-wrap gap-1.5">
                  {region.languages.map((l) => (
                    <li
                      key={l}
                      className="inline-flex h-8 items-center rounded-md border border-[color:var(--border)] bg-[color:var(--surface-raised)] px-2.5 text-sm-minus text-[color:var(--text)]"
                    >
                      {l}
                    </li>
                  ))}
                </ul>
              </li>
            ) : null}
            {interpreter ? <DialRow contact={interpreter} /> : null}
          </ModeGroupedList>
          <ModeUpdatedLine
            updatedAt={region.checkedAt}
            verb="Checked"
            sources={[{ label: region.source.title, url: region.source.url }]}
          />
          <div className="flex flex-wrap gap-2">
            <FnButton filled label="Add to letter" onClick={() => setLetter(regionLines(region))} />
            <FnButton icon={Clipboard} label="Copy all" onClick={() => void copy(regionLines(region).join("\n"))} />
          </div>
        </>
      ) : null}
      {letter.length > 0 ? (
        <FnModule
          id="fn-letter"
          icon="clipboard"
          title="For the letter"
          action={<ModeActionButton icon={Clipboard} label="Copy" onClick={() => void copy(letter.join("\n"))} />}
        >
          <p className="nums mx-3 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-3 py-2.5 text-sm-minus leading-normal text-[color:var(--text)]">
            {letter.map((line) => (
              <span key={line} className="block">
                {line}
              </span>
            ))}
          </p>
        </FnModule>
      ) : null}
      {note ? (
        <p role="status" className="text-sm-minus text-[color:var(--text-muted)]">
          {note}
        </p>
      ) : null}
    </div>
  );
}

export function WhereIsHomeTile(props: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className="grid min-h-[5.5rem] content-start gap-0.5 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-raised)] pb-3 text-left shadow-[var(--e1)]"
      >
        <ModuleHeader id="fn-home-tile" icon="map-pin" title="Home" inControl />
        <span className="px-3 text-sm-minus font-medium text-[color:var(--text-heading)]">Where is home?</span>
        <span className="px-3 text-sm-minus text-[color:var(--text-muted)]">Care near home</span>
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Where is home?">
        <WhereIsHomePanel {...props} />
      </Sheet>
    </>
  );
}
