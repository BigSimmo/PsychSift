"use client";

import { Heart } from "lucide-react";
import { useState } from "react";

import { focusRing } from "@/components/card-recipes";
import { modeControlShape, modeTapArea } from "@/components/mode-kit/recipes";
import { cn } from "@/components/ui-primitives";
import {
  addSavedNumber,
  dialableDigits,
  NUMBER_LABEL_MAX,
  removeSavedNumbers,
  useSavedNumbers,
} from "@/lib/favourites/favourites-local";

/**
 * Saves a work number from anywhere on the site (an On Call contact, a
 * service page) to Favourites, on this phone. Tapping again removes it.
 * A number is "already saved" when its dialled digits match, so the same
 * ward saved twice under two names is one number.
 */
export function SaveNumberToFavouritesButton({
  label,
  number,
  testId = "save-number-favourite",
}: {
  /** What the favourite is called, such as "Registrar, Fiona Stanley". */
  readonly label: string;
  /** The number as shown, spaces and all. */
  readonly number: string;
  readonly testId?: string;
}) {
  const numbers = useSavedNumbers();
  const digits = dialableDigits(number);
  const saved = numbers.find((entry) => dialableDigits(entry.number) === digits) ?? null;
  const [message, setMessage] = useState("");

  const toggle = () => {
    if (saved) {
      removeSavedNumbers(new Set([saved.id]));
      setMessage("Removed from Favourites.");
      return;
    }
    const result = addSavedNumber({ label: label.slice(0, NUMBER_LABEL_MAX), number });
    if (result.ok) setMessage("Saved to Favourites on this phone.");
    else if (result.reason === "full") setMessage("Favourites holds 40 numbers. Remove one first.");
    else if (result.reason === "storage") setMessage("This phone did not save that.");
    else setMessage("This number cannot be saved.");
  };

  return (
    <div className="flex min-w-0 items-center gap-2">
      <button
        type="button"
        onClick={toggle}
        aria-pressed={saved !== null}
        aria-label={saved ? `Remove ${label} from Favourites` : `Save ${label} to Favourites`}
        data-testid={testId}
        className={cn(modeTapArea, focusRing, "rounded-md")}
      >
        <span aria-hidden="true" className={modeControlShape.neutral}>
          <Heart
            aria-hidden="true"
            strokeWidth={1.5}
            className={cn("size-icon-md", saved ? "fill-current text-[color:var(--mode-identity)]" : null)}
          />
        </span>
      </button>
      <p role="status" className="min-w-0 text-sm text-[color:var(--text-muted)]" data-testid={`${testId}-status`}>
        {message}
      </p>
    </div>
  );
}
