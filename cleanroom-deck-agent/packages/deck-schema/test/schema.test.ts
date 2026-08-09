import { describe, expect, it } from "vitest";

import {
  deckManifestSchema,
  deckPageSchema,
  deckThemeSchema,
  type DeckManifest,
} from "../src/index.js";

const validManifest: DeckManifest = {
  version: 1,
  id: "ai-fashion-review",
  title: "AI Fashion Trend Review",
  size: {
    width: 13.333,
    height: 7.5,
  },
  theme: "themes/executive-light.yaml",
  pages: ["pages/01-cover.yaml", "pages/02-context.yaml"],
};

describe("deckManifestSchema", () => {
  it("accepts a valid manifest", () => {
    expect(deckManifestSchema.parse(validManifest)).toEqual(validManifest);
  });

  it("rejects negative slide sizes", () => {
    const result = deckManifestSchema.safeParse({
      ...validManifest,
      size: { width: -13.333, height: 7.5 },
    });

    expect(result.success).toBe(false);
  });

  it("rejects a missing pages field", () => {
    const { pages: _pages, ...withoutPages } = validManifest;

    expect(deckManifestSchema.safeParse(withoutPages).success).toBe(false);
  });

  it("rejects unknown manifest fields", () => {
    expect(
      deckManifestSchema.safeParse({ ...validManifest, remoteEditor: true })
        .success,
    ).toBe(false);
  });
});

describe("deckPageSchema", () => {
  it("accepts all Phase 1 element types and semantic token references", () => {
    const result = deckPageSchema.safeParse({
      id: "page-02",
      type: "insight",
      layout: { type: "split", ratio: 0.58 },
      background: { color: "background" },
      elements: [
        {
          id: "title",
          type: "text",
          slot: "left.title",
          text: { value: "A title", style: "heading-1" },
        },
        {
          id: "hero",
          type: "image",
          slot: "right.hero",
          source: "../media/hero.jpg",
          fit: "cover",
        },
        {
          id: "card",
          type: "shape",
          x: 0.7,
          y: 1.4,
          w: 4,
          h: 2,
          shape: { kind: "rectangle", fill: "accent" },
        },
        {
          id: "divider",
          type: "line",
          x: 6.5,
          y: 1,
          w: 0.01,
          h: 5,
          line: { color: "muted", width: 1 },
        },
      ],
    });

    expect(result.success).toBe(true);
  });

  it("rejects unsupported element types", () => {
    const result = deckPageSchema.safeParse({
      id: "page-01",
      type: "cover",
      layout: { type: "cover" },
      elements: [{ id: "video", type: "video", source: "clip.mp4" }],
    });

    expect(result.success).toBe(false);
  });

  it("rejects negative element sizes", () => {
    const result = deckPageSchema.safeParse({
      id: "page-01",
      type: "cover",
      layout: { type: "cover" },
      elements: [
        {
          id: "title",
          type: "text",
          x: 1,
          y: 1,
          w: -4,
          h: 1,
          text: { value: "Title" },
        },
      ],
    });

    expect(result.success).toBe(false);
  });
});

describe("deckThemeSchema", () => {
  it("accepts semantic theme token maps", () => {
    const result = deckThemeSchema.safeParse({
      name: "executive-light",
      colors: {
        background: "#F7F7F5",
        foreground: "#161616",
        accent: "#3157F6",
      },
      fonts: {
        heading: { family: "Arial", weight: 700 },
        body: { family: "Arial", weight: 400 },
      },
      spacing: { pageMargin: 0.7, grid: 0.1 },
      radius: { card: 0.12 },
    });

    expect(result.success).toBe(true);
  });
});
