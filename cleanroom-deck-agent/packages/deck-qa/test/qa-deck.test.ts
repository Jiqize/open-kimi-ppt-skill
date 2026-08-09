import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createProjectAssetResolver,
  loadDeckProject,
  type AssetResolver,
  type ResolvedAsset,
  type ResolvedLocalAsset,
} from "@deck-agent/deck-core";
import {
  resolveDeck,
  type ResolvedDeck,
  type ResolvedElement,
  type ResolvedPage,
  type ResolvedTextElement,
} from "@deck-agent/deck-layout";
import { afterEach, describe, expect, it, vi } from "vitest";

import { qaDeck } from "../src/qa-deck.js";

const temporaryDirectories: string[] = [];

async function removeTemporaryDirectory(directory: string): Promise<void> {
  const relative = path.relative(tmpdir(), directory);
  if (
    relative === "" ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`Refusing to remove non-temporary path: ${directory}`);
  }
  await rm(directory, { recursive: true, force: true });
}

afterEach(async () => {
  const directories = temporaryDirectories.splice(0);
  await Promise.all(directories.map(removeTemporaryDirectory));
});

function healthyText(
  id: string,
  bounds: Readonly<{ x: number; y: number; w: number; h: number }>,
  value = "Clear resolved content",
): ResolvedTextElement {
  return {
    id,
    type: "text",
    ...bounds,
    content: { value },
    style: {
      fontFamily: "Arial",
      fontWeight: 400,
      fontStyle: "normal",
      fontSize: 18,
      color: "#172033",
      bold: false,
      alignment: "left",
      wrap: { mode: "word", overflow: "clip" },
    },
  };
}

function page(id: string, elements: readonly ResolvedElement[]): ResolvedPage {
  return {
    id,
    type: "qa-test",
    layout: { type: "free", options: {} },
    background: { color: "#FFFFFF" },
    elements,
  };
}

function deck(...pages: readonly ResolvedPage[]): ResolvedDeck {
  return {
    size: { width: 10, height: 6 },
    theme: null,
    pages,
  };
}

function inMemoryAssets(): AssetResolver {
  const localAsset: ResolvedLocalAsset = {
    kind: "local",
    source: "media/image.svg",
    absolutePath: "/virtual/project/media/image.svg",
    mimeType: "image/svg+xml",
  };
  return {
    resolve: vi.fn(async (source: string): Promise<ResolvedAsset> =>
      source.startsWith("https://")
        ? { kind: "remote", source }
        : { ...localAsset, source },
    ),
    read: vi.fn(async () => new Uint8Array([1, 2, 3])),
    readImage: vi.fn(async (asset: ResolvedLocalAsset) => ({
      asset,
      data: new Uint8Array([1, 2, 3]),
      dimensions: { width: 100, height: 100 },
      mimeType: "image/png",
    })),
  };
}

function codes(report: Awaited<ReturnType<typeof qaDeck>>): string[] {
  return report.issues.map((currentIssue) => currentIssue.code);
}

