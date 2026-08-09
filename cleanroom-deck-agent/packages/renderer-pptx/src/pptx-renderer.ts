import type {
  AssetResolver,
  LoadedImageAsset,
  ProjectOutputWriteResult,
  ProjectOutputWriter,
} from "@deck-agent/deck-core";
import {
  dispatchResolvedElement,
  resolveImageGeometry,
  type ResolvedDeck,
  type ResolvedElementRenderer,
  type ResolvedImageElement,
  type ResolvedImageGeometry,
  type ResolvedLineElement,
  type ResolvedShapeElement,
  type ResolvedTextElement,
} from "@deck-agent/deck-layout";
import PptxGenJSModule from "pptxgenjs";

import { PptxRenderError } from "./errors.js";
import {
  validatePptxPackage,
  type PptxValidationResult,
} from "./validation.js";

const DEFAULT_OUTPUT_PATH = "output/deck.pptx";
const CUSTOM_LAYOUT_NAME = "DECK_AGENT_RESOLVED";
const SUPPORTED_IMAGE_MIME_TYPES = new Set([
  "image/bmp",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/svg+xml",
]);

interface PptxImageProps {
  readonly data: string;
  readonly objectName: string;
  readonly altText?: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly sizing?: Readonly<{
    type: "crop";
    x: number;
    y: number;
    w: number;
    h: number;
  }>;
}

interface PptxSlide {
  background: { color: string };
  addText(text: string, options: Readonly<Record<string, unknown>>): unknown;
  addImage(options: PptxImageProps): unknown;
  addShape(
    shape: string,
    options: Readonly<Record<string, unknown>>,
  ): unknown;
}

interface PptxPresentation {
  readonly ShapeType: Readonly<{
    ellipse: string;
    line: string;
    rect: string;
    roundRect: string;
  }>;
  readonly OutputType: Readonly<{ uint8array: "uint8array" }>;
  layout: string;
  author: string;
  subject: string;
  defineLayout(layout: {
    readonly name: string;
    readonly width: number;
    readonly height: number;
  }): void;
  addSlide(): PptxSlide;
  write(options: {
    readonly outputType: "uint8array";
    readonly compression: boolean;
  }): Promise<unknown>;
}

interface PptxConstructor {
  new (): PptxPresentation;
}

// PptxGenJS 4.0.1 publishes a correct ESM runtime default but its declaration
// shape is not constructable under TypeScript 7 NodeNext. Keep the workaround
// isolated behind the narrow API surface used by this renderer.
const PptxGenJS = PptxGenJSModule as unknown as PptxConstructor;

export interface PptxRendererContext {
  readonly assets: AssetResolver;
  readonly output: ProjectOutputWriter;
}

export interface PptxRenderOptions {
  readonly outputPath?: string;
}

export interface PptxRenderResult extends ProjectOutputWriteResult {
  readonly validation: PptxValidationResult;
}

function pptxColor(color: string): string {
  return color.startsWith("#") ? color.slice(1) : color;
}

function assertPptxOutputPath(outputPath: string): void {
  if (
    outputPath.includes("\\") ||
    !outputPath.startsWith("output/") ||
    !outputPath.toLowerCase().endsWith(".pptx")
  ) {
    throw new PptxRenderError(
      "PPTX_OUTPUT_PATH_INVALID",
      "PPTX output path must be a portable project-relative path inside output/",
      { outputPath },
    );
  }
}

function imageDataUri(image: LoadedImageAsset): string {
  if (!SUPPORTED_IMAGE_MIME_TYPES.has(image.mimeType)) {
    throw new PptxRenderError(
      "IMAGE_FORMAT_UNSUPPORTED",
      `PPTX renderer does not support image MIME type: ${image.mimeType}`,
      { source: image.asset.source, mimeType: image.mimeType },
    );
  }
  return `data:${image.mimeType};base64,${Buffer.from(image.data).toString("base64")}`;
}

