import { z } from "zod";

import { publicErrorResponse } from "@/lib/http";
import { withTeachingApi } from "@/lib/teaching/api";
import { EpaMagicLinkError, type CreateEpaMagicLinkInput } from "@/lib/teaching/assessments/magic-link";
import { DurableEpaMagicLinkRepository } from "@/lib/teaching/assessments/magic-link-repository";
import { parseJsonBody } from "@/lib/validation/body";

export const runtime = "nodejs";

/*
 * A doctor's own visiting-supervisor EPA feedback links (#MAAXAX): GET lists them, POST makes one.
 * Signed in, rate limited and refused in demo mode by withTeachingApi. Every read and write is
 * scoped to the signed-in account, so no doctor can see another's links or feedback.
 */

const createSchema = z
  .object({
    epaCode: z.union([z.number().int().min(1).max(4), z.string().min(1).max(20)]),
    traineeName: z.string().trim().min(1).max(200),
    supervisorName: z.string().trim().min(1).max(200),
    supervisorRole: z.string().trim().max(100).optional(),
    clinicalSetting: z.string().trim().max(200).nullable().optional(),
  })
  .strict();

function magicLinkErrorResponse(error: unknown): Response {
  if (error instanceof EpaMagicLinkError) return publicErrorResponse(error.message, error.status, { code: error.code });
  throw error;
}

export async function GET(request: Request) {
  return withTeachingApi(request, async (client, ownerId) => ({
    links: await new DurableEpaMagicLinkRepository(client).listForRegistrar(ownerId),
  }));
}

export async function POST(request: Request) {
  return withTeachingApi(request, async (client, ownerId) => {
    const body = (await parseJsonBody(
      request,
      createSchema,
      "Check the supervisor link details and try again.",
    )) as CreateEpaMagicLinkInput;
    try {
      return await new DurableEpaMagicLinkRepository(client).create(ownerId, body);
    } catch (error) {
      return magicLinkErrorResponse(error);
    }
  });
}
