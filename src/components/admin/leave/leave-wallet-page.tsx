"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  BookOpen,
  Copy,
  EyeOff,
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
  JuniorBackLink,
  JuniorFootNote,
  JuniorSectionLabel,
  JuniorUndoBar,
  PatientDetailCatch,
  useCopy,
  useOnline,
  useJuniorNow,
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
import { isExampleRecord } from "@/lib/example-data/guards";
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
import { LEAVE_ENTITLEMENTS, LEAVE_SIGN_OFF, leaveAgreementPastEndDate } from "@/lib/admin/leave-entitlements";
import { adminLoadState, selectAdminOwnEntries } from "@/lib/admin/own-entries";
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

/** What Roster holds for the doctor, or that they are signed out and nothing was asked for. */
type ShownRosterLeave = JuniorRosterLeaveState | { readonly status: "signed-out" };
const SIGNED_OUT_LEAVE: ShownRosterLeave = { status: "signed-out" };

/** The doctor's own bookings in Roster for the two kinds Roster holds. */
function RosterBookings({ type, leave, today }: { type: LeaveType; leave: ShownRosterLeave; today: string }) {
  const kind = type.id === "annual" ? "annual" : type.id === "conference" ? "pd_leave" : null;
  if (!kind) return null;
  const rows =
    leave.status === "ready"
      ? leave.leave
          .filter((item) => item.kind === kind && item.endsOn >= today)
          .sort((a, b) => (a.startsOn < b.startsOn ? -1 : 1))
      : [];
  return (
    <div
      className="grid gap-1.5 border-t border-[color:var(--border)] pt-3"
      data-testid={`admin-leave-${type.id}-booked`}
    >
      <p className={eyebrowText}>Booked in Roster</p>
      {leave.status === "signed-out" ? (
        <p className={cn(textMuted, "text-sm")} data-testid={`admin-leave-${type.id}-booked-signed-out`}>
          Sign in to see what Roster holds.
        </p>
      ) : leave.status === "loading" ? (
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
              <span className="rounded-md border border-[color:var(--border)] px-2 py-0.5 text-xs">
                {ROSTER_LEAVE_STATUS_WORDS[row.status]}
              </span>
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
        <div className={cn("grid gap-2", type.slots.includes("lastDay") && "min-[360px]:grid-cols-2")}>
          {/* Side by side from 360 px, stacked below, where two native date fields do not fit. */}
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
        <p className={cn(textMuted, "text-xs")}>
          Private. This date is not saved anywhere and is only in the message if you copy it.
        </p>
      ) : null}
    </div>
  );
}

