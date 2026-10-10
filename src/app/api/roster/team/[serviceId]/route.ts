import { z } from "zod";

import { dispatchRosterAlerts, type RosterAlertEvent } from "@/lib/roster/alerts/dispatch";
import { runAfterResponse, withRosterApi } from "@/lib/roster/team/api";
import { demoRosterCommand, demoRosterRead } from "@/lib/roster/team/demo-team";
import { rosterInvalidRequest } from "@/lib/roster/team/errors";
import {
  ROSTER_ALL_READS,
  ROSTER_MAX_WINDOW_DAYS,
  ROSTER_WINDOWED_READS,
  rosterActionSchema,
  type RosterReadWhat,
} from "@/lib/roster/team/model";
import { rosterCommand, rosterRead, type RosterReadPayload } from "@/lib/roster/team/repository";
import { parseJsonBody } from "@/lib/validation/body";

export const runtime = "nodejs";

/**
 * One team's reads (GET `?what=`) and writes (POST, one action). The actor is
 * the session user only: no query key or body key can name one, and every
 * body is strict, so a body carrying `actorId` is refused with 400. Publishing
 * and the roster maker's other actions are refused here; only the publish
 * route sends them. The team's safe number (`needs.set`) is sent here, and the
 * SQL refuses it from anyone but a manager.
 */

type Context = { params: Promise<{ serviceId: string }> };

const serviceIdSchema = z.string().uuid();
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

async function serviceIdFrom(context: Context): Promise<string> {
  const parsed = serviceIdSchema.safeParse((await context.params).serviceId);
  if (!parsed.success) throw rosterInvalidRequest("Unknown team.");
  return parsed.data;
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** The read and its window, checked before the database is asked. */
function readRequest(request: Request): { what: RosterReadWhat; payload: RosterReadPayload } {
  const params = new URL(request.url).searchParams;
  const what = params.get("what");
  if (!what || !(ROSTER_ALL_READS as readonly string[]).includes(what)) throw rosterInvalidRequest();
  const read = what as RosterReadWhat;
  if (!ROSTER_WINDOWED_READS.includes(read)) return { what: read, payload: {} };
  const from = dateSchema.safeParse(params.get("from"));
  const to = dateSchema.safeParse(params.get("to"));
  if (!from.success || !to.success) throw rosterInvalidRequest("Choose the dates to read.");
  const span = daysBetween(from.data, to.data);
  if (!Number.isFinite(span) || span < 0 || span > ROSTER_MAX_WINDOW_DAYS) {
    throw rosterInvalidRequest(`Read at most ${ROSTER_MAX_WINDOW_DAYS} days at a time.`);
  }
  return { what: read, payload: { from: from.data, to: to.data } };
}

export async function GET(request: Request, context: Context) {
  return withRosterApi(
    request,
    async (client, actorId) => {
      const serviceId = await serviceIdFrom(context);
      const { what, payload } = readRequest(request);
      return rosterRead(client, actorId, serviceId, what, payload);
    },
    {
      demo: () => {
        const { what, payload } = readRequest(request);
        return demoRosterRead(what, payload);
      },
    },
  );
}

export async function POST(request: Request, context: Context) {
  return withRosterApi(
    request,
    async (client, actorId) => {
      const serviceId = await serviceIdFrom(context);
      const action = await parseJsonBody(request, rosterActionSchema, "Check the request and try again.");
      let before: RosterAlertEvent["before"];
      if (action.action === "open.decline") {
        // The SQL clears the claimer on decline, so read it first for the alert. A failed read
        // never stops the decline itself.
        try {
          const manage = await rosterRead(client, actorId, serviceId, "manage");
          const open = manage.openShifts.find((item) => item.id === action.openShiftId);
          if (open) before = { claimedBy: open.claimedBy };
        } catch {
          before = undefined;
        }
      }
      const result = await rosterCommand(client, actorId, serviceId, action);
      const event: RosterAlertEvent = { serviceId, actorId, action, result, ...(before ? { before } : {}) };
      runAfterResponse(() => dispatchRosterAlerts(client, event));
      return { result };
    },
    {
      // Release held: an example receipt for the sample team. Nothing is saved and no alert is sent.
      sample: async () => {
        await serviceIdFrom(context);
        const action = await parseJsonBody(request, rosterActionSchema, "Check the request and try again.");
        return { result: demoRosterCommand(action) };
      },
    },
  );
}
