import {
  AssetResolutionError,
  ProjectPreviewError,
  WorkspaceSafetyError,
  type AssetResolver,
  type ProjectPreviewWriteResult,
  type ProjectPreviewWriter,
} from "@deck-agent/deck-core";
import type { ResolvedDeck } from "@deck-agent/deck-layout";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

import { PreviewRenderError } from "./errors.js";
import {
  renderResolvedPageSvg,
  type ResolvedPageSvg,
} from "./svg-renderer.js";

const PIXELS_PER_INCH = 96;
const LEGACY_OVERVIEW_COLUMNS = 2;
const CANONICAL_OVERVIEW_COLUMNS = 3;
const OVERVIEW_GAP = 24;
const OVERVIEW_PADDING = 24;
const LEGACY_OVERVIEW_LABEL_HEIGHT = 32;
const LEGACY_OVERVIEW_THUMBNAIL_WIDTH = 480;
const CANONICAL_OVERVIEW_LABEL_HEIGHT = 36;
const CANONICAL_OVERVIEW_THUMBNAIL_WIDTH = 360;

export interface PreviewRendererContext {
  readonly assets: AssetResolver;
  readonly output: ProjectPreviewWriter;
}

export interface PreviewPageRenderResult extends ProjectPreviewWriteResult {
  readonly pageId: string;
  readonly width: number;
  readonly height: number;
}

export interface PreviewRenderResult {
  readonly pages: readonly PreviewPageRenderResult[];
  readonly overview: ProjectPreviewWriteResult;
}

export interface PreviewPagesRenderResult {
  readonly pages: readonly PreviewPageRenderResult[];
}

export interface PreviewOverviewPage {
  readonly label: string;
  readonly pageId: string;
  readonly imageSource: string;
}

export interface PreviewOverviewRenderResult extends ProjectPreviewWriteResult {
  readonly width: number;
  readonly height: number;
  readonly pages: readonly PreviewOverviewPage[];
}

interface InternalPreviewRenderResult extends PreviewPagesRenderResult {
  readonly overview?: ProjectPreviewWriteResult;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function pixelDimensions(deck: ResolvedDeck): Readonly<{
  width: number;
  height: number;
}> {
  const width = Math.round(deck.size.width * PIXELS_PER_INCH);
  const height = Math.round(deck.size.height * PIXELS_PER_INCH);
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new PreviewRenderError(
      "PREVIEW_DIMENSIONS_INVALID",
      "Resolved Deck has invalid preview dimensions",
      { size: deck.size, pixelsPerInch: PIXELS_PER_INCH },
    );
  }
  return { width, height };
}

function pageDocument(svg: string): string {
  return [
    "<!doctype html>",
    '<html><head><meta charset="utf-8"/>',
    "<style>",
    "html,body{margin:0;padding:0;overflow:hidden;background:transparent}",
    "svg{display:block}",
    "</style></head><body>",
    svg,
    "</body></html>",
  ].join("");
}

function overviewGeometry(
  pageCount: number,
  slideAspect: number,
): Readonly<{ width: number; height: number; thumbnailHeight: number }> {
  const columns = Math.max(1, Math.min(LEGACY_OVERVIEW_COLUMNS, pageCount));
  const rows = Math.max(1, Math.ceil(pageCount / columns));
  const thumbnailHeight = Math.round(
    LEGACY_OVERVIEW_THUMBNAIL_WIDTH / slideAspect,
  );
  return {
    width:
      OVERVIEW_PADDING * 2 +
      columns * LEGACY_OVERVIEW_THUMBNAIL_WIDTH +
      (columns - 1) * OVERVIEW_GAP,
    height:
      OVERVIEW_PADDING * 2 +
      rows * (thumbnailHeight + LEGACY_OVERVIEW_LABEL_HEIGHT) +
      (rows - 1) * OVERVIEW_GAP,
    thumbnailHeight,
  };
}

