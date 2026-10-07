import type { WorkHelpTopic } from "@/lib/work-help/types";

export const favouritesTopic: WorkHelpTopic = {
  id: "favourites",
  kind: "guide",
  title: "Favourites",
  identity: "my-day",
  summary: "Keep the services and forms you use most to hand",
  questions: [
    {
      id: "save-a-favourite",
      q: "How do I save something to Favourites?",
      a: "Tap the heart on a service, form, differential or therapy. It then appears on the Favourites page.",
      link: { label: "Favourites", href: "/favourites" },
    },
    {
      id: "group-favourites",
      q: "Can I group my favourites?",
      a: "Yes. Make sets and use Move to set on any favourite. Name sets by what you use them for, never by patient, because set names are saved to your account.",
      link: { label: "Favourites", href: "/favourites" },
    },
    {
      id: "quick-launch",
      q: "What is Quick launch?",
      a: "Up to four favourites kept within one tap on the Favourites page. Add or remove one from the favourite's actions.",
    },
    {
      id: "every-device",
      q: "Are my favourites on every device?",
      a: "Favourites are saved to your account, so they appear wherever you sign in. You need to be signed in to see them.",
    },
    {
      id: "remove-a-favourite",
      q: "How do I remove a favourite?",
      a: "Swipe the row left or open its actions, then tap Remove favourite. You can undo it from the message that appears.",
    },
    {
      id: "pin-a-number",
      q: "Can I pin a phone number from Admin?",
      a: "Yes, but that is separate from Favourites. Pin a number on Admin Help and it shows at the top of Help and on Today, on this phone only.",
      link: { label: "Help", href: "/admin/help" },
    },
  ],
  setUp: [{ label: "Favourites", href: "/favourites" }],
  keywords: "bookmark star heart saved save shortlist pinned quick launch sets collections shortcuts",
};
