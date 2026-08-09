import path from "node:path";

import type { DeckProject } from "@deck-agent/deck-core";
import type {
  DeckElement,
  DeckPage,
  DeckTheme,
  FontToken,
} from "@deck-agent/deck-schema";

import {
  createSlotResolutionState,
  normalizeLayout,
  resolveLayoutSlot,
  type SlotResolutionState,
} from "./built-in-layouts.js";
import { LayoutResolutionError } from "./errors.js";
import type {
  ResolvedBounds,
  ResolvedDeck,
  ResolvedElement,
  ResolvedLayout,
  ResolvedPage,
} from "./types.js";

const BOUNDS_EPSILON = 1e-9;
const DEFAULT_TEXT_FONT_SIZE = 18;
const DEFAULT_FONT_FAMILY = "Arial";
const DEFAULT_FONT_WEIGHT = 400;
const DEFAULT_FOREGROUND_COLOR = "#000000";
const DEFAULT_BACKGROUND_COLOR = "#FFFFFF";

function resolveColorToken(
  theme: DeckTheme | undefined,
  token: string,
  page: DeckPage,
  elementId?: string,
): string {
  const value = theme?.colors[token];
  if (value === undefined) {
    throw new LayoutResolutionError(
      "THEME_TOKEN_UNRESOLVED",
      `Color theme token is not defined: ${token}`,
      {
        pageId: page.id,
        ...(elementId === undefined ? {} : { elementId }),
        token,
        details: { tokenKind: "color" },
      },
    );
  }
  return value;
}

function resolveFontToken(
  theme: DeckTheme | undefined,
  token: string,
  page: DeckPage,
  elementId: string,
): FontToken {
  const value = theme?.fonts[token];
  if (value === undefined) {
    throw new LayoutResolutionError(
      "THEME_TOKEN_UNRESOLVED",
      `Font theme token is not defined: ${token}`,
      {
        pageId: page.id,
        elementId,
        token,
        details: { tokenKind: "font" },
      },
    );
  }
  return value;
}

function resolvedForegroundColor(theme: DeckTheme | undefined): string {
  return theme?.colors.foreground ?? DEFAULT_FOREGROUND_COLOR;
}

function resolvedBackgroundColor(theme: DeckTheme | undefined): string {
  return theme?.colors.background ?? DEFAULT_BACKGROUND_COLOR;
}

function resolveRadiusToken(
  theme: DeckTheme | undefined,
  token: string,
  page: DeckPage,
  elementId: string,
): number {
  const value = theme?.radius[token];
  if (value === undefined) {
    throw new LayoutResolutionError(
      "THEME_TOKEN_UNRESOLVED",
      `Radius theme token is not defined: ${token}`,
      {
        pageId: page.id,
        elementId,
        token,
        details: { tokenKind: "radius" },
      },
    );
  }
  return value;
}

function assetSourceProtocol(source: string): string | undefined {
  if (/^[A-Za-z]:[\\/]/u.test(source) || /^\\\\/u.test(source)) {
    return undefined;
  }

  try {
    return new URL(source).protocol;
  } catch {
    return undefined;
  }
}

function normalizeAssetSource(
  project: DeckProject,
  pageIndex: number,
  source: string,
): string {
  if (
    assetSourceProtocol(source) !== undefined ||
    /^[A-Za-z]:[\\/]/u.test(source) ||
    /^\\\\/u.test(source)
  ) {
    return source;
  }

  const pageSourcePath = project.manifest.pages[pageIndex];
  if (pageSourcePath === undefined) {
    return source;
  }

  const absoluteSource = path.isAbsolute(source)
    ? path.resolve(source)
    : path.resolve(
        path.dirname(path.resolve(project.root, pageSourcePath)),
        source,
      );
  return path.relative(project.root, absoluteSource).split(path.sep).join("/");
}

