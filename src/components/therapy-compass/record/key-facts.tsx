"use client";

import { RecordGlance, type RecordGlanceFact } from "@/components/clinical-record-panels";

import type { Therapy } from "../data/types";
import { therapyKeyFactCards } from "./key-fact-cards";

/**
 * The record's "At a glance" card: Format, Setting and Suits, each in full.
 *
 * These used to be four tiles with a glance line and "Tap for detail", which
 * cut the facts short on the screen a clinician reads first. The shared record
 * layout shows every value whole instead. Cautions is no longer a tile here: it
 * is the full Cautions block directly after this card (`TherapySafetySection`),
 * so the safety text is never truncated anywhere on the record.
 */
export function TherapyKeyFacts({ therapy }: { therapy: Therapy }) {
  const facts: RecordGlanceFact[] = therapyKeyFactCards(therapy)
    .filter((card) => card.id !== "cautions")
    .map((card) => ({ key: card.id, label: card.label, value: card.body }));

  return <RecordGlance facts={facts} testId="therapy-key-facts" />;
}
