import { sendTestAlert } from "@/lib/roster/alerts/send";
import { removeSubscriptionBodySchema } from "@/lib/roster/alerts/subscriptions";
import { withRosterApi } from "@/lib/roster/team/api";
import { parseJsonBody } from "@/lib/validation/body";

export const runtime = "nodejs";

/**
 * Alerts page, "Send test": one test alert to the device that asked, if this
 * signed-in owner owns its subscription. The body carries the endpoint so it
 * stays out of URLs and access logs; nothing else is sent or stored.
 */
export async function POST(request: Request) {
  return withRosterApi(
    request,
    async (client, ownerId) => {
      const body = await parseJsonBody(
        request,
        removeSubscriptionBodySchema,
        "Choose this device's alert subscription.",
      );
      return { sent: await sendTestAlert(client, ownerId, body.endpoint) };
    },
    { demo: () => ({ sent: 0 }) },
  );
}