function overviewDocument(
  pages: readonly ResolvedPageSvg[],
  thumbnailHeight: number,
): string {
  const columns = Math.max(
    1,
    Math.min(LEGACY_OVERVIEW_COLUMNS, pages.length),
  );
  const cards =
    pages.length === 0
      ? '<div class="empty">No pages</div>'
      : pages
          .map(
            ({ pageId, svg }, index) => [
              '<div class="card">',
              `<div class="slide" style="height:${String(thumbnailHeight)}px">${svg}</div>`,
              `<div class="label">${String(index + 1).padStart(2, "0")} · ${escapeHtml(pageId)}</div>`,
              "</div>",
            ].join(""),
          )
          .join("");

  return [
    "<!doctype html>",
    '<html><head><meta charset="utf-8"/>',
    "<style>",
    "*{box-sizing:border-box}",
    `html,body{margin:0;padding:0;background:#E8EBF0;font-family:Arial,sans-serif}`,
    `body{padding:${String(OVERVIEW_PADDING)}px}`,
    `.grid{display:grid;grid-template-columns:repeat(${String(columns)},${String(LEGACY_OVERVIEW_THUMBNAIL_WIDTH)}px);gap:${String(OVERVIEW_GAP)}px}`,
    ".card{min-width:0}",
    `.slide{width:${String(LEGACY_OVERVIEW_THUMBNAIL_WIDTH)}px;background:white;box-shadow:0 2px 12px rgba(16,24,40,.18);overflow:hidden}`,
    ".slide svg{display:block;width:100%;height:100%}",
    `.label{height:${String(LEGACY_OVERVIEW_LABEL_HEIGHT)}px;padding-top:9px;color:#344054;font-size:12px;line-height:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}`,
    ".empty{color:#475467;font-size:16px}",
    "</style></head><body>",
    `<div class="grid">${cards}</div>`,
    "</body></html>",
  ].join("");
}

function canonicalOverviewGeometry(
  pageCount: number,
  slideAspect: number,
): Readonly<{
  width: number;
  height: number;
  thumbnailHeight: number;
  columns: number;
}> {
  const columns = Math.max(
    1,
    Math.min(CANONICAL_OVERVIEW_COLUMNS, pageCount),
  );
  const rows = Math.max(1, Math.ceil(pageCount / columns));
  const thumbnailHeight = Math.round(
    CANONICAL_OVERVIEW_THUMBNAIL_WIDTH / slideAspect,
  );
  return {
    width:
      OVERVIEW_PADDING * 2 +
      columns * CANONICAL_OVERVIEW_THUMBNAIL_WIDTH +
      (columns - 1) * OVERVIEW_GAP,
    height:
      OVERVIEW_PADDING * 2 +
      rows * (thumbnailHeight + CANONICAL_OVERVIEW_LABEL_HEIGHT) +
      (rows - 1) * OVERVIEW_GAP,
    thumbnailHeight,
    columns,
  };
}

interface LoadedOverviewPage extends PreviewOverviewPage {
  readonly dataUri: string;
}

function canonicalOverviewDocument(
  pages: readonly LoadedOverviewPage[],
  geometry: ReturnType<typeof canonicalOverviewGeometry>,
): string {
  const cards = pages
    .map(
      ({ dataUri, label, pageId }) => [
        '<div class="card">',
        `<img class="slide" src="${escapeHtml(dataUri)}" alt="${escapeHtml(pageId)}"/>`,
        `<div class="label"><strong>${escapeHtml(label)}</strong><span>${escapeHtml(pageId)}</span></div>`,
        "</div>",
      ].join(""),
    )
    .join("");
  return [
    "<!doctype html>",
    '<html><head><meta charset="utf-8"/>',
    "<style>",
    "*{box-sizing:border-box}",
    "html,body{margin:0;padding:0;background:#F2F4F7;font-family:Arial,sans-serif}",
    `body{padding:${String(OVERVIEW_PADDING)}px}`,
    `.grid{display:grid;grid-template-columns:repeat(${String(geometry.columns)},${String(CANONICAL_OVERVIEW_THUMBNAIL_WIDTH)}px);gap:${String(OVERVIEW_GAP)}px}`,
    ".card{min-width:0}",
    `.slide{display:block;width:${String(CANONICAL_OVERVIEW_THUMBNAIL_WIDTH)}px;height:${String(geometry.thumbnailHeight)}px;object-fit:fill;background:#FFFFFF;box-shadow:0 2px 12px rgba(16,24,40,.18)}`,
    `.label{height:${String(CANONICAL_OVERVIEW_LABEL_HEIGHT)}px;display:flex;align-items:center;gap:9px;color:#000000;font-size:13px;line-height:18px;white-space:nowrap;overflow:hidden}`,
    ".label strong{font-size:14px;color:#000000}",
    ".label span{overflow:hidden;text-overflow:ellipsis;color:#344054}",
    "</style></head><body>",
    `<div class="grid">${cards}</div>`,
    "</body></html>",
  ].join("");
}

