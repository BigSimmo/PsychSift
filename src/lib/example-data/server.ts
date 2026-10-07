import { cookies } from "next/headers";

import { EXAMPLE_DATA_COOKIE, decodeExampleCookie } from "@/lib/example-data/keys";
import type { WorkAreaId } from "@/lib/work-frame/areas";

/**
 * Whether a server-rendered page should show an area's example data: true only
 * when this browser turned the switch on and has not since added a real record
 * there. The auto default (new accounts, empty areas) is decided in the
 * browser, which knows the account, and synced into the cookie from there.
 * Outside a request (a build step, a script, a unit test) there is no cookie,
 * so the answer is false and the page shows real data.
 */
export async function exampleDataOn(area: WorkAreaId): Promise<boolean> {
  try {
    return decodeExampleCookie((await cookies()).get(EXAMPLE_DATA_COOKIE)?.value).includes(area);
  } catch {
    return false;
  }
}
