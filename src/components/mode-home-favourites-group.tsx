"use client";

import { useEffect, useState } from "react";

import { useAccountData } from "@/components/account-data-provider";
import { ModeHomeStartGroup, ModeHomeStartRow } from "@/components/mode-home-start-list";
import { appModeIcons } from "@/lib/app-mode-icons";
import type { AppModeId } from "@/lib/app-modes";

/** How many favourites a mode home lists; the Favourites page holds the rest. */
const FAVOURITES_SHOWN = 3;

type FavouriteRow = { readonly slug: string; readonly title: string; readonly href: string };

/**
 * This mode's Favourites on its home. Reads only this mode's saved slugs from
 * the account data already loaded for the app (nothing here writes, and no
 * service or form registry is fetched). Hidden when there are none, while they
 * load, and for a signed-out reader.
 */
export function ModeHomeFavouritesGroup({
  modeId,
  favouriteType,
}: {
  modeId: AppModeId;
  favouriteType: "differentials" | "therapies";
}) {
  // While an account's favourites are loading (including straight after a switch
  // of account), the previous account's list is still in memory: show nothing.
  const { ready } = useAccountData();
  if (!ready) return null;
  return favouriteType === "therapies" ? (
    <TherapyFavourites modeId={modeId} />
  ) : (
    <DifferentialFavourites modeId={modeId} />
  );
}

/** Differential favourites are named from their slug, exactly as the Favourites page names them. */
function DifferentialFavourites({ modeId }: { modeId: AppModeId }) {
  const slugs = useAccountData().favourites.differential.slice(0, FAVOURITES_SHOWN);
  const rows = slugs.map((slug) => ({
    slug,
    title: slug
      .split("-")
      .filter(Boolean)
      .map((word) => word[0]?.toUpperCase() + word.slice(1))
      .join(" "),
    href: `/differentials/diagnoses/${encodeURIComponent(slug)}`,
  }));
  return <FavouritesRows modeId={modeId} rows={rows} />;
}

/** Therapy favourites take their names from the therapy catalogue, loaded only on the Therapy home and only when some are saved. */
function TherapyFavourites({ modeId }: { modeId: AppModeId }) {
  const saved = useAccountData().favourites.therapy;
  const key = saved.slice(0, FAVOURITES_SHOWN).join("\u0000");
  const [loaded, setLoaded] = useState<{ key: string; rows: FavouriteRow[] }>({ key: "", rows: [] });

  useEffect(() => {
    if (!key) return undefined;
    let active = true;
    void import("@/lib/therapies")
      .then(({ findTherapyRecord }) => {
        if (!active) return;
        const rows = key.split("\u0000").flatMap((slug) => {
          const therapy = findTherapyRecord(slug);
          return therapy ? [{ slug, title: therapy.name, href: `/therapy-compass/${therapy.slug}` }] : [];
        });
        setLoaded({ key, rows });
      })
      .catch(() => {
        // The group stays hidden; the Favourites page still lists them.
      });
    return () => {
      active = false;
    };
  }, [key]);

  return <FavouritesRows modeId={modeId} rows={loaded.key === key ? loaded.rows : []} />;
}

function FavouritesRows({ modeId, rows }: { modeId: AppModeId; rows: readonly FavouriteRow[] }) {
  if (rows.length === 0) return null;
  return (
    <ModeHomeStartGroup id={`${modeId}-home-favourites`} title="Favourites" testId="mode-home-favourites">
      {rows.map((row) => (
        <ModeHomeStartRow key={row.slug} href={row.href} icon={appModeIcons[modeId]} title={row.title} />
      ))}
    </ModeHomeStartGroup>
  );
}