async function setDeterministicContent(
  page: Page,
  html: string,
  viewport: Readonly<{ width: number; height: number }>,
): Promise<void> {
  await page.setViewportSize(viewport);
  await page.setContent(html, { waitUntil: "load" });
  await page.evaluate("document.fonts.ready");
  await page.evaluate(
    "Promise.all(Array.from(document.images, image => image.decode()))",
  );
}

async function screenshot(page: Page): Promise<Uint8Array> {
  const data = await page.screenshot({
    type: "png",
    animations: "disabled",
    caret: "hide",
    fullPage: false,
    omitBackground: false,
    scale: "css",
  });
  return new Uint8Array(data);
}

async function screenshotJpeg(page: Page): Promise<Uint8Array> {
  const data = await page.screenshot({
    type: "jpeg",
    quality: 90,
    animations: "disabled",
    caret: "hide",
    fullPage: false,
    omitBackground: false,
    scale: "css",
  });
  return new Uint8Array(data);
}

async function createBrowser(): Promise<Browser> {
  let bundledError: unknown;
  try {
    return await chromium.launch({ headless: true });
  } catch (error) {
    bundledError = error;
  }

  try {
    // A checked-in Playwright dependency remains the driver. This fallback
    // lets development environments use an existing stable Chrome channel
    // when the optional Playwright browser bundle has not been provisioned.
    return await chromium.launch({ channel: "chrome", headless: true });
  } catch (channelError) {
    throw new PreviewRenderError(
      "PREVIEW_BROWSER_UNAVAILABLE",
      "Could not launch the project Playwright Chromium browser",
      {
        bundledMessage:
          bundledError instanceof Error
            ? bundledError.message
            : String(bundledError),
        channelMessage:
          channelError instanceof Error
            ? channelError.message
            : String(channelError),
      },
    );
  }
}

async function createBrowserContext(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({
    colorScheme: "light",
    deviceScaleFactor: 1,
    locale: "en-US",
    offline: true,
    reducedMotion: "reduce",
  });
}

export class PreviewRenderer {
  readonly #context: PreviewRendererContext;

  constructor(context: PreviewRendererContext) {
    this.#context = context;
  }

  async renderPages(deck: ResolvedDeck): Promise<PreviewPagesRenderResult> {
    const result = await this.#render(deck, false);
    return { pages: result.pages };
  }

  async render(deck: ResolvedDeck): Promise<PreviewRenderResult> {
    const result = await this.#render(deck, true);
    if (result.overview === undefined) {
      throw new PreviewRenderError(
        "PREVIEW_SCREENSHOT_FAILED",
        "Legacy overview rendering did not produce an output",
      );
    }
    return { pages: result.pages, overview: result.overview };
  }

