import { redirect } from "next/navigation";

/* Week is part of This week now (mock-up v5). The browser keeps any #fragment across the redirect. */
export default function TeachingWeekRoute() {
  redirect("/teaching");
}
