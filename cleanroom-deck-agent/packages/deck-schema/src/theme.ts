import { z } from "zod";

export const semanticTokenNameSchema = z
  .string()
  .min(1)
  .regex(/^[A-Za-z][A-Za-z0-9._-]*$/);

export const colorValueSchema = z
  .string()
  .regex(/^#[0-9A-Fa-f]{6}$/);

export const fontTokenSchema = z
  .object({
    family: z.string().min(1),
    weight: z.number().int().min(100).max(900),
    style: z.enum(["normal", "italic"]).optional(),
  })
  .strict();

export const deckThemeSchema = z
  .object({
    name: z.string().min(1),
    colors: z.record(semanticTokenNameSchema, colorValueSchema),
    fonts: z.record(semanticTokenNameSchema, fontTokenSchema),
    spacing: z.record(semanticTokenNameSchema, z.number().nonnegative()),
    radius: z.record(semanticTokenNameSchema, z.number().nonnegative()),
  })
  .strict();

export type FontToken = z.infer<typeof fontTokenSchema>;
export type DeckTheme = z.infer<typeof deckThemeSchema>;

