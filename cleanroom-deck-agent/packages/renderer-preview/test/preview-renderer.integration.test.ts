import { cp, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createProjectAssetResolver,
  createProjectOutputWriter,
  createProjectPreviewWriter,
  loadDeckProject,
} from "@deck-agent/deck-core";
import { resolveDeck, type ResolvedDeck } from "@deck-agent/deck-layout";
import { renderPptx, type PptxRenderResult } from "@deck-agent/renderer-pptx";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  renderPreview,
  renderPreviewPages,
  type PreviewPagesRenderResult,
  type PreviewRenderResult,
} from "../src/preview-renderer.js";

interface GoldenRender {
  readonly projectRoot: string;
  readonly deck: ResolvedDeck;
  readonly result: PreviewRenderResult;
}

const businessSource = fileURLToPath(
  new URL("../../../examples/golden-preview-business-report", import.meta.url),
);
const imageHeavySource = fileURLToPath(
  new URL("../../../examples/golden-preview-image-heavy", import.meta.url),
);
const minimalSource = fileURLToPath(
  new URL("../../../examples/minimal-report", import.meta.url),
);

let temporaryRoot: string;
let business: GoldenRender;
let imageHeavy: GoldenRender;
let businessPptx: PptxRenderResult;
let businessDeckBeforeRendering: string;
let minimalPages: PreviewPagesRenderResult;

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

async function renderGolden(source: string, name: string): Promise<GoldenRender> {
  const projectRoot = path.join(temporaryRoot, name);
  await cp(source, projectRoot, { recursive: true });
  const project = await loadDeckProject(projectRoot);
  const deck = resolveDeck(project);
  const result = await renderPreview(deck, {
    assets: createProjectAssetResolver(projectRoot),
    output: createProjectPreviewWriter(projectRoot),
  });
  return { projectRoot, deck, result };
}

function pngDimensions(data: Uint8Array): Readonly<{
  width: number;
  height: number;
}> {
  expect(Array.from(data.slice(0, 8))).toEqual([
    137, 80, 78, 71, 13, 10, 26, 10,
  ]);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return {
    width: view.getUint32(16),
    height: view.getUint32(20),
  };
}

beforeAll(async () => {
  temporaryRoot = await mkdtemp(path.join(tmpdir(), "deck-preview-integration-"));
  business = await renderGolden(
    businessSource,
    "golden-preview-business-report",
  );
  imageHeavy = await renderGolden(
    imageHeavySource,
    "golden-preview-image-heavy",
  );

  businessDeckBeforeRendering = JSON.stringify(business.deck);
  businessPptx = await renderPptx(business.deck, {
    assets: createProjectAssetResolver(business.projectRoot),
    output: createProjectOutputWriter(business.projectRoot),
  });

  const minimalRoot = path.join(temporaryRoot, "minimal-report");
  await cp(minimalSource, minimalRoot, { recursive: true });
  const minimalProject = await loadDeckProject(minimalRoot);
  minimalPages = await renderPreviewPages(resolveDeck(minimalProject), {
    assets: createProjectAssetResolver(minimalRoot),
    output: createProjectPreviewWriter(minimalRoot),
  });
}, 60_000);

afterAll(async () => {
  await removeTemporaryDirectory(temporaryRoot);
});

describe("Task 09 Preview renderer integration", () => {
  it("offers a page-only API for the canonical Task 12 contract", async () => {
    expect(minimalPages.pages).toHaveLength(1);
    expect(minimalPages.pages[0]?.relativePath).toBe("preview/01.png");
    await expect(
      readFile(path.join(temporaryRoot, "minimal-report/preview/overview.png")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each([
    ["business/report", () => business],
    ["image-heavy", () => imageHeavy],
  ])("renders the %s Golden Preview as one PNG per page", async (_, golden) => {
    const { deck, result } = golden();
    expect(result.pages).toHaveLength(deck.pages.length);
    expect(result.pages.map((page) => page.relativePath)).toEqual([
      "preview/01.png",
      "preview/02.png",
    ]);

    for (const page of result.pages) {
      const data = new Uint8Array(await readFile(page.absolutePath));
      expect(pngDimensions(data)).toEqual({ width: 960, height: 540 });
      expect(page.bytesWritten).toBeGreaterThan(1_000);
    }
  });

  it.each([
    ["business/report", () => business],
    ["image-heavy", () => imageHeavy],
  ])("renders a deterministic %s overview PNG", async (_, golden) => {
    const { result } = golden();
    expect(result.overview.relativePath).toBe("preview/overview.png");
    const data = new Uint8Array(await readFile(result.overview.absolutePath));
    expect(pngDimensions(data)).toEqual({ width: 1_032, height: 350 });
    expect(result.overview.bytesWritten).toBeGreaterThan(1_000);
  });

  it("writes every generated preview inside the guarded preview directory", async () => {
    for (const golden of [business, imageHeavy]) {
      const canonicalRoot = await realpath(golden.projectRoot);
      const generated = [...golden.result.pages, golden.result.overview];
      for (const file of generated) {
        expect(path.relative(canonicalRoot, file.absolutePath)).toMatch(
          /^preview\//u,
        );
      }
    }
  });

  it("renders PPTX and Preview from the same immutable Resolved Deck", () => {
    expect(businessPptx.validation).toMatchObject({
      zipValid: true,
      slideCount: 2,
    });
    expect(JSON.stringify(business.deck)).toBe(businessDeckBeforeRendering);
    expect(business.result.pages.map((page) => page.pageId)).toEqual(
      business.deck.pages.map((page) => page.id),
    );
  });
});
