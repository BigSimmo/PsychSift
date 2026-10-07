"use client";

import { useState, type FormEvent } from "react";

import { ModeNotice } from "@/components/mode-kit/notice";
import { Button, buttonFaceClass } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { TextField } from "@/components/ui/text-field";
import { guardExampleAction } from "@/lib/example-data/guards";
import { useExampleData } from "@/lib/example-data/store";

type Props = { serviceId: string; teamName: string; defaultEmail?: string; onClose: () => void };
type InviteResult = { path?: unknown; expiresAt?: unknown; message?: unknown };

export function RosterInviteSheet({ serviceId, teamName, defaultEmail = "", onClose }: Props) {
  const [email, setEmail] = useState(defaultEmail);
  const { active: example } = useExampleData("rost");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [path, setPath] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [shared, setShared] = useState(false);
  const link = path && typeof window !== "undefined" ? new URL(path, window.location.origin).toString() : null;

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/roster/team/${encodeURIComponent(serviceId)}/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ invitedEmail: email.trim() }),
      });
      const result = (await response.json().catch(() => null)) as InviteResult | null;
      if (!response.ok) {
        setError(typeof result?.message === "string" ? result.message : "The invite could not be made. Try again.");
        return;
      }
      if (typeof result?.path !== "string" || !/^\/roster\/join#code=[a-f0-9]{64}$/.test(result.path)) {
        setError("The invite could not be made. Try again.");
        return;
      }
      setPath(result.path);
    } catch {
      setError("The invite could not be made. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!guardExampleAction(example, "copy")) return;
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setError("Copy didn't work. Select the link and copy it instead.");
    }
  }

  async function share() {
    if (!guardExampleAction(example, "share")) return;
    if (!link || !navigator.share) return;
    try {
      await navigator.share({ title: `Join ${teamName} in Roster`, url: link });
      setShared(true);
    } catch {
      // The recipient can still use Copy or their email app.
    }
  }

  return (
    <Sheet open onClose={onClose} title={`Invite to ${teamName}`} mobilePlacement="bottom" testId="roster-invite-sheet">
      <div className="grid gap-4 p-1">
        <p className="text-sm text-[color:var(--text-muted)]">
          The person must sign in with this email address. The link lasts seven days and can be used once.
        </p>
        {error ? <ModeNotice tone="warning">{error}</ModeNotice> : null}
        {path && link ? (
          <div className="grid gap-3">
            <TextField label="Invite link" value={link} readOnly onFocus={(event) => event.currentTarget.select()} />
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" onClick={() => void copy()}>
                {copied ? "Copied" : "Copy"}
              </Button>
              {typeof navigator !== "undefined" && "share" in navigator ? (
                <Button type="button" variant="secondary" onClick={() => void share()}>
                  {shared ? "Shared" : "Share"}
                </Button>
              ) : null}
              <a
                className={buttonFaceClass({ variant: "secondary" })}
                href={`mailto:${encodeURIComponent(email.trim())}?subject=${encodeURIComponent(`Join ${teamName} in Roster`)}&body=${encodeURIComponent(`Open this link to join ${teamName} in Roster:\n\n${link}`)}`}
              >
                Email it
              </a>
            </div>
            <p className="text-xs text-[color:var(--text-muted)]">
              Your email app sends the message. PsychSift does not email the invite.
            </p>
          </div>
        ) : (
          <form onSubmit={(event) => void send(event)} className="grid gap-3">
            <TextField
              label="Colleague's email"
              type="email"
              autoComplete="email"
              required
              maxLength={320}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? "Making invite…" : "Make invite"}
            </Button>
          </form>
        )}
      </div>
    </Sheet>
  );
}
