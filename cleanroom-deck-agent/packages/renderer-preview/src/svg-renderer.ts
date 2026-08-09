import type { AssetResolver, LoadedImageAsset } from "@deck-agent/deck-core";
import {
  dispatchResolvedElement,
  resolveImageGeometry,
  type ResolvedDeck,
  type ResolvedElementRenderer,
  type ResolvedImageElement,
  type ResolvedImageGeometry,
  type ResolvedLineElement,
  type ResolvedPage,
  type ResolvedShapeElement,
  type ResolvedTextElement,
} from "@deck-agent/deck-layout";

const POINTS_PER_INCH = 72;
const PIXELS_PER_INCH = 96;

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function number(value: number): string {
  return Number.isInteger(value)
    ? String(value)
    : String(Number(value.toFixed(12)));
}

function deckUnits(value: number): string {
  return number(value * PIXELS_PER_INCH);
}

function pointsToPixels(value: number): number {
  return (value * PIXELS_PER_INCH) / POINTS_PER_INCH;
}

function imageDataUri(image: LoadedImageAsset): string {
  return `data:${image.mimeType};base64,${Buffer.from(image.data).toString("base64")}`;
}

function imageMarkupFromGeometry(
  element: ResolvedImageElement,
  image: LoadedImageAsset,
  geometry: ResolvedImageGeometry,
): string {
  const href = escapeXml(imageDataUri(image));
  const title =
    element.content.alt === undefined
      ? ""
      : `<title>${escapeXml(element.content.alt)}</title>`;

  if (geometry.sourceCrop === undefined) {
    return [
      `<g id="${escapeXml(element.id)}" data-element-type="image">`,
      title,
      `<image href="${href}" x="${deckUnits(geometry.placement.x)}" y="${deckUnits(geometry.placement.y)}" width="${deckUnits(geometry.placement.w)}" height="${deckUnits(geometry.placement.h)}" preserveAspectRatio="none"/>`,
      "</g>",
    ].join("");
  }

  const crop = geometry.sourceCrop;
  const viewBox = [
    crop.x * image.dimensions.width,
    crop.y * image.dimensions.height,
    crop.width * image.dimensions.width,
    crop.height * image.dimensions.height,
  ]
    .map(number)
    .join(" ");

  return [
    `<g id="${escapeXml(element.id)}" data-element-type="image">`,
    title,
    `<svg x="${deckUnits(geometry.placement.x)}" y="${deckUnits(geometry.placement.y)}" width="${deckUnits(geometry.placement.w)}" height="${deckUnits(geometry.placement.h)}" viewBox="${viewBox}" overflow="hidden" preserveAspectRatio="none">`,
    `<image href="${href}" x="0" y="0" width="${number(image.dimensions.width)}" height="${number(image.dimensions.height)}" preserveAspectRatio="none"/>`,
    "</svg>",
    "</g>",
  ].join("");
}

function remotePlaceholder(element: ResolvedImageElement): string {
  const label = escapeXml(`Remote asset: ${element.content.source}`);
  const fontSize = Math.min(0.2, element.h / 6);
  return [
    `<g id="${escapeXml(element.id)}" data-element-type="image" data-asset-kind="remote">`,
    `<rect x="${deckUnits(element.x)}" y="${deckUnits(element.y)}" width="${deckUnits(element.w)}" height="${deckUnits(element.h)}" fill="#EEF1F5" stroke="#98A2B3" stroke-width="${number(pointsToPixels(1))}" stroke-dasharray="${number(pointsToPixels(4))} ${number(pointsToPixels(3))}"/>`,
    `<line x1="${deckUnits(element.x)}" y1="${deckUnits(element.y)}" x2="${deckUnits(element.x + element.w)}" y2="${deckUnits(element.y + element.h)}" stroke="#98A2B3" stroke-width="${number(pointsToPixels(1))}"/>`,
    `<line x1="${deckUnits(element.x + element.w)}" y1="${deckUnits(element.y)}" x2="${deckUnits(element.x)}" y2="${deckUnits(element.y + element.h)}" stroke="#98A2B3" stroke-width="${number(pointsToPixels(1))}"/>`,
    `<text x="${deckUnits(element.x + element.w / 2)}" y="${deckUnits(element.y + element.h / 2)}" text-anchor="middle" dominant-baseline="middle" font-family="Arial, sans-serif" font-size="${deckUnits(fontSize)}" fill="#475467">${label}</text>`,
    "</g>",
  ].join("");
}

function textWhiteSpace(
  mode: ResolvedTextElement["style"]["wrap"]["mode"],
): string {
  return mode === "none" ? "pre" : "pre-wrap";
}

function textWordBreak(
  mode: ResolvedTextElement["style"]["wrap"]["mode"],
): string {
  return mode === "character" ? "break-all" : "normal";
}

function textMarkup(element: ResolvedTextElement): string {
  const wrap = element.style.wrap;
  const clamped = wrap.maxLines !== undefined;
  const styles = [
    "box-sizing:border-box",
    "width:100%",
    "height:100%",
    "margin:0",
    "padding:0",
    `font-family:${JSON.stringify(element.style.fontFamily)}`,
    `font-size:${number(pointsToPixels(element.style.fontSize))}px`,
    `font-style:${element.style.fontStyle}`,
    `font-weight:${element.style.bold ? 700 : 400}`,
    "line-height:1.2",
    `color:${element.style.color}`,
    `text-align:${element.style.alignment}`,
    `white-space:${textWhiteSpace(wrap.mode)}`,
    `word-break:${textWordBreak(wrap.mode)}`,
    wrap.mode === "word" ? "overflow-wrap:break-word" : "overflow-wrap:normal",
    "overflow:hidden",
    wrap.overflow === "ellipsis"
      ? "text-overflow:ellipsis"
      : "text-overflow:clip",
    ...(clamped
      ? [
          "display:-webkit-box",
          "-webkit-box-orient:vertical",
          `-webkit-line-clamp:${String(wrap.maxLines)}`,
        ]
      : []),
  ];

  return [
    `<foreignObject id="${escapeXml(element.id)}" data-element-type="text" x="${deckUnits(element.x)}" y="${deckUnits(element.y)}" width="${deckUnits(element.w)}" height="${deckUnits(element.h)}">`,
    `<div xmlns="http://www.w3.org/1999/xhtml" style="${escapeXml(styles.join(";"))}">${escapeXml(element.content.value)}</div>`,
    "</foreignObject>",
  ].join("");
}

