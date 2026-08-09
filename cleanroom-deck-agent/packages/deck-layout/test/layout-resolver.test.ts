import type { DeckProject } from "@deck-agent/deck-core";
import type { DeckPage, DeckTheme } from "@deck-agent/deck-schema";
import { describe, expect, it } from "vitest";

import { resolveDeck } from "../src/layout-resolver.js";

const theme: DeckTheme = {
  name: "test-theme",
  colors: {
    background: "#FFFFFF",
    accent: "#3157F6",
    muted: "#686868",
  },
  fonts: {
    heading: { family: "Arial", weight: 700 },
    body: { family: "Arial", weight: 400 },
  },
  spacing: { pageMargin: 0.7, grid: 0.1 },
  radius: { card: 0.12 },
};

function projectWithPage(
  page: DeckPage,
  projectTheme?: DeckTheme,
): DeckProject {
  return {
    root: "/virtual/deck",
    manifest: {
      version: 1,
      id: "test-deck",
      title: "Test Deck",
      size: { width: 10, height: 6 },
      pages: ["pages/01.yaml"],
      ...(projectTheme === undefined ? {} : { theme: "themes/test.yaml" }),
    },
    pages: [page],
    ...(projectTheme === undefined ? {} : { theme: projectTheme }),
  };
}

