import type { DeckElement, DeckPage, DeckTheme } from "@deck-agent/deck-schema";

import { LayoutResolutionError } from "./errors.js";
import type { ResolvedBounds, ResolvedLayout } from "./types.js";

const DEFAULT_MARGIN = 0.6;
const DEFAULT_GAP = 0.3;
const DEFAULT_TITLE_HEIGHT = 1;
const GEOMETRY_PRECISION = 1e12;

const OPTION_NAMES = {
  free: new Set<string>(),
  cover: new Set(["margin", "gap", "titleHeight", "bodyHeight"]),
  "title-body": new Set(["margin", "gap", "titleHeight"]),
  split: new Set(["ratio", "margin", "gap", "titleHeight"]),
  "two-column": new Set([
    "margin",
    "gap",
    "titleHeight",
    "columnTitleHeight",
  ]),
  "metric-grid": new Set([
    "columns",
    "rows",
    "margin",
    "gap",
    "titleHeight",
  ]),
  "full-image": new Set(["margin", "gap", "titleHeight", "bodyHeight"]),
} as const;

export const BUILT_IN_LAYOUT_SLOT_CONTRACTS = {
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
} as const;

export interface SlotResolutionState {
  readonly occupied: Map<string, string>;
  nextMetricIndex: number;
}

export function createSlotResolutionState(): SlotResolutionState {
  return { occupied: new Map(), nextMetricIndex: 1 };
}

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

