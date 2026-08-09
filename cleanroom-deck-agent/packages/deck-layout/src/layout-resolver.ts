import type { DeckProject } from "@deck-agent/deck-core";
import type {
  DeckElement,
  DeckPage,
  DeckTheme,
  FontToken,
} from "@deck-agent/deck-schema";

import { LayoutResolutionError } from "./errors.js";
import type {
  ResolvedBounds,
  ResolvedDeck,
  ResolvedElement,
  ResolvedElementStyle,
  ResolvedLayout,
  ResolvedPage,
} from "./types.js";

const BOUNDS_EPSILON = 1e-9;
const SPLIT_OPTION_NAMES = new Set(["ratio", "margin", "gap"]);

function invalidLayoutOptions(
  page: DeckPage,
  message: string,
  details?: Readonly<Record<string, unknown>>,
): never {
  throw new LayoutResolutionError("LAYOUT_OPTIONS_INVALID", message, {
    pageId: page.id,
    layoutType: page.layout.type,
    ...(details === undefined ? {} : { details }),
  });
}

function finiteNumberOption(
  page: DeckPage,
  options: Readonly<Record<string, unknown>>,
  name: string,
  fallback: number,
): number {
  const value = options[name] ?? fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return invalidLayoutOptions(
      page,
      `Layout option must be a finite number: ${name}`,
      { option: name, value },
    );
  }
  return value;
}

function normalizeLayout(page: DeckPage): ResolvedLayout {
  const rawOptions = page.layout.options ?? {};

  if (page.layout.type === "free") {
    if (page.layout.ratio !== undefined || Object.keys(rawOptions).length > 0) {
      return invalidLayoutOptions(
        page,
        "The free layout does not accept layout options",
      );
    }
    return { type: "free", options: {} };
  }

  if (page.layout.type !== "split") {
    throw new LayoutResolutionError(
      "LAYOUT_UNSUPPORTED",
      `Unsupported layout: ${page.layout.type}`,
      { pageId: page.id, layoutType: page.layout.type },
    );
  }

  const unknownOptions = Object.keys(rawOptions).filter(
    (name) => !SPLIT_OPTION_NAMES.has(name),
  );
  if (unknownOptions.length > 0) {
    return invalidLayoutOptions(page, "Split layout has unknown options", {
      unknownOptions,
    });
  }

  if (
    rawOptions.ratio !== undefined &&
    page.layout.ratio !== undefined &&
    rawOptions.ratio !== page.layout.ratio
  ) {
    return invalidLayoutOptions(
      page,
      "layout.ratio conflicts with layout.options.ratio",
      {
        legacyRatio: page.layout.ratio,
        optionsRatio: rawOptions.ratio,
      },
    );
  }

  const optionsWithLegacyRatio =
    rawOptions.ratio === undefined && page.layout.ratio !== undefined
      ? { ...rawOptions, ratio: page.layout.ratio }
      : rawOptions;
  const ratio = finiteNumberOption(page, optionsWithLegacyRatio, "ratio", 0.5);
  const margin = finiteNumberOption(page, rawOptions, "margin", 0);
  const gap = finiteNumberOption(page, rawOptions, "gap", 0);

  if (ratio <= 0 || ratio >= 1) {
    return invalidLayoutOptions(
      page,
      "Split ratio must be greater than 0 and less than 1",
      { ratio },
    );
  }
  if (margin < 0 || gap < 0) {
    return invalidLayoutOptions(
      page,
      "Split margin and gap must be non-negative",
      { margin, gap },
    );
  }

  return { type: "split", options: { ratio, margin, gap } };
}

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

