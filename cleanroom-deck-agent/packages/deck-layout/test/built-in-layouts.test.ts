import type { DeckProject } from "@deck-agent/deck-core";
import type { DeckElement, DeckPage, DeckTheme } from "@deck-agent/deck-schema";
import { describe, expect, it } from "vitest";

import { BUILT_IN_LAYOUT_SLOT_CONTRACTS } from "../src/built-in-layouts.js";
import { resolveDeck } from "../src/layout-resolver.js";

const theme: DeckTheme = {
  name: "layout-geometry",
  colors: {
    background: "#FFFFFF",
    foreground: "#111111",
  },
  fonts: {
    heading: { family: "Arial", weight: 700 },
    body: { family: "Arial", weight: 400 },
  },
  spacing: { pageMargin: 0.5, grid: 0.25 },
  radius: { card: 0.1 },
};

function text(id: string, slot: string): DeckElement {
  return {
    id,
    type: "text",
    slot,
    text: { value: id },
  };
}

function image(id: string, slot: string): DeckElement {
  return {
    id,
    type: "image",
    slot,
    source: `../media/${id}.png`,
  };
}

function projectWithPage(page: DeckPage): DeckProject {
  return {
    root: "/virtual/layout-deck",
    manifest: {
      version: 1,
      id: "layout-deck",
      title: "Layout Deck",
      size: { width: 12, height: 7 },
      theme: "themes/layout.yaml",
      pages: ["pages/01.yaml"],
    },
    pages: [page],
    theme,
  };
}

function resolvedGeometry(page: DeckPage) {
  const resolvedPage = resolveDeck(projectWithPage(page)).pages[0];
  return {
    layout: resolvedPage?.layout,
    elements: resolvedPage?.elements.map(({ id, x, y, w, h }) => ({
      id,
      x,
      y,
      w,
      h,
    })),
  };
}

