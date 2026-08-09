import {
  AssetResolutionError,
  type AssetResolver,
} from "@deck-agent/deck-core";
import type {
  ResolvedBounds,
  ResolvedDeck,
  ResolvedElement,
  ResolvedImageElement,
  ResolvedLineElement,
  ResolvedPage,
  ResolvedShapeElement,
  ResolvedTextElement,
} from "@deck-agent/deck-layout";

import type { FontAvailabilityProvider } from "./font-availability.js";
import type { QaIssue, QaReport, QaSeverity } from "./types.js";

const BOUNDS_EPSILON = 1e-9;
const COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/u;
const MIN_IMAGE_EDGE = 0.1;
const MAX_IMAGE_ASPECT = 12;
const BACKGROUND_AREA_RATIO = 0.9;
const OVERLAP_AREA_RATIO = 0.05;
const ELEMENT_TEXT_DENSITY_THRESHOLD = 70;
const PAGE_TEXT_DENSITY_THRESHOLD = 18;

export interface QaContext {
  readonly assets: AssetResolver;
  readonly fonts?: FontAvailabilityProvider;
}

function issue(
  code: QaIssue["code"],
  severity: QaSeverity,
  pageId: string,
  message: string,
  elementId?: string,
  details?: Readonly<Record<string, unknown>>,
): QaIssue {
  return {
    code,
    severity,
    pageId,
    ...(elementId === undefined ? {} : { elementId }),
    message,
    ...(details === undefined ? {} : { details }),
  };
}