function resolveElementModel(
  element: DeckElement,
  page: DeckPage,
  theme: DeckTheme | undefined,
): Pick<ResolvedElement, "content" | "style"> {
  switch (element.type) {
    case "text": {
      let style: ResolvedElementStyle = {};
      if (element.text.style !== undefined) {
        const font = resolveFontToken(
          theme,
          element.text.style,
          page,
          element.id,
        );
        style = {
          fontFamily: font.family,
          fontWeight: font.weight,
          ...(font.style === undefined ? {} : { fontStyle: font.style }),
        };
      }
      return { content: { value: element.text.value }, style };
    }
    case "image":
      return {
        content: {
          source: element.source,
          fit: element.fit ?? "contain",
          ...(element.alt === undefined ? {} : { alt: element.alt }),
        },
        style: {},
      };
    case "shape":
      return {
        content: { kind: element.shape.kind },
        style: {
          ...(element.shape.fill === undefined
            ? {}
            : {
                fill: resolveColorToken(
                  theme,
                  element.shape.fill,
                  page,
                  element.id,
                ),
              }),
          ...(element.shape.stroke === undefined
            ? {}
            : {
                stroke: resolveColorToken(
                  theme,
                  element.shape.stroke,
                  page,
                  element.id,
                ),
              }),
        },
      };
    case "line":
      return {
        content: {},
        style: {
          ...(element.line.color === undefined
            ? {}
            : {
                stroke: resolveColorToken(
                  theme,
                  element.line.color,
                  page,
                  element.id,
                ),
              }),
          ...(element.line.width === undefined
            ? {}
            : { strokeWidth: element.line.width }),
          ...(element.line.dash === undefined ? {} : { dash: element.line.dash }),
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

function splitSlotBounds(
  page: DeckPage,
  element: DeckElement,
  layout: Extract<ResolvedLayout, { type: "split" }>,
  slideWidth: number,
  slideHeight: number,
): ResolvedBounds {
  const slot = element.slot ?? "";
  const slotMatch = /^(left|right)(?:\.[A-Za-z][A-Za-z0-9_-]*)*$/u.exec(slot);
  if (slotMatch === null) {
    throw new LayoutResolutionError(
      "SLOT_INVALID",
      `Invalid slot for split layout: ${slot}`,
      {
        pageId: page.id,
        elementId: element.id,
        layoutType: layout.type,
        slot,
      },
    );
  }

  const { ratio, margin, gap } = layout.options;
  const contentWidth = slideWidth - margin * 2 - gap;
  const contentHeight = slideHeight - margin * 2;
  if (contentWidth <= 0 || contentHeight <= 0) {
    return invalidLayoutOptions(
      page,
      "Split margin and gap leave no usable slide area",
      { slideWidth, slideHeight, margin, gap },
    );
  }

  const leftWidth = contentWidth * ratio;
  const rightWidth = contentWidth - leftWidth;
  return slotMatch[1] === "left"
    ? { x: margin, y: margin, w: leftWidth, h: contentHeight }
    : {
        x: margin + leftWidth + gap,
        y: margin,
        w: rightWidth,
        h: contentHeight,
      };
}

function resolvePlacement(
  page: DeckPage,
  element: DeckElement,
  layout: ResolvedLayout,
  slideWidth: number,
  slideHeight: number,
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
  } else if (element.slot !== undefined && layout.type === "split") {
    bounds = splitSlotBounds(
      page,
      element,
      layout,
      slideWidth,
      slideHeight,
    );
  } else if (element.slot !== undefined) {
    throw new LayoutResolutionError(
      "SLOT_INVALID",
      `Layout does not expose slots: ${layout.type}`,
      {
        pageId: page.id,
        elementId: element.id,
        layoutType: layout.type,
        slot: element.slot,
      },
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
): ResolvedPage {
  const layout = normalizeLayout(page);
  const elements = page.elements.map((element) => {
    const bounds = resolvePlacement(
      page,
      element,
      layout,
      project.manifest.size.width,
      project.manifest.size.height,
    );
    const model = resolveElementModel(element, page, project.theme);
    return {
      id: element.id,
      type: element.type,
      ...bounds,
      content: model.content,
      style: model.style,
    } satisfies ResolvedElement;
  });

  return {
    id: page.id,
    type: page.type,
    layout,
    ...(page.background === undefined
      ? {}
      : {
          background: {
            color: resolveColorToken(
              project.theme,
              page.background.color,
              page,
            ),
          },
        }),
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
    pages: project.pages.map((page) => resolvePage(page, project)),
  };
}