  async #render(
    deck: ResolvedDeck,
    includeLegacyOverview: boolean,
  ): Promise<InternalPreviewRenderResult> {
    const dimensions = pixelDimensions(deck);
    const resolvedPages: ResolvedPageSvg[] = [];
    for (const page of deck.pages) {
      resolvedPages.push(
        await renderResolvedPageSvg(page, deck.size, this.#context.assets),
      );
    }

    const browser = await createBrowser();
    let browserContext: BrowserContext | undefined;
    try {
      browserContext = await createBrowserContext(browser);
      const browserPage = await browserContext.newPage();
      const pageResults: PreviewPageRenderResult[] = [];
      const digits = Math.max(2, String(resolvedPages.length).length);

      for (const [index, resolvedPage] of resolvedPages.entries()) {
        await setDeterministicContent(
          browserPage,
          pageDocument(resolvedPage.svg),
          dimensions,
        );
        const data = await screenshot(browserPage);
        const relativePath = `preview/${String(index + 1).padStart(digits, "0")}.png`;
        const written = await this.#context.output.write(relativePath, data);
        pageResults.push({
          pageId: resolvedPage.pageId,
          width: dimensions.width,
          height: dimensions.height,
          ...written,
        });
      }

      if (!includeLegacyOverview) {
        return { pages: pageResults };
      }

      const overview = overviewGeometry(
        resolvedPages.length,
        deck.size.width / deck.size.height,
      );
      await setDeterministicContent(
        browserPage,
        overviewDocument(resolvedPages, overview.thumbnailHeight),
        { width: overview.width, height: overview.height },
      );
      const overviewData = await screenshot(browserPage);
      const overviewResult = await this.#context.output.write(
        "preview/overview.png",
        overviewData,
      );

      return { pages: pageResults, overview: overviewResult };
    } catch (error) {
      // Preserve machine-readable asset and workspace safety errors instead
      // of relabeling them as browser failures.
      if (
        error instanceof PreviewRenderError ||
        error instanceof AssetResolutionError ||
        error instanceof ProjectPreviewError ||
        error instanceof WorkspaceSafetyError
      ) {
        throw error;
      }
      throw new PreviewRenderError(
        "PREVIEW_SCREENSHOT_FAILED",
        "Playwright could not render the Resolved Deck preview",
        { message: error instanceof Error ? error.message : String(error) },
      );
    } finally {
      await browserContext?.close();
      await browser.close();
    }
  }
}

export function renderPreview(
  deck: ResolvedDeck,
  context: PreviewRendererContext,
): Promise<PreviewRenderResult> {
  return new PreviewRenderer(context).render(deck);
}

/** Render only canonical per-page PNG artifacts. Overview composition is Task 15. */
export function renderPreviewPages(
  deck: ResolvedDeck,
  context: PreviewRendererContext,
): Promise<PreviewPagesRenderResult> {
  return new PreviewRenderer(context).renderPages(deck);
}

export async function renderPreviewOverview(
  deck: ResolvedDeck,
  pages: readonly PreviewOverviewPage[],
  context: PreviewRendererContext,
): Promise<PreviewOverviewRenderResult> {
  if (
    pages.length !== deck.pages.length ||
    pages.some(
      (page, index) =>
        page.label !== `P${String(index + 1)}` ||
        page.pageId !== deck.pages[index]?.id,
    )
  ) {
    throw new PreviewRenderError(
      "PREVIEW_OVERVIEW_INVALID",
      "Overview pages must match Resolved Deck order with P1, P2, … labels",
      {
        resolvedPageIds: deck.pages.map((page) => page.id),
        overviewPages: pages,
      },
    );
  }

  const loadedPages: LoadedOverviewPage[] = [];
  for (const page of pages) {
    const asset = await context.assets.resolve(page.imageSource);
    if (asset.kind === "remote") {
      throw new PreviewRenderError(
        "PREVIEW_OVERVIEW_INVALID",
        "Overview page images must be local generated preview artifacts",
        { label: page.label, source: page.imageSource },
      );
    }
    const image = await context.assets.readImage(asset);
    loadedPages.push({
      ...page,
      dataUri: `data:${image.mimeType};base64,${Buffer.from(image.data).toString("base64")}`,
    });
  }

  const geometry = canonicalOverviewGeometry(
    pages.length,
    deck.size.width / deck.size.height,
  );
  const browser = await createBrowser();
  let browserContext: BrowserContext | undefined;
  try {
    browserContext = await createBrowserContext(browser);
    const browserPage = await browserContext.newPage();
    await setDeterministicContent(
      browserPage,
      canonicalOverviewDocument(loadedPages, geometry),
      { width: geometry.width, height: geometry.height },
    );
    const data = await screenshotJpeg(browserPage);
    const written = await context.output.write("preview/overview.jpg", data);
    return {
      ...written,
      width: geometry.width,
      height: geometry.height,
      pages: pages.map((page) => ({ ...page })),
    };
  } catch (error) {
    if (
      error instanceof PreviewRenderError ||
      error instanceof AssetResolutionError ||
      error instanceof ProjectPreviewError ||
      error instanceof WorkspaceSafetyError
    ) {
      throw error;
    }
    throw new PreviewRenderError(
      "PREVIEW_SCREENSHOT_FAILED",
      "Playwright could not render the preview overview",
      { message: error instanceof Error ? error.message : String(error) },
    );
  } finally {
    await browserContext?.close();
    await browser.close();
  }
}
