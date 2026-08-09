import { z } from "zod";

import { semanticTokenNameSchema } from "./theme.js";

const placementShape = {
  id: z.string().min(1),
  slot: z.string().min(1).optional(),
  x: z.number().finite().optional(),
  y: z.number().finite().optional(),
  w: z.number().positive().finite().optional(),
  h: z.number().positive().finite().optional(),
};

export const textElementSchema = z
  .object({
    ...placementShape,
    type: z.literal("text"),
    text: z
      .object({
        value: z.string(),
        style: semanticTokenNameSchema.optional(),
      })
      .strict(),
  })
  .strict();

export const imageElementSchema = z
  .object({
    ...placementShape,
    type: z.literal("image"),
    source: z.string().min(1),
    fit: z.enum(["cover", "contain", "fill"]).optional(),
    alt: z.string().optional(),
  })
  .strict();

export const shapeElementSchema = z
  .object({
    ...placementShape,
    type: z.literal("shape"),
    shape: z
      .object({
        kind: z.string().min(1),
        fill: semanticTokenNameSchema.optional(),
        stroke: semanticTokenNameSchema.optional(),
      })
      .strict(),
  })
  .strict();

export const lineElementSchema = z
  .object({
    ...placementShape,
    type: z.literal("line"),
    line: z
      .object({
        color: semanticTokenNameSchema.optional(),
        width: z.number().positive().finite().optional(),
        dash: z.enum(["solid", "dash", "dot"]).optional(),
      })
      .strict(),
  })
  .strict();

export const deckElementSchema = z.discriminatedUnion("type", [
  textElementSchema,
  imageElementSchema,
  shapeElementSchema,
  lineElementSchema,
]);

export type TextElement = z.infer<typeof textElementSchema>;
export type ImageElement = z.infer<typeof imageElementSchema>;
export type ShapeElement = z.infer<typeof shapeElementSchema>;
export type LineElement = z.infer<typeof lineElementSchema>;
export type DeckElement = z.infer<typeof deckElementSchema>;