function imageOptionsFromGeometry(
  data: string,
  objectName: string,
  altText: string | undefined,
  geometry: ResolvedImageGeometry,
): PptxImageProps {
  const { placement, sourceCrop } = geometry;
  if (sourceCrop === undefined) {
    return {
      data,
      objectName,
      ...(altText === undefined ? {} : { altText }),
      ...placement,
    };
  }

  // PptxGenJS's crop API expresses a source rectangle in the same units as
  // the final box. Convert the already-resolved normalized crop without
  // recalculating cover, contain, or layout.
  const sourceCanvasWidth = placement.w / sourceCrop.width;
  const sourceCanvasHeight = placement.h / sourceCrop.height;
  return {
    data,
    objectName,
    ...(altText === undefined ? {} : { altText }),
    x: placement.x,
    y: placement.y,
    w: sourceCanvasWidth,
    h: sourceCanvasHeight,
    sizing: {
      type: "crop",
      x: sourceCrop.x * sourceCanvasWidth,
      y: sourceCrop.y * sourceCanvasHeight,
      w: placement.w,
      h: placement.h,
    },
  };
}

function textFit(
  overflow: ResolvedTextElement["style"]["wrap"]["overflow"],
): "none" | "shrink" {
  return overflow === "shrink" ? "shrink" : "none";
}

class SlideElementRenderer implements ResolvedElementRenderer<Promise<void>> {
  readonly #pptx: PptxPresentation;
  readonly #slide: PptxSlide;
  readonly #assets: AssetResolver;

  constructor(
    pptx: PptxPresentation,
    slide: PptxSlide,
    assets: AssetResolver,
  ) {
    this.#pptx = pptx;
    this.#slide = slide;
    this.#assets = assets;
  }

  async renderText(element: ResolvedTextElement): Promise<void> {
    this.#slide.addText(element.content.value, {
      objectName: element.id,
      x: element.x,
      y: element.y,
      w: element.w,
      h: element.h,
      fontSize: element.style.fontSize,
      bold: element.style.bold,
      align: element.style.alignment,
      wrap: element.style.wrap.mode !== "none",
      fit: textFit(element.style.wrap.overflow),
      margin: 0,
      isTextBox: true,
      ...(element.style.fontFamily === undefined
        ? {}
        : { fontFace: element.style.fontFamily }),
      ...(element.style.fontStyle === undefined
        ? {}
        : { italic: element.style.fontStyle === "italic" }),
      ...(element.style.color === undefined
        ? {}
        : { color: pptxColor(element.style.color) }),
    });
  }

  async renderImage(element: ResolvedImageElement): Promise<void> {
    const asset = await this.#assets.resolve(element.content.source);
    if (asset.kind === "remote") {
      throw new PptxRenderError(
        "REMOTE_ASSET_UNSUPPORTED",
        `Task 07 does not download remote image assets: ${asset.source}`,
        { elementId: element.id, source: asset.source },
      );
    }

    const image = await this.#assets.readImage(asset);
    const geometry = resolveImageGeometry(
      { x: element.x, y: element.y, w: element.w, h: element.h },
      image.dimensions,
      element.content.fit,
      element.content.crop,
    );
    this.#slide.addImage(
      imageOptionsFromGeometry(
        imageDataUri(image),
        element.id,
        element.content.alt,
        geometry,
      ),
    );
  }

  async renderShape(element: ResolvedShapeElement): Promise<void> {
    const rounded =
      element.content.kind === "rectangle" && element.style.radius > 0;
    const shape =
      element.content.kind === "ellipse"
        ? this.#pptx.ShapeType.ellipse
        : rounded
          ? this.#pptx.ShapeType.roundRect
          : this.#pptx.ShapeType.rect;

    this.#slide.addShape(shape, {
      objectName: element.id,
      x: element.x,
      y: element.y,
      w: element.w,
      h: element.h,
      fill:
        element.style.fill === undefined
          ? { type: "none" }
          : { color: pptxColor(element.style.fill) },
      line:
        element.style.stroke === undefined
          ? { type: "none" }
          : { color: pptxColor(element.style.stroke) },
      ...(rounded ? { rectRadius: element.style.radius } : {}),
    });
  }

  async renderLine(element: ResolvedLineElement): Promise<void> {
    const deltaX = element.content.end.x - element.content.start.x;
    const deltaY = element.content.end.y - element.content.start.y;
    const startsWithArrow =
      element.style.arrow === "start" || element.style.arrow === "both";
    const endsWithArrow =
      element.style.arrow === "end" || element.style.arrow === "both";

    this.#slide.addShape(this.#pptx.ShapeType.line, {
      objectName: element.id,
      x: Math.min(element.content.start.x, element.content.end.x),
      y: Math.min(element.content.start.y, element.content.end.y),
      w: Math.abs(deltaX),
      h: Math.abs(deltaY),
      flipH: deltaX < 0,
      flipV: deltaY < 0,
      line: {
        ...(element.style.stroke === undefined
          ? {}
          : { color: pptxColor(element.style.stroke) }),
        width: element.style.width,
        dashType:
          element.style.dash === "dot" ? "sysDot" : element.style.dash,
        ...(startsWithArrow ? { beginArrowType: "triangle" } : {}),
        ...(endsWithArrow ? { endArrowType: "triangle" } : {}),
      },
    });
  }
}

