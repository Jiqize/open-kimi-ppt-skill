import type {
  AssetResolver,
  LoadedImageAsset,
  ResolvedAsset,
  ResolvedLocalAsset,
} from "@deck-agent/deck-core";
import type { ResolvedPage } from "@deck-agent/deck-layout";
import { describe, expect, it, vi } from "vitest";

import { renderResolvedPageSvg } from "../src/svg-renderer.js";

function localImage(): LoadedImageAsset {
  const asset: ResolvedLocalAsset = {
    kind: "local",
    source: "media/landscape.svg",
    absolutePath: "/virtual/project/media/landscape.svg",
    mimeType: "image/svg+xml",
  };
  return {
    asset,
    data: new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"/>',
    ),
    dimensions: { width: 1600, height: 900 },
    mimeType: "image/svg+xml",
  };
}

function assetResolver(): AssetResolver & {
  readImage: ReturnType<typeof vi.fn<AssetResolver["readImage"]>>;
} {
  const image = localImage();
  return {
    resolve: vi.fn(async (source: string): Promise<ResolvedAsset> =>
      source.startsWith("https://")
        ? { kind: "remote", source, mimeType: "image/png" }
        : image.asset,
    ),
    read: vi.fn(async () => image.data),
    readImage: vi.fn(async () => image),
  };
}

function resolvedPageWithoutReadableLayout(): ResolvedPage {
  const page = {
    id: "resolved-page",
    type: "preview-test",
    background: { color: "#FFFFFF" },
    elements: [
      {
        id: "card",
        type: "shape",
        x: 0.5,
        y: 0.5,
        w: 2,
        h: 1,
        content: { kind: "ellipse" },
        style: { fill: "#DDE5FF", stroke: "#3157F6", radius: 0 },
      },
      {
        id: "title",
        type: "text",
        x: 0.75,
        y: 0.75,
        w: 1.5,
        h: 0.5,
        content: { value: "Resolved & editable" },
        style: {
          fontFamily: "Arial",
          fontWeight: 700,
          fontStyle: "normal",
          fontSize: 18,
          color: "#172033",
          bold: true,
          alignment: "center",
          wrap: { mode: "word", maxLines: 2, overflow: "ellipsis" },
        },
      },
      {
        id: "hero",
        type: "image",
        x: 3,
        y: 0.5,
        w: 4,
        h: 4,
        content: {
          source: "media/landscape.svg",
          fit: "cover",
          alt: "Landscape",
        },
        style: {},
      },
      {
        id: "direction",
        type: "line",
        x: 1,
        y: 4.5,
        w: 7,
        h: 0.5,
        content: {
          start: { x: 1, y: 4.75 },
          end: { x: 8, y: 4.75 },
        },
        style: {
          stroke: "#3157F6",
          width: 2,
          dash: "dash",
          arrow: "end",
        },
      },
    ],
  } as unknown as ResolvedPage;

  Object.defineProperty(page, "layout", {
    enumerable: true,
    get(): never {
      throw new Error("Preview renderer must not inspect resolved layout");
    },
  });
  return page;
}

describe("renderResolvedPageSvg", () => {
  it("renders all four resolved element types without reading layout", async () => {
    const assets = assetResolver();
    const result = await renderResolvedPageSvg(
      resolvedPageWithoutReadableLayout(),
      { width: 10, height: 5.625 },
      assets,
    );

    expect(result.pageId).toBe("resolved-page");
    expect(result.svg).toContain('viewBox="0 0 960 540"');
    expect(result.svg).toContain('id="card" data-element-type="shape"');
    expect(result.svg).toContain('id="title" data-element-type="text"');
    expect(result.svg).toContain("Resolved &amp; editable");
    expect(result.svg).toContain('id="hero" data-element-type="image"');
    expect(result.svg).toContain('viewBox="350 0 900 900"');
    expect(result.svg).toContain(
      'id="direction" data-element-type="line" x1="96" y1="456" x2="768" y2="456"',
    );
    expect(result.svg).toContain('marker-end="url(#preview-arrow-1)"');
    expect(assets.readImage).toHaveBeenCalledOnce();
  });

  it("renders a deterministic remote placeholder without downloading", async () => {
    const assets = assetResolver();
    const page: ResolvedPage = {
      id: "remote-page",
      type: "preview-test",
      layout: { type: "free", options: {} },
      background: { color: "#FFFFFF" },
      elements: [
        {
          id: "remote-hero",
          type: "image",
          x: 1,
          y: 1,
          w: 4,
          h: 3,
          content: {
            source: "https://assets.example.com/hero.png",
            fit: "contain",
          },
          style: {},
        },
      ],
    };

    const first = await renderResolvedPageSvg(
      page,
      { width: 10, height: 5.625 },
      assets,
    );
    const second = await renderResolvedPageSvg(
      page,
      { width: 10, height: 5.625 },
      assets,
    );

    expect(first).toEqual(second);
    expect(first.svg).toContain('data-asset-kind="remote"');
    expect(first.svg).toContain("Remote asset: https://assets.example.com/hero.png");
    expect(assets.readImage).not.toHaveBeenCalled();
  });
});
