"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  BookOpen,
  Copy,
  ExternalLink,
  HeartHandshake,
  History,
  Mail,
  PenLine,
  Presentation,
  Shield,
  Sun,
  Thermometer,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { ContractEndEntryLink } from "@/components/admin/contract/contract-entry-link";
import {
  copyLabel,
  JuniorFootNote,
  JuniorSectionLabel,
  PatientDetailCatch,
  useCopy,
  useOnline,
} from "@/components/admin/junior/junior-shared";
import {
  ROSTER_LEAVE_STATUS_WORDS,
  useJuniorRosterLeave,
  type JuniorRosterLeaveState,
} from "@/components/admin/junior/use-roster-leave";
import { cardSurface, focusRing } from "@/components/card-recipes";
import { InformationPageShell } from "@/components/information-page-shell";
import { PageTitleUnderBand } from "@/components/mode-band/mode-band";
import { Button, buttonFaceClass } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { cn, eyebrowText, fieldControlPlain, textMuted } from "@/components/ui-primitives";
import { selectContractEnd } from "@/lib/admin/contract-end";
import {
  checkLeaveMessage,
  EMPTY_LEAVE_FIELDS,
  LEAVE_AGREEMENT,
  LEAVE_DETAIL_LIMIT,
  LEAVE_TYPES,
  leaveFieldsHaveErrors,
  leaveMessage,
  leaveMessageGaps,
  leaveTypeById,
  validateLeaveFields,
  type LeaveIcon,
  type LeaveMessageFields,
  type LeaveType,
  type LeaveTypeId,
} from "@/lib/admin/leave-types";
import { selectAdminOwnEntries } from "@/lib/admin/own-entries";
import { formatDateEcho } from "@/lib/admin/renewal-dates";
import { perthCalendarDate } from "@/lib/cme/cpd-year";
import { complianceExpiresOn } from "@/lib/on-call/compliance";
import { useOnCallEntries } from "@/lib/on-call/entry-store";

const ICONS: Record<LeaveIcon, LucideIcon> = {
  sun: Sun,
  pulse: Thermometer,
  book: BookOpen,
  board: Presentation,
  heart: HeartHandshake,
  shield: Shield,
  history: History,
  users: Users,
};

function CardIcon({ icon }: { icon: LeaveIcon }) {
  const Icon = ICONS[icon];
  return (
    <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[color:var(--surface-subtle)]">
      <Icon aria-hidden="true" strokeWidth={1.5} className="size-icon-sm text-[color:var(--text-heading)]" />
    </span>
  );
}

