import type { DeckProject } from "@deck-agent/deck-core";
import type { DeckElement, DeckTheme } from "@deck-agent/deck-schema";
import { describe, expect, it } from "vitest";

import { resolveDeck } from "../src/layout-resolver.js";
import { dispatchResolvedElement } from "../src/renderer-contract.js";

const theme: DeckTheme = {
  name: "basic-elements",
  colors: {
    foreground: "#161616",
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

function projectWithElements(elements: DeckElement[]): DeckProject {
  return {
    root: "/virtual/deck",
    manifest: {
      version: 1,
      id: "basic-elements",
      title: "Basic Elements",
      size: { width: 10, height: 6 },
      theme: "themes/basic.yaml",
      pages: ["pages/01.yaml"],
    },
    pages: [
      {
        id: "page-01",
        type: "elements",
        layout: { type: "free" },
        elements,
      },
    ],
    theme,
  };
}

const elements: DeckElement[] = [
  {
    id: "title",
    type: "text",
    x: 1,
    y: 0.5,
    w: 8,
    h: 1,
    text: {
      value: "Resolved text",
      style: "heading",
      fontSize: 30,
      color: "foreground",
      bold: false,
      alignment: "center",
      wrap: { mode: "word", maxLines: 2, overflow: "ellipsis" },
    },
  },
  {
    id: "missing-image",
    type: "image",
    x: 1,
    y: 2,
    w: 3,
    h: 2,
    source: "../media/not-created-yet.jpg",
    fit: "contain",
    crop: { x: 0.1, y: 0.2, w: 0.8, h: 0.7 },
    alt: "A future local asset",
  },
  {
    id: "card",
    type: "shape",
    x: 5,
    y: 2,
    w: 3,
    h: 2,
    shape: {
      kind: "rectangle",
      fill: "accent",
      stroke: "muted",
      radius: "card",
    },
  },
  {
    id: "arrow",
    type: "line",
    x: 2,
    y: 5,
    w: 6,
    h: 0.5,
    line: {
      start: { x: 1, y: 0.5 },
      end: { x: 0, y: 0.5 },
      stroke: "foreground",
      width: 2,
      dash: "dash",
      arrow: "end",
    },
  },
];

describe("basic resolved elements", () => {
  const resolvedElements = resolveDeck(projectWithElements(elements)).pages[0]
    ?.elements;

  it("normalizes text content, typography, color, alignment, and wrapping", () => {
    expect(resolvedElements?.[0]).toEqual({
      id: "title",
      type: "text",
      x: 1,
      y: 0.5,
      w: 8,
      h: 1,
      content: { value: "Resolved text" },
      style: {
        fontFamily: "Arial",
        fontWeight: 700,
        fontStyle: "normal",
        fontSize: 30,
        color: "#161616",
        bold: false,
        alignment: "center",
        wrap: { mode: "word", maxLines: 2, overflow: "ellipsis" },
      },
    });
  });

  it("normalizes a page-relative image source and preserves image options", () => {
    expect(resolvedElements?.[1]).toMatchObject({
      id: "missing-image",
      type: "image",
      content: {
        source: "media/not-created-yet.jpg",
        fit: "contain",
        crop: { x: 0.1, y: 0.2, w: 0.8, h: 0.7 },
        alt: "A future local asset",
      },
      style: {},
    });
  });

  it("normalizes shape fill, stroke, and radius tokens", () => {
    expect(resolvedElements?.[2]).toMatchObject({
      id: "card",
      type: "shape",
      content: { kind: "rectangle" },
      style: { fill: "#3157F6", stroke: "#686868", radius: 0.12 },
    });
  });

  it("keeps line start as source and end as arrow destination", () => {
    expect(resolvedElements?.[3]).toMatchObject({
      id: "arrow",
      type: "line",
      content: {
        start: { x: 8, y: 5.25 },
        end: { x: 2, y: 5.25 },
      },
      style: {
        stroke: "#161616",
        width: 2,
        dash: "dash",
        arrow: "end",
      },
    });
  });

  it("resolves text defaults before renderer dispatch", () => {
    const resolved = resolveDeck(
      projectWithElements([
        {
          id: "default-text",
          type: "text",
          x: 1,
          y: 1,
          w: 4,
          h: 1,
          text: { value: "Defaults" },
        },
      ]),
    ).pages[0]?.elements[0];

    expect(resolved).toMatchObject({
      type: "text",
      style: {
        fontFamily: "Arial",
        fontWeight: 400,
        fontStyle: "normal",
        fontSize: 18,
        color: "#161616",
        bold: false,
        alignment: "left",
        wrap: { mode: "word", overflow: "clip" },
      },
    });
  });

  it("resolves renderer-facing visual defaults explicitly", () => {
    const page = resolveDeck(
      projectWithElements([
        {
          id: "plain-shape",
          type: "shape",
          x: 1,
          y: 1,
          w: 2,
          h: 1,
          shape: { kind: "rectangle" },
        },
        {
          id: "plain-line",
          type: "line",
          x: 1,
          y: 3,
          w: 2,
          h: 1,
          line: {
            start: { x: 0, y: 0 },
            end: { x: 1, y: 1 },
          },
        },
      ]),
    ).pages[0];

    expect(page).toMatchObject({
      background: { color: "#FFFFFF" },
      elements: [
        {
          id: "plain-shape",
          style: { fill: null, stroke: null, radius: 0 },
        },
        {
          id: "plain-line",
          style: {
            stroke: "#161616",
            width: 1,
            dash: "solid",
            arrow: "none",
          },
        },
      ],
    });
  });

  it("dispatches every resolved element type without layout calculation", () => {
    const renderer = {
      renderText: () => "text",
      renderImage: () => "image",
      renderShape: () => "shape",
      renderLine: () => "line",
    };

    expect(
      resolvedElements?.map((element) =>
        dispatchResolvedElement(element, renderer),
      ),
    ).toEqual(["text", "image", "shape", "line"]);
  });
});
