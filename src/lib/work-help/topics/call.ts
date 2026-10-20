import type { WorkHelpTopic } from "@/lib/work-help/types";

export const callTopic: WorkHelpTopic = {
  id: "call",
  kind: "area",
  title: "On Call",
  areaId: "call",
  identity: "on-call",
  summary: "Who to ring and where to refer, on shift",
  tabs: [
    { label: "Now", body: "Who covers this hour at your hospital, your shift, and the numbers you use most." },
    { label: "Call", body: "Every number you may need tonight and where to refer, in one searchable list." },
    { label: "Shift", body: "Your handover, call log and breaks, kept on this phone and cleared after the shift." },
    { label: "Handbook", body: "How your hospital works: the playbook, starting here, who's who and the pocket card." },
  ],
  questions: [
    {
      id: "no-hospital-numbers",
      q: "Why can't I see my hospital's numbers?",
      a: "The numbers come from your hospital's handbook, which is for members only. If you are not in one yet, ask your hospital's handbook admin for an invite.",
      link: { label: "Manage this hospital", href: "/on-call/service" },
    },
    {
      id: "extension-will-not-dial",
      q: "Why won't a short extension dial from my mobile?",
      a: "A mobile cannot reach a hospital extension. If you are on a hospital phone, turn on I'm on a hospital phone on Call, and extensions get their own call button.",
      link: { label: "Call", href: "/on-call/call" },
    },
    {
      id: "did-not-connect",
      q: "What if a number doesn't connect?",
      a: "Open the number and tap Didn't connect. You are offered switchboard instead, and a hospital number can be reported to the handbook's editors.",
    },
    {
      id: "write-a-handover",
      q: "Can I write a handover here?",
      a: "Yes. Handover, under Shift, builds a psychiatry handover one patient at a time, using a bed number or up to four initials. It stays on this phone, leaves only by Copy or Print, and is cleared after the shift.",
      link: { label: "Handover", href: "/on-call/handover" },
    },
    {
      id: "is-the-number-right",
      q: "How do I know a number is still right?",
      a: "A referral route that has not been checked for a while says so on its row. Numbers to check, at the foot of Call, lists your own entries due for a check, and Still correct stamps today's date.",
      link: { label: "Check these", href: "/on-call/check" },
    },
    {
      id: "print-key-numbers",
      q: "Can I print the key numbers?",
      a: "Yes. Pocket card, in the Handbook, is a one page summary of the entries marked for the card, ready to print.",
      link: { label: "Pocket card", href: "/on-call/card" },
    },
  ],
  setUp: [{ label: "Manage this hospital", href: "/on-call/service" }],
  keywords:
    "after hours night shift switchboard pager extension phone numbers contacts referral handbook wards registrar consultant emergency handover isbar pocket card first night orientation",
};
