import { z } from "zod";

export const deckSizeSchema = z
  .object({
    width: z.number().positive().finite(),
    height: z.number().positive().finite(),
  })
  .strict();

export const deckManifestSchema = z
  .object({
    version: z.literal(1),
    id: z.string().min(1),
    title: z.string().min(1),
    size: deckSizeSchema,
    theme: z.string().min(1).optional(),
    pages: z.array(z.string().min(1)).min(1),
  })
  .strict();

export type DeckSize = z.infer<typeof deckSizeSchema>;
export type DeckManifest = z.infer<typeof deckManifestSchema>;