describe("built-in layout geometry", () => {
  it("publishes the complete MVP slot contract", () => {
    expect(BUILT_IN_LAYOUT_SLOT_CONTRACTS).toEqual({
      free: {
        slots: [],
        notes: "Elements require explicit x/y/w/h bounds.",
      },
      cover: {
        slots: ["title", "body"],
        notes: "A centered, vertically stacked title and body block.",
      },
      "title-body": {
        slots: ["title", "body"],
        notes: "A top title band followed by a non-overlapping body region.",
      },
      split: {
        slots: [
          "left.title",
          "left.body",
          "left.hero",
          "right.title",
          "right.body",
          "right.hero",
        ],
        notes: "Hero is an alias for body in its column and shares its capacity.",
      },
      "two-column": {
        slots: [
          "title",
          "left.title",
          "left.body",
          "left.hero",
          "right.title",
          "right.body",
          "right.hero",
        ],
        notes: "A full-width title above two equal subdivided columns.",
      },
      "metric-grid": {
        slots: ["title", "metric", "metric.N"],
        notes: "metric auto-assigns row-major; metric.N selects a 1-based cell.",
      },
      "full-image": {
        slots: ["hero", "title", "body"],
        notes: "Hero fills the slide; title and body are non-overlapping overlays.",
      },
    });
  });

  it("resolves cover into centered, non-overlapping title and body regions", () => {
    expect(
      resolvedGeometry({
        id: "cover",
        type: "cover",
        layout: { type: "cover" },
        elements: [text("title", "title"), text("body", "body")],
      }),
    ).toMatchInlineSnapshot(`
      {
        "elements": [
          {
            "h": 1,
            "id": "title",
            "w": 11,
            "x": 0.5,
            "y": 2.275,
          },
          {
            "h": 1.2,
            "id": "body",
            "w": 11,
            "x": 0.5,
            "y": 3.525,
          },
        ],
        "layout": {
          "options": {
            "bodyHeight": 1.2,
            "gap": 0.25,
            "margin": 0.5,
            "titleHeight": 1,
          },
          "type": "cover",
        },
      }
    `);
  });

  it("resolves title-body into a title band and remaining body", () => {
    expect(
      resolvedGeometry({
        id: "title-body",
        type: "content",
        layout: { type: "title-body" },
        elements: [text("title", "title"), text("body", "body")],
      }),
    ).toMatchInlineSnapshot(`
      {
        "elements": [
          {
            "h": 1,
            "id": "title",
            "w": 11,
            "x": 0.5,
            "y": 0.5,
          },
          {
            "h": 4.75,
            "id": "body",
            "w": 11,
            "x": 0.5,
            "y": 1.75,
          },
        ],
        "layout": {
          "options": {
            "gap": 0.25,
            "margin": 0.5,
            "titleHeight": 1,
          },
          "type": "title-body",
        },
      }
    `);
  });

  it("resolves split options and subdivides both columns", () => {
    expect(
      resolvedGeometry({
        id: "split",
        type: "content",
        layout: {
          type: "split",
          options: { ratio: 0.6, margin: 0.5, gap: 0.5, titleHeight: 0.8 },
        },
        elements: [
          text("left-title", "left.title"),
          text("left-body", "left.body"),
          text("right-title", "right.title"),
          image("right-hero", "right.hero"),
        ],
      }),
    ).toMatchInlineSnapshot(`
      {
        "elements": [
          {
            "h": 0.8,
            "id": "left-title",
            "w": 6.3,
            "x": 0.5,
            "y": 0.5,
          },
          {
            "h": 4.7,
            "id": "left-body",
            "w": 6.3,
            "x": 0.5,
            "y": 1.8,
          },
          {
            "h": 0.8,
            "id": "right-title",
            "w": 4.2,
            "x": 7.3,
            "y": 0.5,
          },
          {
            "h": 4.7,
            "id": "right-hero",
            "w": 4.2,
            "x": 7.3,
            "y": 1.8,
          },
        ],
        "layout": {
          "options": {
            "gap": 0.5,
            "margin": 0.5,
            "ratio": 0.6,
            "titleHeight": 0.8,
          },
          "type": "split",
        },
      }
    `);
  });

  it("resolves two-column with a page title and subdivided columns", () => {
    expect(
      resolvedGeometry({
        id: "two-column",
        type: "content",
        layout: { type: "two-column" },
        elements: [
          text("title", "title"),
          text("left-title", "left.title"),
          text("left-body", "left.body"),
          text("right-title", "right.title"),
          image("right-hero", "right.hero"),
        ],
      }),
    ).toMatchInlineSnapshot(`
      {
        "elements": [
          {
            "h": 1,
            "id": "title",
            "w": 11,
            "x": 0.5,
            "y": 0.5,
          },
          {
            "h": 0.6,
            "id": "left-title",
            "w": 5.375,
            "x": 0.5,
            "y": 1.75,
          },
          {
            "h": 3.9,
            "id": "left-body",
            "w": 5.375,
            "x": 0.5,
            "y": 2.6,
          },
          {
            "h": 0.6,
            "id": "right-title",
            "w": 5.375,
            "x": 6.125,
            "y": 1.75,
          },
          {
            "h": 3.9,
            "id": "right-hero",
            "w": 5.375,
            "x": 6.125,
            "y": 2.6,
          },
        ],
        "layout": {
          "options": {
            "columnTitleHeight": 0.6,
            "gap": 0.25,
            "margin": 0.5,
            "titleHeight": 1,
          },
          "type": "two-column",
        },
      }
    `);
  });

  it("resolves metric-grid cells row-major with columns, rows, gap, and margin", () => {
    expect(
      resolvedGeometry({
        id: "metric-grid",
        type: "metrics",
        layout: {
          type: "metric-grid",
          options: {
            columns: 3,
            rows: 2,
            gap: 0.25,
            margin: 0.5,
            titleHeight: 0.75,
          },
        },
        elements: [
          text("title", "title"),
          text("metric-1", "metric"),
          text("metric-2", "metric.2"),
          text("metric-3", "metric.3"),
          text("metric-4", "metric.4"),
        ],
      }),
    ).toMatchInlineSnapshot(`
      {
        "elements": [
          {
            "h": 0.75,
            "id": "title",
            "w": 11,
            "x": 0.5,
            "y": 0.5,
          },
          {
            "h": 2.375,
            "id": "metric-1",
            "w": 3.5,
            "x": 0.5,
            "y": 1.5,
          },
          {
            "h": 2.375,
            "id": "metric-2",
            "w": 3.5,
            "x": 4.25,
            "y": 1.5,
          },
          {
            "h": 2.375,
            "id": "metric-3",
            "w": 3.5,
            "x": 8,
            "y": 1.5,
          },
          {
            "h": 2.375,
            "id": "metric-4",
            "w": 3.5,
            "x": 0.5,
            "y": 4.125,
          },
        ],
        "layout": {
          "options": {
            "columns": 3,
            "gap": 0.25,
            "margin": 0.5,
            "rows": 2,
            "titleHeight": 0.75,
          },
          "type": "metric-grid",
        },
      }
    `);
  });

  it("resolves full-image hero and non-overlapping bottom overlays", () => {
    expect(
      resolvedGeometry({
        id: "full-image",
        type: "image",
        layout: {
          type: "full-image",
          options: { titleHeight: 0.8, bodyHeight: 0.6 },
        },
        elements: [
          image("hero", "hero"),
          text("title", "title"),
          text("body", "body"),
        ],
      }),
    ).toMatchInlineSnapshot(`
      {
        "elements": [
          {
            "h": 7,
            "id": "hero",
            "w": 12,
            "x": 0,
            "y": 0,
          },
          {
            "h": 0.8,
            "id": "title",
            "w": 11,
            "x": 0.5,
            "y": 4.85,
          },
          {
            "h": 0.6,
            "id": "body",
            "w": 11,
            "x": 0.5,
            "y": 5.9,
          },
        ],
        "layout": {
          "options": {
            "bodyHeight": 0.6,
            "gap": 0.25,
            "margin": 0.5,
            "titleHeight": 0.8,
          },
          "type": "full-image",
        },
      }
    `);
  });
});

