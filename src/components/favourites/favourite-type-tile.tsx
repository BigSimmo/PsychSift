import { cn } from "@/components/ui-primitives";
import type { FavouriteItem, FavouriteType } from "@/components/favourites/favourites-view-model";

// One tint per content type, from the same type tokens the category chips use,
// so a Table tile and a Table chip can never disagree. A work page wears its
// work area's colour instead (`data-mode-identity`), like every work-mode icon.
const tileTone: Record<FavouriteType, string> = {
  Medication: "bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]",
  Document: "bg-[color:var(--type-document-soft)] text-[color:var(--type-document)]",
  Table: "bg-[color:var(--type-table-soft)] text-[color:var(--type-table)]",
  "Saved search": "bg-[color:var(--type-search-soft)] text-[color:var(--type-search)]",
  Source: "bg-[color:var(--type-source-soft)] text-[color:var(--type-source)]",
  Service: "bg-[color:var(--type-service-soft)] text-[color:var(--type-service)]",
  Form: "bg-[color:var(--type-form-soft)] text-[color:var(--type-form)]",
  Differential: "bg-[color:var(--tone-rose-soft)] text-[color:var(--tone-rose)]",
  Therapy: "bg-[color:var(--tone-purple-soft)] text-[color:var(--tone-purple)]",
  "Work page": "bg-[color:var(--mode-identity-soft)] text-[color:var(--mode-identity)]",
  // A saved number wears On Call's colour, where the hospital's numbers live.
  Number: "bg-[color:var(--mode-identity-soft)] text-[color:var(--mode-identity)]",
};

/** The flat round icon in front of a favourite, in the colour of where it leads. */
export function FavouriteTypeTile({ item, size = "md" }: { item: FavouriteItem; size?: "sm" | "md" | "lg" | "xl" }) {
  const Icon = item.icon;
  return (
    <span
      aria-hidden="true"
      data-mode-identity={item.type === "Work page" || item.type === "Number" ? item.identity : undefined}
      className={cn(
        "grid shrink-0 place-items-center rounded-full",
        size === "sm" ? "size-6" : size === "lg" ? "size-10" : size === "xl" ? "size-10" : "size-9",
        tileTone[item.type],
      )}
    >
      <Icon
        aria-hidden="true"
        strokeWidth={2}
        className={size === "sm" ? "size-icon-xs" : size === "lg" || size === "xl" ? "size-icon-md" : "size-icon-sm"}
      />
    </span>
  );
}
