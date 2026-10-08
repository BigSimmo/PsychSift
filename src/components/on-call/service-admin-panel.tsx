"use client";

import { Copy, Plus, UserMinus } from "lucide-react";
import { useState } from "react";

import { cardSurface } from "@/components/card-recipes";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { TextField } from "@/components/ui/text-field";
import { InlineNotice, cn, fieldControlPlain, textMuted } from "@/components/ui-primitives";
import {
  serviceRoles,
  type ServiceAction,
  type ServiceDetail,
  type ServiceInvitation,
  type ServiceMember,
  type ServiceRole,
} from "@/lib/on-call/service-model";
import { formatOnCallDate, formatOnCallDateTime } from "@/components/on-call/on-call-dates";

type ActionRunner = (action: ServiceAction) => Promise<Record<string, unknown>>;

function invitationStatus(invitation: ServiceInvitation, now = new Date()): string {
  if (invitation.revokedAt) return "Revoked";
  if (invitation.usedAt) return "Used";
  if (new Date(invitation.expiresAt).getTime() <= now.getTime()) return "Expired";
  return "Open";
}

function MemberRow({ member, onAction }: { readonly member: ServiceMember; readonly onAction: ActionRunner }) {
  const [role, setRole] = useState<ServiceRole>(member.role);
  const [clinicalReviewer, setClinicalReviewer] = useState(member.clinicalReviewer);
  const [busy, setBusy] = useState<"save" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function update() {
    setBusy("save");
    setError(null);
    try {
      await onAction({ action: "member.update", memberId: member.id, role, clinicalReviewer });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "This member could not be updated.");
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    setBusy("remove");
    setError(null);
    try {
      await onAction({ action: "member.revoke", memberId: member.id });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "This member could not be removed.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <article className={cn(cardSurface, "grid gap-3 p-4")}>
      <div className="min-w-0">
        <p className="break-all text-sm font-semibold text-[color:var(--text-heading)]">
          {member.displayName || `Member ${member.id.slice(-8)}`}
        </p>
        <p className={cn(textMuted, "mt-0.5 text-xs")}>Joined {formatOnCallDate(member.joinedAt)}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <FormField label="Role" id={`service-member-${member.id}-role`}>
          {(field) => (
            <select
              id={field.id}
              value={role}
              onChange={(event) => setRole(event.target.value as ServiceRole)}
              className={fieldControlPlain}
            >
              {serviceRoles.map((value) => (
                <option key={value} value={value}>
                  {value[0].toUpperCase() + value.slice(1)}
                </option>
              ))}
            </select>
          )}
        </FormField>
        <label className="flex min-h-tap items-center gap-3 rounded-lg border border-[color:var(--border)] px-3 text-sm text-[color:var(--text)]">
          <input
            type="checkbox"
            checked={clinicalReviewer}
            onChange={(event) => setClinicalReviewer(event.target.checked)}
          />
          Independent clinical reviewer
        </label>
      </div>
      {error ? <InlineNotice tone="danger">{error}</InlineNotice> : null}
      <div className="grid gap-2 sm:grid-cols-2">
        <Button
          variant="secondary"
          busy={busy === "save"}
          busyLabel="Saving…"
          disabled={busy !== null}
          onClick={() => void update()}
        >
          Save member
        </Button>
        <Button
          variant="danger"
          icon={UserMinus}
          busy={busy === "remove"}
          busyLabel="Removing…"
          disabled={busy !== null}
          onClick={() => void remove()}
        >
          Remove member
        </Button>
      </div>
    </article>
  );
}

export function ServiceAdminPanel({
  detail,
  onAction,
}: {
  readonly detail: ServiceDetail;
  readonly onAction: ActionRunner;
}) {
  const [siteName, setSiteName] = useState("");
  const [inviteRole, setInviteRole] = useState<ServiceRole>("member");
  const [inviteEmail, setInviteEmail] = useState("");
  const [expiresInDays, setExpiresInDays] = useState("3");
  const [newInvitation, setNewInvitation] = useState<{ code: string; expiresAt: string; email: string } | null>(null);
  const [busy, setBusy] = useState<"site" | "invite" | string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);

  async function addSite() {
    if (!siteName.trim() || busy) return;
    setBusy("site");
    setError(null);
    try {
      await onAction({ action: "site.create", name: siteName.trim() });
      setSiteName("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The site could not be created.");
    } finally {
      setBusy(null);
    }
  }

  async function createInvitation() {
    const invitedEmail = inviteEmail.trim().toLowerCase();
    if (busy || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(invitedEmail)) return;
    setBusy("invite");
    setError(null);
    setNewInvitation(null);
    try {
      const result = await onAction({
        action: "invitation.create",
        role: detail.membership.role === "admin" ? inviteRole : "member",
        expiresInDays: Number(expiresInDays),
        invitedEmail,
      });
      if (typeof result.code !== "string" || typeof result.expiresAt !== "string") {
        throw new Error("The invitation was created but its one-time code was not returned.");
      }
      setNewInvitation({ code: result.code, expiresAt: result.expiresAt, email: inviteEmail.trim() });
      setInviteEmail("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The invitation could not be created.");
    } finally {
      setBusy(null);
    }
  }

  async function revoke(invitationId: string) {
    if (busy) return;
    setBusy(invitationId);
    setError(null);
    try {
      await onAction({ action: "invitation.revoke", invitationId });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The invitation could not be revoked.");
    } finally {
      setBusy(null);
    }
  }

  async function copyInvitation() {
    if (!newInvitation) return;
    try {
      await navigator.clipboard.writeText(newInvitation.code);
      setCopyStatus("Invitation code copied.");
    } catch {
      setCopyStatus("Could not copy. Select the code and copy it manually.");
    }
  }

  return (
    <section aria-labelledby="service-admin-heading" className="grid gap-5" data-testid="service-admin">
      <div>
        <h2 id="service-admin-heading" className="text-lg font-semibold text-[color:var(--text-heading)]">
          Service administration
        </h2>
        <p className={cn(textMuted, "mt-1 text-sm leading-6")}>
          Editors invite members, and admins also manage sites and roles. Limits: 5,000 members and 1,000 invitations.
          Invitation codes are shown once.
        </p>
      </div>
      {error ? <InlineNotice tone="danger">{error}</InlineNotice> : null}

      {detail.membership.role === "admin" ? (
        <section aria-labelledby="service-sites-heading" className={cn(cardSurface, "grid gap-3 p-4")}>
          <h3 id="service-sites-heading" className="text-sm font-semibold text-[color:var(--text-heading)]">
            Sites
          </h3>
          <ul className="grid gap-1 text-sm text-[color:var(--text)]">
            {detail.sites.map((site) => (
              <li key={site.id} className="break-words">
                {site.name}
              </li>
            ))}
          </ul>
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <TextField
              label="New site name"
              id="service-new-site"
              value={siteName}
              onChange={(event) => setSiteName(event.target.value)}
            />
            <Button
              variant="secondary"
              icon={Plus}
              busy={busy === "site"}
              busyLabel="Adding…"
              disabled={!siteName.trim() || busy !== null}
              onClick={() => void addSite()}
            >
              Add site
            </Button>
          </div>
        </section>
      ) : null}
      <section aria-labelledby="service-invitations-heading" className={cn(cardSurface, "grid gap-3 p-4")}>
        <h3 id="service-invitations-heading" className="text-sm font-semibold text-[color:var(--text-heading)]">
          Invitations
        </h3>
        <TextField
          label="Invitee's email"
          id="service-invitation-email"
          type="email"
          autoComplete="off"
          hint="Only the person signed in with this email can use the code."
          value={inviteEmail}
          onChange={(event) => setInviteEmail(event.target.value)}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Invitation role" id="service-invitation-role">
            {(field) => (
              <select
                id={field.id}
                value={inviteRole}
                onChange={(event) => setInviteRole(event.target.value as ServiceRole)}
                className={fieldControlPlain}
              >
                {(detail.membership.role === "admin" ? serviceRoles : (["member"] as const)).map((role) => (
                  <option key={role} value={role}>
                    {role[0].toUpperCase() + role.slice(1)}
                  </option>
                ))}
              </select>
            )}
          </FormField>
          <FormField label="Expires after" id="service-invitation-expiry">
            {(field) => (
              <select
                id={field.id}
                value={expiresInDays}
                onChange={(event) => setExpiresInDays(event.target.value)}
                className={fieldControlPlain}
              >
                {[1, 2, 3, 4, 5, 6, 7].map((days) => (
                  <option key={days} value={days}>
                    {days} {days === 1 ? "day" : "days"}
                  </option>
                ))}
              </select>
            )}
          </FormField>
        </div>
        <Button
          variant="primary"
          busy={busy === "invite"}
          busyLabel="Creating…"
          disabled={busy !== null || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inviteEmail.trim())}
          onClick={() => void createInvitation()}
        >
          Create invitation
        </Button>
        {newInvitation ? (
          <InlineNotice tone="neutral">
            <span className="grid min-w-0 gap-2">
              <span>
                This invite works only for {newInvitation.email}. This code is shown once and expires{" "}
                {formatOnCallDateTime(newInvitation.expiresAt)}.
              </span>
              <code className="select-all break-all rounded-sm bg-[color:var(--surface-subtle)] p-2 text-xs">
                {newInvitation.code}
              </code>
              <Button variant="secondary" size="sm" icon={Copy} onClick={() => void copyInvitation()}>
                Copy code
              </Button>
              {copyStatus ? (
                <span role="status" className="text-xs">
                  {copyStatus}
                </span>
              ) : null}
            </span>
          </InlineNotice>
        ) : null}
        <div className="grid gap-2">
          {detail.invitations.length === 0 ? (
            <p className={cn(textMuted, "text-sm")}>No invitations have been created.</p>
          ) : (
            detail.invitations.map((invitation) => {
              const status = invitationStatus(invitation);
              return (
                <div
                  key={invitation.id}
                  className="grid gap-2 rounded-lg border border-[color:var(--border)] p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                >
                  <p className="min-w-0 break-words text-sm text-[color:var(--text)]">
                    {invitation.role} · {status} · expires {formatOnCallDate(invitation.expiresAt)}
                  </p>
                  {status === "Open" ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      busy={busy === invitation.id}
                      disabled={busy !== null}
                      onClick={() => void revoke(invitation.id)}
                    >
                      Revoke
                    </Button>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      </section>

      {detail.membership.role === "admin" ? (
        <section aria-labelledby="service-members-heading" className="grid gap-3">
          <h3 id="service-members-heading" className="text-sm font-semibold text-[color:var(--text-heading)]">
            Members
          </h3>
          <div className="grid gap-3 lg:grid-cols-2">
            {detail.members.map((member) => (
              <MemberRow key={member.id} member={member} onAction={onAction} />
            ))}
          </div>
        </section>
      ) : null}
    </section>
  );
}
