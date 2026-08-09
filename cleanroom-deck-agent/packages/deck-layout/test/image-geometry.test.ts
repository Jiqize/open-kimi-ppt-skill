import { describe, expect, it } from "vitest";

import { resolveImageGeometry } from "../src/image-geometry.js";

describe("resolveImageGeometry", () => {
  it("contains a landscape image inside a square frame", () => {
    expect(
      resolveImageGeometry(
        { x: 0, y: 0, w: 4, h: 4 },
        { width: 1600, height: 900 },
        "contain",
      ),
    ).toEqual({
      frame: { x: 0, y: 0, w: 4, h: 4 },
      placement: { x: 0, y: 0.875, w: 4, h: 2.25 },
    });
  });

  it("covers a square frame with a centered landscape crop", () => {
    expect(
      resolveImageGeometry(
        { x: 0, y: 0, w: 4, h: 4 },
        { width: 1600, height: 900 },
        "cover",
      ),
    ).toEqual({
      frame: { x: 0, y: 0, w: 4, h: 4 },
      placement: { x: 0, y: 0, w: 4, h: 4 },
      sourceCrop: { x: 0.21875, y: 0, width: 0.5625, height: 1 },
    });
  });

  it("contains a portrait image inside a square frame", () => {
    expect(
      resolveImageGeometry(
        { x: 0, y: 0, w: 4, h: 4 },
        { width: 900, height: 1600 },
        "contain",
      ),
    ).toEqual({
      frame: { x: 0, y: 0, w: 4, h: 4 },
      placement: { x: 0.875, y: 0, w: 2.25, h: 4 },
    });
  });

  it("covers a square frame with a centered portrait crop", () => {
    expect(
      resolveImageGeometry(
        { x: 0, y: 0, w: 4, h: 4 },
        { width: 900, height: 1600 },
        "cover",
      ),
    ).toEqual({
      frame: { x: 0, y: 0, w: 4, h: 4 },
      placement: { x: 0, y: 0, w: 4, h: 4 },
      sourceCrop: { x: 0, y: 0.21875, width: 1, height: 0.5625 },
    });
  });

  it("normalizes contain and cover geometry for a square image", () => {
    const frame = { x: 0, y: 0, w: 4, h: 2 };
    const image = { width: 1000, height: 1000 };

    expect(resolveImageGeometry(frame, image, "contain")).toEqual({
      frame,
      placement: { x: 1, y: 0, w: 2, h: 2 },
    });
    expect(resolveImageGeometry(frame, image, "cover")).toEqual({
      frame,
      placement: frame,
      sourceCrop: { x: 0, y: 0.25, width: 1, height: 0.5 },
    });
  });

  it("combines an explicit crop with cover deterministically", () => {
    expect(
      resolveImageGeometry(
        { x: 0, y: 0, w: 4, h: 2 },
        { width: 2000, height: 1000 },
        "cover",
        { x: 0.25, y: 0, w: 0.5, h: 1 },
      ),
    ).toEqual({
      frame: { x: 0, y: 0, w: 4, h: 2 },
      placement: { x: 0, y: 0, w: 4, h: 2 },
      sourceCrop: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
    });
  });

  it("rejects invalid dimensions and explicit crops with a typed error", () => {
    expect(() =>
      resolveImageGeometry(
        { x: 0, y: 0, w: 0, h: 2 },
        { width: 100, height: 100 },
        "contain",
      ),
    ).toThrowError(expect.objectContaining({ code: "IMAGE_GEOMETRY_INVALID" }));

    expect(() =>
      resolveImageGeometry(
        { x: 0, y: 0, w: 2, h: 2 },
        { width: 100, height: 100 },
        "cover",
        { x: 0.8, y: 0, w: 0.3, h: 1 },
      ),
    ).toThrowError(expect.objectContaining({ code: "IMAGE_GEOMETRY_INVALID" }));
  });
});