export class PptxRenderer {
  readonly #context: PptxRendererContext;

  constructor(context: PptxRendererContext) {
    this.#context = context;
  }

  async render(
    deck: ResolvedDeck,
    options: PptxRenderOptions = {},
  ): Promise<PptxRenderResult> {
    const outputPath = options.outputPath ?? DEFAULT_OUTPUT_PATH;
    assertPptxOutputPath(outputPath);
    const pptx = new PptxGenJS();
    pptx.defineLayout({
      name: CUSTOM_LAYOUT_NAME,
      width: deck.size.width,
      height: deck.size.height,
    });
    pptx.layout = CUSTOM_LAYOUT_NAME;
    pptx.author = "Deck Agent";
    pptx.subject = "Generated from Resolved Deck";

    for (const page of deck.pages) {
      const slide = pptx.addSlide();
      if (page.background !== undefined) {
        slide.background = { color: pptxColor(page.background.color) };
      }
      const elementRenderer = new SlideElementRenderer(
        pptx,
        slide,
        this.#context.assets,
      );
      for (const element of page.elements) {
        await dispatchResolvedElement(element, elementRenderer);
      }
    }

    let data: Uint8Array;
    try {
      const generated = await pptx.write({
        outputType: pptx.OutputType.uint8array,
        compression: true,
      });
      if (!(generated instanceof Uint8Array)) {
        throw new Error("PptxGenJS did not return Uint8Array output");
      }
      data = generated;
    } catch (error) {
      if (error instanceof PptxRenderError) {
        throw error;
      }
      throw new PptxRenderError(
        "PPTX_GENERATION_FAILED",
        "PptxGenJS could not generate the presentation package",
        { message: error instanceof Error ? error.message : String(error) },
      );
    }

    const validation = validatePptxPackage(data, {
      slideCount: deck.pages.length,
      imageCount: deck.pages.reduce(
        (count, page) =>
          count + page.elements.filter((element) => element.type === "image").length,
        0,
      ),
      representativeTexts: deck.pages.map(
        (page) =>
          page.elements.find(
            (element): element is ResolvedTextElement =>
              element.type === "text" && element.content.value.length > 0,
          )?.content.value,
      ),
    });
    const written = await this.#context.output.write(
      outputPath,
      data,
    );

    return { ...written, validation };
  }
}

export function renderPptx(
  deck: ResolvedDeck,
  context: PptxRendererContext,
  options?: PptxRenderOptions,
): Promise<PptxRenderResult> {
  return new PptxRenderer(context).render(deck, options);
}
