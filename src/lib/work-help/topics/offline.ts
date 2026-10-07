import type { WorkHelpTopic } from "@/lib/work-help/types";

export const offlineTopic: WorkHelpTopic = {
  id: "offline",
  kind: "guide",
  title: "Phone, offline and updates",
  identity: "my-day",
  summary: "Home screen, poor signal and app updates",
  questions: [
    {
      id: "home-screen",
      q: "Can I put PsychSift on my home screen?",
      a: "Yes. On an iPhone, open it in Safari, tap Share, then Add to Home Screen. On other phones, accept the install prompt when the app offers it. It then opens like an app, with no app store.",
    },
    {
      id: "works-on-a-phone",
      q: "Does everything work on a phone?",
      a: "Yes. Every work area is built to be used on a phone, and the same account works on a computer.",
    },
    {
      id: "no-signal",
      q: "What still works without signal?",
      a: "If My Day or CPD was already open, it keeps showing what had loaded. On Call shows its last saved copy with the date, when there is one. Clinical search and saving changes need a connection.",
    },
    {
      id: "admin-offline",
      q: "Why is Admin empty when I am offline?",
      a: "Admin keeps none of your records on the phone. Try again once you have signal.",
    },
    {
      id: "latest-version",
      q: "How do I get the latest version?",
      a: "When an update is ready, a notice says Update available. Tap Reload when it suits you, or Later to keep working.",
    },
    {
      id: "iphone-alerts",
      q: "Why can't I turn on alerts on my iPhone?",
      a: "Apple only allows them once PsychSift is on your Home Screen. Add it there, open it from the new icon, then turn on phone alerts on the Alerts page.",
      link: { label: "Alerts", href: "/my-day/alerts" },
    },
  ],
  setUp: [{ label: "Alerts", href: "/my-day/alerts" }],
  keywords:
    "install app pwa home screen iphone android safari chrome offline no signal wifi reception update reload new version mobile",
};