describe("qaDeck", () => {
  it("returns a deterministic machine-readable success report", async () => {
    const resolved = deck(
      page("healthy", [
        healthyText("title", { x: 1, y: 1, w: 8, h: 1 }),
      ]),
    );
    const before = JSON.stringify(resolved);

    const first = await qaDeck(resolved, { assets: inMemoryAssets() });
    const second = await qaDeck(resolved, { assets: inMemoryAssets() });

    expect(first).toEqual(second);
    expect(first).toEqual({
      version: 1,
      ok: true,
      issues: [],
      summary: {
        pagesChecked: 1,
        elementsChecked: 1,
        total: 0,
        info: 0,
        warning: 0,
        error: 0,
      },
    });
    expect(JSON.stringify(resolved)).toBe(before);
  });

  it("defensively reports duplicate ids, invalid geometry, bounds, and line endpoints", async () => {
    const malformed = deck(
      page("geometry", [
        healthyText("duplicate", { x: 0.5, y: 0.5, w: 2, h: 0.8 }),
        healthyText("duplicate", { x: 9.5, y: 1.5, w: 1, h: 0.8 }),
        {
          id: "zero-shape",
          type: "shape",
          x: 1,
          y: 3,
          w: 0,
          h: 1,
          content: { kind: "rectangle" },
          style: { fill: null, stroke: null, radius: 0 },
        },
        {
          id: "negative-shape",
          type: "shape",
          x: 2,
          y: 3,
          w: -1,
          h: 1,
          content: { kind: "rectangle" },
          style: { fill: "#3157F6", stroke: null, radius: 0 },
        },
        {
          id: "zero-line",
          type: "line",
          x: 4,
          y: 3,
          w: 2,
          h: 1,
          content: {
            start: { x: 4.5, y: 3.5 },
            end: { x: 4.5, y: 3.5 },
          },
          style: {
            stroke: "#3157F6",
            width: 1,
            dash: "solid",
            arrow: "end",
          },
        },
      ] as readonly ResolvedElement[]),
    );

    const report = await qaDeck(malformed, { assets: inMemoryAssets() });

    expect(codes(report)).toEqual(
      expect.arrayContaining([
        "ELEMENT_ID_DUPLICATE",
        "ELEMENT_OUT_OF_BOUNDS",
        "GEOMETRY_INVALID",
        "LINE_ENDPOINT_INVALID",
      ]),
    );
    expect(report.ok).toBe(false);
    expect(report.issues.find((entry) => entry.code === "LINE_ENDPOINT_INVALID"))
      .toMatchObject({
        severity: "error",
        pageId: "geometry",
        elementId: "zero-line",
        details: { reasons: ["zero_length"] },
      });
  });

  it("classifies overlap by intent and severity to avoid background and card false positives", async () => {
    const resolved = deck(
      page("overlap", [
        {
          id: "background",
          type: "image",
          x: 0,
          y: 0,
          w: 10,
          h: 6,
          content: { source: "media/background.svg", fit: "cover" },
          style: {},
        },
        {
          id: "card",
          type: "shape",
          x: 0.5,
          y: 0.5,
          w: 4,
          h: 2,
          content: { kind: "rectangle" },
          style: { fill: "#FFFFFF", stroke: "#DDE5FF", radius: 0.1 },
        },
        healthyText("card-copy", { x: 0.75, y: 0.75, w: 3.5, h: 1 }),
        healthyText("text-a", { x: 6, y: 1, w: 3, h: 1 }, "First"),
        healthyText("text-b", { x: 6.5, y: 1.2, w: 3, h: 1 }, "Second"),
        {
          id: "small-image",
          type: "image",
          x: 1,
          y: 4,
          w: 3,
          h: 1.5,
          content: { source: "media/image.svg", fit: "contain" },
          style: {},
        },
        healthyText("image-label", { x: 1.2, y: 4.2, w: 2.5, h: 0.6 }),
      ]),
    );

    const report = await qaDeck(resolved, { assets: inMemoryAssets() });
    const overlaps = report.issues.filter(
      (entry) => entry.code === "ELEMENT_OVERLAP",
    );

    expect(overlaps).toHaveLength(2);
    expect(overlaps).toEqual([
      expect.objectContaining({
        severity: "error",
        elementId: "text-a",
        details: expect.objectContaining({ otherElementId: "text-b" }),
      }),
      expect.objectContaining({
        severity: "info",
        elementId: "small-image",
        details: expect.objectContaining({ otherElementId: "image-label" }),
      }),
    ]);
    expect(overlaps.some((entry) => entry.elementId === "background")).toBe(false);
    expect(overlaps.some((entry) => entry.elementId === "card")).toBe(false);
  });

  it("reports missing local and unsupported remote assets through the AssetResolver", async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), "deck-qa-assets-"));
    temporaryDirectories.push(projectRoot);
    await writeFile(path.join(projectRoot, ".deck-project"), "", "utf8");
    const resolved = deck(
      page("assets", [
        {
          id: "missing-local",
          type: "image",
          x: 1,
          y: 1,
          w: 3,
          h: 2,
          content: { source: "media/missing.png", fit: "contain" },
          style: {},
        },
        {
          id: "remote",
          type: "image",
          x: 5,
          y: 1,
          w: 3,
          h: 2,
          content: {
            source: "https://assets.example.com/hero.png",
            fit: "cover",
          },
          style: {},
        },
      ]),
    );

    const report = await qaDeck(resolved, {
      assets: createProjectAssetResolver(projectRoot),
    });

    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "MISSING_ASSET",
          severity: "error",
          elementId: "missing-local",
          details: expect.objectContaining({
            assetError: expect.objectContaining({ code: "ASSET_READ_FAILED" }),
          }),
        }),
        expect.objectContaining({
          code: "REMOTE_ASSET_UNSUPPORTED",
          severity: "error",
          elementId: "remote",
        }),
      ]),
    );
  });

  it("reports text, font, image-frame, and visual-default risks", async () => {
    const baseDenseText = healthyText(
      "dense-copy",
      { x: 0.5, y: 0.5, w: 1, h: 0.4 },
      "Dense content ".repeat(45),
    );
    const denseText = {
      ...baseDenseText,
      style: {
        ...baseDenseText.style,
        fontFamily: undefined,
        color: undefined,
      },
    } as unknown as ResolvedTextElement;

    const resolved = deck(
      page("heuristics", [
        denseText,
        {
          id: "thin-image",
          type: "image",
          x: 2,
          y: 1,
          w: 0.05,
          h: 2,
          content: { source: "media/thin.png", fit: "contain" },
          style: {},
        },
        {
          id: "unresolved-shape-style",
          type: "shape",
          x: 3,
          y: 3,
          w: 1,
          h: 1,
          content: { kind: "rectangle" },
          style: { radius: 0 },
        } as unknown as ResolvedElement,
        {
          id: "unresolved-line-style",
          type: "line",
          x: 5,
          y: 3,
          w: 2,
          h: 1,
          content: { start: { x: 5, y: 3 }, end: { x: 7, y: 4 } },
          style: { width: 1, dash: "solid", arrow: "none" },
        } as unknown as ResolvedElement,
      ]),
    );

    const report = await qaDeck(resolved, { assets: inMemoryAssets() });

    expect(codes(report)).toEqual(
      expect.arrayContaining([
        "FONT_FALLBACK_INVALID",
        "TEXT_OVERFLOW_RISK",
        "TEXT_DENSITY_HIGH",
        "IMAGE_FRAME_SUSPICIOUS",
        "VISUAL_DEFAULT_LOW_CONFIDENCE",
      ]),
    );
    expect(report.issues.find((entry) => entry.code === "TEXT_OVERFLOW_RISK"))
      .toMatchObject({ severity: "error", elementId: "dense-copy" });
  });

  it("distinguishes empty pages from decoration-only pages", async () => {
    const resolved = deck(
      page("empty", []),
      page("decorative", [
        {
          id: "decorative-shape",
          type: "shape",
          x: 1,
          y: 1,
          w: 3,
          h: 2,
          content: { kind: "ellipse" },
          style: { fill: "#3157F6", stroke: null, radius: 0 },
        },
        {
          id: "decorative-line",
          type: "line",
          x: 5,
          y: 2,
          w: 2,
          h: 1,
          content: { start: { x: 5, y: 2 }, end: { x: 7, y: 3 } },
          style: {
            stroke: "#172033",
            width: 1,
            dash: "solid",
            arrow: "none",
          },
        },
      ]),
    );

    const report = await qaDeck(resolved, { assets: inMemoryAssets() });

    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "EMPTY_PAGE",
          severity: "error",
          pageId: "empty",
        }),
        expect.objectContaining({
          code: "PAGE_MEANINGFUL_CONTENT_MISSING",
          severity: "warning",
          pageId: "decorative",
        }),
      ]),
    );
  });

  it.each([
    "golden-preview-business-report",
    "golden-preview-image-heavy",
  ])("finds no blocking structural errors in %s", async (name) => {
    const projectRoot = fileURLToPath(
      new URL(`../../../examples/${name}`, import.meta.url),
    );
    const project = await loadDeckProject(projectRoot);
    const resolved = resolveDeck(project);

    const report = await qaDeck(resolved, {
      assets: createProjectAssetResolver(projectRoot),
    });

    expect(report.summary.error).toBe(0);
  });
});