function resolveElementModel(
  element: DeckElement,
  page: DeckPage,
  theme: DeckTheme | undefined,
  bounds: ResolvedBounds,
  project: DeckProject,
  pageIndex: number,
): ResolvedElement {
  switch (element.type) {
    case "text": {
      const font: FontToken | undefined =
        element.text.style === undefined
          ? theme?.fonts.body
          : resolveFontToken(
              theme,
              element.text.style,
              page,
              element.id,
            );

      return {
        id: element.id,
        type: "text",
        ...bounds,
        content: { value: element.text.value },
        style: {
          fontFamily: font?.family ?? DEFAULT_FONT_FAMILY,
          fontWeight: font?.weight ?? DEFAULT_FONT_WEIGHT,
          fontStyle: font?.style ?? "normal",
          fontSize: element.text.fontSize ?? DEFAULT_TEXT_FONT_SIZE,
          color:
            element.text.color === undefined
              ? resolvedForegroundColor(theme)
              : resolveColorToken(
                  theme,
                  element.text.color,
                  page,
                  element.id,
                ),
          bold:
            element.text.bold ??
            (font?.weight ?? DEFAULT_FONT_WEIGHT) >= 700,
          alignment: element.text.alignment ?? "left",
          wrap: {
            mode: element.text.wrap?.mode ?? "word",
            ...(element.text.wrap?.maxLines === undefined
              ? {}
              : { maxLines: element.text.wrap.maxLines }),
            overflow: element.text.wrap?.overflow ?? "clip",
          },
        },
      };
    }
    case "image":
      return {
        id: element.id,
        type: "image",
        ...bounds,
        content: {
          source: normalizeAssetSource(project, pageIndex, element.source),
          fit: element.fit ?? "contain",
          ...(element.crop === undefined ? {} : { crop: { ...element.crop } }),
          ...(element.alt === undefined ? {} : { alt: element.alt }),
        },
        style: {},
      };
    case "shape": {
      const radius =
        typeof element.shape.radius === "string"
          ? resolveRadiusToken(
              theme,
              element.shape.radius,
              page,
              element.id,
            )
          : (element.shape.radius ?? 0);
      return {
        id: element.id,
        type: "shape",
        ...bounds,
        content: { kind: element.shape.kind },
        style: {
          fill:
            element.shape.fill === undefined
              ? null
              : resolveColorToken(
                  theme,
                  element.shape.fill,
                  page,
                  element.id,
                ),
          stroke:
            element.shape.stroke === undefined
              ? null
              : resolveColorToken(
                  theme,
                  element.shape.stroke,
                  page,
                  element.id,
                ),
          strokeWidth: 1,
          radius,
        },
      };
    }
    case "line":
      return {
        id: element.id,
        type: "line",
        ...bounds,
        content: {
          start: {
            x: bounds.x + element.line.start.x * bounds.w,
            y: bounds.y + element.line.start.y * bounds.h,
          },
          end: {
            x: bounds.x + element.line.end.x * bounds.w,
            y: bounds.y + element.line.end.y * bounds.h,
          },
        },
        style: {
          stroke:
            element.line.stroke === undefined
              ? resolvedForegroundColor(theme)
              : resolveColorToken(
                  theme,
                  element.line.stroke,
                  page,
                  element.id,
                ),
          width: element.line.width ?? 1,
          dash: element.line.dash ?? "solid",
          arrow: element.line.arrow ?? "none",
        },
      };
  }
}

function hasCompleteCoordinates(element: DeckElement): boolean {
  return (
    element.x !== undefined &&
    element.y !== undefined &&
    element.w !== undefined &&
    element.h !== undefined
  );
}

function hasAnyCoordinates(element: DeckElement): boolean {
  return (
    element.x !== undefined ||
    element.y !== undefined ||
    element.w !== undefined ||
    element.h !== undefined
  );
}

