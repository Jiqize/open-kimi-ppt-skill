import type { ImageDimensions } from "@deck-agent/deck-core";

import type { ResolvedBounds, ResolvedImageCrop } from "./types.js";

export type { ImageDimensions } from "@deck-agent/deck-core";

export interface ResolvedSourceCrop {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface ResolvedImageGeometry {
  readonly frame: ResolvedBounds;
  readonly placement: ResolvedBounds;
  readonly sourceCrop?: ResolvedSourceCrop;
}

export class ImageGeometryError extends Error {
  readonly code = "IMAGE_GEOMETRY_INVALID";
  readonly details: Readonly<Record<string, unknown>>;

  constructor(message: string, details: Readonly<Record<string, unknown>>) {
    super(message);
    this.name = "ImageGeometryError";
    this.details = details;
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return {
      name: "ImageGeometryError",
      code: this.code,
      message: this.message,
      details: this.details,
    };
  }
}

const GEOMETRY_PRECISION = 1e12;
const GEOMETRY_EPSILON = 1e-12;

function round(value: number): number {
  const rounded = Math.round(value * GEOMETRY_PRECISION) / GEOMETRY_PRECISION;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function assertPositiveDimensions(
  name: string,
  dimensions: ImageDimensions,
): void {
  if (
    !Number.isFinite(dimensions.width) ||
    !Number.isFinite(dimensions.height) ||
    dimensions.width <= 0 ||
    dimensions.height <= 0
  ) {
    throw new ImageGeometryError(`${name} dimensions must be positive`, {
      [name]: dimensions,
    });
  }
}

function assertValidFrame(frame: ResolvedBounds): void {
  if (
    !Number.isFinite(frame.x) ||
    !Number.isFinite(frame.y) ||
    !Number.isFinite(frame.w) ||
    !Number.isFinite(frame.h) ||
    frame.w <= 0 ||
    frame.h <= 0
  ) {
    throw new ImageGeometryError("Image frame must have valid positive bounds", {
      frame,
    });
  }
}

function normalizeCrop(crop: ResolvedImageCrop | undefined): ResolvedSourceCrop {
  if (crop === undefined) {
    return { x: 0, y: 0, width: 1, height: 1 };
  }

  const values = [crop.x, crop.y, crop.w, crop.h];
  if (
    !values.every((value) => Number.isFinite(value)) ||
    crop.x < 0 ||
    crop.y < 0 ||
    crop.w <= 0 ||
    crop.h <= 0 ||
    crop.x + crop.w > 1 + GEOMETRY_EPSILON ||
    crop.y + crop.h > 1 + GEOMETRY_EPSILON
  ) {
    throw new ImageGeometryError("Image crop must be inside normalized bounds", {
      crop,
    });
  }

  return {
    x: crop.x,
    y: crop.y,
    width: crop.w,
    height: crop.h,
  };
}

function isFullCrop(crop: ResolvedSourceCrop): boolean {
  return (
    Math.abs(crop.x) <= GEOMETRY_EPSILON &&
    Math.abs(crop.y) <= GEOMETRY_EPSILON &&
    Math.abs(crop.width - 1) <= GEOMETRY_EPSILON &&
    Math.abs(crop.height - 1) <= GEOMETRY_EPSILON
  );
}

function roundedBounds(bounds: ResolvedBounds): ResolvedBounds {
  return {
    x: round(bounds.x),
    y: round(bounds.y),
    w: round(bounds.w),
    h: round(bounds.h),
  };
}

function roundedCrop(crop: ResolvedSourceCrop): ResolvedSourceCrop {
  return {
    x: round(crop.x),
    y: round(crop.y),
    width: round(crop.width),
    height: round(crop.height),
  };
}

export function resolveImageGeometry(
  frame: ResolvedBounds,
  image: ImageDimensions,
  fit: "cover" | "contain",
  explicitCrop?: ResolvedImageCrop,
): ResolvedImageGeometry {
  assertValidFrame(frame);
  assertPositiveDimensions("image", image);
  const sourceCrop = normalizeCrop(explicitCrop);
  const sourceWidth = image.width * sourceCrop.width;
  const sourceHeight = image.height * sourceCrop.height;

  if (fit === "contain") {
    const scale = Math.min(frame.w / sourceWidth, frame.h / sourceHeight);
    const width = sourceWidth * scale;
    const height = sourceHeight * scale;
    return {
      frame: roundedBounds(frame),
      placement: roundedBounds({
        x: frame.x + (frame.w - width) / 2,
        y: frame.y + (frame.h - height) / 2,
        w: width,
        h: height,
      }),
      ...(explicitCrop === undefined
        ? {}
        : { sourceCrop: roundedCrop(sourceCrop) }),
    };
  }

  const frameAspect = frame.w / frame.h;
  const sourceAspect = sourceWidth / sourceHeight;
  let coverCrop = sourceCrop;

  if (sourceAspect > frameAspect + GEOMETRY_EPSILON) {
    const targetPixelWidth = sourceHeight * frameAspect;
    const targetWidth = targetPixelWidth / image.width;
    coverCrop = {
      x: sourceCrop.x + (sourceCrop.width - targetWidth) / 2,
      y: sourceCrop.y,
      width: targetWidth,
      height: sourceCrop.height,
    };
  } else if (sourceAspect < frameAspect - GEOMETRY_EPSILON) {
    const targetPixelHeight = sourceWidth / frameAspect;
    const targetHeight = targetPixelHeight / image.height;
    coverCrop = {
      x: sourceCrop.x,
      y: sourceCrop.y + (sourceCrop.height - targetHeight) / 2,
      width: sourceCrop.width,
      height: targetHeight,
    };
  }

  return {
    frame: roundedBounds(frame),
    placement: roundedBounds(frame),
    ...(isFullCrop(coverCrop)
      ? {}
      : { sourceCrop: roundedCrop(coverCrop) }),
  };
}