describe("built-in layout validation", () => {
  it("rejects conflicting legacy and options split ratios", () => {
    const project = projectWithPage({
      id: "conflicting-ratio",
      type: "content",
      layout: { type: "split", ratio: 0.4, options: { ratio: 0.6 } },
      elements: [text("title", "left.title")],
    });

    expect(() => resolveDeck(project)).toThrowError(
      expect.objectContaining({ code: "LAYOUT_OPTION_CONFLICT" }),
    );
  });

  it("rejects an invalid metric-grid option", () => {
    const project = projectWithPage({
      id: "bad-metrics",
      type: "metrics",
      layout: { type: "metric-grid", options: { columns: 2.5 } },
      elements: [text("metric", "metric")],
    });

    expect(() => resolveDeck(project)).toThrowError(
      expect.objectContaining({ code: "LAYOUT_OPTIONS_INVALID" }),
    );
  });

  it("rejects options that leave no usable metric cell geometry", () => {
    const project = projectWithPage({
      id: "impossible-metrics",
      type: "metrics",
      layout: {
        type: "metric-grid",
        options: { columns: 3, rows: 2, margin: 0.5, gap: 6 },
      },
      elements: [text("metric", "metric")],
    });

    expect(() => resolveDeck(project)).toThrowError(
      expect.objectContaining({ code: "LAYOUT_OPTIONS_INVALID" }),
    );
  });

  it("rejects duplicate use of a fixed-capacity slot", () => {
    const project = projectWithPage({
      id: "duplicate-slot",
      type: "content",
      layout: { type: "split" },
      elements: [
        text("right-body", "right.body"),
        image("right-hero", "right.hero"),
      ],
    });

    expect(() => resolveDeck(project)).toThrowError(
      expect.objectContaining({ code: "SLOT_CAPACITY_EXCEEDED" }),
    );
  });

  it("rejects metric cells beyond configured capacity", () => {
    const project = projectWithPage({
      id: "metric-capacity",
      type: "metrics",
      layout: { type: "metric-grid", options: { columns: 2, rows: 1 } },
      elements: [text("too-many", "metric.3")],
    });

    expect(() => resolveDeck(project)).toThrowError(
      expect.objectContaining({ code: "SLOT_CAPACITY_EXCEEDED" }),
    );
  });

  it("is deterministic for every built-in slot layout", () => {
    const project = projectWithPage({
      id: "deterministic",
      type: "metrics",
      layout: { type: "metric-grid", options: { columns: 2, rows: 2 } },
      elements: [
        text("first", "metric"),
        text("second", "metric"),
        text("third", "metric"),
      ],
    });

    expect(JSON.stringify(resolveDeck(project))).toBe(
      JSON.stringify(resolveDeck(project)),
    );
  });
});
