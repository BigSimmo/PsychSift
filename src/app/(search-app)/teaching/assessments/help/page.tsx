import { redirect } from "next/navigation";

// Help and words lives inside the Assessments page, for supervisors. This address stays so older links still land.
export default function Page() {
  redirect("/teaching/assessments?view=words&as=supervisor");
}