/** Square-bracket gaps drawn as soft chips so the doctor sees what is missing. */
function MessagePreview({ text, testId }: { text: string; testId: string }) {
  const parts = text.split(/(\[[^\]]+\])/g);
  return (
    <p
      className="whitespace-pre-line rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-subtle)] p-3 text-sm leading-6"
      data-testid={testId}
    >
      {parts.map((part, index) =>
        /^\[[^\]]+\]$/.test(part) ? (
          <span
            key={index}
            className="rounded border border-dashed border-[color:var(--border-strong)] px-1 text-[color:var(--text-muted)]"
          >
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
  contractExample = false,
  onHide,
}: {
  type: LeaveType;
  fields: LeaveMessageFields;
  onFields: (fields: LeaveMessageFields) => void;
  edited: string | null;
  onEdited: (value: string | null) => void;
  onClose: () => void;
  leave: ShownRosterLeave;
  today: string;
  contractEndsOn: string | null;
  /** The end date is an example record's: shown on the card, never put into a message that can be copied. */
  contractExample?: boolean;
  /** Only the discreet card offers Hide. */
  onHide?: () => void;
}) {
  const headingId = useId();
  const { copy, stateFor } = useCopy();
  const generated = leaveMessage(type, fields, { contractEndsOn: contractExample ? null : contractEndsOn });
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
          className={cn(
            focusRing,
            "grid size-12 shrink-0 place-items-center rounded-full text-[color:var(--text-muted)]",
          )}
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

      <div
        className="grid gap-2 border-t border-[color:var(--border)] pt-3"
        data-testid={`admin-leave-${type.id}-entitlement`}
      >
        <p className={eyebrowText}>What you can take</p>
        {LEAVE_ENTITLEMENTS[type.id].map((group) => (
          <div key={group.heading ?? "all"} className="grid gap-1">
            {group.heading ? (
              <p className="text-xs font-semibold text-[color:var(--text-heading)]">{group.heading}</p>
            ) : null}
            <ul className="grid gap-1.5">
              {group.lines.map((line) => (
                <li key={line.text} className="grid gap-0.5 text-sm text-[color:var(--text)]">
                  <span>{line.text}</span>
                  <span className={cn(textMuted, "text-xs")}>Clause {line.clause}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <p className={cn(textMuted, "text-xs")}>
          From the AMA Industrial Agreement 2024, checked and signed off {formatDateEcho(LEAVE_SIGN_OFF.signedOn)}. Your
          health service confirms what applies to you.
        </p>
        <a
          href={LEAVE_AGREEMENT.url}
          target="_blank"
          rel="noreferrer noopener"
          className={cn(
            focusRing,
            "inline-flex min-h-12 w-fit items-center gap-1 text-sm font-medium text-[color:var(--clinical-accent)]",
          )}
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
            line={
              contractEndsOn
                ? `Ends ${formatDateEcho(contractEndsOn)}. Ask if it includes your planned leave`
                : "Add your end date, then ask about leave"
            }
          />
          {contractEndsOn ? (
            <Link
              href="/admin/contract?question=parental-leave"
              className={cn(
                focusRing,
                "inline-flex min-h-12 w-fit items-center text-sm font-medium text-[color:var(--clinical-accent)]",
              )}
              data-testid="admin-leave-parental-question"
            >
              Open the parental leave question
            </Link>
          ) : null}
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
          <Link
            href="/roster/requests"
            className={cn(buttonFaceClass({ variant: "secondary", size: "sm" }), "w-fit")}
            data-testid={`admin-leave-${type.id}-roster`}
          >
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
        <div className="grid gap-2 min-[360px]:grid-cols-2">
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
                gaps > 0
                  ? `Message copied, with ${gaps === 1 ? "1 gap" : `${gaps} gaps`} to fill.`
                  : "Message copied. Paste it into your email.",
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
            className={cn(
              focusRing,
              "inline-flex min-h-12 w-fit items-center gap-2 text-sm font-medium text-[color:var(--clinical-accent)]",
            )}
            data-testid={`admin-leave-${type.id}-email`}
          >
            <Mail aria-hidden="true" className="size-icon-sm" />
            Open in email
          </a>
        )}
      </div>

      {type.discreet ? (
        <div
          className="grid gap-2 border-t border-[color:var(--border)] pt-3"
          data-testid="admin-leave-confidential-help"
        >
          <Link href="/admin/help" className={cn(buttonFaceClass({ variant: "secondary" }), "w-full justify-start")}>
            Help and support, crisis lines first
          </Link>
          {onHide ? (
            <Button variant="ghost" icon={EyeOff} onClick={onHide} testId="admin-leave-hide">
              Hide this card
            </Button>
          ) : null}
          <p className={cn(textMuted, "text-xs")}>
            This card asks you for nothing and keeps nothing. It is never offered in search, alerts or recent pages, and
            its name stays out of the address bar.
          </p>
        </div>
      ) : null}
    </section>
  );
}

/**
 * Leave wallet, `/admin/leave` (junior feature #34). Eight flat cards in a
 * wallet stack, one per leave type. Tap one to open it on top, with the rest
 * as a thin pile below. Every card: what you can take (signed-off agreement
 * figures, each with its clause, from `leave-entitlements`), how to apply, Roster bookings where Roster holds them,
 * and a ready message the doctor fills, checks and copies. Nothing is saved:
 * typed dates live only while the page is open.
 */
export function LeaveWalletPage({ now: nowProp }: { now?: Date } = {}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const online = useOnline();
  const today = perthCalendarDate(useJuniorNow(nowProp));
  const fromUrl = leaveTypeById(searchParams?.get("card"));
  const [openId, setOpenId] = useState<LeaveTypeId | null>(fromUrl?.id ?? null);
  const [drafts, setDrafts] = useState<Partial<Record<LeaveTypeId, LeaveMessageFields>>>({});
  const [edits, setEdits] = useState<Partial<Record<LeaveTypeId, string | null>>>({});
  const entries = useOnCallEntries();
  const own = useMemo(() => selectAdminOwnEntries(entries), [entries]);
  const contract = selectContractEnd(own);
  const contractEndsOn = contract ? (complianceExpiresOn(contract) ?? null) : null;
  // Roster is asked only for a signed-in reader; signed out, the cards say so instead of "could not load".
  const loadState = adminLoadState(entries);
  const signedOut = loadState === "signed-out";
  const rosterLeave = useJuniorRosterLeave(loadState !== "loading" && !signedOut);
  const leave: ShownRosterLeave = signedOut ? SIGNED_OUT_LEAVE : rosterLeave;
  // Hidden cards live in memory only: Admin keeps nothing on the device.
  const [hidden, setHidden] = useState<readonly LeaveTypeId[]>([]);
  const [undo, setUndo] = useState<{ id: number; type: LeaveTypeId } | null>(null);
  const undoId = useRef(0);
  const stackRef = useRef<HTMLUListElement>(null);
  const lastOpened = useRef<LeaveTypeId | null>(null);

  // A link to another card (search, the contract page) opens it. Only a
  // change in the address does this; the page's own writes are expected.
  const urlCard = fromUrl?.id ?? null;
  // A link that names the discreet card (typed, or from history) opens it, then its name leaves the address
  // bar and the history entry at once.
  const discreetInUrl = Boolean(fromUrl?.discreet);
  useEffect(() => {
    if (!discreetInUrl) return;
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    params.delete("card");
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : (pathname ?? "/admin/leave"), { scroll: false });
  }, [discreetInUrl, pathname, router, searchParams]);
  const [seenUrlCard, setSeenUrlCard] = useState(urlCard);
  if (urlCard !== seenUrlCard) {
    setSeenUrlCard(urlCard);
    setOpenId(urlCard);
  }

  function open(id: LeaveTypeId | null) {
    if (id) lastOpened.current = id;
    setOpenId(id);
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    // The discreet card's name never goes into the address bar or browser history.
    if (id && !leaveTypeById(id)?.discreet) params.set("card", id);
    else params.delete("card");
    const query = params.toString();
    setSeenUrlCard(params.get("card") as LeaveTypeId | null);
    router.replace(query ? `${pathname}?${query}` : (pathname ?? "/admin/leave"), { scroll: false });
  }

  // Closing a card puts focus back on its header in the stack.
  useEffect(() => {
    if (openId !== null || !lastOpened.current) return;
    const header = stackRef.current?.querySelector<HTMLButtonElement>(`[data-card="${lastOpened.current}"]`);
    header?.focus();
  }, [openId]);

  function hide(id: LeaveTypeId) {
    lastOpened.current = null;
    setHidden((current) => (current.includes(id) ? current : [...current, id]));
    open(null);
    undoId.current += 1;
    setUndo({ id: undoId.current, type: id });
  }
  function show(id: LeaveTypeId) {
    setHidden((current) => current.filter((value) => value !== id));
  }

  const openType = openId ? leaveTypeById(openId) : null;
  const visible = LEAVE_TYPES.filter((type) => !hidden.includes(type.id));
  const others = visible.filter((type) => type.id !== openId);

  return (
    <InformationPageShell testId="admin-leave-main">
      <JuniorBackLink href="/admin" label="Admin Today" testId="admin-leave-back" />
      <div className="grid gap-1">
        <PageTitleUnderBand className="text-2xl font-semibold text-[color:var(--text-heading)]">
          Leave wallet
        </PageTitleUnderBand>
        <p className={cn(textMuted, "text-sm")}>Every leave type, how to apply, and a ready message</p>
      </div>

      {!online ? (
        <div className={cn(cardSurface, "p-3 text-sm")} role="status" data-testid="admin-leave-offline">
          <span className="font-semibold text-[color:var(--text-heading)]">You are offline.</span> The cards and Copy
          still work. Links open when you are back online.
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
            contractExample={contract ? isExampleRecord(contract) : false}
            onHide={openType.discreet ? () => hide(openType.id) : undefined}
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
            <p className="text-sm font-semibold text-[color:var(--text-heading)]">Figures from your agreement</p>
            <p className="text-sm text-[color:var(--text)]">
              Each card lists what the WA Health AMA Industrial Agreement 2024 gives, with the clause. Checked and
              signed off {formatDateEcho(LEAVE_SIGN_OFF.signedOn)}.
            </p>
            {leaveAgreementPastEndDate(today) ? (
              <p className="text-sm text-[color:var(--text)]" data-testid="admin-leave-agreement-end">
                This agreement reached its end date on {formatDateEcho(LEAVE_SIGN_OFF.agreementExpiresOn)}. It stays in
                force until a new one is made, so check whether a new agreement has replaced it.
              </p>
            ) : null}
            <a
              href={LEAVE_AGREEMENT.url}
              target="_blank"
              rel="noreferrer noopener"
              className={cn(
                focusRing,
                "inline-flex min-h-12 w-fit items-center gap-1 text-sm font-medium text-[color:var(--clinical-accent)]",
              )}
              data-testid="admin-leave-agreement"
            >
              Open your agreement ({LEAVE_AGREEMENT.citation})
              <ExternalLink aria-hidden="true" className="size-icon-sm" />
            </a>
          </div>

          <JuniorSectionLabel
            count={`${visible.length} cards`}
            action={<span className={cn(textMuted, "text-xs")}>Tap a card to open it</span>}
          >
            Your wallet
          </JuniorSectionLabel>
          {/*
            The mockup's wallet: each card's top edge tucks 8 px under the card before it, a deliberate stacked
            deck. Each card is at least 64 px tall, so at least 56 px of every card stays uncovered and tappable,
            and the overlap only ever covers the bottom padding, never a word. A focused card lifts above the
            next so its focus ring shows in full.
          */}
          <ul ref={stackRef} aria-label="Leave cards" className="grid" data-testid="admin-leave-stack">
            {visible.map((type, index) => (
              <li key={type.id} className={cn(index > 0 && "-mt-2")}>
                <button
                  type="button"
                  data-card={type.id}
                  aria-expanded={false}
                  onClick={() => open(type.id)}
                  data-testid={`admin-leave-card-${type.id}`}
                  className={cn(
                    focusRing,
                    "relative flex min-h-16 w-full items-center gap-3 rounded-xl border focus-visible:z-10 border-[color:var(--border)] bg-[color:var(--surface-raised)] px-3 pb-3 text-left",
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
          {hidden.length > 0 ? (
            <div
              className={cn(cardSurface, "flex min-h-12 items-center gap-3 px-3 py-2")}
              data-testid="admin-leave-hidden"
            >
              <EyeOff
                aria-hidden="true"
                strokeWidth={1.5}
                className="size-icon-sm shrink-0 text-[color:var(--text-muted)]"
              />
              <span className="grid min-w-0 flex-1">
                <span className="text-sm font-medium text-[color:var(--text-heading)]">
                  {hidden.length === 1 ? "1 hidden card" : `${hidden.length} hidden cards`}
                </span>
                <span className={cn(textMuted, "text-xs")}>Hidden while this page is open. It is back next time.</span>
              </span>
              <Button variant="secondary" size="sm" onClick={() => setHidden([])} testId="admin-leave-show-hidden">
                Show
              </Button>
            </div>
          ) : null}
        </>
      )}

      {undo ? (
        <JuniorUndoBar
          key={undo.id}
          label="Card hidden"
          onUndo={() => {
            show(undo.type);
            setUndo(null);
          }}
          onDismiss={() => setUndo(null)}
          testId="admin-leave-undo"
        />
      ) : null}

      <JuniorFootNote testId="admin-leave-foot">
        Ready messages are copied for you to send. PsychSift never sends them and keeps nothing you type here.
      </JuniorFootNote>
    </InformationPageShell>
  );
}
