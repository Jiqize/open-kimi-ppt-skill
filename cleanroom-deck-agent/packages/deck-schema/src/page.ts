import { z } from "zod";

import { deckElementSchema } from "./elements.js";
import { semanticTokenNameSchema } from "./theme.js";

export const pageLayoutSchema = z
  .object({
    type: z.string().min(1),
    ratio: z.number().positive().max(1).optional(),
  })
  .strict();

export const pageBackgroundSchema = z
  .object({
    color: semanticTokenNameSchema,
  })
  .strict();

export const deckPageSchema = z
  .object({
    id: z.string().min(1),
    type: z.string().min(1),
    layout: pageLayoutSchema,
    background: pageBackgroundSchema.optional(),
    elements: z.array(deckElementSchema),
  })
  .strict();

export type PageLayout = z.infer<typeof pageLayoutSchema>;
export type PageBackground = z.infer<typeof pageBackgroundSchema>;
export type DeckPage = z.infer<typeof deckPageSchema>;

