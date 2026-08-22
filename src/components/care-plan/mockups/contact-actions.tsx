"use client";

import Link from "next/link";
import { useState, type MouseEvent } from "react";

import styles from "./care-plan.module.css";
import { buildCmhtMailto, buildCmhtTel } from "./domain";
import { DefinitionRow, SectionFrame, StatusMark, formatPerthDate } from "./prototype-ui";
import type { CmhtContact, PrototypeScenario } from "./types";

type ContactChannel = "email" | "call";

const CHANNEL_NOUN: Record<ContactChannel, string> = {
  email: "email application",
  call: "telephone application",
};

/**
 * The team contact block. Everything a clinician needs to reach the team stays
 * on screen — mailbox, duty number, hours, coordinator, and the after-hours
 * route — and the two launch controls are ordinary external anchors.
 *
 * The prototype records only that an external application was asked to open. It
 * never claims that anything was sent, delivered, read, answered, or completed,
 * because it transmits nothing and could not know.
 */
export function ContactActions({
  contact,
  scenario,
  reviewsHref,
  onIntent,
  blockedReason,
}: {
  contact: CmhtContact;
  scenario: PrototypeScenario;
  reviewsHref: string;
  onIntent: (channel: ContactChannel) => void;
  /** The reducer's current refusal, if an attempted contact action cannot be recorded. */
  blockedReason: string | null;
}) {
  const [failedChannel, setFailedChannel] = useState<ContactChannel | null>(null);

  function handleLaunch(channel: ContactChannel) {
    return (event: MouseEvent<HTMLAnchorElement>) => {
      // The URI and audit event are one action. If the reducer would refuse the
      // audit event, do not open an external application and create an
      // unrecorded contact attempt.
      if (blockedReason !== null) {
        event.preventDefault();
        setFailedChannel(null);
        return;
      }
      // The launch-failure specimen: the external application never opens, so
      // the anchor's default navigation is stopped and the failure is stated.
      // The details stay exactly where they were — withholding them would send
      // the reader nowhere at all.
      if (scenario === "launch-failure") {
        event.preventDefault();
        setFailedChannel(channel);
      } else {
        setFailedChannel(null);
      }
      onIntent(channel);
    };
  }

  const unverified = contact.verificationState !== "verified";

  return (
    <SectionFrame
      id="care-plan-cmht-contact"
      heading="Community mental health team"
      description={`${contact.name} — ${contact.catchment}`}
    >
      {unverified ? (
        <p role="alert" data-testid="care-plan-contact-verification-warning" className={styles.contactWarning}>
          <strong>These contact details have not been verified.</strong> Last verified on{" "}
          {formatPerthDate(contact.verifiedAt)}. They are shown so you can still try them; nothing here confirms the
          team can be contacted on them. Verification is queued in{" "}
          <Link href={reviewsHref} className={styles.inlineLink}>
            Reviews
          </Link>
          .
        </p>
      ) : (
        <p className={styles.contactVerified}>
          <StatusMark tone="success" label="Contact details verified" /> Last verified on{" "}
          {formatPerthDate(contact.verifiedAt)}.
        </p>
      )}

      <dl className={styles.definitionGrid}>
        <DefinitionRow term="Shared mailbox">{contact.sharedMailbox}</DefinitionRow>
        <DefinitionRow term="Duty telephone">{contact.dutyTelephoneDisplay}</DefinitionRow>
        <DefinitionRow term="Operating hours">{contact.operatingHours}</DefinitionRow>
        <DefinitionRow term="Care coordinator">{contact.careCoordinator ?? undefined}</DefinitionRow>
        <DefinitionRow term="Outside those hours">
          {contact.afterHoursLabel} {contact.afterHoursTelephoneDisplay}.
        </DefinitionRow>
      </dl>

      <div className={styles.contactActions} data-print-hide="true">
        <a
          href={buildCmhtMailto(contact)}
          className={styles.contactAction}
          aria-disabled={blockedReason === null ? undefined : true}
          aria-describedby={blockedReason === null ? undefined : "care-plan-contact-action-blocked"}
          onClick={handleLaunch("email")}
        >
          {`Email ${contact.name}`}
        </a>
        <a
          href={buildCmhtTel(contact)}
          className={styles.contactAction}
          aria-disabled={blockedReason === null ? undefined : true}
          aria-describedby={blockedReason === null ? undefined : "care-plan-contact-action-blocked"}
          onClick={handleLaunch("call")}
        >
          {`Call ${contact.name}`}
        </a>
        <a
          href={buildCmhtTel(contact, "after_hours")}
          className={styles.contactAction}
          aria-disabled={blockedReason === null ? undefined : true}
          aria-describedby={blockedReason === null ? undefined : "care-plan-contact-action-blocked"}
          onClick={handleLaunch("call")}
        >
          Call the after-hours line
        </a>
      </div>

      {blockedReason === null ? null : (
        <p id="care-plan-contact-action-blocked" role="alert" className={styles.contactWarning}>
          {blockedReason}
        </p>
      )}

      <p className={styles.contactBoundary}>
        These controls open an application on this device. This prototype transmits nothing and holds no evidence of
        delivery, readership, or reply.
      </p>

      {failedChannel === null ? null : (
        <p role="alert" data-testid="care-plan-launch-failure" className={styles.launchFailure}>
          <strong>{`The external ${CHANNEL_NOUN[failedChannel]} could not be opened.`}</strong>{" "}
          {failedChannel === "email"
            ? "Nothing was sent, and no message exists."
            : "No call was placed, and no call exists."}{" "}
          {`Use the details above directly: ${contact.sharedMailbox}, or ${contact.dutyTelephoneDisplay}.`}
        </p>
      )}
    </SectionFrame>
  );
}