function resolvePlacement(
  page: DeckPage,
  element: DeckElement,
  layout: ResolvedLayout,
  slideWidth: number,
  slideHeight: number,
  slotState: SlotResolutionState,
): ResolvedBounds {
  const completeCoordinates = hasCompleteCoordinates(element);
  const anyCoordinates = hasAnyCoordinates(element);

  if (completeCoordinates && element.slot !== undefined) {
    throw new LayoutResolutionError(
      "PLACEMENT_CONFLICT",
      "Element cannot use both free coordinates and a layout slot",
      { pageId: page.id, elementId: element.id, slot: element.slot },
    );
  }

  let bounds: ResolvedBounds;
  if (completeCoordinates) {
    bounds = {
      x: element.x as number,
      y: element.y as number,
      w: element.w as number,
      h: element.h as number,
    };
  } else if (anyCoordinates) {
    throw new LayoutResolutionError(
      "PLACEMENT_UNRESOLVED",
      "Free-coordinate placement requires x, y, w, and h",
      { pageId: page.id, elementId: element.id },
    );
  } else if (element.slot !== undefined) {
    bounds = resolveLayoutSlot(
      page,
      element,
      layout,
      slideWidth,
      slideHeight,
      slotState,
    );
  } else {
    throw new LayoutResolutionError(
      "PLACEMENT_UNRESOLVED",
      "Element requires either complete free coordinates or a valid slot",
      { pageId: page.id, elementId: element.id, layoutType: layout.type },
    );
  }

  const values = [bounds.x, bounds.y, bounds.w, bounds.h];
  const isFinite = values.every((value) => Number.isFinite(value));
  const isOutside =
    bounds.x < -BOUNDS_EPSILON ||
    bounds.y < -BOUNDS_EPSILON ||
    bounds.w <= 0 ||
    bounds.h <= 0 ||
    bounds.x + bounds.w > slideWidth + BOUNDS_EPSILON ||
    bounds.y + bounds.h > slideHeight + BOUNDS_EPSILON;

  if (!isFinite || isOutside) {
    throw new LayoutResolutionError(
      "ELEMENT_OUT_OF_BOUNDS",
      `Resolved element is outside page bounds: ${element.id}`,
      {
        pageId: page.id,
        elementId: element.id,
        details: { bounds, slideWidth, slideHeight },
      },
    );
  }

  return bounds;
}

function resolvePage(
  page: DeckPage,
  project: DeckProject,
  pageIndex: number,
): ResolvedPage {
  const seenElementIds = new Map<string, number>();
  page.elements.forEach((element, elementIndex) => {
    const firstIndex = seenElementIds.get(element.id);
    if (firstIndex !== undefined) {
      throw new LayoutResolutionError(
        "ELEMENT_ID_DUPLICATE",
        `Element id must be unique within page ${page.id}: ${element.id}`,
        {
          pageId: page.id,
          elementId: element.id,
          details: { firstIndex, duplicateIndex: elementIndex },
        },
      );
    }
    seenElementIds.set(element.id, elementIndex);
  });

  const layout = normalizeLayout(page, project.theme);
  const slotState = createSlotResolutionState();
  const elements = page.elements.map((element) => {
    const bounds = resolvePlacement(
      page,
      element,
      layout,
      project.manifest.size.width,
      project.manifest.size.height,
      slotState,
    );
    return resolveElementModel(
      element,
      page,
      project.theme,
      bounds,
      project,
      pageIndex,
    );
  });

  return {
    id: page.id,
    type: page.type,
    layout,
    background: {
      color:
        page.background === undefined
          ? resolvedBackgroundColor(project.theme)
          : resolveColorToken(
              project.theme,
              page.background.color,
              page,
            ),
    },
    elements,
  };
}

function copyTheme(theme: DeckTheme | undefined): DeckTheme | null {
  if (theme === undefined) {
    return null;
  }

  return {
    name: theme.name,
    colors: { ...theme.colors },
    fonts: Object.fromEntries(
      Object.entries(theme.fonts).map(([name, font]) => [name, { ...font }]),
    ),
    spacing: { ...theme.spacing },
    radius: { ...theme.radius },
  };
}

export function resolveDeck(project: DeckProject): ResolvedDeck {
  return {
    size: { ...project.manifest.size },
    theme: copyTheme(project.theme),
    pages: project.pages.map((page, pageIndex) =>
      resolvePage(page, project, pageIndex),
    ),
  };
}