function boundsOf(element: ResolvedElement): ResolvedBounds {
  return { x: element.x, y: element.y, w: element.w, h: element.h };
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function hasValidGeometry(element: ResolvedElement): boolean {
  return (
    finite(element.x) &&
    finite(element.y) &&
    finite(element.w) &&
    finite(element.h) &&
    element.w > 0 &&
    element.h > 0
  );
}

function checkElementGeometry(
  deck: ResolvedDeck,
  page: ResolvedPage,
  element: ResolvedElement,
): QaIssue[] {
  const bounds = boundsOf(element);
  if (!hasValidGeometry(element)) {
    return [
      issue(
        "GEOMETRY_INVALID",
        "error",
        page.id,
        "Element bounds must contain finite coordinates and positive dimensions",
        element.id,
        { bounds },
      ),
    ];
  }

  if (
    element.x < -BOUNDS_EPSILON ||
    element.y < -BOUNDS_EPSILON ||
    element.x + element.w > deck.size.width + BOUNDS_EPSILON ||
    element.y + element.h > deck.size.height + BOUNDS_EPSILON
  ) {
    return [
      issue(
        "ELEMENT_OUT_OF_BOUNDS",
        "error",
        page.id,
        "Element bounds extend outside the slide",
        element.id,
        { bounds, slide: deck.size },
      ),
    ];
  }

  return [];
}

function checkDuplicateIds(page: ResolvedPage): QaIssue[] {
  const issues: QaIssue[] = [];
  const firstIndexes = new Map<string, number>();
  page.elements.forEach((element, index) => {
    const firstIndex = firstIndexes.get(element.id);
    if (firstIndex === undefined) {
      firstIndexes.set(element.id, index);
      return;
    }
    issues.push(
      issue(
        "ELEMENT_ID_DUPLICATE",
        "error",
        page.id,
        "Element id is duplicated within the page",
        element.id,
        { firstIndex, duplicateIndex: index },
      ),
    );
  });
  return issues;
}

function colorIsValid(value: unknown): value is string {
  return typeof value === "string" && COLOR_PATTERN.test(value);
}

function checkPageVisualDefaults(page: ResolvedPage): QaIssue[] {
  const color = (page.background as { readonly color?: unknown } | undefined)
    ?.color;
  if (colorIsValid(color)) {
    return [];
  }
  return [
    issue(
      "VISUAL_DEFAULT_LOW_CONFIDENCE",
      "warning",
      page.id,
      "Resolved page background is missing or invalid",
      undefined,
      { property: "background.color", value: color },
    ),
  ];
}

function checkTextVisualDefaults(
  page: ResolvedPage,
  element: ResolvedTextElement,
): QaIssue[] {
  const issues: QaIssue[] = [];
  const style = element.style as ResolvedTextElement["style"] & {
    readonly color?: unknown;
    readonly fontFamily?: unknown;
    readonly fontSize?: unknown;
  };

  if (!colorIsValid(style.color)) {
    issues.push(
      issue(
        "VISUAL_DEFAULT_LOW_CONFIDENCE",
        "warning",
        page.id,
        "Resolved text color is missing or invalid",
        element.id,
        { property: "style.color", value: style.color },
      ),
    );
  }

  if (
    typeof style.fontFamily !== "string" ||
    style.fontFamily.trim().length === 0
  ) {
    issues.push(
      issue(
        "FONT_FALLBACK_INVALID",
        "error",
        page.id,
        "Resolved text requires a non-empty font family fallback",
        element.id,
        { value: style.fontFamily },
      ),
    );
  }

  if (!finite(style.fontSize) || style.fontSize <= 0) {
    issues.push(
      issue(
        "VISUAL_DEFAULT_LOW_CONFIDENCE",
        "warning",
        page.id,
        "Resolved text font size is missing or invalid",
        element.id,
        { property: "style.fontSize", value: style.fontSize },
      ),
    );
  }

  return issues;
}

function checkShapeVisualDefaults(
  page: ResolvedPage,
  element: ResolvedShapeElement,
): QaIssue[] {
  const style = element.style as ResolvedShapeElement["style"] & {
    readonly fill?: unknown;
    readonly stroke?: unknown;
    readonly strokeWidth?: unknown;
  };
  const missing: string[] = [];
  if (
    style.fill === undefined ||
    (style.fill !== null && !colorIsValid(style.fill))
  ) {
    missing.push("style.fill");
  }
  if (
    style.stroke === undefined ||
    (style.stroke !== null && !colorIsValid(style.stroke))
  ) {
    missing.push("style.stroke");
  }
  if (!finite(style.strokeWidth) || style.strokeWidth <= 0) {
    missing.push("style.strokeWidth");
  }

  if (missing.length > 0) {
    return [
      issue(
        "VISUAL_DEFAULT_LOW_CONFIDENCE",
        "warning",
        page.id,
        "Resolved shape fill or stroke is missing or invalid",
        element.id,
        { properties: missing },
      ),
    ];
  }

  if (style.fill === null && style.stroke === null) {
    return [
      issue(
        "VISUAL_DEFAULT_LOW_CONFIDENCE",
        "info",
        page.id,
        "Shape explicitly has neither fill nor stroke and may be invisible",
        element.id,
        { fill: null, stroke: null },
      ),
    ];
  }

  return [];
}

function colorChannels(color: string): readonly [number, number, number] {
  return [
    Number.parseInt(color.slice(1, 3), 16),
    Number.parseInt(color.slice(3, 5), 16),
    Number.parseInt(color.slice(5, 7), 16),
  ];
}

function relativeLuminance(color: string): number {
  const channels = colorChannels(color).map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return (
    0.2126 * (channels[0] as number) +
    0.7152 * (channels[1] as number) +
    0.0722 * (channels[2] as number)
  );
}

function contrastRatio(foreground: string, background: string): number {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

function backgroundUnderText(
  page: ResolvedPage,
  element: ResolvedTextElement,
): string | undefined {
  if (!colorIsValid(page.background.color)) {
    return undefined;
  }
  let background = page.background.color;
  const elementIndex = page.elements.indexOf(element);
  for (let index = 0; index < elementIndex; index += 1) {
    const candidate = page.elements[index];
    if (
      candidate === undefined ||
      !hasValidGeometry(candidate) ||
      !contains(boundsOf(candidate), boundsOf(element))
    ) {
      continue;
    }
    if (candidate.type === "image") {
      return undefined;
    }
    if (candidate.type === "shape" && candidate.style.fill !== null) {
      background = candidate.style.fill;
    }
  }
  return background;
}

function checkTextContrast(
  page: ResolvedPage,
  element: ResolvedTextElement,
): QaIssue[] {
  if (!colorIsValid(element.style.color)) {
    return [];
  }
  const background = backgroundUnderText(page, element);
  if (background === undefined || !colorIsValid(background)) {
    return [];
  }
  const ratio = contrastRatio(element.style.color, background);
  const threshold =
    element.style.fontSize >= 18 ||
    (element.style.bold && element.style.fontSize >= 14)
      ? 3
      : 4.5;
  if (ratio >= threshold) {
    return [];
  }
  return [
    issue(
      "LOW_CONTRAST",
      "warning",
      page.id,
      "Text and its resolved background have low contrast",
      element.id,
      {
        foreground: element.style.color,
        background,
        contrastRatio: ratio,
        threshold,
      },
    ),
  ];
}

async function checkTextFontAvailability(
  page: ResolvedPage,
  element: ResolvedTextElement,
  provider: FontAvailabilityProvider | undefined,
): Promise<QaIssue[]> {
  if (provider === undefined || element.style.fontFamily.trim().length === 0) {
    return [];
  }
  const availability = await provider.check(element.style.fontFamily);
  if (availability !== "unavailable") {
    return [];
  }
  return [
    issue(
      "FONT_UNAVAILABLE",
      "warning",
      page.id,
      "Resolved font family is unavailable on the current host",
      element.id,
      { fontFamily: element.style.fontFamily, availability },
    ),
  ];
}

function checkLineVisualDefaults(
  page: ResolvedPage,
  element: ResolvedLineElement,
): QaIssue[] {
  const stroke = (element.style as { readonly stroke?: unknown }).stroke;
  if (colorIsValid(stroke)) {
    return [];
  }
  return [
    issue(
      "VISUAL_DEFAULT_LOW_CONFIDENCE",
      "warning",
      page.id,
      "Resolved line stroke is missing or invalid",
      element.id,
      { property: "style.stroke", value: stroke },
    ),
  ];
}

function textLength(value: string): number {
  return Array.from(value.replace(/\s/gu, "")).length;
}

function estimateWrappedLines(value: string, charactersPerLine: number): number {
  return value
    .split(/\r?\n/gu)
    .reduce(
      (lines, paragraph) =>
        lines +
        Math.max(
          1,
          Math.ceil(Array.from(paragraph).length / charactersPerLine),
        ),
      0,
    );
}

function checkTextHeuristics(
  page: ResolvedPage,
  element: ResolvedTextElement,
): QaIssue[] {
  if (!hasValidGeometry(element)) {
    return [];
  }
  const fontSize = element.style.fontSize;
  if (!finite(fontSize) || fontSize <= 0) {
    return [];
  }

  const characters = textLength(element.content.value);
  if (characters === 0) {
    return [];
  }

  const averageGlyphWidth = fontSize * 0.52;
  const charactersPerLine = Math.max(
    1,
    Math.floor((element.w * 72) / averageGlyphWidth),
  );
  const heightCapacity = Math.max(
    1,
    Math.floor((element.h * 72) / (fontSize * 1.2)),
  );
  const lineCapacity = Math.min(
    heightCapacity,
    element.style.wrap.maxLines ?? Number.POSITIVE_INFINITY,
  );
  const paragraphs = element.content.value.split(/\r?\n/gu);
  const estimatedLines =
    element.style.wrap.mode === "none"
      ? paragraphs.length
      : estimateWrappedLines(element.content.value, charactersPerLine);
  const longestLine = Math.max(
    ...paragraphs.map((paragraph) => Array.from(paragraph).length),
  );
  const horizontalRatio =
    element.style.wrap.mode === "none"
      ? longestLine / charactersPerLine
      : 1;
  const overflowRatio = Math.max(
    estimatedLines / lineCapacity,
    horizontalRatio,
  );
  const issues: QaIssue[] = [];

  if (overflowRatio > 1.1) {
    const severity: QaSeverity =
      overflowRatio >= 2.5 && element.style.wrap.overflow !== "shrink"
        ? "error"
        : "warning";
    issues.push(
      issue(
        "TEXT_OVERFLOW_RISK",
        severity,
        page.id,
        "Text is likely to exceed its resolved text box",
        element.id,
        {
          characters,
          charactersPerLine,
          estimatedLines,
          lineCapacity,
          overflowRatio,
          overflowMode: element.style.wrap.overflow,
        },
      ),
    );
  }

  const area = element.w * element.h;
  const density = characters / area;
  if (characters >= 120 && density > ELEMENT_TEXT_DENSITY_THRESHOLD) {
    issues.push(
      issue(
        "TEXT_DENSITY_HIGH",
        "warning",
        page.id,
        "Text density is unusually high for the resolved box",
        element.id,
        { characters, area, charactersPerSquareInch: density },
      ),
    );
  }

  return issues;
}

function checkImageFrame(
  page: ResolvedPage,
  element: ResolvedImageElement,
): QaIssue[] {
  if (!hasValidGeometry(element)) {
    return [];
  }
  const aspect = element.w / element.h;
  const reasons: string[] = [];
  if (element.w < MIN_IMAGE_EDGE || element.h < MIN_IMAGE_EDGE) {
    reasons.push("edge_too_small");
  }
  if (aspect > MAX_IMAGE_ASPECT || aspect < 1 / MAX_IMAGE_ASPECT) {
    reasons.push("extreme_aspect_ratio");
  }
  if (reasons.length === 0) {
    return [];
  }
  return [
    issue(
      "IMAGE_FRAME_SUSPICIOUS",
      "warning",
      page.id,
      "Image frame dimensions are unlikely to produce a useful visual",
      element.id,
      { bounds: boundsOf(element), aspect, reasons },
    ),
  ];
}

function pointIsFinite(
  point: unknown,
): point is Readonly<{ x: number; y: number }> {
  if (typeof point !== "object" || point === null) {
    return false;
  }
  const candidate = point as { readonly x?: unknown; readonly y?: unknown };
  return finite(candidate.x) && finite(candidate.y);
}

function pointInsideBounds(
  point: Readonly<{ x: number; y: number }>,
  bounds: ResolvedBounds,
): boolean {
  return (
    point.x >= bounds.x - BOUNDS_EPSILON &&
    point.y >= bounds.y - BOUNDS_EPSILON &&
    point.x <= bounds.x + bounds.w + BOUNDS_EPSILON &&
    point.y <= bounds.y + bounds.h + BOUNDS_EPSILON
  );
}

function checkLineEndpoints(
  deck: ResolvedDeck,
  page: ResolvedPage,
  element: ResolvedLineElement,
): QaIssue[] {
  const content = element.content as {
    readonly start?: unknown;
    readonly end?: unknown;
  };
  const reasons: string[] = [];
  if (!pointIsFinite(content.start)) {
    reasons.push("start_not_finite");
  }
  if (!pointIsFinite(content.end)) {
    reasons.push("end_not_finite");
  }

  if (pointIsFinite(content.start) && pointIsFinite(content.end)) {
    if (
      Math.abs(content.start.x - content.end.x) <= BOUNDS_EPSILON &&
      Math.abs(content.start.y - content.end.y) <= BOUNDS_EPSILON
    ) {
      reasons.push("zero_length");
    }
    const slideBounds = {
      x: 0,
      y: 0,
      w: deck.size.width,
      h: deck.size.height,
    };
    if (!pointInsideBounds(content.start, slideBounds)) {
      reasons.push("start_outside_slide");
    }
    if (!pointInsideBounds(content.end, slideBounds)) {
      reasons.push("end_outside_slide");
    }
    if (hasValidGeometry(element)) {
      const elementBounds = boundsOf(element);
      if (!pointInsideBounds(content.start, elementBounds)) {
        reasons.push("start_outside_element_bounds");
      }
      if (!pointInsideBounds(content.end, elementBounds)) {
        reasons.push("end_outside_element_bounds");
      }
    }
  }

  if (reasons.length === 0) {
    return [];
  }
  return [
    issue(
      "LINE_ENDPOINT_INVALID",
      "error",
      page.id,
      "Line source or destination endpoint is invalid",
      element.id,
      { start: content.start, end: content.end, reasons },
    ),
  ];
}

async function checkImageAsset(
  page: ResolvedPage,
  element: ResolvedImageElement,
  assets: AssetResolver,
): Promise<QaIssue[]> {
  try {
    const asset = await assets.resolve(element.content.source);
    if (asset.kind === "remote") {
      return [
        issue(
          "REMOTE_ASSET_UNSUPPORTED",
          "error",
          page.id,
          "Remote image asset is preserved but unsupported by local V1 output",
          element.id,
          { source: asset.source },
        ),
      ];
    }
    await assets.read(asset);
    return [];
  } catch (error) {
    return [
      issue(
        "MISSING_ASSET",
        "error",
        page.id,
        "Local image asset is missing, unreadable, or unsafe",
        element.id,
        {
          source: element.content.source,
          ...(error instanceof AssetResolutionError
            ? { assetError: error.toJSON() }
            : {
                message: error instanceof Error ? error.message : String(error),
              }),
        },
      ),
    ];
  }
}

function intersectionArea(left: ResolvedBounds, right: ResolvedBounds): number {
  const width = Math.max(
    0,
    Math.min(left.x + left.w, right.x + right.w) - Math.max(left.x, right.x),
  );
  const height = Math.max(
    0,
    Math.min(left.y + left.h, right.y + right.h) - Math.max(left.y, right.y),
  );
  return width * height;
}

function contains(container: ResolvedBounds, child: ResolvedBounds): boolean {
  return (
    child.x >= container.x - BOUNDS_EPSILON &&
    child.y >= container.y - BOUNDS_EPSILON &&
    child.x + child.w <= container.x + container.w + BOUNDS_EPSILON &&
    child.y + child.h <= container.y + container.h + BOUNDS_EPSILON
  );
}

function isBackgroundLike(element: ResolvedElement, deck: ResolvedDeck): boolean {
  return (
    (element.type === "image" || element.type === "shape") &&
    hasValidGeometry(element) &&
    (element.w * element.h) / (deck.size.width * deck.size.height) >=
      BACKGROUND_AREA_RATIO
  );
}

function overlapSeverity(
  left: ResolvedElement,
  right: ResolvedElement,
  overlapRatio: number,
): QaSeverity {
  if (left.type === "text" && right.type === "text") {
    return overlapRatio >= 0.5 ? "error" : "warning";
  }
  if (left.type === "image" && right.type === "image") {
    return "warning";
  }
  return "info";
}

function checkOverlaps(deck: ResolvedDeck, page: ResolvedPage): QaIssue[] {
  const issues: QaIssue[] = [];
  for (let leftIndex = 0; leftIndex < page.elements.length; leftIndex += 1) {
    const left = page.elements[leftIndex];
    if (
      left === undefined ||
      !hasValidGeometry(left) ||
      left.type === "line" ||
      isBackgroundLike(left, deck)
    ) {
      continue;
    }
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < page.elements.length;
      rightIndex += 1
    ) {
      const right = page.elements[rightIndex];
      if (
        right === undefined ||
        !hasValidGeometry(right) ||
        right.type === "line"
      ) {
        continue;
      }

      const leftBounds = boundsOf(left);
      const rightBounds = boundsOf(right);
      const area = intersectionArea(leftBounds, rightBounds);
      const smallerArea = Math.min(left.w * left.h, right.w * right.h);
      const overlapRatio = area / smallerArea;
      if (area <= 0 || overlapRatio < OVERLAP_AREA_RATIO) {
        continue;
      }
      if (
        left.type === "shape" &&
        (contains(leftBounds, rightBounds) || overlapRatio >= 0.9)
      ) {
        continue;
      }

      issues.push(
        issue(
          "ELEMENT_OVERLAP",
          isBackgroundLike(right, deck)
            ? "warning"
            : overlapSeverity(left, right, overlapRatio),
          page.id,
          "Resolved element bounds overlap",
          left.id,
          {
            otherElementId: right.id,
            overlapArea: area,
            overlapRatio,
            elementTypes: [left.type, right.type],
          },
        ),
      );
    }
  }
  return issues;
}

function meaningfulElement(element: ResolvedElement): boolean {
  return (
    element.type === "image" ||
    (element.type === "text" && element.content.value.trim().length > 0)
  );
}

function isPageTitle(deck: ResolvedDeck, element: ResolvedElement): boolean {
  if (element.type !== "text" || element.content.value.trim().length === 0) {
    return false;
  }
  const normalizedId = element.id.toLocaleLowerCase("en-US");
  if (
    normalizedId === "title" ||
    normalizedId === "page-title" ||
    normalizedId === "slide-title"
  ) {
    return true;
  }
  return (
    element.style.bold &&
    element.style.fontSize >= 24 &&
    element.y <= deck.size.height * 0.3 &&
    element.w >= deck.size.width * 0.3
  );
}

function checkMissingTitle(deck: ResolvedDeck, page: ResolvedPage): QaIssue[] {
  if (
    page.elements.length === 0 ||
    !page.elements.some(meaningfulElement) ||
    page.elements.some((element) => isPageTitle(deck, element))
  ) {
    return [];
  }
  return [
    issue(
      "MISSING_TITLE",
      "warning",
      page.id,
      "Page has meaningful content but no identifiable title",
    ),
  ];
}

function checkPageContent(page: ResolvedPage): QaIssue[] {
  if (page.elements.length === 0) {
    return [
      issue(
        "EMPTY_PAGE",
        "error",
        page.id,
        "Page has no resolved elements",
      ),
    ];
  }
  if (!page.elements.some(meaningfulElement)) {
    return [
      issue(
        "PAGE_MEANINGFUL_CONTENT_MISSING",
        "warning",
        page.id,
        "Page contains only shapes or lines and may lack meaningful content",
      ),
    ];
  }
  return [];
}

function checkPageTextDensity(deck: ResolvedDeck, page: ResolvedPage): QaIssue[] {
  const characters = page.elements.reduce(
    (total, element) =>
      element.type === "text"
        ? total + textLength(element.content.value)
        : total,
    0,
  );
  const slideArea = deck.size.width * deck.size.height;
  const density = characters / slideArea;
  if (
    characters < 600 ||
    !Number.isFinite(density) ||
    density <= PAGE_TEXT_DENSITY_THRESHOLD
  ) {
    return [];
  }
  return [
    issue(
      "TEXT_DENSITY_HIGH",
      "warning",
      page.id,
      "Total page text density is unusually high",
      undefined,
      { characters, slideArea, charactersPerSquareInch: density },
    ),
  ];
}

function summarize(deck: ResolvedDeck, issues: readonly QaIssue[]): QaReport {
  const counts = { info: 0, warning: 0, error: 0 };
  for (const currentIssue of issues) {
    counts[currentIssue.severity] += 1;
  }
  return {
    version: 1,
    ok: counts.error === 0,
    issues,
    summary: {
      pagesChecked: deck.pages.length,
      elementsChecked: deck.pages.reduce(
        (total, page) => total + page.elements.length,
        0,
      ),
      total: issues.length,
      ...counts,
    },
  };
}

export async function qaDeck(
  deck: ResolvedDeck,
  context: QaContext,
): Promise<QaReport> {
  const issues: QaIssue[] = [];

  for (const page of deck.pages) {
    issues.push(...checkPageContent(page));
    issues.push(...checkMissingTitle(deck, page));
    issues.push(...checkPageVisualDefaults(page));
    issues.push(...checkDuplicateIds(page));
    issues.push(...checkPageTextDensity(deck, page));

    for (const element of page.elements) {
      issues.push(...checkElementGeometry(deck, page, element));
      switch (element.type) {
        case "text":
          issues.push(...checkTextVisualDefaults(page, element));
          issues.push(...checkTextContrast(page, element));
          issues.push(
            ...(await checkTextFontAvailability(
              page,
              element,
              context.fonts,
            )),
          );
          issues.push(...checkTextHeuristics(page, element));
          break;
        case "image":
          issues.push(...checkImageFrame(page, element));
          issues.push(...(await checkImageAsset(page, element, context.assets)));
          break;
        case "shape":
          issues.push(...checkShapeVisualDefaults(page, element));
          break;
        case "line":
          issues.push(...checkLineVisualDefaults(page, element));
          issues.push(...checkLineEndpoints(deck, page, element));
          break;
      }
    }

    issues.push(...checkOverlaps(deck, page));
  }

  return summarize(deck, issues);
}
