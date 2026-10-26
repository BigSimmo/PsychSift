import { NextResponse } from "next/server";
import { z } from "zod";
import { env } from "@/lib/env";
import { jsonError, publicErrorResponse } from "@/lib/http";
import { readBoundedJson } from "@/lib/validation/body";
import { logger } from "@/lib/logger";
import { postChatNotification, type ChatSeverity } from "@/lib/webhooks/chat-notify";
import { presentedWebhookSecret, verifyWebhookSecret } from "@/lib/webhooks/secret-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Receiver for Railway project deploy webhooks. Railway payloads are unsigned, but
// a webhook can carry custom headers, so the shared secret travels in an
// `x-webhook-secret` (or `Authorization: Bearer`) header and is compared
// constant-time. A `?token=` URL is refused so the secret stays out of logs. The
// route forwards notable deploy status changes for the app + worker services to
// Slack/Discord — the piece GitHub cannot report, since it does not know Railway's
// deploy outcome. See docs/webhooks.md for setup.
//
// Railway's current payload names the event in `type` ("Deployment.failed") and nests the
// names under `resource` and the deploy status under `details`. The older flat shape (top-level
// `status`, `project`, `service`) is still read. Reading only the flat shape answered every
// current delivery with `status_not_notable`, so an authenticated failed deploy still reached
// nobody (audit 26 Oct 2026, LS-02).

const namedEntitySchema = z.object({ name: z.string().max(200).optional() });

const deploymentSchema = z
  .object({ id: z.string().max(200).optional(), meta: z.record(z.string().max(200), z.unknown()).optional() })
  .optional();

const railwayWebhookSchema = z.object({
  type: z.string().max(200).optional(),
  status: z.string().max(200).optional(),
  timestamp: z.string().max(200).optional(),
  project: namedEntitySchema.optional(),
  environment: namedEntitySchema.optional(),
  service: namedEntitySchema.optional(),
  deployment: deploymentSchema,
  details: z.object({ status: z.string().max(200).optional() }).optional(),
  resource: z
    .object({
      project: namedEntitySchema.optional(),
      environment: namedEntitySchema.optional(),
      service: namedEntitySchema.optional(),
      deployment: deploymentSchema,
    })
    .optional(),
});

type RailwayWebhookPayload = z.infer<typeof railwayWebhookSchema>;

// Only forward status changes worth a ping; transient build/deploy phases are
// dropped to keep the channel quiet.
const NOTABLE_STATUSES = new Set(["SUCCESS", "FAILED", "CRASHED", "REMOVED"]);

function severityForStatus(status: string): ChatSeverity {
  if (status === "SUCCESS") return "success";
  if (status === "FAILED" || status === "CRASHED") return "error";
  if (status === "REMOVED") return "warning";
  return "info";
}

// "Deployment.failed" -> "FAILED". Only deployment events carry a deploy status; volume and
// monitor alerts have other prefixes and fall through to the payload's own status fields.
function statusFromType(type: string | undefined): string {
  const match = /^deployment\.([a-z_]+)$/i.exec(type ?? "");
  return match?.[1]?.toUpperCase() ?? "";
}

function deployStatus(payload: RailwayWebhookPayload): string {
  return (statusFromType(payload.type) || payload.details?.status || payload.status || "").toUpperCase();
}

function serviceName(payload: RailwayWebhookPayload): string {
  const fromService = payload.resource?.service?.name ?? payload.service?.name;
  if (typeof fromService === "string" && fromService) return fromService;
  const fromMeta = (payload.resource?.deployment ?? payload.deployment)?.meta?.["serviceName"];
  if (typeof fromMeta === "string" && fromMeta) return fromMeta;
  return "unknown service";
}

export async function POST(request: Request) {
  try {
    const auth = verifyWebhookSecret(request, env.RAILWAY_WEBHOOK_SECRET, { allowQueryToken: false });
    if (!auth.ok) {
      if (auth.reason === "misconfigured") {
        logger.error("Railway webhook rejected: RAILWAY_WEBHOOK_SECRET is not set on this service");
        return publicErrorResponse("Railway webhook receiver is not configured.", 503, {
          code: "webhook_not_configured",
        });
      }
      // A rejection here used to be completely silent, and that silence cost three days.
      // On 2026-09-13 this endpoint answered 401 to eighteen consecutive Railway deliveries —
      // three retries each for six deploy events, including the two failed production deploys at
      // 17:24 and 18:04 — and wrote nothing anywhere. The alert never reached the chat forwarder
      // to be dropped for want of a destination; it was turned away at the door. From the outside
      // a misconfigured shared secret and an internet scanner looked identical.
      //
      // `warn` rather than `error` because this path is publicly reachable and will catch stray
      // probes; the logger forwards warn to Sentry either way, so a real misconfiguration still
      // surfaces without a scanner being able to raise an error-level alert.
      //
      // `tokenPresented` is the field that separates the two cases — a scanner sends nothing, a
      // Railway webhook whose header has drifted from the service variable sends something
      // that does not match. The token itself is never logged.
      logger.warn("Railway webhook rejected: presented secret did not match RAILWAY_WEBHOOK_SECRET", {
        tokenPresented: Boolean(presentedWebhookSecret(request, { allowQueryToken: false })),
      });
      return publicErrorResponse("Unauthorized.", 401);
    }

    let rawBody: unknown;
    try {
      rawBody = await readBoundedJson(request);
      if (rawBody === null && request.body) {
        return publicErrorResponse("Invalid JSON body.", 400, { code: "invalid_json" });
      }
    } catch {
      return publicErrorResponse("Invalid JSON body.", 400, { code: "invalid_json" });
    }

    const parsed = railwayWebhookSchema.safeParse(rawBody);
    if (!parsed.success) {
      // Authenticated but unrecognised shape: accept so Railway does not retry,
      // and record it for debugging.
      logger.warn("Railway webhook payload did not match expected shape");
      return NextResponse.json({ skipped: true, reason: "unrecognized_payload" });
    }

    const payload = parsed.data;
    const status = deployStatus(payload);
    if (!NOTABLE_STATUSES.has(status)) {
      return NextResponse.json({ skipped: true, reason: "status_not_notable", status });
    }

    const project = payload.resource?.project?.name ?? payload.project?.name ?? "Railway project";
    const environment = payload.resource?.environment?.name ?? payload.environment?.name ?? "unknown environment";
    const service = serviceName(payload);
    const severity = severityForStatus(status);

    const delivery = await postChatNotification({
      title: `Railway deploy ${status.toLowerCase()}: ${service}`,
      text: `Deploy of *${service}* in *${project}* (${environment}) reported status *${status}*.`,
      severity,
      fields: [
        { label: "Project", value: project },
        { label: "Environment", value: environment },
        { label: "Service", value: service },
        { label: "Status", value: status },
      ],
    });

    return NextResponse.json({ forwarded: delivery.delivered, delivery });
  } catch (error) {
    return jsonError(error);
  }
}
