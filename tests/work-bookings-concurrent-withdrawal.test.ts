import { describe, expect, it } from "vitest";
import { DurableSupervisorBookingRepository } from "@/lib/teaching/assessments/supervisor-bookings";

// Execute the real repository against a statement-level fake which books the
// newly published row between its INSERT and the post-insert overlap SELECT.
describe("concurrent availability withdrawal", () => {
  it.each([false, true])(
    "preserves a concurrent booking (%s) while withdrawing only unchanged open rows",
    async (bookDuringCheck) => {
      let stored: Record<string, unknown> | null = null;
      const client = {
        from: () => {
          const filters: [string, unknown][] = [];
          let patch: Record<string, unknown> | null = null;
          const chain = {
            select: () => chain,
            eq: (key: string, value: unknown) => {
              filters.push([key, value]);
              return chain;
            },
            order: () => chain,
            insert: (row: Record<string, unknown>) => {
              stored = structuredClone(row);
              return chain;
            },
            single: async () => ({ data: structuredClone(stored), error: null }),
            update: (values: Record<string, unknown>) => {
              patch = values;
              return chain;
            },
            maybeSingle: async () => {
              if (!stored || !filters.every(([key, value]) => stored?.[key] === value))
                return { data: null, error: null };
              Object.assign(stored, patch);
              return { data: stored, error: null };
            },
            range: async () => {
              if (!stored) return { data: [], error: null };
              if (bookDuringCheck) {
                stored.status = "submitted";
                stored.updated_at = "2099-01-01T00:00:00Z";
                stored.ratings = { ...(stored.ratings as object), bookingState: "booked", traineeId: "trainee" };
              }
              const earlier = { ...structuredClone(stored), id: "earlier-slot", created_at: "2020-01-01T00:00:00Z" };
              return { data: [stored, earlier], error: null };
            },
          };
          return chain;
        },
      };
      const repo = new DurableSupervisorBookingRepository(client as never);
      const created = repo.createAvailabilitySlot({
        id: "new-slot",
        serviceId: "service",
        supervisorId: "supervisor",
        startsAt: "2026-10-19T09:00:00Z",
        endsAt: "2026-10-19T10:00:00Z",
      });
      // A booked slot is reported as it now stands; only an unchanged open slot is withdrawn as a conflict.
      if (bookDuringCheck)
        await expect(created).resolves.toMatchObject({ bookingState: "booked", traineeId: "trainee" });
      else await expect(created).rejects.toThrow(/overlapping/);
      expect(stored).toMatchObject(
        bookDuringCheck
          ? { status: "submitted", ratings: { bookingState: "booked", traineeId: "trainee" } }
          : { status: "archived", ratings: { bookingState: "cancelled" } },
      );
    },
  );
});