function optionConflict(
  page: DeckPage,
  message: string,
  details: Readonly<Record<string, unknown>>,
): never {
  throw new LayoutResolutionError("LAYOUT_OPTION_CONFLICT", message, {
    pageId: page.id,
    layoutType: page.layout.type,
    details,
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

function positiveNumberOption(
  page: DeckPage,
  options: Readonly<Record<string, unknown>>,
  name: string,
  fallback: number,
): number {
  const value = finiteNumberOption(page, options, name, fallback);
  if (value <= 0) {
    return invalidLayoutOptions(page, `Layout option must be positive: ${name}`, {
      option: name,
      value,
    });
  }
  return value;
}

function nonNegativeNumberOption(
  page: DeckPage,
  options: Readonly<Record<string, unknown>>,
  name: string,
  fallback: number,
): number {
  const value = finiteNumberOption(page, options, name, fallback);
  if (value < 0) {
    return invalidLayoutOptions(
      page,
      `Layout option must be non-negative: ${name}`,
      { option: name, value },
    );
  }
  return value;
}

function positiveIntegerOption(
  page: DeckPage,
  options: Readonly<Record<string, unknown>>,
  name: string,
  fallback: number,
): number {
  const value = positiveNumberOption(page, options, name, fallback);
  if (!Number.isInteger(value)) {
    return invalidLayoutOptions(
      page,
      `Layout option must be a positive integer: ${name}`,
      { option: name, value },
    );
  }
  return value;
}

function assertKnownOptions(
  page: DeckPage,
  options: Readonly<Record<string, unknown>>,
  allowed: ReadonlySet<string>,
): void {
  const unknownOptions = Object.keys(options).filter(
    (name) => !allowed.has(name),
  );
  if (unknownOptions.length > 0) {
    invalidLayoutOptions(page, "Layout has unknown options", { unknownOptions });
  }
}

function defaultMargin(theme: DeckTheme | undefined): number {
  return theme?.spacing.pageMargin ?? DEFAULT_MARGIN;
}

function defaultGap(theme: DeckTheme | undefined): number {
  return theme?.spacing.grid ?? DEFAULT_GAP;
}

function standardOptions(
  page: DeckPage,
  rawOptions: Readonly<Record<string, unknown>>,
  theme: DeckTheme | undefined,
): Readonly<{ margin: number; gap: number; titleHeight: number }> {
  return {
    margin: nonNegativeNumberOption(
      page,
      rawOptions,
      "margin",
      defaultMargin(theme),
    ),
    gap: nonNegativeNumberOption(page, rawOptions, "gap", defaultGap(theme)),
    titleHeight: positiveNumberOption(
      page,
      rawOptions,
      "titleHeight",
      DEFAULT_TITLE_HEIGHT,
    ),
  };
}

export function normalizeLayout(
  page: DeckPage,
  theme: DeckTheme | undefined,
): ResolvedLayout {
  const rawOptions = page.layout.options ?? {};
  const type = page.layout.type;
  const allowedOptions = OPTION_NAMES[type as keyof typeof OPTION_NAMES];
  if (allowedOptions === undefined) {
    throw new LayoutResolutionError(
      "LAYOUT_UNSUPPORTED",
      `Unsupported layout: ${type}`,
      { pageId: page.id, layoutType: type },
    );
  }
  assertKnownOptions(page, rawOptions, allowedOptions);

  if (type !== "split" && page.layout.ratio !== undefined) {
    return optionConflict(
      page,
      "Legacy layout.ratio is supported only by split",
      { legacyRatio: page.layout.ratio },
    );
  }

  switch (type) {
    case "free":
      return { type: "free", options: {} };
    case "cover": {
      const common = standardOptions(page, rawOptions, theme);
      return {
        type: "cover",
        options: {
          ...common,
          bodyHeight: positiveNumberOption(
            page,
            rawOptions,
            "bodyHeight",
            1.2,
          ),
        },
      };
    }
    case "title-body":
      return {
        type: "title-body",
        options: standardOptions(page, rawOptions, theme),
      };
    case "split": {
      if (
        rawOptions.ratio !== undefined &&
        page.layout.ratio !== undefined &&
        rawOptions.ratio !== page.layout.ratio
      ) {
        return optionConflict(
          page,
          "layout.ratio conflicts with layout.options.ratio",
          {
            legacyRatio: page.layout.ratio,
            optionsRatio: rawOptions.ratio,
          },
        );
      }
      const ratioOptions =
        rawOptions.ratio === undefined && page.layout.ratio !== undefined
          ? { ...rawOptions, ratio: page.layout.ratio }
          : rawOptions;
      const ratio = finiteNumberOption(page, ratioOptions, "ratio", 0.5);
      if (ratio <= 0 || ratio >= 1) {
        return invalidLayoutOptions(
          page,
          "Split ratio must be greater than 0 and less than 1",
          { ratio },
        );
      }
      return {
        type: "split",
        options: { ratio, ...standardOptions(page, rawOptions, theme) },
      };
    }
    case "two-column": {
      const common = standardOptions(page, rawOptions, theme);
      return {
        type: "two-column",
        options: {
          ...common,
          columnTitleHeight: positiveNumberOption(
            page,
            rawOptions,
            "columnTitleHeight",
            0.6,
          ),
        },
      };
    }
    case "metric-grid": {
      const common = standardOptions(page, rawOptions, theme);
      return {
        type: "metric-grid",
        options: {
          columns: positiveIntegerOption(
            page,
            rawOptions,
            "columns",
            3,
          ),
          rows: positiveIntegerOption(page, rawOptions, "rows", 2),
          ...common,
        },
      };
    }
    case "full-image": {
      const common = standardOptions(page, rawOptions, theme);
      return {
        type: "full-image",
        options: {
          ...common,
          bodyHeight: positiveNumberOption(
            page,
            rawOptions,
            "bodyHeight",
            0.8,
          ),
        },
      };
    }
  }

  throw new LayoutResolutionError(
    "LAYOUT_UNSUPPORTED",
    `Unsupported layout: ${type}`,
    { pageId: page.id, layoutType: type },
  );
}

function round(value: number): number {
  const rounded = Math.round(value * GEOMETRY_PRECISION) / GEOMETRY_PRECISION;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function roundedBounds(bounds: ResolvedBounds): ResolvedBounds {
  return {
    x: round(bounds.x),
    y: round(bounds.y),
    w: round(bounds.w),
    h: round(bounds.h),
  };
}

function invalidGeometry(
  page: DeckPage,
  layout: ResolvedLayout,
  message: string,
  details: Readonly<Record<string, unknown>>,
): never {
  throw new LayoutResolutionError("LAYOUT_OPTIONS_INVALID", message, {
    pageId: page.id,
    layoutType: layout.type,
    details,
  });
}

function contentBounds(
  page: DeckPage,
  layout: ResolvedLayout,
  width: number,
  height: number,
  margin: number,
): ResolvedBounds {
  const bounds = {
    x: margin,
    y: margin,
    w: width - margin * 2,
    h: height - margin * 2,
  };
  if (bounds.w <= 0 || bounds.h <= 0) {
    return invalidGeometry(
      page,
      layout,
      "Layout margin leaves no usable slide area",
      { width, height, margin },
    );
  }
  return bounds;
}

function stackedBounds(
  page: DeckPage,
  layout: ResolvedLayout,
  area: ResolvedBounds,
  titleHeight: number,
  gap: number,
): Readonly<{ title: ResolvedBounds; body: ResolvedBounds }> {
  const bodyHeight = area.h - titleHeight - gap;
  if (bodyHeight <= 0) {
    return invalidGeometry(
      page,
      layout,
      "Title height and gap leave no body area",
      { area, titleHeight, gap },
    );
  }
  return {
    title: roundedBounds({ ...area, h: titleHeight }),
    body: roundedBounds({
      x: area.x,
      y: area.y + titleHeight + gap,
      w: area.w,
      h: bodyHeight,
    }),
  };
}

function reserveSlot(
  page: DeckPage,
  element: DeckElement,
  state: SlotResolutionState,
  requestedSlot: string,
  capacityKey = requestedSlot,
): void {
  const occupiedBy = state.occupied.get(capacityKey);
  if (occupiedBy !== undefined) {
    throw new LayoutResolutionError(
      "SLOT_CAPACITY_EXCEEDED",
      `Layout slot is already occupied: ${requestedSlot}`,
      {
        pageId: page.id,
        elementId: element.id,
        layoutType: page.layout.type,
        slot: requestedSlot,
        details: { capacityKey, occupiedBy },
      },
    );
  }
  state.occupied.set(capacityKey, element.id);
}

function invalidSlot(page: DeckPage, element: DeckElement, slot: string): never {
  throw new LayoutResolutionError(
    "SLOT_INVALID",
    `Invalid slot for ${page.layout.type} layout: ${slot}`,
    {
      pageId: page.id,
      elementId: element.id,
      layoutType: page.layout.type,
      slot,
    },
  );
}

function splitColumns(
  page: DeckPage,
  layout: Extract<ResolvedLayout, { type: "split" }>,
  width: number,
  height: number,
): Readonly<{
  left: Readonly<{ title: ResolvedBounds; body: ResolvedBounds }>;
  right: Readonly<{ title: ResolvedBounds; body: ResolvedBounds }>;
}> {
  const { ratio, margin, gap, titleHeight } = layout.options;
  const area = contentBounds(page, layout, width, height, margin);
  const columnWidth = area.w - gap;
  if (columnWidth <= 0) {
    return invalidGeometry(
      page,
      layout,
      "Split gap leaves no column area",
      { area, gap },
    );
  }
  const leftWidth = columnWidth * ratio;
  const rightWidth = columnWidth - leftWidth;
  const leftArea = { ...area, w: leftWidth };
  const rightArea = {
    x: area.x + leftWidth + gap,
    y: area.y,
    w: rightWidth,
    h: area.h,
  };
  return {
    left: stackedBounds(page, layout, leftArea, titleHeight, gap),
    right: stackedBounds(page, layout, rightArea, titleHeight, gap),
  };
}

function metricSlotBounds(
  page: DeckPage,
  element: DeckElement,
  layout: Extract<ResolvedLayout, { type: "metric-grid" }>,
  width: number,
  height: number,
  state: SlotResolutionState,
  slot: string,
): ResolvedBounds {
  const { columns, rows, margin, gap, titleHeight } = layout.options;
  const capacity = columns * rows;
  let index: number;
  if (slot === "metric") {
    index = state.nextMetricIndex;
    while (index <= capacity && state.occupied.has(`metric.${index}`)) {
      index += 1;
    }
    state.nextMetricIndex = index + 1;
  } else {
    const match = /^metric\.([1-9][0-9]*)$/u.exec(slot);
    if (match === null) {
      return invalidSlot(page, element, slot);
    }
    index = Number.parseInt(match[1] as string, 10);
  }

  if (index > capacity) {
    throw new LayoutResolutionError(
      "SLOT_CAPACITY_EXCEEDED",
      `Metric grid capacity exceeded: ${slot}`,
      {
        pageId: page.id,
        elementId: element.id,
        layoutType: layout.type,
        slot,
        details: { columns, rows, capacity, requestedIndex: index },
      },
    );
  }
  reserveSlot(page, element, state, slot, `metric.${index}`);

  const area = contentBounds(page, layout, width, height, margin);
  const gridY = area.y + titleHeight + gap;
  const gridHeight = area.h - titleHeight - gap;
  const cellWidth = (area.w - gap * (columns - 1)) / columns;
  const cellHeight = (gridHeight - gap * (rows - 1)) / rows;
  if (cellWidth <= 0 || cellHeight <= 0) {
    return invalidGeometry(
      page,
      layout,
      "Metric grid options leave no usable cell area",
      { area, columns, rows, gap, titleHeight },
    );
  }
  const zeroBased = index - 1;
  const column = zeroBased % columns;
  const row = Math.floor(zeroBased / columns);
  return roundedBounds({
    x: area.x + column * (cellWidth + gap),
    y: gridY + row * (cellHeight + gap),
    w: cellWidth,
    h: cellHeight,
  });
}

export function resolveLayoutSlot(
  page: DeckPage,
  element: DeckElement,
  layout: ResolvedLayout,
  width: number,
  height: number,
  state: SlotResolutionState,
): ResolvedBounds {
  const slot = element.slot ?? "";

  switch (layout.type) {
    case "free":
      return invalidSlot(page, element, slot);
    case "cover": {
      const { margin, gap, titleHeight, bodyHeight } = layout.options;
      const area = contentBounds(page, layout, width, height, margin);
      const blockHeight = titleHeight + gap + bodyHeight;
      if (blockHeight > area.h) {
        return invalidGeometry(
          page,
          layout,
          "Cover title and body exceed the content area",
          { area, titleHeight, bodyHeight, gap },
        );
      }
      const title = roundedBounds({
        x: area.x,
        y: area.y + (area.h - blockHeight) / 2,
        w: area.w,
        h: titleHeight,
      });
      const body = roundedBounds({
        x: area.x,
        y: title.y + title.h + gap,
        w: area.w,
        h: bodyHeight,
      });
      if (slot !== "title" && slot !== "body") {
        return invalidSlot(page, element, slot);
      }
      reserveSlot(page, element, state, slot);
      return slot === "title" ? title : body;
    }
    case "title-body": {
      if (slot !== "title" && slot !== "body") {
        return invalidSlot(page, element, slot);
      }
      reserveSlot(page, element, state, slot);
      const { margin, gap, titleHeight } = layout.options;
      const area = contentBounds(page, layout, width, height, margin);
      const sections = stackedBounds(page, layout, area, titleHeight, gap);
      return sections[slot];
    }
    case "split": {
      const match = /^(left|right)\.(title|body|hero)$/u.exec(slot);
      if (match === null) {
        return invalidSlot(page, element, slot);
      }
      const side = match[1] as "left" | "right";
      const requestedSection = match[2] as "title" | "body" | "hero";
      const section = requestedSection === "hero" ? "body" : requestedSection;
      reserveSlot(page, element, state, slot, `${side}.${section}`);
      return splitColumns(page, layout, width, height)[side][section];
    }
    case "two-column": {
      const { margin, gap, titleHeight, columnTitleHeight } = layout.options;
      const area = contentBounds(page, layout, width, height, margin);
      const pageSections = stackedBounds(
        page,
        layout,
        area,
        titleHeight,
        gap,
      );
      if (slot === "title") {
        reserveSlot(page, element, state, slot);
        return pageSections.title;
      }
      const match = /^(left|right)\.(title|body|hero)$/u.exec(slot);
      if (match === null) {
        return invalidSlot(page, element, slot);
      }
      const columnWidth = (pageSections.body.w - gap) / 2;
      if (columnWidth <= 0) {
        return invalidGeometry(
          page,
          layout,
          "Two-column gap leaves no usable column area",
          { body: pageSections.body, gap },
        );
      }
      const side = match[1] as "left" | "right";
      const requestedSection = match[2] as "title" | "body" | "hero";
      const section = requestedSection === "hero" ? "body" : requestedSection;
      const columnArea = {
        x:
          side === "left"
            ? pageSections.body.x
            : pageSections.body.x + columnWidth + gap,
        y: pageSections.body.y,
        w: columnWidth,
        h: pageSections.body.h,
      };
      reserveSlot(page, element, state, slot, `${side}.${section}`);
      return stackedBounds(
        page,
        layout,
        columnArea,
        columnTitleHeight,
        gap,
      )[section];
    }
    case "metric-grid": {
      if (slot === "title") {
        reserveSlot(page, element, state, slot);
        const { margin, titleHeight } = layout.options;
        const area = contentBounds(page, layout, width, height, margin);
        return roundedBounds({ ...area, h: titleHeight });
      }
      return metricSlotBounds(
        page,
        element,
        layout,
        width,
        height,
        state,
        slot,
      );
    }
    case "full-image": {
      if (slot === "hero") {
        reserveSlot(page, element, state, slot);
        return { x: 0, y: 0, w: width, h: height };
      }
      if (slot !== "title" && slot !== "body") {
        return invalidSlot(page, element, slot);
      }
      const { margin, gap, titleHeight, bodyHeight } = layout.options;
      const area = contentBounds(page, layout, width, height, margin);
      const blockHeight = titleHeight + gap + bodyHeight;
      if (blockHeight > area.h) {
        return invalidGeometry(
          page,
          layout,
          "Full-image overlay exceeds the content area",
          { area, titleHeight, bodyHeight, gap },
        );
      }
      const body = roundedBounds({
        x: area.x,
        y: area.y + area.h - bodyHeight,
        w: area.w,
        h: bodyHeight,
      });
      const title = roundedBounds({
        x: area.x,
        y: body.y - gap - titleHeight,
        w: area.w,
        h: titleHeight,
      });
      reserveSlot(page, element, state, slot);
      return slot === "title" ? title : body;
    }
  }
}
