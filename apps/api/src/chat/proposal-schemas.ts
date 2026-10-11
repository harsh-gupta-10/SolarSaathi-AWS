import { z } from "zod";
import { identifier, propertyInputSchema } from "../data/schemas";
import { createApplicationSchema, transitionStepSchema } from "../applications/schema";
import { manualMeasurementsSchema } from "../roof/schemas";

/** Parameter schemas for each proposal action. Validated at proposal time and again at confirm time. */
export const createPropertyParams = propertyInputSchema;
export const confirmRoofParams = z.union([
  z.object({ propertyId: identifier, previewId: identifier }).strict(),
  z.object({ propertyId: identifier, manual: manualMeasurementsSchema }).strict(),
]);
export const createApplicationParams = createApplicationSchema;
export const updateStepParams = z.object({
  propertyId: identifier, applicationId: identifier, stepId: z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/),
  expectedRevision: z.number().int().positive(), status: transitionStepSchema.shape.status, note: transitionStepSchema.shape.note,
}).strict();
export type CreatePropertyParams = z.infer<typeof createPropertyParams>;
export type ConfirmRoofParams = z.infer<typeof confirmRoofParams>;
export type CreateApplicationParams = z.infer<typeof createApplicationParams>;
export type UpdateStepParams = z.infer<typeof updateStepParams>;
