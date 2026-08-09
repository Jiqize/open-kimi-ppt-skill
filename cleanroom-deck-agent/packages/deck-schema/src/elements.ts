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

export const textWrapSchema = z
  .object({
    mode: z.enum(["word", "character", "none"]).optional(),
    maxLines: z.number().int().positive().optional(),
    overflow: z.enum(["clip", "ellipsis", "shrink"]).optional(),
  })
  .strict();

export const imageCropSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    w: z.number().positive().max(1),
    h: z.number().positive().max(1),
  })
  .strict()
  .superRefine((crop, context) => {
    if (crop.x + crop.w > 1) {
      context.addIssue({
        code: "custom",
        message: "Crop x + w must not exceed 1",
        path: ["w"],
      });
    }
    if (crop.y + crop.h > 1) {
      context.addIssue({
        code: "custom",
        message: "Crop y + h must not exceed 1",
        path: ["h"],
      });
    }
  });

export const normalizedPointSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
  })
  .strict();

export const textElementSchema = z
  .object({
    ...placementShape,
    type: z.literal("text"),
    text: z
      .object({
        value: z.string(),
        style: semanticTokenNameSchema.optional(),
        fontSize: z.number().positive().finite().optional(),
        color: semanticTokenNameSchema.optional(),
        bold: z.boolean().optional(),
        alignment: z.enum(["left", "center", "right", "justify"]).optional(),
        wrap: textWrapSchema.optional(),
      })
      .strict(),
  })
  .strict();

export const imageElementSchema = z
  .object({
    ...placementShape,
    type: z.literal("image"),
    source: z.string().min(1),
    fit: z.enum(["cover", "contain"]).optional(),
    crop: imageCropSchema.optional(),
    alt: z.string().optional(),
  })
  .strict();

export const shapeElementSchema = z
  .object({
    ...placementShape,
    type: z.literal("shape"),
    shape: z
      .object({
        kind: z.enum(["rectangle", "ellipse"]),
        fill: semanticTokenNameSchema.optional(),
        stroke: semanticTokenNameSchema.optional(),
        radius: z
          .union([z.number().nonnegative().finite(), semanticTokenNameSchema])
          .optional(),
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
        start: normalizedPointSchema,
        end: normalizedPointSchema,
        stroke: semanticTokenNameSchema.optional(),
        width: z.number().positive().finite().optional(),
        dash: z.enum(["solid", "dash", "dot"]).optional(),
        arrow: z.enum(["none", "start", "end", "both"]).optional(),
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
export type TextWrap = z.infer<typeof textWrapSchema>;
export type ImageCrop = z.infer<typeof imageCropSchema>;
export type NormalizedPoint = z.infer<typeof normalizedPointSchema>;