describe("resolveDeck", () => {
  it("preserves free-coordinate bounds and stable element ids", () => {
    const project = projectWithPage({
      id: "page-01",
      type: "cover",
      layout: { type: "free" },
      elements: [
        {
          id: "hero",
          type: "image",
          x: 1,
          y: 0.5,
          w: 8,
          h: 5,
          source: "../media/hero.jpg",
          fit: "cover",
        },
      ],
    });

    expect(resolveDeck(project).pages[0]?.elements[0]).toEqual({
      id: "hero",
      type: "image",
      x: 1,
      y: 0.5,
      w: 8,
      h: 5,
      content: {
        source: "media/hero.jpg",
        fit: "cover",
      },
      style: {},
    });
  });

  it("preserves a remote image URL for the asset provider", () => {
    const project = projectWithPage({
      id: "page-01",
      type: "cover",
      layout: { type: "free" },
      elements: [
        {
          id: "remote-hero",
          type: "image",
          x: 1,
          y: 1,
          w: 8,
          h: 4,
          source: "https://assets.example.com/hero.png",
        },
      ],
    });

    expect(resolveDeck(project).pages[0]?.elements[0]).toMatchObject({
      type: "image",
      content: { source: "https://assets.example.com/hero.png" },
    });
  });

  it("normalizes legacy split ratio and resolves left and right slots", () => {
    const project = projectWithPage({
      id: "page-01",
      type: "insight",
      layout: {
        type: "split",
        ratio: 0.6,
        options: { margin: 1, gap: 0.5 },
      },
      elements: [
        {
          id: "title",
          type: "text",
          slot: "left.title",
          text: { value: "Title", style: "heading" },
        },
        {
          id: "hero",
          type: "image",
          slot: "right.hero",
          source: "../media/hero.jpg",
        },
      ],
    }, theme);

    const resolved = resolveDeck(project);

    expect({
      layout: resolved.pages[0]?.layout,
      elements: resolved.pages[0]?.elements.map(
        ({ id, x, y, w, h }) => ({ id, x, y, w, h }),
      ),
    }).toMatchInlineSnapshot(`
      {
        "elements": [
          {
            "h": 1,
            "id": "title",
            "w": 4.5,
            "x": 1,
            "y": 1,
          },
          {
            "h": 2.5,
            "id": "hero",
            "w": 3,
            "x": 6,
            "y": 2.5,
          },
        ],
        "layout": {
          "options": {
            "gap": 0.5,
            "margin": 1,
            "ratio": 0.6,
            "titleHeight": 1,
          },
          "type": "split",
        },
      }
    `);
  });

  it("resolves theme tokens into concrete normalized styles", () => {
    const project = projectWithPage({
      id: "page-01",
      type: "insight",
      layout: { type: "free" },
      background: { color: "background" },
      elements: [
        {
          id: "card",
          type: "shape",
          x: 1,
          y: 1,
          w: 4,
          h: 2,
          shape: { kind: "rectangle", fill: "accent", stroke: "muted" },
        },
      ],
    }, theme);

    const page = resolveDeck(project).pages[0];

    expect(page?.background).toEqual({ color: "#FFFFFF" });
    expect(page?.elements[0]?.style).toEqual({
      fill: "#3157F6",
      stroke: "#686868",
      strokeWidth: 1,
      radius: 0,
    });
  });

  it("is deterministic for identical input", () => {
    const project = projectWithPage({
      id: "page-01",
      type: "cover",
      layout: { type: "free" },
      elements: [
        {
          id: "title",
          type: "text",
          x: 1,
          y: 1,
          w: 8,
          h: 1,
          text: { value: "Deterministic" },
        },
      ],
    });

    expect(JSON.stringify(resolveDeck(project))).toBe(
      JSON.stringify(resolveDeck(project)),
    );
  });

  it("rejects duplicate element ids within one page", () => {
    const project = projectWithPage({
      id: "page-01",
      type: "cover",
      layout: { type: "free" },
      elements: [
        {
          id: "duplicate",
          type: "text",
          x: 1,
          y: 1,
          w: 4,
          h: 1,
          text: { value: "First" },
        },
        {
          id: "duplicate",
          type: "text",
          x: 1,
          y: 2,
          w: 4,
          h: 1,
          text: { value: "Second" },
        },
      ],
    });

    expect(() => resolveDeck(project)).toThrowError(
      expect.objectContaining({
        code: "ELEMENT_ID_DUPLICATE",
        context: expect.objectContaining({
          pageId: "page-01",
          elementId: "duplicate",
        }),
      }),
    );
  });

  it("allows the same element id on different pages", () => {
    const repeatedElement = {
      id: "repeated",
      type: "text" as const,
      x: 1,
      y: 1,
      w: 4,
      h: 1,
      text: { value: "Page-local id" },
    };
    const project: DeckProject = {
      root: "/virtual/deck",
      manifest: {
        version: 1,
        id: "test-deck",
        title: "Test Deck",
        size: { width: 10, height: 6 },
        pages: ["pages/01.yaml", "pages/02.yaml"],
      },
      pages: [
        {
          id: "page-01",
          type: "content",
          layout: { type: "free" },
          elements: [repeatedElement],
        },
        {
          id: "page-02",
          type: "content",
          layout: { type: "free" },
          elements: [repeatedElement],
        },
      ],
    };

    expect(resolveDeck(project).pages.map((page) => page.elements[0]?.id)).toEqual([
      "repeated",
      "repeated",
    ]);
  });

  it("fails clearly when a theme token is missing", () => {
    const project = projectWithPage({
      id: "page-01",
      type: "cover",
      layout: { type: "free" },
      background: { color: "missing" },
      elements: [
        {
          id: "hero",
          type: "image",
          x: 0,
          y: 0,
          w: 10,
          h: 6,
          source: "hero.jpg",
        },
      ],
    }, theme);

    expect(() => resolveDeck(project)).toThrowError(
      expect.objectContaining({ code: "THEME_TOKEN_UNRESOLVED" }),
    );
  });

  it.each([
    {
      name: "invalid slot",
      expectedCode: "SLOT_INVALID",
      layout: { type: "split" },
      placement: { slot: "center.hero" },
    },
    {
      name: "missing placement",
      expectedCode: "PLACEMENT_UNRESOLVED",
      layout: { type: "free" },
      placement: {},
    },
    {
      name: "conflicting placement modes",
      expectedCode: "PLACEMENT_CONFLICT",
      layout: { type: "split" },
      placement: { slot: "left", x: 0, y: 0, w: 1, h: 1 },
    },
    {
      name: "out-of-bounds placement",
      expectedCode: "ELEMENT_OUT_OF_BOUNDS",
      layout: { type: "free" },
      placement: { x: 9, y: 1, w: 2, h: 1 },
    },
    {
      name: "invalid layout options",
      expectedCode: "LAYOUT_OPTIONS_INVALID",
      layout: { type: "split", options: { ratio: 1.2 } },
      placement: { slot: "left" },
    },
    {
      name: "unsupported layout",
      expectedCode: "LAYOUT_UNSUPPORTED",
      layout: { type: "not-a-built-in-layout" },
      placement: { slot: "title" },
    },
  ])("returns a typed error for $name", ({ expectedCode, layout, placement }) => {
    const page = {
      id: "page-01",
      type: "test",
      layout,
      elements: [
        {
          id: "element",
          type: "text",
          ...placement,
          text: { value: "Test" },
        },
      ],
    } as DeckPage;

    expect(() => resolveDeck(projectWithPage(page))).toThrowError(
      expect.objectContaining({ code: expectedCode }),
    );
  });
});
