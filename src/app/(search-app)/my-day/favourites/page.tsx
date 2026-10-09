import type { Metadata } from "next";

import { MyDayFavouritesPage } from "@/components/favourites/my-day-favourites-page";

export const metadata: Metadata = {
  title: "Favourites | My Day | PsychSift",
  description:
    "Everything you have saved to Favourites, to open from My Day. Clinical items follow your account, and work pages stay on this phone.",
};

export default function MyDayFavouritesRoute() {
  return <MyDayFavouritesPage />;
}
