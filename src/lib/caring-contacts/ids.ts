declare const brand: unique symbol;
type Branded<T, B extends string> = T & { readonly [brand]: B };

export type TeamId = Branded<string, "TeamId">;
export type ActorId = Branded<string, "ActorId">;
export type PatientId = Branded<string, "PatientId">;
export type ReferralId = Branded<string, "ReferralId">;
export type PlanId = Branded<string, "PlanId">;
export type ContactId = Branded<string, "ContactId">;
export type PathwayVersionId = Branded<string, "PathwayVersionId">;
export type IdempotencyKey = Branded<string, "IdempotencyKey">;

const make =
  <T extends string>() =>
  (value: string): Branded<string, T> => {
    if (value.trim() === "") throw new Error("identifier must not be empty");
    return value as Branded<string, T>;
  };

export const teamId = make<"TeamId">();
export const actorId = make<"ActorId">();
export const patientId = make<"PatientId">();
export const referralId = make<"ReferralId">();
export const planId = make<"PlanId">();
export const contactId = make<"ContactId">();
export const pathwayVersionId = make<"PathwayVersionId">();
export const idempotencyKey = make<"IdempotencyKey">();