/** The doctor's own bookings in Roster for the two kinds Roster holds. */
function RosterBookings({ type, leave, today }: { type: LeaveType; leave: JuniorRosterLeaveState; today: string }) {
  const kind = type.id === "annual" ? "annual" : type.id === "conference" ? "pd_leave" : null;
  if (!kind) return null;
  const rows =
    leave.status === "ready"
      ? leave.leave.filter((item) => item.kind === kind && item.endsOn >= today).sort((a, b) => (a.startsOn < b.startsOn ? -1 : 1))
      : [];
  return (
    <div className="grid gap-1.5 border-t border-[color:var(--border)] pt-3" data-testid={`admin-leave-${type.id}-booked`}>
      <p className={eyebrowText}>Booked in Roster</p>
      {leave.status === "loading" ? (
        <p className={cn(textMuted, "text-sm")}>Loading from Roster</p>
      ) : leave.status === "failed" ? (
        <p className={cn(textMuted, "text-sm")}>Could not load your leave from Roster.</p>
      ) : rows.length === 0 ? (
        <p className={cn(textMuted, "text-sm")}>Nothing booked from today on.</p>
      ) : (
        <ul className="grid gap-1">
          {rows.map((row) => (
            <li key={row.id} className="flex min-h-8 items-center justify-between gap-2 text-sm">
              <span className="nums">
                {row.startsOn === row.endsOn
                  ? formatDateEcho(row.startsOn)
                  : `${formatDateEcho(row.startsOn).replace(/\s\d{4}$/, "")} to ${formatDateEcho(row.endsOn)}`}
              </span>
              <span className="rounded-md border border-[color:var(--border)] px-2 py-0.5 text-xs">{ROSTER_LEAVE_STATUS_WORDS[row.status]}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MessageFields({
  type,
  fields,
  onChange,
}: {
  type: LeaveType;
  fields: LeaveMessageFields;
  onChange: (fields: LeaveMessageFields) => void;
}) {
  const errors = validateLeaveFields(type, fields);
  if (type.slots.length === 0) return null;
  return (
    <div className="grid gap-3">
      {type.slots.includes("day") ? (
        <TextField
          type="date"
          label="Shift day"
          value={fields.day}
          onChange={(event) => onChange({ ...fields, day: event.target.value })}
          error={errors.day}
          data-testid={`admin-leave-${type.id}-day`}
        />
      ) : null}
      {type.slots.includes("firstDay") ? (
        <div className={cn("grid gap-2", type.slots.includes("lastDay") && "grid-cols-2")}>
          <TextField
            type="date"
            label={type.id === "parental" ? "From about" : "First day"}
            value={fields.firstDay}
            onChange={(event) => onChange({ ...fields, firstDay: event.target.value })}
            error={errors.firstDay}
            data-testid={`admin-leave-${type.id}-first`}
          />
          {type.slots.includes("lastDay") ? (
            <TextField
              type="date"
              label="Last day"
              value={fields.lastDay}
              min={fields.firstDay || undefined}
              onChange={(event) => onChange({ ...fields, lastDay: event.target.value })}
              error={errors.lastDay}
              data-testid={`admin-leave-${type.id}-last`}
            />
          ) : null}
        </div>
      ) : null}
      {type.slots.includes("detail") ? (
        <TextField
          label={type.detailLabel ?? "Detail"}
          placeholder={type.detailPlaceholder}
          value={fields.detail}
          maxLength={LEAVE_DETAIL_LIMIT + 20}
          onChange={(event) => onChange({ ...fields, detail: event.target.value })}
          error={errors.detail}
          data-testid={`admin-leave-${type.id}-detail`}
        />
      ) : null}
      {errors.detailProblem ? (
        <PatientDetailCatch
          problem={errors.detailProblem}
          onUseSuggestion={(suggestion) => onChange({ ...fields, detail: suggestion })}
          testId={`admin-leave-${type.id}-detail-problem`}
        />
      ) : null}
      {type.id === "parental" ? (
        <p className={cn(textMuted, "text-xs")}>Private. This date is not saved anywhere and is only in the message if you copy it.</p>
      ) : null}
    </div>
  );
}

/** Square-bracket gaps drawn as soft chips so the doctor sees what is missing. */
function MessagePreview({ text, testId }: { text: string; testId: string }) {
  const parts = text.split(/(\[[^\]]+\])/g);
  return (
    <p className="whitespace-pre-line rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-subtle)] p-3 text-sm leading-6" data-testid={testId}>
      {parts.map((part, index) =>
        /^\[[^\]]+\]$/.test(part) ? (
          <span key={index} className="rounded border border-dashed border-[color:var(--border-strong)] px-1 text-[color:var(--text-muted)]">
            {part.slice(1, -1)}
          </span>
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
    </p>
  );
}

function OpenCard({
  type,
  fields,
  onFields,
  edited,
  onEdited,
  onClose,
  leave,
  today,
  contractEndsOn,
  online,
}: {
  type: LeaveType;
  fields: LeaveMessageFields;
  onFields: (fields: LeaveMessageFields) => void;
  edited: string | null;
  onEdited: (value: string | null) => void;
  onClose: () => void;
  leave: JuniorRosterLeaveState;
  today: string;
  contractEndsOn: string | null;
  online: boolean;
}) {
  const headingId = useId();
  const { copy, stateFor } = useCopy();
  const generated = leaveMessage(type, fields, { contractEndsOn });
  const message = edited ?? generated;
  const fieldErrors = validateLeaveFields(type, fields);
  const messageProblem = edited !== null ? checkLeaveMessage(edited) : null;
  const blocked = leaveFieldsHaveErrors(fieldErrors) || Boolean(messageProblem) || !message.trim();
  const gaps = leaveMessageGaps(message);
  const subject = type.discreet ? "Leave request" : `${type.front} request`;

  return (
    <section
      aria-labelledby={headingId}
      className={cn(cardSurface, "grid gap-4 p-4")}
      data-testid={`admin-leave-open-${type.id}`}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
    >
      <div className="flex items-start gap-3">
        <CardIcon icon={type.icon} />
        <div className="grid min-w-0 flex-1">
          <h2 id={headingId} className="text-base font-semibold text-[color:var(--text-heading)]">
            {type.front}
          </h2>
          <span className={cn(textMuted, "text-xs")}>{type.line}</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={`Close ${type.front}`}
          className={cn(focusRing, "grid size-12 shrink-0 place-items-center rounded-full text-[color:var(--text-muted)]")}
          data-testid="admin-leave-close"
        >
          <X aria-hidden="true" className="size-icon-md" />
        </button>
      </div>

      {type.discreet ? (
        <div className="grid gap-0.5">
          <p className={eyebrowText}>This card is for</p>
          <p className="text-sm font-semibold text-[color:var(--text-heading)]">{type.fullName}</p>
        </div>
      ) : type.fullName !== type.front ? (
        <p className="text-sm text-[color:var(--text)]">{type.fullName}</p>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[color:var(--border)] pt-3" data-testid={`admin-leave-${type.id}-entitlement`}>
        <span className="text-sm">
          What you can take{" "}
          <span className="rounded border border-dashed border-[color:var(--border-strong)] px-1.5 text-xs text-[color:var(--text-muted)]">
            Not signed off yet
          </span>
        </span>
        <a
          href={LEAVE_AGREEMENT.url}
          target="_blank"
          rel="noreferrer noopener"
          aria-disabled={online ? undefined : "true"}
          className={cn(focusRing, "inline-flex min-h-12 items-center gap-1 text-sm font-medium text-[color:var(--clinical-accent)]")}
        >
          Check your agreement
          <ExternalLink aria-hidden="true" className="size-icon-sm" />
        </a>
      </div>

      <RosterBookings type={type} leave={leave} today={today} />

      {type.id === "parental" ? (
        <div className="grid gap-1.5 border-t border-[color:var(--border)] pt-3">
          <p className={eyebrowText}>Your contract</p>
          <ContractEndEntryLink
            line={contractEndsOn ? `Ends ${formatDateEcho(contractEndsOn)}. Ask if it includes your planned leave` : "Add your end date, then ask about leave"}
          />
        </div>
      ) : null}

      <div className="grid gap-2 border-t border-[color:var(--border)] pt-3">
        <p className={eyebrowText}>How to apply</p>
        <ol className="grid gap-2">
          {type.steps.map((step, index) => (
            <li key={step.text} className="flex items-start gap-3 text-sm">
              <span className="nums grid size-6 shrink-0 place-items-center rounded-full bg-[color:var(--surface-subtle)] text-xs font-semibold">
                {index + 1}
              </span>
              <span className="grid min-w-0 pt-0.5">
                <span>{step.text}</span>
                {step.hint ? <span className={cn(textMuted, "text-xs")}>{step.hint}</span> : null}
              </span>
            </li>
          ))}
        </ol>
        {type.rosterHref ? (
          <Link href="/roster/requests" className={cn(buttonFaceClass({ variant: "secondary", size: "sm" }), "w-fit")} data-testid={`admin-leave-${type.id}-roster`}>
            Plan it in Roster
          </Link>
        ) : null}
      </div>

      <div className="grid gap-3 border-t border-[color:var(--border)] pt-3">
        <p className={eyebrowText}>Ready message · to {type.to}</p>
        {edited === null ? <MessageFields type={type} fields={fields} onChange={onFields} /> : null}
        {edited === null ? (
          <MessagePreview text={message} testId={`admin-leave-${type.id}-message`} />
        ) : (
          <div className="grid gap-1">
            <label htmlFor={`${headingId}-edit`} className="text-sm font-medium">
              Your message
            </label>
            <textarea
              id={`${headingId}-edit`}
              rows={7}
              value={edited}
              onChange={(event) => onEdited(event.target.value)}
              aria-invalid={messageProblem ? true : undefined}
              className={cn(fieldControlPlain, "resize-y py-2 leading-6")}
              data-testid={`admin-leave-${type.id}-edit`}
            />
          </div>
        )}
        {messageProblem ? (
          <PatientDetailCatch
            problem={messageProblem}
            onUseSuggestion={edited !== null ? (suggestion) => onEdited(suggestion) : undefined}
            testId={`admin-leave-${type.id}-message-problem`}
          />
        ) : null}
        {gaps > 0 && !blocked ? (
          <p className={cn(textMuted, "text-xs")} data-testid={`admin-leave-${type.id}-gaps`}>
            {gaps === 1 ? "1 gap to fill" : `${gaps} gaps to fill`}. You can still copy it and fill them in your email.
          </p>
        ) : null}
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="secondary"
            icon={PenLine}
            onClick={() => onEdited(edited === null ? generated : null)}
            testId={`admin-leave-${type.id}-edit-toggle`}
          >
            {edited === null ? "Edit" : "Start again"}
          </Button>
          <Button
            variant="primary"
            icon={Copy}
            disabled={blocked}
            onClick={() =>
              void copy(
                message,
                "message",
                gaps > 0 ? `Message copied, with ${gaps === 1 ? "1 gap" : `${gaps} gaps`} to fill.` : "Message copied. Paste it into your email.",
              )
            }
            testId={`admin-leave-${type.id}-copy`}
          >
            {copyLabel(stateFor("message"), "Copy message")}
          </Button>
        </div>
        {blocked ? null : (
          <a
            href={`mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`}
            className={cn(focusRing, "inline-flex min-h-12 w-fit items-center gap-2 text-sm font-medium text-[color:var(--clinical-accent)]")}
            data-testid={`admin-leave-${type.id}-email`}
          >
            <Mail aria-hidden="true" className="size-icon-sm" />
            Open in email
          </a>
        )}
      </div>

      {type.discreet ? (
        <div className="grid gap-2 border-t border-[color:var(--border)] pt-3" data-testid="admin-leave-confidential-help">
          <Link href="/admin/help" className={cn(buttonFaceClass({ variant: "secondary" }), "w-full justify-start")}>
            Help and support, crisis lines first
          </Link>
          <p className={cn(textMuted, "text-xs")}>
            This card asks you for nothing and keeps nothing. It is never offered in search, alerts or recent pages.
          </p>
        </div>
      ) : null}
    </section>
  );
}

/**
 * Leave wallet, `/admin/leave` (junior feature #34). Eight flat cards in a
 * wallet stack, one per leave type. Tap one to open it on top, with the rest
 * as a thin pile below. Every card: what you can take (Check your agreement,
 * not signed off yet), how to apply, Roster bookings where Roster holds them,
 * and a ready message the doctor fills, checks and copies. Nothing is saved:
 * typed dates live only while the page is open.
 */
export function LeaveWalletPage({ now: nowProp }: { now?: Date } = {}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const online = useOnline();
  const mountedAt = useMemo(() => new Date(), []);
  const today = perthCalendarDate(nowProp ?? mountedAt);
  const fromUrl = leaveTypeById(searchParams?.get("card"));
  const [openId, setOpenId] = useState<LeaveTypeId | null>(fromUrl?.id ?? null);
  const [drafts, setDrafts] = useState<Partial<Record<LeaveTypeId, LeaveMessageFields>>>({});
  const [edits, setEdits] = useState<Partial<Record<LeaveTypeId, string | null>>>({});
  const entries = useOnCallEntries();
  const own = useMemo(() => selectAdminOwnEntries(entries), [entries]);
  const contract = selectContractEnd(own);
  const contractEndsOn = contract ? (complianceExpiresOn(contract) ?? null) : null;
  const leave = useJuniorRosterLeave(true);
  const stackRef = useRef<HTMLUListElement>(null);
  const lastOpened = useRef<LeaveTypeId | null>(null);

  // A link to another card (search, the contract page) opens it.
  const urlCard = fromUrl?.id ?? null;
  const [seenUrlCard, setSeenUrlCard] = useState(urlCard);
  if (urlCard !== seenUrlCard) {
    setSeenUrlCard(urlCard);
    setOpenId(urlCard);
  }

  function open(id: LeaveTypeId | null) {
    if (id) lastOpened.current = id;
    setOpenId(id);
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    if (id) params.set("card", id);
    else params.delete("card");
    const query = params.toString();
    setSeenUrlCard(id);
    router.replace(query ? `${pathname}?${query}` : (pathname ?? "/admin/leave"), { scroll: false });
  }

  // Closing a card puts focus back on its header in the stack.
  useEffect(() => {
    if (openId !== null || !lastOpened.current) return;
    const header = stackRef.current?.querySelector<HTMLButtonElement>(`[data-card="${lastOpened.current}"]`);
    header?.focus();
  }, [openId]);

  const openType = openId ? leaveTypeById(openId) : null;
  const others = LEAVE_TYPES.filter((type) => type.id !== openId);

  return (
    <InformationPageShell testId="admin-leave-main">
      <div className="grid gap-1">
        <PageTitleUnderBand className="text-2xl font-semibold text-[color:var(--text-heading)]">Leave wallet</PageTitleUnderBand>
        <p className={cn(textMuted, "text-sm")}>Every leave type, how to apply, and a ready message</p>
      </div>

      {!online ? (
        <div className={cn(cardSurface, "p-3 text-sm")} role="status" data-testid="admin-leave-offline">
          <b className="font-semibold text-[color:var(--text-heading)]">You are offline.</b> The cards and Copy still work. Links open when you are back online.
        </div>
      ) : null}

      {openType ? (
        <>
          <OpenCard
            key={openType.id}
            type={openType}
            fields={drafts[openType.id] ?? EMPTY_LEAVE_FIELDS}
            onFields={(fields) => setDrafts((current) => ({ ...current, [openType.id]: fields }))}
            edited={edits[openType.id] ?? null}
            onEdited={(value) => setEdits((current) => ({ ...current, [openType.id]: value }))}
            onClose={() => open(null)}
            leave={leave}
            today={today}
            contractEndsOn={contractEndsOn}
            online={online}
          />
          <button
            type="button"
            onClick={() => open(null)}
            className={cn(focusRing, "grid justify-items-center gap-1 rounded-lg py-2")}
            data-testid="admin-leave-pile"
          >
            <span aria-hidden="true" className="grid w-full justify-items-center gap-0.5">
              <span className="h-1.5 w-[92%] rounded-b-md border border-t-0 border-[color:var(--border)] bg-[color:var(--surface-raised)]" />
              <span className="h-1.5 w-[84%] rounded-b-md border border-t-0 border-[color:var(--border)] bg-[color:var(--surface-raised)]" />
              <span className="h-1.5 w-[76%] rounded-b-md border border-t-0 border-[color:var(--border)] bg-[color:var(--surface-raised)]" />
            </span>
            <span className={cn(textMuted, "text-xs font-semibold")}>{others.length} more cards</span>
          </button>
        </>
      ) : (
        <>
          <div className={cn(cardSurface, "grid gap-1 p-3")} data-testid="admin-leave-sign-off">
            <p className="text-sm font-semibold text-[color:var(--text-heading)]">Figures are not shown yet</p>
            <p className="text-sm text-[color:var(--text)]">
              Each card links to your agreement until the leave figures are checked against it and signed off.
            </p>
            <a
              href={LEAVE_AGREEMENT.url}
              target="_blank"
              rel="noreferrer noopener"
              className={cn(focusRing, "inline-flex min-h-12 w-fit items-center gap-1 text-sm font-medium text-[color:var(--clinical-accent)]")}
              data-testid="admin-leave-agreement"
            >
              Open your agreement ({LEAVE_AGREEMENT.citation})
              <ExternalLink aria-hidden="true" className="size-icon-sm" />
            </a>
          </div>

          <JuniorSectionLabel count={`${LEAVE_TYPES.length} cards`} action={<span className={cn(textMuted, "text-xs")}>Tap a card to open it</span>}>
            Your wallet
          </JuniorSectionLabel>
          <ul ref={stackRef} aria-label="Leave cards" className="grid" data-testid="admin-leave-stack">
            {LEAVE_TYPES.map((type, index) => (
              <li key={type.id} className={cn(index > 0 && "-mt-2")}>
                <button
                  type="button"
                  data-card={type.id}
                  aria-expanded={false}
                  onClick={() => open(type.id)}
                  data-testid={`admin-leave-card-${type.id}`}
                  className={cn(
                    focusRing,
                    "relative flex min-h-16 w-full items-center gap-3 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-raised)] px-3 pb-3 text-left",
                    index > 0 ? "pt-4" : "pt-3",
                  )}
                >
                  <CardIcon icon={type.icon} />
                  <span className="grid min-w-0 flex-1">
                    <span className="text-sm font-semibold text-[color:var(--text-heading)]">{type.front}</span>
                    <span className={cn(textMuted, "text-xs")}>{type.line}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <JuniorFootNote testId="admin-leave-foot">
        Ready messages are copied for you to send. PsychSift never sends them and keeps nothing you type here.
      </JuniorFootNote>
    </InformationPageShell>
  );
}
