"use client";

import { ModeHomeStartGroup, ModeHomeStartRow } from "@/components/mode-home-start-list";
import { useSavedRegistryFavourites } from "@/components/clinical-dashboard/use-saved-registry-favourites";
import { appModeIcons } from "@/lib/app-mode-icons";
import type { AppModeId } from "@/lib/app-modes";

/** How many favourites a mode home lists; the Favourites page holds the rest. */
const FAVOURITES_SHOWN = 3;

/**
 * This mode's Favourites on its home, read from the account's saved records
 * (the same read the Favourites page makes; nothing here writes). Hidden when
 * there are none, while they load, and for a signed-out reader.
 */
export function ModeHomeFavouritesGroup({
  modeId,
  favouriteType,
}: {
  modeId: AppModeId;
  favouriteType: "differentials" | "therapies";
}) {
  const { items } = useSavedRegistryFavourites();
  const shown = items.filter((item) => item.type === favouriteType).slice(0, FAVOURITES_SHOWN);
  if (shown.length === 0) return null;
  return (
    <ModeHomeStartGroup id={`${modeId}-home-favourites`} title="Favourites" testId="mode-home-favourites">
      {shown.map((item) => (
        <ModeHomeStartRow key={item.id} href={item.href} icon={item.icon ?? appModeIcons[modeId]} title={item.title} />
      ))}
    </ModeHomeStartGroup>
  );
}