function shapeMarkup(element: ResolvedShapeElement): string {
  const fill = element.style.fill ?? "none";
  const stroke = element.style.stroke ?? "none";
  const strokeWidth = number(pointsToPixels(element.style.strokeWidth));
  const common = [
    `id="${escapeXml(element.id)}"`,
    'data-element-type="shape"',
    `fill="${escapeXml(fill)}"`,
    `stroke="${escapeXml(stroke)}"`,
    `stroke-width="${strokeWidth}"`,
  ].join(" ");

  if (element.content.kind === "ellipse") {
    return `<ellipse ${common} cx="${deckUnits(element.x + element.w / 2)}" cy="${deckUnits(element.y + element.h / 2)}" rx="${deckUnits(element.w / 2)}" ry="${deckUnits(element.h / 2)}"/>`;
  }

  return `<rect ${common} x="${deckUnits(element.x)}" y="${deckUnits(element.y)}" width="${deckUnits(element.w)}" height="${deckUnits(element.h)}" rx="${deckUnits(element.style.radius)}" ry="${deckUnits(element.style.radius)}"/>`;
}

function lineMarkup(element: ResolvedLineElement, markerIndex: number): string {
  const markerId = `preview-arrow-${String(markerIndex)}`;
  const marker = [
    "<defs>",
    `<marker id="${markerId}" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto-start-reverse" markerUnits="strokeWidth">`,
    `<path d="M 0 0 L 6 3 L 0 6 z" fill="${escapeXml(element.style.stroke)}"/>`,
    "</marker>",
    "</defs>",
  ].join("");
  const startArrow =
    element.style.arrow === "start" || element.style.arrow === "both";
  const endArrow =
    element.style.arrow === "end" || element.style.arrow === "both";
  const strokeWidth = pointsToPixels(element.style.width);
  const dashArray =
    element.style.dash === "solid"
      ? ""
      : element.style.dash === "dot"
        ? ` stroke-dasharray="${number(strokeWidth)} ${number(strokeWidth * 2)}" stroke-linecap="round"`
        : ` stroke-dasharray="${number(strokeWidth * 4)} ${number(strokeWidth * 3)}"`;

  return [
    marker,
    `<line id="${escapeXml(element.id)}" data-element-type="line" x1="${deckUnits(element.content.start.x)}" y1="${deckUnits(element.content.start.y)}" x2="${deckUnits(element.content.end.x)}" y2="${deckUnits(element.content.end.y)}" stroke="${escapeXml(element.style.stroke)}" stroke-width="${number(strokeWidth)}"${dashArray}${startArrow ? ` marker-start="url(#${markerId})"` : ""}${endArrow ? ` marker-end="url(#${markerId})"` : ""}/>`,
  ].join("");
}

class SvgElementRenderer implements ResolvedElementRenderer<Promise<string>> {
  readonly #assets: AssetResolver;
  #lineIndex = 0;

  constructor(assets: AssetResolver) {
    this.#assets = assets;
  }

  async renderText(element: ResolvedTextElement): Promise<string> {
    return textMarkup(element);
  }

  async renderImage(element: ResolvedImageElement): Promise<string> {
    const asset = await this.#assets.resolve(element.content.source);
    if (asset.kind === "remote") {
      return remotePlaceholder(element);
    }

    const image = await this.#assets.readImage(asset);
    const geometry = resolveImageGeometry(
      { x: element.x, y: element.y, w: element.w, h: element.h },
      image.dimensions,
      element.content.fit,
      element.content.crop,
    );
    return imageMarkupFromGeometry(element, image, geometry);
  }

  async renderShape(element: ResolvedShapeElement): Promise<string> {
    return shapeMarkup(element);
  }

  async renderLine(element: ResolvedLineElement): Promise<string> {
    this.#lineIndex += 1;
    return lineMarkup(element, this.#lineIndex);
  }
}

export interface ResolvedPageSvg {
  readonly pageId: string;
  readonly svg: string;
}

export async function renderResolvedPageSvg(
  page: ResolvedPage,
  size: ResolvedDeck["size"],
  assets: AssetResolver,
): Promise<ResolvedPageSvg> {
  const renderer = new SvgElementRenderer(assets);
  const elementMarkup: string[] = [];

  for (const element of page.elements) {
    elementMarkup.push(await dispatchResolvedElement(element, renderer));
  }

  return {
    pageId: page.id,
    svg: [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${deckUnits(size.width)}" height="${deckUnits(size.height)}" viewBox="0 0 ${deckUnits(size.width)} ${deckUnits(size.height)}" role="img" aria-label="${escapeXml(page.id)}">`,
      `<rect x="0" y="0" width="${deckUnits(size.width)}" height="${deckUnits(size.height)}" fill="${escapeXml(page.background.color)}"/>`,
      ...elementMarkup,
      "</svg>",
    ].join(""),
  };
}
