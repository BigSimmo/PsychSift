import { headers } from "next/headers";
export const dynamic = "force-dynamic";
export default async function Page() {
  const values = await headers();
  return <main>{"runtime-proof-" + values.get("x-runtime-probe")}</main>;
}
